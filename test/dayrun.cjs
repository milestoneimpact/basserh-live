// A whole day of a stations event in one run, so the tools of the day are tried together: two stations and a spare paired by
// their codes; visitors; one station put under repair and back; one station down, its alert, the spare in its place and released;
// the pairing log; the day's report and its mail the next morning. Against a local server (npm run db && npm run dev). ~4 minutes.
//   node test/dayrun.cjs
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
    await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, { ...cur.doc, media: { m: { kind: 'pdf', name: 'ك', src: up.src, count: 1 } }, stations: [{ id: 's1', name: 'الأولى', media: 'm', idle: 0 }, { id: 's2', name: 'الثانية', media: 'm', idle: 0 }] }]);
    await api(`/api/events/${ev}/publish`); return { o, p, api, ev }; };
  const A = await make('اليوم الكامل');
  const dev = async (station) => { const s = await (await b.newContext()).newPage(); s.on('pageerror', e => { if (!/spare: waiting/.test(e.message)) errs.push(station + ': ' + e.message); }); await s.goto(`${B}/${A.o.slug}/screen`); await s.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#code').textContent), null, { timeout: 15000 });
    await A.api(`/api/run/${A.ev}/pair`, { code: await s.textContent('#code'), station }); await s.waitForURL(/\/run\/station/, { timeout: 15000 }); return s; };
  const wait = ms => new Promise(r => setTimeout(r, ms)), until = (pg, fn, t = 20000, arg) => pg.waitForFunction(fn, arg, { timeout: t }).catch(() => {});
  // the morning: the screens are paired, the board sees them all
  const s1 = await dev('s1'), s2 = await dev('s2'), sp = await dev('_spare');
  const bd = await A.p.context().newPage(); bd.on('pageerror', e => errs.push('board: ' + e.message)); bd.on('dialog', d => d.accept()); await bd.goto(`${B}/run/stations.html?e=${A.ev}`); await bd.waitForSelector('.card');
  await until(bd, () => /متصلة (2|٢) من (2|٢)/.test(document.querySelector('#cnt').textContent) && /جاهزة/.test(document.querySelector('#spr').textContent));
  ok(/متصلة (2|٢) من (2|٢)/.test(await bd.textContent('#cnt')) && /جاهزة/.test(await bd.textContent('#spr')), 'morning: both stations connected and the spare ready');
  const log = await A.api(`/api/run/${A.ev}/pairs`, null, 'GET'); ok(log.pairs.length === 3, 'the pairing log lists the three screens');
  // visitors: a touch on each station, then rest; the visits reach the server
  const visit = async (s, sid) => { await s.mouse.click(400, 300); await wait(700); await s.mouse.click(400, 300); await wait(900); await bd.click(`.card[data-s="${sid}"] [data-h]`); await wait(2500); };   /* the board sends the screen back to rest, which ends the visit */
  for (const [s, sid] of [[s1, 's1'], [s2, 's2'], [s1, 's1']]) await visit(s, sid);
  // under repair: s2 shows the calm page; a touch there is not a visit; ended
  await bd.click('.card[data-s="s2"] [data-m]'); await until(s2, () => document.querySelector('#mnt').classList.contains('on'));
  ok(await s2.evaluate(() => document.querySelector('#mnt').classList.contains('on')), 'repair: the second station shows «قيد التجهيز»'); await s2.mouse.click(400, 300); await wait(800);
  await bd.click('.card[data-s="s2"] [data-m]'); await until(s2, () => !document.querySelector('#mnt').classList.contains('on')); ok(!(await s2.evaluate(() => document.querySelector('#mnt').classList.contains('on'))), 'and back to visitors');
  // a station goes down: its alert, then the spare in its place
  await s1.context().close(); await bd.waitForSelector('#alerts [data-sp="s1"]', { timeout: 200000 }).catch(() => {});
  ok(!!(await bd.$('#alerts [data-sp="s1"]')), 'the first station down two minutes: the alert offers the spare');
  await bd.click('#alerts [data-sp="s1"]'); await bd.click('.qd .b.on'); await until(sp, () => !!document.querySelector('#att'));
  await until(bd, () => /متصلة (2|٢) من (2|٢)/.test(document.querySelector('#cnt').textContent)); ok(/متصلة (2|٢) من (2|٢)/.test(await bd.textContent('#cnt')) && /تعمل بدل/.test(await bd.textContent('#spr')), 'the spare stands in: both stations connected again');
  await visit(sp, 's1');
  // the end of the day: the spare released
  await bd.click('#sprX'); await bd.click('.qd .b.on'); await until(sp, () => /الشاشة الاحتياطية جاهزة/.test(document.body.textContent)); ok(/الشاشة الاحتياطية جاهزة/.test(await sp.textContent('body')), 'evening: the spare released, waiting again');
  // the report: visits from both stations and the spare's under the first; none from the repair
  let v = {}; for (let i = 0; i < 20; i++) { v = await A.api(`/api/events/${A.ev}/visits?tz=${new Date().getTimezoneOffset()}`, null, 'GET'); if ((v.total || 0) >= 4) break; await wait(1000); }
  const by = Object.fromEntries((v.stations || []).map(x => [x.station, x.n])); ok(v.total === 4 && by.s1 === 3 && by.s2 === 1, `the day's visits: ${v.total} (الأولى ${by.s1}, الثانية ${by.s2}); the spare counted under the station it stood in for, nothing counted under repair`);
  // the next morning: the first visit of the new day mails yesterday's report, once (a visit is sent as if dated yesterday first)
  const tz = new Date().getTimezoneOffset(), post = list => s2.evaluate(async ([e, list, tz]) => (await fetch(`/api/run/${e}/sessions?tz=${tz}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list }) })).json(), [A.ev, list, tz]);
  await post([{ id: 'yesterday0001', station: 's2', media: 'm', start: Date.now() - 864e5, ms: 20000, pages: { 1: 20000 } }]); let last = null; for (let i = 0; i < 20 && !last; i++) { await wait(500); last = (await A.api(`/api/events/${A.ev}/reportmail`, null, 'GET')).last; }
  ok(!!last, 'the report of the day before is sent by mail once a visit of a later day arrives: ' + last);
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
