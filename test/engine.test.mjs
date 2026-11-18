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
