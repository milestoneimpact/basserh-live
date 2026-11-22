// The seven additions to the stations, through the real pages, against a local server (npm run db && npm run dev):
// a gallery of pictures and a film as station files; a picture show on the waiting screen; searching a book with the screen's own keyboard;
// a schedule that changes a station's file by the clock; the board's alerts and its phone layout; the report's days compared.
//   node test/stations7.cjs
const { chromium, devices } = require('playwright'); const fs = require('fs'), { execFileSync } = require('child_process');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', OUT = process.env.OUT || '/tmp/claude-0/s7/'; fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(), errs = [];
  // the files: a book with words to find, three pictures, a short film
  const pg0 = await b.newPage(); await pg0.setContent(`<body style="margin:0;font-family:sans-serif">${['مقدمة التقرير', 'الإنجازات السنوية للجمعية', 'المشاريع والبرامج', 'الإنجازات في التعليم', 'الخاتمة'].map(t => `<section dir="rtl" style="height:100vh;page-break-after:always;padding:80px;box-sizing:border-box;background:#EFE6D2"><h1 style="font-size:64px">${t}</h1><p style="font-size:30px">نص تجريبي عن ${t}</p></section>`).join('')}</body>`);
  await pg0.pdf({ path: OUT + 'book.pdf', width: '1600px', height: '1000px', printBackground: true });
  for (const [i, c] of ['#0F5A4E', '#C2A063', '#8E2A1E'].entries()) { await pg0.setContent(`<body style="margin:0;background:${c};width:1200px;height:800px;display:grid;place-items:center;color:#fff;font:120px sans-serif">${i + 1}</body>`); await pg0.setViewportSize({ width: 1200, height: 800 }); await pg0.screenshot({ path: `${OUT}p${i + 1}.jpg`, type: 'jpeg' }); }
  await pg0.close(); execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', OUT + 'film.mp4']);
  const org = await adm('POST', { name: 'الإضافات السبع', slug: 'x' + Date.now(), email: `x${Date.now()}@t.test`, events_limit: 3 }); await adm('PATCH', { id: org.org, add_credits: 2, features: ['stations'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => errs.push('studio: ' + e.message)); await p.goto(B + org.join); await p.waitForSelector('#new');
  // the studio: a stations event; the book, three pictures dropped together, a film, through the files tab
  await p.click('#new'); await p.click('[data-tpl="stations"]'); await p.click('#dlgOk'); await p.waitForSelector('#nSt'); await p.fill('#dlgIn', 'معرض الإضافات'); await p.fill('#nSt', '3'); await p.click('#dlgOk'); await p.waitForFunction(() => document.querySelectorAll('[data-del]').length === 3);
  await p.click('[data-t="media"]'); await p.setInputFiles('#fi', [OUT + 'book.pdf', OUT + 'p1.jpg', OUT + 'p2.jpg', OUT + 'p3.jpg', OUT + 'film.mp4']); await p.waitForFunction(() => document.querySelectorAll('.file').length === 3, null, { timeout: 90000 });
  const fl = await p.$$eval('.file small', l => l.map(e => e.textContent)); ok(fl.some(t => /معرض صور · 3 صورة/.test(t)) && fl.some(t => /فيديو/.test(t)) && fl.some(t => /كتاب PDF · 5 صفحة/.test(t)), 'three pictures dropped together became one gallery; the film and the book beside it: ' + fl.join(' | '));
  await p.click('[data-t="stations"]'); const kinds = await p.$$eval('select[data-k="media"] >> nth=0', s => [...s[0].options].map(o => o.textContent));
  const sel = (i, re) => p.locator('select[data-k="media"]').nth(i).selectOption({ label: kinds.find(t => re.test(t)) });
  await sel(0, /PDF|صفحة/); await sel(1, /صورة/); await sel(2, /فيديو/);
  const waitOpt = await p.$$eval('select[data-k="attract"] >> nth=0', s => [...s[0].options].map(o => o.textContent)); await p.locator('select[data-k="attract"]').nth(0).selectOption({ label: waitOpt.find(t => /صورة/.test(t)) });
  // a schedule on the first station: from a time already passed today, the gallery
  await p.click('[data-scha="s1"]'); await p.waitForSelector('[data-sch="s1"][data-f="at"]');
  const tzNow = await p.evaluate(() => { const d = new Date(Date.now() - 2 * 60000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); });
  await p.fill('[data-sch="s1"][data-f="at"]', tzNow); await p.dispatchEvent('[data-sch="s1"][data-f="at"]', 'change'); await p.selectOption('[data-sch="s1"][data-f="media"]', { label: kinds.find(t => /صورة/.test(t)) }); await p.dispatchEvent('[data-sch="s1"][data-f="media"]', 'change'); await wait(1200);
  await p.screenshot({ path: OUT + '1_studio.jpg', type: 'jpeg', quality: 75, fullPage: true });
  await p.click('#pub'); await p.waitForFunction(() => /النسخة 1/.test(document.body.textContent), null, { timeout: 15000 }); ok(true, 'published: a book, a gallery, a film, a picture show to wait on, a schedule');
  const api = (path, body, method = 'POST') => p.evaluate(async ([path, body, method]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); }, [path, body, method]);
  const ev = await p.evaluate(async () => (await (await fetch('/api/events', { headers: { 'x-org-slug': location.pathname.slice(1) } })).json()).events[0].id); await api(`/api/events/${ev}/activate`, { from: new Date(new Date().toDateString()).toISOString() });
  const open = async sid => { const L = await api(`/api/events/${ev}/links`, { role: 'station', label: sid }), c = await b.newContext({ viewport: { width: 1600, height: 1000 }, hasTouch: true }), x = { c, cut: false, socks: [] };
    await c.routeWebSocket(/\/ws/, ws => { if (x.cut) return ws.close(); ws.connectToServer(); x.socks.push(ws); }); x.s = await c.newPage(); x.s.on('pageerror', e => errs.push(sid + ': ' + e.message)); await x.s.goto(B + L.url);
    await x.s.waitForFunction(() => /صفحة|من/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 40000 }); return x; };
  // ----- station 1: its schedule has turned, so it shows the gallery; the waiting screen shows the pictures
  const s1 = await open('s1'); await wait(800);
  ok(/من (٣|3)$/.test((await s1.s.textContent('#pc')).trim()), 'the schedule turned: station 1 shows the gallery now, not its book: ' + await s1.s.textContent('#pc'));
  ok(await s1.s.locator('#att.media #aM img').count() === 3, 'its waiting screen shows the organisation\'s pictures one after another'); await s1.s.screenshot({ path: OUT + '2_wait_pictures.jpg', type: 'jpeg', quality: 70 });
  await s1.s.touchscreen.tap(800, 400); await wait(600); await s1.s.click('#bF'); await wait(800); ok(/^صفحة (٢|2) من (٣|3)/.test(await s1.s.textContent('#pc')), 'the gallery turns like a book');
  ok(await s1.s.locator('#bS').isHidden(), 'no search on a gallery (no text)'); await s1.s.screenshot({ path: OUT + '3_gallery.jpg', type: 'jpeg', quality: 70 });
  // the operator's choice holds against the schedule until it turns again
  const bd = await ctx.newPage(); bd.on('pageerror', e => errs.push('board: ' + e.message)); bd.on('dialog', d => d.accept()); await bd.goto(`${B}/run/stations.html?e=${ev}`); await bd.waitForSelector('.card');
  ok(/الجدولة: \d\d:\d\d/.test(await bd.textContent('.card[data-s="s1"] .sc')), 'the board shows the station\'s schedule: ' + await bd.textContent('.card[data-s="s1"] .sc'));
  await bd.selectOption('.card[data-s="s1"] [data-f]', { label: (await bd.$$eval('.card[data-s="s1"] [data-f] option', o => o.map(x => x.textContent))).find(t => /صفحة/.test(t)) }); await wait(6500);
  await s1.s.waitForFunction(() => /من (٥|5)$/.test(document.querySelector('#pc').textContent.trim()), null, { timeout: 30000 }).catch(() => {}); ok(/من (٥|5)$/.test((await s1.s.textContent('#pc')).trim()), 'the operator gives it the book: it holds, the schedule has not turned since');
  // ----- search in the book with the screen's keyboard
  await s1.s.touchscreen.tap(800, 400); await wait(400); ok(!(await s1.s.locator('#bS').isHidden()), 'a book with text: the search button'); await s1.s.click('#bS'); await s1.s.waitForSelector('#sp.on #kb button');
  for (const k of ['ا', 'ل', 'ا', 'ن', 'ج', 'ا', 'ز', 'ا', 'ت']) await s1.s.click(`#kb button[data-k="${k}"]`);
  await s1.s.waitForFunction(() => document.querySelectorAll('#sr button').length > 0 || /لا نتائج/.test(document.querySelector('#sr').textContent), null, { timeout: 20000 }).catch(() => {});
  const hits = await s1.s.$$eval('#sr button b', l => l.map(x => x.textContent)); ok(hits.length === 2 && /2/.test(hits[0]) && /4/.test(hits[1]), 'typed «الانجازات» on the screen\'s keyboard: found on pages 2 and 4 (written «الإنجازات»): ' + hits.join(' | '));
  await s1.s.screenshot({ path: OUT + '4_search.jpg', type: 'jpeg', quality: 75 }); await s1.s.click('#sr button >> nth=1'); await wait(900); ok(/^صفحة (٤|4) /.test(await s1.s.textContent('#pc')) && !(await s1.s.locator('#sp.on').count()), 'a result opens its page');
  // ----- station 3: a film
  const s3 = await open('s3'); await wait(1500); const film = await s3.s.evaluate(() => { const v = document.querySelector('.film video'); return v ? { muted: v.muted, playing: !v.paused, t: v.currentTime } : null; });
  ok(film && film.muted && film.playing, 'a film station plays its film silently while it waits'); await s3.s.touchscreen.tap(800, 300); await wait(700); await s3.s.touchscreen.tap(800, 400); await wait(700);
  const film2 = await s3.s.evaluate(() => { const v = document.querySelector('.film video'); return { muted: v.muted, t: v.currentTime }; }); ok(!film2.muted, 'a touch brings its sound');
  const t0 = film2.t; await s3.s.click('#bF'); await wait(300); const t1 = await s3.s.evaluate(() => document.querySelector('.film video').currentTime); ok(Math.abs(t1 - t0 - 10) < 2.5 || t1 > t0 + 7, `the arrow moves ten seconds (${t0.toFixed(1)} → ${t1.toFixed(1)})`);
  ok(await s3.s.locator('#bT').isHidden() && await s3.s.locator('#bS').isHidden() && /من 0:30|من ٠:٣٠/.test(await s3.s.textContent('#pc')), 'no pages strip, no search; the bar shows the time: ' + await s3.s.textContent('#pc')); await s3.s.screenshot({ path: OUT + '5_film.jpg', type: 'jpeg', quality: 70 });
  // ----- alerts: station 3 cut off; the board says so
  s3.cut = true; await s3.c.setOffline(true); for (const w of s3.socks.splice(0)) await w.close().catch(() => {});
  await bd.waitForFunction(() => /انقطعت/.test(document.querySelector('#alerts').textContent), null, { timeout: 70000 }).catch(() => {}); ok(/المحطة 3: انقطعت/.test(await bd.textContent('#alerts')), 'the board raises an alert: ' + await bd.textContent('#alerts'));
  await bd.screenshot({ path: OUT + '6_alert.jpg', type: 'jpeg', quality: 75 });
  s3.cut = false; await s3.c.setOffline(false); await bd.waitForFunction(() => !/انقطعت/.test(document.querySelector('#alerts').textContent), null, { timeout: 40000 }).catch(() => {}); ok(!/انقطعت/.test(await bd.textContent('#alerts')), 'and takes it away when the station is back');
  // ----- the board on a phone
  const mc = await b.newContext({ ...devices['iPhone 13'] }), m = await mc.newPage(); m.on('pageerror', e => errs.push('phone board: ' + e.message));
  await mc.addCookies((await ctx.cookies()).map(c => ({ ...c }))); await m.goto(`${B}/run/stations.html?e=${ev}`); await m.waitForSelector('.card canvas', { timeout: 30000 });
  const lay = await m.evaluate(() => ({ cols: getComputedStyle(document.querySelector('main')).gridTemplateColumns.split(' ').length, wide: document.documentElement.scrollWidth <= innerWidth + 1, card: document.querySelector('.card').getBoundingClientRect().width / innerWidth }));
  ok(lay.cols === 1 && lay.wide && lay.card > .85, `the board on a phone: one column, no sideways scrolling (${JSON.stringify(lay)})`); await m.screenshot({ path: OUT + '7_board_phone.jpg', type: 'jpeg', quality: 75, fullPage: true });
  // ----- the visits of two days, compared
  await s1.s.evaluate(() => dispatchEvent(new Event('pagehide'))); await wait(2500);
  await s1.s.evaluate(async e => fetch(`/api/run/${e}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list: [1, 2, 3].map(i => ({ id: 'yesterday00' + i, station: 's2', media: '', start: Date.now() - 864e5 - i * 60000, ms: 30000 * i, pages: { 1: 10000, 2: 5000 } })) }) }), ev);
  await p.reload(); await p.click('.ev:has-text("معرض الإضافات")'); await p.click('[data-t="run"]'); await p.waitForSelector('#vis #visD', { timeout: 15000 });
  const days = await p.$$eval('#visD option', o => o.map(x => x.value)); ok(days.length === 3, 'the report lists the two days to compare: ' + days.slice(1).join(', '));
  await p.locator('#vis').screenshot({ path: OUT + '8_days.jpg', type: 'jpeg', quality: 80 });
  await p.selectOption('#visD', days[1]); await p.waitForFunction(d => document.querySelector('#visD')?.value === d, days[1], { timeout: 15000 }); await wait(800);
  ok(/^3$/.test((await p.$$eval('#vis b', l => l.map(x => x.textContent.trim())))[0] || ''), 'one day chosen: its own figures (3 visits yesterday)');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  await b.close();
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exit(1); });
