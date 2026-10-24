/**
 * Three in-game loops, one per bombing phase.
 * piano + double bass + electric bass + a little violin; 16 bars each.
 * Violin lines are phrases, not single held notes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const add = (track, midi, beat, beats, vel, opts = {}) =>
  track.push({ midi, beat, beats, vel, ...opts });
const chord = (track, midis, beat, beats, vel, opts = {}) => {
  for (const midi of midis) add(track, midi, beat, beats, vel, opts);
};
const arp = (track, midis, beat, step, beats, vel, opts = {}) => {
  midis.forEach((midi, i) => add(track, midi, beat + i * step, beats, vel, opts));
};

const scores = {
  phase1: {
    title: '局内 · 第一阶段 / 远处',
    bpm: 48,
    beats: 64,
    piano: [], bass: [], ebass: [], violin: [],
  },
  phase2: {
    title: '局内 · 第二阶段 / 逼近',
    bpm: 54,
    beats: 64,
    piano: [], bass: [], ebass: [], violin: [],
  },
  phase3: {
    title: '局内 · 第三阶段 / 双区',
    bpm: 60,
    beats: 64,
    piano: [], bass: [], ebass: [], violin: [],
  },
};

/* ------------------------------------------------------------------ */
/* Phase 1: 80s. Distant; long violin phrases; ebass only later.       */
/* ------------------------------------------------------------------ */
{
  const p = scores.phase1.piano;
  const b = scores.phase1.bass;
  const eb = scores.phase1.ebass;
  const v = scores.phase1.violin;
  const chords = [
    [45, 52, 57, 60, 64], // Am
    [41, 48, 53, 57, 60], // Fmaj7
    [38, 45, 50, 53, 57], // Dm
    [40, 47, 52, 57, 62], // E7sus
  ];
  const bassRoots = [33, 41, 38, 40];
  const ebColor = [52, 60, 53, 55]; // chord colour only: E3/C4/F3/G3
  for (let bar = 0; bar < 16; bar++) {
    const beat = bar * 4;
    chord(p, chords[bar % 4], beat, 4.3, bar < 8 ? 0.16 : 0.14);
    add(b, bassRoots[bar % 4], beat, 4.5, 0.14);
    if (bar % 4 === 2) add(b, bassRoots[bar % 4], beat + 2, 2.0, 0.09);
    if (bar >= 4) {
      add(eb, ebColor[bar % 4], beat + 1, 1.6, 0.09);
    }
  }
  const melody = [
    [69, 72, 71], [69, 76, 72], [77, 76, 74], [74, 71, 67],
    [69, 72, 76], [72, 69, 65], [74, 72, 69], [71, 69, 67],
  ];
  for (let bar = 0; bar < 16; bar++) {
    const m = melody[bar % 8];
    const beat = bar * 4;
    add(p, m[0], beat, 1.8, bar < 8 ? 0.24 : 0.2);
    add(p, m[1], beat + 2, 1.3, 0.18);
    add(p, m[2], beat + 3, 1.2, 0.15);
  }
  // Long, connected phrase: A4 C5 B4 E5 D5 B4. Each note fades into the next.
  add(v, 69, 32, 3.0, 0.12, { fadeIn: 2.4, fadeOut: 3.0, vib: true });
  add(v, 72, 35, 3.0, 0.12, { fadeIn: 1.8, fadeOut: 2.6, vib: true });
  add(v, 71, 38, 3.0, 0.11, { fadeIn: 1.8, fadeOut: 2.6, vib: true });
  add(v, 76, 41, 4.0, 0.12, { fadeIn: 2.2, fadeOut: 3.4, vib: true });
  add(v, 74, 45, 3.0, 0.11, { fadeIn: 1.8, fadeOut: 2.8, vib: true });
  add(v, 71, 48, 4.0, 0.1, { fadeIn: 2.2, fadeOut: 3.4, vib: true });
  // A second, shorter long-line: C5 B4 A4.
  add(v, 72, 56, 3.0, 0.1, { fadeIn: 2.2, fadeOut: 2.8, vib: true });
  add(v, 71, 59, 3.0, 0.1, { fadeIn: 1.8, fadeOut: 2.6, vib: true });
  add(v, 69, 62, 2.0, 0.09, { fadeIn: 1.6, fadeOut: 2.4, vib: true });
}

/* ------------------------------------------------------------------ */
/* Phase 2: 71s. Pulse; bass roles separated; medium violin phrases.    */
/* ------------------------------------------------------------------ */
{
  const p = scores.phase2.piano;
  const b = scores.phase2.bass;
  const eb = scores.phase2.ebass;
  const v = scores.phase2.violin;
  const bars = [
    { root: 38, fifth: 45, eb: [53, 60], chord: [38, 45, 50, 53, 57], mel: [74, 72, 69] }, // Dm
    { root: 46, fifth: 53, eb: [62, 69], chord: [46, 53, 58, 62, 65], mel: [72, 70, 65] }, // Bb
    { root: 43, fifth: 50, eb: [58, 65], chord: [43, 50, 55, 58, 62], mel: [74, 70, 67] }, // Gm
    { root: 45, fifth: 52, eb: [61, 67], chord: [45, 52, 57, 61, 64], mel: [73, 69, 64] }, // A7
  ];
  for (let bar = 0; bar < 16; bar++) {
    const d = bars[bar % 4];
    const beat = bar * 4;
    const c = d.chord;
    add(b, d.root, beat, 4.2, 0.17);
    if (bar % 2 === 0) add(b, d.fifth, beat + 2, 1.8, 0.09);
    arp(p, [c[0], c[2], c[3], c[1], c[2], c[4], c[3], c[1]], beat, 0.5, 1.2, 0.09);
    add(p, d.mel[0], beat, 1.6, 0.22);
    add(p, d.mel[1], beat + 2, 1.2, 0.18);
    add(p, d.mel[2], beat + 3, 1.1, 0.15);
    if (bar >= 2) {
      const vel = 0.1 + Math.min(0.05, (bar - 2) * 0.004);
      // Electric bass plays chord colour above the contrabass, not the same pitch.
      add(eb, d.eb[0], beat + 1, 1.0, vel);
      add(eb, d.eb[1], beat + 3, 1.0, vel * 0.85);
    }
  }
  // Medium phrases; no single-note entrance.
  const phrase2 = [
    [77, 76, 74, 69],
    [69, 72, 76, 74],
    [70, 69, 67, 62],
  ];
  for (let k = 0; k < phrase2.length; k++) {
    const start = 16 + k * 16;
    const notes = phrase2[k];
    notes.forEach((midi, i) => {
      add(v, midi, start + i * 2, 2.4, 0.1, {
        fadeIn: 1.5,
        fadeOut: 2.0,
        vib: true,
      });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Phase 3, version 2: electric bass pulse; contrabass long; violin short calls. */
/* ------------------------------------------------------------------ */
{
  const p = scores.phase3.piano;
  const b = scores.phase3.bass;
  const eb = scores.phase3.ebass;
  const v = scores.phase3.violin;
  const bars = [
    { root: 33, eb: [48, 52, 57], chord: [45, 52, 57, 60, 64], mel: [69, 71, 76] }, // Am
    { root: 46, eb: [58, 62, 65], chord: [46, 53, 58, 62, 65], mel: [71, 76, 77] }, // Bb
    { root: 40, eb: [56, 59, 64], chord: [40, 47, 52, 56, 59], mel: [76, 74, 71] }, // E7
    { root: 33, eb: [48, 52, 57], chord: [45, 52, 57, 60, 64], mel: [69, 72, 76] }, // Am
  ];
  for (let bar = 0; bar < 16; bar++) {
    const d = bars[bar % 4];
    const beat = bar * 4;
    const c = d.chord;
    arp(p, [c[0], c[0] + 7, c[0] + 12, c[2], c[0] + 7, c[0] + 12, c[2], c[3]], beat, 0.5, 0.9, 0.1);
    add(p, d.mel[0], beat, 1.4, 0.22);
    add(p, d.mel[1], beat + 2, 1.1, 0.18);
    add(p, d.mel[2], beat + 3, 1.0, 0.15);
    add(b, d.root, beat, 4.2, 0.18);
    // Version 2: electric bass drives the bar.
    for (let k = 0; k < 4; k++) {
      add(eb, d.eb[k % 3], beat + 0.5 + k, 0.8, k === 0 ? 0.17 : 0.12);
    }
  }
  // Version 2: short violin calls.
  const calls = [
    { start: 8, notes: [81, 79, 76] },
    { start: 24, notes: [84, 83, 79] },
    { start: 40, notes: [88, 86, 83] },
    { start: 56, notes: [77, 74, 70] },
  ];
  for (const call of calls) {
    call.notes.forEach((midi, i) => {
      add(v, midi, call.start + i * 1.5, 1.3, 0.1, {
        fadeIn: 0.8,
        fadeOut: 1.2,
        vib: i === 0,
      });
    });
  }
}

fs.writeFileSync(path.join(HERE, 'ingame-scores.json'), JSON.stringify(scores, null, 2), 'utf8');
console.log('wrote ingame-scores.json');
