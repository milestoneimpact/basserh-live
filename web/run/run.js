// What every screen of a running event shares: the event document, the live state from the event's room, the server clock.
import { identityNow, shown, slidesOf, pausable, reduce } from '../engine/state.js';
import { cueOf, launchTimes, launchStyle, handsOf, gestureOf, launchOf, fontCss } from '../engine/config.js';
export { identityNow, shown, slidesOf, pausable, cueOf, launchTimes, launchStyle, handsOf, gestureOf };
export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export async function connect() {
  const Q = new URLSearchParams(location.search), e = Q.get('e'), draft = Q.has('draft') ? '?draft' : '';
  // ?solo=<cue>: the studio's preview of one moment. The draft is read, nothing is connected, the cue plays from its start
  if (Q.has('solo')) { const cfg = await (await fetch(`/api/run/${e}/config?draft`)).json(); if (!cfg.doc) { document.body.innerHTML = ''; await new Promise(() => {}); } const d = cfg.doc, c = cueOf(d, Q.get('solo')) || d.cues[0], L = launchOf(d), sl = slidesOf(d, c.id), t = Date.now();
    const after = L && d.cues.findIndex(x => x.id === c.id) > d.cues.findIndex(x => x.id === L);
    let state = { cue: c.id, cueAt: t, armed: c.type === 'arm', launchedAt: c.type === 'launch' ? t + 700 : after ? t - 6e5 : null, slide: sl ? Math.max(1, sl.min) : 0, black: false, paused: null, hide: {}, live: true, ver: 1 }; const subs = [], info = () => ({ peers: {}, online: true, hall: {}, hands: { held: 0, need: handsOf(d), allAt: null } });
    return { doc: d, base: cfg.base, role: 'console', draft: true, solo: true, get state() { return state; }, now: () => Date.now(), on: f => { subs.push(f); f(state, info()); }, poke: () => subs.forEach(f => f(state, info())), raw: () => {}, local: () => {}, online: true,
      send: cmd => { if (cmd.type === 'step' && sl) { state = { ...state, slide: Math.max(1, Math.min(sl.max, state.slide + (cmd.d < 0 ? -1 : 1))) }; subs.forEach(f => f(state, info())); } } }; }
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
    ws.onmessage = m => { seen = Date.now(); const d = JSON.parse(m.data); if (d.pong) { const rtt = Date.now() - d.pong; lagNow = rtt; if (rtt <= best * 1.3 || Date.now() - bestAt > 60000) { if (rtt < best || Date.now() - bestAt > 60000) { best = rtt; bestAt = Date.now(); } skew = d.now + rtt / 2 - Date.now(); synced = true; } return; }
      if (d.now && !synced) skew = d.now - Date.now(); if (d.peers) peers = d.peers; if (d.hall !== undefined) hall = d.hall; if (d.hands !== undefined) hands = d.hands; if (d.reload !== undefined && d.reload !== cfg.version) { window.leaving = true; return location.reload(); } if (d.state && !away) state = d.state; tell(); };
    ws.onclose = async () => { online = false; tell();
      // closed by the server: is this screen still allowed? A revoked link (or an ended session) blanks the page and stops
      try { const r = await fetch(`/api/run/${e}/config${draft}`); if (r.status === 401) { localStorage.removeItem(K); localStorage.removeItem(K + ':s'); document.documentElement.style.background = '#000'; document.body.innerHTML = '<p style="font:600 20px sans-serif;text-align:center;margin-top:40vh;color:#666">أُلغي رابط هذه الشاشة</p>'; if (localStorage.getItem('screen:go')) { localStorage.removeItem('screen:go'); setTimeout(() => { window.leaving = true; location.replace('/screen'); }, 2500); } document.body.className = ''; subs.length = 0; for (let i = setTimeout(() => {}, 0); i > 0; i--) { clearTimeout(i); clearInterval(i); } return; } } catch {}
      setTimeout(open, 1500); }; };
  // a heartbeat: a connection that stays open but silent for ten seconds (a dead network) counts as down, and is opened again
  // the clock: a question to the room, its answer, half the trip taken off. Three quick ones at the start, then one every four seconds; the answer that came back fastest is the one trusted
  let seen = Date.now(), best = Infinity, bestAt = 0, lagNow = 0, synced = false; const ping = () => { if (ws.readyState === 1) ws.send(JSON.stringify({ ping: Date.now() })); };
  open(); [300, 900, 1700].forEach(t => setTimeout(ping, t)); setInterval(() => { if (ws.readyState === 1) { ping(); if (Date.now() - seen > 10000) ws.close(); } }, 4000);
  return { doc: cfg.doc, base: cfg.base, role: cfg.role, label: cfg.label || '', read: cfg.read || {}, version: cfg.version, draft: !!draft, get lag() { return lagNow; }, get synced() { return synced; }, get state() { return state; }, now: () => Date.now() + skew,
    on: f => { subs.push(f); if (state) f(state, { peers, online, hall, hands }); }, poke: tell, send: cmd => out({ cmd }), raw: o => out(o),
    get online() { return online; },
    // the hall computer alone, network down: its keyboard moves the event by the same rules; the room takes the result back on return
    local: cmd => { if (online || !state) return; if (away === null) away = state.ver; const n = reduce(cfg.doc, state, cmd, Date.now() + skew, true); if (n !== state) { state = n; tell(); } } };
}
// the identity of the moment as CSS variables (the one revealed by the launch once it has happened)
let again = 0;
// how far apart two colours are for the eye (WCAG): 1 is the same colour, 21 is black on white
const rgb = h => { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0); };
export const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const mix = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v * t + rgb(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
export function paint(link, s, root = document.documentElement) { const now = link.now(), k = identityNow(link.doc, s, now), I = link.doc.identity[k] || link.doc.identity.before, c = I.colors || {};
  for (const [n, v] of Object.entries({ bg: c.bg || '#F6F1E6', ink: c.ink || '#14211E', accent: c.accent || '#0F5A4E', gold: c.gold || '#C2A063' })) root.style.setProperty('--' + n, v); root.style.setProperty('--ft', fontCss(I));
  { const bg = c.bg || '#F6F1E6', ink = contrast(c.ink || '#14211E', bg) < 3 ? (lum(bg) > .4 ? '#14211E' : '#F6F2E8') : (c.ink || '#14211E');   // the ink first: every fallback below leans on it
    root.style.setProperty('--ink', ink); if (contrast(c.accent || '#0F5A4E', bg) < 2.2) root.style.setProperty('--accent', ink); if (contrast(c.gold || '#C2A063', bg) < 2.6) root.style.setProperty('--gold', mix(ink, bg, .72)); }
  // the reveal is still ahead (a countdown is running): come back at its moment
  if (s.launchedAt && k === 'before' && link.doc.identity.after) { clearTimeout(again); again = setTimeout(link.poke, Math.max(30, s.launchedAt + launchTimes(link.doc).reveal * 1000 - now + 20)); }
  return { key: k, logo: I.logo ? link.base + I.logo : '' }; }
// this device, for the operator's list of screens: an id kept by the window
export const deviceId = () => { let d = sessionStorage.getItem('dev'); if (!d) { d = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('dev', d); } return d; };   // per window: two windows of one computer are two screens
// every file a screen needs, by what it shows: the big screen everything; a side or logo screen the logos and the launch video
export function filesOf(doc, base, all = true) { const out = [], L = (doc.cues || []).find(c => c.type === 'launch');
  for (const [id, m] of Object.entries(doc.media || {})) { if (!all && !(L && L.media === id)) continue; if (m.kind === 'slides') for (let i = 1; i <= (m.count || 0); i++) out.push(base + m.src + 's-' + i + '.jpg'); else out.push(base + m.src); }
  for (const k of ['before', 'after']) { const I = (doc.identity || {})[k]; if (I && I.logo) out.push(base + I.logo); } return out; }
