-- Tenants of the studio (Cloudflare D1). One organisation rents the product; it owns events; people join it with a role.
-- Every row an organisation can reach carries its org_id, and every query filters by it: no event is ever read across organisations.
CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, plan TEXT NOT NULL DEFAULT 'trial',
  events_limit INTEGER NOT NULL DEFAULT 1, storage_limit_mb INTEGER NOT NULL DEFAULT 2000, paid_until TEXT, created_at TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0);   -- activation days bought and not yet used: building and rehearsing are free, a credit opens the screens of one event for one day
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, created_at TEXT NOT NULL);
-- role in the organisation: owner (billing, members), editor (builds events), operator (runs them), viewer
CREATE TABLE members (org_id TEXT NOT NULL REFERENCES orgs(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY (org_id, user_id));
-- An organisation's own data (events, versions, files index, screen links, audit) is NOT here: each organisation has its own
-- database (worker/tenant.js), so its rows never share a table with another organisation's.
-- sign in by a link sent to the email; sessions are stored hashed
CREATE TABLE login_codes (code_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
