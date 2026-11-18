// The event document: everything a ceremony needs as data (no code). The studio edits it, the screens and the engine read it.
// One document per version of an event; a published version is frozen.
//
// event = {
//   id, name, lang: 'ar', date, timezone,
//   identity: { before: { logo, mark, colors: { bg, ink, accent }, fonts: { title, text } }, after: { ... } | null },
//   people: { <id>: { name, honorific, role?, photo? } },
//   media:  { <id>: { kind: 'video' | 'image' | 'slides', src, preview?, length?, count? } },
//   cues:   [ { id, type, title, at, moderator: [..], dur, person?, media?, after?, fixed?, off? } ],
// }
// «after» marks a cue that carries the identity revealed by the launch: it can never be played before the launch.
export const SCENES = {
  loop:    { label: 'الاستقبال',        needs: [],          fields: ['media'] },
  title:   { label: 'شاشة افتتاح',      needs: ['text'],    fields: ['text', 'person'] },
  speaker: { label: 'بطاقة متحدث',      needs: ['person'],  fields: ['person', 'media'] },       // media: optional slides of the speaker
  video:   { label: 'فيديو',            needs: ['media'],   fields: ['media'], pausable: true },
  slides:  { label: 'عرض شرائح',        needs: ['media'],   fields: ['media', 'person'] },
  web:     { label: 'صفحة حية',         needs: ['url'],     fields: ['url'] },
  arm:     { label: 'دعوة التدشين',     needs: [],          fields: ['person'], once: true },
  launch:  { label: 'لحظة التدشين',     needs: ['media'],   fields: ['media'], once: true },
  logo:    { label: 'الشعار ثابتاً',    needs: [],          fields: [] },
  qr:      { label: 'رمز QR',           needs: ['url'],     fields: ['url', 'text'] },
  exit:    { label: 'الختام',           needs: [],          fields: [] },
};
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

// problems of an event document, as sentences for the studio ([] when it can be published)
export function problems(ev) {
  const out = [], cues = ev.cues || [], ids = new Set();
  if (!ev.name || !String(ev.name).trim()) out.push('اسم اللقاء مطلوب');
  if (!cues.length) out.push('أضف فقرة واحدة على الأقل');
  for (const c of cues) {
    const where = `«${c.title || c.id}»`;
    if (!ID.test(c.id || '')) out.push(`معرّف الفقرة ${where} غير صالح`);
    if (ids.has(c.id)) out.push(`معرّف مكرر: ${c.id}`); ids.add(c.id);
    const sc = SCENES[c.type]; if (!sc) { out.push(`نوع المشهد غير معروف في ${where}`); continue; }
    if (!c.title) out.push('فقرة بلا عنوان');
    for (const f of sc.needs) if (!c[f]) out.push(`${where}: ينقصها ${({ person: 'المتحدث', media: 'الملف', text: 'النص', url: 'الرابط' })[f]}`);
    if (c.person && !(ev.people || {})[c.person]) out.push(`${where}: المتحدث غير موجود في قائمة الأشخاص`);
    if (c.media && !(ev.media || {})[c.media]) out.push(`${where}: الملف غير موجود في مكتبة اللقاء`);
    if (c.media && (ev.media || {})[c.media]) { const m = ev.media[c.media], want = c.type === 'slides' ? 'slides' : c.type === 'speaker' ? 'slides' : c.type === 'loop' || c.type === 'video' || c.type === 'launch' ? 'video' : null;
      if (want && m.kind !== want) out.push(`${where}: نوع الملف لا يناسب المشهد`); }
  }
  for (const t of ['arm', 'launch']) if (cues.filter(c => c.type === t).length > 1) out.push(`لا يتكرر مشهد «${SCENES[t].label}»`);
  const hasArm = cues.some(c => c.type === 'arm'), hasLaunch = cues.some(c => c.type === 'launch');
  if (hasArm !== hasLaunch) out.push('دعوة التدشين ولحظة التدشين تأتيان معاً');
  if (!hasLaunch && cues.some(c => c.after)) out.push('لا توجد لحظة تدشين، فلا تُعلَّم فقرة بالهوية الجديدة');
  if (hasLaunch && !(ev.identity && ev.identity.after)) out.push('لقاء فيه تدشين يحتاج الهوية الجديدة');
  const why = orderProblem(ev, cues.map(c => c.id)); if (why) out.push(why);
  return out;
}
export const cueOf = (ev, id) => (ev.cues || []).find(c => c.id === id);
export const armOf = ev => ((ev.cues || []).find(c => c.type === 'arm') || {}).id || null;
export const launchOf = ev => ((ev.cues || []).find(c => c.type === 'launch') || {}).id || null;
// why a running order cannot be used ('' when it can)
export function orderProblem(ev, v) {
  const fixed = (ev.cues || []).filter(c => c.fixed).map(c => c.id);
  if (fixed.length && v[0] !== fixed[0]) return `«${cueOf(ev, fixed[0]).title}» تبقى أول فقرة`;
  const a = armOf(ev), l = launchOf(ev);
  if (a && l && v.indexOf(l) !== v.indexOf(a) + 1) return 'لحظة التدشين تأتي بعد الدعوة مباشرة';
  if (l) { const bad = (ev.cues || []).find(c => c.after && v.indexOf(c.id) < v.indexOf(l)); if (bad) return `«${bad.title}» تحمل الهوية الجديدة، فلا تُعرض قبل التدشين`; }
  return '';
}
