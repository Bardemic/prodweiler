import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
} from "@effect/platform";
import { Schema } from "effect";

export const CloudflareWorker = Schema.Struct({
	id: Schema.String,
});
export type CloudflareWorker = typeof CloudflareWorker.Type;

export const MonitoredWorker = Schema.Struct({
	id: Schema.String,
	workerName: Schema.String,
	createdAt: Schema.String,
	lastCheckedAt: Schema.NullOr(Schema.String),
});
export type MonitoredWorker = typeof MonitoredWorker.Type;

export const CloudflareWorkersResponse = Schema.Array(CloudflareWorker);
export type CloudflareWorkersResponse =
	typeof CloudflareWorkersResponse.Type;

export const MonitoredWorkersResponse = Schema.Array(MonitoredWorker);
export type MonitoredWorkersResponse =
	typeof MonitoredWorkersResponse.Type;

export const AddMonitoredWorkerRequest = Schema.Struct({
	workerName: Schema.String.pipe(Schema.minLength(1)),
});
export type AddMonitoredWorkerRequest =
	typeof AddMonitoredWorkerRequest.Type;

export const MonitoringCheckStatus = Schema.Literal(
	"healthy",
	"errors",
	"anomaly",
	"investigated",
);
export type MonitoringCheckStatus = typeof MonitoringCheckStatus.Type;

export const RouteLatency = Schema.Struct({
	route: Schema.String,
	sampleCount: Schema.Number,
	p50: Schema.Number,
	p90: Schema.Number,
	p99: Schema.Number,
});
export type RouteLatency = typeof RouteLatency.Type;

export const MonitoringCheck = Schema.Struct({
	id: Schema.String,
	from: Schema.String,
	to: Schema.String,
	errorCount: Schema.Number,
	latency: Schema.Array(RouteLatency),
	status: MonitoringCheckStatus,
	matchedRuleIds: Schema.Array(Schema.String),
});
export type MonitoringCheck = typeof MonitoringCheck.Type;

export const IssueKind = Schema.Literal("errors", "latency");
export type IssueKind = typeof IssueKind.Type;

export const IssueStatus = Schema.Literal("open", "resolved");
export type IssueStatus = typeof IssueStatus.Type;

export const IssueMessage = Schema.Struct({
	id: Schema.Number,
	role: Schema.Literal("user", "assistant"),
	content: Schema.String,
	createdAt: Schema.String,
});
export type IssueMessage = typeof IssueMessage.Type;

export const MonitoringIssue = Schema.Struct({
	id: Schema.String,
	fingerprint: Schema.String,
	kind: IssueKind,
	title: Schema.String,
	status: IssueStatus,
	firstSeenAt: Schema.String,
	lastSeenAt: Schema.String,
	resolvedAt: Schema.NullOr(Schema.String),
	occurrenceCount: Schema.Number,
	reopenCount: Schema.Number,
	lastInvestigatedAt: Schema.NullOr(Schema.String),
	latestEvidence: Schema.String,
	ruleIds: Schema.Array(Schema.String),
	messages: Schema.Array(IssueMessage),
});
export type MonitoringIssue = typeof MonitoringIssue.Type;

export const AnomalyRuleInfo = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	description: Schema.String,
});
export type AnomalyRuleInfo = typeof AnomalyRuleInfo.Type;

export const MonitoringStateRequest = Schema.Struct({
	workerName: Schema.String.pipe(Schema.minLength(1)),
});

export const MonitoringState = Schema.Struct({
	workerName: Schema.String,
	checks: Schema.Array(MonitoringCheck),
	issues: Schema.Array(MonitoringIssue),
	rules: Schema.Array(AnomalyRuleInfo),
});
export type MonitoringState = typeof MonitoringState.Type;

export class CloudflareApiError extends Schema.TaggedError<CloudflareApiError>()(
	"CloudflareApiError",
	{ error: Schema.String },
) {}

export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
	"DatabaseError",
	{ error: Schema.String },
) {}

export class AlreadyMonitoredError extends Schema.TaggedError<AlreadyMonitoredError>()(
	"AlreadyMonitoredError",
	{ error: Schema.String },
) {}

export class WorkerNotFoundError extends Schema.TaggedError<WorkerNotFoundError>()(
	"WorkerNotFoundError",
	{ error: Schema.String },
) {}

export class AgentError extends Schema.TaggedError<AgentError>()(
	"AgentError",
	{ error: Schema.String },
) {}

const AppGroup = HttpApiGroup.make("app", { topLevel: true }).add(
	HttpApiEndpoint.get("info", "/").addSuccess(
		Schema.Struct({ name: Schema.Literal("Prodweiler") }),
	),
);

const WorkersGroup = HttpApiGroup.make("workers", { topLevel: true })
	.add(
		HttpApiEndpoint.get("listCloudflare", "/cloudflare/workers")
			.addSuccess(CloudflareWorkersResponse)
			.addError(CloudflareApiError, { status: 502 })
	)
	.add(
		HttpApiEndpoint.get("listMonitored", "/monitored-workers")
			.addSuccess(MonitoredWorkersResponse)
			.addError(DatabaseError, { status: 500 }),
	)
	.add(
		HttpApiEndpoint.post("addMonitored", "/monitored-workers")
			.setPayload(AddMonitoredWorkerRequest)
			.addSuccess(MonitoredWorker, { status: 201 })
			.addError(WorkerNotFoundError, { status: 400 })
			.addError(AlreadyMonitoredError, { status: 409 })
			.addError(CloudflareApiError, { status: 502 })
			.addError(DatabaseError, { status: 500 }),
	);

const MonitoringGroup = HttpApiGroup.make("monitoring", { topLevel: true }).add(
	HttpApiEndpoint.get("state", "/monitoring")
		.setUrlParams(MonitoringStateRequest)
		.addSuccess(MonitoringState)
		.addError(WorkerNotFoundError, { status: 400 })
		.addError(DatabaseError, { status: 500 })
		.addError(AgentError, { status: 500 }),
);

export class ProdweilerApi extends HttpApi.make("ProdweilerApi")
	.add(AppGroup)
	.add(WorkersGroup)
	.add(MonitoringGroup)
	.prefix("/api") {}
