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
const LINK_ROLES = ['stage', 'side', 'tablet', 'console', 'script'];   // console: operator commands; tablet: the launch press only
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
async function invite(env, email, days = 14) { const code = rid(28); await env.DB.prepare('INSERT INTO login_codes (code_hash, email, expires_at) VALUES (?,?,?)').bind(await sha(code), email, new Date(Date.now() + days * 864e5).toISOString()).run(); return '/join/' + code; }
// a session of 30 days for a user; returns the cookie
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
  let o = await env.MEDIA.get('_site/' + f); if (!o && !/\.\w+$/.test(f)) o = await env.MEDIA.get('_site/' + f + '.html');
  if (!o) return new Response('لا يوجد', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(o.body, { headers: { 'Content-Type': o.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': /\.(woff2|png|jpg)$/.test(f) ? 'public, max-age=604800' : 'no-cache', ETag: o.httpEtag } });
}
export default {
  async fetch(req, env) {
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
        if (await env.DB.prepare('SELECT 1 FROM orgs WHERE slug = ?').bind(s).first()) return err('المعرّف مستعمل');
        const u = await userFor(env, b.email, b.owner); if (!u) return err('بريد المالك غير صالح');
        const id = 'o_' + rid(); await env.DB.batch([
          env.DB.prepare('INSERT INTO orgs (id, name, slug, plan, events_limit, storage_limit_mb, paid_until, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, b.name, s, b.plan || 'trial', b.events_limit || 1, b.storage_limit_mb || 2000, b.paid_until || null, now()),
          env.DB.prepare('INSERT INTO members (org_id, user_id, role) VALUES (?,?,?)').bind(id, u.id, 'owner')]);
        // the organisation's own database is born here, with its first event
        await tdb(env, id).prepare('INSERT INTO events (id, org_id, slug, name, status, draft, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').bind('e_' + id.slice(2) + rid(8), id, 'first-' + rid(4), 'لقاؤكم الأول', 'draft', JSON.stringify(STARTER()), now(), now()).run();
        if (+b.credits > 0) await env.DB.prepare('UPDATE orgs SET credits = ? WHERE id = ?').bind(+b.credits, id).run();
        await audit(env, id, null, null, 'org', b.name); return J({ org: id, slug: s, join: await invite(env, u.email) });
      }
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
      if (p.startsWith('/join/')) {
        const h = await sha(p.slice(6)), c = await env.DB.prepare('SELECT email FROM login_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(h, now()).first();
        if (!c) return new Response('الرابط منتهٍ أو مستعمل. اطلب رابطاً جديداً من مالك الحساب.', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        const u = await userFor(env, c.email), t = rid(32);
        await env.DB.batch([env.DB.prepare('UPDATE login_codes SET used_at = ? WHERE code_hash = ?').bind(now(), h),
          env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').bind(await sha(t), u.id, new Date(Date.now() + 30 * 864e5).toISOString(), now())]);
        const first = await env.DB.prepare('SELECT o.slug FROM members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? LIMIT 1').bind(u.id).first();
        return new Response(null, { status: 302, headers: { Location: '/' + (first ? first.slug : ''), 'Set-Cookie': setCookie('sid', t, 30) } });
      }
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
            return new Response(JSON.stringify({ to: k.user_id === 'platform' ? '/admin.html' : '/' + (first ? first.slug : '') }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': await session(env, k.user_id) } }); }
        } catch (e) { return err(e.message || 'تعذّر التحقق', 400); }
        return err('لا يوجد', 404); }
      if (p === '/api/logout') return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': setCookie('sid', '', 0) } });
      // ----- a link of one screen: opens that page of that event, with no account
      if (p.startsWith('/go/')) {
        const tok = p.slice(4), l = /^[a-z0-9]{12}\.[a-z0-9]+$/.test(tok) ? await tdb(env, 'o_' + tok.slice(0, 12)).prepare('SELECT event_id, role FROM links WHERE token_hash = ? AND revoked_at IS NULL').bind(await sha(tok)).first() : null;
        if (!l) return new Response('هذا الرابط أُلغي. اطلب رابطاً جديداً من منظّم اللقاء.', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        return new Response(null, { status: 302, headers: { Location: `/run/${l.role === 'side' ? 'stage' : l.role}.html?e=${l.event_id}${l.role === 'side' ? '&side' : ''}`, 'Set-Cookie': setCookie('lk_' + l.event_id, tok, 30) } });
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
        if (!rehearse && !(ev.active_from && ev.active_from <= now() && now() < ev.active_until)) return err(ev.active_from && ev.active_from > now() ? 'يُفتح اللقاء في موعد تفعيله: ' + ev.active_from.slice(0, 10) : 'اللقاء غير مفعّل. فعّلوا يوم اللقاء من الاستوديو.', 402);
        const doc = rehearse ? JSON.parse(ev.draft) : JSON.parse((await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(evId, ver).first()).doc);
        if (seg[4] === 'config') return J({ doc: { ...doc, id: evId }, role, version: ver, base: `/m/${ev.org_id}/${ev.id}/` });
        if (seg[4] === 'ws' || seg[4] === 'state' || seg[4] === 'cmd') {
          const room = env.ROOM.get(env.ROOM.idFromName(evId + (rehearse ? ':draft' : ':live'))), h = new Headers(req.headers);
          h.set('x-role', role); h.set('x-ver', String(ver)); // the room needs the rules only, not the texts
          h.set('x-doc', encodeURIComponent(JSON.stringify({ cues: doc.cues.map(c => ({ id: c.id, type: c.type, media: c.media, after: c.after, fixed: c.fixed, off: c.off })),
            media: Object.fromEntries(Object.entries(doc.media || {}).map(([k, v]) => [k, { kind: v.kind, count: v.count, length: v.length }])), identity: { after: !!(doc.identity && doc.identity.after) } })));
          return room.fetch(new Request(req.url, { method: M, headers: h, body: M === 'POST' ? await req.text() : undefined }));
        }
        return err('لا يوجد', 404);
      }
      if (!p.startsWith('/api/')) {   // /<slug>: the studio of that organisation (the same page; it sends the slug with every request)
        const sl = p.match(/^\/([a-z0-9][a-z0-9-]{1,39})\/?$/); if (sl && !['run', 'fonts', 'vendor', 'engine', 'admin', 'brand'].includes(sl[1]) && await env.DB.prepare('SELECT 1 FROM orgs WHERE slug = ?').bind(sl[1]).first()) return site(env, req, '/');
        return site(env, req, url.pathname); }

      // ----- the studio (signed in people)
      const who = await me(req, env); if (!who) return err('سجّل الدخول من رابط الدعوة', 401);
      if (p === '/api/me') return J({ ...who, scenes: SCENES });
      const org = orgOf(who, req); if (!org) return err('لا توجد جهة لهذا الحساب', 403);
      const can = lvl => ROLES[org.role] >= ROLES[lvl], T = tdb(env, org.id);   // T: this organisation's own database
      if (p === '/api/members' && M === 'GET') { const { results } = await env.DB.prepare('SELECT u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?').bind(org.id).all(); return J({ members: results }); }
      if (p === '/api/members' && M === 'POST') {   // the owner adds a person: returns the link to hand to them
        if (!can('owner')) return err('للمالك فقط', 403); const b = await req.json(); if (!(b.role in ROLES)) return err('دور غير معروف');
        const u = await userFor(env, b.email, b.name); if (!u) return err('بريد غير صالح');
        await env.DB.prepare('INSERT INTO members (org_id, user_id, role) VALUES (?,?,?) ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role').bind(org.id, u.id, b.role).run();
        await audit(env, org.id, null, who.user.id, 'member', `${u.email} ${b.role}`); return J({ join: await invite(env, u.email) });
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
          if (!can('editor')) return err('لا تملك صلاحية الاعتماد', 403); const doc = JSON.parse(ev.draft), bad = problems(doc); if (bad.length) return J({ error: 'أكمل النواقص قبل الاعتماد', problems: bad }, 422);
          const v = (ev.published_version || 0) + 1; await T.batch([T.prepare('INSERT INTO event_versions (event_id, version, doc, published_by, published_at) VALUES (?,?,?,?,?)').bind(id, v, ev.draft, who.user.id, now()),
            T.prepare('UPDATE events SET published_version = ?, status = ?, updated_at = ? WHERE id = ?').bind(v, 'published', now(), id)]);
          await audit(env, org.id, id, who.user.id, 'publish', 'v' + v); return J({ version: v });
        }
        if (sub === 'activate' && M === 'POST') {   // one activation day: from the morning of the chosen day (the browser's own midnight) for 24 hours, plus the evening before for the hall's set up
          if (!can('owner')) return err('التفعيل لمالك الحساب', 403); const b = await req.json(), from = new Date(b.from); if (isNaN(from) || from.getTime() < Date.now() - 864e5) return err('تاريخ غير صالح');
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
