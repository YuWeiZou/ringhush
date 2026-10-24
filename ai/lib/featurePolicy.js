/**
 * Candidate action generation + fixed feature vector for the trained
 * built-in "apex" model. This file is shared by the data collector, the
 * trainer-side expectations, and the in-game model so the features cannot
 * drift.
 *
 * It only reads the private ctx passed to every AI model. It never receives
 * other players' positions.
 */
import { steps } from '../../shared/ring.js';

export const FEATURE_DIM = 58;

function clamp(n, lo = -1, hi = 1) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}

function terrainOf(ctx, index) {
  return ctx.map?.[index]?.terrain ?? 'plain';
}

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

function knownInfo(ctx) {
  const known = (ctx.memory?.known ?? [])
    .filter((k) => ctx.round - k.round <= 3)
    .map((k) => ({ segment: k.segment, age: ctx.round - k.round }))
    .filter((k) => Number.isInteger(k.segment));
  const nearest = known.reduce(
    (best, k) => (!best || k.age < best.age ? k : best),
    null,
  );
  return { known, nearest };
}

export function actionEqual(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'hide') return true;
  if (a.type === 'observe') {
    return (
      (a.dir ?? 1) === (b.dir ?? 1) &&
      (a.length ?? 1) === (b.length ?? 1) &&
      Boolean(a.full) === Boolean(b.full)
    );
  }
  if (a.type === 'attack') return (a.target ?? -1) === (b.target ?? -1) && (a.dir === -1 ? -1 : 1) === (b.dir === -1 ? -1 : 1);
  if (a.type === 'slip') {
    return (a.dir === -1 ? -1 : 1) === (b.dir === -1 ? -1 : 1) && (a.distance === 2 ? 2 : 1) === (b.distance === 2 ? 2 : 1);
  }
  return false;
}

export function actionKey(a) {
  if (!a) return 'null';
  if (a.type === 'hide') return 'hide';
  if (a.type === 'observe') return `observe:${a.dir ?? 1}:${a.length ?? 1}:${a.full ? 1 : 0}`;
  if (a.type === 'attack') return `attack:${a.target}:${a.dir === -1 ? -1 : 1}`;
  if (a.type === 'slip') return `slip:${a.dir === -1 ? -1 : 1}:${a.distance === 2 ? 2 : 1}`;
  return String(a.type);
}

/**
 * Enumerate all actions the engine currently allows. This is intentionally
 * exhaustive for attack (the AI does not know which segment is occupied, so
 * every segment is a legal hypothesis) and exact for movement.
 */
export function candidateActions(ctx) {
  const legal = ctx.legal;
  if (!legal) return [];
  const out = [];
  if (legal.canHide) out.push({ type: 'hide' });

  if (legal.observe?.full) {
    out.push({ type: 'observe', dir: 1, length: ctx.S, full: true });
  } else {
    const max = Math.max(1, Number(legal.observe?.max ?? 1));
    for (const dir of [1, -1]) {
      for (let length = 1; length <= max; length += 1) {
        out.push({ type: 'observe', dir, length });
      }
    }
  }

  for (let target = 0; target < ctx.S; target += 1) {
    if (target === ctx.me.position) continue;
    for (const dir of [1, -1]) out.push({ type: 'attack', target, dir });
  }

  for (const move of legal.moves ?? []) {
    out.push({ type: 'slip', dir: move.dir, distance: move.distance });
  }
  return out;
}

function stateFeatures(ctx) {
  const alive = ctx.players.filter((p) => p.alive).length;
  const dead = ctx.players.length - alive;
  const { known, nearest } = knownInfo(ctx);
  const sound = soundCounts(ctx);
  const bombTargets = ctx.bomb?.targets ?? [];
  const bombNear = bombTargets.length
    ? Math.min(...bombTargets.map((t) => steps(ctx.me.position, t, 1, ctx.S)))
    : ctx.S;
  const last = ctx.memory?.lastAction ?? 'unknown';
  const observeAge = ctx.memory?.lastObserveRound == null
    ? 99
    : Math.max(0, ctx.round - ctx.memory.lastObserveRound);

  const v = new Array(30).fill(0);
  v[0] = clamp(ctx.round / 50);
  v[1] = clamp(alive / 8);
  v[2] = clamp(ctx.S / 20);
  v[3] = ctx.me.terrain === 'pillar' ? 1 : 0;
  v[4] = ctx.me.terrain === 'plain' ? 1 : 0;
  v[5] = Math.sin((2 * Math.PI * ctx.me.position) / Math.max(1, ctx.S));
  v[6] = Math.cos((2 * Math.PI * ctx.me.position) / Math.max(1, ctx.S));
  v[7] = clamp(bombNear / Math.max(1, ctx.S));
  v[8] = clamp(bombTargets.length / Math.max(1, ctx.S));
  v[9] = clamp(known.length / 8);
  v[10] = clamp(sound.left / 10);
  v[11] = clamp(sound.right / 10);
  v[12] = ctx.legal?.canHideEffective ? 1 : 0;
  v[13] = clamp((ctx.legal?.moves?.length ?? 0) / 6);
  v[14] = clamp((ctx.legal?.observe?.max ?? 1) / Math.max(1, ctx.S));
  v[15] = ctx.legal?.observe?.full ? 1 : 0;
  v[16] = nearest ? clamp(nearest.age / 10) : 1;
  v[17] = nearest ? clamp(steps(ctx.me.position, nearest.segment, 1, ctx.S) / Math.max(1, ctx.S)) : 1;
  v[18] = clamp(dead / 8);
  v[19] = last === 'hide' ? 1 : 0;
  v[20] = last === 'observe' ? 1 : 0;
  v[21] = last === 'attack' ? 1 : 0;
  v[22] = last === 'slip' ? 1 : 0;
  v[23] = clamp(observeAge / 10);
  v[24] = clamp((ctx.privateLog?.length ?? 0) / 50);
  v[25] = clamp((ctx.publicLog?.length ?? 0) / 120);
  v[26] = ctx.bomb?.mode === 'fast' ? 1 : 0;
  v[27] = ctx.bomb?.mode === 'warn' ? 1 : 0;
  v[28] = clamp(ctx.P / 8);
  v[29] = 1;
  return v;
}

export function featureVector(ctx, action) {
  const v = stateFeatures(ctx);
  const { known } = knownInfo(ctx);
  const knownSet = new Set(known.map((k) => k.segment));
  const knownAges = new Map(known.map((k) => [k.segment, k.age]));
  const me = ctx.me.position;
  const S = ctx.S;
  const knownInArc = (arc) => new Set(arc.filter((seg) => knownSet.has(seg))).size;

  let target = null;
  let arc = [];
  let dir = 1;
  let length = 0;
  let full = false;
  let distance = 0;
  let cross = false;
  let destination = null;
  let targetKnown = false;
  let targetAge = 99;

  if (action.type === 'observe') {
    dir = action.dir === -1 ? -1 : 1;
    length = action.length ?? 1;
    full = Boolean(action.full);
    arc = ctx.helpers.observeSegments(me, dir, length, S);
  } else if (action.type === 'attack') {
    target = action.target;
    dir = action.dir === -1 ? -1 : 1;
    arc = ctx.helpers.attackArc(me, target, dir, S);
    distance = steps(me, target, dir, S);
    targetKnown = knownSet.has(target);
    targetAge = knownAges.get(target) ?? 99;
  } else if (action.type === 'slip') {
    dir = action.dir === -1 ? -1 : 1;
    distance = action.distance === 2 ? 2 : 1;
    const move = (ctx.legal?.moves ?? []).find(
      (m) => m.dir === dir && m.distance === distance,
    );
    destination = move?.destination ?? null;
    cross = Boolean(move?.cross);
  }

  const targetTerrain = target == null ? null : terrainOf(ctx, target);
  const destTerrain = destination == null ? null : terrainOf(ctx, destination);
  const bombTargets = new Set(ctx.bomb?.targets ?? []);
  const maxObserve = ctx.legal?.observe?.max ?? 1;

  const a = new Array(28).fill(0);
  a[0] = action.type === 'hide' ? 1 : 0;
  a[1] = action.type === 'observe' ? 1 : 0;
  a[2] = action.type === 'attack' ? 1 : 0;
  a[3] = action.type === 'slip' ? 1 : 0;
  a[4] = dir;
  if (target != null) {
    a[5] = Math.sin((2 * Math.PI * target) / Math.max(1, S));
    a[6] = Math.cos((2 * Math.PI * target) / Math.max(1, S));
  }
  a[7] = clamp(distance / Math.max(1, S));
  a[8] = targetTerrain === 'pillar' ? 1 : 0;
  a[9] = targetTerrain === 'plain' ? 1 : 0;
  a[10] = targetTerrain === 'ruins' ? 1 : 0;
  a[11] = targetKnown ? 1 : 0;
  a[12] = targetKnown ? clamp(targetAge / 10) : 1;
  a[13] = clamp(arc.length / Math.max(1, S));
  a[14] = full ? 1 : 0;
  a[15] = action.type === 'observe' ? clamp(length / Math.max(1, maxObserve)) : 0;
  a[16] = action.type === 'slip' ? distance / 2 : 0;
  a[17] = cross ? 1 : 0;
  a[18] = destTerrain === 'pillar' ? 1 : 0;
  a[19] = destTerrain === 'plain' ? 1 : 0;
  a[20] = destTerrain === 'ruins' ? 1 : 0;
  a[21] = target != null && bombTargets.has(target) ? 1 : 0;
  a[22] = targetKnown && targetAge <= 2 ? 1 : 0;
  a[23] = clamp(knownInArc(arc) / 4);
  a[24] = action.type === 'slip' && destination != null && knownSet.has(destination) ? 1 : 0;
  a[25] = action.type === 'hide' && ctx.legal?.canHideEffective ? 1 : 0;
  a[26] = action.type === 'attack' && targetKnown ? 1 : 0;
  a[27] = 1;

  return v.concat(a);
}

export function chosenIndex(ctx, action) {
  const candidates = candidateActions(ctx);
  return candidates.findIndex((c) => actionEqual(c, action));
}

export function scoreVector(vector, weights) {
  let x = vector;
  for (let layerIndex = 0; layerIndex < weights.layers.length; layerIndex += 1) {
    const layer = weights.layers[layerIndex];
    const out = new Array(layer.b.length).fill(0);
    for (let j = 0; j < layer.b.length; j += 1) {
      let sum = layer.b[j];
      const row = layer.w[j];
      for (let i = 0; i < x.length; i += 1) sum += x[i] * row[i];
      out[j] = sum;
    }
    if (layerIndex < weights.layers.length - 1) {
      for (let j = 0; j < out.length; j += 1) out[j] = Math.max(0, out[j]);
    }
    x = out;
  }
  return x[0] ?? 0;
}
