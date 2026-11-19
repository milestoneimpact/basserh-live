// The live state of one event and the rules that change it, driven by the event document (engine/config.js).
// The same rules as the first ceremony (show/state.js), without a single cue number in the code: any number of cues, any order,
// with or without a launch. Runs in the event's Durable Object (authority) and in the pages (rehearsal without a server).
import { SCENES, cueOf, armOf, launchOf, orderProblem, launchTimes } from './config.js';

const ids = ev => ev.cues.map(c => c.id);
export const order = (ev, s) => (s.orderAt && Array.isArray(s.order) && s.order.length === ev.cues.length && ids(ev).every(i => s.order.includes(i)) ? s.order : ids(ev));
export const offOf = (ev, s) => (Array.isArray(s.off) ? s.off : ev.cues.filter(c => c.off).map(c => c.id));
export const shown = (ev, s) => { const off = offOf(ev, s); return order(ev, s).filter(i => i === s.cue || !off.includes(i)); };
const pos = (ev, s, i) => order(ev, s).indexOf(i);
const never = ev => [ids(ev)[0], armOf(ev), launchOf(ev)].filter(Boolean);   // cues that cannot be taken out
const media = (ev, c) => (c && c.media && ev.media ? ev.media[c.media] : null);
export const pausable = (ev, i) => { const c = cueOf(ev, i); return !!(c && SCENES[c.type] && SCENES[c.type].pausable); };
// slides of a cue: a slides scene starts on slide 1; a speaker with slides starts on 0, the name card
export const slidesOf = (ev, i) => { const c = cueOf(ev, i), m = media(ev, c); return c && m && m.kind === 'slides' && (c.type === 'slides' || c.type === 'speaker') ? { min: c.type === 'speaker' ? 0 : 1, max: m.count || 1 } : null; };
// the next shown slide in a direction, passing over the slides the operator has hidden (the name card is never hidden)
export function step(ev, s, d) {
  const r = slidesOf(ev, s.cue); if (!r) return s.slide || 0;
  const hid = new Set(((s.hide || {})[s.cue]) || []); let n = Number.isFinite(s.slide) ? s.slide : r.min;
  do { n += d; } while (n >= r.min && n <= r.max && n > 0 && hid.has(n));
  return Math.max(r.min, Math.min(r.max, n));
}
export const initial = ev => ({ cue: ids(ev)[0], cueAt: Date.now(), armed: false, launchedAt: null, slide: 0, black: false, paused: null, hide: {}, off: null, order: null, orderAt: null, beganAt: null, startAt: null, live: false, ver: 0 });   // live: the operator's switch; until it is on, every screen is black

function setCue(ev, s, n, now, { restart = false } = {}) {
  if (!cueOf(ev, n)) return s;
  if (n === s.cue && !restart) return s;
  const o = { ...s, cue: n, cueAt: now, paused: null, q: null }, p = pos(ev, s, n), a = armOf(ev), l = launchOf(ev);
  if (p >= 1 && pos(ev, s, s.cue) < 1) o.beganAt = now; else if (p < 1) o.beganAt = null;
  if (l) {
    const pA = pos(ev, s, a), pL = pos(ev, s, l);
    if (p < pA) { o.armed = false; o.launchedAt = null; }
    if (n === a) { o.armed = true; o.launchedAt = null; }
    if (n === l) { o.armed = false; const fromBefore = pos(ev, s, s.cue) < pL;
      if (restart || (fromBefore && !(s.launchedAt && now - s.launchedAt < 8000)) || !s.launchedAt) o.launchedAt = now; }
    // going past the launch without playing it counts as launched: the new identity shows everywhere
    if (p > pL && !o.launchedAt) { o.launchedAt = now - launchTimes(ev).end * 1000; o.armed = false; }
  }
  const r = slidesOf(ev, n); if (r && s.cue !== n) o.slide = r.min === 0 ? 0 : step(ev, { ...o, slide: 0 }, 1);
  return o;
}

// cmd: { type, ... }; trusted = the sender holds an operator link of this event
export function reduce(ev, s, cmd, now = Date.now(), trusted = false) {
  let o = s; const sh = shown(ev, s), i = sh.indexOf(s.cue), l = launchOf(ev);
  if (cmd.type === 'press') { if (s.armed && !s.launchedAt && l) o = setCue(ev, s, l, now, { restart: true }); }   // the guest's long press (launch link)
  else if (!trusted) return s;
  else if (cmd.type === 'go') o = setCue(ev, s, cmd.id, now);
  else if (cmd.type === 'next') o = i < sh.length - 1 ? setCue(ev, s, sh[i + 1], now) : s;
  else if (cmd.type === 'prev') o = i > 0 ? setCue(ev, s, sh[i - 1], now) : s;
  else if (cmd.type === 'launch') o = !l || (s.cue === l && s.launchedAt && now - s.launchedAt < 8000) ? s : setCue(ev, { ...s, armed: true }, l, now, { restart: true });
  else if (cmd.type === 'order') { const v = cmd.order || []; if (v.length === ev.cues.length && ids(ev).every(x => v.includes(x)) && !orderProblem(ev, v)) o = { ...s, order: v, orderAt: now }; }
  else if (cmd.type === 'off') { const set = new Set(offOf(ev, s)); if (cueOf(ev, cmd.id) && !never(ev).includes(cmd.id) && !(cmd.on && cmd.id === s.cue)) { cmd.on ? set.add(cmd.id) : set.delete(cmd.id); o = { ...s, off: [...set] }; } }
  else if (cmd.type === 'slide') { const r = slidesOf(ev, s.cue); if (r) o = { ...s, slide: Math.max(r.min, Math.min(r.max, Number.isFinite(+cmd.n) ? +cmd.n : r.min)) }; }
  else if (cmd.type === 'step') o = { ...s, slide: step(ev, s, cmd.d < 0 ? -1 : 1) };
  else if (cmd.type === 'hide') { const c = cmd.id || s.cue, set = new Set(((s.hide || {})[c]) || []); cmd.on ? set.add(+cmd.n) : set.delete(+cmd.n); o = { ...s, hide: { ...(s.hide || {}), [c]: [...set].sort((a, b) => a - b) } }; }
  else if (cmd.type === 'pause') o = s.paused || !pausable(ev, s.cue) ? s : { ...s, paused: now };
  else if (cmd.type === 'resume') o = s.paused ? { ...s, cueAt: s.cueAt + (now - s.paused), paused: null } : s;
  else if (cmd.type === 'seek') o = pausable(ev, s.cue) ? { ...s, cueAt: Math.min(s.paused || now, s.cueAt - (+cmd.d || 0) * 1000) } : s;
  else if (cmd.type === 'black') o = { ...s, black: !!cmd.on };
  else if (cmd.type === 'dim') { const set = new Set(s.dim || []); if (['main', 'side', 'logo'].includes(cmd.kind)) { cmd.on ? set.add(cmd.kind) : set.delete(cmd.kind); o = { ...s, dim: [...set] }; } }   // the operator puts out one kind of screen (the logo screens, the side ones) and leaves the others
  else if (cmd.type === 'show') { const t = String(cmd.text || '').trim().slice(0, 300); o = t ? { ...s, q: { text: t, name: String(cmd.name || '').trim().slice(0, 60) } } : (s.q ? { ...s, q: null } : s); }   // a question from the audience on the big screen, until the operator takes it off or the cue changes
  else if (cmd.type === 'ident') o = { ...s, identAt: now };   // every screen shows its own name for a few seconds, so the operator matches the list to the walls
  else if (cmd.type === 'live') o = !!cmd.on === !!s.live ? s : { ...s, live: !!cmd.on, cueAt: cmd.on ? now : s.cueAt, paused: null };   // turning on starts the cue on show from its beginning
  else if (cmd.type === 'note') { const t = String(cmd.text || '').trim().slice(0, 120); o = t ? { ...s, note: { text: t, at: now } } : (s.note ? { ...s, note: null } : s); }   // a word from the operator to the moderator's page
  else if (cmd.type === 'start') o = { ...s, startAt: cmd.at || null };
  else if (cmd.type === 'reset') o = { ...initial(ev), order: s.order, orderAt: s.orderAt, off: s.off, hide: s.hide, live: s.live, dim: s.dim };
  return o === s ? s : { ...o, ver: (s.ver || 0) + 1 };
}
// which identity a screen shows now: the one revealed by the launch once it has happened
// (with «now»: from the moment of the reveal itself, so no screen shows the new logo while the countdown still runs)
export const identityNow = (ev, s, now) => (s.launchedAt && ev.identity && ev.identity.after && (now == null || now >= s.launchedAt + launchTimes(ev).reveal * 1000) ? 'after' : 'before');
