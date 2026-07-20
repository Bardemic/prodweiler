import { Duration, Effect, Logger } from "effect";

const LoggerLive = Logger.replace(
	Logger.defaultLogger,
	Logger.withLeveledConsole(Logger.structuredLogger),
);

const handleRequest = (request: Request) =>
	Effect.gen(function* () {
		const url = new URL(request.url);
		
		const response = Response.json({ service: "prodweiler-demo", ok: true });

		yield* Effect.logInfo("request.completed").pipe(
            Effect.delay(Duration.millis(Math.random() * 1000)),
			Effect.annotateLogs({
				service: "prodweiler-demo",
				method: request.method,
				path: url.pathname,
				status: response.status,
			}),
		);

		return response;
	}).pipe(Effect.withLogSpan("request"), Effect.provide(LoggerLive));

export default {
	fetch(request): Promise<Response> {
		return Effect.runPromise(handleRequest(request));
	},
} satisfies ExportedHandler<Env>;
