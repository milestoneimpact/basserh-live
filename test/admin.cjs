// The platform owner's page:  node test/admin.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
//   its own dialogs (no browser boxes), the search, the off switch, a refused delete without the typed address; and the studio telling which hall links were opened.
const { chromium } = require('playwright'); const B = process.env.BASE || 'http://localhost:8790', K = process.env.ADMIN_KEY || 'dev';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + m); };
(async () => {
  const t = Date.now(), adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': K, 'content-type': 'application/json', 'user-agent': 'curl/8' }, body: b ? JSON.stringify(b) : undefined });
  const org = await (await adm('org', 'POST', { name: 'فحص الإدارة ' + t, slug: 'ad' + t, email: `ad${t}@t.test` })).json();
  const b = await chromium.launch(), p = await (await b.newContext()).newPage(); let native = 0; p.on('dialog', d => { native++; d.dismiss(); });
  await p.goto(B + '/admin.html'); await p.fill('#pw', K); await p.click('#pwIn'); await p.waitForSelector('#rows tr[data-id]');
  ok(!(await p.$('#l')) && !(await p.$('#c')), 'the new organisation form has no limits to fill');
  await p.fill('#q', 'ad' + t); const shown = await p.$$eval('#rows tr[data-id]', r => r.filter(x => x.style.display !== 'none').length); ok(shown === 1, 'the search finds the organisation by its address');
  const row = `#rows tr[data-id="${org.org}"]`;
  await p.selectOption(`${row} [data-m]`, "del"); await p.waitForSelector('#dlg'); await p.fill('#dlg [data-f="c"]', 'wrong'); await p.click('#dlgOk'); ok(/اكتب العنوان/.test(await p.textContent('#dlgE')) && !!(await p.$('#dlg')), 'delete asks for the address in the page\'s own dialog, and refuses a wrong one');
  await p.click('#dlgNo'); ok(!(await p.$('#dlg')), 'cancel closes it, nothing deleted');
  await p.selectOption(`${row} [data-m]`, "off"); await p.click('#dlgOk'); await p.waitForFunction(id => /مطفأة/.test(document.querySelector(`#rows tr[data-id="${id}"]`)?.textContent || ''), org.org); ok(true, 'off: the row says «مطفأة»');
  await p.fill('#q', 'ad' + t); await p.selectOption(`${row} [data-m]`, "off"); await p.waitForFunction(id => !/مطفأة/.test(document.querySelector(`#rows tr[data-id="${id}"]`)?.textContent || 'مطفأة'), org.org); ok(true, 'and back on with one press');
  await p.click(`${row} [data-a="card"]`); await p.click('#dlgOk'); await p.waitForSelector('#pPw'); const pw = (await p.textContent('#pPw')).trim(); ok(/^\d{8}$/.test(pw) && (await p.textContent('#pUrl')).includes('/' + org.slug), `«إرسال الدخول»: one card with the address and a password of eight digits (${pw.replace(/\d/g, '•')})`);
  ok((await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: org.slug, password: pw }) })).ok, 'and that password opens the organisation');
  ok(native === 0, 'no browser box was shown');
  // a hall link: not opened, then opened
  const sid = ((await fetch(B + org.join, { redirect: 'manual' })).headers.get('set-cookie') || '').split(';')[0], H = { cookie: sid, 'x-org-slug': org.slug, Origin: B, 'content-type': 'application/json' };
  const ev = (await (await fetch(B + '/api/events', { headers: H })).json()).events[0], L = await (await fetch(`${B}/api/events/${ev.id}/links`, { method: 'POST', headers: H, body: JSON.stringify({ role: 'stage', label: 'الشاشة الكبرى' }) })).json();
  const st = async () => ((await (await fetch(`${B}/api/events/${ev.id}/links`, { headers: H })).json()).links || [])[0] || {};
  ok(!(await st()).opened_at, 'a new link: not opened yet'); await fetch(B + (L.url || L.link || L.path || '').replace(/^https?:\/\/[^/]+/, ''), { redirect: 'manual' }); await new Promise(r => setTimeout(r, 1500)); ok(!!(await st()).opened_at, 'opened once: the studio knows when');
  await b.close(); await adm('org', 'DELETE', { id: org.org, confirm: org.slug });
  console.log(`admin: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('✗', e.stack); console.log(`admin: ${pass} ok, ${fail + 1} fail`); process.exit(1); });
