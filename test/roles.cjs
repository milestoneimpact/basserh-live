// The roles inside an organisation: the editor builds and rehearses but does not approve; the operator of the day opens an exhibition
// on its board and cannot change it; the owner approves. Against a local server (npm run db && npm run dev).
//   node test/roles.cjs
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const MADE = [], adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).then(j => { if (method === 'POST' && j && j.org) MADE.push(j); return j; });
// every organisation this test made is deleted at the end, passed or failed, so nothing is left on the server it ran against
const tidy = async () => { for (const o of MADE.splice(0)) await adm('DELETE', { id: o.org, confirm: o.slug }).catch(() => {}); };
(async () => { const b = await chromium.launch(), errs = [];
  // two organisations, each with a published stations event
  const make = async name => { const o = await adm('POST', { name, slug: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), email: `p${Date.now()}${Math.random().toString(36).slice(2, 5)}@t.test` }), c = await b.newContext(), p = await c.newPage(); await p.goto(B + o.join); await p.waitForSelector('#new');
    const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return { status: r.status, ...(await r.json()) }; }, [path, body, method, type]);
    const pg = await b.newPage(); await pg.setContent('<body style="margin:0"><section style="height:100vh;font:80px sans-serif">1</section></body>'); const pdf = await pg.pdf({ width: '1600px', height: '1000px' }); await pg.close();
    const { id: ev } = await api('/api/events', { name: 'معرض ' + name, mode: 'stations' }), up = await api(`/api/events/${ev}/media?kind=pdf&name=b.pdf`, pdf.toString('base64'), 'PUT', 'application/pdf'), cur = await api(`/api/events/${ev}`, null, 'GET');
    await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, { ...cur.doc, media: { m: { kind: 'pdf', name: 'ك', src: up.src, count: 1 } }, stations: [{ id: 's1', name: 'الأولى', media: 'm', idle: 0 }] }]);
    await api(`/api/events/${ev}/publish`); return { o, p, api, ev }; };
  const A = await make('الأدوار'), t = Date.now().toString(36);
  const add = async (role, pw) => A.api('/api/members', { email: `${role}${t}@t.test`, role, password: pw });
  await add('editor', 'editor-pass-' + t); await add('operator', 'operator-pass-' + t);
  const as = async pw => { const c = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); await p.goto(`${B}/${A.o.slug}`); await p.fill('#lP', pw); await p.click('#lf2 button'); await p.waitForSelector('.ev', { timeout: 15000 }); return p; };
  const ed = await as('editor-pass-' + t);
  const pub = await ed.evaluate(async e => (await fetch(`/api/events/${e}/publish`, { method: 'POST', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json' }, body: '{}' })).status, A.ev); ok(pub === 403, 'the editor cannot approve: ' + pub);
  await ed.click('.ev'); await ed.waitForSelector('#pub'); ok(await ed.isDisabled('#pub') && /لمالك الجهة/.test(await ed.getAttribute('#pub', 'title')), 'and the approve button says it is the owner\'s');
  const op = await as('operator-pass-' + t); ok(/حسابك للتشغيل/.test(await op.textContent('#app')) && !(await op.isVisible('#new')), 'the operator\'s studio says what the account is for, with no «new»');
  await op.click('.ev'); await op.waitForURL(/\/run\/stations(\.html)?\?/, { timeout: 15000 }).catch(() => {}); ok(/\/run\/stations(\.html)?\?/.test(op.url()), 'and opens the exhibition on its board: ' + op.url());
  const put = await op.evaluate(async e => (await fetch(`/api/events/${e}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, A.ev); ok(put === 403, 'the operator cannot change the exhibition: ' + put);
  const own = await A.api(`/api/events/${A.ev}/publish`, {}); ok(own.status === 200, 'the owner approves');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
