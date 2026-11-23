// The kind of an organisation, chosen by the platform owner: an organisation for exhibitions starts with an exhibition of four
// stations, sees only exhibitions and cannot make a ceremony; one for ceremonies the other way round; one made with no first draft
// starts empty; the owner changes the kind from the drawer. Against a local server (npm run db && npm run dev).
//   node test/orgkind.cjs
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const MADE = [], adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).then(j => { if (method === 'POST' && j && j.org) MADE.push(j); return j; });
// every organisation this test made is deleted at the end, passed or failed, so nothing is left on the server it ran against
const tidy = async () => { for (const o of MADE.splice(0)) await adm('DELETE', { id: o.org, confirm: o.slug }).catch(() => {}); };
(async () => { const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), a = await ctx.newPage(); a.on('pageerror', e => errs.push('admin: ' + e.message)); a.on('dialog', d => d.accept());
  await a.goto(B + '/admin.html'); await a.fill('#pw', AK); await a.keyboard.press('Enter'); await a.waitForSelector('#mk');
  const make = async (kind, starter = true) => { const t = Date.now().toString(36) + Math.random().toString(36).slice(2, 5), slug = 'k' + t; await a.fill('#n', 'جهة ' + (kind === 'stations' ? 'المعارض' : 'اللقاءات')); await a.fill('#s', slug); await a.fill('#e', `k${t}@t.test`);
    if (kind) await a.click(`.kd[data-k="${kind}"]`); if (!starter) await a.uncheck('#st0'); await a.evaluate(() => { document.querySelector('#out').innerHTML = ''; }); await a.click('#mk'); if (!kind) return null; await a.waitForSelector('#pass'); const url = (await a.textContent('#pUrl')).trim(), pw = (await a.textContent('#pPw')).trim();
    const o = ((await (await fetch(B + '/api/admin/orgs', { headers: { 'x-admin-key': AK } })).json()).orgs || []).find(x => x.slug === slug); MADE.push({ org: o.id, slug });
    const c = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await c.newPage(); p.on('pageerror', e => errs.push('studio: ' + e.message)); p.on('dialog', d => d.accept()); await p.goto(url); await p.fill('#lP', pw); await p.click('#lf2 button'); await p.waitForSelector('#new');
    const api = (path, body, method = 'POST') => p.evaluate(async ([path, body, method]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; }, [path, body, method]);
    return { o, p, api, slug }; };
  await make(''); await a.waitForFunction(() => /اختر نوع الجهة/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 }).catch(() => {}); ok(/اختر نوع الجهة/.test(await a.textContent('#toast')), 'the owner must choose the kind before making an organisation');
  const X = await make('stations'); ok(/معارضكم/.test(await X.p.textContent('.hero h2')) && /معرض جديد/.test(await X.p.textContent('#new')), 'an organisation for exhibitions: its studio speaks of exhibitions');
  const xe = await X.api('/api/events', null, 'GET'); ok(xe.events.length === 1 && xe.events[0].mode === 'stations' && xe.events[0].name === 'معرضكم الأول', 'and it starts with its first exhibition');
  const doc = await X.api('/api/events/' + xe.events[0].id, null, 'GET'); ok((doc.doc.stations || []).length === 4, 'of four stations');
  ok((await X.api('/api/events', { name: 'حفل' })).status === 403, 'it cannot make a ceremony, even by the API');
  await X.p.click('#new'); await X.p.waitForSelector('.tpl[data-tpl="achieve"]'); ok(!(await X.p.$('[data-tpl="ceremony"]')), 'its «new» goes straight to an exhibition, with no choice of kind'); await X.p.keyboard.press('Escape');
  await X.p.click('#help'); await X.p.waitForSelector('.hlp'); ok(/المعرض التفاعلي/.test(await X.p.textContent('.hlp')) && !/اللقاء والحفل/.test(await X.p.textContent('.hlp')) && await X.p.locator('.hlp li').count() === 8, '«كيف أبدأ»: the way of its own kind only, in eight steps'); await X.p.click('#dlgNo');
  const C = await make('ceremony', false); const ce = await C.api('/api/events', null, 'GET'); ok(ce.events.length === 0, 'an organisation made with no first draft starts empty');
  ok((await C.api('/api/events', { name: 'معرض', mode: 'stations' })).status === 403 && (await C.api('/api/events', { name: 'لقاء' })).status === 200, 'one for ceremonies makes ceremonies only');
  await a.reload(); await a.waitForSelector('#rows'); if (!(await a.isChecked('#tst'))) await a.click('#tst');
  await a.waitForSelector(`.oc[data-id="${X.o.id}"] .kb`); ok(/معارض/.test(await a.textContent(`.oc[data-id="${X.o.id}"] .kb`)), 'the owner page shows each organisation\'s kind');
  await a.click('#fl [data-k="stations"]'); ok(await a.$(`.oc[data-id="${X.o.id}"]`) && !(await a.$(`.oc[data-id="${C.o.id}"]`)), 'and filters by it');
  await a.click('#fl [data-k="all"]'); await a.click(`.oc[data-id="${C.o.id}"] [data-open] >> nth=0`); await a.waitForSelector('#dK'); await a.selectOption('#dK', 'stations'); await a.waitForFunction(() => /صارت الجهة/.test(document.querySelector('#toast').textContent));
  ok((await C.api('/api/events', { name: 'معرض', mode: 'stations' })).status === 200, 'changed from the drawer: it now makes exhibitions');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
