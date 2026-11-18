// node profile/build.mjs -> docs/بروفايل_منظومة_اللقاءات.pdf (nine 16:9 pages) and a JPG of each page in build_tmp/profile/
// the seller's copy, with no Manzoma mark: BRAND=none node profile/build.mjs -> docs/بروفايل_وايت_ليبل.pdf (a slot «شعاركم هنا»);
// with the seller's own mark: LOGO=/abs/logo.png NAME='اسم المنتج' SITE=example.com OUT=docs/x.pdf node profile/build.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const D = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(D, '..'), T = path.join(ROOT, 'build_tmp/profile');
fs.mkdirSync(T, { recursive: true }); fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
const exe = [process.env.CHROME, '/opt/pw-browsers/chromium', '/usr/bin/google-chrome'].find(e => e && fs.existsSync(e));
const b = await chromium.launch({ executablePath: exe, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const E = process.env, q = E.LOGO ? `?logo=${encodeURIComponent('file://' + E.LOGO)}&name=${encodeURIComponent(E.NAME || '')}&site=${encodeURIComponent(E.SITE || '')}` : E.BRAND === 'none' ? '?brand=none' : E.THEME ? '?theme=' + E.THEME : '';   // THEME=basserh -> docs/بروفايل_بصيرة.pdf
const OUT = path.join(ROOT, E.OUT || (E.THEME === 'basserh' ? 'docs/بروفايل_بصيرة.pdf' : q ? 'docs/بروفايل_وايت_ليبل.pdf' : 'docs/بروفايل_منظومة_اللقاءات.pdf'));
await p.goto('file://' + path.join(D, 'profile.html') + q);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(600);
const pages = await p.$$('.pg');
for (const [i, el] of pages.entries()) await el.screenshot({ path: path.join(T, `p${i + 1}.jpg`), type: 'jpeg', quality: 88 });
await p.pdf({ path: OUT, width: '1600px', height: '900px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await b.close();
console.log(pages.length, 'pages');
