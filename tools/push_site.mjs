// The pages of web/ into the bucket (_site/), through the deployed server:  BASE=https://live.basserh.com ADMIN_KEY=... node tools/push_site.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const W = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web'), B = process.env.BASE, K = process.env.ADMIN_KEY;
const TYPE = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', woff2: 'font/woff2', json: 'application/json', mp4: 'video/mp4' };
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
let n = 0; for (const f of walk(W)) { const rel = path.relative(W, f).split(path.sep).join('/'), r = await fetch(`${B}/api/admin/site?path=${encodeURIComponent(rel)}`, { method: 'PUT', headers: { 'x-admin-key': K, 'Content-Type': TYPE[rel.split('.').pop()] || 'application/octet-stream' }, body: fs.readFileSync(f) }); if (!r.ok) throw new Error(rel + ' ' + r.status + ' ' + await r.text()); n++; }
console.log(n, 'files pushed to', B);
