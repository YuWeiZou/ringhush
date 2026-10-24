/**
 * 《终于田园牧歌》 — second soundtrack.
 *
 * Original procedural score, no external samples. The palette is dark
 * orchestral / industrial / modal: low strings, choir, taiko, metal, sub-bass,
 * and a night-dam battle pulse. It does not reuse any existing melody.
 *
 * Run: node tools/render-songbook.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lamejs from '@breezystack/lamejs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'tools', 'generated-songbook');
const SR = 44100;

let seed = 0x51a7c0de;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
const TAU = Math.PI * 2;

function env(t, dur, attack, release) {
  if (t < 0 || t > dur) return 0;
  if (t < attack) return t / Math.max(0.0001, attack);
  if (t > dur - release) return Math.max(0, (dur - t) / Math.max(0.0001, release));
  return 1;
}

function panGain(pan) {
  const p = Math.max(-1, Math.min(1, pan));
  return [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];
}

function sine(phase) { return Math.sin(TAU * phase); }
function saw(phase) { return 2 * (phase - Math.floor(phase + 0.5)); }
function tri(phase) { return 1 - 4 * Math.abs(Math.round(phase) - phase); }

function addTone(L, R, {
  midi, start, dur, amp = 0.1, wave = 'sine', attack = 0.02, release = 0.3,
  pan = 0, vibrato = 0, detune = 0, harmonics = null,
}) {
  const n0 = Math.floor(start * SR);
  const n1 = Math.min(L.length, Math.floor((start + dur) * SR));
  if (n1 <= n0) return;
  const f = freq(midi) * 2 ** (detune / 1200);
  const [gl, gr] = panGain(pan);
  let phase = 0;
  for (let i = n0; i < n1; i++) {
    const t = (i - n0) / SR;
    const e = env(t, dur, attack, release);
    if (e <= 0) continue;
    const vib = vibrato ? 1 + vibrato * Math.sin(TAU * 5.1 * t) : 1;
    phase += (f * vib) / SR;
    let s = 0;
    if (harmonics) {
      for (let h = 0; h < harmonics.length; h++) s += sine(phase * (h + 1)) * harmonics[h];
    } else if (wave === 'saw') s = saw(phase);
    else if (wave === 'tri') s = tri(phase);
    else s = sine(phase);
    const g = amp * e;
    L[i] += s * g * gl;
    R[i] += s * g * gr;
  }
}

function addString(L, R, midi, start, dur, amp, pan, { attack = 0.7, release = 1.2, detune = 7 } = {}) {
  addTone(L, R, { midi, start, dur, amp: amp * 0.55, wave: 'saw', attack, release, pan, vibrato: 0.003, detune: -detune });
  addTone(L, R, { midi, start, dur, amp: amp * 0.45, wave: 'saw', attack, release, pan: -pan * 0.4, vibrato: 0.004, detune });
}

function addChoir(L, R, midi, start, dur, amp, pan) {
  addTone(L, R, { midi, start, dur, amp, attack: 1.2, release: 1.8, pan, vibrato: 0.005, harmonics: [1, 0.35, 0.18, 0.08] });
  addTone(L, R, { midi: midi + 12, start, dur, amp: amp * 0.18, attack: 1.4, release: 2, pan: -pan, vibrato: 0.006, harmonics: [1, 0.2, 0.1] });
}

function addBass(L, R, midi, start, dur, amp = 0.18) {
  addTone(L, R, { midi, start, dur, amp, wave: 'sine', attack: 0.01, release: 0.25, pan: 0 });
  addTone(L, R, { midi: midi - 12, start, dur, amp: amp * 0.35, wave: 'sine', attack: 0.01, release: 0.3, pan: 0 });
  addTone(L, R, { midi, start, dur: Math.min(dur, 0.4), amp: amp * 0.12, wave: 'saw', attack: 0.005, release: 0.2, pan: -0.15 });
}

function addBell(L, R, midi, start, amp = 0.08, pan = 0) {
  addTone(L, R, { midi, start, dur: 2.8, amp, attack: 0.004, release: 2.4, pan, harmonics: [1, 0.5, 0.22, 0.1, 0.04] });
  addTone(L, R, { midi: midi + 12, start, dur: 1.4, amp: amp * 0.3, attack: 0.002, release: 1.1, pan: -pan * 0.6, harmonics: [1, 0.2] });
}

function addKick(L, R, start, amp = 0.3, pan = 0) {
  const n0 = Math.floor(start * SR);
  const n1 = Math.min(L.length, n0 + Math.floor(0.5 * SR));
  const [gl, gr] = panGain(pan);
  let phase = 0;
  for (let i = n0; i < n1; i++) {
    const t = (i - n0) / SR;
    const f = 82 * Math.exp(-t * 7) + 38;
    phase += f / SR;
    const e = Math.exp(-t * 8);
    const click = t < 0.012 ? (rnd() * 2 - 1) * 0.5 * (1 - t / 0.012) : 0;
    const s = sine(phase) * e * 0.9 + click;
    L[i] += s * amp * gl;
    R[i] += s * amp * gr;
  }
}

function addTaiko(L, R, start, amp = 0.4, pan = 0) {
  addKick(L, R, start, amp * 0.85, pan);
  const n0 = Math.floor(start * SR);
  const n1 = Math.min(L.length, n0 + Math.floor(0.7 * SR));
  const [gl, gr] = panGain(pan);
  let phase = 0;
  let lp = 0;
  for (let i = n0; i < n1; i++) {
    const t = (i - n0) / SR;
    const f = 145 * Math.exp(-t * 5) + 55;
    phase += f / SR;
    const e = Math.exp(-t * 5.5);
    const n = rnd() * 2 - 1;
    lp = lp * 0.75 + n * 0.25;
    const s = sine(phase) * e * 0.8 + lp * e * 0.28;
    L[i] += s * amp * gl;
    R[i] += s * amp * gr;
  }
}

function addMetal(L, R, start, amp = 0.12, pan = 0) {
  const n0 = Math.floor(start * SR);
  const n1 = Math.min(L.length, n0 + Math.floor(0.35 * SR));
  const [gl, gr] = panGain(pan);
  let lp = 0;
  for (let i = n0; i < n1; i++) {
    const t = (i - n0) / SR;
    const e = Math.exp(-t * 22);
    const n = rnd() * 2 - 1;
    lp = lp * 0.35 + n * 0.65;
    const s = (n - lp) * e;
    L[i] += s * amp * gl;
    R[i] += s * amp * gr;
  }
}

function addNoise(L, R, start, dur, amp = 0.04, pan = 0) {
  const n0 = Math.floor(start * SR);
  const n1 = Math.min(L.length, Math.floor((start + dur) * SR));
  const [gl, gr] = panGain(pan);
  let lp = 0;
  for (let i = n0; i < n1; i++) {
    const t = (i - n0) / SR;
    const e = env(t, dur, 0.8, 0.8);
    if (e <= 0) continue;
    const n = rnd() * 2 - 1;
    lp = lp * 0.94 + n * 0.06;
    const s = lp * e;
    L[i] += s * amp * gl;
    R[i] += s * amp * gr;
  }
}

function addDelay(L, R) {
  const d1 = Math.floor(0.137 * SR);
  const d2 = Math.floor(0.211 * SR);
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < L.length; i++) {
    const a = i >= d1 ? outL[i - d1] : 0;
    const b = i >= d2 ? outR[i - d2] : 0;
    lpL = lpL * 0.72 + a * 0.28;
    lpR = lpR * 0.72 + b * 0.28;
    outL[i] = L[i] + lpR * 0.23;
    outR[i] = R[i] + lpL * 0.23;
  }
  for (let i = 0; i < L.length; i++) {
    L[i] = outL[i];
    R[i] = outR[i];
  }
}

function foldTail(L, R, loopSamples, tailSamples) {
  const outL = new Float32Array(loopSamples);
  const outR = new Float32Array(loopSamples);
  for (let i = 0; i < L.length; i++) {
    const j = i % loopSamples;
    outL[j] += L[i];
    outR[j] += R[i];
  }
  return { L: outL, R: outR };
}

function normalize(L, R, target = 0.86) {
  let peak = 1e-9;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = target / peak;
  for (let i = 0; i < L.length; i++) {
    L[i] = Math.max(-1, Math.min(1, L[i] * g));
    R[i] = Math.max(-1, Math.min(1, R[i] * g));
  }
}

function encodeMp3(L, R) {
  const enc = new lamejs.Mp3Encoder(2, SR, 192);
  const block = 1152;
  const chunks = [];
  for (let i = 0; i < L.length; i += block) {
    const n = Math.min(block, L.length - i);
    const l = new Int16Array(n);
    const r = new Int16Array(n);
    for (let j = 0; j < n; j++) {
      l[j] = Math.max(-32768, Math.min(32767, Math.round(L[i + j] * 32767)));
      r[j] = Math.max(-32768, Math.min(32767, Math.round(R[i + j] * 32767)));
    }
    const buf = enc.encodeBuffer(l, r);
    if (buf.length) chunks.push(Buffer.from(buf));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end));
  return Buffer.concat(chunks);
}

const chord = (root, type = 'min') => {
  const third = type === 'min' ? 3 : 4;
  return [root, root + third, root + 7, root + 12];
};

const TRACKS = [
  {
    id: 'menu',
    title: '坝下长夜 · 序',
    bpm: 58,
    beats: 64,
    chords: [[50, 'min'], [46, 'maj'], [43, 'maj'], [48, 'min']],
    melody: [[0, 74, 4], [4, 72, 3], [8, 70, 5], [16, 69, 4], [20, 72, 4], [24, 74, 6], [32, 67, 6], [40, 70, 5], [48, 74, 8], [56, 72, 4]],
  },
  {
    id: 'room',
    title: '坝下长夜 · 灯下',
    bpm: 62,
    beats: 64,
    chords: [[45, 'min'], [41, 'maj'], [48, 'maj'], [43, 'maj']],
    melody: [[0, 69, 6], [8, 72, 4], [16, 76, 7], [24, 74, 4], [32, 72, 6], [40, 69, 6], [48, 67, 8], [56, 69, 6]],
  },
  {
    id: 'replay',
    title: '坝下长夜 · 余响',
    bpm: 54,
    beats: 56,
    chords: [[49, 'min'], [45, 'maj'], [42, 'maj'], [44, 'maj']],
    melody: [[0, 73, 3], [4, 76, 3], [8, 81, 6], [16, 80, 4], [24, 76, 5], [32, 73, 5], [40, 68, 6], [48, 73, 7]],
  },
  {
    id: 'settings',
    title: '坝下长夜 · 静水',
    bpm: 48,
    beats: 40,
    chords: [[40, 'min'], [38, 'maj'], [43, 'maj'], [45, 'min']],
    melody: [],
  },
  {
    id: 'phase1',
    title: '坝下长夜 · 远野',
    bpm: 72,
    beats: 96,
    chords: [[50, 'min'], [46, 'maj'], [43, 'maj'], [48, 'min']],
    melody: [[0, 74, 4], [8, 77, 4], [16, 79, 6], [24, 77, 4], [32, 74, 5], [40, 72, 5], [48, 70, 6], [56, 74, 8]],
  },
  {
    id: 'phase2',
    title: '坝下长夜 · 夜坝',
    bpm: 84,
    beats: 112,
    chords: [[50, 'min'], [50, 'min'], [46, 'maj'], [49, 'min'], [43, 'maj'], [50, 'min']],
    melody: [[0, 74, 3], [4, 75, 3], [8, 74, 2], [12, 70, 2], [16, 69, 4], [24, 74, 4], [32, 77, 4], [40, 75, 4], [48, 74, 6], [56, 70, 6]],
    battle: 2,
  },
  {
    id: 'phase3',
    title: '坝下长夜 · 决堤',
    bpm: 100,
    beats: 128,
    chords: [[50, 'min'], [49, 'min'], [46, 'maj'], [50, 'min'], [43, 'maj'], [49, 'min']],
    melody: [[0, 74, 2], [4, 77, 2], [8, 75, 2], [12, 74, 2], [16, 70, 3], [24, 74, 3], [32, 79, 3], [40, 77, 3], [48, 75, 3], [56, 74, 4]],
    battle: 3,
  },
];

function renderTrack(def) {
  const loopSamples = Math.ceil((def.beats * 60 * SR) / def.bpm);
  const tailSamples = Math.ceil(3.2 * SR);
  const L = new Float32Array(loopSamples + tailSamples);
  const R = new Float32Array(loopSamples + tailSamples);
  const secPerBeat = 60 / def.bpm;
  const at = (beat) => beat * secPerBeat;
  const chordAt = (beat) => def.chords[Math.floor(beat / (def.beats / def.chords.length)) % def.chords.length];

  // Continuous low drone, with a slowly beating fifth.
  for (let b = 0; b < def.beats; b += 8) {
    const [root] = chordAt(b);
    addTone(L, R, { midi: root - 12, start: at(b), dur: at(8), amp: 0.055, wave: 'sine', attack: 1.2, release: 2.4, pan: 0 });
    addTone(L, R, { midi: root - 5, start: at(b), dur: at(8), amp: 0.025, wave: 'sine', attack: 2, release: 2.4, pan: -0.4 });
  }

  // String/pad bed: every two bars.
  for (let b = 0; b < def.beats; b += 4) {
    const [root] = chordAt(b);
    const notes = chord(root + 12, 'min');
    for (let i = 0; i < notes.length; i++) {
      addString(L, R, notes[i], at(b), at(4.1), def.id === 'settings' ? 0.035 : 0.055, (i - 1.5) * 0.28, { attack: 0.9, release: 1.4 });
    }
  }

  // Choir enters in the second half of the darker tracks.
  if (def.id !== 'replay' && def.id !== 'settings') {
    for (let b = 16; b < def.beats; b += 8) {
      const [root] = chordAt(b);
      addChoir(L, R, root + 12, at(b), at(8), def.battle ? 0.045 : 0.028, -0.2);
      addChoir(L, R, root + 19, at(b + 2), at(6), def.battle ? 0.03 : 0.018, 0.25);
    }
  }

  // Bass ostinato / heartbeat.
  if (def.id === 'phase1' || def.battle) {
    for (let b = 0; b < def.beats; b += 1) {
      if (def.battle === 2 && b % 4 === 3) continue;
      if (def.battle === 3 && b % 8 === 7) continue;
      const [root] = chordAt(b);
      addBass(L, R, root - 12, at(b), secPerBeat * 0.72, def.battle === 3 ? 0.16 : 0.1);
    }
  } else if (def.id === 'menu' || def.id === 'room') {
    for (let b = 0; b < def.beats; b += 8) {
      const [root] = chordAt(b);
      addBass(L, R, root - 12, at(b), at(7), 0.07);
    }
  }

  // Melody / bells. A slow, modal line; bells double the long notes.
  for (const [beat, midi, dur] of def.melody) {
    addBell(L, R, midi, at(beat), def.battle ? 0.055 : 0.07, (midi - 72) / 40);
    addTone(L, R, { midi, start: at(beat), dur: at(dur), amp: 0.07, wave: 'tri', attack: 0.08, release: 1.4, pan: 0.1, vibrato: 0.002 });
    if (def.battle === 3) {
      addString(L, R, midi, at(beat), at(dur), 0.05, -0.2, { attack: 0.15, release: 1.0, detune: 12 });
    }
  }

  // Harmonic stabs for phase 2/3.
  if (def.battle) {
    const step = def.battle === 3 ? 4 : 8;
    for (let b = 0; b < def.beats; b += step) {
      const [root] = chordAt(b);
      const notes = chord(root + 12, 'min');
      for (const n of notes) addTone(L, R, { midi: n, start: at(b), dur: at(1.8), amp: def.battle === 3 ? 0.06 : 0.04, wave: 'saw', attack: 0.02, release: 0.8, pan: (n - 64) / 60, detune: 4 });
      addMetal(L, R, at(b), def.battle === 3 ? 0.07 : 0.04, -0.25);
    }
  }

  // Percussion: heartbeat -> taiko -> full battle.
  if (def.id === 'phase1') {
    for (let b = 0; b < def.beats; b += 4) {
      addKick(L, R, at(b), 0.2, 0);
      addKick(L, R, at(b + 0.5), 0.11, 0);
    }
  }
  if (def.battle === 2) {
    for (let b = 0; b < def.beats; b += 8) {
      addTaiko(L, R, at(b), 0.3, -0.15);
      addTaiko(L, R, at(b + 2.5), 0.22, 0.1);
      addTaiko(L, R, at(b + 4), 0.26, -0.1);
      addMetal(L, R, at(b + 6), 0.055, 0.3);
      addKick(L, R, at(b + 7.5), 0.13, 0);
    }
    addNoise(L, R, 0, at(def.beats), 0.005, -0.3);
  }
  if (def.battle === 3) {
    for (let b = 0; b < def.beats; b += 4) {
      addTaiko(L, R, at(b), 0.34, -0.2);
      addKick(L, R, at(b + 1), 0.16, 0.1);
      addTaiko(L, R, at(b + 2), 0.28, 0.15);
      addMetal(L, R, at(b + 3), 0.08, -0.3);
      addMetal(L, R, at(b + 3.5), 0.045, 0.4);
    }
  }

  // Water/wind texture for the quiet pieces.
  if (def.id === 'settings' || def.id === 'menu' || def.id === 'room') {
    addNoise(L, R, 0, at(def.beats), def.id === 'settings' ? 0.018 : 0.01, -0.5);
    addNoise(L, R, at(def.beats * 0.5), at(def.beats * 0.5), 0.006, 0.4);
  }

  // A final low braam into the loop point for battle tracks.
  if (def.battle) {
    const [root] = chordAt(0);
    addTone(L, R, { midi: root - 12, start: at(def.beats - 4), dur: at(4), amp: 0.18, wave: 'saw', attack: 0.5, release: 1.2, pan: 0 });
    addTone(L, R, { midi: root - 5, start: at(def.beats - 4), dur: at(4), amp: 0.12, wave: 'saw', attack: 0.7, release: 1.2, pan: 0.2 });
  }

  addDelay(L, R);
  const folded = foldTail(L, R, loopSamples, tailSamples);
  normalize(folded.L, folded.R);
  return { L: folded.L, R: folded.R, duration: loopSamples / SR };
}

fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
for (const def of TRACKS) {
  const { L, R, duration } = renderTrack(def);
  const mp3 = encodeMp3(L, R);
  const file = `bgm2-${def.id}.mp3`;
  fs.writeFileSync(path.join(OUT, file), mp3);
  manifest.push({ id: def.id, title: def.title, bpm: def.bpm, duration: Number(duration.toFixed(2)), file: `/audio/playlists/long-night-dam/${file}` });
  console.log(`${file}  ${duration.toFixed(1)}s  ${(mp3.length / 1024 / 1024).toFixed(2)} MB`);
}
fs.writeFileSync(path.join(OUT, 'songbook.json'), JSON.stringify({
  name: '《坝下长夜》',
  engine: 'procedural dark orchestral / industrial',
  generatedAt: new Date().toISOString(),
  tracks: manifest,
}, null, 2));
console.log('done');
