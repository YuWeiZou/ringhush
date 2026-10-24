import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../../src/engine/game.js';
import { AIRuntime } from '../../src/engine/aiRuntime.js';
import { loadAIModels } from '../../src/engine/aiLoader.js';
import { makeRng } from '../../src/engine/rng.js';
import { steps } from '../../shared/ring.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : fallback;
}

const gamesPerCount = Math.max(1, Number(arg('games', 200)));
const playerCounts = String(arg('players', '2,4,8'))
  .split(',')
  .map(Number)
  .filter((n) => Number.isInteger(n) && n >= 2 && n <= 8);
const seedBase = String(arg('seed', 'sim-v1'));
const includeExternal = process.argv.includes('--external');
const RANKED_EXCLUDE = new Set(['basic']);
const only = arg('models', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const loaded = await loadAIModels();
let models = loaded.filter((m) => includeExternal || !m.external);
if (only.length) models = models.filter((m) => only.includes(m.id));
if (!models.length) {
  console.error('没有可跑的 AI 模型。检查 ai/models/ 或 --models=');
  process.exit(1);
}

const runtime = new AIRuntime(models);

console.log(
  `AI 模拟：${models.map((m) => `${m.id}(${m.name})`).join(', ')} · ` +
    `${playerCounts.join('/')} 人局 · 每档 ${gamesPerCount} 局`,
);

const results = [];
for (const n of playerCounts) {
  const stats = new Map(
    models.map((m) => [
      m.id,
      {
        id: m.id,
        name: m.name,
        seats: 0,
        wins: 0,
        actions: 0,
        observes: 0,
        observeFull: 0,
        observePillarFull: 0,
        observePlainForced: 0,
        attacks: 0,
        attackLong: 0,
      },
    ]),
  );
  let draws = 0;
  let totalRounds = 0;
  const rng = makeRng(`${seedBase}:${n}`);
  for (let gi = 0; gi < gamesPerCount; gi++) {
    const game = new Game({
      playerCount: n,
      humanSeats: 0,
      seed: `${seedBase}:${n}:${gi}`,
      autoStart: false,
      aiRuntime: runtime,
    });
    const pool = [...models];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let id = 0; id < n; id++) {
      const model = pool[id % pool.length];
      game.players[id].aiModel = model.id;
      stats.get(model.id).seats += 1;
    }
    game.start();

    let guard = 0;
    while (game.phase !== 'over' && guard++ < 900) {
      if (game.phase === 'selecting') {
        const r = await game.resolve();
        if (r.error) throw new Error(`resolve: ${r.error}`);
        const entry = game.replay.rounds[game.replay.rounds.length - 1];
        for (const row of entry?.actions ?? []) {
          const player = game.players.find((p) => p.id === row.id);
          const stat = stats.get(player?.aiModel);
          if (!stat) continue;
          const action = row.action;
          stat.actions += 1;
          const start = entry.start.find((p) => p.id === row.id);
          if (action.type === 'observe') {
            stat.observes += 1;
            if (action.length === game.S || action.full) {
              stat.observeFull += 1;
              if (start?.terrain === 'pillar') stat.observePillarFull += 1;
              if (start?.terrain === 'plain') stat.observePlainForced += 1;
            }
          } else if (action.type === 'attack') {
            stat.attacks += 1;
            const d1 = steps(start.position, action.target, 1, game.S);
            const d2 = steps(start.position, action.target, -1, game.S);
            const shortDir = d1 <= d2 ? 1 : -1;
            if (action.dir !== shortDir) stat.attackLong += 1;
          }
        }
      } else if (game.phase === 'resolved') {
        const r = game.advance();
        if (r.error) throw new Error(`advance: ${r.error}`);
      } else {
        break;
      }
    }
    if (game.phase !== 'over') {
      draws += 1;
      continue;
    }
    totalRounds += game.round;
    if (game.winnerId == null) {
      draws += 1;
    } else {
      const winner = game.players[game.winnerId];
      stats.get(winner.aiModel).wins += 1;
    }
  }

  const rows = [...stats.values()]
    .filter((s) => s.seats > 0 && !RANKED_EXCLUDE.has(s.id))
    .map((s) => ({
      ...s,
      winRate: s.seats ? s.wins / s.seats : 0,
      observeFullRate: s.observes ? s.observeFull / s.observes : 0,
      attackLongRate: s.attacks ? s.attackLong / s.attacks : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate || a.id.localeCompare(b.id));

  console.log(`\n${n} 人局（${gamesPerCount} 局，平局 ${draws}，平均 ${(totalRounds / Math.max(1, gamesPerCount - draws)).toFixed(1)} 回合）`);
  for (const r of rows) {
    console.log(
      `  ${r.id.padEnd(10)} ${String(r.wins).padStart(4)} 胜 / ${String(r.seats).padStart(4)} 座位  ` +
        `${(r.winRate * 100).toFixed(1)}%  ` +
        `观测整圈 ${(r.observeFullRate * 100).toFixed(0)}%  长弧攻击 ${(r.attackLongRate * 100).toFixed(0)}%`,
    );
  }
  results.push({ playerCount: n, games: gamesPerCount, draws, rows });
}

const out = {
  generatedAt: new Date().toISOString(),
  seedBase,
  gamesPerCount,
  playerCounts,
  models: models.map((m) => ({
    id: m.id,
    name: m.name,
    version: m.version,
    generation: m.generation,
  })),
  results,
};
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(out, null, 2));
console.log('\n结果已写入 ai/sim/results.json');
