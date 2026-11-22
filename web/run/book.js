// A PDF as a book under the visitor's hand: one page at a time, filling the screen; a swipe turns it (the way the book reads,
// right to left for Arabic), a pinch or a double tap brings it close, a tap on a link follows it. The touch screen of a station,
// the visitor's phone and the stations' board all read their files with it.
let lib = null;
export async function pdfjs() { if (!lib) { lib = import('../vendor/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href; return m; }); } return lib; }
export async function openPdf(src, opt = {}) { const m = await pdfjs(); return m.getDocument({ url: src, isEvalSupported: false, disableRange: !!opt.whole, disableStream: !!opt.whole, disableAutoFetch: !opt.whole }).promise; }

// a page drawn to fit a box (css pixels), sharp on the screen's own pixels; times `k` when it is seen closer
export async function draw(pdf, n, boxW, boxH, k = 1, cv = document.createElement('canvas')) {
  const pg = await pdf.getPage(n), v1 = pg.getViewport({ scale: 1 }), fit = Math.min(boxW / v1.width, boxH / v1.height), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.max(1, Math.floor(v1.width * fit)), cssH = Math.max(1, Math.floor(v1.height * fit)); let sc = fit * dpr * k; const MAX = 4096; if (v1.width * sc > MAX) sc = MAX / v1.width; if (v1.height * sc > MAX) sc = Math.min(sc, MAX / v1.height);
  const vp = pg.getViewport({ scale: sc }); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height); cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  await pg.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp, background: '#ffffff' }).promise; cv.dataset.n = n; return { cv, cssW, cssH, page: pg, fit };
}

const CSS = `.bk{position:absolute;inset:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.bk .trk{position:absolute;inset:0;will-change:transform}.bk .trk.go{transition:transform .34s cubic-bezier(.2,.75,.25,1)}
.bk .sl{position:absolute;inset:0;display:grid;place-items:center}.bk .pz{position:relative;transform-origin:50% 50%;will-change:transform;box-shadow:0 10px 50px rgba(0,0,0,.35)}.bk .pz.go{transition:transform .3s cubic-bezier(.2,.75,.25,1)}
.bk .pz canvas{display:block;background:#fff}.bk .pz canvas+canvas{position:absolute;inset:0}
.bk .lk{position:absolute;border-radius:4px;background:color-mix(in srgb,var(--accent,#0F5A4E) 10%,transparent);outline:2px solid color-mix(in srgb,var(--accent,#0F5A4E) 35%,transparent);pointer-events:none;opacity:.0;transition:opacity .3s}.bk.hint .lk{opacity:1}
.bk .wait{position:absolute;inset:0;display:grid;place-items:center;color:var(--ink,#333);font:600 22px Plex,sans-serif;opacity:.6}`;

// host: an empty element that the book fills. o: { dir, zoom, links, onPage(n, total), onTouch(), onLink({ url } | { page }), onView({ z, x, y }) }
export function Book(host, o = {}) {
  if (!document.getElementById('bkcss')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'bkcss', textContent: CSS }));
  host.innerHTML = '<div class="bk"><div class="trk"></div></div>'; const bk = host.firstChild, trk = bk.firstChild;
  let pdf = null, n = 1, N = 0, W = 0, H = 0, gen = 0, z = 1, tx = 0, ty = 0, busy = false; const cache = new Map(), links = new Map(), sgn = () => (o.dir === 'ltr' ? 1 : -1);   // where «next» lies: left of the page in a right to left book
  const GAP = 28, padX = () => (o.pad != null ? o.pad : Math.max(12, Math.round(W * .02))), boxW = () => W - padX() * 2, boxH = () => H - (o.padY != null ? o.padY : Math.max(12, Math.round(H * .02))) * 2;
  async function pageCv(p) { if (cache.has(p)) return cache.get(p); const job = draw(pdf, p, boxW(), boxH()).then(async r => { if (o.links !== false) { try { links.set(p, await linksOf(r)); } catch { links.set(p, []); } } return r; }); cache.set(p, job);
    if (cache.size > 9) for (const k of [...cache.keys()]) if (Math.abs(k - n) > 3) { cache.delete(k); if (cache.size <= 7) break; } return job; }
  async function linksOf(r) { const out = []; for (const a of await r.page.getAnnotations({ intent: 'display' })) { if (a.subtype !== 'Link') continue; const vp = r.page.getViewport({ scale: r.fit }), [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect), box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      if (a.url || a.unsafeUrl) { const u = a.url || a.unsafeUrl; if (/^(https?:|mailto:|tel:)/i.test(u)) out.push({ ...box, url: u }); continue; }
      let d = a.dest; try { if (typeof d === 'string') d = await pdf.getDestination(d); if (Array.isArray(d) && d[0]) { const p = typeof d[0] === 'object' ? (await pdf.getPageIndex(d[0])) + 1 : (+d[0] + 1); if (p >= 1 && p <= N) out.push({ ...box, page: p }); } } catch {} } return out; }
  function slot(k) { const el = document.createElement('div'); el.className = 'sl'; el.style.transform = `translateX(${k * sgn() * (W + GAP)}px)`; el.dataset.k = k; return el; }
  async function build() { const g = ++gen; trk.classList.remove('go'); trk.style.transform = ''; const els = [-1, 0, 1].map(slot); trk.replaceChildren(...els); z = 1; tx = 0; ty = 0;
    for (const [i, k] of [[1, 0], [2, 1], [0, -1]]) { const p = n + k; if (p < 1 || p > N) continue; const r = await pageCv(p); if (g !== gen) return; const pz = document.createElement('div'); pz.className = 'pz'; pz.style.width = r.cssW + 'px'; pz.style.height = r.cssH + 'px'; pz.appendChild(r.cv);
      if (k === 0) for (const l of links.get(p) || []) { const d = document.createElement('i'); d.className = 'lk'; Object.assign(d.style, { left: l.x + 'px', top: l.y + 'px', width: l.w + 'px', height: l.h + 'px' }); pz.appendChild(d); }
      els[i].appendChild(pz); }
    for (const p of [n + 2, n - 2]) if (p >= 1 && p <= N) pageCv(p).catch(() => {}); view(); }
  const cur = () => trk.querySelector('.sl[data-k="0"] .pz');
  function clamp() { const pz = cur(); if (!pz) return; const mx = Math.max(0, (pz.offsetWidth * z - W) / 2), my = Math.max(0, (pz.offsetHeight * z - H) / 2); tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty)); }
  function view(anim) { const pz = cur(); if (!pz) return; clamp(); pz.classList.toggle('go', !!anim); pz.style.transform = z === 1 ? '' : `translate(${tx}px,${ty}px) scale(${z})`; sharpen(); const pw = pz.offsetWidth * z, ph = pz.offsetHeight * z;
    o.onView && o.onView({ z: +z.toFixed(2), x: pw > W ? +(.5 - tx / pw).toFixed(3) : .5, y: ph > H ? +(.5 - ty / ph).toFixed(3) : .5 }); }
  // a page seen closer is drawn again with more pixels, once the hand has stopped
  let sh = 0; function sharpen() { clearTimeout(sh); sh = setTimeout(async () => { const pz = cur(); if (!pz) return; const old = pz.querySelector('canvas.hi'); if (z < 1.3) { old && old.remove(); return; } if (old && +old.dataset.k >= z * .9) return; const p = n, k = Math.min(z, 4), r = await draw(pdf, p, boxW(), boxH(), k); if (p !== n || cur() !== pz) return; r.cv.className = 'hi'; r.cv.dataset.k = k; old && old.remove(); pz.insertBefore(r.cv, pz.querySelector('.lk')); }, 260); }
  async function go(p, how = 'fade') { if (!pdf) return; p = Math.max(1, Math.min(N, p)); if (p === n && trk.children.length) return; const d = p > n ? 1 : -1;
    if (how === 'slide' && Math.abs(p - n) === 1 && z === 1 && !busy) { busy = true; await pageCv(p); trk.classList.add('go'); trk.style.transform = `translateX(${-d * sgn() * (W + GAP)}px)`; await new Promise(r => setTimeout(r, 340)); busy = false; }
    else if (how === 'fade') { bk.animate([{ opacity: 1 }, { opacity: .25 }], { duration: 120, fill: 'forwards' }); await pageCv(p); }
    n = p; await build(); bk.getAnimations().forEach(a => a.cancel()); if (how === 'fade') bk.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 220 }); o.onPage && o.onPage(n, N); }

  // the hand: one finger turns the page (or moves a page seen closer), two fingers bring it closer, a tap follows a link or turns at the edges
  const P = new Map(); let g0 = null, lastTap = 0, tapT = 0;
  const center = () => { const r = bk.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
  bk.addEventListener('pointerdown', e => { if (!pdf || busy) return; bk.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY }); o.onTouch && o.onTouch(); const pts = [...P.values()];
    if (pts.length === 1) g0 = { kind: 'one', x: e.clientX, y: e.clientY, t: Date.now(), tx, ty, dx: 0, moved: false };
    else if (pts.length === 2 && o.zoom !== false) { const [a, b] = pts; g0 = { kind: 'two', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z, tx, ty }; trk.classList.add('go'); trk.style.transform = ''; } });
  bk.addEventListener('pointermove', e => { if (!P.has(e.pointerId) || !g0) return; P.set(e.pointerId, { x: e.clientX, y: e.clientY }); const pts = [...P.values()];
    if (g0.kind === 'two' && pts.length >= 2) { const [a, b] = pts, d = Math.hypot(a.x - b.x, a.y - b.y), { cx, cy } = center(), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nz = Math.max(1, Math.min(5, g0.z * d / g0.d)), px = g0.mx - cx, py = g0.my - cy;
      tx = px - (px - g0.tx) * (nz / g0.z) + (mx - g0.mx); ty = py - (py - g0.ty) * (nz / g0.z) + (my - g0.my); z = nz; view(); return; }
    if (g0.kind !== 'one') return; const dx = e.clientX - g0.x, dy = e.clientY - g0.y; if (Math.hypot(dx, dy) > 9) g0.moved = true;
    if (z > 1.02) { tx = g0.tx + dx; ty = g0.ty + dy; view(); return; }
    if (g0.moved) { let x = dx; const can = p => p >= 1 && p <= N, toNext = dx * sgn() < 0; if (!can(n + (toNext ? 1 : -1))) x = dx / 3; trk.classList.remove('go'); trk.style.transform = `translateX(${x}px)`; g0.dx = dx; } });
  const up = e => { if (!P.has(e.pointerId)) return; P.delete(e.pointerId); if (!g0) return;
    if (g0.kind === 'two') { if (P.size === 0) { if (z < 1.08) { z = 1; tx = 0; ty = 0; } view(true); g0 = null; } else g0 = { kind: 'none' }; return; }
    if (g0.kind !== 'one') { if (!P.size) g0 = null; return; }
    const dt = Date.now() - g0.t, dx = g0.dx, v = Math.abs(dx) / Math.max(1, dt);
    if (g0.moved && z <= 1.02) { const toNext = dx * sgn() < 0, p = n + (toNext ? 1 : -1); if ((Math.abs(dx) > W * .16 || v > .45) && p >= 1 && p <= N) turn(p, dx); else { trk.classList.add('go'); trk.style.transform = ''; } }
    else if (!g0.moved && dt < 350) tap(e.clientX, e.clientY);
    g0 = null; };
  bk.addEventListener('pointerup', up); bk.addEventListener('pointercancel', up);
  async function turn(p, dx) { busy = true; await pageCv(p); const d = p > n ? 1 : -1; trk.classList.add('go'); trk.style.transform = `translateX(${-d * sgn() * (W + GAP)}px)`; await new Promise(r => setTimeout(r, 330)); busy = false; n = p; await build(); o.onPage && o.onPage(n, N); }
  function tap(x, y) { const t = Date.now(), dbl = t - lastTap < 320; lastTap = t; clearTimeout(tapT);
    if (dbl && o.zoom !== false) { const { cx, cy } = center(), px = x - cx, py = y - cy; if (z > 1.05) { z = 1; tx = 0; ty = 0; } else { const nz = 2.5; tx = px - (px - tx) * nz; ty = py - (py - ty) * nz; z = nz; } view(true); lastTap = 0; return; }
    // a link under the finger (on the page as it is seen, closer or not)
    const pz = cur(); if (pz && o.links !== false) { const r = pz.getBoundingClientRect(), lx = (x - r.left) / z, ly = (y - r.top) / z, hit = (links.get(n) || []).find(l => lx >= l.x - 6 && lx <= l.x + l.w + 6 && ly >= l.y - 6 && ly <= l.y + l.h + 6);
      if (hit) { if (hit.page) { go(hit.page, 'fade'); o.onLink && o.onLink({ page: hit.page }); } else o.onLink && o.onLink({ url: hit.url }); return; } }
    tapT = setTimeout(() => { if (z > 1.02) return; const r = bk.getBoundingClientRect(), f = (x - r.left) / r.width; if (f < .14) go(n + (sgn() < 0 ? 1 : -1), 'slide'); else if (f > .86) go(n + (sgn() < 0 ? -1 : 1), 'slide'); else { bk.classList.add('hint'); setTimeout(() => bk.classList.remove('hint'), 1400); } }, 330); }
  bk.addEventListener('wheel', e => { if (!pdf) return; e.preventDefault(); o.onTouch && o.onTouch(); if (e.ctrlKey && o.zoom !== false) { z = Math.max(1, Math.min(5, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); if (z < 1.05) { z = 1; tx = 0; ty = 0; } view(); } else if (z > 1.02) { tx -= e.deltaX; ty -= e.deltaY; view(); } else if (Math.abs(e.deltaY) + Math.abs(e.deltaX) > 30) { clearTimeout(bk.wt); bk.wt = setTimeout(() => go(n + (e.deltaY + e.deltaX > 0 ? 1 : -1), 'slide'), 60); } }, { passive: false });
  const ro = new ResizeObserver(() => { const w = bk.clientWidth, h = bk.clientHeight; if (!w || !h || (w === W && h === H)) return; W = w; H = h; cache.clear(); links.clear(); if (pdf) build(); }); ro.observe(bk); W = bk.clientWidth; H = bk.clientHeight;
  return {
    async load(doc, start = 1) { pdf = doc; N = doc.numPages; n = Math.max(1, Math.min(N, start)); cache.clear(); links.clear(); await build(); o.onPage && o.onPage(n, N); },
    go, fwd: () => go(n + 1, 'slide'), back: () => go(n - 1, 'slide'),
    home() { z = 1; tx = 0; ty = 0; return n === 1 ? (view(true), Promise.resolve()) : go(1, 'fade'); }, unzoom() { z = 1; tx = 0; ty = 0; view(true); },
    get page() { return n; }, get pages() { return N; }, get zoomed() { return z > 1.02; }, el: bk,
    destroy() { ro.disconnect(); gen++; cache.clear(); host.innerHTML = ''; },
  };
}

// a QR code drawn on a canvas (vendor/qrcode.js must be on the page)
export function qr(cv, text, px = 264) { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); const n = q.getModuleCount(), m = 2, g = cv.getContext('2d'), z = px / (n + m * 2); cv.width = cv.height = px; g.fillStyle = '#fff'; g.fillRect(0, 0, px, px); g.fillStyle = '#0E1114'; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) g.fillRect((x + m) * z, (y + m) * z, z + .5, z + .5); return cv; }

// ----- a gallery of pictures read as a book: the same turning, zoom and strip of pages as a PDF. src(n): where picture n is (a local copy or the network)
export function imageDoc(count, src) { const imgs = new Map(), load = n => { if (!imgs.has(n)) imgs.set(n, (async () => { const im = new Image(); im.decoding = 'async'; im.src = await src(n); await im.decode(); return im; })()); return imgs.get(n); };
  return { numPages: count, gallery: true,
    async getPage(n) { const im = await load(n), w = im.naturalWidth || 1, h = im.naturalHeight || 1;
      return { getViewport: ({ scale }) => ({ width: w * scale, height: h * scale, convertToViewportRectangle: r => r }), getAnnotations: async () => [], getTextContent: async () => ({ items: [] }),
        render: ({ canvasContext: g, viewport: v }) => ({ promise: Promise.resolve().then(() => { g.fillStyle = '#fff'; g.fillRect(0, 0, v.width, v.height); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, v.width, v.height); }) }) }; },
    getDestination: async () => null, getPageIndex: async () => 0 }; }

// ----- searching a book: the text of every page, read once, made plain (Arabic letter forms joined to their letters, no marks, no tatweel,
// the alef forms as one), so «الإنجازات» finds «الانجازات». Answers the pages with a few words around the first place found
const plain = t => String(t || '').normalize('NFKC').replace(/[ً-ٰٟۖ-ۭـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase().replace(/\s+/g, ' ');
const texts = new WeakMap();
export async function pagesText(pdf) { if (!texts.has(pdf)) texts.set(pdf, (async () => { const out = []; for (let n = 1; n <= pdf.numPages; n++) { try { const c = await (await pdf.getPage(n)).getTextContent(); out.push(c.items.map(i => i.str).join(' ')); } catch { out.push(''); } } return out; })()); return texts.get(pdf); }
// many PDFs keep Arabic as letter forms in the order they are seen, often split and reversed in pieces: the letters are joined, a word is
// found as written, backwards, or as the same letters in one stretch of the page (any order), which is what those pieces leave
const letters = t => plain(t).replace(/[^\p{L}\p{N}]/gu, '');
const sameLetters = (a, b) => { if (a.length !== b.length) return false; const c = {}; for (const x of a) c[x] = (c[x] || 0) + 1; for (const x of b) { if (!c[x]) return false; c[x]--; } return true; };
export async function search(pdf, q) { const w = letters(q); if (w.length < 2) return []; const all = await pagesText(pdf), hits = [], back = [...w].reverse().join('');
  for (const [i, t] of all.entries()) { const L = letters(t); let at = L.indexOf(w), k = 0;
    for (const v of [w, back]) { let f = 0; while ((f = L.indexOf(v, f)) >= 0) { k++; if (at < 0) at = f; f += v.length; } }
    if (!k && w.length >= 3) for (let x = 0; x + w.length <= L.length; x++) if (sameLetters(L.slice(x, x + w.length), w)) { k++; if (at < 0) at = x; x += w.length - 1; }
    if (!k) continue; const words = plain(t).replace(/\s{2,}/g, ' ').trim(), toks = words.split(' '), torn = toks.filter(x => x.length === 1).length > toks.length * .4;   // letters kept apart: no words to quote
    hits.push({ page: i + 1, count: k, around: torn ? '' : words.length > 90 ? words.slice(0, 90) + '…' : words }); } return hits; }
