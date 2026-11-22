-- Tenants of the studio (Cloudflare D1). One organisation rents the product; it owns events; people join it with a role.
-- Every row an organisation can reach carries its org_id, and every query filters by it: no event is ever read across organisations.
CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, plan TEXT NOT NULL DEFAULT 'trial',
  events_limit INTEGER NOT NULL DEFAULT 1, storage_limit_mb INTEGER NOT NULL DEFAULT 2000, paid_until TEXT, created_at TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,   -- activation days bought and not yet used: building and rehearsing are free, a credit opens the screens of one event for one day
  features TEXT NOT NULL DEFAULT '');   -- features opened by the platform owner, words: 'stations' (the interactive stations)
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, created_at TEXT NOT NULL, pw TEXT);   -- pw: "salt:hash" (PBKDF2), when the member signs in by password
-- role in the organisation: owner (billing, members), editor (builds events), operator (runs them), viewer
CREATE TABLE members (org_id TEXT NOT NULL REFERENCES orgs(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY (org_id, user_id));
-- An organisation's own data (events, versions, files index, screen links, audit) is NOT here: each organisation has its own
-- database (worker/tenant.js), so its rows never share a table with another organisation's.
-- sign in by a link sent to the email; sessions are stored hashed
CREATE TABLE login_codes (code_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passkeys (cred_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), spki TEXT NOT NULL, alg INTEGER NOT NULL, label TEXT, created_at TEXT NOT NULL, last_used_at TEXT);
CREATE TABLE IF NOT EXISTS challenges (challenge TEXT PRIMARY KEY, user_id TEXT, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_fail (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, until TEXT);
CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, org TEXT, phone TEXT, email TEXT, kind TEXT, event_date TEXT, message TEXT, ip TEXT, created_at TEXT NOT NULL, handled_at TEXT, mailed INTEGER NOT NULL DEFAULT 0);
-- what the platform owner did, for the owner's own page
CREATE TABLE IF NOT EXISTS platform_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
-- a screen waiting to be paired by its code (the operator types it on the stations' board); ten minutes, then gone. No content of any organisation
CREATE TABLE IF NOT EXISTS pairs (code TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, ip TEXT, go TEXT, created_at TEXT NOT NULL);
