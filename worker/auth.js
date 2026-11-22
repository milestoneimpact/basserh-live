// Who is asking: sessions, passwords (PBKDF2), the lock after wrong tries, one time links, accounts.
import { cookies, hex, now, rid, setCookie, sha, slug } from './util.js';
import { features } from './data.js';

export async function me(req, env) {
  await features(env);
  const t = cookies(req).sid; if (!t) return null;
  const s = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await sha(t), now()).first(); if (!s) return null;
  const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(s.user_id).first();
  const { results } = await env.DB.prepare('SELECT o.id, o.name, o.slug, o.plan, o.events_limit, o.storage_limit_mb, o.paid_until, o.credits, o.features, m.role FROM members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? AND o.plan != ?').bind(s.user_id, 'off').all();   // a switched off organisation is closed to its members
  return { user, orgs: results };
}
// the organisation a request works in (header x-org, else the person's first), and the person's role in it
export const orgOf = (who, req) => { const s = req.headers.get('x-org-slug'); return s ? who.orgs.find(o => o.slug === s) : who.orgs[0]; };   // each organisation works under its own address: /<slug>
export async function invite(env, email, days = 14) { const code = rid(28); await env.DB.prepare('INSERT INTO login_codes (code_hash, email, expires_at) VALUES (?,?,?)').bind(await sha(code), email, new Date(Date.now() + days * 864e5).toISOString()).run(); return '/join/' + code; }
export async function pwHash(pw, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return salt + ':' + hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256)); }
export const pwOk = async (pw, kept) => { if (!kept || !pw) return false; const a = await pwHash(pw, kept.split(':')[0]); let d = a.length ^ kept.length; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ kept.charCodeAt(i % kept.length); return d === 0; };
// a password a person can read out and type: four groups of four, no look-alike characters
export const DUMMY = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1:' + '0'.repeat(64);   // an unknown email costs the same work as a known one
export const newPw = () => [...crypto.getRandomValues(new Uint32Array(8))].map(x => x % 10).join('');   // eight digits: easy to read out and type on any phone; guessing is stopped by the lock after wrong tries
// five wrong attempts from one address close the door for fifteen minutes (the owner's page and the studio share the count)
export async function locked(env, ip) { const f = await env.DB.prepare('SELECT n, until FROM login_fail WHERE ip = ?').bind(ip).first(); return f && f.until && f.until > now() ? null : { n: f && !f.until ? f.n : 0 }; }
export const failed = (env, ip, n, limit = 5) => env.DB.prepare('INSERT INTO login_fail (ip, n, until) VALUES (?,?,?) ON CONFLICT (ip) DO UPDATE SET n = excluded.n, until = excluded.until').bind(ip, n + 1, n + 1 >= limit ? new Date(Date.now() + 9e5).toISOString() : null).run();
export const KEEP = 180;   // days a device stays signed in: a device that entered once is not asked again for half a year, unless it signs out or the password is renewed
export async function session(env, uid) { const t = rid(32); await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').bind(await sha(t), uid, new Date(Date.now() + KEEP * 864e5).toISOString(), now()).run(); return setCookie('sid', t, KEEP); }
// the platform owner as a person of the system (for sessions and passkeys); belongs to no organisation
export async function platform(env) { await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?,?,?,?) ON CONFLICT (id) DO NOTHING').bind('platform', 'platform@basserh', 'مالك المنصة', now()).run(); return 'platform'; }
export async function userFor(env, email, name) { email = String(email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  let u = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first(), fresh = false; if (!u) { fresh = true; u = { id: 'u_' + rid() }; await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?,?,?,?)').bind(u.id, email, name || '', now()).run(); } return { id: u.id, email, fresh }; }   // fresh: created by this very call
