// What every screen of a running event shares: the event document, the live state from the event's room, the server clock.
import { identityNow, shown, slidesOf, pausable, reduce } from '../engine/state.js';
import { cueOf } from '../engine/config.js';
export { identityNow, shown, slidesOf, pausable, cueOf };
export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export async function connect() {
  const Q = new URLSearchParams(location.search), e = Q.get('e'), draft = Q.has('draft') ? '?draft' : '';
  // the event document is kept on this device: a screen reloaded while the network is down still opens
  const K = 'ev:' + e + draft; let cfg;
  try { const r = await fetch(`/api/run/${e}/config${draft}`); cfg = await r.json(); if (!r.ok) { document.body.innerHTML = `<p style="font:600 22px sans-serif;text-align:center;margin-top:30vh;color:#888">${cfg.error || 'تعذّر فتح اللقاء'}</p>`; throw Object.assign(new Error(cfg.error), { shown: true }); } localStorage.setItem(K, JSON.stringify(cfg)); }
  catch (x) { if (x.shown) throw x; cfg = JSON.parse(localStorage.getItem(K) || 'null'); if (!cfg) { document.body.innerHTML = '<p style="font:600 22px sans-serif;text-align:center;margin-top:30vh;color:#888">لا اتصال، ولم يُفتح هذا اللقاء على هذا الجهاز من قبل</p>'; throw x; } }
  let state = JSON.parse(localStorage.getItem(K + ':s') || 'null'), skew = 0, peers = {}, hall = null, online = false, ws, away = null; const subs = [], tell = () => { if (!state) return; localStorage.setItem(K + ':s', JSON.stringify(state)); subs.forEach(f => f(state, { peers, online, hall })); };
  const open = () => { ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/run/${e}/ws${draft}`);
    ws.onopen = () => { online = true; seen = Date.now(); if (away) { ws.send(JSON.stringify({ adopt: { state, base: away } })); away = null; } tell(); };
    ws.onmessage = m => { seen = Date.now(); const d = JSON.parse(m.data); if (d.now) skew = d.now - Date.now(); if (d.peers) peers = d.peers; if (d.hall !== undefined) hall = d.hall; if (d.reload !== undefined && d.reload !== cfg.version) return location.reload(); if (d.state && !away) state = d.state; tell(); };
    ws.onclose = () => { online = false; tell(); setTimeout(open, 1500); }; };
  // a heartbeat: a connection that stays open but silent for ten seconds (a dead network) counts as down, and is opened again
  let seen = Date.now(); open(); setInterval(() => { if (ws.readyState === 1) { ws.send('{"ping":1}'); if (Date.now() - seen > 10000) ws.close(); } }, 4000);
  return { doc: cfg.doc, base: cfg.base, role: cfg.role, draft: !!draft, get state() { return state; }, now: () => Date.now() + skew,
    on: f => { subs.push(f); if (state) f(state, { peers, online, hall }); }, send: cmd => ws.readyState === 1 && ws.send(JSON.stringify({ cmd })), raw: o => ws.readyState === 1 && ws.send(JSON.stringify(o)),
    get online() { return online; },
    // the hall computer alone, network down: its keyboard moves the event by the same rules; the room takes the result back on return
    local: cmd => { if (online || !state) return; if (away === null) away = state.ver; const n = reduce(cfg.doc, state, cmd, Date.now() + skew, true); if (n !== state) { state = n; tell(); } } };
}
// the identity of the moment as CSS variables (the one revealed by the launch once it has happened)
export function paint(link, s, root = document.documentElement) { const k = identityNow(link.doc, s), I = link.doc.identity[k] || link.doc.identity.before, c = I.colors || {};
  for (const [n, v] of Object.entries({ bg: c.bg || '#F6F1E6', ink: c.ink || '#14211E', accent: c.accent || '#0F5A4E', gold: c.gold || '#C2A063' })) root.style.setProperty('--' + n, v);
  return { key: k, logo: I.logo ? link.base + I.logo : '' }; }
