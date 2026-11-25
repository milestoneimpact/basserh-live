// The owner's page, the hall's map and the board's finer picture, through the real pages, against a local server (npm run db && npm run dev):
// the platform's figures, test organisations hidden and deleted, an organisation opened; the plan of the hall with stations placed on it, the board's
// map with the state of each, the report's map; the station's own picture on the board, the connection's quality, the page turned as paper.
//   node test/dashboard.cjs
const { chromium } = require('playwright'); const fs = require('fs');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', OUT = process.env.OUT || '/tmp/claude-0/dash/'; fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (method, body, path = 'org') => fetch(B + '/api/admin/' + path, { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(), errs = [];
  const pg0 = await b.newPage(); await pg0.setContent('<body style="margin:0">' + [1, 2, 3].map(i => `<section style="height:100vh;page-break-after:always;font:80px sans-serif;display:grid;place-items:center;background:#EFE6D2">${i}</section>`).join('') + '</body>');
  const pdf = await pg0.pdf({ width: '1600px', height: '1000px', printBackground: true });
  await pg0.setViewportSize({ width: 1200, height: 700 }); await pg0.setContent('<body style="margin:0;width:1200px;height:700px;background:#fff;position:relative;font:30px sans-serif">' + ['المدخل', 'الجناح الشرقي', 'الجناح الغربي'].map((t, i) => `<div style="position:absolute;left:${80 + i * 360}px;top:200px;width:300px;height:300px;border:4px solid #333;display:grid;place-items:center">${t}</div>`).join('') + '</body>');
  await pg0.screenshot({ path: OUT + 'plan.png' }); await pg0.close();
  // a real organisation (not a test address) beside the test ones
  const real = await adm('POST', { name: 'جمعية حقيقية', slug: 'real' + Date.now().toString(36), email: `owner${Date.now()}@example.org` });
  const org = await adm('POST', { name: 'لوحة وخريطة', slug: 'd' + Date.now(), email: `d${Date.now()}@t.test` });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 960 } }), p = await ctx.newPage(); p.on('pageerror', e => errs.push('studio: ' + e.message)); p.on('dialog', d => d.accept()); await p.goto(B + org.join); await p.waitForSelector('#new');
  const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return r.json(); }, [path, body, method, type]);
  const { id: ev } = await api('/api/events', { name: 'معرض الخريطة', mode: 'stations' }), up = await api(`/api/events/${ev}/media?kind=pdf&name=book.pdf`, pdf.toString('base64'), 'PUT', 'application/pdf');
  const cur = await api(`/api/events/${ev}`, null, 'GET'), doc = { ...cur.doc, media: { m: { kind: 'pdf', name: 'الكتاب', src: up.src, count: 3 } }, stations: ['المدخل', 'الشرقي', 'الغربي'].map((n, i) => ({ id: 's' + (i + 1), name: n, media: 'm', idle: 0, turn: i === 0 ? 'page' : 'slide' })) };
  await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, doc]);
  // ----- the hall's plan in the studio: uploaded, two stations placed (one by a touch, one dragged), one left
  await p.reload(); await p.click('.ev:has-text("معرض الخريطة")'); await p.click('[data-t="hallmap"]'); await p.setInputFiles('#mpF', OUT + 'plan.png'); await p.waitForSelector('#mpB img', { timeout: 20000 });
  const box = await p.locator('#mpB').boundingBox(); await p.click('[data-mi="s1"]'); await p.mouse.click(box.x + box.width * .19, box.y + box.height * .5); await p.waitForSelector('[data-md="s1"]');
  await p.click('[data-mi="s2"]'); await p.mouse.click(box.x + box.width * .5, box.y + box.height * .5); await p.waitForSelector('[data-md="s2"]');
  const d1 = await p.locator('[data-md="s2"]').boundingBox(); await p.mouse.move(d1.x + 15, d1.y + 15); await p.mouse.down(); await p.mouse.move(box.x + box.width * .55, box.y + box.height * .45, { steps: 6 }); await p.mouse.up(); await wait(1500);
  const pos = await p.evaluate(async ev => (await (await fetch('/api/events/' + ev, { headers: { 'x-org-slug': location.pathname.slice(1) } })).json()).doc.stations.map(s => s.pos), ev);
  ok(pos[0] && Math.abs(pos[0].x - .19) < .03 && pos[1] && Math.abs(pos[1].x - .55) < .03 && !pos[2], 'the plan uploaded; a station placed by a touch, one moved by dragging its dot, one left unplaced: ' + JSON.stringify(pos));
  await p.screenshot({ path: OUT + '1_studio_map.jpg', type: 'jpeg', quality: 80 });
  await p.click('#pub'); await p.waitForFunction(() => /النسخة 1/.test(document.body.textContent), null, { timeout: 20000 });
  // ----- two screens; the board on the map
  const open = async (sid, w = 1600, h = 1000) => { const L = await api(`/api/events/${ev}/links`, { role: 'station', label: sid }), c = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true }), s = await c.newPage(); s.on('pageerror', e => errs.push(sid + ': ' + e.message)); await s.goto(B + L.url); await s.waitForFunction(() => /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 40000 }).catch(() => {}); return s; };
  const s1 = await open('s1'), s2 = await open('s2');
  ok(await s1.textContent('#aE') === 'معرض الخريطة' && await s1.locator('#att .alw').count() === 1, 'the waiting screen carries the event\'s name, the logo framed for its gleam'); await s1.screenshot({ path: OUT + '2_wait.jpg', type: 'jpeg', quality: 70 });
  await s1.touchscreen.tap(800, 400); await wait(500); await s1.click('#bF'); await wait(200); const flipping = await s1.evaluate(() => document.getAnimations().some(a => /rotateY/.test(JSON.stringify(a.effect.getKeyframes()))));
  await wait(700); ok(flipping && /^صفحة (٢|2) /.test(await s1.textContent('#pc')), 'station 1 turns its page as paper (a turn over the spine), and lands on page 2');
  const bd = await ctx.newPage(); bd.on('pageerror', e => errs.push('board: ' + e.message)); await bd.goto(`${B}/run/stations.html?e=${ev}`); await bd.waitForSelector('.card');
  await bd.waitForFunction(() => document.querySelectorAll('.card .scr img.snap').length >= 1, null, { timeout: 20000 }).catch(() => {}); ok(await bd.locator('.card[data-s="s1"] .scr img.snap').count() === 1, 'the board shows the station\'s own picture of what its visitor sees');
  ok(/الاتصال (ممتاز|جيد)/.test(await bd.textContent('.card[data-s="s1"] .tc')), 'and the quality of its connection: ' + await bd.textContent('.card[data-s="s1"] .tc'));
  ok(!(await bd.locator('#vw').isHidden()), 'the board offers the map'); await bd.click('#vw'); await bd.waitForSelector('#mapv.on .dot');
  ok(await bd.locator('.dot').count() === 2 && /1 محطة لم توضع/.test(await bd.textContent('#mvL')), 'two dots where the stations stand; the third said to be unplaced');
  await s1.touchscreen.tap(800, 400); await bd.waitForFunction(() => document.querySelector('[data-dot="s1"]').className === 'dot on', null, { timeout: 8000 }).catch(() => {});
  ok(await bd.getAttribute('[data-dot="s1"]', 'class') === 'dot on' && /dot (idle|on)/.test(await bd.getAttribute('[data-dot="s2"]', 'class')), 'station 1 (a visitor now) in green, station 2 waiting');
  await bd.screenshot({ path: OUT + '3_board_map.jpg', type: 'jpeg', quality: 80 }); await bd.click('[data-dot="s2"]'); await bd.waitForSelector('#big.on'); ok(/الشرقي/.test(await bd.textContent('#bN')), 'a dot opens its station, big'); await bd.click('#bX');
  await s2.close(); await wait(1500); await bd.waitForFunction(() => document.querySelector('[data-dot="s2"]').className === 'dot off', null, { timeout: 60000 }).catch(() => {}); ok(await bd.getAttribute('[data-dot="s2"]', 'class') === 'dot off', 'a station gone turns red on the map');
  // the rehearsal board says it is the rehearsal, counts the screens of the show, and opens the show's board where they are
  { const dr = await ctx.newPage(); await dr.goto(`${B}/run/stations.html?e=${ev}&draft`); await dr.waitForSelector('#drb.on'); await dr.waitForFunction(() => /متصلة/.test(document.querySelector('#drb .lv').textContent), null, { timeout: 15000 }).catch(() => {});
    ok(/في العرض الآن (١|1) شاشة متصلة/.test(await dr.textContent('#drb')), 'the rehearsal board says it is the rehearsal, and that 1 screen is connected to the show (the other was closed)');
    await dr.click('#drb a'); await dr.waitForFunction(() => /متصلة (١|1) من (٣|3)/.test(document.querySelector('#cnt').textContent), null, { timeout: 15000 }).catch(() => {}); ok(/متصلة (١|1) من (٣|3)/.test(await dr.textContent('#cnt')) && !(await dr.locator('#drb.on').count()), 'its button opens the show\'s board, where the paired screens are'); await dr.close(); }
  // the way back to the studio, to this event
  await bd.waitForSelector('#back:not([hidden])', { timeout: 10000 }).catch(() => {}); ok(!(await bd.locator('#back').isHidden()), 'the board has a way back to the studio');
  { const bk = await ctx.newPage(); await bk.goto(`${B}/run/stations.html?e=${ev}`); await bk.waitForSelector('#back:not([hidden])'); await bk.click('#back'); await bk.waitForSelector('.tabs [data-t="stations"].on', { timeout: 15000 }).catch(() => {});
    ok(/معرض الخريطة/.test(await bk.inputValue('#evName').catch(() => '')) && await bk.locator('.tabs [data-t="stations"].on').count() === 1, 'it opens this very event in the studio, on its stations'); await bk.close(); }
  // a question in the board's own identity, no browser box
  await bd.click('#home'); ok(await bd.locator('.qd').count() === 1, 'the board asks in its own window'); await bd.click('.qd .b:not(.on)'); ok(await bd.locator('.qd').count() === 0, 'and «إلغاء» closes it, nothing sent');
  // ----- the report's map
  await s1.evaluate(() => dispatchEvent(new Event('pagehide'))); await wait(2500); await p.click('[data-t="run"]'); await p.waitForSelector('#vis'); ok(await p.locator('#vis img[src*="/m/"] ~ i').count() === 2, 'the visitors\' report draws the hall with each station\'s visitors'); await p.locator('#vis').screenshot({ path: OUT + '4_report_map.jpg', type: 'jpeg', quality: 75 });
  // ----- the owner's page
  const ac = await b.newContext({ viewport: { width: 1440, height: 1000 } }), a = await ac.newPage(); a.on('pageerror', e => errs.push('admin: ' + e.message)); await ac.setExtraHTTPHeaders({ 'x-admin-key': AK });
  await a.goto(B + '/admin.html'); if (await a.locator('#pw').count()) { await a.fill('#pw', AK); await a.click('#pwIn'); } await a.waitForSelector('#kpis .kpi');
  const k = await a.$$eval('#kpis .kpi', l => l.map(x => x.textContent)); ok(k.length >= 6 && k.some(t => /الشاشات المتصلة الآن/.test(t)) && k.some(t => /استهلاك اليوم/.test(t)), 'the platform\'s figures at a glance: ' + k.map(t => t.replace(/\s+/g, ' ')).join(' | '));
  const vis = await a.$$eval('#rows .oc', l => l.map(x => x.textContent)); ok(vis.some(t => /جمعية حقيقية/.test(t)) && !vis.some(t => /لوحة وخريطة/.test(t)), 'test organisations hidden; the real one shown'); await a.screenshot({ path: OUT + '5_admin.jpg', type: 'jpeg', quality: 80, fullPage: true });
  await a.check('#tst'); await a.waitForFunction(() => /لوحة وخريطة/.test(document.querySelector('#rows').textContent)); const oc = a.locator('#rows .oc:has-text("لوحة وخريطة")').first();
  ok(/(١|1)/.test(await oc.locator('.nums div:nth-child(2) b').textContent()), 'its card counts the screen connected now'); await oc.locator('[data-open]').first().click(); await a.waitForSelector('#drawer.on .drow');
  ok(/معرض الخريطة/.test(await a.textContent('#dB')) && /شاشة الآن/.test(await a.textContent('#dB')), 'an organisation opened: its events, the one running now with its screens'); await a.screenshot({ path: OUT + '6_drawer.jpg', type: 'jpeg', quality: 80 }); await a.click('#dX');
  await a.click('#purge'); await a.waitForSelector('#dlg input'); await a.fill('#dlg input', 'حذف جهات الاختبار'); await a.click('#dlgOk'); await a.waitForFunction(() => !/لوحة وخريطة/.test(document.querySelector('#rows').textContent), null, { timeout: 30000 }).catch(() => {});
  ok(!/لوحة وخريطة/.test(await a.textContent('#rows')) && /جمعية حقيقية/.test(await a.textContent('#rows')), 'the test organisations deleted at once; the real one kept');
  await adm('DELETE', { id: real.org, confirm: real.slug });
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
  await b.close();
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exit(1); });
