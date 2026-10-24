import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../../src/engine/game.js';
import { AIRuntime } from '../../src/engine/aiRuntime.js';
import { loadAIModels } from '../../src/engine/aiLoader.js';

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

const games = Math.max(1, Number(arg('games', 200)));
const counts = String(arg('players', '2,4,8'))
  .split(',')
  .map(Number)
  .filter((n) => Number.isInteger(n) && n >= 2 && n <= 8);
const out = path.resolve(arg('out', path.join(HERE, 'data', 'decisions.jsonl')));
const only = String(arg('models', ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const loaded = await loadAIModels();
let models = loaded.filter((m) => !m.external || only.includes(m.id));
if (only.length) models = models.filter((m) => only.includes(m.id));
if (!models.length) {
  console.error('没有可收集的 AI 模型');
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
const fd = fs.openSync(out, 'w');
let rows = 0;
let currentGame = null;

function soundCounts(ctx) {
  let left = 0;
  let right = 0;
  for (const e of ctx.privateLog ?? []) {
    if (e.type === 'clue' && e.kind === 'half') {
      if (e.half === 'left') left += 1;
      else right += 1;
    }
  }
  return { left, right };
}

const runtime = new AIRuntime(models, {
  onDecision(ctx, action, meta) {
    const known = (ctx.memory?.known ?? [])
      .filter((k) => ctx.round - k.round <= 3)
      .map((k) => k.segment);
    const record = {
      game: meta.seed,
      modelId: meta.modelId,
      round: ctx.round,
      S: ctx.S,
      alive: ctx.players.filter((p) => p.alive).length,
      mePos: ctx.me.position,
      meTerrain: ctx.me.terrain,
      bombTargets: ctx.bomb.targets ?? [],
      bombRound: ctx.bomb.targetRound,
      known,
      sound: soundCounts(ctx),
      canHide: Boolean(ctx.legal.canHide),
      canHideEffective: Boolean(ctx.legal.canHideEffective),
      observeFull: Boolean(ctx.legal.observe.full),
      action: {
        type: action.type,
        dir: action.dir ?? null,
        length: action.length ?? null,
        target: action.target ?? null,
      },
    };
    fs.writeSync(fd, `${JSON.stringify(record)}\n`);
    rows += 1;
  },
});

for (const n of counts) {
  for (let gi = 0; gi < games; gi++) {
    const seed = `train:v1:${n}:${gi}`;
    currentGame = { seed, n, gi };
    const game = new Game({
      playerCount: n,
      humanSeats: 0,
      seed,
      autoStart: false,
      aiRuntime: runtime,
    });
    for (let id = 0; id < n; id++) {
      game.players[id].aiModel = models[id % models.length].id;
    }
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
  console.log(`collected ${n}p x ${games}: ${rows} decisions total`);
}

fs.closeSync(fd);
const summary = {
  generatedAt: new Date().toISOString(),
  games,
  counts,
  models: models.map((m) => ({ id: m.id, version: m.version })),
  rows,
  out,
  gameCount: counts.length * games,
};
fs.writeFileSync(path.join(path.dirname(out), 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`wrote ${rows} decisions -> ${out}`);
console.log('label types are in action.type; use train_policy.py next');
if (currentGame) console.log('last game:', currentGame.seed);
