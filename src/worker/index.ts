import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import {
	AgentError,
	ProdweilerApi,
	WorkerNotFoundError,
} from "../shared/contracts";
import { listCloudflareWorkers } from "./cloudflare";
import {
	addMonitoredWorker,
	listMonitoredWorkers,
	markMonitoredWorkerChecked,
} from "./monitored-workers";

export { ProdweilerAgent } from "./agent";

const AppLive = HttpApiBuilder.group(ProdweilerApi, "app", (handlers) =>
	handlers.handle("info", () => Effect.succeed({ name: "Prodweiler" as const })),
);

const WorkersLive = HttpApiBuilder.group(
	ProdweilerApi,
	"workers",
	(handlers) =>
		handlers
			.handle("listCloudflare", () => listCloudflareWorkers(env))
			.handle("listMonitored", () => listMonitoredWorkers(env.DB))
			.handle("addMonitored", ({ payload: { workerName } }) =>
				Effect.gen(function* () {
					const workers = yield* listCloudflareWorkers(env); // individual search later
					if (!workers.some((worker) => worker.id === workerName)) {
						return yield* Effect.fail(
							new WorkerNotFoundError({
								error: `${workerName} was not found in this Cloudflare account`,
							}),
						);
					}
					return yield* addMonitoredWorker(env.DB, workerName);
				}),
			),
);

const MonitoringLive = HttpApiBuilder.group(
	ProdweilerApi,
	"monitoring",
	(handlers) =>
		handlers.handle("state", ({ urlParams: { workerName } }) =>
			Effect.gen(function* () {
				const workers = yield* listMonitoredWorkers(env.DB);
				if (!workers.some((worker) => worker.workerName === workerName)) {
					return yield* Effect.fail(
						new WorkerNotFoundError({
							error: `${workerName} is not being monitored`,
						}),
					);
				}

				return yield* Effect.tryPromise({
					try: () => env.AGENTS.getByName(workerName).getState(workerName),
					catch: (error) => new AgentError({ error: String(error) }),
				});
			}),
		),
);

const HandlersLive = Layer.mergeAll(AppLive, WorkersLive, MonitoringLive);

const ApiLive = HttpApiBuilder.api(ProdweilerApi).pipe(
	Layer.provide(HandlersLive),
);

const { handler } = HttpApiBuilder.toWebHandler(
	Layer.mergeAll(ApiLive, HttpServer.layerContext),
);

const checkMonitoredWorkers = (
	scheduledEnv: Cloudflare.Env,
	scheduledTime: number,
) =>
	Effect.gen(function* () {
		const workers = yield* listMonitoredWorkers(scheduledEnv.DB);
		yield* Effect.forEach(workers, (worker) =>
			Effect.tryPromise({
				try: () =>
					scheduledEnv.AGENTS.getByName(worker.workerName).check(
						worker.workerName,
						scheduledTime,
					),
				catch: (error) => new AgentError({ error: String(error) }),
			}).pipe(
				Effect.flatMap(() =>
					markMonitoredWorkerChecked(
						scheduledEnv.DB,
						worker.workerName,
						new Date(scheduledTime).toISOString(),
					),
				),
				Effect.annotateLogs({ workerName: worker.workerName }),
			),
		);
	});

export default {
	fetch(request) {
		return handler(request);
	},
	scheduled(controller, scheduledEnv) {
		return Effect.runPromise(
			checkMonitoredWorkers(scheduledEnv, controller.scheduledTime),
		);
	},
} satisfies ExportedHandler<Cloudflare.Env>;
