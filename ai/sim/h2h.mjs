/**
 * Head-to-head: local GPU model (gpu) vs an AI 2.0 model (default adaptive).
 * 2-player duel, alternating seats.
 *
 * Run:
 *   node ai/sim/h2h.mjs --games=30 --opponent=adaptive
 */
import { Game } from '../../src/engine/game.js';
import { AIRuntime } from '../../src/engine/aiRuntime.js';
import { loadAIModels } from '../../src/engine/aiLoader.js';
import { getGpuStats, resetGpuStats } from '../models/gpu.js';

function arg(name, fallback) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : fallback;
}

const games = Math.max(1, Number(arg('games', 30)));
const opponentId = arg('opponent', 'adaptive');
const loaded = await loadAIModels();
const gpu = loaded.find((m) => m.id === 'gpu');
const opponent = loaded.find((m) => m.id === opponentId);
if (!gpu) throw new Error('gpu model not installed');
if (!opponent) throw new Error(`opponent ${opponentId} not installed`);

const runtime = new AIRuntime([gpu, opponent]);
resetGpuStats();
const result = {
  games,
  opponent: opponentId,
  gpuWins: 0,
  opponentWins: 0,
  draws: 0,
  rounds: 0,
  seats: { gpuFirst: 0, gpuSecond: 0 },
};

for (let i = 0; i < games; i++) {
  const gpuSeat = i % 2;
  const game = new Game({
    playerCount: 2,
    humanSeats: 0,
    seed: `h2h:gpu:${opponentId}:${i}`,
    autoStart: false,
    aiRuntime: runtime,
  });
  game.players[gpuSeat].aiModel = 'gpu';
  game.players[1 - gpuSeat].aiModel = opponentId;
  if (gpuSeat === 0) result.seats.gpuFirst += 1;
  else result.seats.gpuSecond += 1;
  game.start();
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 900) {
    if (game.phase === 'selecting') {
      const r = await game.resolve();
      if (r.error) throw new Error(r.error);
    } else if (game.phase === 'resolved') {
      const r = game.advance();
      if (r.error) throw new Error(r.error);
    } else break;
  }
  result.rounds += game.round;
  if (game.winnerId == null) {
    result.draws += 1;
  } else if (game.players[game.winnerId].aiModel === 'gpu') {
    result.gpuWins += 1;
  } else {
    result.opponentWins += 1;
  }
  process.stdout.write(
    `\rgames ${i + 1}/${games}  gpu ${result.gpuWins} : ${result.opponentWins} ${opponentId}  draws ${result.draws}`,
  );
}

const stats = getGpuStats();
const decided = result.gpuWins + result.opponentWins;
result.gpuWinRate = decided ? result.gpuWins / decided : 0;
result.avgRounds = result.rounds / games;
result.gpuStats = stats;
console.log('\n');
console.log(JSON.stringify(result, null, 2));
