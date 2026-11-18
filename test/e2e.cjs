// The whole flow through the real pages (studio, stage, console, tablet, moderator), against a local server:
//   cd studio && npx wrangler d1 execute studio --local --file schema.sql && npx wrangler dev --port 8790 --var ADMIN_KEY:dev
//   node test/e2e.cjs     (needs a video, a reveal video, two logos and a PDF in the folder A below)
const { chromium } = require('playwright'); const A = '/tmp/claude-0/sx/', B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', LOCAL = /localhost/.test(B);   // against the deployed site: BASE=https://live.basserh.com ADMIN_KEY=... (the network cut step needs the local server)
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const org = await (await fetch(B + '/api/admin/org', { method: 'POST', headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'اختبار آلي', slug: 't' + Date.now(), email: `o${Date.now()}@t.test`, events_limit: 2 }) })).json();
  await fetch(B + '/api/admin/org', { method: 'PATCH', headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify({ id: org.org, add_credits: 1 }) });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push('studio: ' + e.message));
  let ans = []; p.on('dialog', d => d.type() === 'prompt' ? d.accept(ans.shift() || 'x') : d.accept());
  await p.goto(B + org.join); await p.waitForSelector('#new'); ok(new URL(p.url()).pathname === '/' + org.slug, 'signed in by the invitation link, at the organisation\'s own address ' + new URL(p.url()).pathname);
  await p.click('#new'); await p.fill('#dlgIn', 'ملتقى الشركاء السنوي'); await p.click('#dlgOk'); await p.waitForSelector('.tabs');
  // people
  await p.click('[data-t="people"]'); for (const [n, h] of [['أ. اسم المتحدث الأول', 'المدير العام'], ['د. اسم المتحدث الثاني', '']]) { await p.click('#addP'); const r = p.locator('#body .row').last(); await r.locator('input').nth(0).fill(n); await r.locator('input').nth(1).fill(h); }
  // files: a video, a reveal video, a PDF that becomes slides
  await p.click('[data-t="media"]'); await p.setInputFiles('#fi', [A + 'demo.mp4', A + 'reveal.mp4', A + 'deck.pdf']); await p.waitForFunction(() => document.querySelectorAll('.file').length === 3, null, { timeout: 120000 });
  const files = await p.$$eval('.file small', l => l.map(e => e.textContent)); ok(files.some(t => /9 شريحة/.test(t)) && files.some(t => /0:20/.test(t)), 'uploaded (the 40 MB video in parts): ' + files.join(' | '));
  // identity
  await p.click('[data-t="identity"]'); await p.click('[data-logo="before"]').catch(() => {}); await p.setInputFiles('#lf', A + 'logo_a.png'); await p.waitForSelector('.logo img');
  // cues: speaker with slides, video, speaker, arm + launch, logo after
  await p.click('[data-t="cues"]'); const add = async (t, fill) => { await p.click(`[data-add="${t}"]`); await p.waitForTimeout(150); for (const [k, v] of Object.entries(fill || {})) { const el = p.locator(`#form [data-k="${k}"]`); (await el.evaluate(e => e.tagName)) === 'SELECT' ? await el.selectOption({ label: v }) : await el.fill(v); } };
  await p.click('.cue >> nth=0');
  await add('speaker', { title: 'كلمة الافتتاح', person: 'أ. اسم المتحدث الأول', at: '…ونبدأ بكلمة الافتتاح' }); await p.fill('#mod', 'شكراً لكم.\n[ينتقل إلى العرض]');
  await add('speaker', { title: 'عرض المتحدث الثاني', person: 'د. اسم المتحدث الثاني', media: 'deck' });
  await add('video', { title: 'الفيلم التعريفي', media: 'demo' });
  await add('arm', { title: 'دعوة التدشين' }); await p.waitForTimeout(200);
  await p.click('.cue:has-text("لحظة التدشين")'); await p.locator('#form [data-k="media"]').selectOption({ label: 'reveal' });
  await p.click('[data-add="logo"]'); await p.waitForTimeout(150); await p.fill('#form [data-k="title"]', 'الهوية الجديدة');
  // the logo cue was added after the selected launch: mark it as new identity
  await p.check('#after'); await p.waitForTimeout(300);
  await p.click('[data-t="identity"]'); await p.click('[data-logo="after"]'); await p.setInputFiles('#lf', A + 'logo_b.png'); await p.waitForFunction(() => document.querySelectorAll('.logo img').length === 2);
  await p.locator('[data-i="after"][data-c="accent"]').evaluate(e => { e.value = '#8e1f26'; e.dispatchEvent(new Event('change')); }); await p.waitForTimeout(900);
  await p.click('[data-t="cues"]'); await p.screenshot({ path: A + 'studio_cues.png' });
  const order = await p.$$eval('#list .cue b', l => l.map(e => e.textContent)); console.log('  cues:', order.join(' ← '));
  // dragging the new identity cue before the launch is refused
  await p.dragAndDrop('.cue:has-text("الهوية الجديدة")', '.cue:has-text("كلمة الافتتاح")'); await p.waitForTimeout(400);
  ok((await p.$$eval('#list .cue b', l => l.map(e => e.textContent))).join() === order.join(), 'the new identity cue cannot be dragged before the launch');
  // publish, links
  await p.click('#pub'); await p.waitForTimeout(1200); await p.click('[data-t="run"]'); await p.waitForSelector('#la:not([disabled])'); ok(!!(await p.$('.okb')), 'published with no problems');
  let prevL = ''; const mk = async role => { await p.selectOption('#lr', role); await p.click('#la'); await p.waitForFunction(o => { const e = document.querySelector('#newLink'); return e && e.textContent !== o; }, prevL); prevL = await p.textContent('#newLink'); return prevL; };
  const L = { stage: await mk('stage'), console: await mk('console'), tablet: await mk('tablet'), script: await mk('script') }; await p.screenshot({ path: A + 'studio_run.png' });
  // before the activation day the hall's links stay closed
  const early = await (await b.newContext()).newPage(); await early.goto(L.stage); await early.waitForTimeout(800); ok((await early.textContent('body')).includes('غير مفعّل'), 'not activated: the stage link shows «' + (await early.textContent('body')).trim().slice(0, 40) + '»');
  await p.fill('#actDay', new Date().toLocaleDateString('en-CA')); await p.click('#act'); await p.click('#dlgOk'); await p.waitForSelector('.okb:has-text("مفعّل")'); ok(true, 'the owner activated the day (one credit used)');
  // the hall: every screen in its own browser context, opened by its link only
  const open = async (u, w, h, name) => { const c = await b.newContext({ viewport: { width: w, height: h } }); const pg = await c.newPage(); pg.on('pageerror', e => errs.push(name + ': ' + e.message)); pg.on('dialog', d => d.accept()); await pg.goto(u); return pg; };
  const st = await open(L.stage, 1920, 1080, 'stage'); await st.click('#go'); const con = await open(L.console, 1440, 1000, 'console'); const tab = await open(L.tablet, 1024, 768, 'tablet'); const scr = await open(L.script, 900, 1000, 'script');
  await con.waitForSelector('#order .cue'); await con.click('#liveOn');   // the operator turns the screens on
  await con.waitForFunction(() => /كل الملفات محفوظة/.test(document.querySelector('#hall').textContent), null, { timeout: 200000 }); ok(true, 'console: ' + await con.textContent('#hall')); const scene = () => st.evaluate(() => document.querySelector('.sc.on')?.id); const shot = n => st.screenshot({ path: A + 'e2e_' + n + '.jpg', type: 'jpeg', quality: 70 });
  await st.waitForTimeout(1500); ok(await scene() === 'idle', 'stage: reception'); await shot('s1');
  await con.click('#next'); await st.waitForTimeout(1500); ok(await scene() === 'card' && (await st.textContent('#card .nm')) === 'أ. اسم المتحدث الأول', 'stage: the first speaker card'); await shot('s2');
  ok((await con.textContent('#lines')).includes('شكراً لكم'), 'console: the moderator text of the cue'); ok((await scr.textContent('section.now')).includes('شكراً لكم'), 'moderator page follows');
  await con.click('#next'); await con.waitForSelector('#thumbs .th'); ok((await con.$$('#thumbs .th')).length === 9, 'console: nine slide thumbnails');
  await con.click('.th[data-s="2"] i'); await st.waitForSelector('#card.on'); await st.waitForTimeout(400); await st.keyboard.press('PageDown'); await st.waitForTimeout(600); await st.keyboard.press('PageDown'); await st.waitForTimeout(1800);
  ok(await scene() === 'slides' && (await con.textContent('#tkNow')).includes('الشريحة 3 من 9'), 'clicker on the hall computer: name, slide 1, slide 2 hidden, slide 3 -> ' + await con.textContent('#tkNow')); await shot('s3');
  await con.click('#next'); await st.waitForTimeout(5000); const vt = () => st.evaluate(() => { const v = document.querySelector('video'); return { t: +v.currentTime.toFixed(1), p: v.paused }; });
  const a = await vt(); await con.click('#mPlay'); await st.waitForTimeout(1500); const p1 = await vt(); await st.waitForTimeout(1500); const p2 = await vt(); await con.click('[data-seek="10"]'); await st.waitForTimeout(1200); const f = await vt(); await con.click('#mPlay'); await st.waitForTimeout(1500); const r = await vt();
  ok(await scene() === 'vid' && a.t > 2 && p1.p && p1.t === p2.t && Math.abs(f.t - p2.t - 10) < .7 && !r.p, `video: plays ${a.t}, pause holds ${p1.t}, +10 -> ${f.t}, resumes ${r.t}`); await con.screenshot({ path: A + 'console.png' });
  // the network drops on the hall computer: the video keeps playing from the local copy, and its keyboard moves the event
  if (LOCAL) {
  const local = await st.evaluate(() => document.querySelector('video').src.startsWith('blob:')); require('child_process').execSync('pkill -f "[w]rangler" || true'); await st.waitForTimeout(3000); /* the server is gone: the hall computer is alone */ const n1 = await vt(); await st.waitForTimeout(1500); const n2 = await vt();
  ok(local && n2.t > n1.t, `network down: the video plays on from the copy on this computer (${n1.t} -> ${n2.t})`);
  await st.keyboard.press('n'); await st.waitForTimeout(1200); ok(await scene() === 'arm', 'network down: N on the hall keyboard moved to the next cue');
  require('child_process').spawn(process.env.SERVE || '/tmp/claude-0/sx/serve.sh', [], { detached: true, stdio: 'ignore' }).unref(); await con.waitForFunction(() => document.querySelector('#nT').textContent === 'دعوة التدشين', null, { timeout: 60000 }); ok(true, 'network back: the room took the hall\'s state, the console shows «دعوة التدشين»'); await tab.waitForSelector('body.arm');
  } else { await con.click('#next'); await st.waitForTimeout(1500); ok(await scene() === 'arm', 'stage: waiting for the launch'); await tab.waitForSelector('body.arm'); }
  const bx = await (await tab.$('#btn')).boundingBox(); await tab.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await tab.mouse.down(); await tab.waitForTimeout(2300); await tab.mouse.up(); await st.waitForTimeout(2500);
  ok(await scene() === 'vid', 'the guest pressed: the reveal video plays'); await st.waitForSelector('#idle.on', { timeout: 20000 }); await st.waitForTimeout(600);
  const acc = () => st.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent')); ok(await scene() === 'idle' && /8e1f26/i.test(await acc()) && /f[a-z0-9]+\.png/.test(await st.getAttribute('#idle img', 'src')), 'after the reveal: the new identity on the stage (' + await acc() + ')'); await shot('s4');
  ok(/8e1f26/i.test(await tab.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent'))), 'and on the tablet');
  // a stage link cannot command; a revoked link stops opening
  const sneaky = await st.evaluate(async () => { const e = new URLSearchParams(location.search).get('e'); const r = await fetch(`/api/run/${e}/cmd`, { method: 'POST', body: JSON.stringify({ type: 'go', id: 'in' }) }); return (await r.json()).state.cue; }); ok(sneaky !== 'in', 'a screen link cannot move the event');
  await p.click('[data-rv] >> nth=0'); await p.waitForFunction(() => /أُلغي الرابط/.test(document.querySelector('#toast').textContent)); await p.waitForTimeout(300); const gone = await (await b.newContext()).request.get(L.stage, { maxRedirects: 0 }); ok(gone.status() === 410, 'a revoked link answers 410');
  // another organisation sees nothing of this one
  const o2 = await (await fetch(B + '/api/admin/org', { method: 'POST', headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'اختبار آلي ٢', slug: 'u' + Date.now(), email: `x${Date.now()}@t.test` }) })).json();
  const c2 = await b.newContext(); const q = await c2.newPage(); await q.goto(B + o2.join); await q.waitForSelector('#new'); const evId = await p.evaluate(() => fetch('/api/events').then(r => r.json()).then(j => j.events[0].id));
  const leak = await q.evaluate(async id => [(await fetch('/api/events/' + id)).status, (await fetch('/api/run/' + id + '/config')).status, (await (await fetch('/api/events')).json()).events.length], evId); ok(leak.join() === '404,401,1', 'another organisation: event 404, screens 401, its list holds only its own first event -> ' + leak.join());
  ok(!errs.length, 'page errors: ' + (errs.join(' | ') || 'none')); await b.close();
})();
