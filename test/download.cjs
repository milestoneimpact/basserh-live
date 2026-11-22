// The hall's download in pieces:  node test/download.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
//   a 20 MB video comes in 8 MB pieces; a piece cut by the network is fetched again and the download resumes; the copy kept equals the file.
const { chromium } = require('playwright'), crypto = require('crypto'); const B = process.env.BASE || 'http://localhost:8790', K = process.env.ADMIN_KEY || 'dev';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + m); };
(async () => {
  const t = Date.now(), adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': K, 'content-type': 'application/json', 'user-agent': 'curl/8' }, body: b ? JSON.stringify(b) : undefined });
  const org = await (await adm('org', 'POST', { name: 'فحص التنزيل', slug: 'dl' + t, email: `dl${t}@t.test` })).json();
  const sid = ((await fetch(B + org.join, { redirect: 'manual' })).headers.get('set-cookie') || '').split(';')[0], H = { cookie: sid, 'x-org-slug': org.slug, Origin: B };
  const ev = (await (await fetch(B + '/api/events', { headers: H })).json()).events[0], data = crypto.randomBytes(20 * 1048576), sum = crypto.createHash('sha256').update(data).digest('hex');
  const up = await (await fetch(`${B}/api/events/${ev.id}/media?kind=video&name=big.mp4`, { method: 'PUT', headers: { ...H, 'content-type': 'video/mp4' }, body: data })).json(); ok(!!up.src, 'a 20 MB video is uploaded');
  const b = await chromium.launch(), ctx = await b.newContext(); await ctx.addCookies([{ name: 'sid', value: sid.split('=')[1], url: B }]); const p = await ctx.newPage(); await p.goto(B + '/run/store.js');
  const u = `/m/${org.org}/${ev.id}/${up.src}`; let cut = 0, ranges = [];
  await p.route('**' + u, async r => { const rg = r.request().headers().range || ''; ranges.push(rg); if (/^bytes=8388608-/.test(rg) && !cut++) return r.abort('connectionreset'); r.continue(); });
  const res = await p.evaluate(async u => { const S = await import('/run/store.js'); const st = await S.keep([u]); const b = await (await fetch(await S.url(u))).arrayBuffer(), h = await crypto.subtle.digest('SHA-256', b); return { st: st[u], size: b.byteLength, sum: [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('') }; }, u);
  ok(res.st.done && res.size === data.length && res.sum === sum, `the copy kept is the file, byte for byte (${(res.size / 1048576).toFixed(0)} MB)`);
  ok(ranges.length >= 4 && ranges.every(r => /^bytes=\d+-\d+$/.test(r)), `it came in pieces (${ranges.length} requests, one cut and fetched again)`);
  ok(cut === 2 && ranges.length === 4 && ranges.filter(r => r.startsWith('bytes=0-')).length === 1, 'the piece cut by the network was fetched again, and the download did not start over');
  await b.close(); await adm('org', 'DELETE', { id: org.org, confirm: org.slug });
  console.log(`download: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('✗', e.stack); console.log(`download: ${pass} ok, ${fail + 1} fail`); process.exit(1); });
