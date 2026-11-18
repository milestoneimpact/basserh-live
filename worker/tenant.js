// One database per organisation: a Durable Object with its own SQLite file. An organisation's events, versions, files index,
// screen links and audit trail live here and nowhere else; no query can reach another organisation's rows because they are
// not in the same database. Created by itself the first time the organisation is used. The control database (D1) keeps only
// who the organisations and the people are.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  draft TEXT NOT NULL, published_version INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, active_from TEXT, active_until TEXT);
CREATE TABLE IF NOT EXISTS event_versions (event_id TEXT NOT NULL, version INTEGER NOT NULL, doc TEXT NOT NULL, published_by TEXT, published_at TEXT NOT NULL, PRIMARY KEY (event_id, version));
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, event_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, r2_key TEXT NOT NULL, preview_key TEXT, bytes INTEGER NOT NULL, length REAL, count INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS links (token_hash TEXT PRIMARY KEY, org_id TEXT NOT NULL, event_id TEXT NOT NULL, role TEXT NOT NULL, label TEXT, revoked_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, event_id TEXT, user_id TEXT, action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS media_event ON media(event_id); CREATE INDEX IF NOT EXISTS links_event ON links(event_id);`;
export class Tenant {
  constructor(ctx) { this.sql = ctx.storage.sql; this.ctx = ctx; this.sql.exec(SCHEMA); }
  async fetch(req) {   // { statements: [{ sql, params }] }: all of them in one transaction; rows of each
    const path = new URL(req.url).pathname;
    // the whole database as data (export, backup); and its end (the organisation is deleted)
    if (path === '/dump') return Response.json(Object.fromEntries(['events', 'event_versions', 'media', 'links', 'audit'].map(t => [t, this.sql.exec(`SELECT * FROM ${t}`).toArray()])));
    if (path === '/wipe') { await this.ctx.storage.deleteAll(); return Response.json({ ok: true }); }
    const { statements } = await req.json();
    try { const out = this.ctx.storage.transactionSync(() => statements.map(s => this.sql.exec(s.sql, ...(s.params || [])).toArray())); return Response.json({ out }); }
    catch (e) { return Response.json({ error: String(e && e.message || e) }, { status: 500 }); }
  }
}
// the same calls as D1 (prepare, bind, first, all, run, batch), against the organisation's own database
export function tdb(env, orgId) {
  const stub = env.TENANT.get(env.TENANT.idFromName(orgId));
  const send = async statements => { const r = await stub.fetch('https://tenant/sql', { method: 'POST', body: JSON.stringify({ statements }) }), j = await r.json(); if (j.error) throw new Error(j.error); return j.out; };
  const stmt = (sql, params = []) => ({ sql, params, bind: (...p) => stmt(sql, p.map(v => (v === undefined ? null : v))), first: async () => (await send([{ sql, params }]))[0][0] || null, all: async () => ({ results: (await send([{ sql, params }]))[0] }), run: async () => { await send([{ sql, params }]); return { success: true }; } });
  return { prepare: sql => stmt(sql), batch: list => send(list.map(s => ({ sql: s.sql, params: s.params }))), dump: () => stub.fetch('https://tenant/dump').then(r => r.json()), wipe: () => stub.fetch('https://tenant/wipe', { method: 'POST' }).then(r => r.json()) };
}
// the organisation is written into every event id and every screen link, so a request finds its database without a shared index
export const orgOfEvent = id => 'o_' + String(id).slice(2, 14);
