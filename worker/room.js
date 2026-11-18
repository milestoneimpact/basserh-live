// One room per event (and one more for its rehearsal): the live state, kept and broadcast to every screen.
// The rules are engine/state.js; the room only checks who may send what. The event document arrives with each request
// (the worker reads the frozen version from the database), so a newly published version reaches the room at once.
import { initial, reduce } from '../web/engine/state.js';
import { handsOf } from '../web/engine/config.js';
export class Room {
  constructor(ctx, env) { this.ctx = ctx; this.state = null; this.doc = null; this.ver = null; ctx.blockConcurrencyWhile(async () => { this.state = (await ctx.storage.get('state')) || null; this.ver = (await ctx.storage.get('ver')) ?? null; this.doc = (await ctx.storage.get('doc')) || null; }); }
  async take(req) {
    const raw = decodeURIComponent(req.headers.get('x-doc')), v = +req.headers.get('x-ver'); if (raw !== this.raw) { this.raw = raw; this.doc = JSON.parse(raw); await this.ctx.storage.put('doc', this.doc); }   // kept: the room wakes from sleep on a message, with no request
    const known = this.state && this.doc.cues.some(c => c.id === this.state.cue);
    if (!this.state || !known) { this.state = { ...initial(this.doc), live: v === 0 }; await this.ctx.storage.put('state', this.state); }   // a rehearsal (the draft) is on from the start; the hall waits for the operator
    if (v !== this.ver) { this.ver = v; await this.ctx.storage.put('ver', v); this.cast({ reload: v }); }   // screens read the new version
  }
  cast(o) { const t = JSON.stringify(o); for (const ws of this.ctx.getWebSockets()) { try { ws.send(t); } catch {} } }
  // the screens of the hall as they report themselves (which kind, what size, how many files they hold); kept with each connection, so it survives the room's sleep
  hall() { const d = {}; for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment() || {}; if (a.rep) d[a.rep.id] = a.rep; } return d; }
  // a launch by several hands: how many guests are holding their button now, and since when all of them are
  hands() { let held = 0; for (const ws of this.ctx.getWebSockets()) { if ((ws.deserializeAttachment() || {}).hold) held++; } const need = this.doc ? handsOf(this.doc) : 1;
    if (held >= need) this.allAt = this.allAt || Date.now(); else this.allAt = null; return { held, need, allAt: this.allAt }; }
  peers() { const n = {}; for (const ws of this.ctx.getWebSockets()) { const r = (ws.deserializeAttachment() || {}).role; n[r] = (n[r] || 0) + 1; } return n; }
  async apply(cmd, role) {
    // the operator sends everything; the guest's tablet only the launch press; the hall computer only the presenter's clicker (slides)
    const op = role === 'console', press = cmd && cmd.type === 'press' && (role === 'tablet' || op), click = cmd && ((cmd.type === 'step' && (role === 'stage' || role === 'clicker')) || (cmd.type === 'slide' && role === 'clicker')); if (!cmd || !(op || press || click)) return;
    // several hands: the press counts once every guest has held for two seconds together
    if (press && !op && handsOf(this.doc) > 1) { const h = this.hands(); if (!(h.allAt && Date.now() - h.allAt >= 1800)) return; }
    const trusted = op || click;
    const next = reduce(this.doc, this.state, cmd, Date.now(), trusted); if (next !== this.state) { this.state = next; await this.ctx.storage.put('state', next); this.cast({ state: next, now: Date.now(), peers: this.peers() }); }
  }
  async fetch(req) {
    if (new URL(req.url).pathname === '/kick') { for (const ws of this.ctx.getWebSockets()) { try { ws.close(4001, 'renew'); } catch {} } return Response.json({ ok: true }); }
    await this.take(req); const role = req.headers.get('x-role'), url = new URL(req.url);
    if (url.pathname.endsWith('/state')) return Response.json({ state: this.state, now: Date.now(), peers: this.peers() });
    if (url.pathname.endsWith('/cmd')) { await this.apply(await req.json().catch(() => null), role); return Response.json({ state: this.state, now: Date.now() }); }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket', { status: 426 });
    const [a, b] = Object.values(new WebSocketPair()); this.ctx.acceptWebSocket(b); b.serializeAttachment({ role });
    b.send(JSON.stringify({ state: this.state, now: Date.now(), peers: this.peers(), hall: this.hall(), hands: this.hands() })); this.cast({ peers: this.peers() });
    return new Response(null, { status: 101, webSocket: a });
  }
  async webSocketMessage(ws, msg) { let m; try { m = JSON.parse(msg); } catch { return; } if (m.ping) return ws.send(JSON.stringify({ pong: m.ping, now: Date.now() }));
    const role = (ws.deserializeAttachment() || {}).role;
    // the hall computer reports the files it holds locally; the operator sees it
    if (m.report && /^[a-z0-9]{4,12}$/.test(m.report.id || '')) { const r = m.report, a = ws.deserializeAttachment() || {}; ws.serializeAttachment({ ...a, rep: { id: r.id, kind: ['main', 'side', 'logo'].includes(r.kind) ? r.kind : 'main', w: +r.w || 0, h: +r.h || 0, total: +r.total || 0, done: +r.done || 0, bad: +r.bad || 0, pct: +r.pct || 0 } }); return this.cast({ hall: this.hall() }); }
    if (m.hold !== undefined && (role === 'tablet' || role === 'console')) { const a = ws.deserializeAttachment() || {}; ws.serializeAttachment({ ...a, hold: !!m.hold }); return this.cast({ hands: this.hands() }); }
    // the hall computer ran the event from its keyboard while the network was down: its state is taken back if nobody moved the event meanwhile
    if (m.adopt && (role === 'stage' || role === 'console') && this.state && m.adopt.base === this.state.ver && this.doc.cues.some(c => c.id === m.adopt.state.cue)) { this.state = { ...m.adopt.state, ver: this.state.ver + 1 }; await this.ctx.storage.put('state', this.state); return this.cast({ state: this.state, now: Date.now(), peers: this.peers() }); }
    if (!this.doc) return; await this.apply(m.cmd, (ws.deserializeAttachment() || {}).role); }
  webSocketClose() { this.cast({ peers: this.peers(), hall: this.hall(), hands: this.hands() }); }
}
