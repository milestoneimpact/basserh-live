// The measure of browsing at the stations, against a local server (npm run db && npm run dev): a visitor's session (pages, time on each,
// a page brought closer, the phone code), sent when the screen rests; sessions made while the network is cut kept on the device and sent
// when it returns, once each; the phone's reading; the board's numbers; the studio's report, printed and exported.
//   node test/visits.cjs
const { chromium, devices } = require('playwright'); const fs = require('fs');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', OUT = process.env.OUT || '/tmp/claude-0/vis/'; fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const MADE = [], adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).then(j => { if (method === 'POST' && j && j.org) MADE.push(j); return j; });
// every organisation this test made is deleted at the end, passed or failed, so nothing is left on the server it ran against
const tidy = async () => { for (const o of MADE.splice(0)) await adm('DELETE', { id: o.org, confirm: o.slug }).catch(() => {}); };
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(), errs = [];
  const pg0 = await b.newPage(); await pg0.setContent(`<body style="margin:0">${Array.from({ length: 6 }, (_, i) => `<section style="height:100vh;page-break-after:always;display:grid;place-items:center;background:#EFE6D2"><h1 style="font-size:80px">${i + 1}</h1></section>`).join('')}</body>`);
  const pdf = OUT + 'book.pdf'; await pg0.pdf({ path: pdf, width: '1600px', height: '1000px', printBackground: true }); await pg0.close();
  const org = await adm('POST', { name: 'قياس التصفح', slug: 'v' + Date.now(), email: `v${Date.now()}@t.test`, events_limit: 3 }); await adm('PATCH', { id: org.org, add_credits: 1, features: ['stations'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }), p = await ctx.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => errs.push('studio: ' + e.message)); await p.goto(B + org.join); await p.waitForSelector('#new');
  const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return r.json(); }, [path, body, method, type]);
  const { id: ev } = await api('/api/events', { name: 'معرض القياس', mode: 'stations' }), up = await api(`/api/events/${ev}/media?kind=pdf&name=book.pdf`, fs.readFileSync(pdf).toString('base64'), 'PUT', 'application/pdf');
  const cur = await api(`/api/events/${ev}`, null, 'GET'), doc = { ...cur.doc, media: { m: { kind: 'pdf', name: 'كتاب القياس', src: up.src, count: 6 } }, stations: [{ id: 's1', name: 'المحطة الأولى', media: 'm', idle: 0, qr: true }, { id: 's2', name: 'المحطة الثانية', media: 'm', idle: 0 }] };
  await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, doc]);
  await api(`/api/events/${ev}/publish`); await api(`/api/events/${ev}/activate`, { from: new Date(new Date().toDateString()).toISOString() });
  const visits = () => p.evaluate(async ev => (await fetch(`/api/events/${ev}/visits`, { headers: { 'x-org-slug': location.pathname.slice(1) } })).json(), ev);
  // two screens; the network of the second can be cut for real
  const open = async sid => { const L = await api(`/api/events/${ev}/links`, { role: 'station', label: sid }), c = await b.newContext({ viewport: { width: 1600, height: 1000 }, hasTouch: true }), x = { c, cut: false, socks: [] };
    await c.routeWebSocket(/\/ws/, ws => { if (x.cut) return ws.close(); ws.connectToServer(); x.socks.push(ws); }); x.s = await c.newPage(); x.s.on('pageerror', e => errs.push(sid + ': ' + e.message)); await x.s.goto(B + L.url);
    await x.s.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 30000 }); return x; };
  const s1 = await open('s1'), s2 = await open('s2');
  const visitor = async (x, turns) => { await x.s.touchscreen.tap(800, 400); await wait(600); for (let i = 0; i < turns; i++) { await x.s.click('#bF'); await wait(700); } };
  // ----- one visitor at the first station: four pages, a page brought closer, the phone code asked for; the board sends the screen back to rest
  await visitor(s1, 3); await s1.s.touchscreen.tap(800, 400); await wait(80); await s1.s.touchscreen.tap(800, 400); await wait(800); await s1.s.touchscreen.tap(800, 400); await wait(80); await s1.s.touchscreen.tap(800, 400); await wait(500);
  await s1.s.click('#bQ'); await wait(300); await s1.s.click('#qX');
  const bd = await ctx.newPage(); bd.on('dialog', d => d.accept()); bd.on('pageerror', e => errs.push('board: ' + e.message)); await bd.goto(`${B}/run/stations.html?e=${ev}`); await bd.waitForSelector('.card');
  await bd.click('.card[data-s="s1"] [data-h]'); await wait(2500);
  let v = await visits(); const st1 = v.stations.find(x => x.station === 's1'), f = v.files[0];
  ok(v.total === 1 && st1.n === 1 && st1.pages === 4, `one visit at the first station, four pages read (${v.total} visit, ${st1 && st1.pages} pages)`);
  ok(f && f.reach[4] === 1 && !f.reach[5] && Object.values(f.dwell).every(ms => ms > 300), 'by page: how far the visitor went, and how long on each page');
  ok(f && f.zoom[4] === 1 && v.qr === 1, 'the page brought closer, and the phone code asked for, are counted');
  ok(st1.ms >= 2500 && st1.ms < 60000, 'the visit lasted ' + (st1.ms / 1000).toFixed(1) + ' s');
  // ----- the second station cut from the network: two visitors, kept on the device, sent when the network returns
  s2.cut = true; await s2.c.setOffline(true); for (const w of s2.socks.splice(0)) await w.close().catch(() => {}); await wait(1500);
  for (const turns of [2, 2]) { await visitor(s2, turns); await s2.s.evaluate(() => dispatchEvent(new Event('pagehide'))); await wait(300); }
  const q = await s2.s.evaluate(e => JSON.parse(localStorage.getItem('visits:' + e) || '[]').length, ev); v = await visits();
  ok(q === 2 && v.total === 1, `network cut: the two visits wait on the device (${q}), the server has not had them (${v.total})`);
  s2.cut = false; await s2.c.setOffline(false); await s2.s.waitForFunction(e => JSON.parse(localStorage.getItem('visits:' + e) || '[]').length === 0, ev, { timeout: 30000 }).catch(() => {}); v = await visits();
  ok(v.total === 3 && v.stations.find(x => x.station === 's2').n === 2, `network back: they were sent at once and kept (${v.total} visits in all)`);
  // a batch sent twice is kept once
  const again = await s2.s.evaluate(async e => { const r = await fetch(`/api/run/${e}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list: [{ id: 'dupl1cate01', station: 's2', media: 'm', start: Date.now() - 5000, ms: 4000, pages: { 1: 4000 } }, { id: 'dupl1cate01', station: 's2', media: 'm', start: Date.now() - 5000, ms: 4000, pages: { 1: 4000 } }] }) }); return r.json(); }, ev);
  await s2.s.evaluate(async e => fetch(`/api/run/${e}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list: [{ id: 'dupl1cate01', station: 's2', media: 'm', start: Date.now() - 5000, ms: 4000, pages: { 1: 4000 } }] }) }), ev);
  v = await visits(); ok(again.kept >= 1 && v.total === 4, 'a visit sent twice (a retry) is kept once');
  ok((await (await fetch(`${B}/api/run/${ev}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"list":[]}' })).status) === 401, 'nobody without a screen link sends visits');
  const bogus = await s2.s.evaluate(async e => (await (await fetch(`/api/run/${e}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list: [{ id: 'bogus000001', station: 'nope', start: Date.now(), ms: 1, pages: {} }, { id: '<x>', station: 's1', start: Date.now(), ms: 1 }] }) })).json()).kept, ev);
  ok(bogus === 0, 'a visit for a station that is not there, or with a bad id, is refused');
  // ----- the phone, from the code
  const cfg = await s1.s.evaluate(async e => (await fetch(`/api/run/${e}/config`)).json(), ev), ph = await b.newContext({ ...devices['iPhone 13'], locale: 'ar-SA' }), r = await ph.newPage();
  await r.goto(`${B}/run/reader.html#${new URLSearchParams({ e: ev, s: 's1', m: 'l', k: cfg.read.s1, p: 2 })}`); await r.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 30000 });
  await r.click('#bL'); await wait(800); await r.click('#bL'); await wait(800); await r.close({ runBeforeUnload: true }); await wait(1500);
  v = await visits(); ok(v.phone === 1 && v.phonePages === 3, `the phone's reading is counted when the visitor leaves (${v.phone} reader, ${v.phonePages} pages)`);
  // ----- the board and the studio
  await bd.reload(); await bd.waitForFunction(() => /الزوار/.test(document.querySelector('#vis').textContent), null, { timeout: 10000 }).catch(() => {});
  ok(/الزوار (٤|4)/.test(await bd.textContent('#vis')) && /(٣|3) زائر/.test(await bd.textContent('.card[data-s="s2"] .vs')), 'the board: ' + await bd.textContent('#vis') + ' · المحطة الثانية: ' + await bd.textContent('.card[data-s="s2"] .vs'));
  await bd.screenshot({ path: OUT + 'board.jpg', type: 'jpeg', quality: 75 });
  await p.reload(); await p.click('.ev:has-text("معرض القياس")'); await p.click('[data-t="run"]'); await p.waitForSelector('#vis .vr-att', { timeout: 15000 });
  ok(await p.locator('#vis table tr').count() === 7 && await p.locator('#vis .vn').count() > 0 && await p.locator('#vis .vw').count() > 0, 'the studio\'s report: the stations, the hours, and the book page by page'); await p.locator('#vis').screenshot({ path: OUT + 'report.jpg', type: 'jpeg', quality: 80 });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#visX')]); const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(/\.csv$/.test(dl.suggestedFilename()) && csv.charCodeAt(0) === 0xfeff && /المحطة الأولى/.test(csv) && /كتاب القياس/.test(csv), 'exported as a file Excel opens in Arabic: ' + dl.suggestedFilename());
  await p.evaluate(() => { window.__pr = 0; }); const [pop] = await Promise.all([p.waitForEvent('popup'), p.click('#visP')]); await pop.waitForLoadState(); await pop.evaluate(() => { window.print = () => {}; });
  const rt = await pop.textContent('body'); ok(/تقرير الزوار: معرض القياس/.test(rt) && /أكثر المحطات زوارًا/.test(rt) && /أكثر الساعات ازدحامًا/.test(rt) && /وصل إلى آخره/.test(rt) && /ما يستحق الانتباه/.test(rt), 'the client report: title, the busiest station and hour, how far each file was read');
  await pop.pdf({ path: OUT + 'report.pdf', format: 'A4' }); ok(fs.statSync(OUT + 'report.pdf').size > 10000, 'and it prints to a PDF'); await pop.close();
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
