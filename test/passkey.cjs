// Passkeys with a virtual authenticator (Chromium): the platform owner signs in with the password, adds a passkey, signs out,
// signs in with the passkey; a member of an organisation does the same from the studio; wrong passwords lock the address.
//   node test/passkey.cjs      (local server: npm run db && npm run dev; ADMIN_KEY=dev)
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
if (/live\.basserh\.com/.test(B)) { console.log('passkey: this test adds passkeys to the platform owner\'s own account; run it on local or staging, never on the live site'); process.exit(0); }
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const cdp = await ctx.newCDPSession(p); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  // the owner: password, then a passkey
  await p.goto(B + '/admin.html'); await p.waitForSelector('#pw'); await p.fill('#pw', 'wrong'); await p.click('#pwIn'); await p.waitForTimeout(600); ok(!!(await p.$('#pw')), 'a wrong password does not open the owner\'s page');
  await p.fill('#pw', AK); await p.click('#pwIn'); await p.waitForSelector('#pkAdd'); ok(true, 'the owner signed in with the password');
  await p.click('#pkAdd'); await p.waitForSelector('#pkNew'); await p.waitForTimeout(500); const n0 = (await p.$$('[data-k]')).length; await p.click('#pkNew'); await p.waitForFunction(n => document.querySelectorAll('[data-k]').length === n + 1, n0); ok(true, 'the owner opened the passkeys, added one, and it is listed');
  await p.goto(B + '/api/logout'); await p.goto(B + '/admin.html'); await p.waitForSelector('#pkIn'); await p.click('#pkIn'); await p.waitForSelector('#pkAdd'); ok((await p.textContent('#pkAdd')).match(/مفاتيح المرور \([1-9]/), 'signed out, then back in with the passkey alone');
  { await p.click('#pkAdd'); await p.waitForSelector('[data-k]'); const n = (await p.$$('[data-k]')).length; await p.click('#pkNew'); await p.waitForFunction(n => document.querySelectorAll('[data-k]').length === n + 1, n); await p.click('[data-k]'); await p.click('#dlgOk'); await p.waitForFunction(n => document.querySelectorAll('[data-k]').length === n, n); ok(true, 'a second device added, and one taken out from the list'); }
  await p.waitForSelector('#tst'); if (!(await p.isChecked('#tst'))) await p.click('#tst'); await p.waitForSelector('#rows [data-id]'); ok((await p.$$('#rows [data-id]')).length >= 1, 'the owner\'s page lists the organisations');
  // a member of an organisation
  const s = 'pk' + Date.now() % 1e6; await p.fill('#n', 'جهة مفتاح المرور'); await p.fill('#s', s); await p.fill('#e', s + '@t.test'); await p.click('#mk'); await p.waitForSelector('#join'); const join = await p.textContent('#join');
  await p.goto(B + '/api/logout'); await p.goto(join); await p.waitForSelector('#new'); await p.click('#pk'); await p.waitForFunction(() => /أُضيف مفتاح المرور/.test(document.querySelector('#toast').textContent)); ok(true, 'a member added a passkey in the studio');
  await p.goto(B + '/api/logout'); await p.waitForSelector('#pkIn');
  // two passkeys on this device now (the owner's and the member's): the authenticator answers with one; the server routes by it
  await p.click('#pkIn'); await p.waitForFunction(() => !['/', '/login'].includes(location.pathname), null, { timeout: 15000 }); const where = new URL(p.url()).pathname; ok(where === '/' + s || /^\/admin/.test(where), 'passkey sign in from the gate lands at ' + where);
  // a stranger without a passkey of this site is refused
  const r = await ctx.request.post(B + '/api/passkey/login/finish', { data: { id: 'unknown', clientDataJSON: 'e30', authenticatorData: '', signature: '' } }); ok(r.status() === 403, 'an unknown passkey is refused (' + r.status() + ')');
  // five wrong passwords lock the address
  const c2 = await b.newContext(); let last = 0; for (let i = 0; i < 6; i++) last = (await c2.request.post(B + '/api/admin/login', { data: { password: 'x' + i } })).status(); ok(last === 429, 'the sixth wrong password answers 429 (locked)');
  ok(!errs.length, 'page errors: ' + (errs.join(' | ') || 'none')); await b.close();
})();
