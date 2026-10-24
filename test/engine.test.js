import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Game } from '../src/engine/game.js';
import { autoResolveAIOnly } from '../src/engine/auto.js';
import { attackArcLength } from '../src/engine/actions.js';
import { createMap, segmentCount, pillarCount } from '../src/engine/map.js';
import { makeRng } from '../src/engine/rng.js';
import { halfPlane } from '../shared/ring.js';
import { loadAIModels } from '../src/engine/aiLoader.js';
import { AIRuntime, buildAIContext } from '../src/engine/aiRuntime.js';
import { Room } from '../server/rooms.js';

const testAI = {
  defaultModelId: 'test',
  hasModel: (id) => id === 'test',
  listModels: () => [{ id: 'test', name: 'Test', version: '1' }],
  chooseAction: (game, player) =>
    game.terrains[player.position] === 'pillar'
      ? { action: { type: 'hide' } }
      : { action: { type: 'observe', dir: 1, length: game.S, full: true } },
};

function customGame({ S = 7, terrains, positions, round = 1, names = null }) {
  const players = positions.map((position, i) => ({
    id: i,
    name: names?.[i] ?? String.fromCharCode(65 + i),
    isAI: false,
    alive: true,
    position,
    action: null,
    deathCause: null,
  }));
  return new Game({
    playerCount: players.length,
    humanSeats: 0,
    seed: 'test-seed',
    map: {
      S,
      P: terrains.filter((t) => t === 'pillar').length,
      terrains,
      starts: positions,
      ruins: Array(S).fill(false),
    },
    players,
    round,
    autoStart: true,
  });
}

function act(game, actions) {
  for (const [id, action] of actions) {
    const r = game.submitAction(id, action);
    assert.equal(r.error, undefined, `action ${id}: ${r.error}`);
  }
  return game.resolve();
}

test('map formulas: 3n or 3n+1 segments, floor(1.5n) pillars, distinct starts', () => {
  for (let n = 2; n <= 8; n++) {
    const m = createMap(n, makeRng(`map-${n}`));
    assert.equal(m.S, segmentCount(n));
    assert.equal(m.P, pillarCount(n));
    assert.equal(new Set(m.starts).size, n);
    assert.equal(m.terrains.filter((t) => t === 'pillar').length, pillarCount(n));
    assert.equal(m.S % 2, 1);
  }
});

test('half-plane is relative to each observer and has no tie on odd S', () => {
  assert.equal(halfPlane(5, 1, 13), 'right');
  assert.equal(halfPlane(5, 8, 13), 'left');
  assert.equal(halfPlane(0, 1, 7), 'left');
  assert.equal(halfPlane(0, 6, 7), 'right');
});

test('attack: target observing with an arc that does not include attacker takes no damage', () => {
  // 0 and 1 are pillars. A at 0 attacks B at 1. B observes only its own segment.
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'observe', dir: -1, length: 1 }],
  ]);
  assert.equal(g.players[1].alive, true);
});

test('attack: target observing with an arc that includes attacker takes damage', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'observe', dir: -1, length: 2 }],
  ]);
  assert.equal(g.players[1].alive, false);
  assert.equal(g.players[0].alive, true);
  assert.equal(g.phase, 'over');
  assert.equal(g.winnerId, 0);
});

test('attack: hiding is immune', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'hide' }],
  ]);
  assert.equal(g.players[1].alive, true);
});

test('mutual attack on pillars with equal arcs kills both', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'attack', target: 0, dir: -1 }],
  ]);
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, false);
  assert.equal(g.phase, 'over');
  assert.equal(g.winnerId, null);
});

test('mutual attack on pillars: longer arc takes no damage', () => {
  // S=7. A at 0 attacks B at 1 clockwise (arc 1); B at 1 attacks A at 0
  // clockwise the long way (arc 6). B has the longer arc, so B takes no
  // damage from A; A takes damage from B.
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'attack', target: 0, dir: 1 }],
  ]);
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, true);
});

test('slip: single mover into a hiding occupant kills the occupant', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'slip', dir: 1, distance: 1 }],
    [1, { type: 'hide' }],
  ]);
  assert.equal(g.players[0].alive, true);
  assert.equal(g.players[1].alive, false);
});

test('slip: observer who did not see the origin dies', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'slip', dir: 1, distance: 1 }],
    [1, { type: 'observe', dir: 1, length: 1 }],
  ]);
  assert.equal(g.players[0].alive, true);
  assert.equal(g.players[1].alive, false);
});

test('slip: observer who saw the origin kills the mover', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'slip', dir: 1, distance: 1 }],
    [1, { type: 'observe', dir: -1, length: 2 }],
  ]);
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, true);
});

test('crowding: 2 movers into a stationary hiding player — the stationary player survives', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'pillar', 'plain', 'plain', 'plain', 'plain'],
    positions: [0, 1, 2],
  });
  act(g, [
    [0, { type: 'slip', dir: 1, distance: 1 }],
    [1, { type: 'hide' }],
    [2, { type: 'slip', dir: -1, distance: 1 }],
  ]);
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, true);
  assert.equal(g.players[2].alive, false);
  const pile = g.corpses.get(1);
  assert.equal(pile.count, 2);
  assert.equal(pile.firstRound, 1);
  assert.equal(pile.lastRound, 1);
  assert.equal(pile.deaths.length, 2);
});

test('crowding: two movers into an empty segment with different distances — shorter survives', () => {
  const g = customGame({
    terrains: ['plain', 'plain', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1, 3],
  });
  // 0 -> 2 is distance 2 (first adjacent 1 is plain); 3 -> 2 is distance 1.
  act(g, [
    [0, { type: 'slip', dir: 1, distance: 2 }],
    [1, { type: 'observe', dir: 1, length: 1 }],
    [2, { type: 'slip', dir: -1, distance: 1 }],
  ]);
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[2].alive, true);
});

test('crowding: two movers into an empty segment with equal distance both die', () => {
  const g = customGame({
    terrains: ['pillar', 'plain', 'pillar', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 2, 4],
  });
  // player 0 (at 0) -> 1 and player 1 (at 2) -> 1: both distance 1 into empty.
  act(g, [
    [0, { type: 'slip', dir: 1, distance: 1 }],
    [1, { type: 'slip', dir: -1, distance: 1 }],
    [2, { type: 'observe', dir: 1, length: 1 }],
  ]);
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, false);
});

test('bombardment: warning at round 2, bomb at round 4, becomes ruins, next warning follows half threshold', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1, 2],
    round: 1,
  });
  g.round = 2;
  g.startRound();
  assert.notEqual(g.bomb.target, null);
  const target = g.bomb.target;
  assert.equal(g.bomb.targetRound, 4);

  g.players[0].position = target;
  g.players[1].position = (target + 3) % 7;
  g.players[2].position = (target + 5) % 7;
  g.round = 4;
  g.startRound();
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, true);
  assert.equal(g.players[2].alive, true);
  assert.equal(g.terrains[target], 'ruins');
  assert.notEqual(g.bomb.target, null);
  assert.notEqual(g.bomb.target, target);
  assert.equal(g.bomb.targetRound, 6);
  assert.equal(g.phase, 'selecting');
});

test('bomb mode: half threshold uses 2-round interval, quarter uses 3-round double warning', () => {
  const terrains = Array.from({ length: 13 }, (_, i) => (i % 3 === 0 ? 'pillar' : 'plain'));
  const g = customGame({
    S: 13,
    terrains,
    positions: [0, 1, 2, 3, 4, 5, 6, 7],
  });
  const setAlive = (count) => {
    g.players.forEach((p, i) => {
      p.alive = i < count;
    });
  };

  setAlive(6);
  assert.deepEqual(
    { mode: g.bombModeInfo().mode, interval: g.bombModeInfo().interval, count: g.bombModeInfo().targetCount },
    { mode: 'normal', interval: 3, count: 1 },
  );

  setAlive(4);
  assert.deepEqual(
    { mode: g.bombModeInfo().mode, interval: g.bombModeInfo().interval, count: g.bombModeInfo().targetCount },
    { mode: 'fast', interval: 2, count: 1 },
  );

  setAlive(2);
  assert.deepEqual(
    { mode: g.bombModeInfo().mode, interval: g.bombModeInfo().interval, count: g.bombModeInfo().targetCount },
    { mode: 'double', interval: 3, count: 2 },
  );

  g.announceBomb(10, 2, 'double', g.bombModeInfo());
  assert.equal(g.bomb.targets.length, 2);
  assert.notEqual(g.bomb.targets[0], g.bomb.targets[1]);
  assert.equal(g.bomb.targetRound, 10);
  const doubleTargets = [...g.bomb.targets];

  g.players[0].position = doubleTargets[0];
  g.players[1].position = doubleTargets[1];
  g.round = 10;
  g.startRound();
  assert.equal(g.terrains[doubleTargets[0]], 'ruins');
  assert.equal(g.terrains[doubleTargets[1]], 'ruins');
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, false);
});

test('bombardment that leaves one survivor ends the game without a next warning', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
    round: 1,
  });
  g.round = 2;
  g.startRound();
  const target = g.bomb.target;
  g.players[0].position = target;
  g.players[1].position = (target + 3) % 7;
  g.round = 4;
  g.startRound();
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, true);
  assert.equal(g.bomb.target, null);
  assert.equal(g.phase, 'over');
  assert.equal(g.winnerId, 1);
});

test('disconnect: dead, corpse recorded, public cause, selects hide for the current round', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1, 2],
  });
  assert.equal(g.disconnectPlayer(0), true);
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[0].deathCause, 'disconnect');
  assert.equal(g.players[0].action.type, 'hide');
  assert.equal(g.phase, 'selecting');
  assert.equal(g.corpses.get(0).deaths[0].cause, 'disconnect');
  assert.ok(g.publicLog.some((e) => e.type === 'death' && e.playerId === 0 && e.cause === 'disconnect'));
  assert.equal(g.disconnectPlayer(0), false);
});

test('pillar observation is capped at half the ring; plain can still see all', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 2],
  });
  assert.equal(g.getView(0).legal.observe.max, 3);
  assert.equal(g.getView(0).legal.observe.full, false);
  const pillar = g.submitAction(0, { type: 'observe', dir: 1, length: 7 });
  assert.equal(pillar.action.length, 3);

  const plain = g.submitAction(1, { type: 'observe', dir: 1, length: 7 });
  assert.equal(plain.action.length, 7);
  assert.equal(plain.action.full, true);
});

test('game over: last survivor wins; all dead is a draw', () => {
  const g = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'observe', dir: -1, length: 2 }],
  ]);
  assert.equal(g.phase, 'over');
  assert.equal(g.winnerId, 0);

  const replay = g.getReplayRecord({ roomId: 'TEST' });
  assert.equal(replay.roomId, 'TEST');
  assert.equal(replay.rounds.length, 1);
  assert.equal(replay.rounds[0].round, 1);
  assert.equal(replay.rounds[0].actions.length, 2);
  assert.equal(replay.rounds[0].start.length, 2);
  assert.equal(replay.rounds[0].end.length, 2);
  assert.equal(replay.rounds[0].end[1].alive, false);
  assert.equal(replay.winnerId, 0);
  assert.ok(replay.rounds[0].private[1].some((e) => e.type === 'damage'));
  assert.equal(replay.corpses.length, 1);
  assert.equal(replay.corpses[0].segment, 1);
  assert.equal(replay.corpses[0].count, 1);
  assert.equal(replay.rounds[0].corpsesEnd[0].count, 1);

  const deadView = g.getView(1);
  assert.equal(deadView.spectator, true);
  assert.equal(deadView.legal, null);
  assert.equal(deadView.players.find((p) => p.id === 0).position, 0);
  const aliveView = g.getView(0);
  assert.equal(aliveView.spectator, false);
  assert.equal(aliveView.players.find((p) => p.id === 1).position, undefined);
  assert.equal(aliveView.corpses.length, 0);
  assert.equal(deadView.corpses.length, 1);
  assert.equal(deadView.corpses[0].deaths[0].round, 1);

  // 存活玩家走到尸体段：只拿到“自己本轮发现”的记录，不拿到真实死亡时间/死者细节。
  g.players[0].position = 1;
  const onPile = g.getView(0);
  assert.equal(onPile.corpses.length, 1);
  assert.equal(onPile.corpses[0].count, 1);
  assert.equal(onPile.corpses[0].firstRound, g.round);
  assert.equal(onPile.corpses[0].deaths, undefined);

  const d = customGame({
    terrains: ['pillar', 'pillar', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(d, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'attack', target: 0, dir: -1 }],
  ]);
  assert.equal(d.phase, 'over');
  assert.equal(d.winnerId, null);
});

test('ruins cannot be entered normally; a plain-side player can cross to the other side', () => {
  const g = customGame({
    terrains: ['plain', 'ruins', 'pillar', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 3],
  });
  // 0 is plain, 2 is the other side of ruins at 1. A can slip 2 (cross) to 2.
  const r = g.submitAction(0, { type: 'slip', dir: 1, distance: 2 });
  assert.equal(r.error, undefined);
  assert.equal(r.action.cross, true);
  assert.equal(r.action.destination, 2);

  // From the pillar side (2), crossing back over the ruins is not legal.
  g.players[0].position = 2;
  const back = g.submitAction(0, { type: 'slip', dir: -1, distance: 2 });
  assert.notEqual(back.error, undefined);
});

test('consecutive ruins are a thick wall; only a single ruin can be crossed', () => {
  const g = customGame({
    terrains: ['plain', 'ruins', 'ruins', 'pillar', 'plain', 'plain', 'plain'],
    positions: [0, 4],
  });
  const moves = g.getView(0).legal.moves;
  assert.equal(
    moves.some((m) => m.dir === 1 && m.distance === 2 && m.cross),
    false,
  );

  const one = customGame({
    terrains: ['plain', 'ruins', 'pillar', 'plain', 'plain', 'plain', 'plain'],
    positions: [0, 3],
  });
  const cross = one.getView(0).legal.moves.find(
    (m) => m.dir === 1 && m.distance === 2 && m.cross,
  );
  assert.ok(cross);
  assert.equal(cross.destination, 2);
});

test('ruins do not block observation or attack', () => {
  const g = customGame({
    terrains: ['pillar', 'ruins', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 2],
  });
  act(g, [
    [0, { type: 'attack', target: 2, dir: 1 }],
    [1, { type: 'observe', dir: -1, length: 3 }],
  ]);
  // B's arc [2,1,0] crosses the ruins and includes A, so A's shot lands.
  assert.equal(g.players[1].alive, false);
});

test('autoResolveAIOnly finishes an all-AI game', async () => {
  const g = new Game({
    playerCount: 4,
    humanSeats: 0,
    seed: 'auto-test',
    autoStart: true,
    aiRuntime: testAI,
  });
  assert.equal(g.phase, 'selecting');
  const result = await autoResolveAIOnly(g);
  assert.equal(result.over, true);
  assert.equal(g.phase, 'over');
  assert.ok(g.round >= 4);
  assert.ok(g.winnerId === null || Number.isInteger(g.winnerId));
});

test('AI without an installed model cannot start', () => {
  assert.throws(
    () =>
      new Game({
        playerCount: 2,
        humanSeats: 1,
        seed: 'no-ai',
        autoStart: true,
      }),
    /AI/,
  );
});

test('observation sees plains regardless of action but never sees a pillar hider', () => {
  const g = customGame({
    terrains: ['pillar', 'plain', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1, 2],
  });
  act(g, [
    [0, { type: 'hide' }],
    [1, { type: 'observe', dir: 1, length: 1 }],
    [2, { type: 'observe', dir: 1, length: 1 }],
  ]);
  assert.deepEqual(g.observations.get(1), [2]);
  assert.deepEqual(g.observations.get(2), [1]);
});

test('a plain target has no cover', () => {
  const g = customGame({
    terrains: ['pillar', 'plain', 'plain', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(g, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'observe', dir: 1, length: 1 }],
  ]);
  assert.equal(g.players[1].alive, false);
});

test('attack arc direction matters on plain too', () => {
  const g = customGame({
    terrains: ['plain', 'plain', 'pillar', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 3],
  });
  assert.equal(
    attackArcLength(g, { position: 0 }, { target: 1, dir: 1 }),
    1,
  );
  assert.equal(
    attackArcLength(g, { position: 0 }, { target: 1, dir: -1 }),
    6,
  );

  const h = customGame({
    terrains: ['plain', 'plain', 'pillar', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 1],
  });
  act(h, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'observe', dir: 1, length: 1 }],
  ]);
  const attackEvent = [...h.privateEvents.get(0)]
    .reverse()
    .find((e) => e.type === 'attack');
  assert.equal(attackEvent.arcLength, 1);
  assert.equal(attackEvent.result, undefined);
  assert.equal(h.getView(0).privateLog.find((e) => e.type === 'attack').result, undefined);
});

test('plain hide is a no-op: still observed and still hit', () => {
  const g = customGame({
    terrains: ['plain', 'plain', 'plain', 'pillar', 'pillar', 'plain', 'plain'],
    positions: [0, 1, 2],
  });
  act(g, [
    [0, { type: 'hide' }],
    [1, { type: 'observe', dir: 1, length: 1 }],
    [2, { type: 'attack', target: 0, dir: -1 }],
  ]);
  assert.equal(g.players[0].alive, false);
  assert.ok(g.observations.get(1).includes(0));
  assert.equal(g.players[0].hiding, false);
});

test('gunshots only give a half clue, never an exact segment', () => {
  const g = customGame({
    terrains: ['plain', 'plain', 'pillar', 'plain', 'pillar', 'plain', 'plain'],
    positions: [0, 3],
  });
  act(g, [
    [0, { type: 'attack', target: 1, dir: 1 }],
    [1, { type: 'observe', dir: 1, length: 1 }],
  ]);
  const clue = [...g.privateEvents.get(1)].find((e) => e.type === 'clue');
  assert.equal(clue.kind, 'half');
  assert.ok(clue.half === 'left' || clue.half === 'right');
  assert.equal(clue.segment, undefined);
  const gunshot = g.publicLog.find((e) => e.type === 'gunshot');
  assert.equal(gunshot.exact, undefined);
});

test('AI loader returns [] for an empty AI folder and loads installed models', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'df-ai-empty-'));
  assert.deepEqual(await loadAIModels(empty), []);
  fs.rmSync(empty, { recursive: true, force: true });

  const models = await loadAIModels();
  assert.ok(models.some((m) => m.id === 'hunter'));
  assert.ok(models.some((m) => m.id === 'basic'));
  const runtime = new AIRuntime(models);
  assert.ok(runtime.defaultModelId);
  assert.ok(runtime.hasModel(runtime.defaultModelId));
});

test('AI context never exposes other players positions', async () => {
  const models = await loadAIModels();
  const runtime = new AIRuntime(models);
  const g = new Game({
    playerCount: 4,
    humanSeats: 0,
    seed: 'ctx-test',
    autoStart: true,
    aiRuntime: runtime,
  });
  assert.equal(g.phase, 'selecting');
  const ctx = buildAIContext(g, g.players[1]);
  assert.equal(ctx.game, undefined);
  assert.ok(ctx.me.position >= 0);
  assert.ok(ctx.players.length === 4);
  assert.ok(ctx.players.every((p) => !Object.hasOwn(p, 'position')));
  assert.ok(ctx.privateLog.every((e) => e.type !== 'position'));
});

test('room refuses to add AI when the AI folder is empty', () => {
  const room = new Room({
    id: 'TEST',
    seed: 'empty-ai-room',
    aiRuntime: new AIRuntime([]),
  });
  room.addClient({});
  const added = room.addAI('random');
  assert.match(added.error, /AI/);
  assert.equal(room.total, 1);
  const lobby = room.lobbyFor(0);
  assert.deepEqual(lobby.models, []);
  assert.equal(lobby.aiSlots.length, 0);
});

test('room creates a game from humans + AI and preserves setup on lobby reset', async () => {
  const runtime = new AIRuntime(await loadAIModels());
  const room = new Room({ id: 'ROOM', seed: 'room-test', aiRuntime: runtime });
  const added = room.addClient({}, 'Alice');
  assert.equal(added.playerId, 0);
  assert.equal(room.addAI('hunter').ok, true);
  room.setTurnSeconds(20);
  assert.equal(room.turnSeconds, 20);
  const lobby = room.lobbyFor(0);
  assert.equal(lobby.total, 2);
  assert.equal(lobby.canStart, true);
  assert.equal(lobby.humans[0].name, 'Alice');

  assert.equal(room.start().ok, true);
  assert.equal(room.game.players[0].name, 'Alice');
  assert.equal(room.game.players[1].aiModel, 'hunter');
  assert.equal(room.game.phase, 'selecting');

  room.resetLobby();
  assert.equal(room.game, null);
  assert.equal(room.started, false);
  assert.equal(room.total, 2);
  assert.equal(room.lobbyFor(0).humans[0].name, 'Alice');
});
