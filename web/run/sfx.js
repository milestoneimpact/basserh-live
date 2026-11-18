// The sounds of the hall, made in the browser (no file, no music, no melody): noise shaped by filters, and single struck tones.
// An organisation chooses a family of sound (pack) and which moments sound; the big screen plays them, the studio lets you hear them.
//   play(ac, pack, kind): kind = 'cue' (a scene replaces another), 'card' (a speaker's name), 'slide', 'arm' (the invitation to launch)
//   launch(ac, pack, style, T, el): the sound of a launch the screens draw, placed on the same clock as the picture (el seconds in)
export const PACKS = { none: 'بلا صوت', deep: 'عميق', air: 'هواء', glass: 'بلّوري', drum: 'إيقاع' };
export const MOMENTS = { cue: 'الانتقال بين الفقرات', card: 'ظهور اسم المتحدث', slide: 'تقليب الشرائح', arm: 'دعوة التدشين', launch: 'لحظة التدشين' };
export const soundOf = doc => { const s = (doc && doc.sound) || {}; return { pack: PACKS[s.pack] ? s.pack : 'deep', on: { cue: true, card: true, slide: false, arm: true, launch: true, ...(s.on || {}) } }; };

function kit(ac, t0, vol = .8) { const out = ac.createGain(); out.gain.value = vol; out.connect(ac.destination);
  const env = (g, st, peak, dur, attack) => { g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(peak, st + attack); g.gain.exponentialRampToValueAtTime(0.0001, st + dur); };
  return {
    // a struck or gliding tone: from f0 to f1 over dur
    tone(at, f0, f1, dur, peak, type = 'sine', attack = .012) { if (t0 + at + dur < ac.currentTime) return; const o = ac.createOscillator(), g = ac.createGain(), st = Math.max(ac.currentTime, t0 + at); o.type = type; o.frequency.setValueAtTime(f0, st); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), st + dur); env(g, st, peak, dur, Math.min(attack, dur / 3)); o.connect(g).connect(out); o.start(st); o.stop(st + dur + .05); },
    // noise through a moving filter: breath, whoosh, shimmer, snap. swell: the loudest point, as a share of the length
    noise(at, dur, peak, f0, f1, q = 1, kind = 'bandpass', swell = .5) { if (t0 + at + dur < ac.currentTime) return; const n = ac.createBufferSource(), b = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; n.buffer = b;
      const f = ac.createBiquadFilter(), g = ac.createGain(), st = Math.max(ac.currentTime, t0 + at); f.type = kind; f.Q.value = q; f.frequency.setValueAtTime(f0, st); f.frequency.exponentialRampToValueAtTime(f1, st + dur); env(g, st, peak, dur, Math.max(.01, dur * swell)); n.connect(f).connect(g).connect(out); n.start(st); n.stop(st + dur + .05); },
  }; }
const SET = {
  deep: { cue: k => { k.noise(0, .7, .32, 180, 1400, .8); k.tone(.18, 80, 42, .9, .55); },
    card: k => { k.noise(0, 1.1, .26, 240, 2200, .9, 'bandpass', .75); k.tone(.8, 72, 38, 1.4, .6); },
    slide: k => { k.tone(0, 150, 90, .09, .25); },
    arm: k => { k.tone(0, 46, 52, 3.2, .45, 'sine', 1.6); k.noise(0, 3.2, .1, 120, 420, .7, 'lowpass', .8); },
    strike: [95, 38, 2.4, .9], sweep: [300, 5000], tick: [190, 70] },
  air: { cue: k => { k.noise(0, .8, .3, 1800, 9000, .6, 'highpass', .6); },
    card: k => { k.noise(0, 1.3, .28, 900, 7000, .7, 'bandpass', .8); k.noise(1.0, .9, .14, 7000, 2500, .8); },
    slide: k => { k.noise(0, .14, .16, 5000, 2500, 1.2); },
    arm: k => { k.noise(0, 3.4, .16, 400, 1600, .5, 'bandpass', .85); },
    strike: [140, 60, 1.8, .55], sweep: [1200, 11000], tick: [2400, 1800] },
  glass: { cue: k => { k.noise(0, .5, .16, 6500, 9500, 6); k.tone(.05, 1760, 1740, 1.1, .16); },
    card: k => { k.noise(0, .9, .14, 5000, 10000, 5, 'bandpass', .7); k.tone(.55, 1320, 1310, 1.6, .2); k.tone(.55, 2640, 2630, 1.0, .07); },
    slide: k => { k.tone(0, 2200, 2180, .16, .1); },
    arm: k => { k.noise(0, 3.2, .09, 7000, 9000, 9, 'bandpass', .85); k.tone(0, 660, 664, 3.2, .08, 'sine', 1.8); },
    strike: [880, 870, 2.6, .28], sweep: [4000, 12000], tick: [1500, 1480] },
  drum: { cue: k => { k.tone(0, 130, 48, .5, .8); k.noise(0, .12, .3, 3000, 900, 1); },
    card: k => { k.tone(0, 100, 44, .7, .7); k.tone(.34, 120, 46, .9, .85); k.noise(.34, .16, .3, 2600, 800, 1); },
    slide: k => { k.noise(0, .05, .3, 2400, 1500, 3); },
    arm: k => { for (let i = 0; i < 6; i++) k.tone(i * .55, 70, 44, .4, .3 + i * .06); },
    strike: [110, 36, 2.8, 1], sweep: [200, 3000], tick: [120, 50] },
};
export function play(ac, pack, kind) { const S = SET[pack]; if (!ac || !S || !S[kind]) return; S[kind](kit(ac, ac.currentTime + .02)); }
export function launch(ac, pack, style, T, el = 0) { const S = SET[pack]; if (!ac || !S || el > T.reveal + .5) return; const k = kit(ac, ac.currentTime - el), [f0, f1, dur, vol] = S.strike;
  if (style === 'countdown') for (let i = 0; i < T.count; i++) k.tone(i, S.tick[0], S.tick[1], .28, .5);
  if (T.beats) T.beats.forEach((b, i) => k.tone(b, S.tick[0], S.tick[1], .3, .3 + i * .07));   // the pulse: each beat a little louder
  if (style === 'ribbon') k.noise(1.15, .16, .5, 5000, 1200, 2);   // the cut
  k.noise(Math.max(0, T.reveal - 2.6), Math.min(2.6, T.reveal), .35, S.sweep[0], S.sweep[1], 1.2, 'bandpass', .85);   // the breath that rises to the reveal
  k.tone(T.reveal, f0, f1, dur, vol); k.noise(T.reveal, 1.8, .22, 6000, 900, 1.2, 'bandpass', .05); }
