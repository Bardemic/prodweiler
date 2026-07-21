import { Effect, Schema } from "effect";
import { CloudflareApiError, CloudflareWorker } from "../shared/contracts";

const CloudflareListWorkersApiResponse = Schema.Struct({
	success: Schema.Literal(true),
	result: Schema.Array(CloudflareWorker),
});


const parseCloudflareListWorkers = Schema.decodeUnknown(CloudflareListWorkersApiResponse);

export const listCloudflareWorkers = (env: Cloudflare.Env) =>
	Effect.gen(function* () {
		const fetchWorkers = yield* Effect.tryPromise(() =>
		    fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`, {
				headers: {
					Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
				},
			}),
		).pipe(
			Effect.catchTag("UnknownException", (error) =>
				Effect.fail(new CloudflareApiError({ error: error.message })),
			),
		);

		if (!fetchWorkers.ok) {
			return yield* Effect.fail(
				new CloudflareApiError({
					error: `Cloudflare returned ${fetchWorkers.status} ${fetchWorkers.statusText}`,
				}),
			);
		}

		const body = yield* Effect.tryPromise(() => fetchWorkers.json()).pipe(
			Effect.catchTag("UnknownException", (error) =>
				Effect.fail(new CloudflareApiError({ error: error.message })),
			),
		);

		return (
			yield* parseCloudflareListWorkers(body).pipe(
				Effect.mapError(
					(error) => new CloudflareApiError({ error: error.message }),
				),
			)
		).result;
	});
