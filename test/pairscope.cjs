// Pairing at an organisation's own address (/<slug>/screen): the code is for that organisation alone. Another organisation that types it
// is refused; its own pairs it. The shared /screen still works for screens set up before. Against a local server (npm run db && npm run dev).
//   node test/pairscope.cjs
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
  const A = await make('الأولى'), Bo = await make('الثانية');
  const code = async path => { const c = await b.newContext(), s = await c.newPage(); s.on('pageerror', e => errs.push(e.message)); await s.goto(B + path); await s.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#code').textContent), null, { timeout: 15000 }); return { s, code: await s.textContent('#code'), h1: await s.textContent('h1') }; };
  const k = await code(`/${A.o.slug}/screen`); ok(/الأولى/.test(k.h1), 'at its organisation\'s address the screen names it: ' + k.h1);
  const wrong = await Bo.api(`/api/run/${Bo.ev}/pair`, { code: k.code, station: 's1' }); ok(wrong.status === 403 && /جهة أخرى/.test(wrong.error), 'another organisation typing the code is refused: ' + wrong.error);
  const right = await A.api(`/api/run/${A.ev}/pair`, { code: k.code, station: 's1' }); ok(right.status === 200 && right.ok, 'its own organisation pairs it');
  await k.s.waitForURL(/\/run\/station/, { timeout: 15000 }).catch(() => {}); ok(/\/run\/station/.test(k.s.url()), 'and the screen becomes the station');
  ok((await fetch(`${B}/nosuchorg/screen`)).status !== 200, 'an address of no organisation is not a pairing page');
  const g = await code('/screen'); ok(/^ربط هذه الشاشة بمحطتها$/.test(g.h1), 'the shared /screen still gives a code (for screens set up before)');
  const old = await Bo.api(`/api/run/${Bo.ev}/pair`, { code: g.code, station: 's1' }); ok(old.status === 200, 'and any organisation can claim that one, as before');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
