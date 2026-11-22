// The quick check of a fresh deploy (staging), run by tools/release.sh before live: a throwaway organisation with one stations event,
// a book, a published version, a screen opened by its link, a page turned, a visit counted, the board, the phone code. Then the organisation
// is deleted, so the copy keeps nothing of it.   BASE=<staging> ADMIN_KEY=<staging key> node test/smoke_stations.cjs
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
let failed = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) { failed++; process.exitCode = 1; } };
const adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
(async () => { const b = await chromium.launch(); let org = null;
  try {
    for (const p of ['/', '/screen', '/run/station.html', '/run/stations.html', '/sw.js', '/vendor/pdf.worker.min.mjs']) { const r = await fetch(B + p); ok(r.ok, `${p} ${r.status}`); }
    org = await adm('POST', { name: 'فحص النشر', slug: 'smoke-' + Date.now().toString(36), email: `smoke${Date.now()}@basserh.invalid` }); ok(org.status === 200 && org.join, 'a throwaway organisation');
    const page = await b.newPage(); await page.setContent('<body style="margin:0">' + [1, 2, 3].map(i => `<section style="height:100vh;page-break-after:always;font:80px sans-serif;display:grid;place-items:center">${i}</section>`).join('') + '</body>');
    const pdf = await page.pdf({ width: '1600px', height: '1000px' }); await page.close();
    const ctx = await b.newContext(), p = await ctx.newPage(); await p.goto(B + org.join); await p.waitForSelector('#new', { timeout: 30000 });
    const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return r.json(); }, [path, body, method, type]);
    const { id: ev } = await api('/api/events', { name: 'فحص المحطات', mode: 'stations' }); ok(!!ev, 'a stations event');
    const up = await api(`/api/events/${ev}/media?kind=pdf&name=book.pdf`, pdf.toString('base64'), 'PUT', 'application/pdf'); ok(!!up.src, 'a PDF kept in the bucket');
    const cur = await api(`/api/events/${ev}`, null, 'GET'), doc = { ...cur.doc, media: { m: { kind: 'pdf', name: 'كتاب', src: up.src, count: 3 } }, stations: [{ id: 's1', name: 'المحطة', media: 'm', idle: 0, qr: true }] };
    await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, doc]);
    ok((await api(`/api/events/${ev}/publish`)).version === 1, 'published');
    const L = await api(`/api/events/${ev}/links`, { role: 'station', label: 's1' }), sc = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true }), s = await sc.newPage(); await s.goto(B + L.url);
    await s.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 45000 }).catch(() => {}); ok(/من (٣|3)/.test(await s.textContent('#pc').catch(() => '')), 'a screen opens its book by its link');
    await s.touchscreen.tap(640, 300); await s.waitForTimeout(500); await s.click('#bF'); await s.waitForTimeout(800); ok(/^صفحة (٢|2)/.test(await s.textContent('#pc')), 'a page turned');
    const cfg = await s.evaluate(async e => (await fetch(`/api/run/${e}/config`)).json(), ev); ok(!!(cfg.read && cfg.read.s1), 'the phone code has its key');
    ok((await fetch(`${B}/api/read/${ev}/s1/l/${cfg.read.s1}`)).ok, 'the phone reads the station\'s file');
    await s.evaluate(() => dispatchEvent(new Event('pagehide'))); await s.waitForTimeout(3000);
    const v = await p.evaluate(async ev => (await fetch(`/api/events/${ev}/visits`, { headers: { 'x-org-slug': location.pathname.slice(1) } })).json(), ev); ok(v.total === 1, 'the visit reached the report');
    const bd = await ctx.newPage(); await bd.goto(`${B}/run/stations.html?e=${ev}`); await bd.waitForFunction(() => /متصلة (١|1) من (١|1)/.test(document.querySelector('#cnt')?.textContent || ''), null, { timeout: 20000 }).catch(() => {}); ok(/متصلة (١|1) من (١|1)/.test(await bd.textContent('#cnt')), 'the board sees the screen');
  } catch (e) { ok(false, String(e && e.message || e).slice(0, 200)); }
  finally { if (org && org.org) { const d = await adm('DELETE', { id: org.org, confirm: org.slug }); ok(d.status === 200, 'the throwaway organisation deleted'); } await b.close(); }
  console.log(failed ? `\nفشل ${failed} فحص. لا تنشروا على الموقع الحي.` : '\nكل الفحوص سليمة.'); })();
