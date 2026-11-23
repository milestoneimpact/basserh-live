// The visitor's phone from a station's code: the file in the organisation's identity, its buttons (site, call, mail) and one
// question asked once; the answers reach the visitors' report. Against a local server (npm run db && npm run dev).
//   node test/visitorphone.cjs
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
    await p.evaluate(async ([ev, doc]) => fetch('/api/events/' + ev, { method: 'PUT', headers: { 'x-org-slug': location.pathname.slice(1), 'content-type': 'application/json', 'x-force': '1' }, body: JSON.stringify(doc) }), [ev, { ...cur.doc, media: { m: { kind: 'pdf', name: 'ك', src: up.src, count: 1 } }, stations: [{ id: 's1', name: 'الأولى', media: 'm', idle: 0, qr: true }], visitor: { ask: true, links: [{ label: 'موقعنا', en: 'Our website', url: 'https://example.org' }, { label: 'اتصل بنا', url: 'tel:+966500000000' }, { label: 'خطير', url: 'javascript:alert(1)' }] } }]);
    await api(`/api/events/${ev}/publish`); return { o, p, api, ev }; };
  const A = await make('الزائر');
  const cfg = await A.api(`/api/run/${A.ev}/config`, null, 'GET'), key = (cfg.read || {}).s1; ok(!!key, 'the station has its phone key');
  const ph = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-SA' })).newPage(); ph.on('pageerror', e => errs.push('phone: ' + e.message));
  await ph.clock.install(); await ph.goto(`${B}/run/reader.html#e=${A.ev}&s=s1&k=${key}&m=l`); await ph.waitForSelector('#lk.on', { timeout: 20000 }).catch(() => {});
  const links = await ph.$$eval('#lk a', l => l.map(a => [a.textContent, a.getAttribute('href')])); ok(links.length === 2 && links[0][0] === 'موقعنا' && links[1][1] === 'tel:+966500000000', 'the organisation\'s buttons on the phone, and a link that is not a web address, a call or a mail is dropped: ' + JSON.stringify(links));
  ok(!(await ph.isVisible('#fb')), 'the question waits while the visitor starts reading'); await ph.clock.runFor(26000); await ph.waitForSelector('#fb.on', { timeout: 5000 }).catch(() => {}); ok(await ph.isVisible('#fb'), 'then asks once: «هل أفادك المعرض؟»');
  await ph.click('#fb [data-a="yes"]'); await ph.waitForTimeout(800); let v = {}; for (let i = 0; i < 10; i++) { v = await A.api(`/api/events/${A.ev}/visits`, null, 'GET'); if (v.fb && v.fb.yes) break; await ph.waitForTimeout(500); }
  ok(v.fb && v.fb.yes === 1, 'the answer reaches the report: ' + JSON.stringify(v.fb));
  await ph.reload(); await ph.clock.runFor(30000); await ph.waitForTimeout(500); ok(!(await ph.isVisible('#fb')), 'and is not asked again on this phone');
  const { visRead } = await import('../web/engine/report.js'); ok(visRead(v).notes.some(x => /رأي الزوار: 100/.test(x.t)), 'the report says what the visitors answered');
  await A.p.evaluate(ev => { location.hash = '#e=' + ev + '&t=identity'; location.reload(); }, A.ev); await A.p.waitForSelector('#vpan', { timeout: 20000 }).catch(() => {}); ok(await A.p.locator('#vpan [data-vl][data-f="url"]').count() === 3 && await A.p.isChecked('#vAsk'), 'in the studio, the identity of an exhibition has its visitor\'s page: the buttons and the question');
  await ph.clock.runFor(1000); await ph.screenshot({ path: '/tmp/claude-0/phone.png' });
  const en = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' })).newPage(); await en.goto(`${B}/run/reader.html#e=${A.ev}&s=s1&k=${key}&m=l`); await en.waitForSelector('#lk.on', { timeout: 20000 }).catch(() => {}); await en.waitForFunction(() => /Page/.test(document.querySelector('#pc').textContent), null, { timeout: 20000 }).catch(() => {});
  ok(await en.textContent('#lk a') === 'Our website' && /Was the exhibition useful/.test(await en.textContent('#fb')) && /^Page 1 of 1$/.test((await en.textContent('#pc')).trim()), 'a phone in English: the page\'s words and the button in English: ' + [await en.textContent('#lk a'), await en.textContent('#fb b'), await en.textContent('#pc')].join(' / '));
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : '')); await b.close(); await tidy();
})().catch(async e => { console.log('✗ ' + (e.stack || e)); await tidy(); process.exit(1); });
