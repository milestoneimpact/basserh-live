// The speed of a station with a large book (150 pages): the time to its first page, and to turn a page, on a mid-range screen
// (CPU slowed four times). Reports the numbers; fails above the budget. Against a local server (npm run db && npm run dev).
//   node test/speed.cjs
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
    const pg = await b.newPage(); await pg.setContent('<body style="margin:0">' + Array.from({ length: 150 }, (_, i) => `<section style="height:1000px;page-break-after:always;font:60px sans-serif;padding:60px;box-sizing:border-box;background:linear-gradient(135deg,#0F5A4E,#C2A063)"><h1 style="color:#fff">الصفحة ${i + 1}</h1><p style="font-size:28px;color:#fff">${'نص تجريبي لقياس السرعة. '.repeat(30)}</p></section>`).join('') + '</body>'); const pdf = await pg.pdf({ width: '1600px', height: '1000px', printBackground: true }); await pg.close();
    const { id: ev } = await api('/api/events', { name: 'معرض ' + name, mode: 'stations' }), up = await api(`/api/events/${ev}/media?kind=pdf&name=b.pdf`, pdf.toString('base64'), 'PUT', 'application/pdf'), cur = await api(`/api/events/${ev}`, null, 'GET');
    await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, { ...cur.doc, media: { m: { kind: 'pdf', name: 'ك', src: up.src, count: 150 } }, stations: [{ id: 's1', name: 'الأولى', media: 'm', idle: 0 }] }]);
    await api(`/api/events/${ev}/publish`); return { o, p, api, ev }; };
  const A = await make('السرعة'); console.log('  book: ' + (await A.api(`/api/events/${A.ev}`, null, 'GET')).doc.media.m.count + ' pages');
  const c = await b.newContext({ viewport: { width: 1920, height: 1080 } }), s = await c.newPage(); s.on('pageerror', e => errs.push(e.message)); const cdp = await c.newCDPSession(s); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await s.goto(`${B}/${A.o.slug}/screen`); await s.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#code').textContent), null, { timeout: 15000 });
  await A.api(`/api/run/${A.ev}/pair`, { code: await s.textContent('#code'), station: 's1' }); const t0 = Date.now(); await s.waitForURL(/\/run\/station/, { timeout: 15000 });
  await s.waitForFunction(() => /صفحة|Page/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 60000 }).catch(() => {}); const first = Date.now() - t0;
  await s.mouse.click(960, 540); await s.waitForTimeout(500); const turns = []; for (let i = 0; i < 6; i++) { const a = Date.now(), before = await s.textContent('#pc'); await s.click('#bF').catch(() => s.keyboard.press('ArrowLeft')); await s.waitForFunction(b0 => document.querySelector('#pc').textContent !== b0, before, { timeout: 10000 }).catch(() => {}); turns.push(Date.now() - a); }
  const far = Date.now(); await s.evaluate(() => window.book && window.book.go && window.book.go(140)); const avg = Math.round(turns.reduce((x, y) => x + y, 0) / turns.length);
  console.log(`  first page: ${first} ms · turns: ${turns.join(', ')} ms (average ${avg})`);
  ok(first < 12000, `the station opens its 150-page book within 12 s on a slow screen (${first} ms)`); ok(avg < 1500, `a page turns within 1.5 s on average (${avg} ms)`);
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
