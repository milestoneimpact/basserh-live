// A full rehearsal of an exhibition of twenty touch screens of every common size, against a local server (npm run db && npm run dev):
// every screen opened by its own link; the board sees the twenty; the page fits each screen; a file given to all of them and a reset
// reach every screen (timed); the network cut on some screens: they keep browsing from the copy on the device, and catch up when it returns.
//   node test/rehearsal20.cjs      (OUT=<folder> for the screenshots)
const { chromium } = require('playwright'); const fs = require('fs');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', OUT = process.env.OUT || '/tmp/claude-0/r20/'; fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
// the sizes a hall meets: wide and upright, small and 4K, tablets, ultra-wide
const SIZES = [[1920, 1080, 1], [1080, 1920, 1], [3840, 2160, 1], [2160, 3840, 1], [1366, 768, 1], [1280, 800, 1], [2560, 1440, 1], [3440, 1440, 1], [1024, 1366, 2], [1366, 1024, 2],
  [1920, 1200, 1], [1200, 1920, 1], [1600, 900, 1], [800, 1280, 1.5], [1280, 720, 1], [2732, 2048, 1], [1440, 900, 1], [768, 1024, 2], [3840, 1080, 1], [1080, 1080, 1]];
(async () => {
  const b = await chromium.launch({ args: ['--disable-gpu', '--js-flags=--max-old-space-size=256'] }), errs = [];
  const mk = async (name, n, w, h, color) => { const pg = await b.newPage(); await pg.setContent(`<body style="margin:0;font-family:sans-serif">${Array.from({ length: n }, (_, i) => `<section style="height:100vh;page-break-after:always;display:grid;place-items:center;background:${color};border:12px solid #333;box-sizing:border-box"><h1 style="font-size:80px">${name} · ${i + 1}</h1></section>`).join('')}</body>`);
    const f = OUT + name + '.pdf'; await pg.pdf({ path: f, width: w + 'px', height: h + 'px', printBackground: true }); await pg.close(); return f; };
  const books = [await mk('wide', 8, 1600, 1000, '#EFE6D2'), await mk('tall', 6, 1000, 1414, '#D9E8E2'), await mk('square', 4, 1200, 1200, '#E8DDE9')];
  const org = await adm('POST', { name: 'بروفة العشرين', slug: 'r' + Date.now(), email: `r${Date.now()}@t.test`, events_limit: 3 }); await adm('PATCH', { id: org.org, add_credits: 1, features: ['stations'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }), p = await ctx.newPage(); p.on('dialog', d => d.accept()); await p.goto(B + org.join); await p.waitForSelector('#new');
  const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return r.json(); }, [path, body, method, type]);
  const { id: ev } = await api('/api/events', { name: 'معرض العشرين', mode: 'stations' }); const media = {};
  for (const [i, f] of books.entries()) { const r = await api(`/api/events/${ev}/media?kind=pdf&name=${encodeURIComponent('book' + i + '.pdf')}`, fs.readFileSync(f).toString('base64'), 'PUT', 'application/pdf'); media['m' + i] = { kind: 'pdf', name: ['كتاب عريض', 'كتاب طولي', 'كتاب مربع'][i], src: r.src, count: [8, 6, 4][i] }; }
  const cur = await api(`/api/events/${ev}`, null, 'GET'), doc = { ...cur.doc, media, stations: SIZES.map((s, i) => ({ id: 's' + (i + 1), name: 'المحطة ' + (i + 1), place: `${s[0]}×${s[1]}`, media: 'm' + (i % 3), idle: 0, dir: 'rtl', zoom: true, links: true, qr: false, thumbs: true })) };
  const put = await p.evaluate(async ([ev, doc]) => (await fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) })).json(), [ev, doc]);
  ok(!put.problems || !put.problems.length, 'an exhibition of 20 stations, 3 books (wide, upright, square)' + (put.problems && put.problems.length ? ': ' + put.problems.join(' | ') : ''));
  const pub = await api(`/api/events/${ev}/publish`); ok(pub.version === 1, 'published'); await api(`/api/events/${ev}/activate`, { from: new Date(new Date().toDateString()).toISOString() });
  // ----- twenty screens, each on its own device and link
  const screens = []; const t0 = Date.now();
  for (const [i, [w, h, dpr]] of SIZES.entries()) { const L = await api(`/api/events/${ev}/links`, { role: 'station', label: 's' + (i + 1) }), c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true }), s = await c.newPage(), x0 = { cut: false, socks: [] };
    // the network of this device, cut for real: its live connection closed and no new one opened, and no request goes out
    await c.routeWebSocket(/\/ws/, ws => { if (x0.cut) return ws.close(); ws.connectToServer(); x0.socks.push(ws); });
    s.on('pageerror', e => errs.push(`s${i + 1}: ${e.message}`)); await s.goto(B + L.url); screens.push(Object.assign(x0, { c, s, w, h, i, url: L.url })); }
  await Promise.all(screens.map(x => x.s.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 90000 }).catch(() => {})));
  const opened = []; for (const x of screens) opened.push(/صفحة/.test(await x.s.textContent('#pc')));
  ok(opened.every(Boolean), `all 20 screens opened their book in ${((Date.now() - t0) / 1000).toFixed(1)} s` + (opened.every(Boolean) ? '' : ': missing ' + opened.map((o, i) => o ? '' : 's' + (i + 1)).filter(Boolean).join(',')));
  // ----- the fit: the page inside the screen, whole, centred, never under the bar; the bar inside the screen
  const fit = []; for (const x of screens) { await x.s.touchscreen.tap(x.w / 2, x.h / 3); }
  await new Promise(r => setTimeout(r, 1200));
  for (const x of screens) { const m = await x.s.evaluate(() => { const room = document.querySelector('#room').getBoundingClientRect(), pz = document.querySelector('.sl[data-k="0"] .pz').getBoundingClientRect(), bar = document.querySelector('#bar').getBoundingClientRect(), cv = document.querySelector('.sl[data-k="0"] canvas');
      return { inside: pz.left >= room.left - 1 && pz.right <= room.right + 1 && pz.top >= room.top - 1 && pz.bottom <= room.bottom + 1, centred: Math.abs((pz.left + pz.right) / 2 - (room.left + room.right) / 2) < 3 && Math.abs((pz.top + pz.bottom) / 2 - (room.top + room.bottom) / 2) < 3,
        fill: Math.max(pz.width / room.width, pz.height / room.height), barIn: bar.bottom <= innerHeight + 1 && bar.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
        sharp: cv.width / pz.width, dpr: devicePixelRatio, buttons: [...document.querySelectorAll('#bar button:not([hidden])')].every(b => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.right <= innerWidth + 1 && r.left >= -1; }) }; });
    fit.push({ ...m, size: `${x.w}×${x.h}` }); if ([0, 1, 2, 7, 8, 18].includes(x.i)) await x.s.screenshot({ path: `${OUT}fit_${x.w}x${x.h}.jpg`, type: 'jpeg', quality: 60, scale: 'css' }); }
  const bad = fit.filter(f => !f.inside || !f.centred || f.fill < .9 || !f.barIn || !f.buttons || f.sharp < Math.min(f.dpr, 2) * .95);
  ok(!bad.length, 'every screen: the page whole, centred, filling its side (≥90%), sharp on its pixels, the bar and its buttons inside the screen' + (bad.length ? ': ' + bad.map(f => `${f.size} ${JSON.stringify(f)}`).join(' | ') : ''));
  console.log('   ' + fit.map(f => `${f.size}:${Math.round(f.fill * 100)}%`).join('  '));
  // ----- the board sees the twenty
  const bd = await ctx.newPage(); bd.on('pageerror', e => errs.push('board: ' + e.message)); bd.on('dialog', d => d.accept()); await bd.goto(`${B}/run/stations.html?e=${ev}`); await bd.waitForSelector('.card');
  await bd.waitForFunction(() => /متصلة (٢٠|20) من (٢٠|20)/.test(document.querySelector('#cnt').textContent), null, { timeout: 30000 }).catch(() => {}); ok(/متصلة (٢٠|20) من (٢٠|20)/.test(await bd.textContent('#cnt')), 'the board: ' + await bd.textContent('#cnt'));
  await bd.waitForFunction(() => document.querySelectorAll('.card canvas').length === 20, null, { timeout: 60000 }).catch(() => {}); ok(await bd.locator('.card canvas').count() === 20, 'the board draws the page of each of the twenty');
  await bd.setViewportSize({ width: 1920, height: 1080 }); await bd.screenshot({ path: OUT + 'board_20.jpg', type: 'jpeg', quality: 70, fullPage: true });
  // ----- one move from the board reaches every screen: a page turned on each, then the square book to all, then back to the first page
  for (const x of screens) await x.s.click('#bF', { timeout: 3000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 6000));   // the visitors pause (a file waits for five seconds without a touch)
  await bd.selectOption('#allF', 'm2'); await bd.click('#allGo'); let t = Date.now(); await bd.click('.qd .b.on');
  const arrive = await Promise.all(screens.map(x => x.s.waitForFunction(() => /من (٤|4)$/.test(document.querySelector('#pc').textContent.trim()), null, { timeout: 60000 }).then(() => Date.now() - t).catch(() => -1)));
  ok(arrive.every(v => v >= 0), `one file to all twenty: the last screen had it after ${(Math.max(...arrive) / 1000).toFixed(1)} s (median ${(arrive.sort((a, c) => a - c)[10] / 1000).toFixed(1)} s)`);
  for (const x of screens) await x.s.click('#bF', { timeout: 3000 }).catch(() => {}); await new Promise(r => setTimeout(r, 800));
  await bd.click('#home'); t = Date.now(); await bd.click('.qd .b.on');
  const back = await Promise.all(screens.map(x => x.s.waitForFunction(() => /^صفحة (١|1) /.test(document.querySelector('#pc').textContent), null, { timeout: 20000 }).then(() => Date.now() - t).catch(() => -1)));
  ok(back.every(v => v >= 0), `all twenty back to their first page: the last after ${(Math.max(...back) / 1000).toFixed(2)} s`);
  // ----- the network cut on five screens
  const cut = screens.slice(0, 5); const off = async x => { x.cut = true; await x.c.setOffline(true); for (const w of x.socks.splice(0)) await w.close().catch(() => {}); }, on = async x => { x.cut = false; await x.c.setOffline(false); };
  for (const x of cut) await off(x); await new Promise(r => setTimeout(r, 2500));
  let still = 0; for (const x of cut) { await x.s.touchscreen.tap(x.w / 2, x.h / 3); await new Promise(r => setTimeout(r, 700)); await x.s.click('#bF'); await new Promise(r => setTimeout(r, 600)); await x.s.click('#bF'); await new Promise(r => setTimeout(r, 600)); const pc = await x.s.textContent('#pc'); if (/^صفحة (٣|3) /.test(pc)) still++; else console.log('   s' + (x.i + 1) + ': ' + pc + ' att=' + await x.s.getAttribute('#att', 'class')); }
  ok(still === 5, `network cut: the five keep browsing their book from the device (${still}/5)`);
  ok((await cut[0].s.locator('#net.on').count()) === 1, 'and say so in a small corner mark, for the staff');
  // the book is kept inside the browser: the copy is there, and it is the whole file
  const kept = await cut[0].s.evaluate(async () => { const db = await new Promise((res, rej) => { const r = indexedDB.open('event-files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return new Promise(res => { const q = db.transaction('f').objectStore('f').getAllKeys(); q.onsuccess = () => res(q.result.filter(k => /\.pdf$/.test(k))); }); });
  ok(kept.length >= 1, 'the book is kept inside the browser of the device (IndexedDB): ' + kept.length + ' file(s)');
  // meanwhile the board gives the cut screens the wide book: they take it when the network returns
  await bd.selectOption('.card[data-s="s1"] [data-f]', 'm0'); await new Promise(r => setTimeout(r, 1000)); ok(/من (٤|4)$/.test((await cut[0].s.textContent('#pc')).trim()), 'a change made while a screen is cut does not reach it yet');
  t = Date.now(); for (const x of cut) await on(x);
  const caught = await cut[0].s.waitForFunction(() => /من (٨|8)$/.test(document.querySelector('#pc').textContent.trim()), null, { timeout: 40000 }).then(() => Date.now() - t).catch(() => -1);
  ok(caught >= 0, `network back: the screen takes the change made meanwhile after ${(caught / 1000).toFixed(1)} s`);
  await bd.waitForFunction(() => /متصلة (٢٠|20) من (٢٠|20)/.test(document.querySelector('#cnt').textContent), null, { timeout: 30000 }).catch(() => {}); ok(/متصلة (٢٠|20) من (٢٠|20)/.test(await bd.textContent('#cnt')), 'and the board counts the twenty again');
  // a screen restarted while the network is down
  await off(cut[1]); const re = await cut[1].s.reload({ timeout: 15000 }).then(() => cut[1].s.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 20000 })).then(() => true).catch(() => false);
  ok(re, 'a screen reloaded with no network opens again from what it keeps');
  await on(cut[1]);
  // a paired screen switched on with no network: /screen sends it to its station, which opens from its own copy
  { const x = cut[2]; await x.s.evaluate(([go]) => { localStorage.setItem('screen:go', go); }, [x.url]); await x.s.goto(B + '/screen'); await x.s.waitForURL(/\/run\/station/); await x.s.waitForTimeout(6000); await off(x);
    const boot = await x.s.goto(B + '/screen', { timeout: 15000 }).then(() => x.s.waitForURL(/\/run\/station/, { timeout: 15000 })).then(() => x.s.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 20000 })).then(() => true).catch(() => false);
    if (!boot) { await x.s.waitForTimeout(3000); console.log('   at', x.s.url(), await x.s.evaluate(() => document.body.innerText.slice(0, 200)).catch(e => 'ERR ' + e.message)); await x.s.screenshot({ path: OUT + 'boot_fail.jpg', scale: 'css' }).catch(() => {}); }
    ok(boot, 'a paired screen switched on with no network goes from /screen to its station, and its book opens'); await on(x); }
  ok(!errs.length, 'no page errors on the twenty screens and the board' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  await b.close();
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exit(1); });
