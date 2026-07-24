import { Effect, Schema } from "effect";
import {
	AlreadyMonitoredError,
	DatabaseError,
	MonitoredWorker,
} from "../shared/contracts";

const MonitoredWorkersResponse = Schema.Struct({
	results: Schema.Array(MonitoredWorker),
});

const parseMonitoredWorkers = Schema.decodeUnknown(MonitoredWorkersResponse);

const databaseError = (error: unknown) =>
	new DatabaseError({ error: String(error) });

export const listMonitoredWorkers = (database: D1Database) =>
	Effect.gen(function* () {
		const fetchMonitoredWorkers = yield* Effect.tryPromise({
			try: () =>
				database
					.prepare(
						`SELECT id, worker_name AS workerName, created_at AS createdAt, last_checked_at AS lastCheckedAt
						 FROM monitored_workers
						 ORDER BY created_at ASC`,
					)
					.all(),
			catch: databaseError,
		});

		return (
			yield* parseMonitoredWorkers(fetchMonitoredWorkers).pipe(
				Effect.mapError((error) => new DatabaseError({ error: error.message })),
			)
		).results;
	});

export const addMonitoredWorker = (
	database: D1Database,
	workerName: string,
): Effect.Effect<MonitoredWorker, DatabaseError | AlreadyMonitoredError> =>
	Effect.gen(function* () {
		const newWorker = {
			id: crypto.randomUUID(),
			workerName,
			createdAt: new Date().toISOString(),
			lastCheckedAt: null,
		};
		const insertedWorker = yield* Effect.tryPromise({
			try: () =>
				database
					.prepare(
						`INSERT OR IGNORE INTO monitored_workers
						 (id, worker_name, created_at, last_checked_at)
						 VALUES (?, ?, ?, ?)`,
					)
					.bind(
						newWorker.id,
						newWorker.workerName,
						newWorker.createdAt,
						newWorker.lastCheckedAt,
					)
					.run(),
			catch: databaseError,
		});

		if (insertedWorker.meta.changes === 0) {
			return yield* Effect.fail(
				new AlreadyMonitoredError({
					error: `${workerName} is already monitored`,
				}),
			);
		}

		return newWorker;
	});

export const markMonitoredWorkerChecked = (
	database: D1Database,
	workerName: string,
	checkedAt: string,
) =>
	Effect.tryPromise({
		try: () =>
			database
				.prepare(
					"UPDATE monitored_workers SET last_checked_at = ? WHERE worker_name = ?",
				)
				.bind(checkedAt, workerName)
				.run(),
		catch: databaseError,
	});
