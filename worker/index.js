// The studio's server: organisations, people, events, files, links for the screens, and one room (Durable Object) per event.
// Every query carries the organisation of the signed in person; a screen link opens one event only.
import { problems, SCENES } from '../web/engine/config.js';
import { initial, reduce } from '../web/engine/state.js';
export { Room } from './room.js';
export { Tenant } from './tenant.js';
import { tdb, orgOfEvent } from './tenant.js';
import { b64u, unb64u, newChallenge, clientData, verify } from './passkey.js';

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const err = (msg, status = 400) => J({ error: msg }, status);
const now = () => new Date().toISOString();
const rid = (n = 12) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
const cookies = req => Object.fromEntries((req.headers.get('Cookie') || '').split(/;\s*/).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
const setCookie = (k, v, days) => `${k}=${v}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${days * 86400}`;
const ROLES = { owner: 3, editor: 2, operator: 1, viewer: 0 };
const LINK_ROLES = ['stage', 'side', 'logo', 'tablet', 'console', 'script', 'clicker'];   // console: operator commands; tablet: the launch press only
const slug = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function me(req, env) {
  const t = cookies(req).sid; if (!t) return null;
  const s = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await sha(t), now()).first(); if (!s) return null;
  const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(s.user_id).first();
  const { results } = await env.DB.prepare('SELECT o.id, o.name, o.slug, o.plan, o.events_limit, o.storage_limit_mb, o.paid_until, o.credits, m.role FROM members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ?').bind(s.user_id).all();
  return { user, orgs: results };
}
// the organisation a request works in (header x-org, else the person's first), and the person's role in it
const orgOf = (who, req) => { const s = req.headers.get('x-org-slug'); return s ? who.orgs.find(o => o.slug === s) : who.orgs[0]; };   // each organisation works under its own address: /<slug>
const audit = (env, org, ev, user, action, detail = '') => tdb(env, org).prepare('INSERT INTO audit (org_id, event_id, user_id, action, detail, at) VALUES (?,?,?,?,?,?)').bind(org, ev, user, action, detail, now()).run();
// one way out for every message: Cloudflare Email Service when the worker has the binding (EMAIL), else Resend (RESEND_KEY). 1 = sent
async function mail(env, m) { const from = env.MAIL_FROM || 'noreply@basserh.com';
  try { if (env.EMAIL) { await env.EMAIL.send({ from: { email: from, name: 'بصيرة · استوديو اللقاءات' }, to: m.to, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html }); return 1; }
    if (env.RESEND_KEY) return (await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.CONTACT_FROM || `Basserh Live <${from}>`, to: [m.to], reply_to: m.replyTo, subject: m.subject, text: m.text, html: m.html }) })).ok ? 1 : 0;
  } catch (x) { console.log('mail', x.message); } return 0; }
// the invitation by mail: the same one time link the page shows, so the owner need not copy it by hand
const mailJoin = (env, origin, email, join, orgName) => mail(env, { to: email, subject: `دعوة إلى استوديو اللقاءات · ${orgName}`, text: `السلام عليكم،\n\nدُعيتم إلى ${orgName} في استوديو اللقاءات. الدخول من هذا الرابط، ويُستعمل مرة واحدة خلال 14 يوماً:\n${origin + join}\n\nبصيرة`,
  html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:16px;line-height:1.9;color:#1F2A2E;max-width:520px"><p>السلام عليكم،</p><p>دُعيتم إلى <b>${orgName.replace(/[<>&]/g, '')}</b> في استوديو اللقاءات.</p><p><a href="${origin + join}" style="display:inline-block;background:#B88A3D;color:#fff;text-decoration:none;padding:10px 26px;border-radius:8px">الدخول إلى الاستوديو</a></p><p style="font-size:13px;color:#777">الرابط يُستعمل مرة واحدة خلال 14 يوماً.</p><p>بصيرة</p></div>` });
async function invite(env, email, days = 14) { const code = rid(28); await env.DB.prepare('INSERT INTO login_codes (code_hash, email, expires_at) VALUES (?,?,?)').bind(await sha(code), email, new Date(Date.now() + days * 864e5).toISOString()).run(); return '/join/' + code; }
// a session of 30 days for a user; returns the cookie
// passwords: PBKDF2 (SHA-256, 100000 rounds) with a salt of its own; only "salt:hash" is kept
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function pwHash(pw, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return salt + ':' + hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256)); }
const pwOk = async (pw, kept) => { if (!kept || !pw) return false; const a = await pwHash(pw, kept.split(':')[0]); let d = a.length ^ kept.length; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ kept.charCodeAt(i % kept.length); return d === 0; };
// a password a person can read out and type: four groups of four, no look-alike characters
const newPw = () => [0, 1, 2, 3].map(() => rid(4)).join('-');
// five wrong attempts from one address close the door for fifteen minutes (the owner's page and the studio share the count)
async function locked(env, ip) { const f = await env.DB.prepare('SELECT n, until FROM login_fail WHERE ip = ?').bind(ip).first(); return f && f.until && f.until > now() ? null : { n: f && !f.until ? f.n : 0 }; }
const failed = (env, ip, n) => env.DB.prepare('INSERT INTO login_fail (ip, n, until) VALUES (?,?,?) ON CONFLICT (ip) DO UPDATE SET n = excluded.n, until = excluded.until').bind(ip, n + 1, n + 1 >= 5 ? new Date(Date.now() + 9e5).toISOString() : null).run();
async function session(env, uid) { const t = rid(32); await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').bind(await sha(t), uid, new Date(Date.now() + 30 * 864e5).toISOString(), now()).run(); return setCookie('sid', t, 30); }
// the platform owner as a person of the system (for sessions and passkeys); belongs to no organisation
async function platform(env) { await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?,?,?,?) ON CONFLICT (id) DO NOTHING').bind('platform', 'platform@basserh', 'مالك المنصة', now()).run(); return 'platform'; }
async function userFor(env, email, name) { email = String(email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  let u = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first(); if (!u) { u = { id: 'u_' + rid() }; await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?,?,?,?)').bind(u.id, email, name || '', now()).run(); } return { id: u.id, email }; }
// what a new organisation finds on its first visit: a small event already laid out, to edit instead of starting from an empty page
const STARTER = () => ({ ...BLANK('لقاؤكم الأول'), people: { p1: { name: 'اسم المتحدث', honorific: 'الصفة' } },
  cues: [{ id: 'in', type: 'loop', title: 'الاستقبال', at: 'فتح الأبواب', dur: 15, moderator: [], fixed: true },
    { id: 'open', type: 'title', title: 'الافتتاح', text: 'بسم الله الرحمن الرحيم', at: 'بسم الله الرحمن الرحيم', dur: 3, moderator: ['بسم الله الرحمن الرحيم. نرحب بكم في لقائنا، ونبدأ بكلمة الافتتاح.'] },
    { id: 'talk', type: 'speaker', title: 'كلمة الافتتاح', person: 'p1', at: '…ونبدأ بكلمة الافتتاح', dur: 7, moderator: ['شكراً لكم.'] },
    { id: 'out', type: 'exit', title: 'الختام', at: 'خروج الضيوف', dur: 5, moderator: [] }] });
const BLANK = name => ({ name, lang: 'ar', date: '', identity: { before: { logo: '', colors: { bg: '#F6F1E6', ink: '#14211E', accent: '#0F5A4E', gold: '#C2A063' } }, after: null }, people: {}, media: {},
  cues: [{ id: 'in', type: 'loop', title: 'الاستقبال', at: 'فتح الأبواب', dur: 15, moderator: [], fixed: true }, { id: 'out', type: 'exit', title: 'الختام', at: 'خروج الضيوف', dur: 5, moderator: [] }] });

// the static pages: the deploy's own assets when it has them (local development), else the copy kept in the bucket
async function site(env, req, path) {
  if (env.ASSETS) return env.ASSETS.fetch(new Request(new URL(path, req.url), req));
  let f = path === '/' ? 'index.html' : path.slice(1); if (f.endsWith('/')) f += 'index.html';
  const range = req.headers.get('Range'), opt = range ? { range: req.headers } : {};   // a video is asked for in ranges (seeking, Safari)
  let o = await env.MEDIA.get('_site/' + f, opt); if (!o && !/\.\w+$/.test(f)) o = await env.MEDIA.get('_site/' + f + '.html');
  if (!o) return new Response('لا يوجد', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const h = { 'Content-Type': o.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': /\.(woff2|png|jpg|mp4)$/.test(f) ? 'public, max-age=86400' : 'no-cache', ETag: o.httpEtag, 'Accept-Ranges': 'bytes' };
  if (range && o.range) { const r = o.range, st = 'suffix' in r ? o.size - r.suffix : (r.offset || 0), len = 'suffix' in r ? r.suffix : (r.length ?? o.size - st); return new Response(o.body, { status: 206, headers: { ...h, 'Content-Range': `bytes ${st}-${st + len - 1}/${o.size}`, 'Content-Length': String(len) } }); }
  return new Response(o.body, { headers: { ...h, 'Content-Length': String(o.size) } });
}
// every object of the bucket under a prefix (an organisation's folder, an event's folder)
async function listAll(env, prefix) { const out = []; let cursor; do { const r = await env.MEDIA.list({ prefix, cursor, limit: 1000 }); out.push(...r.objects); cursor = r.truncated ? r.cursor : null; } while (cursor); return out; }
// the files of an event that no document needs any more (neither the draft nor the published version) leave the bucket and the index.
// A file younger than an hour is left alone: it may belong to an upload still on its way into the draft.
async function sweep(env, T, org, ev) {
  const docs = [JSON.parse(ev.draft)]; if (ev.published_version) { const v = await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(ev.id, ev.published_version).first(); if (v) docs.push(JSON.parse(v.doc)); }
  const need = new Set(); for (const d of docs) { for (const m of Object.values(d.media || {})) if (m.src) need.add(m.src); for (const k of ['before', 'after']) if (d.identity && d.identity[k] && d.identity[k].logo) need.add(d.identity[k].logo); }
  const base = `${org}/${ev.id}/`, old = Date.now() - 36e5, gone = [];
  for (const o of await listAll(env, base)) { const f = o.key.slice(base.length), top = f.includes('/') ? f.split('/')[0] + '/' : f; if (!need.has(top) && o.uploaded.getTime() < old) gone.push(o.key); }
  for (let i = 0; i < gone.length; i += 500) await env.MEDIA.delete(gone.slice(i, i + 500));
  if (gone.length) { const { results } = await T.prepare('SELECT id, r2_key FROM media WHERE event_id = ?').bind(ev.id).all(); const dead = results.filter(r => gone.includes(r.r2_key)); for (const r of dead) await T.prepare('DELETE FROM media WHERE id = ?').bind(r.id).run(); }
  return gone.length;
}
// an organisation as one document: who it is, its people, and everything in its own database (files are listed, not included)
async function exportOrg(env, id) { const org = await env.DB.prepare('SELECT * FROM orgs WHERE id = ?').bind(id).first(); if (!org) return null;
  const members = (await env.DB.prepare('SELECT u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?').bind(id).all()).results, data = await tdb(env, id).dump();
  data.links = data.links.map(l => ({ ...l, token_hash: undefined })); return { exported_at: now(), org, members, ...data, files: (await listAll(env, id + '/')).map(o => ({ key: o.key, bytes: o.size })) }; }
// the nightly copy: the control database and every organisation, as JSON in the bucket (_backup/<day>/), kept for 14 days
async function backup(env) { const day = now().slice(0, 10), orgs = (await env.DB.prepare('SELECT id FROM orgs').all()).results, ctl = {};
  for (const t of ['orgs', 'users', 'members', 'passkeys', 'leads']) ctl[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  await env.MEDIA.put(`_backup/${day}/control.json`, JSON.stringify(ctl)); for (const o of orgs) await env.MEDIA.put(`_backup/${day}/${o.id}.json`, JSON.stringify(await exportOrg(env, o.id)));
  const keep = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10), old = (await listAll(env, '_backup/')).filter(o => o.key.split('/')[1] < keep).map(o => o.key); for (let i = 0; i < old.length; i += 500) await env.MEDIA.delete(old.slice(i, i + 500));
  return { day, orgs: orgs.length, removed: old.length }; }
let backupDay = '';
export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(backup(env)); },
  async fetch(req, env, ctx) {
    // without a cron trigger the copy still happens: the first request of each day finds no copy for that day and makes it
    const day = now().slice(0, 10); if (ctx && backupDay !== day) { backupDay = day; ctx.waitUntil(env.MEDIA.head(`_backup/${day}/control.json`).then(h => h || backup(env)).catch(() => { backupDay = ''; })); }
    const url = new URL(req.url), p = url.pathname, M = req.method;
    try {
      // ----- the platform owner signs in with the password once, then with a passkey; five wrong passwords lock the address for 15 minutes
      if (p === '/api/admin/login' && M === 'POST') { const ip = req.headers.get('CF-Connecting-IP') || 'local', f = await env.DB.prepare('SELECT n, until FROM login_fail WHERE ip = ?').bind(ip).first();
        if (f && f.until && f.until > now()) return err('محاولات كثيرة. أعد المحاولة بعد ربع ساعة.', 429);
        const b = await req.json().catch(() => ({})); if (!env.ADMIN_KEY || b.password !== env.ADMIN_KEY) { const n = (f && (!f.until || f.until > now()) ? f.n : 0) + 1; await env.DB.prepare('INSERT INTO login_fail (ip, n, until) VALUES (?,?,?) ON CONFLICT (ip) DO UPDATE SET n = excluded.n, until = excluded.until').bind(ip, n, n >= 5 ? new Date(Date.now() + 9e5).toISOString() : null).run(); return err('كلمة المرور غير صحيحة', 403); }
        await env.DB.prepare('DELETE FROM login_fail WHERE ip = ?').bind(ip).run(); return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': await session(env, await platform(env)) } }); }
      const admin = p.startsWith('/api/admin/') && ((env.ADMIN_KEY && req.headers.get('x-admin-key') === env.ADMIN_KEY) || ((await me(req, env)) || {}).user?.id === 'platform');
      if (p.startsWith('/api/admin/') && !admin) return err('غير مصرح', 403);
      if (p === '/api/admin/me') return J({ ok: true, passkeys: (await env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind('platform').first()).n });
      // the pages of the site kept in the bucket (_site/): pushed by tools/push_site.mjs when the deploy cannot carry static files itself
      // ----- the platform owner: a new organisation and the link that signs its owner in
      if (p === '/api/admin/org' && M === 'POST') {
        const b = await req.json(), s = slug(b.slug || b.name); if (!b.name || !s) return err('اسم الجهة ومعرّفها مطلوبان');
        if (['login', 'admin', 'studio', 'run', 'api', 'm', 'go', 'join', 'fonts', 'vendor', 'engine', 'brand'].includes(s)) return err('هذا العنوان محجوز للنظام');
        if (await env.DB.prepare('SELECT 1 FROM orgs WHERE slug = ?').bind(s).first()) return err('المعرّف مستعمل');
        const u = await userFor(env, b.email, b.owner); if (!u) return err('بريد المالك غير صالح');
        const id = 'o_' + rid(); await env.DB.batch([
          env.DB.prepare('INSERT INTO orgs (id, name, slug, plan, events_limit, storage_limit_mb, paid_until, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, b.name, s, b.plan || 'trial', b.events_limit || 1, b.storage_limit_mb || 2000, b.paid_until || null, now()),
          env.DB.prepare('INSERT INTO members (org_id, user_id, role) VALUES (?,?,?)').bind(id, u.id, 'owner')]);
        // the organisation's own database is born here, with its first event
        await tdb(env, id).prepare('INSERT INTO events (id, org_id, slug, name, status, draft, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').bind('e_' + id.slice(2) + rid(8), id, 'first-' + rid(4), 'لقاؤكم الأول', 'draft', JSON.stringify(STARTER()), now(), now()).run();
        if (+b.credits > 0) await env.DB.prepare('UPDATE orgs SET credits = ? WHERE id = ?').bind(+b.credits, id).run();
        // the owner's password: the one the platform owner typed, or a generated one; shown once in the answer, kept hashed
        const password = String(b.password || '').trim() || newPw(); if (password.length < 8) return err('كلمة المرور ثمانية أحرف على الأقل'); await env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await pwHash(password), u.id).run();
        await audit(env, id, null, null, 'org', b.name); const join = await invite(env, u.email); return J({ org: id, slug: s, join, email: u.email, password, mailed: await mailJoin(env, url.origin, u.email, join, b.name) });
      }
      // ----- an organisation's data as a file; its end; the copies
      if (p === '/api/admin/export' && M === 'GET') { const d = await exportOrg(env, url.searchParams.get('org')); if (!d) return err('لا يوجد', 404); return new Response(JSON.stringify(d, null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${d.org.slug}-${now().slice(0, 10)}.json"` } }); }
      if (p === '/api/admin/org' && M === 'DELETE') {   // gone for good: its files, its database, its place among the organisations. The address must be typed to confirm
        const b = await req.json(), o = await env.DB.prepare('SELECT * FROM orgs WHERE id = ?').bind(b.id).first(); if (!o) return err('لا يوجد', 404); if (b.confirm !== o.slug) return err('اكتب عنوان الجهة للتأكيد');
        const keys = (await listAll(env, o.id + '/')).map(x => x.key); for (let i = 0; i < keys.length; i += 500) await env.MEDIA.delete(keys.slice(i, i + 500));
        await tdb(env, o.id).wipe(); await env.DB.batch([env.DB.prepare('DELETE FROM members WHERE org_id = ?').bind(o.id), env.DB.prepare('DELETE FROM orgs WHERE id = ?').bind(o.id)]); return J({ ok: true, files: keys.length }); }
      if (p === '/api/admin/backup' && M === 'POST') return J(await backup(env));
      if (p === '/api/admin/backup' && M === 'GET') { const days = [...new Set((await listAll(env, '_backup/')).map(o => o.key.split('/')[1]))].sort(); return J({ days, last: days[days.length - 1] || null }); }
      if (p === '/api/admin/password' && M === 'POST') {   // a new password for a member of an organisation (the old one stops working)
        const b = await req.json(), u = await env.DB.prepare('SELECT u.id, u.email FROM users u JOIN members m ON m.user_id = u.id WHERE m.org_id = ? AND u.email = ?').bind(b.org, String(b.email || '').toLowerCase()).first(); if (!u) return err('ليس عضواً في هذه الجهة', 404);
        const password = String(b.password || '').trim() || newPw(); if (password.length < 8) return err('كلمة المرور ثمانية أحرف على الأقل');
        await env.DB.batch([env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await pwHash(password), u.id), env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id)]); await audit(env, b.org, null, null, 'password', u.email); return J({ email: u.email, password }); }
      if (p === '/api/admin/leads' && M === 'GET') return J({ leads: (await env.DB.prepare('SELECT id, name, org, phone, email, kind, event_date, message, created_at, handled_at, mailed FROM leads ORDER BY id DESC LIMIT 200').all()).results, mail: !!((env.EMAIL || env.RESEND_KEY) && env.CONTACT_TO) });
      if (p === '/api/admin/leads' && M === 'PATCH') { const b = await req.json(); await env.DB.prepare('UPDATE leads SET handled_at = ? WHERE id = ?').bind(b.handled ? now() : null, b.id).run(); return J({ ok: true }); }
      if (p === '/api/admin/site' && M === 'PUT') { const f = url.searchParams.get('path') || ''; if (!/^[\w./-]+$/.test(f) || f.includes('..')) return err('مسار غير صالح'); await env.MEDIA.put('_site/' + f, req.body, { httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' } }); return J({ ok: true }); }
      if (p === '/api/admin/org' && M === 'PATCH') {   // the plan of an organisation: limits, the paid period, activation days added
        const b = await req.json(), o = await env.DB.prepare('SELECT * FROM orgs WHERE id = ?').bind(b.id).first(); if (!o) return err('لا يوجد', 404);
        await env.DB.prepare('UPDATE orgs SET name = ?, plan = ?, events_limit = ?, storage_limit_mb = ?, paid_until = ?, credits = ? WHERE id = ?').bind(b.name ?? o.name, b.plan ?? o.plan, b.events_limit ?? o.events_limit, b.storage_limit_mb ?? o.storage_limit_mb, b.paid_until === undefined ? o.paid_until : b.paid_until, Math.max(0, o.credits + (+b.add_credits || 0)), o.id).run();
        await audit(env, o.id, null, null, 'plan', JSON.stringify(b)); return J({ ok: true });
      }
      if (p === '/api/admin/invite' && M === 'POST') { const b = await req.json(), u = await userFor(env, b.email); if (!u) return err('بريد غير صالح'); await env.DB.prepare('INSERT INTO members (org_id, user_id, role) VALUES (?,?,?) ON CONFLICT (org_id, user_id) DO NOTHING').bind(b.org, u.id, 'owner').run(); return J({ join: await invite(env, u.email) }); }
      if (p === '/api/admin/orgs' && M === 'GET') {
        const { results } = await env.DB.prepare('SELECT o.*, (SELECT GROUP_CONCAT(u.email) FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.role = ?) AS owners FROM orgs o ORDER BY created_at DESC').bind('owner').all();
        // usage comes from each organisation's own database
        return J({ orgs: await Promise.all(results.map(async o => { const [[c], [b], active] = await tdb(env, o.id).batch([{ sql: 'SELECT COUNT(*) AS n FROM events WHERE status != ?', params: ['archived'] }, { sql: 'SELECT COALESCE(SUM(bytes),0) AS b FROM media', params: [] }, { sql: 'SELECT name, active_from, active_until FROM events WHERE active_until > ? ORDER BY active_from', params: [now()] }]); return { ...o, events: c.n, bytes: b.b, active }; })) });
      }
      // ----- signing in by a link (no password): the link is used once and opens a session of 30 days
      if (p === '/api/login' && M === 'POST') {   // the studio's gate: email and password
        const ip = req.headers.get('CF-Connecting-IP') || 'local', f = await locked(env, ip); if (!f) return err('محاولات كثيرة. حاول بعد ربع ساعة.', 429);
        const b = await req.json().catch(() => ({})), u = await env.DB.prepare('SELECT id, pw FROM users WHERE email = ?').bind(String(b.email || '').trim().toLowerCase()).first();
        if (!(await pwOk(String(b.password || ''), u && u.pw)) || u.id === 'platform') { await failed(env, ip, f.n); return err('البريد أو كلمة المرور غير صحيحة', 403); }
        await env.DB.prepare('DELETE FROM login_fail WHERE ip = ?').bind(ip).run(); const first = await env.DB.prepare('SELECT o.slug FROM members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? LIMIT 1').bind(u.id).first();
        return new Response(JSON.stringify({ ok: true, to: '/' + (first ? first.slug : 'login') }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': await session(env, u.id) } }); }
      if (p === '/api/password' && M === 'POST') {   // a signed in member sets a password of their own
        const w = await me(req, env); if (!w || !w.user || w.user.id === 'platform') return err('ادخل أولاً', 401); const b = await req.json().catch(() => ({})), pw = String(b.password || ''); if (pw.length < 8) return err('كلمة المرور ثمانية أحرف على الأقل');
        await env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await pwHash(pw), w.user.id).run(); return J({ ok: true }); }
      if (p.startsWith('/join/')) {
        const h = await sha(p.slice(6)), c = await env.DB.prepare('SELECT email FROM login_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(h, now()).first();
        if (!c) return new Response('الرابط منتهٍ أو مستعمل. اطلب رابطاً جديداً من مالك الحساب.', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        const u = await userFor(env, c.email), t = rid(32);
        await env.DB.batch([env.DB.prepare('UPDATE login_codes SET used_at = ? WHERE code_hash = ?').bind(now(), h),
          env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').bind(await sha(t), u.id, new Date(Date.now() + 30 * 864e5).toISOString(), now())]);
        const first = await env.DB.prepare('SELECT o.slug FROM members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? LIMIT 1').bind(u.id).first();
        return new Response(null, { status: 302, headers: { Location: '/' + (first ? first.slug : 'login'), 'Set-Cookie': setCookie('sid', t, 30) } });
      }
      // ----- the public page's contact form: kept in the database for the owner's page, and mailed to the owner when a mail service is set
      // (secrets CONTACT_TO and RESEND_KEY; the address is never in a page). A hidden field and a limit per address keep robots out.
      if (p === '/api/contact' && M === 'POST') { const b = await req.json().catch(() => ({})), ip = req.headers.get('CF-Connecting-IP') || 'local', cut = (v, n) => String(v || '').trim().slice(0, n);
        if (b.website) return J({ ok: true });   // the hidden field: only a robot fills it
        const name = cut(b.name, 80), phone = cut(b.phone, 30), email = cut(b.email, 120); if (name.length < 2) return err('اكتب الاسم'); if (!phone && !email) return err('اكتب الجوال أو البريد لنتواصل معكم'); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('البريد غير صحيح');
        if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND created_at > ?').bind(ip, new Date(Date.now() - 36e5).toISOString()).first()).n >= 5) return err('وصلتنا طلباتكم. سنتواصل معكم قريباً.', 429);
        const L = { name, org: cut(b.org, 120), phone, email, kind: cut(b.kind, 40), date: cut(b.date, 20), message: cut(b.message, 2000) }; let mailed = 0;
        if (env.CONTACT_TO) mailed = await mail(env, { to: env.CONTACT_TO, replyTo: email || undefined, subject: `طلب جديد من ${name}${L.org ? ' · ' + L.org : ''}`,
          text: `الاسم: ${name}\nالجهة: ${L.org}\nالجوال: ${phone}\nالبريد: ${email}\nنوع المناسبة: ${L.kind}\nالموعد المتوقع: ${L.date}\n\n${L.message}\n\nمن نموذج التواصل في ${url.origin}` });
        await env.DB.prepare('INSERT INTO leads (name, org, phone, email, kind, event_date, message, ip, created_at, mailed) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(name, L.org, phone, email, L.kind, L.date, L.message, ip, now(), mailed).run(); return J({ ok: true }); }
      // ----- passkeys: add one while signed in; sign in with one from the gate (the device offers the passkeys it holds for this site)
      if (p.startsWith('/api/passkey/')) { const b = M === 'POST' ? await req.json().catch(() => ({})) : {};
        // the browser names the site it signed for; it must be this site (or localhost in development, where the server answers under the route's name)
        const site = o => { const h = new URL(o).hostname; if (o !== url.origin && h !== 'localhost') throw new Error('العنوان غير مطابق'); return h; };
        const take = async c => { const r = await env.DB.prepare('DELETE FROM challenges WHERE challenge = ? AND expires_at > ? RETURNING user_id').bind(c, now()).first(); if (!r) throw new Error('انتهت صلاحية المحاولة'); return r; };
        const issue = async uid => { const c = newChallenge(); await env.DB.prepare('INSERT INTO challenges (challenge, user_id, expires_at) VALUES (?,?,?)').bind(c, uid, new Date(Date.now() + 3e5).toISOString()).run(); return c; };
        try {
          if (p === '/api/passkey/register/start') { const who = await me(req, env); if (!who) return err('سجّل الدخول أولاً', 401);
            return J({ challenge: await issue(who.user.id), rp: { name: 'بصيرة' }, user: { id: b64u(new TextEncoder().encode(who.user.id)), name: who.user.email, displayName: who.user.name || who.user.email } }); }
          if (p === '/api/passkey/register/finish') { const who = await me(req, env); if (!who) return err('سجّل الدخول أولاً', 401); const cd = JSON.parse(new TextDecoder().decode(unb64u(b.clientDataJSON)));
            const ch = await take(cd.challenge); if (ch.user_id !== who.user.id) return err('المحاولة لا تخص هذا الحساب'); site(cd.origin); clientData(unb64u(b.clientDataJSON), 'webauthn.create', cd.challenge, cd.origin);
            if (![-7, -257].includes(b.alg) || !b.publicKey || !b.id) return err('هذا الجهاز لا يقدّم مفتاحاً مدعوماً');
            await env.DB.prepare('INSERT INTO passkeys (cred_id, user_id, spki, alg, label, created_at) VALUES (?,?,?,?,?,?)').bind(b.id, who.user.id, b.publicKey, b.alg, String(b.label || '').slice(0, 60), now()).run(); return J({ ok: true }); }
          if (p === '/api/passkey/login/start') return J({ challenge: await issue(null) });
          if (p === '/api/passkey/login/finish') { const k = await env.DB.prepare('SELECT * FROM passkeys WHERE cred_id = ?').bind(b.id).first(); if (!k) return err('مفتاح المرور غير مسجّل هنا', 403);
            const cdj = unb64u(b.clientDataJSON), cd = JSON.parse(new TextDecoder().decode(cdj)); await take(cd.challenge); const rpId = site(cd.origin); clientData(cdj, 'webauthn.get', cd.challenge, cd.origin);
            if (!(await verify({ spki: unb64u(k.spki), alg: k.alg, authenticatorData: unb64u(b.authenticatorData), clientDataJSON: cdj, signature: unb64u(b.signature), rpId }))) return err('توقيع غير صحيح', 403);
            await env.DB.prepare('UPDATE passkeys SET last_used_at = ? WHERE cred_id = ?').bind(now(), b.id).run();
            const first = k.user_id === 'platform' ? null : await env.DB.prepare('SELECT o.slug FROM members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? LIMIT 1').bind(k.user_id).first();
            return new Response(JSON.stringify({ to: k.user_id === 'platform' ? '/admin.html' : '/' + (first ? first.slug : 'login') }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': await session(env, k.user_id) } }); }
        } catch (e) { return err(e.message || 'تعذّر التحقق', 400); }
        return err('لا يوجد', 404); }
      if (p === '/api/logout') return new Response(null, { status: 302, headers: { Location: '/login', 'Set-Cookie': setCookie('sid', '', 0) } });
      // ----- a link of one screen: opens that page of that event, with no account
      if (p.startsWith('/go/')) {
        const tok = p.slice(4), l = /^[a-z0-9]{12}\.[a-z0-9]+$/.test(tok) ? await tdb(env, 'o_' + tok.slice(0, 12)).prepare('SELECT event_id, role FROM links WHERE token_hash = ? AND revoked_at IS NULL').bind(await sha(tok)).first() : null;
        if (!l) return new Response('هذا الرابط أُلغي. اطلب رابطاً جديداً من منظّم اللقاء.', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        return new Response(null, { status: 302, headers: { Location: `/run/${['side', 'logo'].includes(l.role) ? 'stage' : l.role}.html?e=${l.event_id}${['side', 'logo'].includes(l.role) ? '&' + l.role : ''}`, 'Set-Cookie': setCookie('lk_' + l.event_id, tok, 30) } });
      }
      // ----- the running event (screens): who is asking, the document, the files, the room
      if (p.startsWith('/api/run/') || p.startsWith('/m/')) {
        const seg = p.split('/'), evId = p.startsWith('/m/') ? seg[3] : seg[3];
        if (!/^e_[a-z0-9]{20}$/.test(evId)) return err('لا يوجد', 404); const T = tdb(env, orgOfEvent(evId));
        const ev = await T.prepare('SELECT id, org_id, draft, published_version, active_from, active_until FROM events WHERE id = ?').bind(evId).first(); if (!ev) return err('لا يوجد', 404);
        let role = null; const tok = cookies(req)['lk_' + evId];
        if (tok) { const l = await T.prepare('SELECT role FROM links WHERE token_hash = ? AND event_id = ? AND revoked_at IS NULL').bind(await sha(tok), evId).first(); if (l) role = l.role; }
        const who = await me(req, env), mem = who && who.orgs.find(o => o.id === ev.org_id); if (mem) role = ROLES[mem.role] >= 1 ? 'console' : (role || 'stage');
        if (!role) return err('افتح الشاشة من رابطها', 401);
        if (p.startsWith('/m/')) {   // /m/<org>/<event>/<file>: the files of the event, in its own folder of the bucket
          const key = decodeURIComponent(p.slice(3)); if (!key.startsWith(ev.org_id + '/' + ev.id + '/')) return err('لا يوجد', 404);
          const range = req.headers.get('Range'), o = await env.MEDIA.get(key, range ? { range: req.headers } : {}); if (!o) return err('لا يوجد', 404);
          const h = { 'Content-Type': o.httpMetadata?.contentType || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', ETag: o.httpEtag };
          if (range && o.range) { const r = o.range, st = 'suffix' in r ? o.size - r.suffix : (r.offset || 0), len = 'suffix' in r ? r.suffix : (r.length ?? o.size - st);
            return new Response(o.body, { status: 206, headers: { ...h, 'Content-Range': `bytes ${st}-${st + len - 1}/${o.size}`, 'Content-Length': String(len) } }); }
          return new Response(o.body, { headers: { ...h, 'Content-Length': String(o.size) } });
        }
        // rehearsal (the draft, members only) runs in its own room beside the published event
        const rehearse = url.searchParams.has('draft') && mem, ver = rehearse ? 0 : ev.published_version;
        if (!rehearse && !ver) return err('اللقاء لم يُعتمد بعد', 409);
        // the hall's screens open on the activation day only; building and rehearsing need no activation
        if (!rehearse && !(ev.active_from && ev.active_from <= now() && now() < ev.active_until)) { const why = ev.active_from && ev.active_from > now() ? 'يُفتح اللقاء في موعد تفعيله: ' + ev.active_from.slice(0, 10) : 'اللقاء غير مفعّل. فعّلوا يوم اللقاء من الاستوديو.';
          // a screen opened before the day still takes its files, so the hall's devices are ready before anyone arrives
          if (seg[4] === 'config' && ['stage', 'side', 'logo', 'console'].includes(role)) { const d = JSON.parse((await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(evId, ver).first()).doc), base = `/m/${ev.org_id}/${ev.id}/`, L = (d.cues || []).find(c => c.type === 'launch'), all = role !== 'side' && role !== 'logo', files = [];
            for (const [k, m] of Object.entries(d.media || {})) { if (!all && !(L && L.media === k)) continue; if (m.kind === 'slides') for (let i = 1; i <= (m.count || 0); i++) files.push(base + m.src + 's-' + i + '.jpg'); else files.push(base + m.src); }
            for (const k of ['before', 'after']) { const I = (d.identity || {})[k]; if (I && I.logo) files.push(base + I.logo); }
            return J({ error: why, prep: { name: d.name, files } }, 402); }
          return err(why, 402); }
        const doc = rehearse ? JSON.parse(ev.draft) : JSON.parse((await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(evId, ver).first()).doc);
        if (seg[4] === 'config') return J({ doc: { ...doc, id: evId }, role, version: ver, base: `/m/${ev.org_id}/${ev.id}/` });
        if (seg[4] === 'ws' || seg[4] === 'state' || seg[4] === 'cmd') {
          const room = env.ROOM.get(env.ROOM.idFromName(evId + (rehearse ? ':draft' : ':live'))), h = new Headers(req.headers);
          h.set('x-role', role); h.set('x-ver', String(ver)); // the room needs the rules only, not the texts
          h.set('x-doc', encodeURIComponent(JSON.stringify({ cues: doc.cues.map(c => ({ id: c.id, type: c.type, media: c.media, after: c.after, fixed: c.fixed, off: c.off, style: c.style, count: c.count, hands: c.hands })),
            media: Object.fromEntries(Object.entries(doc.media || {}).map(([k, v]) => [k, { kind: v.kind, count: v.count, length: v.length }])), identity: { after: !!(doc.identity && doc.identity.after) } })));
          return room.fetch(new Request(req.url, { method: M, headers: h, body: M === 'POST' ? await req.text() : undefined }));
        }
        return err('لا يوجد', 404);
      }
      if (!p.startsWith('/api/')) {   // /<slug>: the studio of that organisation (the same page; it sends the slug with every request)
        const sl = p.match(/^\/([a-z0-9][a-z0-9-]{1,39})\/?$/); if (p === '/login' || (sl && !['run', 'fonts', 'vendor', 'engine', 'admin', 'brand', 'studio'].includes(sl[1]) && await env.DB.prepare('SELECT 1 FROM orgs WHERE slug = ?').bind(sl[1]).first())) return site(env, req, '/studio');   // «/» is the public page; the studio opens at /login and at each organisation's address
        return site(env, req, url.pathname); }

      // ----- the studio (signed in people)
      const who = await me(req, env); if (!who) return err('سجّل الدخول من رابط الدعوة', 401);
      if (p === '/api/me') return J({ ...who, scenes: SCENES });
      const org = orgOf(who, req); if (!org) return err('لا توجد جهة لهذا الحساب', 403);
      const can = lvl => ROLES[org.role] >= ROLES[lvl], T = tdb(env, org.id);   // T: this organisation's own database
      if (p === '/api/members' && M === 'GET') { const { results } = await env.DB.prepare('SELECT u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?').bind(org.id).all(); return J({ members: results }); }
      if (p === '/api/members' && M === 'DELETE') {   // the owner removes a person; the last owner stays
        if (!can('owner')) return err('للمالك فقط', 403); const b = await req.json(), u = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(String(b.email || '').toLowerCase()).first(); if (!u) return err('لا يوجد', 404);
        const owners = (await env.DB.prepare('SELECT user_id FROM members WHERE org_id = ? AND role = ?').bind(org.id, 'owner').all()).results; if (owners.length === 1 && owners[0].user_id === u.id) return err('لا تبقى الجهة بلا مالك');
        await env.DB.prepare('DELETE FROM members WHERE org_id = ? AND user_id = ?').bind(org.id, u.id).run(); await audit(env, org.id, null, who.user.id, 'member_removed', b.email); return J({ ok: true }); }
      if (p === '/api/audit' && M === 'GET') {   // what was done in the organisation, and by whom
        if (!can('owner')) return err('للمالك فقط', 403); const { results } = await T.prepare('SELECT a.event_id, a.user_id, a.action, a.detail, a.at, e.name AS event FROM audit a LEFT JOIN events e ON e.id = a.event_id ORDER BY a.id DESC LIMIT 200').all();
        const ids = [...new Set(results.map(r => r.user_id).filter(Boolean))], who2 = {}; for (const i of ids) { const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(i).first(); who2[i] = u ? u.email : ''; }
        return J({ audit: results.map(r => ({ ...r, by: who2[r.user_id] || (r.user_id ? '' : 'بصيرة') })), usage: (await T.prepare('SELECT COALESCE(SUM(bytes),0) AS b FROM media').first()).b, limit_mb: org.storage_limit_mb }); }
      if (p === '/api/members' && M === 'POST') {   // the owner adds a person: returns the link to hand to them
        if (!can('owner')) return err('للمالك فقط', 403); const b = await req.json(); if (!(b.role in ROLES)) return err('دور غير معروف');
        const u = await userFor(env, b.email, b.name); if (!u) return err('بريد غير صالح');
        if (b.role !== 'owner') { const ow = (await env.DB.prepare('SELECT user_id FROM members WHERE org_id = ? AND role = ?').bind(org.id, 'owner').all()).results; if (ow.length === 1 && ow[0].user_id === u.id) return err('لا تبقى الجهة بلا مالك'); }
        await env.DB.prepare('INSERT INTO members (org_id, user_id, role) VALUES (?,?,?) ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role').bind(org.id, u.id, b.role).run();
        await audit(env, org.id, null, who.user.id, 'member', `${u.email} ${b.role}`); const join = await invite(env, u.email); return J({ join, mailed: await mailJoin(env, url.origin, u.email, join, org.name) });
      }
      if (p === '/api/events' && M === 'GET') { const { results } = await T.prepare('SELECT id, slug, name, status, published_version, updated_at FROM events WHERE org_id = ? AND status != ? ORDER BY updated_at DESC').bind(org.id, 'archived').all(); return J({ events: results, org }); }
      if (p === '/api/events' && M === 'POST') {
        if (!can('editor')) return err('لا تملك صلاحية الإنشاء', 403); const b = await req.json(); if (!b.name) return err('اسم اللقاء مطلوب');
        const n = (await T.prepare('SELECT COUNT(*) AS n FROM events WHERE org_id = ? AND status != ?').bind(org.id, 'archived').first()).n;
        if (n >= org.events_limit) return err(`باقتكم تسمح بـ ${org.events_limit} لقاء. أرشفوا لقاءً أو رقّوا الباقة.`, 402);
        if (org.paid_until && org.paid_until < now()) return err('انتهى اشتراك الجهة', 402);
        let doc = BLANK(b.name); if (b.from) { const src = await T.prepare('SELECT draft FROM events WHERE id = ? AND org_id = ?').bind(b.from, org.id).first(); if (src) doc = { ...JSON.parse(src.draft), name: b.name }; }
        const id = 'e_' + org.id.slice(2) + rid(8), s = (slug(b.slug) || 'event') + '-' + rid(4);
        await T.prepare('INSERT INTO events (id, org_id, slug, name, status, draft, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, org.id, s, b.name, 'draft', JSON.stringify(doc), now(), now()).run();
        await audit(env, org.id, id, who.user.id, 'create', b.name); return J({ id });
      }
      const m = p.match(/^\/api\/events\/(e_[a-z0-9]{20})(?:\/(\w+))?(?:\/(.+))?$/);
      if (m) {
        const [, id, sub, rest] = m, ev = await T.prepare('SELECT * FROM events WHERE id = ? AND org_id = ?').bind(id, org.id).first(); if (!ev) return err('لا يوجد', 404);
        if (!sub && M === 'GET') { const doc = JSON.parse(ev.draft); return J({ id, name: ev.name, status: ev.status, published_version: ev.published_version, active_from: ev.active_from, active_until: ev.active_until, credits: org.credits, doc, problems: problems(doc), base: `/m/${org.id}/${id}/` }); }
        if (!sub && M === 'PUT') { if (!can('editor')) return err('لا تملك صلاحية التعديل', 403); const doc = await req.json(); if (!doc || !Array.isArray(doc.cues)) return err('وثيقة غير صالحة');
          await T.prepare('UPDATE events SET draft = ?, name = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(doc), doc.name || ev.name, now(), id).run(); return J({ ok: true, problems: problems(doc) }); }
        if (!sub && M === 'DELETE') { if (!can('owner')) return err('للمالك فقط', 403); await T.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').bind('archived', now(), id).run(); await audit(env, org.id, id, who.user.id, 'archive'); return J({ ok: true }); }
        if (sub === 'publish' && M === 'POST') {   // freeze the draft as the next version: the screens of the hall read this one
          if (!can('editor')) return err('لا تملك صلاحية الاعتماد', 403); if (org.paid_until && org.paid_until < now()) return err('انتهى اشتراك الجهة', 402); const doc = JSON.parse(ev.draft), bad = problems(doc); if (bad.length) return J({ error: 'أكمل النواقص قبل الاعتماد', problems: bad }, 422);
          const v = (ev.published_version || 0) + 1; await T.batch([T.prepare('INSERT INTO event_versions (event_id, version, doc, published_by, published_at) VALUES (?,?,?,?,?)').bind(id, v, ev.draft, who.user.id, now()),
            T.prepare('UPDATE events SET published_version = ?, status = ?, updated_at = ? WHERE id = ?').bind(v, 'published', now(), id)]);
          await audit(env, org.id, id, who.user.id, 'publish', 'v' + v); const swept = await sweep(env, T, org.id, { ...ev, published_version: v }).catch(() => 0); return J({ version: v, swept });
        }
        if (sub === 'activate' && M === 'POST') {   // one activation day: from the morning of the chosen day (the browser's own midnight) for 24 hours, plus the evening before for the hall's set up
          if (!can('owner')) return err('التفعيل لمالك الحساب', 403); if (org.paid_until && org.paid_until < now()) return err('انتهى اشتراك الجهة', 402); const b = await req.json(), from = new Date(b.from); if (isNaN(from) || from.getTime() < Date.now() - 864e5) return err('تاريخ غير صالح');
          if (!ev.published_version) return err('اعتمد نسخة أولاً'); if (ev.active_until && ev.active_until > now()) return err('اللقاء مفعّل حتى ' + ev.active_until.slice(0, 10));
          const o = await env.DB.prepare('UPDATE orgs SET credits = credits - 1 WHERE id = ? AND credits > 0 RETURNING credits').bind(org.id).first(); if (!o) return err('لا أيام تفعيل في رصيدكم. تواصلوا معنا لإضافة يوم.', 402);
          const a = new Date(from.getTime() - 6 * 36e5).toISOString(), z = new Date(from.getTime() + 24 * 36e5).toISOString();
          await T.prepare('UPDATE events SET active_from = ?, active_until = ?, updated_at = ? WHERE id = ?').bind(a, z, now(), id).run(); await audit(env, org.id, id, who.user.id, 'activate', a + ' ' + z); return J({ active_from: a, active_until: z, credits: o.credits });
        }
        // a large file goes up in parts (16 MB each), so a long film survives a weak connection and can be retried part by part
        if (sub === 'upload' && M === 'POST') { if (!can('editor')) return err('لا تملك صلاحية الرفع', 403); const b = await req.json();
          if (b.start) { const used = (await T.prepare('SELECT COALESCE(SUM(bytes),0) AS b FROM media WHERE org_id = ?').bind(org.id).first()).b; if (used + (+b.size || 0) > org.storage_limit_mb * 1048576) return err('امتلأت مساحة الجهة', 402);
            const ext = (String(b.name).match(/\.(\w{2,5})$/) || [, 'mp4'])[1].toLowerCase(), file = 'f' + rid(8) + '.' + ext, key = `${org.id}/${id}/${file}`, up = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: b.type || 'video/mp4' } }); return J({ file, key, uploadId: up.uploadId }); }
          if (b.done) { if (!String(b.key).startsWith(`${org.id}/${id}/`)) return err('لا يوجد', 404); await env.MEDIA.resumeMultipartUpload(b.key, b.uploadId).complete(b.parts);
            await T.prepare('INSERT INTO media (id, org_id, event_id, kind, name, r2_key, bytes, created_at) VALUES (?,?,?,?,?,?,?,?)').bind('m_' + rid(), org.id, id, 'video', String(b.name).slice(0, 120), b.key, +b.size || 0, now()).run(); return J({ ok: true }); }
        }
        if (sub === 'upload' && M === 'PUT') { if (!can('editor')) return err('لا تملك صلاحية الرفع', 403); const q = url.searchParams, key = q.get('key'); if (!String(key).startsWith(`${org.id}/${id}/`)) return err('لا يوجد', 404);
          const part = await env.MEDIA.resumeMultipartUpload(key, q.get('uploadId')).uploadPart(+q.get('n'), req.body); return J({ partNumber: part.partNumber, etag: part.etag }); }
        if (sub === 'media' && M === 'PUT') {   // one file; slides arrive page by page (?slides=<media id>&n=<page>)
          if (!can('editor')) return err('لا تملك صلاحية الرفع', 403);
          const q = url.searchParams, kind = q.get('kind'), name = (q.get('name') || 'file').slice(0, 120), size = +req.headers.get('Content-Length') || 0; if (!['video', 'image', 'slides'].includes(kind)) return err('نوع غير معروف');
          const used = (await T.prepare('SELECT COALESCE(SUM(bytes),0) AS b FROM media WHERE org_id = ?').bind(org.id).first()).b; if (used + size > org.storage_limit_mb * 1048576) return err('امتلأت مساحة الجهة', 402);
          const mid = q.get('slides') || 'f' + rid(8), ext = (name.match(/\.(\w{2,5})$/) || [, kind === 'video' ? 'mp4' : 'jpg'])[1].toLowerCase();
          const file = kind === 'slides' ? `${mid}/s-${+q.get('n') || 1}.jpg` : `${mid}.${ext}`, key = `${org.id}/${id}/${file}`;
          await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' } });
          await T.prepare('INSERT INTO media (id, org_id, event_id, kind, name, r2_key, bytes, created_at) VALUES (?,?,?,?,?,?,?,?)').bind('m_' + rid(), org.id, id, kind, name, key, size, now()).run();
          return J({ id: mid, src: kind === 'slides' ? mid + '/' : file });
        }
        if (sub === 'links' && M === 'GET') { const { results } = await T.prepare('SELECT token_hash AS id, role, label, created_at FROM links WHERE event_id = ? AND revoked_at IS NULL ORDER BY created_at').bind(id).all(); return J({ links: results.map(l => ({ ...l, id: l.id.slice(0, 16) })) }); }
        if (sub === 'links' && M === 'POST') { if (!can('operator')) return err('لا تملك الصلاحية', 403); const b = await req.json(); if (!LINK_ROLES.includes(b.role)) return err('نوع شاشة غير معروف');
          const tok = org.id.slice(2) + '.' + rid(24); await T.prepare('INSERT INTO links (token_hash, org_id, event_id, role, label, created_at) VALUES (?,?,?,?,?,?)').bind(await sha(tok), org.id, id, b.role, b.label || '', now()).run();
          await audit(env, org.id, id, who.user.id, 'link', b.role); return J({ url: '/go/' + tok }); }   // the address is shown once; only its hash is kept
        if (sub === 'links' && M === 'DELETE' && rest) { if (!can('operator')) return err('لا تملك الصلاحية', 403); await T.prepare('UPDATE links SET revoked_at = ? WHERE event_id = ? AND substr(token_hash,1,16) = ?').bind(now(), id, rest).run(); return J({ ok: true }); }
      }
      return err('لا يوجد', 404);
    } catch (e) { return err('خطأ في الخادم: ' + (e && e.message || e), 500); }
  },
};
