// Three organisations at once, and every door tried from the wrong side:  node test/isolation.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
//   each runs its own event on its own screens at the same moment, and nothing of one reaches another;
//   a member, a screen link or a stranger asking for another organisation's studio, event, files or room is refused;
//   a screen opened before the operator turns the screens on is black, whoever opens it.
const { chromium } = require('playwright'); const fs = require('fs');
const A = '/tmp/claude-0/sx/', B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', OUT = process.env.OUT || A;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
const NAMES = [['شركة الأفق', '#0B3D91', 'ملتقى الأفق السنوي'], ['مؤسسة النخيل', '#1E6B3A', 'حفل تكريم النخيل'], ['جمعية الساحل', '#7A1F3D', 'لقاء شركاء الساحل']];
(async () => {
  const t = Date.now(), b = await chromium.launch(), errs = [], orgs = [];
  // three organisations, each with an event of its own name and colour, published and activated
  for (const [i, [name, color, evName]] of NAMES.entries()) { const o = await (await adm('org', 'POST', { name, slug: `i${i}${t}`, email: `i${i}${t}@t.test`, credits: 1 })).json();
    const sid = ((await fetch(B + o.join, { redirect: 'manual' })).headers.get('set-cookie') || '').split(';')[0], H = { cookie: sid, 'x-org-slug': o.slug };
    const api = (p, m = 'GET', body, h = H) => fetch(B + p, { method: m, headers: { ...h, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
    const ev = (await api('/api/events')).events[0], logo = await (await fetch(`${B}/api/events/${ev.id}/media?kind=image&name=l.png`, { method: 'PUT', headers: { ...H, 'content-type': 'image/png' }, body: fs.readFileSync(A + 'logo_a.png') })).json();
    const doc = { name: evName, lang: 'ar', date: '', identity: { before: { logo: logo.src, colors: { bg: '#FFFFFF', ink: '#111111', accent: color, gold: '#999999' } }, after: null }, people: {}, media: {},
      cues: [{ id: 'c1', type: 'title', title: 'الافتتاح', text: evName, moderator: [] }, { id: 'c2', type: 'title', title: 'الثانية', text: 'فقرة ' + name, moderator: [] }, { id: 'c3', type: 'title', title: 'الثالثة', text: 'ختام ' + name, moderator: [] }] };
    await api(`/api/events/${ev.id}`, 'PUT', doc); await api(`/api/events/${ev.id}/publish`, 'POST'); await api(`/api/events/${ev.id}/activate`, 'POST', { from: new Date().toISOString() });
    const stageL = (await api(`/api/events/${ev.id}/links`, 'POST', { role: 'stage', label: 'الشاشة' })).url, conL = (await api(`/api/events/${ev.id}/links`, 'POST', { role: 'console', label: 'المشغّل' })).url;
    orgs.push({ ...o, name, color, evName, sid, H, api, ev, logo, stageL, conL }); }
  ok(orgs.length === 3 && orgs.every(o => o.stageL && o.conL), 'three organisations, each with a published event, an activated day, and links of its own');

  // every screen and console in a browser of its own, as in three halls
  const page = async (u, name, w = 1280, h = 720) => { const c = await b.newContext({ viewport: { width: w, height: h } }), p = await c.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message)); p.on('dialog', d => d.accept()); await p.goto(B + u); return p; };
  for (const o of orgs) { o.stage = await page(o.stageL, o.slug + ' stage'); await o.stage.waitForFunction(() => window.stageReady); await o.stage.click('#go'); }
  // before the operator turns the screens on: black, for whoever opens the link
  await orgs[0].stage.waitForTimeout(1200);
  const dark = p => p.evaluate(() => document.body.classList.contains('dark') && getComputedStyle(document.querySelector('#st')).visibility === 'hidden');
  ok((await Promise.all(orgs.map(o => dark(o.stage)))).every(Boolean), 'a screen opened before the operator turns the screens on is black, in the three halls');
  await orgs[0].stage.screenshot({ path: OUT + 'iso_dark.jpg', type: 'jpeg', quality: 60 });
  for (const o of orgs) { o.con = await page(o.conL, o.slug + ' console', 1440, 1000); await o.con.waitForSelector('#offBar.on'); }
  // one operator turns his on: the other two halls stay black
  await orgs[0].con.click('#liveOn'); await orgs[0].stage.waitForSelector('#title.on'); await orgs[1].stage.waitForTimeout(900);
  ok(!(await dark(orgs[0].stage)) && await dark(orgs[1].stage) && await dark(orgs[2].stage), 'one operator turns his screens on: his hall lights, the other two stay black');
  await orgs[1].con.click('#liveOn'); await orgs[2].con.click('#liveOn'); await orgs[1].stage.waitForSelector('#title.on'); await orgs[2].stage.waitForSelector('#title.on');
  // the three run at once, each at its own pace
  await Promise.all([orgs[0].con.click('#next'), (async () => { await orgs[1].con.click('#next'); await orgs[1].con.waitForFunction(() => /2 من 3/.test(document.querySelector('#nN').textContent)); await orgs[1].con.click('#next'); })()]);
  await orgs[0].stage.waitForFunction(n => document.querySelector('#title .big').textContent === n, 'فقرة ' + orgs[0].name); await orgs[1].stage.waitForFunction(n => document.querySelector('#title .big').textContent === n, 'ختام ' + orgs[1].name); await orgs[2].stage.waitForTimeout(700);
  const seen = async o => o.stage.evaluate(() => ({ text: document.querySelector('#title .big').textContent, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), all: document.body.innerText }));
  const S = await Promise.all(orgs.map(seen));
  ok(S[0].text === 'فقرة ' + orgs[0].name && S[1].text === 'ختام ' + orgs[1].name && S[2].text === orgs[2].evName, 'three events move at once, each where its own operator put it: ' + S.map(x => '«' + x.text + '»').join(' '));
  ok(S.every((x, i) => x.accent.toUpperCase() === orgs[i].color && orgs.every((o, j) => i === j || (!x.all.includes(o.name) && !x.all.includes(o.evName)))), 'each screen carries its own colours, and not a word of the other two');
  for (const [i, o] of orgs.entries()) await o.stage.screenshot({ path: `${OUT}iso_${i}.jpg`, type: 'jpeg', quality: 60 });
  await orgs[0].con.click('#liveOff'); await orgs[0].stage.waitForFunction(() => document.body.classList.contains('dark')); ok(!(await dark(orgs[1].stage)) && !(await dark(orgs[2].stage)), 'one operator turns his screens off: only his go black');

  // ---- the wrong doors. X: the first organisation; Y: the second
  const [X, Y] = orgs, st = async (p, o = {}) => (await fetch(B + p, { redirect: 'manual', ...o })).status;
  const xLink = { cookie: (await (await orgs[0].stage.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ')) };
  ok(await st(`/api/events`, { headers: { cookie: X.sid, 'x-org-slug': Y.slug } }) === 403, 'a member of one organisation asking for another\'s events by changing the address: refused');
  ok(await st(`/api/events/${Y.ev.id}`, { headers: X.H }) === 404 && await st(`/api/events/${Y.ev.id}`, { method: 'PUT', headers: { ...X.H, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', cues: [] }) }) === 404, 'another organisation\'s event cannot be read or written, even by its exact id');
  ok(await st(`/api/members`, { headers: { cookie: X.sid, 'x-org-slug': Y.slug } }) === 403 && await st(`/api/audit`, { headers: { cookie: X.sid, 'x-org-slug': Y.slug } }) === 403, 'nor its team, nor its audit');
  ok(await st(`/api/run/${Y.ev.id}/config`, { headers: { cookie: X.sid } }) === 401 && await st(`/api/run/${Y.ev.id}/state`, { headers: { cookie: X.sid } }) === 401 && await st(`/api/run/${Y.ev.id}/cmd`, { method: 'POST', headers: { cookie: X.sid }, body: '{"type":"next"}' }) === 401, 'a member cannot open, watch or drive another organisation\'s running event');
  ok(await st(`/api/run/${Y.ev.id}/config`, { headers: xLink }) === 401 && await st(`/m/${Y.org}/${Y.ev.id}/${Y.logo.src}`, { headers: xLink }) === 401, 'a screen link of one event opens nothing of another event');
  ok(await st(`/m/${Y.org}/${Y.ev.id}/${Y.logo.src}`, { headers: { cookie: X.sid } }) === 401 && await st(`/m/${Y.org}/${Y.ev.id}/${Y.logo.src}`) === 401, 'another organisation\'s files are closed to a member of a different one, and to a stranger');
  ok(await st(`/m/${Y.org}/${X.ev.id}/${Y.logo.src}`, { headers: { cookie: X.sid } }) === 404 && await st(`/m/_backup/x/control.json`, { headers: { cookie: X.sid } }) === 404, 'a file path that mixes two organisations, or reaches for the backups, leads nowhere');
  const own = await fetch(`${B}/m/${X.org}/${X.ev.id}/${X.logo.src}`, { headers: { cookie: X.sid } }); ok(own.status === 200 && /sandbox/.test(own.headers.get('content-security-policy') || '') && own.headers.get('x-content-type-options') === 'nosniff', 'its own file opens, as data that can run nothing');
  ok(await st(`/api/events`) === 401 && await st(`/api/admin/orgs`) === 403 && await st(`/api/admin/orgs`, { headers: { cookie: X.sid } }) === 403, 'no session: nothing; an organisation\'s owner is not the platform\'s owner');
  const sY = await (await fetch(`${B}/api/run/${Y.ev.id}/state`, { headers: { cookie: Y.sid } })).json(); ok(sY.state.cue === 'c3', 'and after all these attempts the second event stands where its operator left it');
  // the address of another organisation, typed in the browser by a signed in member and by a stranger
  const mine = await b.newContext({ viewport: { width: 1280, height: 800 } }); await mine.addCookies([{ name: 'sid', value: X.sid.split('=')[1], url: B }]); const mp = await mine.newPage(); mp.on('pageerror', e => errs.push('swap: ' + e.message)); await mp.goto(`${B}/${Y.slug}`); await mp.waitForSelector('#gate');
  const txt = await mp.textContent('body'); ok(/لا صلاحية/.test(txt) && !txt.includes(Y.name) && !txt.includes(Y.evName), 'a member who types another organisation\'s address sees a closed door, without its name'); await mp.screenshot({ path: OUT + 'iso_swap.jpg', type: 'jpeg', quality: 70 });
  const str = await (await b.newContext()).newPage(); await str.goto(`${B}/${Y.slug}`); await str.waitForSelector('#lf2'); ok(!(await str.textContent('body')).includes(Y.name), 'a stranger at an organisation\'s address sees a password field, not its name');
  // a link revoked while its screen is open: the screen is cut off at once
  const Z = orgs[2], before = (await (await fetch(`${B}/api/run/${Z.ev.id}/state`, { headers: { cookie: Z.sid } })).json()).state.cue, links = (await Z.api(`/api/events/${Z.ev.id}/links`)).links, cl = links.find(l => l.role === 'console');
  await Z.api(`/api/events/${Z.ev.id}/links/${cl.id}`, 'DELETE'); await Z.con.waitForFunction(() => /أُلغي رابط هذه الشاشة/.test(document.body.textContent), null, { timeout: 15000 });
  const zc = { cookie: (await Z.con.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ') };
  ok(await st(`/api/run/${Z.ev.id}/cmd`, { method: 'POST', headers: zc, body: '{"type":"next"}' }) === 401 && (await (await fetch(`${B}/api/run/${Z.ev.id}/state`, { headers: { cookie: Z.sid } })).json()).state.cue === before, 'a console link revoked while open: its page goes blank and it can command no more');
  await Z.stage.waitForTimeout(2500); ok(await Z.stage.evaluate(() => !!document.querySelector('#title.on')), 'the other screens of that event came back by their own links and carry on');
  // a password added by an owner cannot take over an account of another organisation
  const steal = await X.api('/api/members', 'POST', { email: `i1${t}@t.test`, role: 'editor', password: 'stolen-pass-123' }); ok(steal.status === 400, 'an owner cannot set a password for someone who already has an account elsewhere');
  ok(!errs.length, 'page errors: ' + (errs.join(' | ') || 'none')); await b.close(); for (const o of orgs) await adm('org', 'DELETE', { id: o.org, confirm: o.slug });
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exitCode = 1; });
