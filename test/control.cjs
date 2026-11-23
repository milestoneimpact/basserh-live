// The board's readiness check and its further control, through the real pages, against a local server (npm run db && npm run dev):
// three screens, one with a missing phone code key and one never opened; the check names what is missing; a screen restarted from the board;
// the films' volume; a message on every screen until it is taken away; the installer's guide printed from the studio.
//   node test/control.cjs
const { chromium } = require('playwright'); const fs = require('fs'), { execFileSync } = require('child_process');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', OUT = process.env.OUT || '/tmp/claude-0/ctl/'; fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const MADE = [], adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).then(j => { if (method === 'POST' && j && j.org) MADE.push(j); return j; });
// every organisation this test made is deleted at the end, passed or failed, so nothing is left on the server it ran against
const tidy = async () => { for (const o of MADE.splice(0)) await adm('DELETE', { id: o.org, confirm: o.slug }).catch(() => {}); };
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(), errs = [];
  const pg0 = await b.newPage(); await pg0.setContent('<body style="margin:0">' + [1, 2, 3].map(i => `<section style="height:100vh;page-break-after:always;font:80px sans-serif;display:grid;place-items:center">${i}</section>`).join('') + '</body>');
  const pdf = await pg0.pdf({ width: '1600px', height: '1000px' }); await pg0.close(); execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '20', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', OUT + 'film.mp4']);
  const org = await adm('POST', { name: 'التحكم والجاهزية', slug: 'c' + Date.now(), email: `c${Date.now()}@t.test` });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => errs.push('studio: ' + e.message)); await p.goto(B + org.join); await p.waitForSelector('#new');
  const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return r.json(); }, [path, body, method, type]);
  const { id: ev } = await api('/api/events', { name: 'معرض التحكم', mode: 'stations' }), up = await api(`/api/events/${ev}/media?kind=pdf&name=book.pdf`, pdf.toString('base64'), 'PUT', 'application/pdf');
  const fv = await api(`/api/events/${ev}/media?kind=video&name=film.mp4`, fs.readFileSync(OUT + 'film.mp4').toString('base64'), 'PUT', 'video/mp4');
  const cur = await api(`/api/events/${ev}`, null, 'GET'), doc = { ...cur.doc, media: { m: { kind: 'pdf', name: 'الكتاب', src: up.src, count: 3 }, f: { kind: 'video', name: 'الفيلم', src: fv.src, length: 20 } },
    stations: [{ id: 's1', name: 'المحطة الأولى', place: 'المدخل', media: 'm', idle: 0, qr: true, schedule: [{ at: '23:59', media: 'f' }] }, { id: 's2', name: 'المحطة الثانية', media: 'f', idle: 0 }, { id: 's3', name: 'المحطة الثالثة', media: 'm', idle: 0 }] };
  await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, doc]);
  await api(`/api/events/${ev}/publish`);
  const open = async (sid, w = 1600, h = 1000) => { const L = await api(`/api/events/${ev}/links`, { role: 'station', label: sid }), c = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true }), s = await c.newPage(); s.on('pageerror', e => errs.push(sid + ': ' + e.message)); await s.goto(B + L.url); await s.waitForFunction(() => /صفحة|من/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 40000 }); return s; };
  const s1 = await open('s1'), s2 = await open('s2', 800, 500); await wait(3000);
  // ----- the readiness check: two screens open (one too small), the third never opened
  const bd = await ctx.newPage(); bd.on('pageerror', e => errs.push('board: ' + e.message)); bd.on('dialog', d => d.accept()); await bd.goto(`${B}/run/stations.html?e=${ev}`); await bd.waitForSelector('.card');
  await bd.waitForFunction(() => /متصلة (٢|2) من (٣|3)/.test(document.querySelector('#cnt').textContent), null, { timeout: 20000 }).catch(() => {});
  await bd.click('#rdy'); await bd.waitForSelector('#rm.on table'); await wait(1500);
  const row = n => bd.$$eval(`#rmT tr:nth-child(${n + 1}) td`, l => l.map(x => x.className + ':' + x.textContent));
  const r1 = await row(1), r2 = await row(2), r3 = await row(3);
  ok(/جاهزة (٢|2) من (٣|3)/.test(await bd.textContent('#rmS')) || /جاهزة (١|1) من (٣|3)/.test(await bd.textContent('#rmS')), 'the check counts the screens ready: ' + await bd.textContent('#rmS'));
  ok(r1.slice(1).every(x => /^ok:/.test(x)) && /أوقات|وقت/.test(r1[8]) && /✓/.test(r1[7]) && /✓/.test(r1[4]), 'station 1: connected, open, kept, visits sent, latest version, size, phone code, its schedule: ' + r1.slice(1).join(' | '));
  ok(/^wa:.*صغيرة/.test(r2[6]) && /غير مطلوب/.test(r2[7]), 'station 2: its screen is small (800×500), no phone code asked: ' + r2[6]);
  ok(/^no:لم تُفتح بعد/.test(r3[1]), 'station 3: never opened, said so in red');
  await bd.screenshot({ path: OUT + '1_readiness.jpg', type: 'jpeg', quality: 80 }); await bd.click('#rmX');
  // ----- a screen restarted from the board
  await s1.evaluate(() => { window.__mark = 1; }); await bd.click('.card[data-s="s1"] [data-r]'); await bd.click('.qd .b.on');
  await s1.waitForFunction(() => !window.__mark && /صفحة/.test(document.querySelector('#pc')?.textContent || ''), null, { timeout: 30000 }).catch(() => {}); ok(await s1.evaluate(() => !window.__mark), 'the board restarts a screen: it reloaded itself and opened its book again');
  // ----- the films' volume: station 2 shows a film
  await s2.touchscreen.tap(400, 200); await wait(500); await s2.touchscreen.tap(400, 200); await wait(500);
  await bd.fill('#vLvl', '40'); await bd.dispatchEvent('#vLvl', 'input'); await wait(1200); ok(Math.abs(await s2.evaluate(() => document.querySelector('.film video').volume) - .4) < .01, 'the films\' volume set from the board: 40%');
  await bd.click('#vMute'); await wait(1200); ok(await s2.evaluate(() => { const v = document.querySelector('.film video'); return v.volume === 0 && v.muted; }), 'and silenced on every screen with one button');
  await bd.click('#vMute'); await wait(1000); ok(Math.abs(await s2.evaluate(() => document.querySelector('.film video').volume) - .4) < .01, 'its sound back at the level it had');
  // ----- a message on every screen
  await bd.fill('#mTxt', 'يُغلق المعرض بعد ربع ساعة'); await bd.selectOption('#mMin', '15'); await bd.click('#mGo'); await wait(1200);
  ok(await s1.textContent('#msgb.on').catch(() => '') === 'يُغلق المعرض بعد ربع ساعة' && await s2.locator('#msgb.on').count() === 1, 'a message shown on every screen'); ok(/معروضة حتى/.test(await bd.textContent('#mNow')), 'the board says until when');
  await s1.screenshot({ path: OUT + '2_message.jpg', type: 'jpeg', quality: 70 }); await bd.click('#mOff'); await wait(1200); ok(await s1.locator('#msgb.on').count() === 0, 'taken away from the board');
  // ----- the installer's guide
  await p.reload(); await p.click('.ev:has-text("معرض التحكم")'); await p.click('[data-t="run"]'); await p.waitForSelector('#guide');
  const [gw] = await Promise.all([ctx.waitForEvent('page'), p.click('#guide')]); await gw.waitForLoadState(); const g = await gw.textContent('body');
  ok(/دليل التركيب: معرض التحكم/.test(g) && /المحطة الثالثة/.test(g) && /\/screen/.test(g) && /23:59 الفيلم/.test(g) && /إعادة تشغيل/.test(g) && await gw.locator('svg').count() === 1, 'the installer\'s guide: the screens with their places, files and schedule, the start page and its code, what to do when');
  await gw.screenshot({ path: OUT + '3_guide.jpg', type: 'jpeg', quality: 75, fullPage: true });
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
  await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
