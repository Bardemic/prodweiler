import { Duration, Effect, Logger } from "effect";

const LoggerLive = Logger.replace(
	Logger.defaultLogger,
	Logger.withLeveledConsole(Logger.structuredLogger),
);

const handleRequest = (request: Request) =>
	Effect.gen(function* () {
		const url = new URL(request.url);
		const shouldFail = url.pathname === "/error";
		const response = Response.json(
			{ service: "prodweiler-demo", ok: !shouldFail },
			{ status: shouldFail ? 500 : 200 },
		);
		const logRequest = shouldFail
			? Effect.logError("database connection timed out")
			: Effect.logInfo("request.completed");

		yield* logRequest.pipe(
			Effect.delay(Duration.millis(Math.random() * 1_000)),
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
