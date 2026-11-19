// The event document: everything a ceremony needs as data (no code). The studio edits it, the screens and the engine read it.
// One document per version of an event; a published version is frozen.
//
// event = {
//   id, name, lang: 'ar', date, timezone,
//   identity: { before: { logo, mark, colors: { bg, ink, accent }, fonts: { title, text } }, after: { ... } | null },
//   people: { <id>: { name, honorific, role?, photo? } },
//   media:  { <id>: { kind: 'video' | 'image' | 'slides', src, preview?, length?, count? } },
//   cues:   [ { id, type, title, at, moderator: [..], dur, person?, media?, after?, fixed?, off? } ],
//   transition: 'fade' | 'rise' | 'zoom' | 'wipe'   (how a scene replaces another on the screens)
//   the launch cue: style ('video' | 'countdown' | 'light' | 'curtain'), count (seconds of the countdown), text (a name revealed),
//                   hands (how many guests press together, each on a device of their own)
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
  launch:  { label: 'لحظة التدشين',     needs: [],          fields: [], once: true },
  logo:    { label: 'الشعار ثابتاً',    needs: [],          fields: [] },
  qr:      { label: 'رمز QR',           needs: ['url'],     fields: ['url', 'text'] },
  exit:    { label: 'الختام',           needs: [],          fields: [] },
};
// the ways a launch is shown: a video the organisation uploads, or a reveal the screens draw themselves in the organisation's identity
export const LAUNCH = { video: 'فيديو كشف مرفوع', countdown: 'عدّ تنازلي ثم كشف', light: 'انبثاق الضوء', curtain: 'انفتاح الستار', ribbon: 'قص الشريط', rays: 'أشعة الذهب', pulse: 'نبض يتسارع', dust: 'غبار الذهب يجتمع' };
// how the guest of honour launches, on the device in front of him
export const GESTURES = { hold: 'ضغطة مطوّلة', swipe: 'سحب للتدشين', tap: 'ضغطة واحدة' };
export const gestureOf = ev => { const c = (ev.cues || []).find(c => c.type === 'launch'); return handsOf(ev) > 1 ? 'hold' : (c && GESTURES[c.gesture] ? c.gesture : 'hold'); };   // several hands always hold together
// what moves quietly behind the scenes of text, and how a title or a name arrives
// the typeface of the screens: the default (Cairo) or one of the bundled Arabic families (fonts/brand.css); `seen` are the names a website may call it
export const FONTS = { cairo: { label: 'القاهرة (الافتراضي)', css: 'Kufi', seen: ['cairo'] }, tajawal: { label: 'تجوال', css: "'Tajawal'", seen: ['tajawal'] }, almarai: { label: 'المراعي', css: "'Almarai'", seen: ['almarai'] },
  plex: { label: 'آي بي إم بلكس', css: "'IBM Plex Sans Arabic'", seen: ['ibm plex sans arabic', 'ibm plex arabic', 'ibmplexsansarabic'] }, kufi: { label: 'نوتو كوفي', css: "'Noto Kufi Arabic'", seen: ['noto kufi arabic', 'droid arabic kufi', 'kufi'] },
  amiri: { label: 'أميري', css: "'Amiri'", seen: ['amiri', 'scheherazade', 'traditional arabic', 'naskh'] }, readex: { label: 'ريدكس', css: "'Readex Pro'", seen: ['readex pro', 'readex', 'lexend'] }, messiri: { label: 'المسيري', css: "'El Messiri'", seen: ['el messiri', 'elmessiri'] } };
export const fontCss = I => ((I && FONTS[I.font]) || FONTS.cairo).css + ',Kufi,sans-serif';
export const AMBIENT = { none: 'ساكنة', glow: 'ضوء هادئ', lines: 'خطوط هندسية', dust: 'ذرّات متصاعدة' };
export const TEXTIN = { fade: 'دفعة واحدة', words: 'كلمة كلمة', rise: 'صعود الأسطر' };
export const PULSE = [0, 1, 1.8, 2.4, 2.9, 3.3, 3.6];   // the beats of the «pulse» reveal: closer and closer, then the strike at 4
export const TRANSITIONS = { fade: 'تلاشٍ هادئ', rise: 'صعود', zoom: 'اقتراب', wipe: 'ستار ذهبي', blur: 'انقشاع', iris: 'عدسة' };
export const launchStyle = c => (c && LAUNCH[c.style] ? c.style : 'video');
export const handsOf = ev => { const c = (ev.cues || []).find(c => c.type === 'launch'); return Math.max(1, Math.min(6, Math.round(+(c && c.hands) || 1))); };
// seconds from the press to the moment the new identity is seen, and to the end of the launch
export function launchTimes(ev) { const c = (ev.cues || []).find(c => c.type === 'launch'), st = launchStyle(c), n = Math.max(3, Math.min(30, Math.round(+(c && c.count) || 10)));
  if (st === 'video') { const m = c && c.media && ev.media ? ev.media[c.media] : null; return { reveal: 0, end: (m && m.length) || 25 }; }
  return st === 'countdown' ? { reveal: n, end: n + 7, count: n } : st === 'light' ? { reveal: 3, end: 10 } : st === 'ribbon' ? { reveal: 2.2, end: 9 } : st === 'rays' ? { reveal: 3, end: 10 } : st === 'pulse' ? { reveal: 4, end: 11, beats: PULSE } : st === 'dust' ? { reveal: 3.5, end: 10.5 } : { reveal: 1, end: 9 }; }
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
    if (c.type === 'launch' && launchStyle(c) === 'video' && !c.media) out.push(`${where}: ينقصها فيديو الكشف، أو اختر كشفاً ترسمه الشاشات`);
    if (c.mediaTall && (!(ev.media || {})[c.mediaTall] || ev.media[c.mediaTall].kind !== 'video')) out.push(`${where}: نسخة الشاشات الطولية غير موجودة في مكتبة اللقاء`);
    if (c.person && !(ev.people || {})[c.person]) out.push(`${where}: المتحدث غير موجود في قائمة الأشخاص`);
    if (c.media && !(ev.media || {})[c.media]) out.push(`${where}: الملف غير موجود في مكتبة اللقاء`);
    if (c.media && (ev.media || {})[c.media]) { const m = ev.media[c.media], want = c.type === 'slides' ? 'slides' : c.type === 'speaker' ? 'slides' : c.type === 'loop' || c.type === 'video' || c.type === 'launch' ? 'video' : null;
      if (c.type === 'launch' && launchStyle(c) !== 'video') continue;
      if (want && m.kind !== want) out.push(`${where}: نوع الملف لا يناسب المشهد`); }
  }
  for (const t of ['arm', 'launch']) if (cues.filter(c => c.type === t).length > 1) out.push(`لا يتكرر مشهد «${SCENES[t].label}»`);
  const hasArm = cues.some(c => c.type === 'arm'), hasLaunch = cues.some(c => c.type === 'launch');
  if (hasArm !== hasLaunch) out.push('دعوة التدشين ولحظة التدشين تأتيان معاً');
  if (!hasLaunch && cues.some(c => c.after)) out.push('لا توجد لحظة تدشين، فلا تُعلَّم فقرة بالهوية الجديدة');
  if (cues.some(c => c.after) && !(ev.identity && ev.identity.after)) out.push('فقرة معلَّمة بالهوية الجديدة، ولا هوية جديدة في اللقاء');
  const why = orderProblem(ev, cues.map(c => c.id)); if (why) out.push(why);
  return out;
}
// what the server refuses to store at all (a sentence, or '' when the document may be kept): the wrong shape breaks the studio and the hall,
// and an id, a file name or a colour that is not what it claims to be could carry markup into a page
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\/?$/, HEX = /^#[0-9a-fA-F]{6}$/;
export function shape(ev) { const obj = x => x && typeof x === 'object' && !Array.isArray(x);
  if (!obj(ev) || !Array.isArray(ev.cues) || !obj(ev.identity) || !obj(ev.identity.before)) return 'وثيقة اللقاء غير صالحة';
  if (JSON.stringify(ev).length > 600000) return 'وثيقة اللقاء أكبر من الحد (600 كيلوبايت). اختصروا نصوص مدير الجلسة.';
  if (ev.name != null && typeof ev.name !== 'string') return 'اسم اللقاء غير صالح'; if (ev.cues.length > 300) return 'عدد الفقرات أكبر من الحد';
  for (const c of ev.cues) { if (!obj(c) || !KEY.test(c.id || '') || typeof c.type !== 'string') return 'في اللقاء فقرة غير صالحة'; if (c.moderator != null && !(Array.isArray(c.moderator) && c.moderator.every(l => typeof l === 'string'))) return 'نص مدير الجلسة غير صالح'; for (const k of ['person', 'media', 'mediaTall']) if (c[k] != null && c[k] !== '' && !KEY.test(c[k])) return 'في اللقاء فقرة غير صالحة'; for (const k of ['title', 'text', 'at', 'url']) if (c[k] != null && typeof c[k] !== 'string') return 'في اللقاء فقرة غير صالحة'; }
  for (const [n, o] of [['people', ev.people], ['media', ev.media]]) { if (o == null) continue; if (!obj(o)) return 'وثيقة اللقاء غير صالحة'; for (const [k, v] of Object.entries(o)) { if (!KEY.test(k) || !obj(v)) return n === 'people' ? 'في الأشخاص سجل غير صالح' : 'في الملفات سجل غير صالح'; if (n === 'media' && (!FILE.test(v.src || '') || !['video', 'image', 'slides'].includes(v.kind))) return 'في الملفات سجل غير صالح'; } }
  for (const k of ['before', 'after']) { const I = ev.identity[k]; if (I == null) continue; if (!obj(I)) return 'هوية اللقاء غير صالحة'; if (I.logo && !FILE.test(I.logo)) return 'شعار الهوية غير صالح'; if (I.colors != null) { if (!obj(I.colors)) return 'ألوان الهوية غير صالحة'; for (const v of Object.values(I.colors)) if (v && !HEX.test(v)) return 'ألوان الهوية غير صالحة'; } }
  return ''; }
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
