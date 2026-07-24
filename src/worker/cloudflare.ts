import { Effect, Schema } from "effect";
import {
	CloudflareApiError,
	CloudflareWorker,
	RouteLatency,
} from "../shared/contracts";

const CloudflareListWorkersApiResponse = Schema.Struct({
	success: Schema.Literal(true),
	result: Schema.Array(CloudflareWorker),
});

const CloudflareTelemetryEvent = Schema.Struct({
	"$metadata": Schema.Struct({
		id: Schema.String,
		duration: Schema.optional(Schema.Number),
		error: Schema.optional(Schema.String),
		errorTemplate: Schema.optional(Schema.String),
		fingerprint: Schema.optional(Schema.String),
		level: Schema.optional(Schema.String),
		message: Schema.optional(Schema.String),
		messageTemplate: Schema.optional(Schema.String),
		requestId: Schema.optional(Schema.String),
		statusCode: Schema.optional(Schema.Number),
		traceDuration: Schema.optional(Schema.Number),
		trigger: Schema.optional(Schema.String),
		type: Schema.optional(Schema.String),
		url: Schema.optional(Schema.String),
	}),
	timestamp: Schema.Number,
	"$workers": Schema.optional(
		Schema.Struct({
			outcome: Schema.optional(Schema.String),
		}),
	),
});

export type WorkerTelemetryEvent = typeof CloudflareTelemetryEvent.Type;

const CloudflareTelemetryQueryResponse = Schema.Struct({
	success: Schema.Literal(true),
	result: Schema.Struct({
		events: Schema.Struct({
			count: Schema.Number,
			events: Schema.Array(CloudflareTelemetryEvent),
		}),
	}),
});

const CloudflareCalculationAggregate = Schema.Struct({
	count: Schema.Number,
	value: Schema.Number,
	groups: Schema.Array(
		Schema.Struct({
			key: Schema.String,
			value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
		}),
	),
});

const CloudflareTelemetryCalculationsResponse = Schema.Struct({
	success: Schema.Literal(true),
	result: Schema.Struct({
		calculations: Schema.Array(
			Schema.Struct({
				alias: Schema.String,
				aggregates: Schema.Array(CloudflareCalculationAggregate),
			}),
		),
	}),
});

const parseCloudflareListWorkers = Schema.decodeUnknown(CloudflareListWorkersApiResponse);
const parseCloudflareTelemetryQuery = Schema.decodeUnknown(CloudflareTelemetryQueryResponse);
const parseCloudflareTelemetryCalculations = Schema.decodeUnknown(
	CloudflareTelemetryCalculationsResponse,
);

const cloudflareApiError = (error: unknown) =>
	new CloudflareApiError({ error: String(error) });

const cloudflareRequest = (
	env: Cloudflare.Env,
	path: string,
	init?: RequestInit,
) =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(
					`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`,
					{
						...init,
						headers: {
							Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
							...init?.headers,
						},
					},
				),
			catch: cloudflareApiError,
		});

		if (!response.ok) {
			return yield* Effect.fail(
				new CloudflareApiError({
					error: `Cloudflare returned ${response.status} ${response.statusText}`,
				}),
			);
		}

		return yield* Effect.tryPromise({
			try: () => response.json(),
			catch: cloudflareApiError,
		});
	});

const queryTelemetry = (env: Cloudflare.Env, query: unknown) =>
	cloudflareRequest(env, "/workers/observability/telemetry/query", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(query),
	});

const workerFilter = (workerName: string) => ({
	key: "$metadata.service",
	operation: "eq",
	type: "string",
	value: workerName,
});

export const listCloudflareWorkers = (env: Cloudflare.Env) =>
	Effect.gen(function* () {
		const body = yield* cloudflareRequest(env, "/workers/scripts");

		return (
			yield* parseCloudflareListWorkers(body).pipe(
				Effect.mapError(
					(error) => new CloudflareApiError({ error: error.message }),
				),
			)
		).result;
	});

export const listRecentWorkerErrors = (
	env: Cloudflare.Env,
	workerName: string,
	from: number,
	to: number,
) =>
	Effect.gen(function* () {
		const body = yield* queryTelemetry(env, {
			queryId: "prodweiler-agent-errors",
			timeframe: { from, to },
			dry: true,
			limit: 100,
			view: "events",
			parameters: {
				datasets: [],
				filterCombination: "and",
				filters: [
					workerFilter(workerName),
					{
						kind: "group",
						filterCombination: "or",
						filters: [
							{
								key: "$metadata.level",
								operation: "eq",
								type: "string",
								value: "error",
							},
							{
								key: "$metadata.error",
								operation: "exists",
								type: "string",
							},
						],
					},
				],
			},
		});
		const result = yield* parseCloudflareTelemetryQuery(body).pipe(
			Effect.mapError(
				(error) => new CloudflareApiError({ error: error.message }),
			),
		);

		return {
			workerName,
			from: new Date(from).toISOString(),
			to: new Date(to).toISOString(),
			errorCount: result.result.events.count,
			events: result.result.events.events,
		};
	});

export const listWorkerLatency = (
	env: Cloudflare.Env,
	workerName: string,
	from: number,
	to: number,
) =>
	Effect.gen(function* () {
		const body = yield* queryTelemetry(env, {
			queryId: "prodweiler-agent-latency",
			timeframe: { from, to },
			dry: true,
			ignoreSeries: true,
			limit: 100,
			view: "calculations",
			parameters: {
				datasets: [],
				filterCombination: "and",
				filters: [
					workerFilter(workerName),
					{
						key: "$workers.eventType",
						operation: "eq",
						type: "string",
						value: "fetch",
					},
					{
						key: "$workers.wallTimeMs",
						operation: "exists",
						type: "number",
					},
					{
						key: "$metadata.trigger",
						operation: "exists",
						type: "string",
					},
				],
				calculations: [
					{
						operator: "median",
						alias: "p50",
						key: "$workers.wallTimeMs",
						keyType: "number",
					},
					{
						operator: "p90",
						alias: "p90",
						key: "$workers.wallTimeMs",
						keyType: "number",
					},
					{
						operator: "p99",
						alias: "p99",
						key: "$workers.wallTimeMs",
						keyType: "number",
					},
				],
				groupBys: [{ type: "string", value: "$metadata.trigger" }],
			},
		});
		const result = yield* parseCloudflareTelemetryCalculations(body).pipe(
			Effect.mapError(
				(error) => new CloudflareApiError({ error: error.message }),
			),
		);
		const routes = new Map<
			string,
			{
				route: string;
				sampleCount: number;
				p50?: number;
				p90?: number;
				p99?: number;
			}
		>();

		for (const calculation of result.result.calculations) {
			for (const aggregate of calculation.aggregates) {
				const trigger = aggregate.groups.find(
					({ key }) => key === "$metadata.trigger",
				)?.value;
				if (typeof trigger !== "string") {
					return yield* Effect.fail(
						new CloudflareApiError({
							error: "Cloudflare returned latency without a request trigger",
						}),
					);
				}

				const route = routes.get(trigger) ?? {
					route: trigger,
					sampleCount: aggregate.count,
				};
				if (
					calculation.alias === "p50" ||
					calculation.alias === "p90" ||
					calculation.alias === "p99"
				) {
					route[calculation.alias] = aggregate.value;
				}
				routes.set(trigger, route);
			}
		}

		return yield* Effect.forEach(routes.values(), (route) =>
			Schema.decodeUnknown(RouteLatency)(route).pipe(
				Effect.mapError(
					(error) => new CloudflareApiError({ error: error.message }),
				),
			),
		);
	});
