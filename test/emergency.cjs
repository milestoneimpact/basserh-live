// The hall without the internet:  node test/emergency.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
//   the network of the big screen is cut in the middle of the event; the presenter's clicker moves the cues on that screen alone,
//   a small mark says it works without the network; when the network is back the room takes the screen's place and the console follows.
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev';
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
let org, b;
(async () => {
  const t = Date.now(); org = await (await adm('org', 'POST', { name: 'بروفة الانقطاع', slug: 'em' + t, email: `em${t}@t.test`, kind: 'ceremony' })).json();
  const sid = ((await fetch(B + org.join, { redirect: 'manual' })).headers.get('set-cookie') || '').split(';')[0], H = { cookie: sid, 'x-org-slug': org.slug };
  const api = (p, m = 'GET', bd) => fetch(B + p, { method: m, headers: { ...H, 'content-type': 'application/json' }, body: bd ? JSON.stringify(bd) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  const ev = (await api('/api/events')).events[0], cur = await api(`/api/events/${ev.id}`);
  const doc = { ...cur.doc, name: 'ملتقى الانقطاع', media: {}, cues: [{ id: 'c1', type: 'title', title: 'الأولى', text: 'الفقرة الأولى', moderator: [] }, { id: 'c2', type: 'title', title: 'الثانية', text: 'الفقرة الثانية', moderator: [] }, { id: 'c3', type: 'title', title: 'الثالثة', text: 'الفقرة الثالثة', moderator: [] }] };
  ok((await api(`/api/events/${ev.id}`, 'PUT', doc)).status === 200 && (await api(`/api/events/${ev.id}/publish`, 'POST', { live: true })).version >= 1, 'an event of three cues, approved');
  const link = async role => (await api(`/api/events/${ev.id}/links`, 'POST', { role, label: role })).url, sL = await link('stage'), cL = await link('console');
  b = await chromium.launch(); const errs = [], open = async (u, name) => { const c = await b.newContext({ viewport: { width: 1280, height: 720 } }), p = await c.newPage(); await p.addInitScript(() => { const W = window.WebSocket, all = []; window.__cut = false; window.WebSocket = function (u, x) { const w = new W(u, x); all.push(w); if (window.__cut) setTimeout(() => w.close(), 0); return w; }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 }); window.__cutNet = on => { window.__cut = on; if (on) all.forEach(w => { try { w.close(); } catch {} }); }; });   /* the hall's network, cut and given back from the test */
    p.on('pageerror', e => errs.push(name + ': ' + e.message)); p.on('dialog', d => d.accept()); await p.goto(B + u); return { c, p }; };
  const S = await open(sL, 'stage'), C = await open(cL, 'console'); await S.p.waitForFunction(() => window.stageReady, null, { timeout: 20000 }); const go = await S.p.$('#go'); if (go) await go.click();
  const onStage = txt => S.p.waitForFunction(x => (document.querySelector('.sc.on')?.textContent || '').includes(x), txt, { timeout: 15000 }).then(() => true, () => false);
  await C.p.waitForSelector('#liveOn'); await C.p.click('#liveOn'); ok(await onStage('الفقرة الأولى'), 'the operator turns the screens on: the first cue');
  // the big screen's network is cut
  await S.p.evaluate(() => window.__cutNet(true)); const t0 = Date.now(); const gone = await S.p.waitForFunction(() => /بلا اتصال/.test(document.querySelector('#ems')?.textContent || ''), null, { timeout: 30000 }).then(() => true, () => false); ok(gone, `the big screen knows it is without the network after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await S.p.keyboard.press('PageDown'); ok(await onStage('الفقرة الثانية'), 'no network: the clicker moves the big screen to the next cue by itself');
  const mark = await S.p.evaluate(() => { const m = document.querySelector('#ems'); return m ? m.textContent + ' · ' + getComputedStyle(m).opacity : ''; }); ok(/بلا اتصال/.test(mark), 'a small mark in the corner says it works without the network: ' + mark);
  await S.p.keyboard.press('n'); ok(await onStage('الفقرة الثالثة'), 'and N moves on again');
  await S.p.keyboard.press('p'); ok(await onStage('الفقرة الثانية'), 'P goes back');
  // the network is back: the room takes the screen's place
  await S.p.evaluate(() => window.__cutNet(false));
  let room = {}; for (let k = 0; k < 30 && !(room.state && room.state.cue === 'c2'); k++) { await S.p.waitForTimeout(1000); room = await api(`/api/run/${ev.id}/state`); }
  ok(room.state && room.state.cue === 'c2', 'the network is back: the room takes the big screen\'s place (' + (room.state && room.state.cue) + ')');
  await C.p.click('#next'); ok(await onStage('الفقرة الثالثة'), 'and the operator carries on from there');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exitCode = 1; }).finally(async () => {
  if (b) await b.close(); if (org && org.org) await adm('org', 'DELETE', { id: org.org, confirm: org.slug });   // nothing is left on the server it ran against
});
