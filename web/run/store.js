// The files of an event kept on the hall computer (IndexedDB), so a video or a slide never depends on the network during the event.
// url(u): the local copy if it is complete, else the network address. keep(list, onProgress): copies what is missing.
const DB = new Promise((res, rej) => { const r = indexedDB.open('event-files', 2); r.onupgradeneeded = () => { for (const n of ['f', 'p']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn, store = 'f') => { const db = await DB; return new Promise((res, rej) => { const t = db.transaction(store, mode), q = fn(t.objectStore(store)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
const urls = new Map();
export async function url(u) { if (urls.has(u)) return urls.get(u); try { const b = await tx('readonly', s => s.get(u)); if (b) { const o = URL.createObjectURL(b); urls.set(u, o); return o; } } catch {} return u; }
export const has = async u => { try { return !!(await tx('readonly', s => s.count(u))); } catch { return false; } };
export async function keep(list, onProgress = () => {}) {
  try { await navigator.storage?.persist?.(); } catch {}
  const st = Object.fromEntries(list.map(u => [u, { done: false, pct: 0 }]));
  for (const u of list) { if (await has(u)) { st[u] = { done: true, pct: 100 }; onProgress(st); continue; }
    for (let go = 0; go < 4; go++) { if (go) { st[u] = { done: false, pct: 0, err: st[u].err, again: go }; onProgress(st); await new Promise(r => setTimeout(r, go * 2500)); }
    try { await chunks(u, pct => { if (pct !== st[u].pct) { st[u].pct = pct; onProgress(st); } }); st[u] = { done: true, pct: 100 }; break;
    } catch (e) { st[u] = { done: false, pct: 0, err: /quota|storage/i.test(String(e)) ? 'لا مساحة كافية على هذا الجهاز' : /^\d+$/.test(String(e.message)) ? 'الخادم رد بخطأ ' + e.message : 'انقطع التنزيل' }; } } onProgress(st); }
  return st;
}

// a file comes in pieces of 8 MB, each kept as it arrives: a cut in the network resumes from the last piece, and a big video never sits whole in memory
const PIECE = 8 * 1048576;
async function chunks(u, tick) {
  let total = 0, type = '';
  const get = async i => { const r = await fetch(u, { headers: { Range: `bytes=${i * PIECE}-${(i + 1) * PIECE - 1}` } }); if (!r.ok) throw new Error(r.status);
    type = r.headers.get('Content-Type') || type; const cr = r.headers.get('Content-Range'); total = cr ? +cr.split('/')[1] : +(r.headers.get('Content-Length') || 0); return { b: await r.blob(), whole: r.status === 200 }; };
  const head = (await tx('readonly', s => s.get(u + '#meta'), 'p')) || null;
  if (head) { total = head.total; type = head.type; }
  else { const first = await get(0); if (first.whole) { await tx('readwrite', s => s.put(first.b, u)); return; }   // a server that ignores ranges: the file came whole
    await tx('readwrite', s => { s.put(first.b, u + '#0'); s.put({ total, type }, u + '#meta'); }, 'p'); }
  const n = Math.max(1, Math.ceil(total / PIECE));
  for (let i = 0; i < n; i++) { if (await tx('readonly', s => s.count(u + '#' + i), 'p')) { tick(Math.floor((i + 1) / n * 100)); continue; }
    let e; for (let k = 0; k < 6; k++) { try { const { b } = await get(i); await tx('readwrite', s => s.put(b, u + '#' + i), 'p'); e = null; break; } catch (x) { e = x; if (/quota/i.test(String(x))) throw x; await new Promise(r => setTimeout(r, 1500 * (k + 1))); } }
    if (e) throw e; tick(Math.floor((i + 1) / n * 100)); }
  const parts = []; for (let i = 0; i < n; i++) parts.push(await tx('readonly', s => s.get(u + '#' + i), 'p'));
  const whole = new Blob(parts, { type }); if (total && whole.size !== total) { await tx('readwrite', s => { for (let i = 0; i < n; i++) s.delete(u + '#' + i); s.delete(u + '#meta'); }, 'p'); throw new Error('size'); }
  await tx('readwrite', s => s.put(whole, u));
  await tx('readwrite', s => { for (let i = 0; i < n; i++) s.delete(u + '#' + i); s.delete(u + '#meta'); }, 'p');
}
