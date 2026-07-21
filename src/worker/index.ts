import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import {
	ProdweilerApi,
	WorkerNotFoundError,
} from "../shared/contracts";
import { listCloudflareWorkers } from "./cloudflare";
import {
	addMonitoredWorker,
	listMonitoredWorkers,
} from "./monitored-workers";

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

const HandlersLive = Layer.mergeAll(AppLive, WorkersLive);

const ApiLive = HttpApiBuilder.api(ProdweilerApi).pipe(
	Layer.provide(HandlersLive),
);

const { handler } = HttpApiBuilder.toWebHandler(
	Layer.mergeAll(ApiLive, HttpServer.layerContext),
);

export default {
	fetch(request) {
		return handler(request);
	},
} satisfies ExportedHandler<Env>;
