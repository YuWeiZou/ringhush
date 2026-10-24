import { Game } from '../../src/engine/game.js';
import { AIRuntime } from '../../src/engine/aiRuntime.js';
import { loadAIModels } from '../../src/engine/aiLoader.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const games = Math.max(1, Number(arg('games', 300)));
const players = Math.max(2, Number(arg('players', 2)));
const apexCount = Math.max(1, Math.min(players, Number(arg('apex', 1))));
const challenger = String(arg('model', 'apex'));

const loaded = await loadAIModels();
const models = loaded.filter((m) => m.id === challenger || m.id === 'adaptive');
if (models.length < 2) {
  console.error('需要 challenger 和 adaptive');
  process.exit(1);
}
const runtime = new AIRuntime(models);

let challengerWins = 0;
let adaptiveWins = 0;
let draws = 0;
let challengerSeats = 0;
let adaptiveSeats = 0;
const byPlayers = {};

for (let g = 0; g < games; g += 1) {
  const seed = `duel:${players}:${g}`;
  const game = new Game({
    playerCount: players,
    humanSeats: 0,
    seed,
    autoStart: false,
    aiRuntime: runtime,
  });
  // Alternate which seats get the challenger; for multi-player games use the
  // first `apexCount` seats in even games and the last in odd games.
  const start = g % 2 === 0 ? 0 : players - apexCount;
  for (let id = 0; id < players; id += 1) {
    const isChallenger = id >= start && id < start + apexCount;
    game.players[id].aiModel = isChallenger ? challenger : 'adaptive';
    if (isChallenger) challengerSeats += 1;
    else adaptiveSeats += 1;
  }
  game.start();
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 1200) {
    if (game.phase === 'selecting') {
      const r = await game.resolve();
      if (r.error) throw new Error(`${seed}: ${r.error}`);
    } else if (game.phase === 'resolved') {
      const r = game.advance();
      if (r.error) throw new Error(`${seed}: ${r.error}`);
    } else {
      break;
    }
  }
  if (game.winnerId == null) {
    draws += 1;
    continue;
  }
  const winner = game.players.find((p) => p.id === game.winnerId);
  if (winner?.aiModel === challenger) challengerWins += 1;
  else adaptiveWins += 1;
}

const decided = challengerWins + adaptiveWins;
console.log(JSON.stringify({
  challenger,
  players,
  apexCount,
  games,
  challengerWins,
  adaptiveWins,
  draws,
  challengerWinRate: decided ? challengerWins / decided : 0,
  challengerSeatWinRate: challengerSeats ? challengerWins / challengerSeats : 0,
  adaptiveSeatWinRate: adaptiveSeats ? adaptiveWins / adaptiveSeats : 0,
}, null, 2));
