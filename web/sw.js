// The screens' own copy of their pages: a touch screen restarted while the network is down still opens its station.
// Only the pages of a screen and what they load (scripts, styles, fonts, the PDF reader) are kept, always fresh from the network
// when it answers, the kept copy when it does not. The event's files are kept elsewhere (run/store.js), and nothing of the studio
// or of the API is touched.
const C = 'screen-v1';
const MINE = p => /^\/(screen\/?|[a-z0-9][a-z0-9-]{1,39}\/screen\/?|run\/(station|pair)(\.html)?|run\/[\w-]+\.js|engine\/[\w-]+\.js|vendor\/[\w.-]+|fonts\/[\w.-]+|app\.css|brand\/[\w.-]+)$/.test(p);
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== C) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener('fetch', e => { const r = e.request, u = new URL(r.url); if (r.method !== 'GET' || u.origin !== location.origin || !MINE(u.pathname)) return;
  e.respondWith((async () => { const c = await caches.open(C), key = u.origin + u.pathname;   // one copy per page, whatever its query (?e=…)
    try { const res = await fetch(r); if (res.ok && res.type === 'basic') c.put(key, res.clone()); return res; }
    catch (x) { const hit = await c.match(key) || (/^\/([a-z0-9-]+\/)?screen\/?$/.test(u.pathname) && await c.match(u.origin + '/run/pair')) || (u.pathname.startsWith('/run/station') && await c.match(u.origin + '/run/station.html')) || (u.pathname.startsWith('/run/station') && await c.match(u.origin + '/run/station')); if (hit) return hit; throw x; } })()); });
