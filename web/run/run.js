// What every screen of a running event shares: the event document, the live state from the event's room, the server clock.
import { identityNow, shown, slidesOf, pausable, reduce } from '../engine/state.js';
import { cueOf, launchTimes, launchStyle, handsOf } from '../engine/config.js';
export { identityNow, shown, slidesOf, pausable, cueOf, launchTimes, launchStyle, handsOf };
export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export async function connect() {
  const Q = new URLSearchParams(location.search), e = Q.get('e'), draft = Q.has('draft') ? '?draft' : '';
  // the event document is kept on this device: a screen reloaded while the network is down still opens
  const K = 'ev:' + e + draft; let cfg;
  try { const r = await fetch(`/api/run/${e}/config${draft}`); cfg = await r.json(); if (!r.ok && cfg.prep && window.prepScreen) { await window.prepScreen(cfg); await new Promise(() => {}); }   // the page waits here; it reloads itself when the day comes
    if (!r.ok) { document.body.innerHTML = `<p style="font:600 22px sans-serif;text-align:center;margin-top:30vh;color:#888">${cfg.error || 'تعذّر فتح اللقاء'}</p>`; throw Object.assign(new Error(cfg.error), { shown: true }); } localStorage.setItem(K, JSON.stringify(cfg)); }
  catch (x) { if (x.shown) throw x; cfg = JSON.parse(localStorage.getItem(K) || 'null'); if (!cfg) { document.body.innerHTML = '<p style="font:600 22px sans-serif;text-align:center;margin-top:30vh;color:#888">لا اتصال، ولم يُفتح هذا اللقاء على هذا الجهاز من قبل</p>'; throw x; } }
  let state = JSON.parse(localStorage.getItem(K + ':s') || 'null'), skew = 0, peers = {}, hall = null, hands = null, online = false, ws, away = null; const subs = [], tell = () => { if (!state) return; localStorage.setItem(K + ':s', JSON.stringify(state)); subs.forEach(f => f(state, { peers, online, hall, hands })); };
  // a tap made in the moment before the connection opens is not lost: it waits (five seconds at most) and goes out first
  const wait = [], out = o => { const t = JSON.stringify(o); if (ws.readyState === 1) ws.send(t); else { wait.push({ t, at: Date.now() }); if (wait.length > 20) wait.shift(); } };
  const open = () => { ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/run/${e}/ws${draft}`);
    ws.onopen = () => { online = true; seen = Date.now(); for (const w of wait.splice(0)) if (Date.now() - w.at < 5000) ws.send(w.t); if (away) { ws.send(JSON.stringify({ adopt: { state, base: away } })); away = null; } tell(); };
    ws.onmessage = m => { seen = Date.now(); const d = JSON.parse(m.data); if (d.now) skew = d.now - Date.now(); if (d.peers) peers = d.peers; if (d.hall !== undefined) hall = d.hall; if (d.hands !== undefined) hands = d.hands; if (d.reload !== undefined && d.reload !== cfg.version) return location.reload(); if (d.state && !away) state = d.state; tell(); };
    ws.onclose = async () => { online = false; tell();
      // closed by the server: is this screen still allowed? A revoked link (or an ended session) blanks the page and stops
      try { const r = await fetch(`/api/run/${e}/config${draft}`); if (r.status === 401) { localStorage.removeItem(K); localStorage.removeItem(K + ':s'); document.documentElement.style.background = '#000'; document.body.innerHTML = '<p style="font:600 20px sans-serif;text-align:center;margin-top:40vh;color:#666">أُلغي رابط هذه الشاشة</p>'; document.body.className = ''; subs.length = 0; for (let i = setTimeout(() => {}, 0); i > 0; i--) { clearTimeout(i); clearInterval(i); } return; } } catch {}
      setTimeout(open, 1500); }; };
  // a heartbeat: a connection that stays open but silent for ten seconds (a dead network) counts as down, and is opened again
  let seen = Date.now(); open(); setInterval(() => { if (ws.readyState === 1) { ws.send('{"ping":1}'); if (Date.now() - seen > 10000) ws.close(); } }, 4000);
  return { doc: cfg.doc, base: cfg.base, role: cfg.role, draft: !!draft, get state() { return state; }, now: () => Date.now() + skew,
    on: f => { subs.push(f); if (state) f(state, { peers, online, hall, hands }); }, poke: tell, send: cmd => out({ cmd }), raw: o => out(o),
    get online() { return online; },
    // the hall computer alone, network down: its keyboard moves the event by the same rules; the room takes the result back on return
    local: cmd => { if (online || !state) return; if (away === null) away = state.ver; const n = reduce(cfg.doc, state, cmd, Date.now() + skew, true); if (n !== state) { state = n; tell(); } } };
}
// the identity of the moment as CSS variables (the one revealed by the launch once it has happened)
let again = 0;
export function paint(link, s, root = document.documentElement) { const now = link.now(), k = identityNow(link.doc, s, now), I = link.doc.identity[k] || link.doc.identity.before, c = I.colors || {};
  for (const [n, v] of Object.entries({ bg: c.bg || '#F6F1E6', ink: c.ink || '#14211E', accent: c.accent || '#0F5A4E', gold: c.gold || '#C2A063' })) root.style.setProperty('--' + n, v);
  // the reveal is still ahead (a countdown is running): come back at its moment
  if (s.launchedAt && k === 'before' && link.doc.identity.after) { clearTimeout(again); again = setTimeout(link.poke, Math.max(30, s.launchedAt + launchTimes(link.doc).reveal * 1000 - now + 20)); }
  return { key: k, logo: I.logo ? link.base + I.logo : '' }; }
// this device, for the operator's list of screens: an id kept by the window
export const deviceId = () => { let d = sessionStorage.getItem('dev'); if (!d) { d = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('dev', d); } return d; };   // per window: two windows of one computer are two screens
// every file a screen needs, by what it shows: the big screen everything; a side or logo screen the logos and the launch video
export function filesOf(doc, base, all = true) { const out = [], L = (doc.cues || []).find(c => c.type === 'launch');
  for (const [id, m] of Object.entries(doc.media || {})) { if (!all && !(L && L.media === id)) continue; if (m.kind === 'slides') for (let i = 1; i <= (m.count || 0); i++) out.push(base + m.src + 's-' + i + '.jpg'); else out.push(base + m.src); }
  for (const k of ['before', 'after']) { const I = (doc.identity || {})[k]; if (I && I.logo) out.push(base + I.logo); } return out; }
