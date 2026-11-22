// The library of a stations event, through the real studio and board, against a local server (npm run db && npm run dev):
// cards with their own pictures (a film's frame), what to watch for, filters, search, groups, a preview, a file replaced everywhere it is used,
// a copy, a delete refused while used, several files given to several stations in order, the picker in the stations tab and on the board.
//   node test/library.cjs
const { chromium } = require('playwright'); const fs = require('fs'), { execFileSync } = require('child_process');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', OUT = process.env.OUT || '/tmp/claude-0/lib/'; fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const MADE = [], adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).then(j => { if (method === 'POST' && j && j.org) MADE.push(j); return j; });
// every organisation this test made is deleted at the end, passed or failed, so nothing is left on the server it ran against
const tidy = async () => { for (const o of MADE.splice(0)) await adm('DELETE', { id: o.org, confirm: o.slug }).catch(() => {}); };
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(), errs = [];
  const pg0 = await b.newPage(); const book = async (name, n) => { await pg0.setContent('<body style="margin:0">' + Array.from({ length: n }, (_, i) => `<section style="height:100vh;page-break-after:always;font:80px sans-serif;display:grid;place-items:center;background:#EFE6D2">${name} ${i + 1}</section>`).join('') + '</body>'); const f = `${OUT}${name}.pdf`; await pg0.pdf({ path: f, width: '1600px', height: '1000px', printBackground: true }); return f; };
  const A = await book('alpha', 4), Bk = await book('beta', 2), A2 = await book('alpha-v2', 6);
  for (const i of [1, 2]) { await pg0.setViewportSize({ width: 600, height: 400 }); await pg0.setContent(`<body style="margin:0;background:#0F5A4E;color:#fff;font:120px sans-serif;display:grid;place-items:center;height:400px">${i}</body>`); await pg0.screenshot({ path: `${OUT}s${i}.jpg`, type: 'jpeg' }); }
  await pg0.close(); execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '12', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', OUT + 'film.mp4']);
  const org = await adm('POST', { name: 'المكتبة', slug: 'l' + Date.now(), email: `l${Date.now()}@t.test` });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }), p = await ctx.newPage(); p.on('pageerror', e => errs.push('studio: ' + e.message)); await p.goto(B + org.join); await p.waitForSelector('#new');
  await p.click('#new'); await p.click('[data-tpl="stations"]'); await p.click('#dlgOk'); await p.click('[data-tpl="blank"]'); await p.fill('#dlgIn', 'معرض المكتبة'); await p.fill('#nSt', '4'); await p.click('#dlgOk'); await p.waitForFunction(() => document.querySelectorAll('[data-del]').length === 4);
  // ----- the upload: each file with its own bar; three cards (two pictures make one gallery)
  await p.click('[data-t="media"]'); await p.waitForSelector('#lib .lb-drop'); await p.setInputFiles('#lib input[type=file]', [A, Bk, OUT + 'film.mp4', OUT + 's1.jpg', OUT + 's2.jpg']);
  await p.waitForFunction(() => document.querySelectorAll('#lib .lc').length === 4, null, { timeout: 90000 }); ok(true, 'two books, a film and a gallery made of two pictures: four cards');
  const film = p.locator('#lib .lc:has(.kd:text("فيلم"))'), gal = p.locator('#lib .lc:has(.kd:text("معرض صور"))');
  ok(await film.locator('.th img').count() === 1, 'the film has a frame from inside it as its picture'); ok(/0:12/.test(await film.locator('.ms').textContent()), 'and its length on the picture');
  ok(/دقة منخفضة/.test(await gal.locator('.wn').textContent().catch(() => '')), 'the gallery of small pictures is flagged: low resolution');
  ok(/بلا صوت/.test(await film.locator('.wn').textContent().catch(() => '')), 'the film with no sound is flagged');
  await p.screenshot({ path: OUT + '1_library.jpg', type: 'jpeg', quality: 80, fullPage: true });
  // ----- filters, search, sort
  await p.click('#lib [data-kind="pdf"]'); ok(await p.locator('#lib .lc').count() === 2, 'the books alone'); await p.click('#lib [data-kind=""]');
  await p.fill('#lib .lb-q', 'bet'); await wait(300); ok(await p.locator('#lib .lc').count() === 1 && /beta/.test(await p.locator('#lib .lc .nm').inputValue()), 'search by name'); await p.fill('#lib .lb-q', ''); await wait(300);
  // ----- groups: one file, then two at once
  p.once('dialog', d => d.accept()); await p.locator('#lib .lc:has(.nm[value="alpha"]) .add').click(); await p.waitForSelector('#dlgIn'); await p.fill('#dlgIn', 'الصباح'); await p.click('#dlgOk'); await wait(300);
  for (const n of ['beta']) await p.locator(`#lib .lc:has(.nm[value="${n}"]) .ck input`).check(); await film.locator('.ck input').check();
  await p.click('#lib [data-s="tag"]'); await p.waitForSelector('#dlgIn'); await p.fill('#dlgIn', 'المساء'); await p.click('#dlgOk'); await wait(300);
  ok(await p.locator('#lib [data-tag]').count() === 2, 'two groups made: الصباح، المساء'); await p.click('#lib [data-tag="المساء"]'); ok(await p.locator('#lib .lc').count() === 2, 'the library shown by group'); await p.click('#lib [data-tag="المساء"]');
  // ----- several files to several stations, in order
  await p.click('#lib [data-s="none"]'); for (const n of ['alpha', 'beta']) await p.locator(`#lib .lc:has(.nm[value="${n}"]) .ck input`).check();
  await p.click('#lib [data-s="assign"]'); await p.waitForSelector('.lm .stl'); await p.check('.lm [data-all]'); await p.click('.lm [data-ok]'); await wait(500);
  ok(/المحطة 1/.test(await p.locator('#lib .lc:has(.nm[value="alpha"]) .us').textContent()) && /المحطة 2/.test(await p.locator('#lib .lc:has(.nm[value="beta"]) .us').textContent()) && /المحطة 3/.test(await p.locator('#lib .lc:has(.nm[value="alpha"]) .us').textContent()), 'two files to four stations in order: each card says where it is used');
  // ----- a delete refused while used; a copy; a copy deleted
  await p.locator('#lib .lc:has(.nm[value="alpha"]) [data-a="rm"]').click(); await wait(300); ok(/مستعمل في/.test(await p.textContent('#toast')), 'a file in use cannot be deleted: the studio says where');
  await p.locator('#lib .lc:has(.nm[value="beta"]) [data-a="dup"]').click(); await wait(300); ok(await p.locator('#lib .lc').count() === 5, 'a copy made');
  await p.locator('#lib .lc:has(.nm[value="beta (نسخة)"]) [data-a="rm"]').click(); await p.waitForSelector('#dlgOk'); await p.click('#dlgOk'); await wait(300); ok(await p.locator('#lib .lc').count() === 4, 'and deleted, as it was not used');
  // ----- a preview: the book turned
  await p.locator('#lib .lc:has(.nm[value="alpha"]) [data-a="pv"]').click(); await p.waitForFunction(() => /1 من 4/.test(document.querySelector('.lm .pvn span')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
  ok(/1 من 4/.test(await p.textContent('.lm .pvn span')), 'a preview turns the book: ' + await p.textContent('.lm .pvn span')); await p.click('.lm .pvn [data-d="1"]'); await wait(700); ok(/2 من 4/.test(await p.textContent('.lm .pvn span')), 'page by page');
  await p.screenshot({ path: OUT + '2_preview.jpg', type: 'jpeg', quality: 75 }); await p.click('.lm .lmf button');
  // ----- a book replaced: same name and groups, every station that used it now has the new one
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#lib .lc:has(.nm[value="alpha"]) [data-a="rp"]').click()]); await fc.setFiles(A2); await p.waitForSelector('#dlgOk'); await p.click('#dlgOk');
  await p.waitForFunction(() => /6 صفحة/.test(document.querySelector('#lib .lc .nm[value="alpha"]')?.closest('.lc').querySelector('.mt').textContent || ''), null, { timeout: 60000 }).catch(() => {});
  const ra = p.locator('#lib .lc:has(.nm[value="alpha"])'); ok(/6 صفحة/.test(await ra.locator('.mt').textContent()) && /الصباح/.test(await ra.locator('.tg').textContent()) && /المحطة 1/.test(await ra.locator('.us').textContent()), 'replaced by a new version: six pages now, its name, group and stations kept');
  // ----- the picker in the stations tab
  await p.click('[data-t="stations"]'); await p.click('[data-pick="media"][data-st="s4"]'); await p.waitForSelector('.lm .lc'); ok(await p.locator('.lm .lc').count() === 4, 'the picker shows the files a station can show (two books, a gallery, a film)');
  await p.fill('.lm .lb-q', 'المساء'); await wait(200); ok(await p.locator('.lm .lc').count() === 2, 'searched by group in the picker'); await p.screenshot({ path: OUT + '3_picker.jpg', type: 'jpeg', quality: 75 });
  await p.locator('.lm .lc:has(.kd:text("فيلم"))').click(); await p.click('.lm [data-ok]'); await wait(500); ok(/film/.test(await p.textContent('[data-pick="media"][data-st="s4"]')), 'chosen: station 4 shows the film, with its picture');
  await p.click('[data-pick="attract"][data-st="s1"]'); await p.waitForSelector('.lm [data-n]'); ok(await p.locator('.lm .lc').count() === 2, 'the waiting screen\'s picker offers the gallery and the film, and «the logo»'); await p.click('.lm [data-x]');
  await p.screenshot({ path: OUT + '4_stations.jpg', type: 'jpeg', quality: 75, fullPage: true });
  // ----- the board's picker
  await p.click('#pub'); await p.waitForFunction(() => /النسخة 1/.test(document.body.textContent), null, { timeout: 20000 });
  const ev = await p.evaluate(async () => (await (await fetch('/api/events', { headers: { 'x-org-slug': location.pathname.slice(1) } })).json()).events[0].id);
  const bd = await ctx.newPage(); bd.on('pageerror', e => errs.push('board: ' + e.message)); await bd.goto(`${B}/run/stations.html?e=${ev}`); await bd.waitForSelector('.card');
  await bd.click('.card[data-s="s2"] [data-lp]'); await bd.waitForSelector('.lm .lc'); await bd.locator('.lm .lc:has(.kd:text("معرض صور"))').click(); await bd.click('.lm [data-ok]'); await wait(800);
  ok(await bd.$eval('.card[data-s="s2"] [data-f]', s => s.options[s.selectedIndex].textContent).then(t => /معرض/.test(t)), 'the board gives station 2 the gallery from its library picker');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
  await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
