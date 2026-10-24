/**
 * AI 模型共用工具。
 *
 * 注意：模型只能通过 ctx 读信息；ctx.players 不含任何人的位置。
 * 这里所有“已知位置”都来自模型自己的私密日志（观测红点/攻击结果），
 * 不允许从引擎直接读取其他玩家的 position。
 */

function latestClue(ctx, maxAge = 4) {
  const clues = (ctx.privateLog ?? []).filter(
    (e) => e.type === 'clue' && e.kind === 'half' && Number.isInteger(e.from) && ctx.round - e.round <= maxAge,
  );
  return clues.length ? clues[clues.length - 1] : null;
}

function clueAllows(ctx, segment, clue) {
  if (!clue) return true;
  if (!ctx.helpers?.halfPlane) return true;
  const half = ctx.helpers.halfPlane(clue.from, segment, ctx.S);
  return clue.half === 'same' ? half === 'same' : half === clue.half;
}

export function refreshKnown(ctx) {
  const known = new Map();
  let lastObserveRound = ctx.memory.lastObserveRound ?? 0;

  for (const e of ctx.privateLog ?? []) {
    if (e.type === 'observe') {
      for (const segment of e.segments ?? []) {
        known.set(segment, { segment, round: e.round, source: 'observe' });
      }
      if (e.round >= lastObserveRound) lastObserveRound = e.round;
    } else if (e.type === 'attack') {
      // 开火结果不公开：不能从“空/挡/中”推断该段是否有人。
      // 攻击只说明“我向该段开了一枪”，不构成已知位置。
    }
  }

  const clue = latestClue(ctx);
  const filtered = clue
    ? [...known.values()].filter((k) => clueAllows(ctx, k.segment, clue))
    : [...known.values()];
  ctx.memory.lastObserveRound = lastObserveRound;
  ctx.memory.known = filtered;
  return ctx.memory.known;
}

export function bombTargets(ctx) {
  return ctx.bomb?.targets ?? (ctx.bomb?.target == null ? [] : [ctx.bomb.target]);
}

export function bombDanger(ctx) {
  return bombTargets(ctx).includes(ctx.me.position) && ctx.bomb.targetRound > ctx.round;
}

function existingRuinBlocked(ctx) {
  const blocked = new Set();
  for (const cell of ctx.map ?? []) {
    if (cell.ruins || cell.terrain === 'ruins') blocked.add(cell.index);
  }
  return blocked;
}

/** Does a player standing on `position` have any legal slip at all? */
export function hasMovementSpace(ctx, position) {
  const blocked = existingRuinBlocked(ctx);
  return nextOpenSegments(ctx, position, blocked).length > 0;
}

/**
 * Universal 1v1 lock: the last opponent was observed, is the only enemy left,
 * and has no legal movement from that segment. The position can no longer
 * change, so the AI should keep firing (long arc) instead of peeking.
 * This is intentionally the only forced "known information" rule.
 */
export function lockedDuelTarget(ctx) {
  const alive = ctx.players.filter((p) => p.alive);
  if (alive.length !== 2) return null;
  const known = refreshKnown(ctx)
    .filter((k) => k.segment !== ctx.me.position && ctx.round - k.round <= 2)
    .sort((a, b) => b.round - a.round);
  const target = known[0];
  if (!target) return null;
  // A target standing on the announced bomb segment is not a fixed target: it
  // will move (or die), so locking onto it is exactly the stubborn behavior we
  // want to avoid.
  if (bombTargets(ctx).includes(target.segment)) return null;
  if (hasMovementSpace(ctx, target.segment)) return null;
  return target;
}

export function lockAttack(ctx) {
  const target = lockedDuelTarget(ctx);
  if (!target) return null;
  // A guaranteed duel shot is not worth standing in an avoidable bombing
  // target. Give the model the move-vs-shoot choice instead of forcing fire.
  if (bombDanger(ctx) && bombEscape(ctx)) return null;
  return attackAction(ctx, target.segment, { mode: 'long' });
}

function modIndex(i, n) {
  return ((i % n) + n) % n;
}

/**
 * Segments that will be unavailable soon: existing ruins plus the currently
 * announced bomb targets. Endgame movement uses this to avoid walking into a
 * pocket that the next bombing will seal off.
 */
export function futureBlocked(ctx) {
  const blocked = new Set();
  for (const cell of ctx.map ?? []) {
    if (cell.ruins || cell.terrain === 'ruins') blocked.add(cell.index);
  }
  for (const target of bombTargets(ctx)) blocked.add(target);
  return blocked;
}

function nextOpenSegments(ctx, position, blocked) {
  const out = new Set();
  for (const dir of [1, -1]) {
    const next = modIndex(position + dir, ctx.S);
    if (!blocked.has(next)) {
      out.add(next);
      continue;
    }
    // A single ruin can be crossed from the plain side; treat that as one
    // future option too. Consecutive ruins remain a wall.
    if (ctx.map[position]?.terrain === 'plain') {
      const after = modIndex(next + dir, ctx.S);
      if (!blocked.has(after)) out.add(after);
    }
  }
  return [...out];
}

/** How many exits / how large a pocket is reachable from a segment. */
export function optionInfo(ctx, position, blocked = futureBlocked(ctx)) {
  const seen = new Set([position]);
  let frontier = [position];
  let options = 0;
  for (let depth = 1; depth <= 2; depth++) {
    const nextFrontier = [];
    for (const pos of frontier) {
      for (const next of nextOpenSegments(ctx, pos, blocked)) {
        if (seen.has(next)) continue;
        seen.add(next);
        nextFrontier.push(next);
        options += depth === 1 ? 2 : 1;
      }
    }
    frontier = nextFrontier;
    if (!frontier.length) break;
  }
  // Full component size, capped: is this side of the ring a dead end?
  const componentSeen = new Set([position]);
  const queue = [position];
  while (queue.length) {
    const pos = queue.shift();
    for (const next of nextOpenSegments(ctx, pos, blocked)) {
      if (componentSeen.has(next)) continue;
      componentSeen.add(next);
      if (componentSeen.size <= 16) queue.push(next);
    }
  }
  return { options, component: componentSeen.size };
}

/** All segments reachable from a spot without crossing a sealed ruin wall. */
export function compartmentSegments(ctx, start = ctx.me.position, blocked = futureBlocked(ctx)) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const pos = queue.shift();
    for (const next of nextOpenSegments(ctx, pos, blocked)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen];
}

/**
 * Midgame "clear the compartment" check: after bombing has started, a small
 * enclosed region means someone can be sharing it with us, and a pillar hide
 * does not protect against a slip from an adjacent segment.
 */
export function compartmentRisk(ctx) {
  const alive = ctx.players.filter((p) => p.alive).length;
  if (alive <= 1) return { level: 0, region: [], uncleared: [], near: [], camped: false };
  const blocked = futureBlocked(ctx);
  const region = compartmentSegments(ctx, ctx.me.position, blocked);
  const hasBarrier = blocked.size > 0;
  if (!hasBarrier || region.length < 2 || region.length > 6) {
    return { level: 0, region, uncleared: [], near: [], camped: false };
  }
  const known = new Set(
    refreshKnown(ctx)
      .filter((k) => ctx.round - k.round <= 2)
      .map((k) => k.segment),
  );
  const uncleared = region.filter(
    (segment) => segment !== ctx.me.position && !known.has(segment) && !blocked.has(segment),
  );
  const near = uncleared.filter((segment) => {
    const d1 = ctx.helpers.steps(ctx.me.position, segment, 1, ctx.S);
    const d2 = ctx.helpers.steps(ctx.me.position, segment, -1, ctx.S);
    return Math.min(d1, d2) <= 2;
  });
  const same = ctx.memory.lastPosition === ctx.me.position
    ? (ctx.memory.samePositionRounds ?? 0) + 1
    : 1;
  const camped = same >= 2;
  let level = 0;
  if (near.length) level += 2;
  if (region.length <= 4) level += 1;
  if (!known.size) level += 1;
  if (camped) level += 1;
  return { level, region, uncleared, near, camped };
}

/** Observation that specifically covers the uncleared part of our compartment. */
export function compartmentObservation(ctx) {
  if (ctx.legal.observe.full) {
    return { type: 'observe', dir: 1, length: ctx.S, full: true };
  }
  const max = ctx.legal.observe.max ?? Math.max(1, Math.floor(ctx.S / 2));
  const risk = compartmentRisk(ctx);
  if (!risk.region.length) return observeAction(ctx);
  const targets = new Set(risk.near.length ? risk.near : risk.uncleared);
  let best = null;
  for (const dir of [1, -1]) {
    const arc = ctx.helpers.observeSegments(ctx.me.position, dir, max, ctx.S);
    let score = 0;
    for (const segment of targets) if (arc.includes(segment)) score += 2;
    for (const segment of risk.region) if (arc.includes(segment)) score += 0.4;
    if (!best || score > best.score) best = { dir, score };
  }
  return { type: 'observe', dir: best?.dir ?? 1, length: max };
}

/** If the compartment is small and an uncleared approach is near, clear it. */
export function compartmentGuard(ctx, { chance = 1, minLevel = 3, onlyNear = false } = {}) {
  const living = ctx.players.filter((p) => p.alive).length;
  if (living < 3) return null;
  const risk = compartmentRisk(ctx);
  if (risk.level < minLevel) return null;
  if (onlyNear && !risk.near.length) return null;
  if (!risk.near.length && risk.region.length > 4) return null;
  if (ctx.random() > chance) return null;
  ctx.memory.lastObserveRound = ctx.round;
  return compartmentObservation(ctx);
}

export function rankedMoves(ctx) {
  const recent = new Set(
    refreshKnown(ctx)
      .filter((k) => ctx.round - k.round <= 2)
      .map((k) => k.segment),
  );
  const alive = ctx.players.filter((p) => p.alive).length;
  const endgame =
    alive <= 3 ||
    (alive <= 5 && (ctx.bomb?.mode === 'fast' || ctx.bomb?.mode === 'double'));
  const blocked = futureBlocked(ctx);
  const here = optionInfo(ctx, ctx.me.position, blocked);
  return (ctx.legal.moves ?? [])
    .map((move) => {
      const terrain = ctx.map[move.destination]?.terrain;
      let score = 0;
      if (terrain === 'pillar') score += 3;
      else if (terrain === 'plain') score += 1;
      if (bombTargets(ctx).includes(move.destination)) score -= 10;
      if (recent.has(move.destination)) score -= 2;
      if (move.distance === 1) score += 1;
      if (move.cross) score -= 0.5;
      if (endgame) {
        const there = optionInfo(ctx, move.destination, blocked);
        score += Math.min(there.options, 8) * 0.9;
        score += Math.min(there.component, 8) * 0.45;
        if (here.options <= 2 && there.options > here.options) score += 3;
        if (here.component <= 3 && there.component > here.component) score += 3;
      }
      return { ...move, score };
    })
    .sort((a, b) => b.score - a.score || a.distance - b.distance);
}

/**
 * Endgame repositioning: leave a small pocket / choke point before the next
 * bomb turns it into a waiting room. Returns null when the current spot is OK.
 */
export function endgameMove(ctx) {
  const alive = ctx.players.filter((p) => p.alive).length;
  const crisis =
    alive <= 3 ||
    (alive <= 5 && (ctx.bomb?.mode === 'fast' || ctx.bomb?.mode === 'double'));
  if (!crisis) return null;

  // Track how long we have been sitting still; a predictable camp is a blind
  // shot magnet in the last two/three.
  const same = ctx.memory.lastPosition === ctx.me.position
    ? (ctx.memory.samePositionRounds ?? 0) + 1
    : 1;
  ctx.memory.lastPosition = ctx.me.position;
  ctx.memory.samePositionRounds = same;

  const blocked = futureBlocked(ctx);
  const here = optionInfo(ctx, ctx.me.position, blocked);
  const moves = rankedMoves(ctx);
  const best = moves[0];
  if (!best) return null;
  const there = optionInfo(ctx, best.destination, blocked);

  const trapped = here.options <= 2 || here.component <= 3;
  const clearlyBetter =
    there.options >= here.options + 2 || there.component >= here.component + 3;
  const choke = here.options <= 1 && there.options > here.options;
  const predictable = same >= 2 && alive <= 3 && here.options <= 2 && there.options > here.options;

  if ((trapped && clearlyBetter) || choke || predictable) {
    return { type: 'slip', dir: best.dir, distance: best.distance };
  }
  return null;
}

/**
 * Candidate positions from private observations, expanded by possible movement
 * since the observation. This is an elimination pool, not hidden engine state.
 */
export function reachableKnownPool(ctx, maxAge = 2) {
  const alive = ctx.players.filter((p) => p.alive).length;
  if (alive <= 1) return null;
  const known = refreshKnown(ctx).filter(
    (k) => k.segment !== ctx.me.position && ctx.round - k.round <= maxAge,
  );
  if (known.length < alive - 1) return null;

  const blocked = existingRuinBlocked(ctx);
  const clue = latestClue(ctx);
  const weight = new Map();
  const add = (segment, w) => {
    if (segment === ctx.me.position || blocked.has(segment)) return;
    if (clue && !clueAllows(ctx, segment, clue)) return;
    weight.set(segment, (weight.get(segment) ?? 0) + w);
  };

  for (const k of known) {
    const age = ctx.round - k.round;
    add(k.segment, 1 / (1 + age));
    for (const next of nextOpenSegments(ctx, k.segment, blocked)) {
      add(next, 0.8 / (1 + age));
      // A player on plain can take a two-step move; only expand that second
      // step when the first segment is plain (not a ruin crossing).
      if (ctx.map[k.segment]?.terrain === 'plain' && ctx.map[next]?.terrain === 'plain') {
        for (const after of nextOpenSegments(ctx, next, blocked)) add(after, 0.5 / (1 + age));
      }
    }
  }
  if (!weight.size) return null;
  return [...weight.entries()]
    .map(([segment, w]) => ({
      segment,
      weight: w,
      terrain: ctx.map[segment]?.terrain ?? 'plain',
    }))
    .sort((a, b) => b.weight - a.weight || a.segment - b.segment);
}

export function blindTargets(ctx, maxAge = 4) {
  const knownPool = reachableKnownPool(ctx);
  if (knownPool) return knownPool;
  const blocked = futureBlocked(ctx);
  const observations = (ctx.privateLog ?? []).filter(
    (e) => e.type === 'observe' && ctx.round - e.round <= maxAge,
  );
  const weight = new Map();
  const clue = latestClue(ctx);
  const add = (segment, w) => {
    if (segment === ctx.me.position || blocked.has(segment)) return;
    if (clue && !clueAllows(ctx, segment, clue)) return;
    weight.set(segment, (weight.get(segment) ?? 0) + w);
  };

  if (!observations.length) {
    // No private sighting: all open segments are candidates, but no confidence.
    for (const cell of ctx.map ?? []) {
      if (!blocked.has(cell.index)) add(cell.index, 0.2);
    }
  } else {
    for (const observation of observations) {
      const age = ctx.round - observation.round;
      const radius = Math.min(5, age * 2 + 1);
      const seen = new Set();
      let frontier = [...(observation.segments ?? [])];
      for (const segment of frontier) seen.add(segment);
      for (let depth = 0; depth <= radius; depth++) {
        const nextFrontier = [];
        for (const pos of frontier) {
          add(pos, 1 / (1 + age + depth * 0.6));
          for (const next of nextOpenSegments(ctx, pos, blocked)) {
            if (seen.has(next)) continue;
            seen.add(next);
            nextFrontier.push(next);
          }
        }
        frontier = nextFrontier;
        if (!frontier.length) break;
      }
    }
  }

  return [...weight.entries()]
    .map(([segment, w]) => ({
      segment,
      weight: w,
      terrain: ctx.map[segment]?.terrain ?? 'plain',
    }))
    .sort((a, b) => b.weight - a.weight || a.segment - b.segment);
}

/**
 * Endgame blind shot: only fires when the elimination pool is small enough to
 * give one segment a meaningful probability. If an enemy is likely camping a
 * known pillar, this is also the counter-blind shot.
 */
export function blindAttack(ctx, { chance = 0.55 } = {}) {
  const alive = ctx.players.filter((p) => p.alive).length;
  if (alive > 3) return null;
  const candidates = blindTargets(ctx, alive <= 2 ? 3 : 4);
  if (!candidates.length) return null;
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  const best = candidates[0];
  if (!total || best.weight / total < 0.22) return null;
  if (ctx.random() > chance) return null;
  return attackAction(ctx, best.segment);
}

export function bombEscape(ctx) {
  if (!bombDanger(ctx)) return null;
  const best = rankedMoves(ctx)[0];
  if (!best) return null;
  return { type: 'slip', dir: best.dir, distance: best.distance };
}

export function pillarMove(ctx) {
  return (
    rankedMoves(ctx).find(
      (m) =>
        ctx.map[m.destination]?.terrain === 'pillar' &&
        !bombTargets(ctx).includes(m.destination),
    ) ?? null
  );
}

export function rankedTargets(ctx, maxAge = 3) {
  const known = refreshKnown(ctx);
  return known
    .filter((k) => k.segment !== ctx.me.position && ctx.round - k.round <= maxAge)
    .map((k) => {
      const terrain = ctx.map[k.segment]?.terrain ?? 'plain';
      const d1 = ctx.helpers.steps(ctx.me.position, k.segment, 1, ctx.S);
      const d2 = ctx.helpers.steps(ctx.me.position, k.segment, -1, ctx.S);
      return {
        ...k,
        age: ctx.round - k.round,
        terrain,
        arc: Math.min(d1, d2),
      };
    })
    .sort((a, b) => {
      // 原上的目标大概率仍然暴露；柱上的目标可能已经藏了
      const ta = a.terrain === 'plain' ? 0 : 1;
      const tb = b.terrain === 'plain' ? 0 : 1;
      return ta - tb || a.age - b.age || a.arc - b.arc;
    });
}

export function attackAction(ctx, target, { mode = 'auto' } = {}) {
  if (target == null || target === ctx.me.position) return null;
  const d1 = ctx.helpers.steps(ctx.me.position, target, 1, ctx.S);
  const d2 = ctx.helpers.steps(ctx.me.position, target, -1, ctx.S);
  const shortDir = d1 <= d2 ? 1 : -1;
  const longDir = -shortDir;
  const bothPillars =
    ctx.me.terrain === 'pillar' && ctx.map[target]?.terrain === 'pillar';
  const alive = aliveCount(ctx);

  let dir = shortDir;
  if (mode === 'long') {
    dir = longDir;
  } else if (mode === 'short') {
    dir = shortDir;
  } else if (bothPillars && alive <= 2) {
    // 1v1 对枪：长弧赢互射；没有第三方，长弧暴露的代价最低。
    dir = longDir;
  } else if (bothPillars && alive <= 4) {
    // 小规模混战：长/短混合，避免被读死。
    dir = ctx.random() < 0.5 ? longDir : shortDir;
  }
  return { type: 'attack', target, dir };
}

function observationLength(ctx, style = 'search') {
  const S = ctx.S;
  const alive = aliveCount(ctx);
  let base;
  if (style === 'wide') base = Math.ceil(S * 0.6);
  else if (style === 'narrow') base = Math.max(2, Math.ceil(S * 0.2));
  else if (alive <= 2) base = Math.ceil(S * 0.5);
  else if (alive <= 4) base = Math.ceil(S * 0.35);
  else base = Math.max(2, Math.ceil(S * 0.25));
  const max = ctx.legal.observe.max ?? Math.max(1, Math.floor(S / 2));
  return Math.max(1, Math.min(max, S - 1, base));
}

function observationDirection(ctx, length) {
  const known = refreshKnown(ctx).filter(
    (k) => k.segment !== ctx.me.position && ctx.round - k.round <= 3,
  );
  if (known.length) {
    let best = null;
    for (const dir of [1, -1]) {
      const arc = ctx.helpers.observeSegments(ctx.me.position, dir, length, ctx.S);
      let score = 0;
      for (const k of known) {
        if (arc.includes(k.segment)) score += 4 - (ctx.round - k.round);
      }
      if (!best || score > best.score) best = { dir, score };
    }
    if (best) return best.dir;
  }
  const dir = ctx.memory.observeDir === -1 ? -1 : 1;
  ctx.memory.observeDir = dir === 1 ? -1 : 1;
  return dir;
}

function observationForPool(ctx, pool) {
  const max = ctx.legal.observe.max ?? Math.max(1, Math.floor(ctx.S / 2));
  let best = null;
  for (const dir of [1, -1]) {
    for (let length = 1; length <= max; length += 1) {
      const arc = ctx.helpers.observeSegments(ctx.me.position, dir, length, ctx.S);
      const set = new Set(arc);
      let score = 0;
      for (const candidate of pool) if (set.has(candidate.segment)) score += candidate.weight;
      score -= length * 0.03;
      if (!best || score > best.score) best = { dir, length, score };
    }
  }
  return best;
}

export function observeAction(ctx, { style = 'search', full = false } = {}) {
  if (ctx.legal.observe.full) {
    // 原上按规则就是整圈；这不是 AI 参数，是地形强制。
    return { type: 'observe', dir: 1, length: ctx.S, full: true };
  }
  const reachable = reachableKnownPool(ctx);
  if (reachable?.length) {
    const best = observationForPool(ctx, reachable);
    if (best) return { type: 'observe', dir: best.dir, length: best.length };
  }
  const knownTarget = rankedTargets(ctx, 3)[0];
  let length = observationLength(ctx, style);
  if (knownTarget) {
    const d1 = ctx.helpers.steps(ctx.me.position, knownTarget.segment, 1, ctx.S);
    const d2 = ctx.helpers.steps(ctx.me.position, knownTarget.segment, -1, ctx.S);
    length = Math.max(2, Math.min(length, Math.min(d1, d2) + 1));
  }
  const max = ctx.legal.observe.max ?? Math.max(1, Math.floor(ctx.S / 2));
  if (full) length = max;
  length = Math.max(1, Math.min(max, length));
  const dir = observationDirection(ctx, length);
  return { type: 'observe', dir, length };
}

export function hideAction(ctx) {
  return ctx.legal.canHide ? { type: 'hide' } : null;
}

export function aliveCount(ctx) {
  return ctx.players.filter((p) => p.alive).length;
}

export function pick(list, random) {
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)];
}
