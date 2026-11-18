// Screenshots of the public page (desktop sections and a phone), and a check that /login opens the studio's gate.
//   node test/landing_shots.cjs [out dir]
const { chromium, devices } = require('playwright');
const B = process.env.BASE || 'http://localhost:8790', O = process.argv[2] || '/tmp/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(B + '/'); await p.evaluate(() => document.fonts.ready);
  const n = await p.$$eval('section, header', l => l.length);
  for (let i = 0; i < n; i++) { await p.evaluate(i => document.querySelectorAll('header, section')[i].scrollIntoView(), i); await p.waitForTimeout(1100); await p.screenshot({ path: `${O}land_${i}.jpg`, type: 'jpeg', quality: 75 }); }
  const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const m = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); await m.goto(B + '/'); await m.waitForTimeout(800); await m.screenshot({ path: `${O}land_m0.jpg`, type: 'jpeg', quality: 75 });
  await m.evaluate(() => document.querySelector('#features').scrollIntoView()); await m.waitForTimeout(1200); await m.screenshot({ path: `${O}land_m1.jpg`, type: 'jpeg', quality: 75 });
  const mover = await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await p.goto(B + '/login'); await p.waitForSelector('#gate'); const gate = await p.textContent('#gate');
  console.log(n, 'sections | sideways scroll: desktop', over, 'phone', mover, '| /login gate:', gate.includes('الدخول'), '| errors:', errs.join(' | ') || 'none');
  await b.close();
})();
