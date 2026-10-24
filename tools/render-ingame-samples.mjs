/**
 * Render the three in-game loops (piano + double bass + a little violin).
 * Requires the sample folders under public/audio/ingame-samples.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import lamejs from '@breezystack/lamejs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public', 'audio');
const scores = JSON.parse(fs.readFileSync(path.join(HERE, 'ingame-scores.json'), 'utf8'));

const NOTE_PC = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
function parseMidi(name) {
  const m = name.match(/^([A-G]s?)(-?\d+)/);
  if (!m) return null;
  return (Number(m[2]) + 1) * 12 + NOTE_PC[m[1]];
}
function listSamples(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.mp3'))
    .map((name) => ({ name, midi: parseMidi(name) }))
    .filter((s) => Number.isInteger(s.midi))
    .sort((a, b) => a.midi - b.midi);
}

const sampleSets = {
  piano: listSamples(path.join(OUT, 'ingame-samples', 'piano')),
  violin: listSamples(path.join(OUT, 'ingame-samples', 'violin')),
  contrabass: listSamples(path.join(OUT, 'ingame-samples', 'contrabass')),
  'bass-electric': listSamples(path.join(OUT, 'ingame-samples', 'bass-electric')),
};
for (const [k, v] of Object.entries(sampleSets)) console.log(k, v.length, v.map((s) => s.midi).join(','));

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });

async function renderTrack(id, score) {
  const b64 = await page.evaluate(async ({ score, sampleSets }) => {
    const SR = 44100;
    const cache = (globalThis.__ingameSamples ??= new Map());

    function nearest(set, midi) {
      let best = set[0];
      let dist = Math.abs(best.midi - midi);
      for (const s of set) {
        const d = Math.abs(s.midi - midi);
        if (d < dist) { best = s; dist = d; }
      }
      return best;
    }
    async function load(inst, refMidi) {
      const set = sampleSets[inst];
      const s = nearest(set, refMidi);
      const key = `${inst}:${s.name}`;
      if (cache.has(key)) return cache.get(key);
      const res = await fetch(`/audio/ingame-samples/${inst === 'contrabass' ? 'contrabass' : inst}/${s.name}`);
      if (!res.ok) throw new Error(`sample ${inst}/${s.name}: ${res.status}`);
      const buf = await res.arrayBuffer();
      const tmp = new OfflineAudioContext(2, 1, SR);
      const decoded = await tmp.decodeAudioData(buf);
      cache.set(key, decoded);
      return decoded;
    }

    const loopLen = Math.ceil((score.beats * 60) / score.bpm * SR);
    const tail = Math.ceil(3.4 * SR);
    const ctx = new OfflineAudioContext(2, loopLen + tail, SR);

    const impulseLen = Math.ceil(3.0 * SR);
    const impulse = ctx.createBuffer(2, impulseLen, SR);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < impulseLen; i++) {
        const t = i / SR;
        lp = lp * 0.84 + (Math.random() * 2 - 1) * 0.16;
        d[i] = lp * Math.exp(-t * 2.5) * 0.5;
      }
    }
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    dry.gain.value = 0.84;
    wet.gain.value = 0.18;
    dry.connect(ctx.destination);
    conv.connect(wet).connect(ctx.destination);

    const events = [
      ...score.piano.map((e) => ({ ...e, inst: 'piano' })),
      ...score.bass.map((e) => ({ ...e, inst: 'contrabass' })),
      ...score.ebass.map((e) => ({ ...e, inst: 'bass-electric' })),
      ...score.violin.map((e) => ({ ...e, inst: 'violin' })),
    ].sort((a, b) => a.beat - b.beat);

    for (const ev of events) {
      const set = sampleSets[ev.inst];
      const ref = nearest(set, ev.midi);
      const sample = await load(ev.inst, ev.midi);
      const start = Math.max(0, (ev.beat * 60) / score.bpm);
      const isViolin = ev.inst === 'violin';
      const isContrabass = ev.inst === 'contrabass';
      const isEbass = ev.inst === 'bass-electric';
      const isString = isViolin || isContrabass || isEbass;
      const isShort = ev.short === true;
      const maxHold = isViolin ? 20 : 10;
      const hold = Math.min((ev.beats * 60) / score.bpm * 0.96, maxHold);
      const fadeIn = isShort ? (ev.fadeIn ?? 0.015) : isViolin ? (ev.fadeIn ?? 3.0) : 0.08;
      const fadeOut = isShort ? (ev.fadeOut ?? 0.16) : isViolin ? (ev.fadeOut ?? 4.0) : 0.8;
      const attack = Math.max(0.005, Math.min(fadeIn, hold * 0.45));
      const release = isShort ? Math.max(0.08, Math.min(fadeOut, 0.3)) : Math.max(0.2, Math.min(fadeOut, Math.max(1.0, hold * 0.35)));
      if (start >= loopLen / SR) continue;
      const rate = 2 ** ((ev.midi - ref.midi) / 12);
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = rate;
      if (isString && !isShort && sample.duration < hold * 0.9 + release) {
        src.loop = true;
        src.loopStart = sample.duration * 0.18;
        src.loopEnd = sample.duration * 0.82;
      }
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const panBase = isViolin ? 0.24 : isContrabass ? -0.24 : isEbass ? -0.12 : 0;
      pan.pan.value = Math.max(-0.65, Math.min(0.65, panBase + (ev.midi - 60) / 220));
      const base = isViolin ? 0.012 : isContrabass ? 0.035 : isEbass ? 0.03 : 0.05;
      const velGain = isViolin ? 0.09 : isContrabass ? 0.26 : isEbass ? 0.24 : 0.32;
      const amp = Math.min(0.28, base + ev.vel * velGain);
      const end = start + hold + release;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(amp, start + attack);
      if (isViolin) {
        gain.gain.linearRampToValueAtTime(amp * 1.08, start + hold * 0.58);
        gain.gain.linearRampToValueAtTime(amp * 0.96, start + hold);
      } else {
        gain.gain.setValueAtTime(amp, start + hold);
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      src.connect(gain).connect(pan);
      pan.connect(dry);
      pan.connect(conv);
      if (isViolin && ev.vib) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 4.6 + (ev.midi - 69) * 0.012;
        depth.gain.setValueAtTime(0, start);
        depth.gain.linearRampToValueAtTime(rate * 0.0032, start + Math.min(2.2, hold * 0.35));
        lfo.connect(depth);
        depth.connect(src.playbackRate);
        lfo.start(start);
        lfo.stop(end);
      }
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
    const g = 0.8 / peak;
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
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }, { score, sampleSets });
  return b64;
}

function encodeMp3(wav) {
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

const manifestPath = path.join(OUT, 'bgm.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
const only = process.env.ONLY;
for (const [id, score] of Object.entries(scores)) {
  if (only && id !== only) continue;
  const t0 = Date.now();
  const b64 = await renderTrack(id, score);
  const wav = Buffer.from(b64, 'base64');
  const mp3 = encodeMp3(wav);
  fs.writeFileSync(path.join(OUT, `bgm-ingame-${id === 'phase1' ? '1' : id === 'phase2' ? '2' : '3'}.wav`), wav);
  fs.writeFileSync(path.join(OUT, `bgm-ingame-${id === 'phase1' ? '1' : id === 'phase2' ? '2' : '3'}.mp3`), mp3);
  const key = id === 'phase1' ? 'ingame1' : id === 'phase2' ? 'ingame2' : 'ingame3';
  manifest.tracks[key] = {
    file: `/audio/bgm-ingame-${id === 'phase1' ? '1' : id === 'phase2' ? '2' : '3'}.wav`,
    mp3: `/audio/bgm-ingame-${id === 'phase1' ? '1' : id === 'phase2' ? '2' : '3'}.mp3`,
    title: score.title,
    bpm: score.bpm,
    duration: Number(((score.beats * 60) / score.bpm).toFixed(2)),
    loop: true,
    instrument: 'piano, double bass, electric bass, violin',
  };
  console.log(`${key}: ${(mp3.length / 1024 / 1024).toFixed(2)}MB · ${(wav.length / 1024 / 1024).toFixed(2)}MB WAV · ${Date.now() - t0}ms`);
}
manifest.generatedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
await browser.close();
console.log('done');
