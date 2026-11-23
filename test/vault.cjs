// The files' vault:  node test/vault.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
//   a file uploaded is copied into the vault; it is lost from the bucket (a drill, test organisations only); the owner brings it back, byte for byte.
const crypto = require('crypto');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': AK, 'content-type': 'application/json', 'user-agent': 'basserh-test' }, body: b ? JSON.stringify(b) : undefined });
let org;
(async () => {
  const t = Date.now(); org = await (await adm('org', 'POST', { name: 'خزنة الملفات', slug: 'vt' + t, email: `vt${t}@t.test`, kind: 'ceremony' })).json();
  const sid = ((await fetch(B + org.join, { redirect: 'manual' })).headers.get('set-cookie') || '').split(';')[0], H = { cookie: sid, 'x-org-slug': org.slug, Origin: B };
  const ev = (await (await fetch(B + '/api/events', { headers: H })).json()).events[0], data = crypto.randomBytes(300000), sum = crypto.createHash('sha256').update(data).digest('hex');
  const up = await (await fetch(`${B}/api/events/${ev.id}/media?kind=image&name=v.png`, { method: 'PUT', headers: { ...H, 'content-type': 'image/png' }, body: data })).json(); ok(!!up.src, 'a picture of 300 KB is uploaded');
  const key = `${org.org}/${ev.id}/${up.src}`, url = `${B}/m/${key}`, got = async () => { const r = await fetch(url, { headers: { cookie: sid } }); return r.ok ? crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex') : r.status; };
  let v = {}; for (let k = 0; k < 10; k++) { await new Promise(r => setTimeout(r, 2500)); v = await (await adm('vault')).json(); if (!v.waiting) break; } ok(typeof v.files === 'number' && v.files >= 1, `the vault took it right after the upload: ${v.files} files, ${v.waiting} waiting${v.separate ? ' (its own bucket)' : ' (in the same bucket, under _vault/)'}`);
  if (v.waiting) { const c = await (await adm('vault', 'POST')).json(); ok(c.copied >= 0, `copy now: ${c.copied} copied, ${c.left} for the next round (each round works within a time limit)`); }
  ok((await (await adm('vault/drill', 'POST', { org: 'o_wamy_is_real', key })).status) >= 400, 'the drill refuses an organisation that is not a test one');
  const d = await (await adm('vault/drill', 'POST', { org: org.org, key })).json(); ok(d.ok && (await got()) === 404, 'the drill: the picture is lost from the bucket');
  const r = await (await adm('vault/restore', 'POST', { org: org.org })).json(); ok(r.back >= 1 && (await got()) === sum, `the owner brings it back from the vault, byte for byte (${r.back} file)`);
  const r2 = await (await adm('vault/restore', 'POST', { org: org.org })).json(); ok(r2.back === 0, 'a second press finds nothing missing');
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exitCode = 1; }).finally(async () => {
  if (org && org.org) await adm('org', 'DELETE', { id: org.org, confirm: org.slug });
});
