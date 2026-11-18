// A deployed organisation, checked without spending an activation day: sign in by an owner link, open its event, run the
// rehearsal (the draft) on a stage and a console.   node test/live_check.cjs <owner join link> <event name>
const { chromium } = require('playwright');
const J = process.argv[2], NAME = process.argv[3] || '', O = process.env.SHOTS || '/tmp/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => errs.push(e.message));
  await p.goto(J); await p.waitForSelector('.ev'); console.log('studio at', p.url(), '| events:', (await p.$$eval('.ev h3', l => l.map(e => e.textContent))).join(' , '));
  await p.screenshot({ path: O + 'live_home.png' });
  await p.click(`.ev:has-text("${NAME}")`); await p.waitForSelector('.tabs'); await p.waitForTimeout(800); await p.screenshot({ path: O + 'live_event.png' });
  const id = await p.evaluate(() => fetch('/api/events', { headers: { 'x-org-slug': location.pathname.split('/')[1] } }).then(r => r.json()).then(j => j.events.find(e => e.published_version).id));
  const base = new URL(J).origin, st = await ctx.newPage(); st.on('pageerror', e => errs.push('stage: ' + e.message)); await st.setViewportSize({ width: 1920, height: 1080 }); await st.goto(`${base}/run/stage.html?e=${id}&draft`); await st.click('#go');
  const con = await ctx.newPage(); con.on('dialog', d => d.accept()); con.on('pageerror', e => errs.push('console: ' + e.message)); await con.goto(`${base}/run/console.html?e=${id}&draft`); await con.waitForSelector('#order .cue');
  console.log((await con.$$eval('#order .cue:not(.off) b', l => l.length)), 'cues |', await con.textContent('#hall'));
  const go = async t => { await con.click(`#order .cue:has-text("${t}")`); await st.waitForTimeout(6000); return st.evaluate(() => document.querySelector('.sc.on') && document.querySelector('.sc.on').id); };
  console.log('film:', await go('فيلم'), JSON.stringify(await st.evaluate(() => { const v = document.querySelector('video'); return { t: +v.currentTime.toFixed(1), dur: Math.round(v.duration || 0), ready: v.readyState }; })));
  await st.screenshot({ path: O + 'live_film.jpg', type: 'jpeg', quality: 70 });
  console.log('slides:', await go('التحول الاستراتيجي ·')); await st.screenshot({ path: O + 'live_deck.jpg', type: 'jpeg', quality: 70 });
  const hall = await (await b.newContext()).request.get(`${base}/api/run/${id}/config`); console.log('a stranger asking for the event:', hall.status());
  await con.click('#order .cue >> nth=0'); await con.waitForTimeout(800);
  console.log('errors:', errs.join(' | ') || 'none'); await b.close();
})();
