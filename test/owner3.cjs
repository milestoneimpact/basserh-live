// The organisation's own door, its exhibitions ready-made, its space watched: the door shows the organisation's colour on a device
// that entered before; a new exhibition starts from a template of named stations; past 80% of its space the studio warns, with
// the largest files, and the owner page marks it. Against a local server (npm run db && npm run dev).
//   node test/owner3.cjs
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const MADE = [], adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).then(j => { if (method === 'POST' && j && j.org) MADE.push(j); return j; });
// every organisation this test made is deleted at the end, passed or failed, so nothing is left on the server it ran against
const tidy = async () => { for (const o of MADE.splice(0)) await adm('DELETE', { id: o.org, confirm: o.slug }).catch(() => {}); };
(async () => { const b = await chromium.launch(), errs = [];
  const o = await adm('POST', { name: 'جهة المساحة', slug: 'w' + Date.now().toString(36), email: `w${Date.now()}@t.test`, storage_limit_mb: 1, kind: 'stations' });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await c.newPage(); p.on('pageerror', e => errs.push('studio: ' + e.message)); p.on('dialog', d => d.accept()); await p.goto(B + o.join); await p.waitForSelector('#new');
  const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return { status: r.status, ...(await r.json()) }; }, [path, body, method, type]);
  // a template
  await p.click('#new'); await p.waitForSelector('.tpl[data-tpl="achieve"]'); ok(!(await p.isVisible('#nSt')), 'a new exhibition offers templates; the count is asked only for an empty one');
  await p.fill('#dlgIn', 'معرض العشرين عامًا'); await p.click('.tpl[data-tpl="achieve"]'); await p.click('#dlgOk'); await p.waitForFunction(() => /بأسمائها وأماكنها/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 }).catch(() => {});
  const evs = await api('/api/events', null, 'GET'), ev = evs.events.find(e => e.name === 'معرض العشرين عامًا'); await p.waitForTimeout(1500); const d = await api('/api/events/' + ev.id, null, 'GET');
  ok(d.doc.stations.length === 6 && d.doc.stations[0].name === 'البداية والتأسيس' && d.doc.stations[0].place === 'المدخل', 'it starts with six named stations and their places: ' + d.doc.stations.map(x => x.name).join('، '));
  await p.waitForSelector('#steps .stp'); ok(await p.locator('#steps .stp').count() === 7 && /شاشة الانتظار/.test(await p.textContent('#steps')) && /دليل التركيب/.test(await p.textContent('#steps')), 'the steps of an exhibition: files, stations, identity, waiting screen, installer guide, rehearsal, approval');
  ok(/قبل الاعتماد/.test(await p.textContent('#steps .stmiss').catch(() => '')), 'and what is still missing before approval, listed under them: ' + (await p.textContent('#steps .stmiss').catch(() => '')).slice(0, 120));
  // the space past 80%
  const pg = await b.newPage(); await pg.setContent('<body>' + 'ب'.repeat(10) + '</body>'); let pdf = await pg.pdf({ width: '1600px', height: '1000px' }); await pg.close(); const pad = Buffer.alloc(900000 - pdf.length, 32); pdf = Buffer.concat([pdf, pad]);
  const up = await api(`/api/events/${ev.id}/media?kind=pdf&name=big.pdf`, pdf.toString('base64'), 'PUT', 'application/pdf'); ok(up.status === 200, 'a file of 0.9 MB in a space of 1 MB: ' + up.status);
  await p.click('#home'); await p.waitForSelector('.sto', { timeout: 15000 }).catch(() => {}); ok(/تقترب من حدها|على وشك الامتلاء/.test(await p.textContent('.sto').catch(() => '')), 'past 80% the studio warns above the list');
  await p.click('.sto summary'); ok(/big/.test(await p.textContent('.sto-r')), 'and names the largest files'); await p.click('.sto-r'); await p.waitForSelector('#lib', { timeout: 15000 }).catch(() => {}); ok(!!(await p.$('#lib')), 'a file opens its exhibition on its files');
  // the owner page marks it
  const a = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); await a.goto(B + '/admin.html'); await a.fill('#pw', AK); await a.keyboard.press('Enter'); await a.waitForSelector('#rows'); if (!(await a.isChecked('#tst'))) await a.click('#tst');
  await a.click('#fl [data-f="full"]'); await a.waitForSelector(`.oc[data-id="${o.org}"] .sw`, { timeout: 10000 }).catch(() => {}); ok(!!(await a.$(`.oc[data-id="${o.org}"] .sw`)), 'the owner page marks it, and filters the organisations whose space is nearly full');
  const [mw] = await Promise.all([a.waitForEvent('popup'), a.click('#mon')]); await mw.waitForLoadState(); const mt = await mw.textContent('body');
  ok(/تقرير/.test(mt) && /جهة المساحة/.test(mt) && /زوار المعارض/.test(mt) && /جديدة هذا الشهر/.test(mt), 'the owner\'s month report: each organisation, its events, visitors and space, and the new ones marked'); await mw.close();
  // the door in its own colour, on this device
  const cur = await api('/api/events/' + ev.id, null, 'GET'); await p.evaluate(async ([id, doc]) => fetch('/api/events/' + id, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev.id, { ...cur.doc, identity: { ...cur.doc.identity, before: { ...cur.doc.identity.before, colors: { ...(cur.doc.identity.before.colors || {}), accent: '#7a1f5c' } } } }]);
  await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('look:')).forEach(k => localStorage.removeItem(k))); await p.evaluate(s => localStorage.setItem('door:' + s, 'جهة المساحة'), o.slug); await p.click('#home'); await p.waitForTimeout(2500);
  await p.goto(B + '/api/logout'); await p.goto(B + '/' + o.slug); await p.waitForSelector('#gate');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#gate')).getPropertyValue('--own').trim()) === '#7a1f5c' && /جهة المساحة/.test(await p.textContent('#gate h2')), 'the door, on a device that entered before, wears the organisation\'s colour and name');
  const fresh = await (await b.newContext()).newPage(); await fresh.goto(B + '/' + o.slug); await fresh.waitForSelector('#gate'); ok(!(await fresh.$('#gate.own')) && !/جهة المساحة/.test(await fresh.textContent('#gate')), 'a new device sees the plain door, with no name');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
