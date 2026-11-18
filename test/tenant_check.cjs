// A seeded organisation (tools/seed_wamy.mjs) opened as its owner: activate today, make the links, play its event on the screens.
//   node test/tenant_check.cjs <owner join link>
const { chromium } = require('playwright');
const J = process.argv[2], O = process.env.SHOTS || '/tmp/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => errs.push(e.message));
  await p.goto(J); await p.waitForSelector('.ev');
  console.log('studio at', new URL(p.url()).pathname, '| events:', (await p.$$eval('.ev h3', l => l.map(e => e.textContent))).join(' , '));
  await p.click('.ev:has-text("التحول الاستراتيجي")'); await p.waitForSelector('.tabs'); await p.screenshot({ path: O + 'tenant_studio.png' });
  await p.click('[data-t="run"]'); await p.waitForSelector('#act'); await p.fill('#actDay', new Date().toLocaleDateString('en-CA')); await p.click('#act'); await p.waitForSelector('.okb:has-text("مفعّل")');
  let prev = '';
  const mk = async role => { await p.selectOption('#lr', role); await p.click('#la'); await p.waitForFunction(o => { const e = document.querySelector('#newLink'); return e && e.textContent !== o; }, prev); prev = await p.textContent('#newLink'); return prev; };
  const ls = await mk('stage'), lc = await mk('console');
  const open = async (u, w, h) => { const pg = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept()); await pg.goto(u); return pg; };
  const st = await open(ls, 1920, 1080); await st.click('#go'); const con = await open(lc, 1440, 1000); await con.waitForSelector('#order .cue');
  await con.waitForFunction(() => /كل الملفات محفوظة/.test(document.querySelector('#hall').textContent), null, { timeout: 240000 }); console.log(await con.textContent('#hall'));
  const order = await con.$$eval('#order .cue:not(.off) b', l => l.map(e => e.textContent)); console.log(order.length, 'cues:', order.join(' ← '));
  const go = async t => { await con.click(`#order .cue:has-text("${t}")`); await st.waitForTimeout(3500); return st.evaluate(() => document.querySelector('.sc.on') && document.querySelector('.sc.on').id); };
  console.log('speaker with slides:', await go('أصلان'), '| slides:', (await con.$$('#thumbs .th')).length);
  console.log('film:', await go('فيلم'), JSON.stringify(await st.evaluate(() => { const v = document.querySelector('video'); return { t: +v.currentTime.toFixed(1), dur: Math.round(v.duration), local: v.src.startsWith('blob:') }; })));
  await st.screenshot({ path: O + 'tenant_film.jpg', type: 'jpeg', quality: 70 });
  console.log('deck:', await go('التحول الاستراتيجي ·')); await st.screenshot({ path: O + 'tenant_deck.jpg', type: 'jpeg', quality: 70 });
  console.log('after the launch:', await go('الأمين العام'), await st.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent')), await st.textContent('#card .nm'));
  await st.screenshot({ path: O + 'tenant_after.jpg', type: 'jpeg', quality: 70 });
  console.log('errors:', errs.join(' | ') || 'none'); await b.close();
})();
