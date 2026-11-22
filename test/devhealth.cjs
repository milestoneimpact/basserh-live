// The board's health alerts: a station whose battery is low and off the charger, or whose browser storage is nearly full, is named
// on the board. The screen's battery and storage are faked in the page. Against a local server (npm run db && npm run dev).
//   node test/devhealth.cjs
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
(async () => { const b = await chromium.launch(), errs = [];
  // two organisations, each with a published stations event
  const make = async name => { const o = await adm('POST', { name, slug: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), email: `p${Date.now()}${Math.random().toString(36).slice(2, 5)}@t.test` }), c = await b.newContext(), p = await c.newPage(); await p.goto(B + o.join); await p.waitForSelector('#new');
    const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return { status: r.status, ...(await r.json()) }; }, [path, body, method, type]);
    const pg = await b.newPage(); await pg.setContent('<body style="margin:0"><section style="height:100vh;font:80px sans-serif">1</section></body>'); const pdf = await pg.pdf({ width: '1600px', height: '1000px' }); await pg.close();
    const { id: ev } = await api('/api/events', { name: 'معرض ' + name, mode: 'stations' }), up = await api(`/api/events/${ev}/media?kind=pdf&name=b.pdf`, pdf.toString('base64'), 'PUT', 'application/pdf'), cur = await api(`/api/events/${ev}`, null, 'GET');
    await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, { ...cur.doc, media: { m: { kind: 'pdf', name: 'ك', src: up.src, count: 1 } }, stations: [{ id: 's1', name: 'الأولى', media: 'm', idle: 0 }] }]);
    await api(`/api/events/${ev}/publish`); return { o, p, api, ev }; };
  const A = await make('الصحة');
  const c = await b.newContext(); await c.addInitScript(() => { navigator.getBattery = async () => ({ level: .12, charging: false }); navigator.storage.estimate = async () => ({ usage: 95, quota: 100 }); });
  const s = await c.newPage(); s.on('pageerror', e => errs.push(e.message)); await s.goto(`${B}/${A.o.slug}/screen`); await s.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#code').textContent), null, { timeout: 15000 });
  await A.api(`/api/run/${A.ev}/pair`, { code: await s.textContent('#code'), station: 's1' }); await s.waitForURL(/\/run\/station/, { timeout: 15000 });
  const bd = await A.p.context().newPage(); bd.on('pageerror', e => errs.push('board: ' + e.message)); await bd.goto(`${B}/run/stations.html?e=${A.ev}`);
  await bd.waitForFunction(() => /البطارية/.test(document.querySelector('#alerts').textContent), null, { timeout: 20000 }).catch(() => {});
  const t = await bd.textContent('#alerts'); ok(/الأولى: البطارية (12|١٢)٪ وليست على الشاحن/.test(t), 'a low battery off the charger is named on the board: ' + t);
  ok(await bd.$('#alerts .al.low') !== null, 'with its own colour');
  const c2 = await b.newContext(); await c2.addInitScript(() => { navigator.getBattery = async () => ({ level: .9, charging: true }); navigator.storage.estimate = async () => ({ usage: 95, quota: 100 }); });
  const s2 = await c2.newPage(); await s2.goto(`${B}/${A.o.slug}/screen`); await s2.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#code').textContent), null, { timeout: 15000 });
  await A.api(`/api/run/${A.ev}/pair`, { code: await s2.textContent('#code'), station: 's1' }); await s.close(); await s2.waitForURL(/\/run\/station/, { timeout: 15000 });
  await bd.waitForFunction(() => /مساحة الحفظ/.test(document.querySelector('#alerts').textContent), null, { timeout: 20000 }).catch(() => {});
  ok(/مساحة الحفظ في المتصفح ممتلئة (95|٩٥)٪/.test(await bd.textContent('#alerts')), 'storage nearly full is named too: ' + await bd.textContent('#alerts'));
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close();
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exit(1); });
