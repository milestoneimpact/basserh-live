// Restore and the pinned hall:  node test/restore.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
//   a day's copy brings an organisation back as it was, with a file the sweep had taken out; an open hall keeps its version until a clear yes; each person sees and removes their own passkeys.
const B = process.env.BASE || 'http://localhost:8790', K = process.env.ADMIN_KEY || 'dev';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + m); };
(async () => {
  const t = Date.now(), adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': K, 'content-type': 'application/json', 'user-agent': 'curl/8' }, body: b ? JSON.stringify(b) : undefined });
  const org = await (await adm('org', 'POST', { name: 'فحص الاسترجاع', slug: 'rs' + t, email: `rs${t}@t.test` })).json();
  const sid = ((await fetch(B + org.join, { redirect: 'manual' })).headers.get('set-cookie') || '').split(';')[0], H = { cookie: sid, 'x-org-slug': org.slug, Origin: B, 'content-type': 'application/json' };
  const ev = (await (await fetch(B + '/api/events', { headers: H })).json()).events[0], E = `${B}/api/events/${ev.id}`, get = async () => (await (await fetch(E, { headers: H })).json());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  const logo = await (await fetch(`${E}/media?kind=image&name=a.png`, { method: 'PUT', headers: { ...H, 'content-type': 'image/png' }, body: png })).json();
  let d = (await get()).doc; d.name = 'الاسم الأول'; d.identity.before.logo = logo.src;
  ok((await fetch(E, { method: 'PUT', headers: { ...H, 'x-force': '1' }, body: JSON.stringify(d) })).ok, 'a first draft with a logo');
  const bk = await (await adm('backup', 'POST')).json(); ok(bk.orgs >= 1, 'the copy of the day is taken');
  const days = (await (await adm('backup/days?org=' + org.org)).json()).days; ok(days.includes(bk.day), 'the day is offered for this organisation');
  d.name = 'اسم تغيّر بالخطأ'; d.identity.before.logo = ''; await fetch(E, { method: 'PUT', headers: { ...H, 'x-force': '1' }, body: JSON.stringify(d) });
  ok((await (await adm('restore', 'POST', { org: org.org, day: bk.day, confirm: 'wrong' })).status) === 400, 'without the address typed, nothing is restored');
  const r = await (await adm('restore', 'POST', { org: org.org, day: bk.day, confirm: org.slug })).json(); const back = await get(), bd = JSON.stringify(back);
  ok(r.ok && bd.includes('الاسم الأول') && !bd.includes('اسم تغيّر'), 'the organisation is back as it was that day');
  ok((await fetch(`${B}/m/${org.org}/${ev.id}/${logo.src}`, { headers: { cookie: sid } })).status === 200, 'and its file is there');
  // the hall pinned to its version
  const st = await (await fetch(E + '/publish', { method: 'POST', headers: H, body: '{}' })).json(); const p1 = await fetch(E + '/publish', { method: 'POST', headers: H, body: '{}' }); ok(p1.ok, 'while the hall is not running a new version goes through at once'); await fetch(`${B}/api/run/${ev.id}/cmd`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'live', on: true }) });
  const p2 = await fetch(E + '/publish', { method: 'POST', headers: H, body: '{}' }), j2 = await p2.json(); ok(st.version === 1 && p2.status === 409 && j2.pinned === 2, 'a running hall keeps its version: a new one is refused without a yes');
  const p3 = await (await fetch(E + '/publish', { method: 'POST', headers: H, body: '{"live":true}' })).json(); ok(p3.version === 3, 'with the yes, the new version goes to the hall');
  const pk = await fetch(B + '/api/passkeys', { headers: { cookie: sid } }); ok(pk.ok && Array.isArray((await pk.json()).passkeys) && (await fetch(B + '/api/passkeys')).status === 401, 'a person lists their own passkeys; nobody else');
  await adm('org', 'DELETE', { id: org.org, confirm: org.slug });
  console.log(`restore: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('✗', e.stack); console.log(`restore: ${pass} ok, ${fail + 1} fail`); process.exit(1); });
