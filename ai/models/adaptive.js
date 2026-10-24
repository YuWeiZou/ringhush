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
import { chooseAction as hunterAction } from './hunter.js';

export const meta = {
  id: 'adaptive',
  name: '适应者',
  version: '2.3.3',
  generation: 11,
  default: true,
  style: { aggression: 0.62, observation: 0.45, hide: 0.5, trapCommit: 0.9, blindFire: 0.5, longArc: 0.65, compartmentClear: 0.65, bombCaution: 0.75 },
  description: '2.3.3：轰炸/废墟逃生不锁；全已知只搜可达池；枪声半区修正；按人数调整。',
};

export function chooseAction(ctx) {
  const alive = ctx.players.filter((p) => p.alive).length;
  // 2 人残局直接使用猎手的搜索/攻击节奏。
  if (alive <= 2) return hunterAction(ctx);

  refreshKnown(ctx);

  const escape = bombEscape(ctx);
  if (escape) return escape;

  const reposition = endgameMove(ctx);
  if (reposition) return reposition;

  const targets = rankedTargets(ctx, 2);
  if (targets.length) {
    const target = targets[0];
    const aggression = alive <= 5 ? 0.55 : 0.3;
    const strong =
      (target.terrain === 'plain' && target.age <= 1) ||
      (alive <= 3 && target.age <= 2);
    if (strong || ctx.random() < aggression) {
      return attackAction(ctx, target.segment);
    }
  }

  const guard = compartmentGuard(ctx, { chance: 0.55, minLevel: 3, onlyNear: true });
  if (guard) return guard;

  const blind = blindAttack(ctx, { chance: 0.5 });
  if (blind) return blind;

  if (ctx.legal.canHideEffective) {
    const since = ctx.round - (ctx.memory.lastObserveRound ?? -99);
    const searchChance = alive <= 3 ? 0.55 : alive <= 5 ? 0.35 : 0.2;
    if (since >= 2 && ctx.random() < searchChance) {
      ctx.memory.lastObserveRound = ctx.round;
      return observeAction(ctx);
    }
    return { type: 'hide' };
  }

  const pillar = pillarMove(ctx);
  if (pillar) {
    return { type: 'slip', dir: pillar.dir, distance: pillar.distance };
  }
  return observeAction(ctx);
}
