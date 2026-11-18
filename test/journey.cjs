// The whole trip of a new organisation, through the real pages:  node test/journey.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
// the platform owner creates it with a password and hands over the access card; the organisation signs in at its own address with
// email and password, a wrong password is refused, the owner of the organisation changes it, the platform owner renews it.
const { chromium } = require('playwright'); const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
(async () => {
  const b = await chromium.launch(), errs = [], t = Date.now(), slug = 'j' + t, mail = `owner${t}@t.test`;
  const actx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] }), a = await actx.newPage(); a.on('pageerror', e => errs.push('admin: ' + e.message));
  await a.goto(B + '/admin.html'); await a.fill('#pw', AK); await a.click('#pwIn'); await a.waitForSelector('#mk');
  await a.fill('#n', 'جمعية الرحلة الكاملة'); await a.fill('#s', slug); await a.fill('#e', mail); await a.click('#mk'); await a.waitForSelector('#pass');
  const pw = (await a.textContent('#pPw')).trim(), url = (await a.textContent('#pUrl')).trim(); ok(/^([a-z2-9]{4}-){3}[a-z2-9]{4}$/.test(pw) && url.endsWith('/' + slug), 'the organisation is created; its access card shows the address and a generated password');
  await a.click('#pCopy'); const clip = await a.evaluate(() => navigator.clipboard.readText()).catch(() => ''); ok(clip.includes(pw) && clip.includes(url) && !clip.includes('@'), 'one button copies the card as a message to send'); await a.screenshot({ path: (process.env.OUT || '/tmp/claude-0/sx/') + 'j_card.jpg', type: 'jpeg', quality: 80, clip: { x: 400, y: 60, width: 1040, height: 520 } });
  // the organisation, on a device of its own
  const octx = await b.newContext({ viewport: { width: 1440, height: 900 } }), o = await octx.newPage(); o.on('pageerror', e => errs.push('studio: ' + e.message)); let ans = []; o.on('dialog', d => d.type() === 'prompt' ? d.accept(ans.shift() ?? '') : d.accept());
  await o.goto(url); await o.waitForSelector('#lf2'); await o.screenshot({ path: (process.env.OUT || '/tmp/claude-0/sx/') + 'j_gate.jpg', type: 'jpeg', quality: 80 });
  ok(!(await o.$('#lE')) && (await o.textContent('#gate h2')).includes('جمعية الرحلة'), 'at its own address the door carries the organisation\'s name and asks for the password alone'); await o.fill('#lP', 'wrong-password'); await o.click('#lf2 button'); await o.waitForFunction(() => /غير صحيحة/.test(document.querySelector('#toast').textContent)); ok(new URL(o.url()).pathname === '/' + slug && !(await o.$('#new')), 'a wrong password is refused');
  await o.fill('#lP', pw); await o.click('#lf2 button'); await o.waitForSelector('#new'); ok(new URL(o.url()).pathname === '/' + slug && (await o.textContent('#orgName')).includes('جمعية الرحلة'), 'the password alone opens the studio at the organisation\'s own address');
  ok(await o.locator('.ev').count() === 1, 'its first event is waiting');
  await o.click('#pwSet'); await o.fill('#dlgIn', 'my-own-pass-2026'); await o.click('#dlgOk'); await o.waitForFunction(() => /حُفظت كلمة المرور/.test(document.querySelector('#toast').textContent)); ok(true, 'the owner of the organisation set a password of their own');
  const o2 = await (await b.newContext()).newPage(); const tryIn = async p => (await o2.request.post(B + '/api/login', { data: { slug, password: p } })).status();
  ok(await tryIn(pw) === 403 && await tryIn('my-own-pass-2026') === 200, 'the first password stopped working, the new one opens');
  // the owner of the organisation gives a member a password of his own
  await o.click('#team'); await o.waitForSelector('#mAdd'); const mm = `member${t}@t.test`; await o.fill('#mEmail', mm); await o.fill('#mPw', 'operator-pass-77'); await o.selectOption('#mRole', 'editor'); await o.click('#mAdd'); await o.waitForSelector('#mOut .okb');
  const mctx = await b.newContext(), mp = await mctx.newPage(); await mp.goto(url); await mp.fill('#lP', 'operator-pass-77'); await mp.click('#lf2 button'); await mp.waitForSelector('#new');
  ok((await (await mp.request.get(B + '/api/me')).json()).user.email === mm, 'a member enters the same address with the password the owner gave him, as himself');
  await o.fill('#mEmail', `second${t}@t.test`); await o.fill('#mPw', 'operator-pass-77'); await o.click('#mAdd'); await o.waitForFunction(() => /مستعملة/.test(document.querySelector('#toast').textContent)); ok(true, 'two members cannot share one password');
  // building made easy: a template, the steps, undo, the versions, two people on one event
  await o.click('#home'); await o.waitForSelector('#new'); await o.click('#new'); await o.waitForSelector('.tpl'); ok(await o.locator('.tpl').count() === 5, 'a new event starts from a template: four kinds and a copy of the last event');
  await o.click('.tpl[data-tpl="forum"]'); await o.fill('#dlgIn', 'ملتقى المعرفة'); await o.screenshot({ path: (process.env.OUT || '/tmp/claude-0/sx/') + 'j_new.jpg', type: 'jpeg', quality: 80 }); await o.click('#dlgOk'); await o.waitForSelector('#steps .stp');
  const nc = () => o.locator('#list .cue').count(); ok(await nc() === 7 && await o.locator('#steps .stp').count() === 6, 'the forum template opens with its seven cues, and the six steps of an event across the top');
  await o.click('[data-add="title"]'); await o.waitForFunction(() => document.querySelectorAll('#list .cue').length === 8); await o.click('#undo'); await o.waitForFunction(() => document.querySelectorAll('#list .cue').length === 7); await o.click('#redo'); await o.waitForFunction(() => document.querySelectorAll('#list .cue').length === 8); await o.click('#undo'); await o.waitForFunction(() => document.querySelectorAll('#list .cue').length === 7); ok(true, 'undo and redo walk back and forth through the changes');
  await o.click('#list .cue >> nth=2'); await o.click('#dup'); await o.waitForFunction(() => document.querySelectorAll('#list .cue').length === 8); ok(true, 'a cue is copied with one button'); await o.click('#undo'); await o.waitForFunction(() => /حُفظ/.test(document.querySelector('#saved').textContent) && document.querySelectorAll('#list .cue').length === 7);
  await o.click('#pub'); await o.waitForFunction(() => /اعتُمدت النسخة 1/.test(document.querySelector('#toast').textContent)); await o.click('[data-t="cues"]'); await o.click('[data-add="logo"]'); await o.waitForFunction(() => /حُفظ$/.test(document.querySelector('#saved').textContent)); await o.click('#pub'); await o.waitForFunction(() => /اعتُمدت النسخة 2/.test(document.querySelector('#toast').textContent));
  await o.click('[data-t="run"]'); await o.waitForSelector('#vers .vrow'); ok(await o.locator('#vers .vrow').count() === 2, 'the published versions are listed'); await o.screenshot({ path: (process.env.OUT || '/tmp/claude-0/sx/') + 'j_run.jpg', type: 'jpeg', quality: 80, fullPage: true });
  await o.click('[data-rs="1"]'); await o.click('#dlgOk'); await o.waitForFunction(() => /عادت النسخة 1/.test(document.querySelector('#toast').textContent)); await o.click('[data-t="cues"]'); ok(await nc() === 7, 'version 1 came back as the draft');
  await o.click('[data-t="run"]'); await o.waitForSelector('#la'); await o.selectOption('#lr', 'logo'); await o.click('#la'); await o.waitForSelector('#qrL'); ok(await o.evaluate(() => { const c = document.querySelector('#qrL'), d = c.getContext('2d').getImageData(0, 0, 264, 264).data; let k = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60) k++; return k > 3000; }) && !!(await o.$('#cpL')), 'a new link comes with a copy button and a code to scan');
  // the member opens the same event; each saves in turn; the second is asked before anything is overwritten
  const evId = await o.evaluate(() => fetch('/api/events', { headers: { 'x-org-slug': location.pathname.slice(1) } }).then(r => r.json()).then(j => j.events.find(e => e.name === 'ملتقى المعرفة').id));
  await mp.reload(); await mp.waitForSelector('.ev'); await mp.click(`.ev[data-id="${evId}"]`); await mp.waitForSelector('#evName'); await o.click('[data-t="cues"]');
  await mp.fill('#evName', 'ملتقى المعرفة الثاني'); await mp.waitForFunction(() => /حُفظ$/.test(document.querySelector('#saved').textContent));
  await o.click('[data-add="title"]'); await o.waitForSelector('#dlg'); ok((await o.textContent('#dlg h3')).includes('عدّل زميل'), 'two people on one event: the second to save is told, nothing is overwritten silently');
  await o.click('#dlgNo'); await o.waitForFunction(() => document.querySelector('#evName')?.value === 'ملتقى المعرفة الثاني'); ok(await nc() === 7, 'choosing the colleague\'s version loads it');
  // the platform owner renews it
  const org = (await (await adm('orgs')).json()).orgs.find(x => x.slug === slug), r = await (await adm('password', 'POST', { org: org.id, email: mail })).json();
  ok(await tryIn('my-own-pass-2026') === 403 && await tryIn(r.password) === 200, 'renewed by the platform owner: the old one is refused, the new one opens');
  await o.reload(); await o.waitForSelector('#lf2'); ok(true, 'and the sessions opened with the old password are closed');
  ok((await o2.request.post(B + '/api/login', { data: { slug: 'wamy', password: r.password } })).status() === 403, 'a password of one organisation does not open another');
  ok((await o2.request.post(B + '/api/login', { data: { email: mail, password: r.password } })).status() === 200, 'email and password still work from the general door');
  ok((await (await adm('password', 'POST', { org: org.id, email: 'stranger@t.test' })).status) === 404, 'no password for someone outside the organisation');
  ok(!errs.length, 'page errors: ' + (errs.join(' | ') || 'none')); await b.close(); await adm('org', 'DELETE', { id: org.id, confirm: slug });
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exitCode = 1; });
