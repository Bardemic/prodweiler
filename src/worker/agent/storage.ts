import { Effect, Schema } from "effect";
import {
	AgentError,
	IssueMessage,
	MonitoringIssue,
	RouteLatency,
	type IssueKind,
	type MonitoringCheck,
} from "../../shared/contracts";

export type IssueCandidate = {
	readonly fingerprint: string;
	readonly kind: IssueKind;
	readonly title: string;
	readonly evidence: string;
	readonly ruleIds: ReadonlyArray<string>;
};

const StoredCheck = Schema.Struct({
	id: Schema.String,
	from: Schema.String,
	to: Schema.String,
	errorCount: Schema.Number,
	latency: Schema.parseJson(Schema.Array(RouteLatency)),
	status: Schema.Union(
		Schema.Literal("healthy"),
		Schema.Literal("errors"),
		Schema.Literal("anomaly"),
		Schema.Literal("investigated"),
	),
	matchedRuleIds: Schema.String,
});

const StoredIssue = Schema.Struct({
	id: Schema.String,
	fingerprint: Schema.String,
	kind: Schema.Literal("errors", "latency"),
	title: Schema.String,
	status: Schema.Literal("open", "resolved"),
	firstSeenAt: Schema.String,
	lastSeenAt: Schema.String,
	resolvedAt: Schema.NullOr(Schema.String),
	occurrenceCount: Schema.Number,
	reopenCount: Schema.Number,
	lastInvestigatedAt: Schema.NullOr(Schema.String),
	latestEvidence: Schema.String,
	ruleIds: Schema.String,
});

const IssueObservation = Schema.Struct({
	checkId: Schema.String,
	errorCount: Schema.Number,
});

const storageError = (error: unknown) =>
	new AgentError({ error: String(error) });

export const initializeAgentStorage = (sql: SqlStorage) => {
	sql.exec(`
		CREATE TABLE IF NOT EXISTS checks (
			id TEXT PRIMARY KEY,
			from_time TEXT NOT NULL,
			to_time TEXT NOT NULL,
			error_count INTEGER NOT NULL,
			latency_json TEXT NOT NULL DEFAULT '[]',
			status TEXT NOT NULL,
			matched_rule_ids TEXT NOT NULL
		)
	`);

	const checkColumns = Array.from(
		sql.exec<{ name: string }>("PRAGMA table_info(checks)"),
	).map(({ name }) => name);
	if (!checkColumns.includes("latency_json")) {
		sql.exec(
			"ALTER TABLE checks ADD COLUMN latency_json TEXT NOT NULL DEFAULT '[]'",
		);
	}

	sql.exec(`
		CREATE TABLE IF NOT EXISTS issue_observations (
			check_id TEXT NOT NULL,
			fingerprint TEXT NOT NULL,
			value INTEGER NOT NULL,
			PRIMARY KEY (check_id, fingerprint)
		)
	`);

	sql.exec(`
		CREATE TABLE IF NOT EXISTS issues (
			id TEXT PRIMARY KEY,
			fingerprint TEXT UNIQUE NOT NULL,
			kind TEXT NOT NULL,
			title TEXT NOT NULL,
			status TEXT NOT NULL,
			first_seen_at TEXT NOT NULL,
			last_seen_at TEXT NOT NULL,
			resolved_at TEXT,
			occurrence_count INTEGER NOT NULL,
			reopen_count INTEGER NOT NULL,
			last_investigated_at TEXT,
			latest_evidence TEXT NOT NULL,
			rule_ids TEXT NOT NULL
		)
	`);

	sql.exec(`
		CREATE TABLE IF NOT EXISTS issue_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			issue_id TEXT NOT NULL,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at TEXT NOT NULL
		)
	`);
};

export const loadChecks = (sql: SqlStorage) =>
	Effect.try({
		try: () =>
			Array.from(
				sql.exec(
					`SELECT id,
					from_time AS "from",
					to_time AS "to",
					error_count AS errorCount,
					latency_json AS latency,
					status,
					matched_rule_ids AS matchedRuleIds
				 FROM checks
				 ORDER BY to_time DESC
				 LIMIT 1008`,
				),
			).reverse(),
		catch: storageError,
	}).pipe(
		Effect.flatMap(Schema.decodeUnknown(Schema.Array(StoredCheck))),
		Effect.mapError((error) => storageError(error.message)),
		Effect.map((checks) =>
			checks.map(
				({ matchedRuleIds, ...check }): MonitoringCheck => ({
					...check,
					matchedRuleIds:
						matchedRuleIds === "" ? [] : matchedRuleIds.split(","),
				}),
			),
		),
	);

export const saveCheck = (sql: SqlStorage, check: MonitoringCheck) =>
	Effect.try({
		try: () => {
			sql.exec(
				`INSERT INTO checks
			 (id, from_time, to_time, error_count, latency_json, status, matched_rule_ids)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				check.id,
				check.from,
				check.to,
				check.errorCount,
				JSON.stringify(check.latency),
				check.status,
				check.matchedRuleIds.join(","),
			);
		},
		catch: storageError,
	});

export const markCheckInvestigated = (sql: SqlStorage, checkId: string) =>
	Effect.try({
		try: () =>
			sql.exec(
				"UPDATE checks SET status = 'investigated' WHERE id = ?",
				checkId,
			),
		catch: storageError,
	});

export const loadPreviousIssueObservations = (
	sql: SqlStorage,
	fingerprint: string,
) =>
	Effect.try({
		try: () =>
			Array.from(
				sql.exec(
					`SELECT checks.id AS checkId,
				        COALESCE(observation.value, 0) AS errorCount
				 FROM checks
				 LEFT JOIN issue_observations AS observation
				   ON observation.check_id = checks.id
				  AND observation.fingerprint = ?
				 WHERE checks.status IN ('healthy', 'errors')
				 ORDER BY checks.to_time DESC
				 LIMIT 1008`,
					fingerprint,
				),
			),
		catch: storageError,
	}).pipe(
		Effect.flatMap(Schema.decodeUnknown(Schema.Array(IssueObservation))),
		Effect.mapError((error) => storageError(error.message)),
	);

export const saveIssueObservations = (
	sql: SqlStorage,
	checkId: string,
	observations: ReadonlyArray<{
		readonly fingerprint: string;
		readonly value: number;
	}>,
) =>
	Effect.forEach(observations, ({ fingerprint, value }) =>
		Effect.try({
			try: () =>
				sql.exec(
					`INSERT INTO issue_observations (check_id, fingerprint, value)
				 VALUES (?, ?, ?)`,
					checkId,
					fingerprint,
					value,
				),
			catch: storageError,
		}),
	);

const loadStoredIssue = (sql: SqlStorage, fingerprint: string) =>
	Effect.try({
		try: () =>
			Array.from(
				sql.exec(
					`SELECT id,
					fingerprint,
					kind,
					title,
					status,
					first_seen_at AS firstSeenAt,
					last_seen_at AS lastSeenAt,
					resolved_at AS resolvedAt,
					occurrence_count AS occurrenceCount,
					reopen_count AS reopenCount,
					last_investigated_at AS lastInvestigatedAt,
					latest_evidence AS latestEvidence,
					rule_ids AS ruleIds
				 FROM issues
				 WHERE fingerprint = ?`,
					fingerprint,
				),
			),
		catch: storageError,
	}).pipe(
		Effect.flatMap(Schema.decodeUnknown(Schema.Array(StoredIssue))),
		Effect.mapError((error) => storageError(error.message)),
		Effect.map((rows) => rows[0]),
	);

const issueFromStored = (
	issue: typeof StoredIssue.Type,
	messages: ReadonlyArray<IssueMessage>,
): MonitoringIssue => ({
	...issue,
	ruleIds: issue.ruleIds === "" ? [] : issue.ruleIds.split(","),
	messages: [...messages],
});

export const loadIssueMessages = (sql: SqlStorage, issueId: string) =>
	Effect.try({
		try: () =>
			Array.from(
				sql.exec(
					`SELECT id, role, content, created_at AS createdAt
				 FROM issue_messages
				 WHERE issue_id = ?
				 ORDER BY id ASC`,
					issueId,
				),
			),
		catch: storageError,
	}).pipe(
		Effect.flatMap(Schema.decodeUnknown(Schema.Array(IssueMessage))),
		Effect.mapError((error) => storageError(error.message)),
	);

export const triageIssue = (
	sql: SqlStorage,
	candidate: IssueCandidate,
	observedAt: string,
) =>
	Effect.gen(function* () {
		const existing = yield* loadStoredIssue(sql, candidate.fingerprint);
		if (existing === undefined) {
			const issue: MonitoringIssue = {
				id: crypto.randomUUID(),
				...candidate,
				ruleIds: [...candidate.ruleIds],
				status: "open",
				firstSeenAt: observedAt,
				lastSeenAt: observedAt,
				resolvedAt: null,
				occurrenceCount: 1,
				reopenCount: 0,
				lastInvestigatedAt: null,
				latestEvidence: candidate.evidence,
				messages: [],
			};
			yield* Effect.try({
				try: () =>
					sql.exec(
						`INSERT INTO issues
					 (id, fingerprint, kind, title, status, first_seen_at, last_seen_at,
					  resolved_at, occurrence_count, reopen_count, last_investigated_at,
					  latest_evidence, rule_ids)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						issue.id,
						issue.fingerprint,
						issue.kind,
						issue.title,
						issue.status,
						issue.firstSeenAt,
						issue.lastSeenAt,
						issue.resolvedAt,
						issue.occurrenceCount,
						issue.reopenCount,
						issue.lastInvestigatedAt,
						issue.latestEvidence,
						issue.ruleIds.join(","),
					),
				catch: storageError,
			});

			return { issue, shouldInvestigate: true } as const;
		}

		const reopened = existing.status === "resolved";
		yield* Effect.try({
			try: () =>
				sql.exec(
					`UPDATE issues
				 SET status = 'open',
				     title = ?,
				     last_seen_at = ?,
				     resolved_at = NULL,
				     occurrence_count = occurrence_count + 1,
				     reopen_count = reopen_count + ?,
				     latest_evidence = ?,
				     rule_ids = ?
				 WHERE id = ?`,
					candidate.title,
					observedAt,
					reopened ? 1 : 0,
					candidate.evidence,
					candidate.ruleIds.join(","),
					existing.id,
				),
			catch: storageError,
		});

		const messages = yield* loadIssueMessages(sql, existing.id);
		return {
			issue: issueFromStored(
				{
					...existing,
					title: candidate.title,
					status: "open",
					lastSeenAt: observedAt,
					resolvedAt: null,
					occurrenceCount: existing.occurrenceCount + 1,
					reopenCount: existing.reopenCount + (reopened ? 1 : 0),
					latestEvidence: candidate.evidence,
					ruleIds: candidate.ruleIds.join(","),
				},
				messages,
			),
			shouldInvestigate:
				reopened || existing.lastInvestigatedAt === null,
		} as const;
	});

export const resolveInactiveIssues = (
	sql: SqlStorage,
	activeFingerprints: ReadonlyArray<string>,
	resolvedAt: string,
) =>
	Effect.try({
		try: () => {
			if (activeFingerprints.length === 0) {
				sql.exec(
					`UPDATE issues
				 SET status = 'resolved', resolved_at = ?
				 WHERE status = 'open'`,
					resolvedAt,
				);
				return;
			}

			const placeholders = activeFingerprints.map(() => "?").join(", ");
			sql.exec(
				`UPDATE issues
			 SET status = 'resolved', resolved_at = ?
			 WHERE status = 'open'
			   AND fingerprint NOT IN (${placeholders})`,
				resolvedAt,
				...activeFingerprints,
			);
		},
		catch: storageError,
	});

export const saveIssueInvestigation = (
	sql: SqlStorage,
	issueId: string,
	userMessage: string,
	response: string,
	createdAt: string,
) =>
	Effect.try({
		try: () => {
			sql.exec(
				`INSERT INTO issue_messages (issue_id, role, content, created_at)
			 VALUES (?, 'user', ?, ?)`,
				issueId,
				userMessage,
				createdAt,
			);
			sql.exec(
				`INSERT INTO issue_messages (issue_id, role, content, created_at)
			 VALUES (?, 'assistant', ?, ?)`,
				issueId,
				response,
				createdAt,
			);
			sql.exec(
				"UPDATE issues SET last_investigated_at = ? WHERE id = ?",
				createdAt,
				issueId,
			);
		},
		catch: storageError,
	});

export const loadIssues = (sql: SqlStorage) =>
	Effect.try({
		try: () =>
			Array.from(
				sql.exec(
					`SELECT id,
					fingerprint,
					kind,
					title,
					status,
					first_seen_at AS firstSeenAt,
					last_seen_at AS lastSeenAt,
					resolved_at AS resolvedAt,
					occurrence_count AS occurrenceCount,
					reopen_count AS reopenCount,
					last_investigated_at AS lastInvestigatedAt,
					latest_evidence AS latestEvidence,
					rule_ids AS ruleIds
				 FROM issues
				 ORDER BY last_seen_at DESC`,
				),
			),
		catch: storageError,
	}).pipe(
		Effect.flatMap(Schema.decodeUnknown(Schema.Array(StoredIssue))),
		Effect.mapError((error) => storageError(error.message)),
		Effect.flatMap((issues) =>
			Effect.forEach(issues, (issue) =>
				loadIssueMessages(sql, issue.id).pipe(
					Effect.map((messages) => issueFromStored(issue, messages)),
				),
			),
		),
	);
