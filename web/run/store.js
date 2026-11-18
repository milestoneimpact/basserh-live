// The files of an event kept on the hall computer (IndexedDB), so a video or a slide never depends on the network during the event.
// url(u): the local copy if it is complete, else the network address. keep(list, onProgress): copies what is missing.
const DB = new Promise((res, rej) => { const r = indexedDB.open('event-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await DB; return new Promise((res, rej) => { const t = db.transaction('f', mode), q = fn(t.objectStore('f')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
const urls = new Map();
export async function url(u) { if (urls.has(u)) return urls.get(u); try { const b = await tx('readonly', s => s.get(u)); if (b) { const o = URL.createObjectURL(b); urls.set(u, o); return o; } } catch {} return u; }
export const has = async u => { try { return !!(await tx('readonly', s => s.count(u))); } catch { return false; } };
export async function keep(list, onProgress = () => {}) {
  try { await navigator.storage?.persist?.(); } catch {}
  const st = Object.fromEntries(list.map(u => [u, { done: false, pct: 0 }]));
  for (const u of list) { if (await has(u)) { st[u] = { done: true, pct: 100 }; onProgress(st); continue; }
    try { const r = await fetch(u); if (!r.ok) throw new Error(r.status); const total = +r.headers.get('Content-Length') || 0, rd = r.body.getReader(), parts = []; let got = 0, last = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; const pct = total ? Math.floor(got / total * 100) : 0; if (pct !== last) { last = pct; st[u].pct = pct; onProgress(st); } }
      await tx('readwrite', s => s.put(new Blob(parts, { type: r.headers.get('Content-Type') || '' }), u)); st[u] = { done: true, pct: 100 };
    } catch (e) { st[u] = { done: false, pct: 0, err: String(e.message || e) }; } onProgress(st); }
  return st;
}
