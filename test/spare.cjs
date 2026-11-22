// The spare screen: paired as «شاشة احتياطية», it waits ready; when a station is down for two minutes the board offers to move it
// there, and the spare becomes that station; the board releases it. Against a local server (npm run db && npm run dev). Takes ~3 minutes.
//   node test/spare.cjs
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
  const A = await make('الاحتياطية');
  const dev = async (station) => { const s = await (await b.newContext()).newPage(); s.on('pageerror', e => { if (!/spare: waiting/.test(e.message)) errs.push(e.message); }); await s.goto(`${B}/${A.o.slug}/screen`); await s.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#code').textContent), null, { timeout: 15000 });
    await A.api(`/api/run/${A.ev}/pair`, { code: await s.textContent('#code'), station }); await s.waitForURL(/\/run\/station/, { timeout: 15000 }); return s; };
  const s1 = await dev('s1'), sp = await dev('_spare');
  await sp.waitForFunction(() => /الشاشة الاحتياطية جاهزة/.test(document.body.textContent), null, { timeout: 15000 }).catch(() => {}); ok(/الشاشة الاحتياطية جاهزة/.test(await sp.textContent('body')), 'the spare screen waits, saying it is ready');
  const bd = await A.p.context().newPage(); bd.on('pageerror', e => errs.push('board: ' + e.message)); await bd.goto(`${B}/run/stations.html?e=${A.ev}`); await bd.waitForSelector('.card');
  await bd.waitForFunction(() => /جاهزة/.test(document.querySelector('#spr').textContent), null, { timeout: 20000 }).catch(() => {}); ok(/الشاشة الاحتياطية جاهزة/.test(await bd.textContent('#spr')), 'the board shows the spare ready');
  ok((await A.api(`/api/run/${A.ev}/pairs`, null, 'GET')).pairs.some(x => x.name === 'الشاشة الاحتياطية'), 'and the pairing log names it');
  await s1.context().close(); await bd.waitForSelector('#alerts [data-sp]', { timeout: 200000 }).catch(() => {}); ok(!!(await bd.$('#alerts [data-sp="s1"]')), 'two minutes after the station went down, the board offers to move it to the spare');
  await bd.click('#alerts [data-sp="s1"]'); await bd.click('.qd .b.on'); await sp.waitForFunction(() => !/الشاشة الاحتياطية جاهزة/.test(document.body.textContent) && !!document.querySelector('#att'), null, { timeout: 20000 }).catch(() => {});
  ok(!!(await sp.$('#att')), 'one button: the spare becomes the station');
  await bd.waitForFunction(() => /متصلة 1 من 1|متصلة ١ من ١/.test(document.querySelector('#cnt').textContent), null, { timeout: 20000 }).catch(() => {}); ok(/(1|١) من (1|١)/.test(await bd.textContent('#cnt')) && /تعمل بدل «الأولى»/.test(await bd.textContent('#spr')), 'the board counts the station connected again, and says the spare stands in for it');
  await bd.click('#sprX'); await bd.click('.qd .b.on'); await sp.waitForFunction(() => /الشاشة الاحتياطية جاهزة/.test(document.body.textContent), null, { timeout: 20000 }).catch(() => {}); ok(/الشاشة الاحتياطية جاهزة/.test(await sp.textContent('body')), 'released from the board, it waits again');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
