-- passkeys of the people (and of the platform owner, user «platform»), the one use challenges, and the lock after wrong passwords
CREATE TABLE IF NOT EXISTS passkeys (cred_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), spki TEXT NOT NULL, alg INTEGER NOT NULL, label TEXT, created_at TEXT NOT NULL, last_used_at TEXT);
CREATE TABLE IF NOT EXISTS challenges (challenge TEXT PRIMARY KEY, user_id TEXT, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_fail (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, until TEXT);
