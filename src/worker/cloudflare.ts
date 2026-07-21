import { Effect, Schema } from "effect";
import {
    CloudflareApiError,
	CloudflareWorker,
} from "../shared/contracts";

const CloudflareListWorkersApiResponse = Schema.Struct({
	success: Schema.Literal(true),
	result: Schema.Array(
		CloudflareWorker,
	),
});


const parseCloudflareListWorkers = Schema.decodeUnknown(CloudflareListWorkersApiResponse);

export const listCloudflareWorkers = (env: Cloudflare.Env) =>
	Effect.gen(function* () {
        const fetchWorkers = yield* Effect.tryPromise(() => 
            fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`, {
                headers: {
                    Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
                },
            }).then((response) => response.json())
        ).pipe(
            Effect.catchTag("UnknownException", (error) => Effect.fail(new CloudflareApiError({ error: error.message }))),
        )

		return (
			yield* parseCloudflareListWorkers(fetchWorkers).pipe(
				Effect.catchTag("ParseError", (error) => Effect.fail(new CloudflareApiError({ error: error.message }))),
			)
		).result;
	});
