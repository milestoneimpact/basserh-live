// Small helpers shared by the whole server: answers, time, random ids, hashes, cookies, roles.


export const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
export const err = (msg, status = 400) => J({ error: msg }, status);
export const now = () => new Date().toISOString();
export const rid = (n = 12) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
export const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
export const cookies = req => Object.fromEntries((req.headers.get('Cookie') || '').split(/;\s*/).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
export const setCookie = (k, v, days) => `${k}=${v}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${days * 86400}`;
export const ROLES = { owner: 3, editor: 2, operator: 1, viewer: 0 };
export const LINK_ROLES = ['station', 'hall', 'stage', 'side', 'logo', 'tablet', 'console', 'script', 'clicker', 'audience'];   // audience: one link for everyone in the hall (the programme, a question), it sees nothing else   // console: operator commands; tablet: the launch press only
export const slug = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
// a session of 30 days for a user; returns the cookie
// passwords: PBKDF2 (SHA-256, 100000 rounds) with a salt of its own; only "salt:hash" is kept
export const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
