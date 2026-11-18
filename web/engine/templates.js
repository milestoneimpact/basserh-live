// Ready made events an organisation starts from: the cues of a common kind of event with the moderator's words written,
// the people and files left as blanks to fill. A template is an event document without a name (engine/config.js).
const C = { bg: '#F6F1E6', ink: '#14211E', accent: '#0F5A4E', gold: '#C2A063' };
const IN = { id: 'in', type: 'loop', title: 'الاستقبال', at: 'فتح الأبواب', dur: 15, moderator: [], fixed: true };
const OUT = { id: 'out', type: 'exit', title: 'الختام', at: 'خروج الضيوف', dur: 5, moderator: ['نشكر لكم حضوركم، ونلقاكم على خير.'] };
const OPEN = { id: 'open', type: 'title', title: 'الافتتاح', text: 'بسم الله الرحمن الرحيم', at: 'بسم الله الرحمن الرحيم', dur: 3, moderator: ['بسم الله الرحمن الرحيم. نرحب بكم جميعاً، ونبدأ على بركة الله.'] };
const talk = (id, title, p, at, words, dur = 7) => ({ id, type: 'speaker', title, person: p, at, dur, moderator: words });
const doc = (people, cues, after = null, transition = 'fade') => ({ lang: 'ar', date: '', transition, identity: { before: { logo: '', colors: { ...C } }, after }, people, media: {}, cues: [IN, OPEN, ...cues, OUT] });

export const TEMPLATES = [
  { id: 'blank', name: 'لقاء فارغ', about: 'استقبال وختام فقط، وتبني الباقي فقرة فقرة.', cues: 2, doc: null },
  { id: 'launch', name: 'تدشين هوية أو منصة', about: 'كلمات، فيلم تعريفي، ثم لحظة التدشين بعدّ تنازلي والهوية الجديدة بعدها.', cues: 9,
    doc: doc({ p1: { name: 'اسم راعي اللقاء', honorific: 'الصفة' }, p2: { name: 'اسم المتحدث', honorific: 'الصفة' } }, [
      talk('host', 'كلمة الجهة', 'p2', '…ونبدأ بكلمة الجهة', ['نبدأ بكلمة الجهة، فليتفضل.']),
      { id: 'film', type: 'video', title: 'الفيلم التعريفي', at: '…ونشاهد معاً', dur: 4, moderator: ['شكراً لكم. ونشاهد معاً هذا الفيلم.'] },
      talk('patron', 'كلمة راعي اللقاء', 'p1', '…فليتفضل مشكوراً', ['والآن كلمة راعي اللقاء، فليتفضل مشكوراً.']),
      { id: 'arm', type: 'arm', title: 'دعوة التدشين', person: 'p1', at: '…للتفضل بالتدشين', dur: 1, moderator: ['ندعو راعي اللقاء للتفضل بالتدشين.', '[يضغط الضيف مطوّلاً على الجهاز أمامه]'] },
      { id: 'launch', type: 'launch', title: 'لحظة التدشين', style: 'countdown', count: 10, at: 'ضغط ضيف الشرف', dur: 1, moderator: [] },
      { id: 'new', type: 'logo', title: 'الهوية الجديدة', after: true, at: 'بعد اكتمال الكشف', dur: 3, moderator: ['نبارك لكم هذه الانطلاقة.'] },
    ], { logo: '', colors: { bg: '#0E1114', ink: '#F6F2E8', accent: '#E8D9BD', gold: '#B88A3D' } }, 'rise') },
  { id: 'forum', name: 'ملتقى بمتحدثين وعروض', about: 'ثلاث كلمات بعروضها التقديمية، يقلّبها كل متحدث من جواله.', cues: 7,
    doc: doc({ p1: { name: 'اسم المتحدث الأول', honorific: 'الصفة' }, p2: { name: 'اسم المتحدث الثاني', honorific: 'الصفة' }, p3: { name: 'اسم المتحدث الثالث', honorific: 'الصفة' } }, [
      talk('t1', 'الورقة الأولى', 'p1', '…ونبدأ بالورقة الأولى', ['نبدأ بالورقة الأولى، فليتفضل.'], 15),
      talk('t2', 'الورقة الثانية', 'p2', '…وننتقل إلى الورقة الثانية', ['شكراً لكم. وننتقل إلى الورقة الثانية.'], 15),
      talk('t3', 'الورقة الثالثة', 'p3', '…ونختم بالورقة الثالثة', ['شكراً لكم. ونختم بالورقة الثالثة.'], 15),
      { id: 'qa', type: 'title', title: 'النقاش', text: 'النقاش والمداخلات', at: '…ونفتح باب النقاش', dur: 20, moderator: ['نشكر المتحدثين، ونفتح باب النقاش.'] },
    ]) },
  { id: 'signing', name: 'توقيع اتفاقية', about: 'كلمتا الطرفين، ثم يضغطان معاً فيُعلن الاتفاق على الشاشات.', cues: 8,
    doc: doc({ p1: { name: 'ممثل الطرف الأول', honorific: 'الصفة' }, p2: { name: 'ممثل الطرف الثاني', honorific: 'الصفة' } }, [
      talk('a', 'كلمة الطرف الأول', 'p1', '…ونبدأ بكلمة الطرف الأول', ['نبدأ بكلمة الطرف الأول، فليتفضل.'], 5),
      talk('b', 'كلمة الطرف الثاني', 'p2', '…ثم كلمة الطرف الثاني', ['شكراً لكم. ثم كلمة الطرف الثاني.'], 5),
      { id: 'arm', type: 'arm', title: 'دعوة الإعلان', at: '…لإعلان الاتفاقية', dur: 1, moderator: ['ندعو ممثلَي الطرفين لإعلان الاتفاقية.', '[يضغط الطرفان معاً، كل على جهازه]'] },
      { id: 'launch', type: 'launch', title: 'إعلان الاتفاقية', style: 'light', hands: 2, text: 'اتفاقية شراكة', at: 'ضغط الطرفين معاً', dur: 1, moderator: [] },
      { id: 'photo', type: 'logo', title: 'الصورة التذكارية', at: 'بعد الإعلان', dur: 5, moderator: ['نبارك للطرفين، وندعوكم للصورة التذكارية.'] },
    ]) },
];
