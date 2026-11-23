// The day's usage against the plan's limit:  node test/usage.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
//   requests are counted by organisation and written in batches; the owner page shows the day's share of the limit.
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': AK, 'content-type': 'application/json', 'user-agent': 'basserh-test' }, body: b ? JSON.stringify(b) : undefined });
let org, b;
(async () => {
  const t = Date.now(); org = await (await adm('org', 'POST', { name: 'قياس الاستهلاك', slug: 'us' + t, email: `us${t}@t.test`, kind: 'ceremony', starter: false })).json();
  const u0 = await (await adm('usage')).json(); ok(u0.limit === 100000 && typeof u0.total === 'number', `the owner reads the day: ${u0.total} of ${u0.limit}`);
  // a burst of requests in this organisation's name (an unknown event of it: the answer is short, the request still counts)
  const ev = 'e_' + org.org.slice(2) + 'zzzzzzzz'; for (let i = 0; i < 26; i++) await Promise.all(Array.from({ length: 10 }, () => fetch(`${B}/api/run/${ev}/state`).catch(() => {})));
  let mine = 0; for (let k = 0; k < 9 && mine < 150; k++) { const u = await (await adm('usage')).json(); mine = (u.by.find(x => x.name === 'قياس الاستهلاك') || {}).n || 0; if (mine < 150) { await new Promise(r => setTimeout(r, 8000)); await fetch(`${B}/api/run/${ev}/state`).catch(() => {}); } }
  ok(mine >= 150, `260 requests of the organisation are counted under its name: ${mine} so far (each copy of the server writes its share once a minute or every 200 requests, so the rest follows)`);
  const u1 = await (await adm('usage')).json(); ok(u1.total >= u0.total + 150 && u1.days.length >= 1, `the day's total grew: ${u0.total} → ${u1.total}`);
  b = await chromium.launch(); const p = await b.newPage(); await p.goto(B + '/admin.html'); await p.fill('#pw', AK); await p.click('#pwIn'); await p.waitForSelector('#kpis .kpi');
  const kpi = await p.$$eval('#kpis .kpi', l => (l.find(x => /استهلاك اليوم/.test(x.textContent)) || {}).textContent || ''); ok(/%/.test(kpi) && /100,000/.test(kpi), 'the owner page shows the day\'s share of the limit: ' + kpi.replace(/\s+/g, ' ').trim());
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exitCode = 1; }).finally(async () => {
  if (b) await b.close(); if (org && org.org) await adm('org', 'DELETE', { id: org.org, confirm: org.slug });
});
