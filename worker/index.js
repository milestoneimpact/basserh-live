// The studio's server: organisations, people, events, files, links for the screens, and one room (Durable Object) per event.
// Every query carries the organisation of the signed in person; a screen link opens one event only.
import { SCENES, fontCss, isStations, launchTimes, problems, shape, stationCfg, stationOf } from '../web/engine/config.js';
import { reduce, stationMedia } from '../web/engine/state.js';
import { DUMMY, KEEP, failed, invite, locked, me, newPw, orgOf, platform, pwHash, pwOk, session, userFor } from './auth.js';
import { readBrand } from './brand.js';
import { BLANK, FEATURES, features, ORGS, PUB, STARTER, audit, backup, exportOrg, hasFeat, kickOrg, listAll, orgExists, padd, readKey, site, sweep } from './data.js';
import { mail, mailJoin } from './mail.js';
import { b64u, clientData, newChallenge, unb64u, verify } from './passkey.js';
import { orgOfEvent, tdb } from './tenant.js';
import { J, LINK_ROLES, ROLES, cookies, err, now, rid, setCookie, sha, slug } from './util.js';
export { Room } from './room.js';
export { Tenant } from './tenant.js';

let backupDay = '';
const main = {
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
        await env.DB.prepare('DELETE FROM login_fail WHERE ip = ?').bind(ip).run(); await padd(env, 'owner_login', req.headers.get('CF-Connecting-IP') || ''); return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': await session(env, await platform(env)) } }); }
      // a change asked from another site's page is refused (the cookie alone is not enough)
      if (!['GET', 'HEAD', 'OPTIONS'].includes(M) && req.headers.get('Origin') && req.headers.get('Origin') !== url.origin) return err('طلب من موقع آخر', 403);
      let admin = false; if (p.startsWith('/api/admin/')) { const hk = req.headers.get('x-admin-key');
        if (hk != null && p !== '/api/admin/login') { const kip = (req.headers.get('CF-Connecting-IP') || 'local') + '|key', kf = await locked(env, kip); if (!kf) return err('محاولات كثيرة. حاول بعد ربع ساعة.', 429); if (env.ADMIN_KEY && hk.length === env.ADMIN_KEY.length && (await sha(hk)) === (await sha(env.ADMIN_KEY))) admin = true; else { await failed(env, kip, kf.n, 10); return err('غير مصرح', 403); } }
        else admin = ((await me(req, env)) || {}).user?.id === 'platform'; }
      if (p.startsWith('/api/admin/') && !admin) return err('غير مصرح', 403);
      if (p === '/api/admin/me') return J({ ok: true, passkeys: (await env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind('platform').first()).n });
      // the pages of the site kept in the bucket (_site/): pushed by tools/push_site.mjs when the deploy cannot carry static files itself
      // ----- the platform owner: a new organisation and the link that signs its owner in
      if (p === '/api/admin/org' && M === 'POST') {
        const b = await req.json(), s = slug(b.slug || b.name); if (!b.name || !s) return err('اسم الجهة ومعرّفها مطلوبان');
        if (['login', 'admin', 'studio', 'run', 'api', 'm', 'go', 'join', 'screen', 'fonts', 'vendor', 'engine', 'brand'].includes(s)) return err('هذا العنوان محجوز للنظام');
        if (await env.DB.prepare('SELECT 1 FROM orgs WHERE slug = ?').bind(s).first()) return err(`العنوان /${s} مستعمل لجهة موجودة في القائمة. اختر عنواناً آخر.`);
        const pw0 = String(b.password || '').trim(); if (pw0 && pw0.length < 8) return err('كلمة المرور ثمانية أحرف على الأقل');
        const u = await userFor(env, b.email, b.owner); if (!u) return err('بريد المالك غير صالح');
        const id = 'o_' + rid(); await env.DB.batch([
          env.DB.prepare('INSERT INTO orgs (id, name, slug, plan, events_limit, storage_limit_mb, paid_until, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, b.name, s, b.plan || 'trial', b.events_limit || 3, b.storage_limit_mb || 2000, b.paid_until || null, now()),
          env.DB.prepare('INSERT INTO members (org_id, user_id, role) VALUES (?,?,?)').bind(id, u.id, 'owner')]);
        // the organisation's own database is born here, with its first event
        await tdb(env, id).prepare('INSERT INTO events (id, org_id, slug, name, status, draft, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').bind('e_' + id.slice(2) + rid(8), id, 'first-' + rid(4), 'لقاؤكم الأول', 'draft', JSON.stringify(STARTER()), now(), now()).run();
        await env.DB.prepare('UPDATE orgs SET credits = ? WHERE id = ?').bind(b.credits == null ? 1 : Math.max(0, +b.credits || 0), id).run();
        // the owner's password: the one the platform owner typed, or a generated one; shown once in the answer, kept hashed
        const password = pw0 || newPw(); await env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await pwHash(password), u.id).run();
        await audit(env, id, null, null, 'org', b.name); await padd(env, 'org_created', `${b.name} /${s}`); const join = await invite(env, u.email); return J({ org: id, slug: s, join, email: u.email, password, mailed: await mailJoin(env, url.origin, u.email, join, b.name) });
      }
      // ----- an organisation's data as a file; its end; the copies
      if (p === '/api/admin/export' && M === 'GET') { const d = await exportOrg(env, url.searchParams.get('org')); if (!d) return err('لا يوجد', 404); return new Response(JSON.stringify(d, null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${d.org.slug}-${now().slice(0, 10)}.json"` } }); }
      if (p === '/api/admin/org' && M === 'DELETE') {   // gone for good: its files, its database, its place among the organisations. The address must be typed to confirm
        const b = await req.json(), o = await env.DB.prepare('SELECT * FROM orgs WHERE id = ?').bind(b.id).first(); if (!o) return err('لا يوجد', 404); if (b.confirm !== o.slug) return err('اكتب عنوان الجهة للتأكيد');
        const keys = (await listAll(env, o.id + '/')).map(x => x.key); for (let i = 0; i < keys.length; i += 500) await env.MEDIA.delete(keys.slice(i, i + 500));
        await tdb(env, o.id).wipe(); await env.DB.batch([env.DB.prepare('DELETE FROM members WHERE org_id = ?').bind(o.id), env.DB.prepare('DELETE FROM orgs WHERE id = ?').bind(o.id)]); await padd(env, 'org_deleted', `${o.name} /${o.slug} · ${keys.length} ملف`); return J({ ok: true, files: keys.length }); }
      if (p === '/api/admin/backup' && M === 'POST') { const r = await backup(env); await padd(env, 'backup', r.day); return J(r); }
      if (p === '/api/admin/audit' && M === 'GET') return J({ audit: (await env.DB.prepare('SELECT action, detail, at FROM platform_audit ORDER BY id DESC LIMIT 200').all()).results });
      if (p === '/api/admin/restore' && M === 'POST') {   // an organisation's database as it was on a day of the copies; its files come back from the trash. The address is typed to confirm
        const b = await req.json().catch(() => ({})), o = await env.DB.prepare('SELECT * FROM orgs WHERE id = ?').bind(String(b.org || '')).first(); if (!o) return err('لا يوجد', 404); if (b.confirm !== o.slug) return err('اكتب عنوان الجهة للتأكيد');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.day || ''))) return err('اختر يوماً'); const f = await env.MEDIA.get(`_backup/${b.day}/${o.id}.json`); if (!f) return err('لا نسخة لهذه الجهة في هذا اليوم', 404); const d = await f.json();
        await env.MEDIA.put(`_backup/${now().slice(0, 10)}/${o.id}.before-restore-${Date.now()}.json`, JSON.stringify(await exportOrg(env, o.id, true)));   // the present is kept first, so a restore can itself be undone
        const T = tdb(env, o.id), st = ['questions', 'audit', 'links', 'media', 'event_versions', 'events'].map(t => ({ sql: `DELETE FROM ${t}`, params: [] }));
        for (const t of ['events', 'event_versions', 'media', 'links', 'audit', 'questions']) for (const r of d[t] || []) { if (t === 'links' && !r.token_hash) continue; const k = Object.keys(r); st.push({ sql: `INSERT INTO ${t} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, params: k.map(x => r[x]) }); }
        await T.batch(st); let back = 0; for (const x of d.files || []) { if (await env.MEDIA.head(x.key)) continue; const t = await env.MEDIA.get('_trash/' + x.key); if (t) { await env.MEDIA.put(x.key, t.body, { httpMetadata: t.httpMetadata }); back++; } }
        await kickOrg(env, o.id); await padd(env, 'restored', `${o.name} /${o.slug} ← ${b.day} · ${(d.events || []).length} لقاء · ${back} ملف`); return J({ ok: true, events: (d.events || []).length, files: back }); }
      if (p === '/api/admin/backup/days' && M === 'GET') { const org = url.searchParams.get('org'); return J({ days: [...new Set((await listAll(env, '_backup/')).filter(x => x.key.endsWith('/' + org + '.json')).map(x => x.key.split('/')[1]))].sort().reverse() }); }
      if (p === '/api/admin/backup' && M === 'GET') { const days = [...new Set((await listAll(env, '_backup/')).map(o => o.key.split('/')[1]))].sort(); return J({ days, last: days[days.length - 1] || null }); }
      if (p === '/api/admin/password' && M === 'POST') {   // a new password for a member of an organisation (the old one stops working)
        const b = await req.json(), u = await env.DB.prepare('SELECT u.id, u.email FROM users u JOIN members m ON m.user_id = u.id WHERE m.org_id = ? AND u.email = ?').bind(b.org, String(b.email || '').toLowerCase()).first(); if (!u) return err('ليس عضواً في هذه الجهة', 404);
        const password = String(b.password || '').trim() || newPw(); if (password.length < 8) return err('كلمة المرور ثمانية أحرف على الأقل');
        await env.DB.batch([env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await pwHash(password), u.id), env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id)]); await audit(env, b.org, null, null, 'password', u.email); await padd(env, 'password_renewed', u.email); return J({ email: u.email, password }); }
      if (p === '/api/admin/leads' && M === 'GET') return J({ leads: (await env.DB.prepare('SELECT id, name, org, phone, email, kind, event_date, message, created_at, handled_at, mailed FROM leads ORDER BY id DESC LIMIT 200').all()).results, mail: !!((env.EMAIL || env.RESEND_KEY) && env.CONTACT_TO) });
      if (p === '/api/admin/leads' && M === 'PATCH') { const b = await req.json(); await env.DB.prepare('UPDATE leads SET handled_at = ? WHERE id = ?').bind(b.handled ? now() : null, b.id).run(); return J({ ok: true }); }
      if (p === '/api/admin/site' && M === 'PUT') { const f = url.searchParams.get('path') || ''; if (!/^[\w./-]+$/.test(f) || f.includes('..')) return err('مسار غير صالح'); await env.MEDIA.put('_site/' + f, req.body, { httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' } }); return J({ ok: true }); }
      if (p === '/api/admin/org' && M === 'PATCH') {   // the plan of an organisation: limits, the paid period, activation days added
        const b = await req.json(), o = await env.DB.prepare('SELECT * FROM orgs WHERE id = ?').bind(b.id).first(); if (!o) return err('لا يوجد', 404);
        const feats = Array.isArray(b.features) ? b.features.filter(f => FEATURES[f]).join(' ') : (o.features || '');
        await env.DB.prepare('UPDATE orgs SET name = ?, plan = ?, events_limit = ?, storage_limit_mb = ?, paid_until = ?, credits = ?, features = ? WHERE id = ?').bind(b.name ?? o.name, b.plan ?? o.plan, b.events_limit ?? o.events_limit, b.storage_limit_mb ?? o.storage_limit_mb, b.paid_until === undefined ? o.paid_until : b.paid_until, Math.max(0, o.credits + (+b.add_credits || 0)), feats, o.id).run();
        if (b.plan === 'off') { ORGS.delete(o.id); await env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM members WHERE org_id = ?) AND user_id NOT IN (SELECT user_id FROM members m JOIN orgs x ON x.id = m.org_id WHERE x.plan != ? AND x.id != ?)').bind(o.id, 'off', o.id).run(); await kickOrg(env, o.id); }
        await audit(env, o.id, null, null, 'plan', JSON.stringify(b)); await padd(env, 'org_changed', `${o.name} /${o.slug} ${JSON.stringify({ ...b, id: undefined })}`); return J({ ok: true });
      }
      if (p === '/api/admin/invite' && M === 'POST') { const b = await req.json(), u = await userFor(env, b.email); if (!u) return err('بريد غير صالح'); await env.DB.prepare('INSERT INTO members (org_id, user_id, role) VALUES (?,?,?) ON CONFLICT (org_id, user_id) DO NOTHING').bind(b.org, u.id, 'owner').run(); return J({ join: await invite(env, u.email) }); }
      if (p === '/api/admin/unlock' && M === 'POST') { const b = await req.json(), slug2 = String(b.slug || ''); if (!slug2) return err('أي جهة؟'); const r = await env.DB.prepare("DELETE FROM login_fail WHERE ip LIKE ?").bind('%|' + slug2).run(); await padd(env, 'door_unlocked', '/' + slug2); return J({ ok: true, cleared: r.meta ? r.meta.changes : 0 }); }
      if (p === '/api/admin/orgs' && M === 'GET') { await features(env);
        const { results } = await env.DB.prepare('SELECT o.*, (SELECT GROUP_CONCAT(u.email) FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.role = ?) AS owners FROM orgs o ORDER BY created_at DESC').bind('owner').all();
        // usage comes from each organisation's own database
        const fails = (await env.DB.prepare("SELECT ip, n, until FROM login_fail WHERE ip LIKE '%|%'").all()).results, lockOf = sl => { const f = fails.filter(x => x.ip.endsWith('|' + sl)); return { locked: f.some(x => x.until && x.until > now()), until: f.map(x => x.until).filter(x => x && x > now()).sort().pop() || null, wrong: f.reduce((a, x) => Math.max(a, x.n), 0) }; };
        return J({ orgs: (await Promise.all(results.map(async o => { const [[c], [b], active] = await tdb(env, o.id).batch([{ sql: 'SELECT COUNT(*) AS n FROM events WHERE status != ?', params: ['archived'] }, { sql: 'SELECT COALESCE(SUM(bytes),0) AS b FROM media', params: [] }, { sql: 'SELECT name, active_from, active_until FROM events WHERE active_until > ? ORDER BY active_from', params: [now()] }]); return { ...o, events: c.n, bytes: b.b, active }; }))).map(o => ({ ...o, door: lockOf(o.slug) })) });
      }
      // ----- signing in by a link (no password): the link is used once and opens a session of 30 days
      if (p === '/api/login' && M === 'POST') {   // the studio's gate: email and password
        const b = await req.json().catch(() => ({})); let u = null;
        const byDoor = !!b.slug && !b.email, mail = String(b.email || '').trim().toLowerCase().slice(0, 120), ip = (req.headers.get('CF-Connecting-IP') || 'local') + '|' + (byDoor ? String(b.slug).slice(0, 60) : 'login'), f = await locked(env, ip); if (!f) return err('محاولات كثيرة. حاول بعد ربع ساعة.', 429);   // counted per address and per door
        // and the door itself: twenty wrong passwords from anywhere close it for a quarter of an hour, so guessing from many addresses gains nothing
        const door = byDoor ? '*|' + String(b.slug).slice(0, 60) : '@|' + mail, fd = await locked(env, door); if (!fd) return err('محاولات كثيرة على هذا العنوان. حاول بعد ربع ساعة، أو ادخل بمفتاح المرور.', 429);
        // at an organisation's own address the password is enough: it is tried against the members of that organisation only
        if (b.slug && !b.email) { const { results } = await env.DB.prepare("SELECT u.id, u.pw FROM users u JOIN members m ON m.user_id = u.id JOIN orgs o ON o.id = m.org_id WHERE o.slug = ? AND o.plan != 'off' AND u.pw IS NOT NULL ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 8").bind(String(b.slug)).all();
          for (const x of results) if (await pwOk(String(b.password || ''), x.pw)) { u = x; break; }
          if (!u) { await failed(env, ip, f.n); await failed(env, door, fd.n, 20); return err('كلمة المرور غير صحيحة', 403); } }
        else { u = await env.DB.prepare('SELECT id, pw FROM users WHERE email = ?').bind(String(b.email || '').trim().toLowerCase()).first();
          if (!(await pwOk(String(b.password || ''), u ? u.pw : DUMMY)) || !u || u.id === 'platform') { await failed(env, ip, f.n); await failed(env, door, fd.n, 20); return err('البريد أو كلمة المرور غير صحيحة', 403); } }
        await env.DB.prepare('DELETE FROM login_fail WHERE ip IN (?, ?)').bind(ip, door).run();
        if (b.slug) { const on = await env.DB.prepare('SELECT name FROM orgs WHERE slug = ?').bind(String(b.slug)).first(); return new Response(JSON.stringify({ ok: true, to: '/' + b.slug, name: on ? on.name : '' }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': await session(env, u.id) } }); }
        const first = await env.DB.prepare('SELECT o.slug FROM members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? LIMIT 1').bind(u.id).first();
        return new Response(JSON.stringify({ ok: true, to: '/' + (first ? first.slug : 'login') }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': await session(env, u.id) } }); }
      if (p === '/api/password' && M === 'POST') {   // a signed in member sets a password of their own
        const w = await me(req, env); if (!w || !w.user || w.user.id === 'platform') return err('ادخل أولاً', 401); const b = await req.json().catch(() => ({})), pw = String(b.password || ''); if (pw.length < 8) return err('كلمة المرور ثمانية أحرف على الأقل');
        await env.DB.batch([env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await pwHash(pw), w.user.id), env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(w.user.id, await sha(cookies(req).sid))]); return J({ ok: true }); }   // the other devices are signed out
      if (p.startsWith('/join/')) {
        const h = await sha(p.slice(6)), c = await env.DB.prepare('SELECT email FROM login_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(h, now()).first();
        if (!c) return new Response('الرابط منتهٍ أو مستعمل. اطلب رابطاً جديداً من مالك الحساب.', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        const u = await userFor(env, c.email), t = rid(32);
        await env.DB.batch([env.DB.prepare('UPDATE login_codes SET used_at = ? WHERE code_hash = ?').bind(now(), h),
          env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').bind(await sha(t), u.id, new Date(Date.now() + KEEP * 864e5).toISOString(), now())]);
        const first = await env.DB.prepare('SELECT o.slug FROM members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? LIMIT 1').bind(u.id).first();
        return new Response(null, { status: 302, headers: { Location: '/' + (first ? first.slug : 'login'), 'Set-Cookie': setCookie('sid', t, KEEP) } });
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
      if (p === '/api/passkeys' && (M === 'GET' || M === 'DELETE')) { const w = await me(req, env); if (!w || !w.user) return err('ادخل أولاً', 401);
        if (M === 'DELETE') { const id = url.searchParams.get('id') || ''; await env.DB.prepare('DELETE FROM passkeys WHERE cred_id = ? AND user_id = ?').bind(id, w.user.id).run(); if (w.user.id === 'platform') await padd(env, 'passkey_removed', id.slice(0, 10)); return J({ ok: true }); }
        return J({ passkeys: (await env.DB.prepare('SELECT cred_id AS id, label, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at').bind(w.user.id).all()).results }); }
      // ----- passkeys: add one while signed in; sign in with one from the gate (the device offers the passkeys it holds for this site)
      if (p.startsWith('/api/passkey/')) { const b = M === 'POST' ? await req.json().catch(() => ({})) : {};
        // the browser names the site it signed for; it must be this site (or localhost in development, where the server answers under the route's name)
        const site = o => { const h = new URL(o).hostname; if (o !== url.origin && !(h === 'localhost' && env.LOCAL === '1')) throw new Error('العنوان غير مطابق'); /* «localhost» only on a developer's machine (the dev server is started with LOCAL=1), never on the deployed site */ return h; };
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
      if (p === '/api/logout') { const t = cookies(req).sid; if (t) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha(t)).run();   // signing out ends the session itself, not only this browser's copy of it
        return new Response(null, { status: 302, headers: { Location: '/login', 'Set-Cookie': setCookie('sid', '', 0) } }); }
      // ----- a link of one screen: opens that page of that event, with no account
      // ----- a screen paired by a code: the screen opens /screen and shows six digits; the operator types them on the board and picks the station.
      // The table holds no content of any organisation: a code, the screen's secret, and (once claimed) the screen link it is handed, for ten minutes
      if (p === '/api/pair/new' && M === 'POST') { await features(env); const ip = req.headers.get('CF-Connecting-IP') || 'local', ago = new Date(Date.now() - 6e5).toISOString();
        await env.DB.prepare('DELETE FROM pairs WHERE created_at < ?').bind(ago).run(); if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM pairs WHERE ip = ?').bind(ip).first()).n >= 20) return err('شاشات كثيرة تنتظر الربط من هذه الشبكة. انتظروا دقائق.', 429);
        for (let i = 0; i < 8; i++) { const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)), secret = rid(24); try { await env.DB.prepare('INSERT INTO pairs (code, secret_hash, ip, created_at) VALUES (?,?,?,?)').bind(code, await sha(secret), ip, now()).run(); return J({ code, secret, ttl: 600 }); } catch {} }
        return err('تعذّر إنشاء رمز. أعيدوا المحاولة.', 503); }
      { const pm = p.match(/^\/api\/pair\/(\d{6})$/); if (pm && M === 'GET') { await features(env); const r = await env.DB.prepare('SELECT secret_hash, go, created_at FROM pairs WHERE code = ?').bind(pm[1]).first();
        if (!r || r.secret_hash !== await sha(url.searchParams.get('s') || '') || r.created_at < new Date(Date.now() - 6e5).toISOString()) return J({ gone: true }); if (!r.go) return J({ wait: true });
        await env.DB.prepare('DELETE FROM pairs WHERE code = ?').bind(pm[1]).run(); return J({ go: r.go }); } }
      if (p.startsWith('/go/')) {
        const tok = p.slice(4), l = /^[a-z0-9]{12}\.[a-z0-9]+$/.test(tok) && await orgExists(env, 'o_' + tok.slice(0, 12)) ? await tdb(env, 'o_' + tok.slice(0, 12)).prepare('SELECT event_id, role FROM links WHERE token_hash = ? AND revoked_at IS NULL').bind(await sha(tok)).first() : null;
        if (l) ctx.waitUntil(tdb(env, 'o_' + tok.slice(0, 12)).prepare('UPDATE links SET opened_at = ? WHERE token_hash = ?').bind(now(), await sha(tok)).run().catch(() => {}));   // the studio shows which links have reached their devices
        if (!l) return new Response('هذا الرابط أُلغي. اطلب رابطاً جديداً من منظّم اللقاء.', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        return new Response(null, { status: 302, headers: { Location: `/run/${['side', 'logo'].includes(l.role) ? 'stage' : l.role === 'hall' ? 'station' : l.role}.html?e=${l.event_id}${['side', 'logo'].includes(l.role) ? '&' + l.role : ''}`, 'Set-Cookie': setCookie('lk_' + l.event_id, tok, 30) } });
      }
      // ----- a visitor's phone, from a station's QR code: that station's file only, by a key only the station's screen was given; on the event's day (or in its rehearsal)
      if (p.startsWith('/api/read/')) { const mm = p.match(/^\/api\/read\/(e_[a-z0-9]{20})\/([A-Za-z0-9][A-Za-z0-9_-]{0,39})\/([ld])\/([0-9a-f]{24})(?:\/(file|logo))?$/); if (!mm || M !== 'GET') return err('لا يوجد', 404);
        const [, evId, sid, mode, key, what] = mm; if (!(await orgExists(env, orgOfEvent(evId)))) return err('لا يوجد', 404); if (key !== await readKey(env, evId, sid, mode === 'd')) return err('رمز غير صالح', 403);
        const T = tdb(env, orgOfEvent(evId)), ev = await T.prepare('SELECT id, org_id, draft, published_version, active_from, active_until FROM events WHERE id = ?').bind(evId).first(); if (!ev) return err('لا يوجد', 404);
        if (mode === 'l' && !(ev.published_version && ev.active_from && ev.active_from <= now() && now() < ev.active_until)) return err('انتهى وقت العرض. شكراً لزيارتكم.', 410);
        const doc = mode === 'd' ? JSON.parse(ev.draft) : JSON.parse((await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(evId, ev.published_version).first()).doc), st = stationOf(doc, sid);
        if (!isStations(doc) || !st || !stationCfg(st).qr) return err('القراءة من الجوال غير متاحة لهذه المحطة', 403);
        const room = await (await env.ROOM.get(env.ROOM.idFromName(evId + (mode === 'd' ? ':draft' : ':live'))).fetch(new Request('https://room/log'))).json().catch(() => ({})), mk = stationMedia(doc, room.state, sid), m = mk && doc.media[mk], I = doc.identity.before || {};
        if (!what) return J({ name: doc.name, station: st.name, place: st.place || '', title: m ? m.name : '', pages: m ? m.count || 0 : 0, dir: stationCfg(st).dir, media: mk || '', colors: I.colors || {}, font: fontCss(I), logo: !!I.logo });
        const file = what === 'logo' ? I.logo : m && m.src; if (!file) return err('لا يوجد', 404); const o = await env.MEDIA.get(`${ev.org_id}/${ev.id}/${file}`); if (!o) return err('لا يوجد', 404);
        const ct = o.httpMetadata?.contentType || '', img = /^image\/(png|jpeg|webp|gif)$/.test(ct);
        return new Response(o.body, { headers: { 'Content-Type': img ? ct : 'application/octet-stream', 'Content-Length': String(o.size), 'Cache-Control': 'private, max-age=600', ETag: o.httpEtag } }); }
      // ----- the running event (screens): who is asking, the document, the files, the room
      if (p.startsWith('/api/run/') || p.startsWith('/m/')) {
        const seg = p.split('/'), evId = p.startsWith('/m/') ? seg[3] : seg[3];
        if (!/^e_[a-z0-9]{20}$/.test(evId) || !(await orgExists(env, orgOfEvent(evId)))) return err('لا يوجد', 404); const T = tdb(env, orgOfEvent(evId));
        const ev = await T.prepare('SELECT id, org_id, draft, published_version, active_from, active_until FROM events WHERE id = ?').bind(evId).first(); if (!ev) return err('لا يوجد', 404);
        let role = null; const tok = cookies(req)['lk_' + evId];
        let label = ''; if (tok) { const l = await T.prepare('SELECT role, label FROM links WHERE token_hash = ? AND event_id = ? AND revoked_at IS NULL').bind(await sha(tok), evId).first(); if (l) { role = l.role; label = l.label || ''; } }
        const who = await me(req, env), mem = who && who.orgs.find(o => o.id === ev.org_id); if (mem) role = ROLES[mem.role] >= 1 ? 'console' : (role || 'viewer');
        if (!role) return err('افتح الشاشة من رابطها', 401);
        if (role === 'audience' && p.startsWith('/m/')) { const pubDoc = ev.published_version ? JSON.parse((await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(evId, ev.published_version).first()).doc) : null, okFiles = pubDoc ? ['before', 'after'].map(k => (pubDoc.identity[k] || {}).logo).filter(Boolean) : []; if (!okFiles.includes(decodeURIComponent(p.split('/').slice(4).join('/')))) return err('لا يوجد', 404); }
        if (p.startsWith('/m/')) {   // /m/<org>/<event>/<file>: the files of the event, in its own folder of the bucket
          const key = decodeURIComponent(p.slice(3)); if (!key.startsWith(ev.org_id + '/' + ev.id + '/')) return err('لا يوجد', 404);
          const range = req.headers.get('Range'), o = await env.MEDIA.get(key, range ? { range: req.headers } : {}); if (!o) return err('لا يوجد', 404);
          const ct = o.httpMetadata?.contentType || '', safe = /^(video\/(mp4|webm|quicktime)|image\/(png|jpeg|webp|gif|svg\+xml))$/.test(ct);   // a video or a picture; anything else is handed over as a download, never shown
          const h = { 'Content-Type': safe ? ct : 'application/octet-stream', ...(safe ? {} : { 'Content-Disposition': 'attachment' }), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', ETag: o.httpEtag };
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
          if (seg[4] === 'config' && ['stage', 'side', 'logo', 'console', 'station', 'hall'].includes(role)) { const d = JSON.parse((await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(evId, ver).first()).doc), base = `/m/${ev.org_id}/${ev.id}/`, L = (d.cues || []).find(c => c.type === 'launch'), all = role !== 'side' && role !== 'logo', files = [];
            if (role === 'hall') { for (const m of Object.values(d.media || {})) if (m.kind === 'pdf') files.push(base + m.src); const I = (d.identity || {}).before; if (I && I.logo) files.push(base + I.logo); return J({ error: why, prep: { name: d.name, station: '', files } }, 402); }
            if (role === 'station') { const st = stationOf(d, label); if (st && d.media[st.media]) files.push(base + d.media[st.media].src); for (const k of ['before']) { const I = (d.identity || {})[k]; if (I && I.logo) files.push(base + I.logo); } return J({ error: why, prep: { name: d.name, station: st ? st.name : '', files } }, 402); }
            for (const [k, m] of Object.entries(d.media || {})) { if (!all && !(L && L.media === k)) continue; if (m.kind === 'slides') for (let i = 1; i <= (m.count || 0); i++) files.push(base + m.src + 's-' + i + '.jpg'); else files.push(base + m.src); }
            for (const k of ['before', 'after']) { const I = (d.identity || {})[k]; if (I && I.logo) files.push(base + I.logo); }
            return J({ error: why, prep: { name: d.name, files } }, 402); }
          return err(why, 402); }
        const doc = rehearse ? JSON.parse(ev.draft) : JSON.parse((await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(evId, ver).first()).doc);
        // ----- the audience's page: the programme and where it stands. Never the moderator's words, nor a cue or a logo of the new identity before the launch has revealed it
        if (role === 'audience' && !['pub', 'ask', 'ws'].includes(seg[4])) return err('لا صلاحية', 403); /* ws: a bare signal that something changed, never the state itself */
        if ((role === 'station' || role === 'hall') && !['config', 'ws', 'state'].includes(seg[4])) return err('لا صلاحية', 403);   // a station reads its event and its room, nothing else
        const theRoom = () => env.ROOM.get(env.ROOM.idFromName(evId + (rehearse ? ':draft' : ':live')));
        if (seg[4] === 'pub') { const pk = evId + (rehearse ? ':d' : ':l') + ver, hit = PUB.get(pk); if (hit && Date.now() - hit.at < 3000) return new Response(hit.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
          const st = ((await (await theRoom().fetch(new Request('https://room/log'))).json().catch(() => ({}))).state) || {}, launched = !!st.launchedAt && Date.now() >= st.launchedAt + launchTimes(doc).reveal * 1000, hasL = doc.cues.some(c => c.type === 'launch');
          const I = launched && doc.identity.after ? doc.identity.after : doc.identity.before, off = Array.isArray(st.off) ? st.off : doc.cues.filter(c => c.off).map(c => c.id), ord = Array.isArray(st.order) && st.order.length === doc.cues.length ? st.order.map(i => doc.cues.find(c => c.id === i)).filter(Boolean) : doc.cues;
          const shownCues = ord.filter(c => !off.includes(c.id) && ['title', 'speaker', 'video', 'slides', 'launch'].includes(c.type) && (launched || !hasL || !c.after)).map(c => ({ id: c.id, title: c.title, who: c.person && doc.people[c.person] ? [doc.people[c.person].honorific, doc.people[c.person].name].filter(Boolean).join(' · ') : '' }));
          const cur = st.live ? st.cue : null, curC = cur && doc.cues.find(c => c.id === cur), hid = curC && curC.after && hasL && !launched;
          const body = JSON.stringify({ name: doc.name, live: !!st.live, cue: hid ? null : cur, ask: !(doc.audience && doc.audience.ask === false), logo: I.logo ? `/m/${ev.org_id}/${ev.id}/${I.logo}` : '', colors: I.colors || {}, font: fontCss(I), cues: shownCues, in: st.launchedAt && !launched && hasL ? Math.max(0, Math.ceil(st.launchedAt + launchTimes(doc).reveal * 1000 - Date.now())) : 0 }); /* in: how long until the reveal, so the phones read again at that moment */ if (PUB.size > 500) PUB.clear(); PUB.set(pk, { at: Date.now(), body }); return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }
        if (seg[4] === 'ask' && M === 'POST') { if (doc.audience && doc.audience.ask === false) return err('الأسئلة مغلقة في هذا اللقاء', 403); const b = await req.json().catch(() => ({})), text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 300), name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 60); if (text.length < 3) return err('اكتب سؤالك');
          const ip = req.headers.get('CF-Connecting-IP') || 'local', recent = (await T.prepare('SELECT COUNT(*) AS n FROM questions WHERE event_id = ? AND ip = ? AND at > ?').bind(evId, ip, new Date(Date.now() - 6e4).toISOString()).first()).n; if (recent >= 3) return err('وصلتنا أسئلتك. انتظر دقيقة قبل سؤال آخر.', 429);
          if ((await T.prepare('SELECT COUNT(*) AS n FROM questions WHERE event_id = ? AND at > ?').bind(evId, new Date(Date.now() - 6e4).toISOString()).first()).n >= 40) return err('أسئلة كثيرة الآن. حاول بعد دقيقة.', 429);   // the whole hall: forty a minute, whatever addresses they come from
          if ((await T.prepare('SELECT COUNT(*) AS n FROM questions WHERE event_id = ?').bind(evId).first()).n >= 2000) return err('اكتمل عدد الأسئلة في هذا اللقاء', 429);
          await T.prepare('INSERT INTO questions (event_id, text, name, ip, at) VALUES (?,?,?,?,?)').bind(evId, text, name, ip, now()).run(); return J({ ok: true }); }
        if (seg[4] === 'questions') { if (role !== 'console') return err('للمشغّل فقط', 403);
          if (M === 'POST') { const b = await req.json().catch(() => ({})); if (!['new', 'shown', 'hidden'].includes(b.state)) return err('حالة غير معروفة'); await T.prepare('UPDATE questions SET state = ? WHERE id = ? AND event_id = ?').bind(b.state, +b.id, evId).run(); return J({ ok: true }); }
          return J({ questions: (await T.prepare("SELECT id, text, name, at, state FROM questions WHERE event_id = ? AND state != 'hidden' ORDER BY id DESC LIMIT 100").bind(evId).all()).results }); }
        if (seg[4] === 'pair' && M === 'POST') { if (role !== 'console') return err('للمشغّل فقط', 403); if (rehearse) return err('اعتمدوا اللقاء أولاً، فالربط للشاشات الحقيقية', 409);
          const b = await req.json().catch(() => ({})), code = String(b.code || '').replace(/\D/g, ''), st = stationOf(doc, b.station); if (!st) return err('اختر المحطة'); if (code.length !== 6) return err('الرمز ستة أرقام');
          await features(env); const r = await env.DB.prepare('SELECT go, created_at FROM pairs WHERE code = ?').bind(code).first(); if (!r || r.go || r.created_at < new Date(Date.now() - 6e5).toISOString()) return err('الرمز غير صحيح أو انتهى. انظروا إلى الشاشة: يتجدد رمزها كل عشر دقائق.', 404);
          const tok = ev.org_id.slice(2) + '.' + rid(24); await T.prepare('INSERT INTO links (token_hash, org_id, event_id, role, label, created_at) VALUES (?,?,?,?,?,?)').bind(await sha(tok), ev.org_id, evId, 'station', st.id, now()).run();
          await env.DB.prepare('UPDATE pairs SET go = ? WHERE code = ? AND go IS NULL').bind('/go/' + tok, code).run(); await audit(env, ev.org_id, evId, who ? who.user.id : null, 'pair', st.id); return J({ ok: true, station: st.name }); }
        if (seg[4] === 'config' && isStations(doc)) { const keys = {}; for (const st of doc.stations || []) if (stationCfg(st).qr && (role === 'console' || role === 'hall' || (role === 'station' && st.id === label))) keys[st.id] = await readKey(env, evId, st.id, rehearse); return J({ doc: { ...doc, id: evId }, role, label, version: ver, base: `/m/${ev.org_id}/${ev.id}/`, read: keys }); }
        if (seg[4] === 'config') return J({ doc: ['console', 'script'].includes(role) ? { ...doc, id: evId } : { ...doc, id: evId, cues: doc.cues.map(c => ({ ...c, moderator: [] })) }, role, label, version: ver, base: `/m/${ev.org_id}/${ev.id}/` });   // label: the name the organisation gave this screen's link
        if (seg[4] === 'ws' || seg[4] === 'state' || seg[4] === 'cmd') {
          const room = env.ROOM.get(env.ROOM.idFromName(evId + (rehearse ? ':draft' : ':live'))), h = new Headers(req.headers);
          h.set('x-role', role); h.set('x-ver', String(ver)); // the room needs the rules only, not the texts
          h.set('x-doc', encodeURIComponent(JSON.stringify({ cues: doc.cues.map(c => ({ id: c.id, type: c.type, media: c.media, after: c.after, fixed: c.fixed, off: c.off, style: c.style, count: c.count, hands: c.hands })),
            media: Object.fromEntries(Object.entries(doc.media || {}).map(([k, v]) => [k, { kind: v.kind, count: v.count, length: v.length }])), identity: { after: !!(doc.identity && doc.identity.after) }, mode: doc.mode, stations: (doc.stations || []).map(x => ({ id: x.id, media: x.media })) })));
          return room.fetch(new Request(req.url, { method: M, headers: h, body: M === 'POST' ? await req.text() : undefined }));
        }
        return err('لا يوجد', 404);
      }
      if (!p.startsWith('/api/')) {   // /<slug>: the studio of that organisation (the same page; it sends the slug with every request)
        if (p === '/screen' || p === '/screen/') return site(env, req, '/run/pair');   // the address a screen is set to open at every start: a code to pair it, then its station
        const sl = p.match(/^\/([a-z0-9][a-z0-9-]{1,39})\/?$/); if (p === '/login' || (sl && !['run', 'fonts', 'vendor', 'engine', 'admin', 'brand', 'studio'].includes(sl[1]) && await env.DB.prepare("SELECT 1 FROM orgs WHERE slug = ? AND plan != 'off'").bind(sl[1]).first())) return site(env, req, '/studio');   // «/» is the public page; the studio opens at /login and at each organisation's address
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
        await env.DB.prepare('DELETE FROM members WHERE org_id = ? AND user_id = ?').bind(org.id, u.id).run(); await audit(env, org.id, null, who.user.id, 'member_removed', b.email); await kickOrg(env, org.id); return J({ ok: true }); }   // an open console of the removed person is cut off now
      if (p === '/api/audit' && M === 'GET') {   // what was done in the organisation, and by whom
        if (!can('owner')) return err('للمالك فقط', 403); const { results } = await T.prepare('SELECT a.event_id, a.user_id, a.action, a.detail, a.at, e.name AS event FROM audit a LEFT JOIN events e ON e.id = a.event_id ORDER BY a.id DESC LIMIT 200').all();
        const ids = [...new Set(results.map(r => r.user_id).filter(Boolean))], who2 = {}; for (const i of ids) { const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(i).first(); who2[i] = u ? u.email : ''; }
        return J({ audit: results.map(r => ({ ...r, by: who2[r.user_id] || (r.user_id ? '' : 'بصيرة') })), usage: (await T.prepare('SELECT COALESCE(SUM(bytes),0) AS b FROM media').first()).b, limit_mb: org.storage_limit_mb }); }
      if (p === '/api/members' && M === 'POST') {   // the owner adds a person: returns the link to hand to them
        if (!can('owner')) return err('للمالك فقط', 403); const b = await req.json(); if (!(b.role in ROLES)) return err('دور غير معروف');
        const u = await userFor(env, b.email, b.name); if (!u) return err('بريد غير صالح');
        // a password for the member, typed by the owner: it opens the organisation's address as this member, so it must differ from the others'
        if (b.password) { const pw = String(b.password); if (pw.length < 8) return err('كلمة المرور ثمانية أحرف على الأقل');
          const has = await env.DB.prepare('SELECT pw, (SELECT COUNT(*) FROM members WHERE user_id = users.id AND org_id != ?) AS other FROM users WHERE id = ?').bind(org.id, u.id).first(); if (has && (has.other > 0 || (has.pw && !(await env.DB.prepare('SELECT 1 FROM members WHERE user_id = ? AND org_id = ?').bind(u.id, org.id).first())))) return err('لهذا البريد حساب قائم. أضفه بلا كلمة مرور، ويدخل بكلمته أو برابط الدعوة.');
          const { results } = await env.DB.prepare('SELECT u.id, u.pw FROM users u JOIN members m ON m.user_id = u.id WHERE m.org_id = ? AND u.pw IS NOT NULL AND u.id != ?').bind(org.id, u.id).all();
          for (const x of results) if (await pwOk(pw, x.pw)) return err('كلمة المرور مستعملة لعضو آخر. اختر غيرها.');
          await env.DB.batch([env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await pwHash(pw), u.id), env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id)]); }
        if (b.role !== 'owner') { const ow = (await env.DB.prepare('SELECT user_id FROM members WHERE org_id = ? AND role = ?').bind(org.id, 'owner').all()).results; if (ow.length === 1 && ow[0].user_id === u.id) return err('لا تبقى الجهة بلا مالك'); }
        await env.DB.prepare('INSERT INTO members (org_id, user_id, role) VALUES (?,?,?) ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role').bind(org.id, u.id, b.role).run();
        await audit(env, org.id, null, who.user.id, 'member', `${u.email} ${b.role}`);
        // the link signs its holder in as that person, everywhere that person belongs. So the owner who typed an address is given the link only for an account born in this call;
        // someone who already has an account (here or in another organisation) is added, and enters the way they already do
        const known = !u.fresh && !!(await env.DB.prepare('SELECT 1 AS x FROM users u WHERE u.id = ? AND (u.pw IS NOT NULL OR EXISTS (SELECT 1 FROM passkeys k WHERE k.user_id = u.id) OR EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id) OR EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id AND m.org_id != ?))').bind(u.id, org.id).first());
        if (known || b.password) { await kickOrg(env, org.id); return J({ existing: known, join: null }); }
        const join = await invite(env, u.email); return J({ join, mailed: await mailJoin(env, url.origin, u.email, join, org.name) });
      }
      if (p === '/api/events' && M === 'GET') { const { results } = await T.prepare("SELECT id, slug, name, status, published_version, updated_at, json_extract(draft, '$.mode') AS mode FROM events WHERE org_id = ? ORDER BY updated_at DESC").bind(org.id).all(); return J({ events: results.filter(e => e.status !== 'archived'), archived: results.filter(e => e.status === 'archived'), org }); }
      if (p === '/api/events' && M === 'POST') {
        if (!can('editor')) return err('لا تملك صلاحية الإنشاء', 403); const b = await req.json(); if (!b.name) return err('اسم اللقاء مطلوب');
        const n = (await T.prepare('SELECT COUNT(*) AS n FROM events WHERE org_id = ? AND status != ?').bind(org.id, 'archived').first()).n;
        if (n >= org.events_limit) return err(`باقتكم تسمح بـ ${org.events_limit} لقاء. أرشفوا لقاءً أو رقّوا الباقة.`, 402);
        if (org.paid_until && org.paid_until < now()) return err('انتهى اشتراك الجهة', 402);
        if (b.mode === 'stations' && !hasFeat(org, 'stations')) return err('المحطات التفاعلية غير مفعّلة لجهتكم. تواصلوا مع بصيرة لتفعيلها.', 403);
        let doc = BLANK(b.name); if (b.mode === 'stations') doc = { ...BLANK(b.name), mode: 'stations', cues: [], stations: [] }; else if (b.doc && !shape({ ...BLANK(b.name), ...b.doc, name: String(b.name) })) doc = { ...BLANK(b.name), ...b.doc, name: String(b.name) };   // a template chosen in the studio
        if (b.from) { const src = await T.prepare('SELECT draft FROM events WHERE id = ? AND org_id = ?').bind(b.from, org.id).first(); if (src) { const d0 = JSON.parse(src.draft); doc = { ...d0, name: String(b.name), media: {}, cues: (d0.cues || []).map(c => { const x = { ...c }; delete x.media; delete x.mediaTall; return x; }), identity: { before: { ...d0.identity.before, logo: '' }, after: d0.identity.after ? { ...d0.identity.after, logo: '' } : null } }; } }
        const id = 'e_' + org.id.slice(2) + rid(8), s = (slug(b.slug) || 'event') + '-' + rid(4);
        await T.prepare('INSERT INTO events (id, org_id, slug, name, status, draft, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, org.id, s, b.name, 'draft', JSON.stringify(doc), now(), now()).run();
        await audit(env, org.id, id, who.user.id, 'create', b.name); return J({ id });
      }
      const m = p.match(/^\/api\/events\/(e_[a-z0-9]{20})(?:\/(\w+))?(?:\/(.+))?$/);
      if (m) {
        const [, id, sub, rest] = m, ev = await T.prepare('SELECT * FROM events WHERE id = ? AND org_id = ?').bind(id, org.id).first(); if (!ev) return err('لا يوجد', 404);
        if (!sub && M === 'GET') { const doc = JSON.parse(ev.draft); return J({ id, name: ev.name, status: ev.status, published_version: ev.published_version, active_from: ev.active_from, active_until: ev.active_until, credits: org.credits, rev: ev.updated_at, doc, problems: problems(doc), base: `/m/${org.id}/${id}/` }); }
        if (!sub && M === 'PUT') { if (!can('editor')) return err('لا تملك صلاحية التعديل', 403); const doc = await req.json().catch(() => null), wrong = shape(doc); if (wrong) return err(wrong);
          const rev = req.headers.get('x-rev'); if (rev && rev !== ev.updated_at && !req.headers.get('x-force')) return J({ error: 'عدّل زميل هذا اللقاء أثناء عملك', conflict: true, rev: ev.updated_at }, 409);
          const at = now(); await T.prepare('UPDATE events SET draft = ?, name = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(doc), doc.name || ev.name, at, id).run(); return J({ ok: true, rev: at, problems: problems(doc) }); }
        // the published versions of the event, and a version brought back as the draft (the versions themselves never change)
        if (sub === 'report' && M === 'GET') { if (!ev.published_version) return J({ rows: [] }); const r = await (await env.ROOM.get(env.ROOM.idFromName(id + ':live')).fetch(new Request('https://room/log'))).json().catch(() => ({ log: [] }));
          const d = JSON.parse((await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(id, ev.published_version).first()).doc), log = r.log || [], end = log.length ? (r.state && r.state.live ? Date.now() : log[log.length - 1].t) : 0, rows = [];
          log.forEach((x, i) => { if (x.k !== 'cue') return; const nx = log.slice(i + 1).find(y => y.k === 'cue' || y.k === 'off'), c = d.cues.find(q => q.id === x.id); rows.push({ title: c ? c.title : x.id, type: c ? c.type : '', at: x.t, ms: (nx ? nx.t : end) - x.t, planned: c ? (+c.dur || 0) * 60000 : 0 }); });
          const on = log.find(x => x.k === 'on'), la = log.find(x => x.k === 'launch'); return J({ name: d.name, version: ev.published_version, from: on ? on.t : (rows[0] ? rows[0].at : 0), to: end, launchAt: la ? la.t : 0, running: !!(r.state && r.state.live), rows }); }
        if (sub === 'unarchive' && M === 'POST') { if (!can('owner')) return err('للمالك فقط', 403); const n = (await T.prepare('SELECT COUNT(*) AS n FROM events WHERE org_id = ? AND status != ?').bind(org.id, 'archived').first()).n; if (n >= org.events_limit) return err(`باقتكم تسمح بـ ${org.events_limit} لقاء. أرشفوا لقاءً آخر أولاً.`, 402);
          await T.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').bind(ev.published_version ? 'published' : 'draft', now(), id).run(); await audit(env, org.id, id, who.user.id, 'unarchive'); return J({ ok: true }); }
        if (sub === 'brand' && M === 'POST') {   // the identity proposed from the organisation's website; its logo is copied into the event's own files
          if (!can('editor')) return err('لا تملك صلاحية التعديل', 403); const b = await req.json().catch(() => ({})), r = await readBrand(b.url); if (r.error) return err(r.error); let logo = '';
          if (r.logo) { const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' })[r.logo.type] || 'png', file = 'f' + rid(8) + '.' + ext, key = `${org.id}/${id}/${file}`; await env.MEDIA.put(key, r.logo.buf, { httpMetadata: { contentType: r.logo.type } });
            await T.prepare('INSERT INTO media (id, org_id, event_id, kind, name, r2_key, bytes, created_at) VALUES (?,?,?,?,?,?,?,?)').bind('m_' + rid(), org.id, id, 'image', 'logo-' + r.site, key, r.logo.buf.byteLength, now()).run(); logo = file; }
          await audit(env, org.id, id, who.user.id, 'brand', r.site); return J({ logo, colors: r.colors, font: r.font, seenFont: r.seenFont, title: r.title, site: r.site, weak: r.weak }); }
        if (sub === 'versions' && M === 'GET') { const { results } = await T.prepare('SELECT version, published_by, published_at FROM event_versions WHERE event_id = ? ORDER BY version DESC LIMIT 50').bind(id).all(), names = {};
          for (const u of new Set(results.map(r => r.published_by).filter(Boolean))) { const x = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(u).first(); names[u] = x ? x.email : ''; }
          return J({ versions: results.map(r => ({ version: r.version, at: r.published_at, by: names[r.published_by] || '' })), current: ev.published_version }); }
        if (sub === 'restore' && M === 'POST') { if (!can('editor')) return err('لا تملك صلاحية التعديل', 403); const b = await req.json(), v = await T.prepare('SELECT doc FROM event_versions WHERE event_id = ? AND version = ?').bind(id, +b.version).first(); if (!v) return err('لا توجد هذه النسخة', 404);
          const at = now(); await T.prepare('UPDATE events SET draft = ?, updated_at = ? WHERE id = ?').bind(v.doc, at, id).run(); await audit(env, org.id, id, who.user.id, 'restore', 'v' + b.version); return J({ ok: true, rev: at }); }
        if (!sub && M === 'DELETE') { if (!can('owner')) return err('للمالك فقط', 403); await T.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').bind('archived', now(), id).run(); await audit(env, org.id, id, who.user.id, 'archive'); return J({ ok: true }); }
        if (sub === 'publish' && M === 'POST') {   // freeze the draft as the next version: the screens of the hall read this one
          if (!can('editor')) return err('لا تملك صلاحية الاعتماد', 403); if (org.paid_until && org.paid_until < now()) return err('انتهى اشتراك الجهة', 402); const doc = JSON.parse(ev.draft), bad = problems(doc); if (bad.length) return J({ error: 'أكمل النواقص قبل الاعتماد', problems: bad }, 422);
          { const pb = await req.json().catch(() => ({})); if (ev.published_version && ev.active_from && ev.active_from <= now() && now() < ev.active_until && pb.live !== true) return J({ error: 'اللقاء مفتوح في القاعة. الشاشات تبقى على النسخة ' + ev.published_version + ' حتى تؤكدوا اعتماد الجديدة.', pinned: ev.published_version }, 409); }
          const v = (ev.published_version || 0) + 1, at = now(); await T.batch([T.prepare('INSERT INTO event_versions (event_id, version, doc, published_by, published_at) VALUES (?,?,?,?,?)').bind(id, v, ev.draft, who.user.id, now()),
            T.prepare('UPDATE events SET published_version = ?, status = ?, updated_at = ? WHERE id = ?').bind(v, 'published', at, id)]);
          await audit(env, org.id, id, who.user.id, 'publish', 'v' + v); const swept = await sweep(env, T, org.id, { ...ev, published_version: v }).catch(() => 0); return J({ version: v, swept, rev: at });   // rev: the draft's stamp after this write, so the studio's next save is not taken for a colleague's
        }
        if (sub === 'activate' && M === 'POST') {   // one activation day: from the morning of the chosen day (the browser's own midnight) for 24 hours, plus the evening before for the hall's set up
          if (!can('owner')) return err('التفعيل لمالك الحساب', 403); if (org.paid_until && org.paid_until < now()) return err('انتهى اشتراك الجهة', 402); const b = await req.json(), from = new Date(b.from); if (isNaN(from) || from.getTime() < Date.now() - 864e5) return err('تاريخ غير صالح');
          if (!ev.published_version) return err('اعتمد نسخة أولاً'); if (ev.active_until && ev.active_until > now()) return err('اللقاء مفعّل حتى ' + ev.active_until.slice(0, 10));
          const o = await env.DB.prepare('UPDATE orgs SET credits = credits - 1 WHERE id = ? AND credits > 0 RETURNING credits').bind(org.id).first(); if (!o) return err('لا أيام تفعيل في رصيدكم. تواصلوا معنا لإضافة يوم.', 402);
          const a = new Date(from.getTime() - 6 * 36e5).toISOString(), z = new Date(from.getTime() + 24 * 36e5).toISOString();
          const at = now(); await T.prepare('UPDATE events SET active_from = ?, active_until = ?, updated_at = ? WHERE id = ?').bind(a, z, at, id).run(); await audit(env, org.id, id, who.user.id, 'activate', a + ' ' + z); return J({ active_from: a, active_until: z, credits: o.credits, rev: at });
        }
        // a large file goes up in parts (16 MB each), so a long film survives a weak connection and can be retried part by part
        if (sub === 'upload' && M === 'POST') { if (!can('editor')) return err('لا تملك صلاحية الرفع', 403); const b = await req.json();
          if (b.start) { const used = (await T.prepare('SELECT COALESCE(SUM(bytes),0) AS b FROM media WHERE org_id = ?').bind(org.id).first()).b; if (used + (+b.size || 0) > org.storage_limit_mb * 1048576) return err('امتلأت مساحة الجهة', 402);
            const ext = (String(b.name).match(/\.(\w{2,5})$/) || [, 'mp4'])[1].toLowerCase(), file = 'f' + rid(8) + '.' + ext, key = `${org.id}/${id}/${file}`, up = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: b.type || 'video/mp4' } }); return J({ file, key, uploadId: up.uploadId }); }
          if (b.done) { if (!String(b.key).startsWith(`${org.id}/${id}/`)) return err('لا يوجد', 404); await env.MEDIA.resumeMultipartUpload(b.key, b.uploadId).complete(b.parts); const real = (await env.MEDIA.head(b.key))?.size || 0, used2 = (await T.prepare('SELECT COALESCE(SUM(bytes),0) AS b FROM media WHERE org_id = ?').bind(org.id).first()).b;
            if (used2 + real > org.storage_limit_mb * 1048576) { await env.MEDIA.delete(b.key); return err('امتلأت مساحة الجهة', 402); }
            await T.prepare('INSERT INTO media (id, org_id, event_id, kind, name, r2_key, bytes, created_at) VALUES (?,?,?,?,?,?,?,?)').bind('m_' + rid(), org.id, id, b.kind === 'pdf' ? 'pdf' : 'video', String(b.name).slice(0, 120), b.key, real, now()).run(); return J({ ok: true }); }
        }
        if (sub === 'upload' && M === 'PUT') { if (!can('editor')) return err('لا تملك صلاحية الرفع', 403); const q = url.searchParams, key = q.get('key'); if (!String(key).startsWith(`${org.id}/${id}/`)) return err('لا يوجد', 404);
          const part = await env.MEDIA.resumeMultipartUpload(key, q.get('uploadId')).uploadPart(+q.get('n'), req.body); return J({ partNumber: part.partNumber, etag: part.etag }); }
        if (sub === 'media' && M === 'PUT') {   // one file; slides arrive page by page (?slides=<media id>&n=<page>)
          if (!can('editor')) return err('لا تملك صلاحية الرفع', 403);
          const q = url.searchParams, kind = q.get('kind'), name = (q.get('name') || 'file').slice(0, 120), size = +req.headers.get('Content-Length') || 0; if (!['video', 'image', 'slides', 'pdf'].includes(kind)) return err('نوع غير معروف'); if (kind === 'pdf' && size > 200 * 1048576) return err('ملف PDF أكبر من 200 ميغابايت');
          const used = (await T.prepare('SELECT COALESCE(SUM(bytes),0) AS b FROM media WHERE org_id = ?').bind(org.id).first()).b; if (used + size > org.storage_limit_mb * 1048576) return err('امتلأت مساحة الجهة', 402);
          if (q.get('slides') && !/^f[a-z0-9]{6,12}$/.test(q.get('slides'))) return err('معرّف غير صالح'); const mid = q.get('slides') || 'f' + rid(8), ext = kind === 'pdf' ? 'pdf' : (name.match(/\.(\w{2,5})$/) || [, kind === 'video' ? 'mp4' : 'jpg'])[1].toLowerCase();
          const file = kind === 'slides' ? `${mid}/s-${+q.get('n') || 1}.jpg` : `${mid}.${ext}`, key = `${org.id}/${id}/${file}`;
          await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' } });
          await T.prepare('INSERT INTO media (id, org_id, event_id, kind, name, r2_key, bytes, created_at) VALUES (?,?,?,?,?,?,?,?)').bind('m_' + rid(), org.id, id, kind, name, key, size, now()).run();
          return J({ id: mid, src: kind === 'slides' ? mid + '/' : file });
        }
        if (sub === 'links' && M === 'GET') { const { results } = await T.prepare('SELECT token_hash AS id, role, label, created_at, opened_at FROM links WHERE event_id = ? AND revoked_at IS NULL ORDER BY created_at').bind(id).all(); return J({ links: results.map(l => ({ ...l, id: l.id.slice(0, 16) })) }); }
        if (sub === 'links' && M === 'POST') { if (!can('operator')) return err('لا تملك الصلاحية', 403); const b = await req.json(); if (!LINK_ROLES.includes(b.role)) return err('نوع شاشة غير معروف');
          const tok = org.id.slice(2) + '.' + rid(24); await T.prepare('INSERT INTO links (token_hash, org_id, event_id, role, label, created_at) VALUES (?,?,?,?,?,?)').bind(await sha(tok), org.id, id, b.role, b.label || '', now()).run();
          await audit(env, org.id, id, who.user.id, 'link', b.role); return J({ url: '/go/' + tok }); }   // the address is shown once; only its hash is kept
        if (sub === 'links' && M === 'DELETE' && rest) { if (!can('operator')) return err('لا تملك الصلاحية', 403); await T.prepare('UPDATE links SET revoked_at = ? WHERE event_id = ? AND substr(token_hash,1,16) = ?').bind(now(), id, rest).run();
          await env.ROOM.get(env.ROOM.idFromName(id + ':live')).fetch(new Request('https://room/kick', { method: 'POST' })).catch(() => {});   // a screen already open by that link is cut off now, not at its next reload
          await audit(env, org.id, id, who.user.id, 'unlink', rest); return J({ ok: true }); }
      }
      return err('لا يوجد', 404);
    } catch (e) { const ref = rid(6); console.log('error', ref, req.method, new URL(req.url).pathname, e && e.stack || e); return J({ error: `حدث خطأ. أعيدوا المحاولة، وإن تكرر فأبلغوا بصيرة بهذا الرقم: ${ref}`, ref }, 500); }
  },
};
// what the browser is told with every answer: do not guess types, do not show the site inside another site, do not pass our addresses on
// (a screen's link carries its key), stay on https. The files of an organisation (/m/) are data: opened by themselves they run nothing.
const GUARD = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()' };
export default {
  scheduled: (e, env, ctx) => main.scheduled(e, env, ctx),
  async fetch(req, env, ctx) { const r = await main.fetch(req, env, ctx); if (r.status === 101 || r.webSocket) return r;
    const h = new Headers(r.headers); for (const [k, v] of Object.entries(GUARD)) h.set(k, v); if (/^\/(m|api\/read)\//.test(new URL(req.url).pathname)) h.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h }); },
};
