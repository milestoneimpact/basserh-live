-- the interactive stations: a feature the platform owner opens per organisation, and the screens waiting to be paired by a code
-- (ten minutes each, a code, the screen's secret and the link it is handed; no content of any organisation)
ALTER TABLE orgs ADD COLUMN features TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS pairs (code TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, ip TEXT, go TEXT, created_at TEXT NOT NULL);
