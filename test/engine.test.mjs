// node --test test/engine.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'fs';
import { problems, orderProblem } from '../web/engine/config.js';
import { initial, reduce, shown, identityNow, pausable } from '../web/engine/state.js';
const ev = JSON.parse(fs.readFileSync(new URL('../tenants/wamy/event.json', import.meta.url)));
const run = (e, s, ...cmds) => cmds.reduce((a, c, k) => reduce(e, a, c, 1e6 + k * 1000, true), s);
const walk = e => { let s = initial(e); const seq = [s.cue]; for (let k = 0; k < 40; k++) { const n = run(e, s, { type: 'next' }); if (n === s) break; s = n; seq.push(s.cue); } return seq; };

test('the first ceremony as data plays in the same order as the hall', () => {
  assert.deepEqual(problems(ev), []);
  assert.deepEqual(walk(ev), ['c1', 'c2', 'c14', 'c4', 'c15', 'c5', 'c7', 'c8', 'c9', 'c13', 'c3', 'c10', 'c11', 'c12']);
});
test('new identity only after the launch; skipping the launch counts as launched', () => {
  let s = run(ev, initial(ev), { type: 'go', id: 'c7' }); assert.equal(identityNow(ev, s), 'before');
  s = run(ev, s, { type: 'next' }); assert.equal(s.armed, true);
  s = reduce(ev, s, { type: 'press' }, 2e6, false); assert.equal(s.cue, 'c9'); assert.equal(identityNow(ev, s), 'after');
  assert.equal(identityNow(ev, run(ev, initial(ev), { type: 'go', id: 'c3' })), 'after');
  assert.equal(reduce(ev, initial(ev), { type: 'press' }, 1, false).cue, 'c1', 'a press before the arming does nothing');
  assert.equal(reduce(ev, initial(ev), { type: 'next' }, 1, false).cue, 'c1', 'no command without an operator link');
});
test('order rules', () => {
  const ids = ev.cues.map(c => c.id), mv = (a, to) => { const v = ids.filter(x => x !== a); v.splice(to, 0, a); return v; };
  assert.match(orderProblem(ev, mv('c3', 2)), /الهوية الجديدة/); assert.match(orderProblem(ev, mv('c9', 3)), /بعد الدعوة/); assert.match(orderProblem(ev, mv('c1', 4)), /أول فقرة/);
  const ok = mv('c5', 2); assert.equal(orderProblem(ev, ok), ''); const s = run(ev, initial(ev), { type: 'order', order: ok }, { type: 'go', id: 'c2' }, { type: 'next' }); assert.equal(s.cue, 'c5');
});
test('taking a cue out and bringing it back', () => {
  let s = run(ev, initial(ev), { type: 'off', id: 'c10', on: true }); assert.ok(!shown(ev, s).includes('c10'));
  s = run(ev, s, { type: 'off', id: 'c9', on: true }); assert.ok(shown(ev, s).includes('c9'), 'the launch cannot be taken out');
  s = run(ev, s, { type: 'off', id: 'c6', on: false }); assert.ok(shown(ev, s).includes('c6'));
});
test('speaker slides: name card, start, hidden slide passed over, last slide holds', () => {
  let s = run(ev, initial(ev), { type: 'go', id: 'c15' }); assert.equal(s.slide, 0);
  s = run(ev, s, { type: 'hide', n: 2, on: true }, { type: 'step', d: 1 }, { type: 'step', d: 1 }); assert.equal(s.slide, 3);
  for (let k = 0; k < 12; k++) s = run(ev, s, { type: 'step', d: 1 }); assert.equal(s.slide, 8);
  assert.equal(run(ev, initial(ev), { type: 'go', id: 'c7' }).slide, 1, 'a slides scene starts on its first slide');
});
test('pause, seek, resume on videos only', () => {
  let s = reduce(ev, initial(ev), { type: 'go', id: 'c5' }, 1000, true); s = reduce(ev, s, { type: 'pause' }, 7000, true); assert.equal(s.paused, 7000);
  s = reduce(ev, s, { type: 'seek', d: 10 }, 8000, true); s = reduce(ev, s, { type: 'resume' }, 9000, true); assert.equal(9000 - s.cueAt, 16000);
  assert.equal(pausable(ev, 'c9'), false); assert.equal(pausable(ev, 'c15'), false);
});
test('a small event without a launch, built from nothing', () => {
  const e = { name: 'ملتقى', people: { a: { name: 'أ. فلان' } }, media: { v: { kind: 'video', src: 'x.mp4' } },
    cues: [{ id: 'in', type: 'loop', title: 'الاستقبال', fixed: true }, { id: 'sp', type: 'speaker', title: 'كلمة', person: 'a' }, { id: 'vid', type: 'video', title: 'فيلم', media: 'v' }, { id: 'out', type: 'exit', title: 'الختام' }] };
  assert.deepEqual(problems(e), []); assert.deepEqual(walk(e), ['in', 'sp', 'vid', 'out']); assert.equal(identityNow(e, run(e, initial(e), { type: 'go', id: 'out' })), 'before');
  assert.ok(problems({ ...e, cues: [...e.cues, { id: 'x', type: 'speaker', title: 'بلا متحدث' }] }).some(p => /المتحدث/.test(p)));
  assert.ok(problems({ ...e, cues: [...e.cues, { id: 'l', type: 'launch', title: 'تدشين', media: 'v' }] }).some(p => /تأتيان معاً/.test(p)));
});

test('the templates of a new event are sound documents', async () => {
  const { TEMPLATES } = await import('../web/engine/templates.js');
  for (const t of TEMPLATES.filter(t => t.doc)) { const p = problems({ ...t.doc, name: 'لقاء' }); assert.ok(p.every(x => /ينقصها الملف/.test(x)), t.id + ': ' + p.join(' | ')); assert.equal(t.doc.cues.length, t.cues, t.id); }
  assert.deepEqual(problems({ ...TEMPLATES.find(t => t.id === 'signing').doc, name: 'توقيع' }), []);
});
test('the interactive stations: a file per station, changed live, back to the first page, put out', async () => {
  const { shape, isStations } = await import('../web/engine/config.js'); const { stationMedia } = await import('../web/engine/state.js');
  const e = { name: 'معرض', mode: 'stations', identity: { before: { logo: '', colors: {} }, after: null }, people: {}, cues: [],
    media: { a: { kind: 'pdf', name: 'أ', src: 'fa.pdf', count: 12 }, b: { kind: 'pdf', name: 'ب', src: 'fb.pdf', count: 4 }, v: { kind: 'video', name: 'v', src: 'v.mp4' }, im: { kind: 'image', name: 'i', src: 'i.jpg' } },
    stations: [{ id: 's1', name: 'الأولى', media: 'a' }, { id: 's2', name: 'الثانية', media: 'b' }] };
  assert.ok(isStations(e)); assert.equal(shape(e), ''); assert.deepEqual(problems(e), []);
  assert.ok(problems({ ...e, stations: [] }).length); assert.ok(problems({ ...e, stations: [{ id: 's1', name: 'x', media: 'im' }] }).some(p => /PDF/.test(p)));
  assert.ok(shape({ ...e, stations: [{ id: '<x>' }] })); assert.ok(shape({ ...e, mode: 'other' }));
  let s = initial(e); assert.equal(stationMedia(e, s, 's1'), 'a');
  s = run(e, s, { type: 'assign', sid: 's1', media: 'b' }); assert.equal(stationMedia(e, s, 's1'), 'b'); assert.equal(stationMedia(e, s, 's2'), 'b');
  assert.equal(run(e, s, { type: 'assign', sid: 's1', media: 'im' }), s, 'a single picture is not a station file (a gallery is)');
  assert.equal(run(e, s, { type: 'assign', sid: 'nope', media: 'a' }), s, 'no such station');
  assert.equal(reduce(e, s, { type: 'assign', sid: 's1', media: 'a' }, 1e7, false), s, 'only the operator');
  s = run(e, s, { type: 'assign', ids: ['s1', 's2'], media: 'a' }); assert.deepEqual(['s1', 's2'].map(x => stationMedia(e, s, x)), ['a', 'a']);
  s = run(e, s, { type: 'assign', ids: ['s1', 's2'], media: null }); assert.deepEqual(['s1', 's2'].map(x => stationMedia(e, s, x)), ['a', 'b'], 'back to their own files');
  s = run(e, s, { type: 'sreset', sid: 's2' }); assert.ok(s.st.s2.reset && !s.st.s1.reset);
  s = run(e, s, { type: 'sdark', sid: 's1', on: true }); assert.equal(s.st.s1.dark, true); s = run(e, s, { type: 'sdark', on: false }); assert.equal(s.st.s1.dark, false);
});
test('a station\'s schedule: the morning file, the evening file, and the operator\'s choice until the schedule turns', async () => {
  const { stationMedia } = await import('../web/engine/state.js'); const { problems: pr, shape: sh } = await import('../web/engine/config.js');
  const day = h => new Date(2026, 10, 22, h, 0, 0).getTime();   // the device's own time (no tz in the document)
  const e = { name: 'x', mode: 'stations', identity: { before: { colors: {} } }, cues: [], media: { a: { kind: 'pdf', src: 'a.pdf' }, b: { kind: 'pdf', src: 'b.pdf' }, g: { kind: 'slides', src: 'g/', count: 3 }, v: { kind: 'video', src: 'v.mp4' } },
    stations: [{ id: 's1', name: 'x', media: 'a', schedule: [{ at: '16:00', media: 'b' }, { at: '10:00', media: 'g' }] }] };
  assert.deepEqual(pr(e), []); assert.equal(sh(e), '');
  assert.equal(stationMedia(e, {}, 's1', day(8)), 'a', 'before the first time: its own file');
  assert.equal(stationMedia(e, {}, 's1', day(11)), 'g'); assert.equal(stationMedia(e, {}, 's1', day(17)), 'b');
  const s = { st: { s1: { media: 'v', at: day(12) } } };
  assert.equal(stationMedia(e, s, 's1', day(13)), 'v', 'the operator\'s choice holds'); assert.equal(stationMedia(e, s, 's1', day(16) + 60000), 'b', 'until the schedule turns');
  assert.ok(pr({ ...e, stations: [{ id: 's1', name: 'x', media: 'a', schedule: [{ at: '25:00', media: 'b' }] }] }).length, 'a time that is not one');
  assert.ok(sh({ ...e, stations: [{ id: 's1', name: 'x', schedule: 'x' }] }));
});
test('the board\'s further control: a screen reloaded, the films\' volume, a message to every screen', () => {
  const e = { name: 'x', mode: 'stations', identity: { before: { colors: {} } }, cues: [], media: { a: { kind: 'pdf', src: 'a.pdf' } }, stations: [{ id: 's1', name: 'x', media: 'a' }, { id: 's2', name: 'y', media: 'a' }] };
  let s = initial(e); s = run(e, s, { type: 'sreload', sid: 's2' }); assert.ok(s.st.s2.reload && !(s.st.s1 || {}).reload); s = run(e, s, { type: 'sreload' }); assert.ok(s.st.s1.reload);
  assert.equal(run(e, s, { type: 'sreload', sid: 'nope' }), s);
  s = run(e, s, { type: 'vol', level: 0.4 }); assert.equal(s.vol, 0.4); s = run(e, s, { type: 'vol', level: 7 }); assert.equal(s.vol, 1);
  s = run(e, s, { type: 'msg', text: '  يُغلق المعرض بعد ربع ساعة ', minutes: 20 }); assert.equal(s.msg.text, 'يُغلق المعرض بعد ربع ساعة'); assert.ok(s.msg.until - s.msg.at === 20 * 60000);
  s = run(e, s, { type: 'msg', text: '' }); assert.equal(s.msg, null);
  assert.equal(reduce(e, s, { type: 'vol', level: 0 }, 1e7, false), s, 'only the operator');
});
