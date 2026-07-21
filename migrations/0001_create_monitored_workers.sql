CREATE TABLE monitored_workers (
	id TEXT PRIMARY KEY,
	worker_name TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL,
	last_checked_at TEXT
);
