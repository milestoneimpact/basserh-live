// The closing of an organisation's life, through the API:  node test/closure.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
//   members (role change, removal, the last owner stays), the organisation's audit, expired subscription, export, backup, deletion.
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
(async () => {
  const t = Date.now(), slug = 'c' + t, mail = `o${t}@t.test`;
  const org = await (await adm('org', 'POST', { name: 'اختبار الإغلاق', slug, email: mail, events_limit: 2, credits: 1 })).json();
  const j = await fetch(B + org.join, { redirect: 'manual' }), sid = (j.headers.get('set-cookie') || '').split(';')[0];
  const H = { cookie: sid, 'x-org-slug': org.slug, 'content-type': 'application/json' }, api = (p, m = 'GET', b) => fetch(B + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const evs = (await (await api('/api/events')).json()).events, ev = evs[0]; ok(!!ev, 'the owner signs in and finds the first event');

  // members
  const m2 = `m${t}@t.test`; ok((await api('/api/members', 'POST', { email: m2, role: 'operator' })).ok, 'a member is added');
  ok((await api('/api/members', 'POST', { email: m2, role: 'editor' })).ok, 'his role is changed');
  ok((await api('/api/members', 'POST', { email: mail, role: 'editor' })).status === 400, 'the last owner cannot be demoted');
  ok((await api('/api/members', 'DELETE', { email: mail })).status === 400, 'the last owner cannot be removed');
  ok((await api('/api/members', 'DELETE', { email: m2 })).ok, 'the member is removed');
  const ms = (await (await api('/api/members')).json()).members; ok(ms.length === 1 && ms[0].email === mail, 'the team is the owner alone again');

  // audit
  const a = await (await api('/api/audit')).json(); ok(a.audit.some(x => x.action === 'member_removed' && x.by === mail) && a.audit.some(x => x.action === 'org'), 'the audit of the organisation: ' + a.audit.map(x => x.action).join(', '));

  // a file that no document needs is not swept while young; publish reports the sweep
  const up = await fetch(`${B}/api/events/${ev.id}/media?kind=image&name=a.jpg`, { method: 'PUT', headers: { cookie: sid, 'x-org-slug': org.slug, 'content-type': 'image/jpeg' }, body: Buffer.alloc(2048, 1) }); ok(up.ok, 'a file goes up');
  const pub = await api(`/api/events/${ev.id}/publish`, 'POST'), pj = await pub.json(); ok(pub.ok ? pj.swept === 0 : pub.status === 422, 'publish runs the sweep and leaves a file younger than an hour (' + (pub.ok ? 'swept ' + pj.swept : 'draft incomplete') + ')');

  // expired subscription
  await adm('org', 'PATCH', { id: org.org, paid_until: '2020-01-01T00:00:00Z' });
  ok((await api(`/api/events/${ev.id}/publish`, 'POST')).status === 402, 'an expired subscription stops publishing');
  ok((await api(`/api/events/${ev.id}/activate`, 'POST', { from: new Date().toISOString() })).status === 402, 'and stops activation');
  await adm('org', 'PATCH', { id: org.org, paid_until: null });

  // export
  const ex = await adm('export?org=' + org.org), d = await ex.json(); ok(ex.ok && d.org.slug === org.slug && d.events.length === 1 && d.members.length === 1 && d.files.length >= 1 && d.audit.length > 0 && !JSON.stringify(d.links).includes('token_hash":"'), `export: ${d.events.length} event, ${d.files.length} file, ${d.audit.length} audit rows, no link secrets`);

  // backup
  const bk = await (await adm('backup', 'POST')).json(), bl = await (await adm('backup')).json(); ok(bk.orgs >= 1 && bl.last === bk.day, `backup of ${bk.orgs} organisations on ${bk.day}`);
  const one = await fetch(`${B}/m/_backup/${bk.day}/control.json`); ok(!one.ok, 'the backup is not reachable from outside (' + one.status + ')');

  // deletion
  ok((await adm('org', 'DELETE', { id: org.org, confirm: 'wrong' })).status === 400, 'deletion needs the address typed');
  const del = await adm('org', 'DELETE', { id: org.org, confirm: org.slug }), dj = await del.json(); ok(del.ok && dj.files >= 1, 'the organisation is deleted with its ' + dj.files + ' file(s)');
  const after = (await (await adm('orgs')).json()).orgs; ok(!after.some(o => o.id === org.org), 'it is gone from the list');
  ok((await adm('export?org=' + org.org)).status === 404, 'and nothing is left to export');
  ok(!(await api('/api/events')).ok, 'its owner has no way in');
})();
