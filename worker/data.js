// Data of the platform: audit trails, the starter event, the pages from the bucket, files, the sweep, export and the daily copy.
import { platform } from './auth.js';
import { tdb } from './tenant.js';
import { now } from './util.js';

// the features the platform owner opened for an organisation (a list of words in orgs.features): 'stations' for now.
// The column and the pairing table come from db/migrations/0005_stations.sql
export const FEATURES = { stations: 'المحطات التفاعلية' };
export const hasFeat = (org, f) => !!org && !!FEATURES[f];   // owner, 22 Nov: an organisation that is switched on has every feature; the off switch is the only control
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
// the first exhibition of an organisation made for exhibitions: four stations, waiting for their files
export const STATION_STARTER = () => ({ ...BLANK('معرضكم الأول'), mode: 'stations', cues: [], stations: ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'].map((n, i) => ({ id: 's' + (i + 1), name: 'المحطة ' + n, media: '', idle: 90 })) });
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
  const need = new Set(); for (const d of docs) { for (const m of Object.values(d.media || {})) { if (m.src) need.add(m.src); if (m.cover) need.add(m.cover); } if (d.map && d.map.src) need.add(d.map.src); for (const k of ['before', 'after']) if (d.identity && d.identity[k] && d.identity[k].logo) need.add(d.identity[k].logo); }
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

// ----- the measure of browsing at the stations: a session is one visitor (from the first touch to the screen's rest), sent by the screen
// when it ends, or later in one batch when the network returns. Kept once whatever the retries (its id); nothing about the visitor.
const SID = /^[a-z0-9]{8,24}$/, NUMS = o => { const out = {}; if (o && typeof o === 'object') for (const [k, v] of Object.entries(o).slice(0, 2000)) { const n = Math.round(+k), x = Math.round(+v); if (n >= 1 && n <= 5000 && x > 0) out[n] = Math.min(x, 36e5 * 12); } return out; };
export async function takeSessions(T, evId, draft, list, ok, kind = 'screen') {
  if (!Array.isArray(list)) return 0; const rows = [];
  for (const x of list.slice(0, 200)) { if (!x || !SID.test(x.id || '') || !ok(String(x.station || ''))) continue; const start = +x.start, ms = Math.round(+x.ms);
    if (!(start > 1.6e12 && start < Date.now() + 36e5 && ms >= 0 && ms < 864e5)) continue; const pages = NUMS(x.pages), zooms = NUMS(x.zooms), n = Object.keys(pages).map(Number);
    rows.push({ sql: 'INSERT OR IGNORE INTO sessions (id, event_id, draft, station, kind, media, started_at, ms, pages, page_count, max_page, zooms, links_in, links_out, qr, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      params: [x.id, evId, draft ? 1 : 0, String(x.station), kind, String(x.media || '').slice(0, 40), new Date(start).toISOString(), ms, JSON.stringify(pages), n.length, n.length ? Math.max(...n) : 0, JSON.stringify(zooms), Math.max(0, Math.min(999, +x.li || 0)), Math.max(0, Math.min(999, +x.lo || 0)), Math.max(0, Math.min(999, +x.qr || 0)), now()] }); }
  if (rows.length) { if ((await T.prepare('SELECT COUNT(*) AS n FROM sessions WHERE event_id = ?').bind(evId).first()).n > 300000) return 0; await T.batch(rows); } return rows.length; }
// the report of an exhibition: by station, by file (how many reached each page, how long on it, how often brought closer), by hour
export async function visits(T, evId, doc, draft, tz = 0, day = '') {   // day: one day of the event (YYYY-MM-DD in the hall's time), or all of them   // tz: the browser's getTimezoneOffset(), so the hours are the hall's own
  const { results } = await T.prepare('SELECT station, kind, media, started_at, ms, pages, max_page, zooms, links_in, links_out, qr FROM sessions WHERE event_id = ? AND draft = ? ORDER BY started_at').bind(evId, draft ? 1 : 0).all();
  const st = {}, md = {}, hours = Array(24).fill(0), days = {}; let phone = 0, phonePages = 0, qr = 0, lin = 0, lout = 0;
  const dayOf = r => new Date(Date.parse(r.started_at) - tz * 60000).toISOString().slice(0, 10);
  // the days, always all of them, so they can be compared; then the rest for the day chosen
  for (const r of results) { const d = days[dayOf(r)] || (days[dayOf(r)] = { day: dayOf(r), n: 0, ms: 0, phone: 0, by: {} }); if (r.kind === 'phone') d.phone++; else { d.n++; d.ms += r.ms; d.by[r.station] = (d.by[r.station] || 0) + 1; } }
  const rows = day ? results.filter(r => dayOf(r) === day) : results;
  for (const r of rows) { const pages = JSON.parse(r.pages || '{}'), zooms = JSON.parse(r.zooms || '{}');
    if (r.kind === 'phone') { phone++; phonePages += Object.keys(pages).length; continue; }
    const s = st[r.station] || (st[r.station] = { station: r.station, n: 0, ms: 0, pages: 0 }); s.n++; s.ms += r.ms; s.pages += Object.keys(pages).length; qr += r.qr; lin += r.links_in; lout += r.links_out;
    hours[new Date(Date.parse(r.started_at) - tz * 60000).getUTCHours()]++;
    if (r.media && doc.media && doc.media[r.media]) { const m = md[r.media] || (md[r.media] = { media: r.media, name: doc.media[r.media].name, count: doc.media[r.media].count || 0, n: 0, reach: {}, dwell: {}, zoom: {} });
      m.n++; for (let p = 1; p <= (r.max_page || 0); p++) m.reach[p] = (m.reach[p] || 0) + 1; for (const [p, v] of Object.entries(pages)) { m.dwell[p] = (m.dwell[p] || 0) + v; } for (const [p, v] of Object.entries(zooms)) m.zoom[p] = (m.zoom[p] || 0) + v; } }
  const names = Object.fromEntries((doc.stations || []).map(s => [s.id, s.name]));
  const fb = { yes: 0, some: 0, no: 0 }; if (!draft) { try { const { results: fr } = await T.prepare('SELECT answer, at FROM feedback WHERE event_id = ?').bind(evId).all(); for (const f of fr) if (!day || dayOf({ started_at: f.at }) === day) fb[f.answer] = (fb[f.answer] || 0) + 1; } catch {} }
  return { fb, day, days: Object.values(days).sort((a, b) => (a.day < b.day ? -1 : 1)), total: rows.filter(r => r.kind !== 'phone').length, ms: rows.filter(r => r.kind !== 'phone').reduce((a, r) => a + r.ms, 0), phone, phonePages, qr, linksIn: lin, linksOut: lout, hours,
    stations: (doc.stations || []).map(s => ({ ...(st[s.id] || { station: s.id, n: 0, ms: 0, pages: 0 }), name: names[s.id] })).sort((a, b) => b.n - a.n),
    files: Object.values(md).map(m => ({ ...m, pagesSeen: Object.keys(m.dwell).length })), from: rows[0] ? rows[0].started_at : null, to: rows.length ? rows[rows.length - 1].started_at : null };
}

// ----- the day's requests against the free plan's daily limit (100 000 requests a day for the whole account, every organisation together).
// Each request is counted in this copy of the server's memory, by organisation, and written to the control database once every 200 requests
// or every minute: one write for hundreds of requests. The day is the plan's day (UTC). Above 85% the audience's page is kept longer in memory.
export const DAY_LIMIT = 100000;
const USE = { n: 0, by: new Map(), at: Date.now(), today: 0, day: '' };
export const pressure = () => USE.today / DAY_LIMIT;
const orgOfPath = (p, req) => { let m = p.match(/^\/(?:api\/run|run\/[a-z]+)\/(e_[a-z0-9]{20})/); if (m) return 'o_' + m[1].slice(2, 14);
  m = p.match(/^\/m\/(o_[a-z0-9]{12})\//); if (m) return m[1]; m = p.match(/^\/go\/([a-z0-9]{12})\./); if (m) return 'o_' + m[1];
  const s = req.headers.get('x-org-slug'); return s ? '@' + String(s).slice(0, 40) : '-'; };
export function countUse(env, ctx, req) { try {
  const day = new Date().toISOString().slice(0, 10); if (USE.day !== day) { USE.day = day; USE.today = 0; }
  const o = orgOfPath(new URL(req.url).pathname, req); USE.by.set(o, (USE.by.get(o) || 0) + 1); USE.n++; USE.today++;
  if (USE.n < 200 && Date.now() - USE.at < 60000) return;
  const rows = [...USE.by]; USE.by = new Map(); USE.n = 0; USE.at = Date.now();
  ctx.waitUntil(env.DB.batch([...rows.map(([org, n]) => env.DB.prepare('INSERT INTO usage (day, org, n) VALUES (?,?,?) ON CONFLICT (day, org) DO UPDATE SET n = n + excluded.n').bind(day, org, n)),
    env.DB.prepare('SELECT COALESCE(SUM(n),0) AS t FROM usage WHERE day = ?').bind(day)]).then(r => { const t = r[r.length - 1].results[0].t; if (t > USE.today) USE.today = t; }).catch(() => {}));
} catch {} }
