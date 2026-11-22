// Data of the platform: audit trails, the starter event, the pages from the bucket, files, the sweep, export and the daily copy.
import { platform } from './auth.js';
import { tdb } from './tenant.js';
import { now } from './util.js';

// the features the platform owner opened for an organisation (a list of words in orgs.features): 'stations' for now.
// The column is added on the first request of a worker that finds a database without it, so an older control database keeps working
export let featured = null; export const features = env => featured || (featured = Promise.all([env.DB.prepare("ALTER TABLE orgs ADD COLUMN features TEXT NOT NULL DEFAULT ''").run().catch(() => null),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS pairs (code TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, ip TEXT, go TEXT, created_at TEXT NOT NULL)').run().catch(() => null)]));
export const FEATURES = { stations: 'المحطات التفاعلية' };
export const hasFeat = (org, f) => String((org && org.features) || '').split(/[\s,]+/).includes(f);
// the key a station's QR code carries: the phone of a visitor reads that station's file, and nothing else, with no account
export const readKey = async (env, evId, sid, draft) => { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode((env.ADMIN_KEY || 'dev') + ':reader'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`read:${evId}:${sid}:${draft ? 'd' : 'l'}`)))].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join(''); };
export const audit = (env, org, ev, user, action, detail = '') => tdb(env, org).prepare('INSERT INTO audit (org_id, event_id, user_id, action, detail, at) VALUES (?,?,?,?,?,?)').bind(org, ev, user, action, detail, now()).run();
// the open connections of an organisation's events are closed: each comes back by its own right, and whoever lost it does not
export async function kickOrg(env, orgId) { try { const { results } = await tdb(env, orgId).prepare("SELECT id FROM events WHERE status != 'archived' ORDER BY updated_at DESC LIMIT 12").all(); await Promise.all(results.flatMap(e => [':live', ':draft'].map(k => env.ROOM.get(env.ROOM.idFromName(e.id + k)).fetch(new Request('https://room/kick', { method: 'POST' })).catch(() => {})))); } catch {} }
// an organisation that exists (asked of the control database once, then remembered): no database is ever opened for a made up id
export const PUB = new Map();   // the audience's answer, kept three seconds for each event
export const ORGS = new Map(); export async function orgExists(env, id) { const t = ORGS.get(id); if (t && Date.now() - t < 6e4) return true; const o = await env.DB.prepare("SELECT 1 AS x FROM orgs WHERE id = ? AND plan != 'off'").bind(id).first(); if (o) ORGS.set(id, Date.now()); return !!o; }
export const padd = (env, action, detail = '') => env.DB.prepare('INSERT INTO platform_audit (action, detail, at) VALUES (?,?,?)').bind(action, String(detail).slice(0, 300), now()).run().catch(() => {});   // the platform owner's own record
// what a new organisation finds on its first visit: a small event already laid out, to edit instead of starting from an empty page
export const STARTER = () => ({ ...BLANK('لقاؤكم الأول'), people: { p1: { name: 'اسم المتحدث', honorific: 'الصفة' } },
  cues: [{ id: 'in', type: 'loop', title: 'الاستقبال', at: 'فتح الأبواب', dur: 15, moderator: [], fixed: true },
    { id: 'open', type: 'title', title: 'الافتتاح', text: 'بسم الله الرحمن الرحيم', at: 'بسم الله الرحمن الرحيم', dur: 3, moderator: ['بسم الله الرحمن الرحيم. نرحب بكم في لقائنا، ونبدأ بكلمة الافتتاح.'] },
    { id: 'talk', type: 'speaker', title: 'كلمة الافتتاح', person: 'p1', at: '…ونبدأ بكلمة الافتتاح', dur: 7, moderator: ['شكراً لكم.'] },
    { id: 'out', type: 'exit', title: 'الختام', at: 'خروج الضيوف', dur: 5, moderator: [] }] });
export const BLANK = name => ({ name, lang: 'ar', date: '', identity: { before: { logo: '', colors: { bg: '#F6F1E6', ink: '#14211E', accent: '#0F5A4E', gold: '#C2A063' } }, after: null }, people: {}, media: {},
  cues: [{ id: 'in', type: 'loop', title: 'الاستقبال', at: 'فتح الأبواب', dur: 15, moderator: [], fixed: true }, { id: 'out', type: 'exit', title: 'الختام', at: 'خروج الضيوف', dur: 5, moderator: [] }] });

// the static pages: the deploy's own assets when it has them (local development), else the copy kept in the bucket
export async function site(env, req, path) {
  if (env.ASSETS) return env.ASSETS.fetch(new Request(new URL(path, req.url), req));
  let f = path === '/' ? 'index.html' : path.slice(1); if (f.endsWith('/')) f += 'index.html';
  const range = req.headers.get('Range'), opt = range ? { range: req.headers } : {};   // a video is asked for in ranges (seeking, Safari)
  const inm = req.headers.get('If-None-Match'); let o = await env.MEDIA.get('_site/' + f, opt); if (!o && !/\.\w+$/.test(f)) o = await env.MEDIA.get('_site/' + f + '.html');
  if (o && inm && !range && inm.replace(/^W\//, '') === o.httpEtag) return new Response(null, { status: 304, headers: { ETag: o.httpEtag, 'Cache-Control': /\.(woff2|png|jpg|mp4)$/.test(f) ? 'public, max-age=86400' : 'no-cache' } });
  if (!o) return new Response('لا يوجد', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const h = { 'Content-Type': o.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': /\.(woff2|png|jpg|mp4)$/.test(f) ? 'public, max-age=86400' : 'no-cache', ETag: o.httpEtag, 'Accept-Ranges': 'bytes' };
  if (range && o.range) { const r = o.range, st = 'suffix' in r ? o.size - r.suffix : (r.offset || 0), len = Math.min('suffix' in r ? r.suffix : (r.length ?? o.size - st), o.size - st); return new Response(o.body, { status: 206, headers: { ...h, 'Content-Range': `bytes ${st}-${st + len - 1}/${o.size}`, 'Content-Length': String(len) } }); }
  return new Response(o.body, { headers: { ...h, 'Content-Length': String(o.size) } });
}
// every object of the bucket under a prefix (an organisation's folder, an event's folder)
export async function listAll(env, prefix) { const out = []; let cursor; do { const r = await env.MEDIA.list({ prefix, cursor, limit: 1000 }); out.push(...r.objects); cursor = r.truncated ? r.cursor : null; } while (cursor); return out; }
// the files of an event that no document needs any more (neither the draft nor the published version) leave the bucket and the index.
// A file younger than an hour is left alone: it may belong to an upload still on its way into the draft.
export async function sweep(env, T, org, ev) {
  const docs = [JSON.parse(ev.draft)]; for (const v of (await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? ORDER BY version DESC LIMIT 60').bind(ev.id).all()).results) { try { docs.push(JSON.parse(v.doc)); } catch {} }
  const need = new Set(); for (const d of docs) { for (const m of Object.values(d.media || {})) { if (m.src) need.add(m.src); if (m.cover) need.add(m.cover); } for (const k of ['before', 'after']) if (d.identity && d.identity[k] && d.identity[k].logo) need.add(d.identity[k].logo); }
  const base = `${org}/${ev.id}/`, old = Date.now() - 36e5, gone = [];
  for (const o of await listAll(env, base)) { const f = o.key.slice(base.length), top = f.includes('/') ? f.split('/')[0] + '/' : f; if (!need.has(top) && o.uploaded.getTime() < old) gone.push(o.key); }
  for (const k of gone) { const o = await env.MEDIA.get(k); if (o) await env.MEDIA.put('_trash/' + k, o.body, { httpMetadata: o.httpMetadata }); }   // kept 14 days, so a restored copy finds its files
  for (let i = 0; i < gone.length; i += 500) await env.MEDIA.delete(gone.slice(i, i + 500));
  if (gone.length) { const { results } = await T.prepare('SELECT id, r2_key FROM media WHERE event_id = ?').bind(ev.id).all(); const dead = results.filter(r => gone.includes(r.r2_key)); for (const r of dead) await T.prepare('DELETE FROM media WHERE id = ?').bind(r.id).run(); }
  return gone.length;
}
// an organisation as one document: who it is, its people, and everything in its own database (files are listed, not included)
export async function exportOrg(env, id, raw) { const org = await env.DB.prepare('SELECT * FROM orgs WHERE id = ?').bind(id).first(); if (!org) return null;
  const members = (await env.DB.prepare('SELECT u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?').bind(id).all()).results, data = await tdb(env, id).dump();
  if (!raw) data.links = data.links.map(l => ({ ...l, token_hash: undefined })); return { exported_at: now(), org, members, ...data, files: (await listAll(env, id + '/')).map(o => ({ key: o.key, bytes: o.size })) }; }
// the nightly copy: the control database and every organisation, as JSON in the bucket (_backup/<day>/), kept for 14 days
export async function backup(env) { const day = now().slice(0, 10), orgs = (await env.DB.prepare('SELECT id FROM orgs').all()).results, ctl = {};
  for (const t of ['orgs', 'users', 'members', 'passkeys', 'leads']) ctl[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  await env.MEDIA.put(`_backup/${day}/control.json`, JSON.stringify(ctl)); for (const o of orgs) await env.MEDIA.put(`_backup/${day}/${o.id}.json`, JSON.stringify(await exportOrg(env, o.id, true)));
  const keep = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10), old = [...(await listAll(env, '_backup/')).filter(o => o.key.split('/')[1] < keep), ...(await listAll(env, '_trash/')).filter(o => o.uploaded.toISOString().slice(0, 10) < keep)].map(o => o.key);   // the files taken out by the sweep wait in _trash/ as long as the copies that may still need them for (let i = 0; i < old.length; i += 500) await env.MEDIA.delete(old.slice(i, i + 500));
  return { day, orgs: orgs.length, removed: old.length }; }
