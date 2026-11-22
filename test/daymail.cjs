// The visitors' report by mail after each day: the first visits of a new day, sent by a station, mark the day before as reported
// (once); the organisation can turn it off. Against a local server (npm run db && npm run dev), where no mail leaves.
//   node test/daymail.cjs
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const MADE = [], adm = (method, body) => fetch(B + '/api/admin/org', { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).then(j => { if (method === 'POST' && j && j.org) MADE.push(j); return j; });
// every organisation this test made is deleted at the end, passed or failed, so nothing is left on the server it ran against
const tidy = async () => { for (const o of MADE.splice(0)) await adm('DELETE', { id: o.org, confirm: o.slug }).catch(() => {}); };
(async () => { const b = await chromium.launch(), errs = [];
  // two organisations, each with a published stations event
  const make = async name => { const o = await adm('POST', { name, slug: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), email: `p${Date.now()}${Math.random().toString(36).slice(2, 5)}@t.test` }), c = await b.newContext(), p = await c.newPage(); await p.goto(B + o.join); await p.waitForSelector('#new');
    const api = (path, body, method = 'POST', type = 'application/json') => p.evaluate(async ([path, body, method, type]) => { const r = await fetch(path, { method, headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': type }, body: body == null ? undefined : type === 'application/json' ? JSON.stringify(body) : Uint8Array.from(atob(body), c => c.charCodeAt(0)) }); return { status: r.status, ...(await r.json()) }; }, [path, body, method, type]);
    const pg = await b.newPage(); await pg.setContent('<body style="margin:0"><section style="height:100vh;font:80px sans-serif">1</section></body>'); const pdf = await pg.pdf({ width: '1600px', height: '1000px' }); await pg.close();
    const { id: ev } = await api('/api/events', { name: 'معرض ' + name, mode: 'stations' }), up = await api(`/api/events/${ev}/media?kind=pdf&name=b.pdf`, pdf.toString('base64'), 'PUT', 'application/pdf'), cur = await api(`/api/events/${ev}`, null, 'GET');
    await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, { ...cur.doc, media: { m: { kind: 'pdf', name: 'ك', src: up.src, count: 1 } }, stations: [{ id: 's1', name: 'الأولى', media: 'm', idle: 0 }] }]);
    await api(`/api/events/${ev}/publish`); return { o, p, api, ev }; };
  const A = await make('البريد');
  const s = await (await b.newContext()).newPage(); s.on('pageerror', e => errs.push(e.message)); await s.goto(`${B}/${A.o.slug}/screen`); await s.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#code').textContent), null, { timeout: 15000 });
  await A.api(`/api/run/${A.ev}/pair`, { code: await s.textContent('#code'), station: 's1' }); await s.waitForURL(/\/run\/station/, { timeout: 15000 });
  const tz = -180, day = ms => new Date(ms - tz * 6e4).toISOString().slice(0, 10), yest = Date.now() - 864e5, post = list => s.evaluate(async ([e, list, tz]) => (await fetch(`/api/run/${e}/sessions?tz=${tz}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list }) })).json(), [A.ev, list, tz]);
  const ses = (id, at) => ({ id, station: 's1', media: 'm', start: at, ms: 30000, pages: { 1: 30000 } });
  ok((await A.api(`/api/events/${A.ev}/reportmail`, null, 'GET')).on === true, 'the mail is on by default');
  await post([ses('yday00000001', yest)]);
  await post([ses('today0000001', Date.now())]); let last = null; for (let i = 0; i < 20 && !last; i++) { await new Promise(r => setTimeout(r, 500)); last = (await A.api(`/api/events/${A.ev}/reportmail`, null, 'GET')).last; }
  ok(last === day(yest), 'a visit after the hall\'s day ended sends that day\'s report: ' + last);
  await post([ses('today0000002', Date.now())]); await new Promise(r => setTimeout(r, 1500)); ok((await A.api(`/api/events/${A.ev}/reportmail`, null, 'GET')).last === last, 'once: more visits today do not send it again, nor today\'s before it ends');
  const off = await A.api(`/api/events/${A.ev}/reportmail`, { on: false }); ok(off.on === false, 'the organisation turns it off');
  const { dayHtml } = await import('../worker/report.js'); const m = dayHtml({ total: 3, ms: 9e4, phone: 0, qr: 0, linksIn: 0, linksOut: 0, hours: Array(24).fill(0).map((_, h) => (h === 11 ? 3 : 0)), days: [], stations: [{ station: 's1', name: 'الأولى', n: 3, ms: 9e4 }, { station: 's2', name: 'الثانية', n: 0, ms: 0 }], files: [{ media: 'm', name: 'الكتاب', count: 20, n: 3, reach: { 1: 3, 2: 3, 3: 1 }, dwell: { 1: 6e4, 2: 3e3, 3: 1e3 }, zoom: {} }] }, { name: 'معرض <b>' }, { name: 'جهة', slug: 'x' }, '2026-11-21', 'https://x/y');
  ok(/الثانية لم يزرها أحد/.test(m.html) && /الصفحات التي تستحق المتابعة/.test(m.html) && !/<b>'/.test(m.subject) && /معرض &lt;b&gt;/.test(m.html) && /التقرير الكامل: https:\/\/x\/y/.test(m.text), 'the mail: what needs attention, the pages to follow, the link to the full report, names escaped');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
