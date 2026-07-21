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

export class ProdweilerApi extends HttpApi.make("ProdweilerApi")
	.add(AppGroup)
	.add(WorkersGroup)
	.prefix("/api") {}
