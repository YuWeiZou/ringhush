/**
 * Score data for the four BGM loops. Written to bgm-scores.json.
 * All entrances sit on the same 8th-note grid; no humanized offsets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function addNote(events, midi, beat, beats, vel = 0.5) {
  events.push({ midi, beat, beats, vel });
}
function chord(events, midis, beat, beats, vel = 0.3) {
  for (const midi of midis) addNote(events, midi, beat, beats, vel);
}
function arp(events, midis, beat, step, beats, vel = 0.2) {
  midis.forEach((midi, i) => addNote(events, midi, beat + i * step, beats, vel));
}

const scores = {
  menu: {
    title: '主大厅 · 余烬',
    bpm: 48,
    beats: 32,
    events: [],
  },
  room: {
    title: '房间 · 未寄出的信',
    bpm: 60,
    beats: 32,
    events: [],
  },
  replay: {
    title: '回放 · 无人归来',
    bpm: 52,
    beats: 32,
    events: [],
  },
  settings: {
    title: '设置 · 雪停之后',
    bpm: 40,
    beats: 32,
    events: [],
  },
};

// ---- 主大厅：A 小调；低音抬到 A2/E3，避免次低频泥团 ----
{
  const e = scores.menu.events;
  const chords = [
    [45, 52, 57, 60, 64, 71], // Am(add9)
    [41, 48, 53, 57, 60, 67], // Fmaj7
    [50, 57, 62, 65, 69, 76], // Dm9
    [40, 47, 52, 57, 62, 67], // E7sus
  ];
  for (let b = 0; b < 8; b++) {
    const beat = b * 4;
    chord(e, chords[b % 4].slice(0, 3), beat, 4.3, b < 4 ? 0.23 : 0.2);
    chord(e, chords[b % 4].slice(3), beat, 3.9, 0.15);
  }
  // Melody on beats 0 / 2 / 3, same grid as harmony.
  const melody = [
    [76, 72, 71], // E5 C5 B4 over Am
    [69, 72, 76], // A4 C5 E5 over F
    [77, 76, 74], // F5 E5 D5 over Dm
    [74, 71, 67], // D5 B4 G4 over E7sus
    [76, 72, 69],
    [69, 72, 76],
    [77, 76, 72],
    [71, 69, 67],
  ];
  for (let b = 0; b < 8; b++) {
    const beat = b * 4;
    const m = melody[b];
    addNote(e, m[0], beat, 1.8, 0.25);
    addNote(e, m[1], beat + 2, 1.4, 0.2);
    addNote(e, m[2], beat + 3, 1.2, 0.17);
  }
}

// ---- 房间：D 大调；轻、天真、Asus4/Bm 带一点不安 ----
{
  const e = scores.room.events;
  const bars = [
    { bass: 38, arp: [38, 45, 50, 54, 57, 64], mel: [78, 76, 74] }, // Dadd9
    { bass: 47, arp: [47, 54, 59, 62, 66, 69], mel: [71, 74, 78] }, // Bm7
    { bass: 43, arp: [43, 50, 55, 59, 62, 66], mel: [79, 78, 74] }, // Gmaj7
    { bass: 45, arp: [45, 52, 57, 62, 64, 69], mel: [76, 74, 71] }, // Asus4
  ];
  for (let b = 0; b < 8; b++) {
    const bar = bars[b % 4];
    const beat = b * 4;
    addNote(e, bar.bass, beat, 4.2, 0.18);
    arp(e, bar.arp, beat, 0.5, 1.4, 0.13);
    addNote(e, bar.mel[0], beat, 1.6, 0.25);
    addNote(e, bar.mel[1], beat + 2, 1.2, 0.2);
    addNote(e, bar.mel[2], beat + 3, 1.2, 0.17);
  }
}

// ---- 回放：统一 8 分网格；旋律成为琶音的最高声部 ----
{
  const e = scores.replay.events;
  const bars = [
    { chord: [45, 52, 57, 60, 64], mel: [76, 72, 69] }, // Am
    { chord: [41, 48, 53, 57, 60], mel: [72, 69, 65] }, // Fmaj7
    { chord: [38, 45, 50, 53, 57], mel: [74, 69, 65] }, // Dm7
    { chord: [40, 47, 52, 57, 62], mel: [71, 69, 67] }, // E7sus
    { chord: [41, 48, 53, 57, 60], mel: [69, 72, 76] }, // Fmaj7
    { chord: [36, 43, 48, 52, 55], mel: [76, 72, 67] }, // Cmaj7
    { chord: [43, 50, 55, 59, 64], mel: [74, 71, 67] }, // G6
    { chord: [40, 47, 52, 57, 62], mel: [71, 69, 67] }, // E7sus -> loop
  ];
  for (let b = 0; b < 8; b++) {
    const bar = bars[b];
    const beat = b * 4;
    addNote(e, bar.chord[0], beat, 4.1, 0.18);
    // Broken chord on the 8th grid: root, fifth, octave, third, fifth, octave.
    const c = bar.chord;
    const pattern = [c[0], c[2], c[3], c[1], c[2], c[4], c[3], c[1]];
    arp(e, pattern, beat, 0.5, 1.2, 0.11);
    // Melody attacks are also on the grid; top voice, not a separate phrase.
    addNote(e, bar.mel[0], beat, 1.7, 0.26);
    addNote(e, bar.mel[1], beat + 2, 1.3, 0.2);
    addNote(e, bar.mel[2], beat + 3, 1.2, 0.17);
  }
}

// ---- 设置：只有低频；D2/A2/D3，干净，不用次低频 ----
{
  const e = scores.settings.events;
  const bars = [
    [38, 45, 50], // Dm
    [46, 53, 58], // Bb (Bb2/F3/Bb3; no Bb1)
    [43, 50, 55], // Gm
    [45, 52, 57], // A
  ];
  for (let b = 0; b < 8; b++) {
    const beat = b * 4;
    chord(e, bars[b % 4], beat, 4.8, 0.14);
  }
  // A few low inner-voice movements; no high register at all.
  addNote(e, 41, 5.0, 3.0, 0.08);
  addNote(e, 48, 13.0, 3.0, 0.07);
  addNote(e, 43, 21.0, 3.0, 0.07);
  addNote(e, 50, 29.0, 3.0, 0.07);
}

fs.writeFileSync(path.join(HERE, 'bgm-scores.json'), JSON.stringify(scores, null, 2), 'utf8');
console.log('wrote bgm-scores.json');
