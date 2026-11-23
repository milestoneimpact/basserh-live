// A whole exhibition copied with its files: a second one within the organisation from the studio, and by the platform owner to
// another organisation (the same exhibition in another city); refused to an organisation of the other kind. The copy's files are
// its own, read under its own address. Against a local server (npm run db && npm run dev).
//   node test/copyevent.cjs
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const MADE = [], adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).then(j => { if (method === 'POST' && j && j.org) MADE.push(j); return j; });
// every organisation this test made is deleted at the end, passed or failed, so nothing is left on the server it ran against
const tidy = async () => { for (const o of MADE.splice(0)) await adm('DELETE', { id: o.org, confirm: o.slug }).catch(() => {}); };
(async () => { const b = await chromium.launch(), errs = [];
  // two organisations, each with a published stations event
  const make = async (name, kind) => { const o = await adm('POST', { name, kind, slug: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), email: `p${Date.now()}${Math.random().toString(36).slice(2, 5)}@t.test` }), c = await b.newContext(), p = await c.newPage(); await p.goto(B + o.join); await p.waitForSelector('#new');
    const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return { status: r.status, ...(await r.json()) }; }, [path, body, method, type]);
    const pg = await b.newPage(); await pg.setContent('<body style="margin:0"><section style="height:100vh;font:80px sans-serif">1</section></body>'); const pdf = await pg.pdf({ width: '1600px', height: '1000px' }); await pg.close();
    const { id: ev } = await api('/api/events', { name: 'معرض ' + name, mode: 'stations' }), up = await api(`/api/events/${ev}/media?kind=pdf&name=b.pdf`, pdf.toString('base64'), 'PUT', 'application/pdf'), cur = await api(`/api/events/${ev}`, null, 'GET');
    await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, { ...cur.doc, media: { m: { kind: 'pdf', name: 'ك', src: up.src, count: 1 } }, stations: [{ id: 's1', name: 'الأولى', media: 'm', idle: 0 }] }]);
    await api(`/api/events/${ev}/publish`); return { o, p, api, ev }; };
  const A = await make('الأصل', 'stations'), Bo = await make('مدينة أخرى', 'stations'), C = await make('جهة لقاءات', 'ceremony');
  const files = async (X, ev) => { const d = await X.api('/api/events/' + ev, null, 'GET'), m = Object.values(d.doc.media)[0]; return { d, m, ok: m ? (await X.p.evaluate(async u => (await fetch(u)).status, d.base + m.src)) === 200 : false }; };
  // within the organisation, from the studio
  await A.p.evaluate(ev => { location.hash = '#e=' + ev + '&t=stations'; location.reload(); }, A.ev); await A.p.waitForSelector('#dupE'); await A.p.click('#dupE'); await A.p.fill('#dlgIn', 'المعرض الثاني'); await A.p.click('#dlgOk');
  await A.p.waitForFunction(() => /أُنشئت النسخة/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 }).catch(() => {});
  const ev2 = (await A.api('/api/events', null, 'GET')).events.find(e => e.name === 'المعرض الثاني'); ok(!!ev2 && ev2.id !== A.ev, 'a full copy within the organisation, from the studio');
  const f2 = await files(A, ev2.id); ok(f2.ok && f2.d.doc.stations.length === 1 && f2.d.base.includes(ev2.id), 'with its stations, and its file copied under its own address');
  // to another organisation, by the platform owner
  const cp = await fetch(B + '/api/admin/copy-event', { method: 'POST', headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify({ from: A.o.org, event: A.ev, to: Bo.o.org, name: 'معرض المدينة' }) }).then(x => x.json());
  ok(cp.id && cp.files >= 1, 'the platform owner copies it to another organisation: ' + JSON.stringify(cp));
  const evB = (await Bo.api('/api/events', null, 'GET')).events.find(e => e.name === 'معرض المدينة'); const fB = evB && await files(Bo, evB.id); ok(!!evB && fB.ok, 'it arrives there as a draft, its files readable under that organisation');
  ok((await A.p.evaluate(async u => (await fetch(u)).status, fB.d.base + fB.m.src)) !== 200, 'and the first organisation cannot read the copy\'s files');
  const bad = await fetch(B + '/api/admin/copy-event', { method: 'POST', headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify({ from: A.o.org, event: A.ev, to: C.o.org }) }); ok(bad.status === 409, 'refused to an organisation of the other kind: ' + bad.status);
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
