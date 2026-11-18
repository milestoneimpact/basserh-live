// An organisation from its folder (tenants/<slug>/): tenant.json says who it is and which events it starts with; each event is an
// event document beside it, and its files (videos, slides, logos) are read from MEDIA (a folder outside the repository: large
// files are never committed). Everything goes through the same API the studio uses, into the organisation's own database and folder.
//   BASE=http://localhost:8790 ADMIN_KEY=dev OWNER=owner@example.org MEDIA=/path/to/files node tools/seed_tenant.mjs tenants/wamy
import fs from 'fs'; import path from 'path'; import os from 'os'; import { execFileSync } from 'child_process';
const DIR = path.resolve(process.argv[2] || 'tenants/wamy'), T = JSON.parse(fs.readFileSync(path.join(DIR, 'tenant.json'), 'utf8'));
const B = process.env.BASE || 'http://localhost:8790', AK = process.env.ADMIN_KEY || 'dev', MEDIA = path.resolve(process.env.MEDIA || '..'), SLUG = process.env.SLUG || T.slug, OWNER = process.env.OWNER || `owner@${SLUG}.example`;
const j = async r => { const t = await r.text(); let o; try { o = JSON.parse(t); } catch { o = { error: t.slice(0, 200) }; } if (!r.ok) throw new Error(`${r.status} ${o.error}`); return o; };
const adm = (p, method, body) => fetch(B + '/api/admin/' + p, { method, headers: { 'x-admin-key': AK, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(j);
const org = await adm('org', 'POST', { name: T.name, slug: SLUG, email: OWNER, events_limit: T.events_limit, storage_limit_mb: T.storage_limit_mb, credits: T.credits });
const jr = await fetch(B + org.join, { redirect: 'manual' }), H = { cookie: (jr.headers.get('set-cookie') || '').split(';')[0], 'x-org-slug': SLUG };
const api = (p, method = 'GET', body, type) => fetch(B + p, { method, headers: { ...H, ...(type ? { 'content-type': type } : body ? { 'content-type': 'application/json' } : {}) }, body: body && !type ? JSON.stringify(body) : body }).then(j);
const R = f => path.join(MEDIA, f), out = [];
for (const E of T.events || []) {
  const ev = await api('/api/events', 'POST', { name: E.name }), U = `/api/events/${ev.id}`, doc = JSON.parse(fs.readFileSync(path.join(DIR, E.document), 'utf8')), F = E.files || {};
  const small = (f, kind, extra = {}) => api(`${U}/media?${new URLSearchParams({ kind, name: path.basename(f), ...extra })}`, 'PUT', fs.readFileSync(f), kind === 'video' ? 'video/mp4' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'image/jpeg');
  const video = async f => { const size = fs.statSync(f).size; if (size < 20 * 1048576) return (await small(f, 'video')).src;
    const st = await api(`${U}/upload`, 'POST', { start: 1, name: path.basename(f), type: 'video/mp4', size }), PART = 16 * 1048576, fd = fs.openSync(f, 'r'), parts = [];
    for (let n = 1, at = 0; at < size; n++, at += PART) { const buf = Buffer.alloc(Math.min(PART, size - at)); fs.readSync(fd, buf, 0, buf.length, at); parts.push(await api(`${U}/upload?${new URLSearchParams({ key: st.key, uploadId: st.uploadId, n })}`, 'PUT', buf, 'application/octet-stream')); }
    await api(`${U}/upload`, 'POST', { done: 1, key: st.key, uploadId: st.uploadId, parts, name: path.basename(f), size }); return st.file; };
  const slides = async files => { let id = null; for (const [i, f] of files.entries()) { const q = { n: i + 1 }; if (id) q.slides = id; id = (await small(f, 'slides', q)).id; } return id + '/'; };
  for (const [k, f] of Object.entries(F.videos || {})) { console.log(' video', k); doc.media[k] = { kind: 'video', name: (doc.cues.find(c => c.media === k) || {}).title || k, src: await video(R(f)), length: (doc.media[k] || {}).length || Math.round(+execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', R(f)])) }; }
  for (const [k, s] of Object.entries(F.slides || {})) { console.log(' slides', k); let files;
    if (s.pdf) { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-')); execFileSync('pdftoppm', ['-scale-to-x', '1920', '-scale-to-y', '1080', '-jpeg', R(s.pdf), path.join(tmp, 'p')]); files = fs.readdirSync(tmp).sort().map(f => path.join(tmp, f)); }
    else files = Array.from({ length: s.count }, (_, i) => R(s.images.replace('%d', i + 1)));
    doc.media[k] = { kind: 'slides', name: s.name || k, src: await slides(files), count: files.length }; }
  for (const [k, f] of Object.entries(F.logos || {})) if (doc.identity[k]) doc.identity[k].logo = (await small(R(f), 'image')).src;
  delete doc.id; doc.name = E.name; const saved = await api(U, 'PUT', doc); if (saved.problems.length) throw new Error(saved.problems.join(' | '));
  out.push({ event: ev.id, name: E.name, version: E.publish ? (await api(`${U}/publish`, 'POST', {})).version : null });
}
console.log(JSON.stringify({ org: org.org, address: `${B}/${SLUG}`, events: out, owner_join: B + (await adm('invite', 'POST', { org: org.org, email: OWNER })).join }, null, 1));
