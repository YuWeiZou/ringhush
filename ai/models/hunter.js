import {
  attackAction,
  blindAttack,
  bombEscape,
  compartmentGuard,
  endgameMove,
  observeAction,
  pillarMove,
  rankedTargets,
  refreshKnown,
} from '../lib/common.js';

export const meta = {
  id: 'hunter',
  name: '猎手',
  version: '2.3.3',
  generation: 11,
  style: { aggression: 0.8, observation: 0.35, hide: 0.35, trapCommit: 1.0, blindFire: 0.55, longArc: 0.8, compartmentClear: 0.55, bombCaution: 0.65 },
  description: '2.3.3：轰炸/废墟逃生不锁；全已知只搜可达池；枪声半区修正。',
};

export function chooseAction(ctx) {
  refreshKnown(ctx);

  const escape = bombEscape(ctx);
  if (escape) return escape;

  const reposition = endgameMove(ctx);
  if (reposition) return reposition;

  const alive = ctx.players.filter((p) => p.alive).length;
  const targets = rankedTargets(ctx, alive <= 2 ? 2 : 3);
  if (targets.length) {
    const target = targets[0];
    // 原上的红点大概率还在；柱上的旧信息可能已经藏了。
    if (target.terrain === 'plain' || target.age <= 1 || ctx.random() < 0.65) {
      return attackAction(ctx, target.segment);
    }
  }

  const guard = compartmentGuard(ctx, { chance: 0.65, minLevel: 3, onlyNear: true });
  if (guard) return guard;

  const blind = blindAttack(ctx, { chance: 0.55 });
  if (blind) return blind;

  if (ctx.legal.canHideEffective) {
    const stale = ctx.round - (ctx.memory.lastObserveRound ?? -99) >= 2;
    if (stale || ctx.random() < 0.3) {
      ctx.memory.lastObserveRound = ctx.round;
      return observeAction(ctx);
    }
    return { type: 'hide' };
  }

  // 原上：没有目标时优先找一个柱子；找不到就整圈观察。
  const pillar = pillarMove(ctx);
  if (pillar && ctx.random() < 0.75) {
    return { type: 'slip', dir: pillar.dir, distance: pillar.distance };
  }
  return observeAction(ctx);
}
