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
  ans = ['my-own-pass-2026']; await o.click('#pwSet'); await o.waitForFunction(() => /حُفظت كلمة المرور/.test(document.querySelector('#toast').textContent)); ok(true, 'the owner of the organisation set a password of their own');
  const o2 = await (await b.newContext()).newPage(); const tryIn = async p => (await o2.request.post(B + '/api/login', { data: { slug, password: p } })).status();
  ok(await tryIn(pw) === 403 && await tryIn('my-own-pass-2026') === 200, 'the first password stopped working, the new one opens');
  // the platform owner renews it
  const org = (await (await adm('orgs')).json()).orgs.find(x => x.slug === slug), r = await (await adm('password', 'POST', { org: org.id, email: mail })).json();
  ok(await tryIn('my-own-pass-2026') === 403 && await tryIn(r.password) === 200, 'renewed by the platform owner: the old one is refused, the new one opens');
  await o.reload(); await o.waitForSelector('#lf2'); ok(true, 'and the sessions opened with the old password are closed');
  ok((await o2.request.post(B + '/api/login', { data: { slug: 'wamy', password: r.password } })).status() === 403, 'a password of one organisation does not open another');
  ok((await o2.request.post(B + '/api/login', { data: { email: mail, password: r.password } })).status() === 200, 'email and password still work from the general door');
  ok((await (await adm('password', 'POST', { org: org.id, email: 'stranger@t.test' })).status) === 404, 'no password for someone outside the organisation');
  ok(!errs.length, 'page errors: ' + (errs.join(' | ') || 'none')); await b.close(); await adm('org', 'DELETE', { id: org.id, confirm: slug });
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exitCode = 1; });
