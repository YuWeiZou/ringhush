/**
 * Render the BGM scores with Salamander Grand Piano samples, then encode MP3.
 *
 * Prerequisite: public/audio/piano-samples/*.mp3 (downloaded separately).
 * Run with a local server on :3000: node tools/render-bgm-samples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import lamejs from '@breezystack/lamejs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'tools', 'generated-original');
const scores = JSON.parse(fs.readFileSync(path.join(HERE, 'bgm-scores.json'), 'utf8'));

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });

async function renderTrack(id, score) {
  const b64 = await page.evaluate(async ({ score }) => {
    const SR = 44100;
    const NOTES = [21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108];
    const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
    const nameOf = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1) + 'v8';

    const cache = (globalThis.__pianoSamples ??= new Map());
    async function loadSample(m) {
      if (cache.has(m)) return cache.get(m);
      const res = await fetch(`/audio/piano-samples/${nameOf(m)}.mp3`);
      if (!res.ok) throw new Error(`sample ${m}: ${res.status}`);
      const buf = await res.arrayBuffer();
      const tmp = new OfflineAudioContext(2, 1, SR);
      const decoded = await tmp.decodeAudioData(buf);
      cache.set(m, decoded);
      return decoded;
    }

    function nearest(m) {
      let best = NOTES[0];
      let dist = Math.abs(best - m);
      for (const n of NOTES) {
        const d = Math.abs(n - m);
        if (d < dist) { best = n; dist = d; }
      }
      return best;
    }

    const loopLen = Math.ceil((score.beats * 60) / score.bpm * SR);
    const tail = Math.ceil(3.2 * SR);
    const ctx = new OfflineAudioContext(2, loopLen + tail, SR);

    // A soft, dark hall. Noise impulse with a little early reflection.
    const impulseLen = Math.ceil(2.8 * SR);
    const impulse = ctx.createBuffer(2, impulseLen, SR);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < impulseLen; i++) {
        const t = i / SR;
        const n = Math.random() * 2 - 1;
        lp = lp * 0.82 + n * 0.18;
        const early = i < SR * 0.08 ? (Math.random() * 2 - 1) * 0.35 : 0;
        d[i] = (lp * 0.7 + early) * Math.exp(-t * 2.7) * 0.55;
      }
    }
    const bus = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    dry.gain.value = 0.82;
    wet.gain.value = 0.2;
    bus.connect(dry).connect(ctx.destination);
    bus.connect(conv).connect(wet).connect(ctx.destination);

    for (const ev of score.events) {
      const m = ev.midi;
      const ref = nearest(m);
      const sample = await loadSample(ref);
      const start = Math.max(0, (ev.beat * 60) / score.bpm);
      const hold = Math.min((ev.beats * 60) / score.bpm * 0.97, 7.5);
      const release = Math.max(0.22, Math.min(1.2, 1.4 - m / 120));
      if (start >= loopLen / SR) continue;
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = 2 ** ((m - ref) / 12);
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.55, Math.min(0.55, (m - 60) / 80));
      const amp = Math.min(0.3, 0.055 + ev.vel * 0.32);
      const end = start + hold + release;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(amp, start + 0.006);
      gain.gain.setValueAtTime(amp, start + hold);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      src.connect(gain).connect(pan).connect(bus);
      src.start(start);
      src.stop(end + 0.05);
    }

    const rendered = await ctx.startRendering();
    const L = rendered.getChannelData(0);
    const R = rendered.getChannelData(1);
    const outL = new Float32Array(loopLen);
    const outR = new Float32Array(loopLen);
    for (let i = 0; i < L.length; i++) {
      const j = i % loopLen;
      outL[j] += L[i];
      outR[j] += R[i];
    }
    let peak = 1e-9;
    for (let i = 0; i < loopLen; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
    const g = 0.82 / peak;
    for (let i = 0; i < loopLen; i++) {
      outL[i] = Math.max(-1, Math.min(1, outL[i] * g));
      outR[i] = Math.max(-1, Math.min(1, outR[i] * g));
    }

    const bytes = new Uint8Array(44 + loopLen * 4);
    const dv = new DataView(bytes.buffer);
    const ws = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + loopLen * 4, true); ws(8, 'WAVE');
    ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, 2, true); dv.setUint32(24, SR, true);
    dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, loopLen * 4, true);
    let off = 44;
    for (let i = 0; i < loopLen; i++) {
      dv.setInt16(off, Math.round(outL[i] * 32767), true); off += 2;
      dv.setInt16(off, Math.round(outR[i] * 32767), true); off += 2;
    }
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }, { score });
  return b64;
}

function encodeMp3(wav) {
  const sr = wav.readUInt32LE(24);
  const ch = wav.readUInt16LE(22);
  const bits = wav.readUInt16LE(34);
  if (sr !== 44100 || ch !== 2 || bits !== 16) throw new Error(`unexpected wav ${sr}/${ch}/${bits}`);
  const dataLen = wav.readUInt32LE(40) / 2;
  const enc = new lamejs.Mp3Encoder(2, 44100, 192);
  const block = 1152;
  const chunks = [];
  for (let i = 0; i < dataLen; i += block * 2) {
    const n = Math.min(block, Math.ceil((dataLen - i) / 2));
    const l = new Int16Array(n);
    const r = new Int16Array(n);
    for (let j = 0; j < n; j++) {
      l[j] = wav.readInt16LE(44 + (i + j * 2) * 2);
      r[j] = wav.readInt16LE(44 + (i + j * 2 + 1) * 2);
    }
    const buf = enc.encodeBuffer(l, r);
    if (buf.length) chunks.push(Buffer.from(buf));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end));
  return Buffer.concat(chunks);
}

for (const [id, score] of Object.entries(scores)) {
  const t0 = Date.now();
  const b64 = await renderTrack(id, score);
  const wav = Buffer.from(b64, 'base64');
  const mp3 = encodeMp3(wav);
  fs.writeFileSync(path.join(OUT, `bgm-${id}.wav`), wav);
  fs.writeFileSync(path.join(OUT, `bgm-${id}.mp3`), mp3);
  console.log(`${id}: ${(mp3.length / 1024 / 1024).toFixed(2)}MB · ${Date.now() - t0}ms`);
}

fs.writeFileSync(
  path.join(OUT, 'bgm.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    instrument: 'Salamander Grand Piano (sampled, offline render)',
    tracks: Object.fromEntries(Object.entries(scores).map(([id, s]) => [id, {
      file: `/audio/bgm-${id}.wav`,
      mp3: `/audio/bgm-${id}.mp3`,
      title: s.title,
      bpm: s.bpm,
      duration: Number(((s.beats * 60) / s.bpm).toFixed(2)),
      loop: true,
      instrument: 'piano',
    }])),
  }, null, 2),
  'utf8',
);
await browser.close();
console.log('done');
