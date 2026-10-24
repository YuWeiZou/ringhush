import test from 'node:test';
import assert from 'node:assert/strict';
import { attackAction, blindAttack, blindTargets, compartmentGuard, compartmentRisk, endgameMove, hasMovementSpace, lockAttack, lockedDuelTarget, observeAction, optionInfo, refreshKnown, reachableKnownPool } from '../ai/lib/common.js';
import { validateProfile } from '../ai/lib/profile.js';
import { halfPlane, observeSegments, steps } from '../shared/ring.js';

function ctx({ terrain = 'pillar', alive = 2, targetTerrain = 'pillar', privateLog = [] } = {}) {
  const S = 25;
  const map = Array.from({ length: S }, (_, index) => ({
    index,
    terrain: index === 9 ? targetTerrain : index % 4 === 0 ? 'pillar' : 'plain',
    bomb: false,
    ruins: false,
  }));
  return {
    S,
    round: 3,
    me: { id: 0, position: 0, terrain, alive: true },
    players: Array.from({ length: alive }, (_, id) => ({ id, alive: true })),
    map,
    bomb: { targets: [], targetRound: null, mode: 'normal' },
    legal: {
      observe: { full: terrain === 'plain', max: S },
      moves: [],
      canHide: true,
      canHideEffective: terrain === 'pillar',
    },
    privateLog,
    memory: {},
    random: () => 0.2,
    helpers: { observeSegments, steps, halfPlane, mod: (i, n) => ((i % n) + n) % n },
  };
}

test('AI 2.1 attack: 1v1 pillar duel chooses the long arc; short mode stays short', () => {
  const c = ctx({ alive: 2, terrain: 'pillar', targetTerrain: 'pillar' });
  const d1 = steps(0, 9, 1, c.S);
  const d2 = steps(0, 9, -1, c.S);
  const auto = attackAction(c, 9);
  assert.equal(auto.type, 'attack');
  assert.equal(auto.dir, d1 > d2 ? 1 : -1);
  const shortDir = d1 <= d2 ? 1 : -1;
  assert.equal(attackAction(c, 9, { mode: 'short' }).dir, shortDir);
  assert.equal(attackAction(c, 9, { mode: 'long' }).dir, -shortDir);
});

test('AI 2.1 observation: pillar chooses a partial arc; plain is forced full circle', () => {
  const pillar = ctx({ terrain: 'pillar', alive: 2 });
  const obs = observeAction(pillar);
  assert.equal(obs.type, 'observe');
  assert.ok(obs.length > 0 && obs.length < pillar.S);
  assert.equal(obs.full, undefined);

  const plain = ctx({ terrain: 'plain', alive: 2 });
  const forced = observeAction(plain);
  assert.equal(forced.length, plain.S);
  assert.equal(forced.full, true);
});
test('AI 2.1 blind fire: uses an elimination pool from private sightings', () => {
  const c = ctx({
    alive: 2,
    privateLog: [
      { type: 'observe', round: 2, segments: [9], dir: 1, length: 2 },
      { type: 'observe', round: 3, segments: [9], dir: 1, length: 2 },
    ],
  });
  c.round = 3;
  const candidates = blindTargets(c);
  assert.ok(candidates.length > 0);
  assert.ok(!candidates.some((x) => x.segment === c.me.position));
  c.random = () => 0;
  const shot = blindAttack(c);
  assert.equal(shot.type, 'attack');
  assert.notEqual(shot.target, c.me.position);
});

test('AI 2.1 movement: a sealed pocket has fewer options than open ring', () => {
  const c = ctx({ alive: 2, terrain: 'plain' });
  c.S = 9;
  c.map = Array.from({ length: 9 }, (_, index) => ({
    index,
    terrain: index === 1 || index === 2 ? 'ruins' : 'plain',
    bomb: false,
    ruins: index === 1 || index === 2,
  }));
  c.me.position = 0;
  c.legal.moves = [{ dir: -1, distance: 1, destination: 8, cross: false }];
  assert.ok(optionInfo(c, 0).options < optionInfo(c, 5).options);
});test('AI 2.2 midgame: checks an uncleared pocket before hiding', () => {
  const c = ctx({ alive: 3, terrain: 'pillar' });
  c.S = 7;
  c.map = Array.from({ length: 7 }, (_, index) => ({
    index,
    terrain: index === 3 || index === 4 ? 'ruins' : index === 0 ? 'pillar' : 'plain',
    bomb: false,
    ruins: index === 3 || index === 4,
  }));
  c.me.position = 0;
  c.legal.observe.max = 3;
  c.legal.observe.full = false;
  c.bomb = { targets: [5], targetRound: 9, mode: 'fast' };
  const risk = compartmentRisk(c);
  assert.ok(risk.level >= 3);
  const guard = compartmentGuard(c);
  assert.equal(guard.type, 'observe');
  assert.ok(guard.length <= 3);
});test('AI 2.3 lock: 1v1 target with no movement is attacked, never observed', () => {
  const c = ctx({ alive: 2, terrain: 'pillar' });
  c.map[8] = { index: 8, terrain: 'ruins', bomb: false, ruins: true };
  c.map[10] = { index: 10, terrain: 'ruins', bomb: false, ruins: true };
  c.privateLog = [{ type: 'observe', round: 3, segments: [9], dir: 1, length: 1 }];
  assert.equal(hasMovementSpace(c, 9), false);
  assert.ok(lockedDuelTarget(c));
  const shot = lockAttack(c);
  assert.equal(shot.type, 'attack');
  assert.equal(shot.target, 9);
  assert.equal(shot.dir, -1); // long arc for this layout
});

test('AI 2.3.2 lock yields to an avoidable bomb target', () => {
  const c = ctx({ alive: 2, terrain: 'pillar' });
  c.map[8] = { index: 8, terrain: 'ruins', bomb: false, ruins: true };
  c.map[10] = { index: 10, terrain: 'ruins', bomb: false, ruins: true };
  c.privateLog = [{ type: 'observe', round: 3, segments: [9], dir: 1, length: 1 }];
  c.bomb = { targets: [0], targetRound: 9, mode: 'fast' };
  c.legal.moves = [{ dir: 1, distance: 1, destination: 1, cross: false }];
  assert.ok(lockedDuelTarget(c));
  assert.equal(lockAttack(c), null);
});

test('AI 2.3.3 lock rejects a target on the announced bomb segment', () => {
  const c = ctx({ alive: 2, terrain: 'pillar' });
  c.map[8] = { index: 8, terrain: 'ruins', bomb: false, ruins: true };
  c.map[10] = { index: 10, terrain: 'ruins', bomb: false, ruins: true };
  c.privateLog = [{ type: 'observe', round: 3, segments: [9], dir: 1, length: 1 }];
  c.bomb = { targets: [9], targetRound: 5, mode: 'fast' };
  assert.equal(lockedDuelTarget(c), null);
  assert.equal(lockAttack(c), null);
});

test('AI 2.3.3 single ruin layer is a legal escape from plain', () => {
  const c = ctx({ alive: 2, terrain: 'pillar' });
  c.map[9].terrain = 'plain';
  c.map[8] = { index: 8, terrain: 'ruins', bomb: false, ruins: true };
  c.privateLog = [{ type: 'observe', round: 3, segments: [9], dir: 1, length: 1 }];
  assert.equal(hasMovementSpace(c, 9), true);
  assert.equal(lockedDuelTarget(c), null);
});

test('AI 2.3.3 all-known pool avoids unreachable sweep', () => {
  const c = ctx({ alive: 3, terrain: 'pillar' });
  c.privateLog = [
    { type: 'observe', round: 3, segments: [5], dir: 1, length: 1 },
    { type: 'observe', round: 3, segments: [15], dir: -1, length: 1 },
  ];
  const pool = reachableKnownPool(c);
  assert.ok(pool && pool.length > 0);
  assert.ok(pool.some((p) => p.segment === 5));
  assert.ok(pool.some((p) => p.segment === 15));
  assert.ok(!pool.some((p) => p.segment === 9));
});

test('AI 2.3.2 recent gunshot half-plane discards a stale sighting', () => {
  const c = ctx({ alive: 2, terrain: 'pillar' });
  c.privateLog = [{ type: 'observe', round: 3, segments: [9], dir: 1, length: 1 }];
  const actual = halfPlane(0, 9, c.S);
  c.privateLog.push({ type: 'clue', kind: 'half', round: 3, from: 0, half: actual === 'left' ? 'right' : 'left' });
  assert.equal(refreshKnown(c).length, 0);
});

test('external profile validation: accepts data, rejects bad format, reports overflow', () => {
  const valid = {
    id: 'test-profile',
    name: 'Test',
    style: { aggression: 0.8 },
    rules: [{ when: { phase: 2 }, style: { hide: 0.2 } }],
  };
  assert.equal(validateProfile(valid, { bytes: 100 }).ok, true);
  assert.equal(validateProfile({ id: 'x', name: 'X', rules: [{ when: { nope: 1 } }] }).ok, false);
  const overflow = { id: 'big', name: 'Big', rules: Array.from({ length: 257 }, () => ({ when: {} })) };
  const check = validateProfile(overflow, { bytes: 100 });
  assert.equal(check.ok, false);
  assert.equal(check.overflow, true);
});