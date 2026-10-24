/**
 * Declarative external AI profiles.
 *
 * A profile is data, not code: a default style plus an ordered list of rules.
 * The first matching rule overrides the style; later rules are ignored.
 */
import {
  attackAction,
  blindAttack,
  blindTargets,
  bombDanger,
  bombEscape,
  bombTargets,
  compartmentGuard,
  compartmentRisk,
  compartmentSegments,
  endgameMove,
  futureBlocked,
  hasMovementSpace,
  lockAttack,
  observeAction,
  optionInfo,
  pillarMove,
  rankedTargets,
  refreshKnown,
} from './common.js';

export const STYLE_KEYS = [
  'aggression',
  'observation',
  'hide',
  'trapCommit',
  'blindFire',
  'longArc',
  'compartmentClear',
  'bombCaution',
];

export const EXTERNAL_LIMITS = {
  maxBytes: 128 * 1024,
  maxRules: 256,
  maxConditionsPerRule: 32,
  maxTotalConditions: 2048,
  maxEstimatedBytes: 1024 * 1024,
};

const CONDITION_KEYS = new Set([
  'phase', 'bombMode', 'round', 'alive', 'initialPlayers', 'aliveRatio',
  'ruinsCount', 'ruinsRatio', 'componentCount', 'largestComponentSize',
  'largestComponentShare', 'myComponentSize', 'myComponentShare', 'myExitCount',
  'myChokePoint', 'bombTargetCount', 'bombTargetOnMe', 'bombTargetInMyCompartment',
  'bombTargetDistance', 'futureBlockedCount', 'playerDensity',
  'myCompartmentPressure', 'deathsByGun', 'deathsBySlip', 'deathsByBomb',
  'deathsLast3Rounds', 'knownTargetCount', 'knownTargetAge', 'knownTargetDistance',
  'knownTargetOnPillar', 'lastObserveRound', 'roundsSinceLastObserve',
  'candidateCount', 'candidateConcentration', 'blindConfidence', 'myTerrain',
  'canHideEffective', 'legalMoveCount', 'bombOnMe', 'samePositionRounds',
  'roundsSinceLastAttack', 'roundsSinceLastMove', 'slipDeathsThisGame',
  'gunDeathsThisGame', 'compartmentRisk', 'nearUnclearedCount',
  'unclearedCompartmentCount', 'lockedLastEnemy',
  'targetHasNoMoves', 'lastAction',
]);

const DEFAULT_STYLE = Object.fromEntries(STYLE_KEYS.map((k) => [k, 0.5]));

function componentStats(ctx) {
  const blocked = futureBlocked(ctx);
  const seen = new Set();
  const components = [];
  for (const cell of ctx.map ?? []) {
    if (blocked.has(cell.index) || seen.has(cell.index)) continue;
    const comp = compartmentSegments(ctx, cell.index, blocked);
    for (const segment of comp) seen.add(segment);
    components.push(comp);
  }
  const largest = components.reduce((n, comp) => Math.max(n, comp.length), 0);
  return {
    count: components.length,
    largest,
    largestShare: ctx.S ? largest / ctx.S : 0,
  };
}

function conditionContext(ctx) {
  const alivePlayers = ctx.players.filter((p) => p.alive);
  const alive = alivePlayers.length;
  const initial = ctx.players.length || Math.max(1, alive);
  const blocked = futureBlocked(ctx);
  const components = componentStats(ctx);
  const myComp = compartmentSegments(ctx, ctx.me.position, blocked);
  const myInfo = optionInfo(ctx, ctx.me.position, blocked);
  const known = refreshKnown(ctx)
    .filter((k) => k.segment !== ctx.me.position)
    .sort((a, b) => b.round - a.round);
  const lastObserve = (ctx.privateLog ?? [])
    .filter((e) => e.type === 'observe')
    .reduce((n, e) => Math.max(n, e.round ?? 0), 0);
  const candidates = blindTargets(ctx);
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  const topWeight = candidates[0]?.weight ?? 0;
  const publicDeaths = (ctx.publicLog ?? []).filter((e) => e.type === 'death');
  const deathCauses = { gun: 0, slip: 0, bomb: 0 };
  for (const death of publicDeaths) {
    if (death.cause === 'gun') deathCauses.gun += 1;
    else if (death.cause === 'slip') deathCauses.slip += 1;
    else if (death.cause === 'bomb') deathCauses.bomb += 1;
  }
  const recentDeaths = publicDeaths.filter((e) => ctx.round - (e.round ?? 0) <= 3).length;
  const target = known[0];
  const targetNoMoves = target ? !hasMovementSpace(ctx, target.segment) : false;
  const targetDistance = target
    ? Math.min(
        ctx.helpers.steps(ctx.me.position, target.segment, 1, ctx.S),
        ctx.helpers.steps(ctx.me.position, target.segment, -1, ctx.S),
      )
    : 999;
  const locked = target ? lockAttack(ctx) : null;

  return {
    phase: ctx.bomb?.mode === 'fast' ? 2 : ctx.bomb?.mode === 'double' ? 3 : 1,
    bombMode: ctx.bomb?.mode ?? 'normal',
    round: ctx.round,
    alive,
    initialPlayers: initial,
    aliveRatio: alive / initial,
    ruinsCount: (ctx.map ?? []).filter((c) => c.ruins || c.terrain === 'ruins').length,
    ruinsRatio: (ctx.map ?? []).filter((c) => c.ruins || c.terrain === 'ruins').length / Math.max(1, ctx.S),
    componentCount: components.count,
    largestComponentSize: components.largest,
    largestComponentShare: components.largestShare,
    myComponentSize: myComp.length,
    myComponentShare: myComp.length / Math.max(1, ctx.S),
    myExitCount: myInfo.options,
    myChokePoint: myInfo.options <= 1,
    bombTargetCount: bombTargets(ctx).length,
    bombTargetOnMe: bombTargets(ctx).includes(ctx.me.position),
    bombTargetInMyCompartment: bombTargets(ctx).some((t) => myComp.includes(t)),
    bombTargetDistance: bombTargets(ctx).length
      ? Math.min(...bombTargets(ctx).map((t) => Math.min(
          ctx.helpers.steps(ctx.me.position, t, 1, ctx.S),
          ctx.helpers.steps(ctx.me.position, t, -1, ctx.S),
        )))
      : 999,
    futureBlockedCount: blocked.size,
    playerDensity: alive / Math.max(1, ctx.S),
    myCompartmentPressure: alive / Math.max(1, myComp.length),
    deathsByGun: deathCauses.gun,
    deathsBySlip: deathCauses.slip,
    deathsByBomb: deathCauses.bomb,
    deathsLast3Rounds: recentDeaths,
    knownTargetCount: known.length,
    knownTargetAge: target ? ctx.round - target.round : 999,
    knownTargetDistance: targetDistance,
    knownTargetOnPillar: target ? ctx.map[target.segment]?.terrain === 'pillar' : false,
    lastObserveRound: lastObserve,
    roundsSinceLastObserve: lastObserve ? ctx.round - lastObserve : 999,
    candidateCount: candidates.length,
    candidateConcentration: totalWeight ? topWeight / totalWeight : 0,
    blindConfidence: totalWeight ? topWeight / totalWeight : 0,
    myTerrain: ctx.me.terrain,
    canHideEffective: Boolean(ctx.legal?.canHideEffective),
    legalMoveCount: ctx.legal?.moves?.length ?? 0,
    bombOnMe: bombDanger(ctx),
    samePositionRounds: ctx.memory?.samePositionRounds ?? 0,
    roundsSinceLastAttack: ctx.memory?.lastAttackRound ? ctx.round - ctx.memory.lastAttackRound : 999,
    roundsSinceLastMove: ctx.memory?.lastMoveRound ? ctx.round - ctx.memory.lastMoveRound : 999,
    slipDeathsThisGame: deathCauses.slip,
    gunDeathsThisGame: deathCauses.gun,
    compartmentRisk: compartmentRisk(ctx).level,
    nearUnclearedCount: compartmentRisk(ctx).near.length,
    unclearedCompartmentCount: compartmentRisk(ctx).uncleared.length,
    lockedLastEnemy: Boolean(locked),
    targetHasNoMoves: targetNoMoves,
    lastAction: ctx.memory?.lastAction ?? 'unknown',
  };
}

function countConditions(when) {
  if (!when || typeof when !== 'object') return 0;
  let count = 0;
  if (Array.isArray(when.all) || Array.isArray(when.any)) {
    const list = when.all ?? when.any;
    for (const item of list) count += countConditions(item);
    return count;
  }
  for (const value of Object.values(when)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      count += Object.keys(value).length > 0 ? 1 : 0;
    } else {
      count += 1;
    }
  }
  return count;
}

function compare(value, expected) {
  if (expected == null) return value == null;
  if (Array.isArray(expected)) return expected.includes(value);
  if (typeof expected !== 'object') return value === expected;
  if (Array.isArray(expected.in)) return expected.in.includes(value);
  if ('eq' in expected && !(value === expected.eq)) return false;
  if ('neq' in expected && value === expected.neq) return false;
  if ('gt' in expected && !(value > expected.gt)) return false;
  if ('gte' in expected && !(value >= expected.gte)) return false;
  if ('lt' in expected && !(value < expected.lt)) return false;
  if ('lte' in expected && !(value <= expected.lte)) return false;
  return true;
}

function matches(when, env) {
  if (!when || typeof when !== 'object') return true;
  if (Array.isArray(when.all)) return when.all.every((w) => matches(w, env));
  if (Array.isArray(when.any)) return when.any.some((w) => matches(w, env));
  for (const [key, expected] of Object.entries(when)) {
    if (!CONDITION_KEYS.has(key)) return false;
    if (!compare(env[key], expected)) return false;
  }
  return true;
}

export function resolveStyle(ctx, manifest) {
  const env = conditionContext(ctx);
  const style = { ...DEFAULT_STYLE, ...(manifest.style ?? {}) };
  for (const rule of manifest.rules ?? []) {
    if (matches(rule.when, env)) {
      Object.assign(style, rule.style ?? {});
      break;
    }
  }
  return { style, env };
}

function validateWhen(when, path = 'when') {
  if (when == null) return { count: 0 };
  if (typeof when !== 'object' || Array.isArray(when)) {
    return { error: `${path} 必须是对象` };
  }
  const hasAll = Array.isArray(when.all);
  const hasAny = Array.isArray(when.any);
  if (hasAll || hasAny) {
    if (Object.keys(when).length !== 1) return { error: `${path} 不能混用 all/any 与普通条件` };
    const list = hasAll ? when.all : when.any;
    let count = 0;
    for (const item of list) {
      const sub = validateWhen(item, `${path}.${hasAll ? 'all' : 'any'}`);
      if (sub.error) return sub;
      count += sub.count;
    }
    return { count };
  }
  let count = 0;
  for (const [key, expected] of Object.entries(when)) {
    if (!CONDITION_KEYS.has(key)) return { error: `${path} 未知条件 ${key}` };
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const allowed = new Set(['gte', 'lte', 'gt', 'lt', 'eq', 'neq', 'in']);
      const bad = Object.keys(expected).find((op) => !allowed.has(op));
      if (bad) return { error: `${path}.${key} 未知操作符 ${bad}` };
      if ('in' in expected && !Array.isArray(expected.in)) {
        return { error: `${path}.${key}.in 必须是数组` };
      }
    }
    count += 1;
  }
  return { count };
}

export function validateProfile(manifest, { bytes = 0 } = {}) {
  if (!manifest || typeof manifest !== 'object') return { ok: false, reason: 'model.json 不是对象' };
  if (!manifest.id || !/^[A-Za-z0-9_-]{1,40}$/.test(String(manifest.id))) {
    return { ok: false, reason: 'id 缺失或格式错误' };
  }
  if (!manifest.name || typeof manifest.name !== 'string') return { ok: false, reason: 'name 缺失' };
  if (!Array.isArray(manifest.rules)) return { ok: false, reason: 'rules 必须是数组' };
  if (bytes > EXTERNAL_LIMITS.maxBytes) return { ok: false, overflow: true, reason: '文件过大' };
  if (manifest.rules.length > EXTERNAL_LIMITS.maxRules) {
    return { ok: false, overflow: true, reason: '规则过多' };
  }
  let totalConditions = 0;
  for (const [index, rule] of manifest.rules.entries()) {
    if (!rule || typeof rule !== 'object') return { ok: false, reason: `rule ${index + 1} 不是对象` };
    if (rule.when && typeof rule.when !== 'object') return { ok: false, reason: `rule ${index + 1} when 不是对象` };
    const checked = validateWhen(rule.when, `rule ${index + 1}.when`);
    if (checked.error) return { ok: false, reason: checked.error };
    const n = checked.count;
    if (n > EXTERNAL_LIMITS.maxConditionsPerRule) {
      return { ok: false, overflow: true, reason: `rule ${index + 1} 条件过多` };
    }
    totalConditions += n;
    for (const key of Object.keys(rule.style ?? {})) {
      if (!STYLE_KEYS.includes(key)) return { ok: false, reason: `rule ${index + 1} 未知 style.${key}` };
      const value = Number(rule.style[key]);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        return { ok: false, reason: `rule ${index + 1} style.${key} 必须是 0..1` };
      }
    }
  }
  if (totalConditions > EXTERNAL_LIMITS.maxTotalConditions) {
    return { ok: false, overflow: true, reason: '条件总数过多' };
  }
  for (const key of Object.keys(manifest.style ?? {})) {
    if (!STYLE_KEYS.includes(key)) return { ok: false, reason: `未知 style.${key}` };
    const value = Number(manifest.style[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return { ok: false, reason: `style.${key} 必须是 0..1` };
    }
  }
  const estimated = bytes + manifest.rules.length * 256 + totalConditions * 64;
  if (estimated > EXTERNAL_LIMITS.maxEstimatedBytes) {
    return { ok: false, overflow: true, reason: '估算内存过大' };
  }
  return { ok: true, conditions: totalConditions, estimated };
}

export function createProfileModel(manifest, { file = 'model.json' } = {}) {
  const meta = {
    id: String(manifest.id),
    name: String(manifest.name),
    version: String(manifest.version ?? '1.0.0'),
    generation: 1,
    description: String(manifest.description ?? '外部 JSON 条件模型'),
    default: false,
    external: true,
    randomPool: false,
    usable: true,
    status: 'ok',
    file,
    style: { ...DEFAULT_STYLE, ...(manifest.style ?? {}) },
  };

  async function chooseAction(ctx) {
    const locked = lockAttack(ctx);
    if (locked) return locked;
    const { style } = resolveStyle(ctx, manifest);

    if (ctx.random() < style.bombCaution) {
      const escape = bombEscape(ctx);
      if (escape) return escape;
    }
    if (ctx.random() < style.compartmentClear) {
      const move = endgameMove(ctx);
      if (move) return move;
    }
    const targets = rankedTargets(ctx, 2);
    const trapped = (ctx.legal.moves?.length ?? 0) === 0;
    if (targets.length && trapped && ctx.random() < style.trapCommit) {
      return attackAction(ctx, targets[0].segment, { mode: ctx.me.terrain === 'pillar' && ctx.map[targets[0].segment]?.terrain === 'pillar' ? 'long' : 'auto' });
    }
    if (targets.length && ctx.random() < style.aggression) {
      const target = targets[0];
      const bothPillars = ctx.me.terrain === 'pillar' && ctx.map[target.segment]?.terrain === 'pillar';
      return attackAction(ctx, target.segment, {
        mode: bothPillars && style.longArc >= 0.5 ? 'long' : 'auto',
      });
    }
    if (ctx.random() < style.compartmentClear) {
      const guard = compartmentGuard(ctx, { chance: 1, minLevel: 3, onlyNear: true });
      if (guard) return guard;
    }
    if (ctx.random() < style.blindFire) {
      const blind = blindAttack(ctx);
      if (blind) return blind;
    }
    if (ctx.legal.canHideEffective && ctx.random() < style.hide) {
      return { type: 'hide' };
    }
    if (ctx.random() < style.observation) {
      return observeAction(ctx);
    }
    if (targets.length && ctx.random() < style.aggression * 0.5) {
      return attackAction(ctx, targets[0].segment);
    }
    if (ctx.legal.canHideEffective) {
      const pillar = pillarMove(ctx);
      if (pillar && ctx.random() < style.hide) {
        return { type: 'slip', dir: pillar.dir, distance: pillar.distance };
      }
    }
    return observeAction(ctx);
  }

  return { meta, chooseAction };
}

export { CONDITION_KEYS, DEFAULT_STYLE };
