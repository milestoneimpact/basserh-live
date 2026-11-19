// The audience's page:  node test/audience.cjs   (BASE, ADMIN_KEY as in e2e.cjs)
//   one link for everyone: the programme, the cue on now, a question to the speaker. It is told nothing it should not know:
//   no moderator's words, nothing of the new identity before the launch; it cannot open, watch or move the event.
//   A question reaches the operator, who puts it on the big screen.
const { chromium } = require('playwright'); const fs = require('fs');
const A = '/tmp/claude-0/sx/', B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', OUT = process.env.OUT || A;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const adm = (p, m = 'GET', b) => fetch(B + '/api/admin/' + p, { method: m, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
(async () => {
  const t = Date.now(), org = await (await adm('org', 'POST', { name: 'جمعية الحضور', slug: 'au' + t, email: `au${t}@t.test`, credits: 1 })).json();
  const sid = ((await fetch(B + org.join, { redirect: 'manual' })).headers.get('set-cookie') || '').split(';')[0], H = { cookie: sid, 'x-org-slug': org.slug };
  const api = (p, m = 'GET', b) => fetch(B + p, { method: m, headers: { ...H, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  const ev = (await api('/api/events')).events[0], put = async (n, f) => (await fetch(`${B}/api/events/${ev.id}/media?kind=image&name=${n}`, { method: 'PUT', headers: { ...H, 'content-type': 'image/png' }, body: fs.readFileSync(A + f) })).json(), la = await put('a.png', 'logo_a.png'), lb = await put('b.png', 'logo_b.png');
  const SECRET = 'كلام سري لمدير الجلسة لا يراه الحضور', NEW = 'منصة أثر الجديدة';
  const doc = { name: 'ملتقى الشركاء', lang: 'ar', date: '', identity: { before: { logo: la.src, colors: { bg: '#F6F1E6', ink: '#14211E', accent: '#0F5A4E', gold: '#C2A063' } }, after: { logo: lb.src, colors: { bg: '#0E1114', ink: '#F6F2E8', accent: '#E8D9BD', gold: '#B88A3D' } } },
    people: { p1: { name: 'د. سالم العلي', honorific: 'المدير العام' } }, media: {},
    cues: [{ id: 'in', type: 'loop', title: 'الاستقبال', fixed: true, moderator: [] }, { id: 'c1', type: 'title', title: 'الافتتاح', text: 'بسم الله', moderator: [SECRET] }, { id: 'c2', type: 'speaker', title: 'كلمة المدير العام', person: 'p1', moderator: [SECRET] },
      { id: 'c3', type: 'arm', title: 'دعوة التدشين', moderator: [] }, { id: 'c4', type: 'launch', title: 'لحظة التدشين', style: 'curtain', text: NEW, moderator: [] }, { id: 'c5', type: 'title', title: 'جولة في ' + NEW, text: NEW, after: true, moderator: [] }] };
  await api(`/api/events/${ev.id}`, 'PUT', doc); await api(`/api/events/${ev.id}/publish`, 'POST'); await api(`/api/events/${ev.id}/activate`, 'POST', { from: new Date().toISOString() });
  const link = async role => (await api(`/api/events/${ev.id}/links`, 'POST', { role, label: role })).url, aL = await link('audience'), cL = await link('console'), sL = await link('stage');
  ok(!!aL, 'the organisation makes one link for its audience');

  const b = await chromium.launch(), errs = [], page = async (u, w, h, name) => { const c = await b.newContext({ viewport: { width: w, height: h } }), p = await c.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message)); p.on('dialog', d => d.accept()); await p.goto(B + u); return p; };
  const au = await page(aL, 390, 844, 'audience'); await au.waitForSelector('#list .it'); const cookie = (await au.context().cookies()).map(c => `${c.name}=${c.value}`).join('; '), st = async (p, o = {}) => (await fetch(B + p, { ...o, headers: { cookie, ...(o.headers || {}) } })).status;
  const txt0 = await au.textContent('body'), pub0 = await (await fetch(`${B}/api/run/${ev.id}/pub`, { headers: { cookie } })).text();
  ok(/لم يبدأ اللقاء بعد/.test(txt0) && await au.locator('#list .it').count() === 3 && /د\. سالم العلي/.test(txt0), 'before the screens are on: the programme with its speakers, and «not started yet»');
  ok(!txt0.includes(NEW) && !pub0.includes(NEW) && !pub0.includes(SECRET) && !pub0.includes(lb.src) && !pub0.includes('moderator'), 'it is told nothing of the moderator\'s words, nor a cue, a name or a logo of the new identity');
  ok(await st(`/api/run/${ev.id}/config`) === 403 && await st(`/api/run/${ev.id}/state`) === 403 && await st(`/api/run/${ev.id}/cmd`, { method: 'POST', body: '{"type":"next"}' }) === 403 && await st(`/api/run/${ev.id}/questions`) === 403 && await st(`/api/run/${ev.id}/ws`) === 403, 'the audience\'s link cannot open the event\'s document, watch it, move it, or read the questions');
  ok(await au.locator('#askC').isHidden(), 'no question before the event starts');

  const con = await page(cL, 1440, 1000, 'console'), stage = await page(sL, 1280, 720, 'stage'); await stage.waitForFunction(() => window.stageReady); await stage.click('#go'); await con.click('#liveOn'); await con.click('#next'); await con.waitForFunction(() => /2 من/.test(document.querySelector('#nN').textContent)); await con.click('#next');
  await au.waitForFunction(() => document.querySelector('#nowT')?.textContent === 'كلمة المدير العام', null, { timeout: 15000 }); ok(await au.locator('.it.now').count() === 1 && await au.locator('.it.done').count() === 1 && await au.locator('#askC').isVisible(), 'the page follows the event: the cue on now, the one that passed, and the question box opens'); await au.screenshot({ path: OUT + 'aud_now.jpg', type: 'jpeg', quality: 80, fullPage: true });
  await au.fill('#qT', 'ما خطتكم للعام القادم؟'); await au.fill('#qW', 'أحمد'); await au.click('#send'); await au.waitForFunction(() => /وصل سؤالك/.test(document.querySelector('#qMsg').textContent)); ok(true, 'a question is sent');
  await con.waitForSelector('#qL .q', { timeout: 15000 }); ok(/ما خطتكم للعام القادم/.test(await con.textContent('#qL')) && /أحمد/.test(await con.textContent('#qL')) && /1 جديد/.test(await con.textContent('#qN')), 'it reaches the operator, with the name');
  await con.click('[data-qs]'); await stage.waitForSelector('#ask.on'); ok((await stage.textContent('#ask .big')).replace(/\s+/g, ' ').trim() === 'ما خطتكم للعام القادم؟' && (await stage.textContent('#ask .sub')) === 'أحمد', 'the operator puts it on the big screen'); await stage.waitForTimeout(1200); await stage.screenshot({ path: OUT + 'aud_stage.jpg', type: 'jpeg', quality: 80 });
  await con.click('#qOff'); await stage.waitForSelector('#card.on'); ok(true, 'and takes it off: the cue is back');
  const codes = []; for (let i = 0; i < 44 && codes[codes.length - 1] !== 429; i++) codes.push(await st(`/api/run/${ev.id}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'سؤال متكرر رقم ' + i }) })); ok(codes.includes(429) && await st(`/api/run/${ev.id}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) }) !== 200, `a flood of questions is stopped (after ${codes.length - 1}), and an empty one refused`);
  // the launch: the new identity reaches the audience only after it is revealed on the screens
  await con.click('#next'); await con.waitForSelector('#launch', { state: 'visible' }); await con.click('#launch'); await stage.waitForSelector('#rev.on');
  const mid = await (await fetch(`${B}/api/run/${ev.id}/pub`, { headers: { cookie } })).text(); await stage.waitForTimeout(2500);
  await au.waitForFunction(n => document.body.textContent.includes(n), 'جولة في ' + NEW, { timeout: 20000 }); ok(await au.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#0E1114') && await au.locator('#list .it').count() === 4, 'after the reveal the audience\'s page takes the new identity and shows the cue that carries it');
  ok(!errs.length, 'page errors: ' + (errs.join(' | ') || 'none'));
  const ex = await (await adm('export?org=' + org.org)).json(); ok(ex.questions && ex.questions.length >= 1, 'the questions are part of the organisation\'s own data (export)');
  await b.close(); await adm('org', 'DELETE', { id: org.org, confirm: org.slug });
})().catch(e => { console.log('✗ ' + (e.stack || e)); process.exitCode = 1; });
