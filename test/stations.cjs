// The interactive stations through the real pages, against a local server (npm run db && npm run dev):
// the platform owner opens the feature for an organisation; its studio offers the two kinds of event; a stations event with three
// touch screens, two PDFs; a station opened by its link (locked, browsed by touch, a link followed, the QR for the phone);
// the board sees every station live, makes one big, gives a station another file and sends it back to its first page; the phone reads.
//   node test/stations.cjs        (OUT=<folder> for the screenshots)
const { chromium, devices } = require('playwright'); const fs = require('fs');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', OUT = process.env.OUT || '/tmp/claude-0/st/'; fs.mkdirSync(OUT, { recursive: true });
const pickFile = async (p, btn, kindRe) => { await p.click(btn); await p.waitForSelector('.lm .lc'); const cards = p.locator('.lm .lc'), n = await cards.count();
  for (let i = 0; i < n; i++) { const t = await cards.nth(i).locator('.kd, .nm').allTextContents(); if (kindRe.test(t.join(' '))) { await cards.nth(i).click(); break; } } await p.click('.lm [data-ok]'); await p.waitForSelector('.lm', { state: 'detached' }); await p.waitForTimeout(300); };
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const MADE = [], adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).then(j => { if (method === 'POST' && j && j.org) MADE.push(j); return j; });
// every organisation this test made is deleted at the end, passed or failed, so nothing is left on the server it ran against
const tidy = async () => { for (const o of MADE.splice(0)) await adm('DELETE', { id: o.org, confirm: o.slug }).catch(() => {}); };
(async () => {
  const b = await chromium.launch(); const errs = [];
  // two books made here: pages with a link to another page, and a link out
  const mk = async (name, n, color) => { const pg = await b.newPage(); await pg.setContent(`<html dir="rtl"><body style="margin:0;font-family:sans-serif">${Array.from({ length: n }, (_, i) => `<section id="p${i + 1}" style="height:100vh;page-break-after:always;display:grid;place-items:center;background:${color};text-align:center"><div><h1 style="font-size:90px">${name} · ${i + 1}</h1>${i === 0 ? '<p style="font-size:40px"><a href="#p3">إلى الصفحة الثالثة</a></p><p style="font-size:40px"><a href="https://example.com/more">رابط خارجي</a></p>' : ''}</div></section>`).join('')}</body></html>`);
    const f = OUT + name + '.pdf'; await pg.pdf({ path: f, width: '1600px', height: '1000px', printBackground: true }); await pg.close(); return f; };
  const A = await mk('book-a', 5, '#EFE6D2'), Bk = await mk('book-b', 3, '#D9E8E2');
  const org = await adm('POST', { name: 'معرض آلي', slug: 's' + Date.now(), email: `o${Date.now()}@t.test`, events_limit: 3 }); await adm('PATCH', { id: org.org, add_credits: 1 });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage(); p.on('pageerror', e => errs.push('studio: ' + e.message)); p.on('dialog', d => d.accept());
  await p.goto(B + org.join); await p.waitForSelector('#new');
  await p.click('#new'); await p.waitForSelector('[data-tpl="stations"]'); ok(await p.locator('[data-tpl="stations"] li').count() >= 4, 'every organisation that is switched on has the stations: a new event asks its kind, and each kind lists what it brings');
  await p.screenshot({ path: OUT + '1_kind.jpg', type: 'jpeg', quality: 80 });
  await p.click('[data-tpl="stations"]'); await p.click('#dlgOk'); await p.click('[data-tpl="blank"]'); await p.fill('#dlgIn', 'معرض الإنجازات'); await p.fill('#nSt', '3'); await p.click('#dlgOk');
  await p.waitForFunction(() => document.querySelectorAll('[data-del]').length === 3); ok(await p.locator('.tabs button').count() === 5 && await p.locator('.tabs [data-t="stations"]').count() === 1, 'the event opens on its stations, with the steps and tabs of its kind (no cues, no people)');
  await p.click('[data-t="media"]'); await p.setInputFiles('#lib input[type=file]', [A, Bk]); await p.waitForFunction(() => document.querySelectorAll('#lib .lc').length === 2, null, { timeout: 60000 });
  const fl = await p.$$eval('#lib .lc .mt', l => l.map(e => e.textContent)); ok(fl.some(t => /5 صفحة/.test(t)) && fl.some(t => /3 صفحة/.test(t)) && await p.locator('#lib .lc .th img').count() === 2, 'two PDFs uploaded whole, each with its cover and its pages: ' + fl.join(' | '));
  await p.click('[data-t="stations"]');
  await pickFile(p, '[data-pick="media"][data-st="s1"]', /book-a/); await pickFile(p, '[data-pick="media"][data-st="s2"]', /book-b/); await pickFile(p, '[data-pick="media"][data-st="s3"]', /book-a/);
  await p.locator('[data-k="name"]').nth(0).fill('بوابة الإنجازات'); await p.locator('[data-k="qr"]').nth(0).check(); await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + '2_stations.jpg', type: 'jpeg', quality: 80, fullPage: true });
  const evId = await p.evaluate(async () => { const r = await fetch('/api/events', { headers: { 'x-org-slug': location.pathname.slice(1) } }); return (await r.json()).events[0].id; });
  await p.click('#pub'); await p.waitForFunction(() => /النسخة 1/.test(document.body.textContent), null, { timeout: 15000 }); ok(true, 'published');
  const api = (path, body, method = 'POST') => p.evaluate(async ([path, body, method]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); }, [path, body, method]);
  await api(`/api/events/${evId}/activate`, { from: new Date(new Date().toDateString()).toISOString() });
  await p.click('[data-t="run"]'); await p.waitForSelector('#laAll'); ok(await p.locator('#lr option').count() === 3 && await p.locator('#ll option').count() === 3, 'the links of a stations event: a screen per station, the hall\'s one link, and the board');
  const L = await api(`/api/events/${evId}/links`, { role: 'station', label: 's1' }), L2 = await api(`/api/events/${evId}/links`, { role: 'station', label: 's2' });
  // ----- a station, on a touch screen
  const sc = await b.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true }), s = await sc.newPage(); s.on('pageerror', e => errs.push('station: ' + e.message));
  await s.goto(B + L.url); await s.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 30000 });
  ok(/١ من ٥|1 من 5/.test(await s.textContent('#pc')), 'the station opens its own file on its first page: ' + await s.textContent('#pc'));
  ok(await s.locator('#att:not(.off)').count() === 1, 'nobody has touched it yet: it invites to touch'); await s.waitForTimeout(900); await s.screenshot({ path: OUT + '3_attract.jpg', type: 'jpeg', quality: 80 });
  await s.touchscreen.tap(960, 500); await s.waitForTimeout(700); ok(await s.locator('#att.off').count() === 1, 'a touch takes the invitation away');
  ok(await s.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; }), 'no menu on a long press');
  await s.evaluate(() => history.back()); await s.waitForTimeout(400); ok(/\/run\/station(\.html)?\?/.test(s.url()), 'going back leaves nothing: the station stays: ' + s.url());
  // a swipe: in an Arabic book the finger moves right to turn to the next page
  const swipe = async (x0, x1) => { const c = await s.evaluate(() => { const r = document.querySelector('.bk').getBoundingClientRect(); return { y: r.top + r.height / 2 }; }); const cdp = await sc.newCDPSession(s);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: c.y }] }); for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y: c.y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await s.waitForTimeout(800); };
  await swipe(500, 1300); ok(/٢ من ٥|2 من 5/.test(await s.textContent('#pc')), 'a swipe to the right turns to the next page: ' + await s.textContent('#pc'));
  await s.click('#bF'); await s.waitForTimeout(700); ok(/٣ من ٥|3 من 5/.test(await s.textContent('#pc')), 'the arrow on the left is «next» in an Arabic book');
  await s.click('#bT'); await s.waitForSelector('#th.on'); await s.waitForFunction(() => document.querySelectorAll('#thl canvas').length >= 3); await s.waitForTimeout(600); await s.screenshot({ path: OUT + '4_thumbs.jpg', type: 'jpeg', quality: 80 });
  await s.click('.t[data-n="5"]'); await s.waitForTimeout(700); ok(/٥ من ٥|5 من 5/.test(await s.textContent('#pc')) && !(await s.locator('#th.on').count()), 'the strip of pages: a page chosen, the strip closes');
  await s.click('#bH'); await s.waitForTimeout(700); ok(/١ من ٥|1 من 5/.test(await s.textContent('#pc')), 'back to the beginning with one button');
  // a link inside the book: to page 3; a link out becomes a code for the phone, never a page on the screen
  const lk = await s.evaluate(() => [...document.querySelectorAll('.sl[data-k="0"] .lk')].map(e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  ok(lk.length === 2, 'the two links of the first page are found: ' + lk.length);
  if (lk.length === 2) { const [l1, l2] = lk.sort((a, b2) => a.y - b2.y); await s.touchscreen.tap(l1.x, l1.y); await s.waitForTimeout(900); ok(/٣ من ٥|3 من 5/.test(await s.textContent('#pc')), 'a link to another page goes there');
    await s.click('#bH'); await s.waitForTimeout(800); await s.touchscreen.tap(l2.x, l2.y); await s.waitForTimeout(500); ok(await s.locator('#qrm.on').count() === 1 && /\/run\/station/.test(s.url()), 'a link out is shown as a code to scan, and the screen stays'); await s.screenshot({ path: OUT + '5_link_out.jpg', type: 'jpeg', quality: 80 }); await s.click('#qX'); }
  ok(!(await s.locator('#bQ').isHidden()), 'this station offers «continue on your phone»'); await s.click('#bQ'); await s.waitForSelector('#qrm.on'); await s.screenshot({ path: OUT + '6_qr.jpg', type: 'jpeg', quality: 80 }); await s.click('#qX');
  // a double tap brings the page closer
  await s.touchscreen.tap(960, 400); await s.waitForTimeout(60); await s.touchscreen.tap(960, 400); await s.waitForTimeout(800); ok(await s.evaluate(() => /scale\(2\.5\)/.test(document.querySelector('.sl[data-k="0"] .pz').style.transform)), 'a double tap brings the page closer');
  await s.touchscreen.tap(960, 400); await s.waitForTimeout(60); await s.touchscreen.tap(960, 400); await s.waitForTimeout(500);
  // the second station, with its own file
  const s2c = await b.newContext({ viewport: { width: 1080, height: 1920 }, hasTouch: true }), s2 = await s2c.newPage(); await s2.goto(B + L2.url); await s2.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 30000 });
  ok(/من ٣|من 3/.test(await s2.textContent('#pc')) && await s2.locator('#bQ').isHidden(), 'the second station (an upright screen) has its own file, and no phone code'); await s2.touchscreen.tap(540, 900); await s2.screenshot({ path: OUT + '7_upright.jpg', type: 'jpeg', quality: 70 });
  // ----- the board
  await s.click('#bF'); await s.waitForTimeout(400);
  const bd = await ctx.newPage(); bd.on('pageerror', e => errs.push('board: ' + e.message)); bd.on('dialog', d => d.accept()); await bd.goto(`${B}/run/console.html?e=${evId}`); await bd.waitForURL(/\/run\/stations/); await bd.waitForSelector('.card');
  await bd.waitForFunction(() => document.querySelectorAll('.tag.on, .tag.idle').length >= 2, null, { timeout: 20000 }); ok(await bd.locator('.card').count() === 3, 'the operator\'s console of a stations event is the board, with every station');
  await bd.waitForFunction(() => /٢ من ٥|2 من 5/.test(document.querySelector('.card[data-s="s1"] .pg').textContent), null, { timeout: 10000 }).catch(() => {}); ok(/٢ من ٥|2 من 5/.test(await bd.textContent('.card[data-s="s1"] .pg')), 'the board sees the page the visitor is on: ' + await bd.textContent('.card[data-s="s1"] .pg'));
  await bd.waitForFunction(() => document.querySelector('.card[data-s="s1"] canvas')); ok(true, 'and draws it'); ok(/متصلة ٢ من ٣|متصلة 2 من 3/.test(await bd.textContent('#cnt')), 'two of three connected: ' + await bd.textContent('#cnt'));
  await bd.screenshot({ path: OUT + '8_board.jpg', type: 'jpeg', quality: 80 });
  await bd.click('.card[data-s="s1"] [data-z]'); await bd.waitForSelector('#big.on canvas'); await bd.screenshot({ path: OUT + '9_big.jpg', type: 'jpeg', quality: 80 }); ok(true, 'a station made big on the board');
  await s.click('#bF'); await bd.waitForFunction(() => /٣ من ٥|3 من 5/.test(document.querySelector('#bI').textContent), null, { timeout: 8000 }).catch(() => {}); ok(/3 من 5/.test(await bd.textContent('#bI')), 'the big one follows the visitor live: ' + await bd.textContent('#bI'));
  await bd.selectOption('#bF', { index: 2 }); await s.waitForFunction(() => /من ٣|من 3/.test(document.querySelector('#pc').textContent), null, { timeout: 30000 }).catch(() => {}); ok(/من ٣|من 3/.test(await s.textContent('#pc')), 'the board gives the station another file; it moves to it once the visitor pauses, with no empty screen');
  await bd.click('#bX'); await s.click('#bF'); await s.waitForTimeout(500); await bd.click('.card[data-s="s1"] [data-h]'); await s.waitForFunction(() => /^صفحة (١|1) /.test(document.querySelector('#pc').textContent), null, { timeout: 8000 }).catch(() => {}); ok(/^صفحة (١|1) /.test(await s.textContent('#pc')) && await s.locator('#att:not(.off)').count() === 1, 'sent back to its first page from the board');
  await bd.click('.card[data-s="s2"] [data-d]'); await s2.waitForSelector('#dark.on', { timeout: 8000 }).catch(() => {}); ok(await s2.locator('#dark.on').count() === 1, 'a station put out shows the logo only'); await bd.click('.card[data-s="s2"] [data-d]');
  // ----- the phone, from the QR code
  const cfg = await s.evaluate(async e => (await fetch(`/api/run/${e}/config`)).json(), evId); ok(cfg.read && cfg.read.s1 && !cfg.read.s2 && !cfg.read.s3, 'a station is given the key of its own code only');
  ok((await s.evaluate(async e => (await fetch(`/api/run/${e}/pub`)).status, evId)) === 403, 'a station link reads nothing else of the event');
  const ph = await b.newContext({ ...devices['iPhone 13'], locale: 'ar-SA' }), r = await ph.newPage(); r.on('pageerror', e => errs.push('phone: ' + e.message));
  await r.goto(`${B}/run/reader.html#${new URLSearchParams({ e: evId, s: 's1', m: 'l', k: cfg.read.s1, p: 2 })}`); await r.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 30000 });
  ok(/من ٣|من 3/.test(await r.textContent('#pc')), 'the phone opens the file the station shows now: ' + await r.textContent('#pc')); await r.screenshot({ path: OUT + '10_phone.jpg', type: 'jpeg', quality: 80 });
  ok((await fetch(`${B}/api/read/${evId}/s1/l/${'0'.repeat(24)}`)).status === 403 && (await fetch(`${B}/api/read/${evId}/s2/l/${cfg.read.s1}`)).status === 403, 'a wrong key, or another station\'s, is refused');
  // ----- a screen paired by its code: /screen shows six digits, the board types them and picks the station; at the next start it goes there by itself
  const kc = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true }), k = await kc.newPage(); k.on('pageerror', e => errs.push('screen: ' + e.message));
  await k.goto(B + '/screen'); await k.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#code').textContent), null, { timeout: 15000 }); const code = await k.textContent('#code');
  ok(true, 'a new screen at /screen shows a code: ' + code); await k.screenshot({ path: OUT + '11_pair_code.jpg', type: 'jpeg', quality: 80 });
  await bd.click('#pair'); await bd.fill('#pmC', '123'); await bd.click('#pmGo'); ok(/ستة أرقام/.test(await bd.textContent('#pmE')), 'a short code is refused on the board');
  await bd.fill('#pmC', code); await bd.selectOption('#pmS', 's3'); await bd.screenshot({ path: OUT + '12_pair_board.jpg', type: 'jpeg', quality: 80 }); await bd.click('#pmGo');
  await k.waitForURL(/\/run\/station/, { timeout: 15000 }); await k.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 30000 }); ok(/من ٥|من 5/.test(await k.textContent('#pc')), 'the screen became station 3, with its file');
  await k.goto(B + '/screen'); await k.waitForURL(/\/run\/station/, { timeout: 15000 }); ok(true, 'started again at /screen, it goes straight to its station');
  const reused = await (await fetch(`${B}/api/run/${evId}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, station: 's1' }) })).status; ok(reused === 401, 'pairing needs the operator (no link, no session): ' + reused);
  // ----- the hall's one link: each screen asks once which station it is
  const H = await api(`/api/events/${evId}/links`, { role: 'hall' }), hc = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true }), h = await hc.newPage(); h.on('pageerror', e => errs.push('hall: ' + e.message));
  await h.goto(B + H.url); await h.waitForSelector('#pk button'); ok(await h.locator('#pk button').count() === 3, 'the hall link asks which station this screen is'); await h.screenshot({ path: OUT + '13_hall_pick.jpg', type: 'jpeg', quality: 80 });
  await h.click('#pk button >> nth=1'); await h.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 30000 }); ok(/من ٣|من 3/.test(await h.textContent('#pc')), 'the choice made, it is station 2 with its file');
  await h.reload(); await h.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 30000 }); ok(!(await h.locator('#pk').count()), 'the choice is kept: no question at the next start');
  // ----- the studio: more stations at once, a copy, the files given in order, a cover dragged onto a station
  await p.reload(); await p.click('.ev:has-text("معرض الإنجازات")'); await p.waitForSelector('.tabs');   // the activation above went by the API, behind this page's back
  await p.click('[data-t="stations"]'); await p.waitForSelector('#stN'); await p.fill('#stN', '3'); await p.click('#stAdd'); await p.waitForFunction(() => document.querySelectorAll('[data-del]').length === 6); ok(true, 'three stations added in one move');
  await p.click('[data-cp="s1"]'); await p.waitForFunction(() => document.querySelectorAll('[data-del]').length === 7); ok(await p.locator('[data-k="name"]').nth(1).inputValue() === 'بوابة الإنجازات (نسخة)', 'a station copied, next to it');
  await p.click('#stDist'); await p.waitForTimeout(300); const ms = await p.$$eval('[data-pick="media"] .ft b', l => l.map(x => x.textContent)); ok(ms.every(Boolean) && ms[0] !== ms[1] && ms[0] === ms[2], 'the files given to the stations in order: ' + ms.join(','));
  const target = p.locator('[data-drop]').nth(0), want = await p.locator('[data-lib]').nth(1).locator('small').textContent(); await target.evaluate(e => e.scrollIntoView({ block: 'end' })); await p.locator('[data-lib]').nth(1).dragTo(target, { targetPosition: { x: 40, y: 30 } }); await p.waitForTimeout(400);
  ok(await p.locator('[data-pick="media"] .ft b').nth(0).textContent() === want, 'a cover dragged from the library onto a station gives it that file'); await p.screenshot({ path: OUT + '14_library.jpg', type: 'jpeg', quality: 80, fullPage: true });
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exitCode = 1; process.exit(1); });
