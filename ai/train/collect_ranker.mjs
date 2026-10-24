import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../../src/engine/game.js';
import { AIRuntime } from '../../src/engine/aiRuntime.js';
import { loadAIModels } from '../../src/engine/aiLoader.js';
import {
  FEATURE_DIM,
  actionEqual,
  candidateActions,
  featureVector,
} from '../../ai/lib/featurePolicy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const games = Math.max(1, Number(arg('games', 100)));
const counts = String(arg('players', '2,4,8'))
  .split(',')
  .map(Number)
  .filter((n) => Number.isInteger(n) && n >= 2 && n <= 8);
const negativeArg = String(arg('negatives', '8'));
const allNegatives = negativeArg === 'all';
const negativeCount = allNegatives ? 100000 : Math.max(2, Number(negativeArg));
const out = path.resolve(arg('out', path.join(HERE, 'data', 'apex-ranker.jsonl')));
const generation = String(arg('generation', 'g1'));

const loaded = await loadAIModels();
const adaptive = loaded.find((m) => m.id === 'adaptive' && m.usable !== false);
if (!adaptive) {
  console.error('缺少 adaptive 模型');
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
const fd = fs.openSync(out, 'w');
let rows = 0;
let states = 0;
let skipped = 0;
const byType = { hide: 0, observe: 0, attack: 0, slip: 0 };

function pickNegatives(candidates, positiveIndex, limit) {
  const chosen = new Set([positiveIndex]);
  const knownish = [];
  for (let i = 0; i < candidates.length; i += 1) {
    if (i === positiveIndex) continue;
    const c = candidates[i];
    if (c.type === candidates[positiveIndex].type) knownish.push(i);
  }
  // Hard negatives first: same action family, then a deterministic spread.
  for (let i = 0; i < knownish.length && chosen.size < limit + 1; i += 1) {
    chosen.add(knownish[i]);
  }
  const stride = Math.max(1, Math.floor(candidates.length / Math.max(1, limit)));
  for (let i = 0; i < candidates.length && chosen.size < limit + 1; i += stride) {
    chosen.add(i);
  }
  for (let i = 0; i < candidates.length && chosen.size < limit + 1; i += 1) {
    chosen.add(i);
  }
  return [...chosen];
}

const runtime = new AIRuntime([adaptive], {
  onDecision(ctx, action, meta) {
    const candidates = candidateActions(ctx);
    const positiveIndex = candidates.findIndex((c) => actionEqual(c, action));
    if (positiveIndex < 0) {
      skipped += 1;
      return;
    }
    states += 1;
    byType[action.type] = (byType[action.type] ?? 0) + 1;
    const indexes = pickNegatives(candidates, positiveIndex, negativeCount);
    for (const index of indexes) {
      const vector = featureVector(ctx, candidates[index]);
      if (vector.length !== FEATURE_DIM) throw new Error(`feature dim ${vector.length}`);
      const row = {
        g: meta.seed,
        p: meta.playerId,
        r: ctx.round,
        y: index === positiveIndex ? 1 : 0,
        t: candidates[index].type,
        x: vector.map((n) => Math.round(n * 10000) / 10000),
      };
      fs.writeSync(fd, `${JSON.stringify(row)}\n`);
      rows += 1;
    }
  },
});

for (const n of counts) {
  for (let gi = 0; gi < games; gi++) {
    const seed = `apex:${generation}:${n}:${gi}`;
    const game = new Game({
      playerCount: n,
      humanSeats: 0,
      seed,
      autoStart: false,
      aiRuntime: runtime,
    });
    for (let id = 0; id < n; id += 1) game.players[id].aiModel = 'adaptive';
    game.start();
    let guard = 0;
    while (game.phase !== 'over' && guard++ < 900) {
      if (game.phase === 'selecting') {
        const r = await game.resolve();
        if (r.error) throw new Error(`resolve ${seed}: ${r.error}`);
      } else if (game.phase === 'resolved') {
        const r = game.advance();
        if (r.error) throw new Error(`advance ${seed}: ${r.error}`);
      } else {
        break;
      }
    }
  }
  console.log(`collected ${n}p x ${games}: states=${states} rows=${rows}`);
}

fs.closeSync(fd);
const summary = {
  generatedAt: new Date().toISOString(),
  generation,
  games,
  counts,
  states,
  rows,
  skipped,
  byType,
  featureDim: FEATURE_DIM,
  out,
};
fs.writeFileSync(path.join(path.dirname(out), 'apex-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
