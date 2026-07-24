import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import {
	AgentError,
	type MonitoringCheck,
	type MonitoringState,
} from "../../shared/contracts";
import {
	anomalyRuleInfo,
	detectErrorAnomalies,
	detectLatencyAnomalies,
	latencyBaseline,
} from "../anomaly-rules";
import {
	listRecentWorkerErrors,
	listWorkerLatency,
	type WorkerTelemetryEvent,
} from "../cloudflare";
import { runAgent, systemMessage } from "./loop";
import {
	initializeAgentStorage,
	loadChecks,
	loadIssues,
	loadPreviousIssueObservations,
	markCheckInvestigated,
	resolveInactiveIssues,
	saveCheck,
	saveIssueInvestigation,
	saveIssueObservations,
	triageIssue,
	type IssueCandidate,
} from "./storage";

const CHECK_WINDOW_MS = 10 * 60 * 1_000;

type ErrorGroup = {
	readonly fingerprint: string;
	readonly scope: string;
	readonly signature: string;
	readonly count: number;
};

const normalizeErrorText = (error: string) =>
	error
		.toLowerCase()
		.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<uuid>")
		.replace(/\b[0-9a-f]{16,}\b/g, "<hex>")
		.replace(/\b\d{4,}\b/g, "<number>")
		.replace(/\s+/g, " ")
		.trim();

const errorScope = ({ $metadata }: WorkerTelemetryEvent) => {
	if ($metadata.trigger !== undefined) {
		return $metadata.trigger;
	}
	if ($metadata.url !== undefined) {
		return new URL($metadata.url).pathname;
	}
	return "worker-wide";
};

const errorSignature = ({ $metadata, $workers }: WorkerTelemetryEvent) => {
	if ($metadata.fingerprint !== undefined) {
		return $metadata.fingerprint;
	}
	if ($metadata.errorTemplate !== undefined) {
		return normalizeErrorText($metadata.errorTemplate);
	}
	if ($metadata.messageTemplate !== undefined) {
		return normalizeErrorText($metadata.messageTemplate);
	}
	if ($metadata.error !== undefined) {
		return normalizeErrorText($metadata.error);
	}
	if ($metadata.message !== undefined) {
		return normalizeErrorText($metadata.message);
	}
	if ($workers?.outcome !== undefined) {
		return $workers.outcome;
	}
	return "unclassified-error";
};

const groupErrors = (
	events: ReadonlyArray<WorkerTelemetryEvent>,
): ReadonlyArray<ErrorGroup> => {
	const eventsByRequest = new Map<string, Array<WorkerTelemetryEvent>>();

	for (const event of events) {
		const requestKey = event.$metadata.requestId ?? event.$metadata.id;
		const requestEvents = eventsByRequest.get(requestKey) ?? [];
		requestEvents.push(event);
		eventsByRequest.set(requestKey, requestEvents);
	}

	const groups = new Map<string, ErrorGroup>();

	for (const requestEvents of eventsByRequest.values()) {
		const explicitErrors = requestEvents.filter(
			(event) => event.$metadata.type !== "cf-worker-event",
		);
		const occurrences =
			explicitErrors.length === 0 ? requestEvents : explicitErrors;
		const requestFingerprints = new Set<string>();

		for (const event of occurrences) {
			const scope = errorScope(event);
			const signature = errorSignature(event);
			const fingerprint = `errors:${scope}:${signature}`;
			if (requestFingerprints.has(fingerprint)) {
				continue;
			}

			requestFingerprints.add(fingerprint);
			const group = groups.get(fingerprint);
			groups.set(fingerprint, {
				fingerprint,
				scope,
				signature,
				count: (group?.count ?? 0) + 1,
			});
		}
	}

	return Array.from(groups.values());
};

const requestCountForScope = (
	latency: ReadonlyArray<MonitoringCheck["latency"][number]>,
	scope: string,
) => {
	if (scope === "worker-wide") {
		return latency.reduce(
			(total, routeLatency) => total + routeLatency.sampleCount,
			0,
		);
	}

	return latency.find(({ route }) => route === scope)?.sampleCount;
};

const percentage = (value: number) => `${(value * 100).toFixed(2)}%`;

const milliseconds = (value: number) => `${Math.round(value)} ms`;

export class ProdweilerAgent extends DurableObject<Cloudflare.Env> {
	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super(ctx, env);
		initializeAgentStorage(this.ctx.storage.sql);
	}

	async check(workerName: string, scheduledTime: number): Promise<MonitoringCheck> {
		return Effect.runPromise(
			Effect.gen(this, function* () {
				const window = {
					from: scheduledTime - CHECK_WINDOW_MS,
					to: scheduledTime,
				};
				const [errors, latency, checks] = yield* Effect.all(
					[
						listRecentWorkerErrors(
							this.env,
							workerName,
							window.from,
							window.to,
						),
						listWorkerLatency(
							this.env,
							workerName,
							window.from,
							window.to,
						),
						loadChecks(this.ctx.storage.sql),
					],
					{ concurrency: "unbounded" },
				).pipe(
					Effect.mapError(
						(error) => new AgentError({ error: error.error }),
					),
				);
				const errorGroups = groupErrors(errors.events);
				const baselineChecks = checks.filter(
					({ status }) => status === "healthy" || status === "errors",
				);
				const checksById = new Map(
					baselineChecks.map((check) => [check.id, check]),
				);
				const errorCount = errorGroups.reduce(
					(total, group) => total + group.count,
					0,
				);
				const errorCandidates = yield* Effect.forEach(
					errorGroups,
					(group) =>
						loadPreviousIssueObservations(
							this.ctx.storage.sql,
							group.fingerprint,
						).pipe(
							Effect.map((observations): IssueCandidate | undefined => {
								const requestCount = requestCountForScope(
									latency,
									group.scope,
								);
								if (requestCount === undefined || requestCount === 0) {
									return undefined;
								}

								const previousErrorRates = observations.flatMap(
									({ checkId, errorCount: previousErrorCount }) => {
										const previousCheck = checksById.get(checkId);
										if (previousCheck === undefined) {
											return [];
										}

										const previousRequestCount = requestCountForScope(
											previousCheck.latency,
											group.scope,
										);
										return previousRequestCount === undefined ||
											previousRequestCount === 0
											? []
											: [previousErrorCount / previousRequestCount];
									},
								);
								const errorRate = group.count / requestCount;
								const rules = detectErrorAnomalies({
									errorCount: group.count,
									errorRate,
									previousErrorRates,
								});
								if (rules.length === 0) {
									return undefined;
								}

								return {
									fingerprint: group.fingerprint,
									kind: "errors",
									title: `Repeated errors on ${group.scope}`,
									evidence: `${group.count} of ${requestCount} requests (${percentage(errorRate)}) had this error; compared with ${previousErrorRates.length} baseline windows. Signature: ${group.signature}`,
									ruleIds: rules.map(({ id }) => id),
								};
							}),
						),
					{ concurrency: "unbounded" },
				);
				const latencyCandidates = latency.flatMap((route) => {
					const previous = baselineChecks.flatMap((check) => {
						const previousRoute = check.latency.find(
							({ route: previousRouteName }) =>
								previousRouteName === route.route,
						);
						return previousRoute === undefined ? [] : [previousRoute];
					});
					const rules = detectLatencyAnomalies({ current: route, previous });
					if (rules.length === 0) {
						return [];
					}
					const baseline = latencyBaseline(previous);
					if (baseline === undefined) {
						return [];
					}

					return [
						{
							fingerprint: `latency:${route.route}`,
							kind: "latency",
							title: `Latency regression on ${route.route}`,
							evidence: `${route.sampleCount} requests across ${previous.length} baseline windows. Current vs baseline: p50 ${milliseconds(route.p50)} / ${milliseconds(baseline.p50)}, p90 ${milliseconds(route.p90)} / ${milliseconds(baseline.p90)}, p99 ${milliseconds(route.p99)} / ${milliseconds(baseline.p99)}.`,
							ruleIds: rules.map(({ id }) => id),
						} satisfies IssueCandidate,
					];
				});
				const candidates = [
					...errorCandidates.filter(
						(candidate): candidate is IssueCandidate =>
							candidate !== undefined,
					),
					...latencyCandidates,
				];
				const check: MonitoringCheck = {
					id: crypto.randomUUID(),
					from: errors.from,
					to: errors.to,
					errorCount,
					latency,
					status:
						candidates.length > 0
							? "anomaly"
							: errorCount === 0
								? "healthy"
								: "errors",
					matchedRuleIds: Array.from(
						new Set(candidates.flatMap(({ ruleIds }) => ruleIds)),
					),
				};
				yield* saveCheck(this.ctx.storage.sql, check);
				yield* saveIssueObservations(
					this.ctx.storage.sql,
					check.id,
					errorGroups.map(({ fingerprint, count }) => ({
						fingerprint,
						value: count,
					})),
				);

				const triaged = yield* Effect.forEach(candidates, (candidate) =>
					triageIssue(this.ctx.storage.sql, candidate, errors.to),
				);
				yield* resolveInactiveIssues(
					this.ctx.storage.sql,
					candidates.map(({ fingerprint }) => fingerprint),
					errors.to,
				);
				const actionable = triaged.filter(
					({ shouldInvestigate }) => shouldInvestigate,
				);

				if (actionable.length === 0) {
					return check;
				}

				yield* Effect.forEach(
					actionable,
					({ issue }) =>
						Effect.gen(this, function* () {
							const userMessage = `Issue ${issue.status === "open" && issue.reopenCount > 0 ? "reopened" : "detected"}: ${issue.title}. ${issue.latestEvidence}. Rules: ${issue.ruleIds.join(", ")}. Investigate this issue, explain the evidence, and state the likely cause only if the telemetry supports one.`;
							const history = issue.messages
								.slice(-20)
								.map(({ role, content }) => ({ role, content }));
							const response = yield* runAgent(
								this.env,
								[
									systemMessage(workerName),
									...history,
									{ role: "user", content: userMessage },
								],
								workerName,
								window,
								0,
							);
							yield* saveIssueInvestigation(
								this.ctx.storage.sql,
								issue.id,
								userMessage,
								response,
								errors.to,
							);
						}),
					{ concurrency: "unbounded" },
				);
				yield* markCheckInvestigated(this.ctx.storage.sql, check.id);

				return { ...check, status: "investigated" };
			}),
		);
	}

	async getState(workerName: string): Promise<MonitoringState> {
		return Effect.runPromise(
			Effect.all({
				checks: loadChecks(this.ctx.storage.sql),
				issues: loadIssues(this.ctx.storage.sql),
			}).pipe(
				Effect.map(({ checks, issues }) => ({
					workerName,
					checks,
					issues,
					rules: anomalyRuleInfo,
				})),
			),
		);
	}
}
