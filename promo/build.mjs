// node promo/build.mjs            -> web/promo.mp4 (38 s, 1920x1080, 25 fps, silent) and web/promo.jpg (its poster)
// node promo/build.mjs stills 3 9.5 16 22 29 31 36   -> build_tmp/promo/t*.jpg, to look at moments before a full render
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const D = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(D, '..'), T = path.join(ROOT, 'build_tmp/promo'); fs.mkdirSync(T, { recursive: true });
const exe = [process.env.CHROME, '/opt/pw-browsers/chromium', '/usr/bin/google-chrome'].find(e => e && fs.existsSync(e));
const b = await chromium.launch({ executablePath: exe, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await p.goto('file://' + path.join(D, 'promo.html')); await p.evaluate(() => window.ready); await p.waitForTimeout(400);
const shot = async (t, type = 'jpeg') => { await p.evaluate(t => window.render(t), t); return p.screenshot({ type, quality: type === 'jpeg' ? 92 : undefined, clip: { x: 0, y: 0, width: 1920, height: 1080 } }); };
if (process.argv[2] === 'stills') { for (const t of process.argv.slice(3).map(Number)) fs.writeFileSync(path.join(T, `t${t}.jpg`), await shot(t)); await b.close(); process.exit(0); }
const FPS = 25, LEN = await p.evaluate(() => window.LENGTH), N = Math.round(LEN * FPS), out = path.join(ROOT, 'web/promo.mp4');
const ff = spawn('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], { stdio: ['pipe', 'inherit', 'inherit'] });
for (let f = 0; f < N; f++) { const buf = await shot(f / FPS); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); if (f % 100 === 0) console.log(`frame ${f}/${N}`); }
ff.stdin.end(); await new Promise(r => ff.on('close', r));
fs.writeFileSync(path.join(ROOT, 'web/promo.jpg'), await shot(10.5)); await b.close();
console.log('->', out, (fs.statSync(out).size / 1e6).toFixed(1), 'MB,', execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim(), 's');
