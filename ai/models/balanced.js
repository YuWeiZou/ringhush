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
  id: 'balanced',
  name: '灰烬',
  version: '2.3.3',
  generation: 8,
  style: { aggression: 0.55, observation: 0.5, hide: 0.5, trapCommit: 0.8, blindFire: 0.45, longArc: 0.6, compartmentClear: 0.6, bombCaution: 0.8 },
  description: '2.3：1v1锁定必杀；中局排点；残局换区与盲狙；长/短弧混合。',
};

export function chooseAction(ctx) {
  refreshKnown(ctx);

  const escape = bombEscape(ctx);
  if (escape) return escape;

  const reposition = endgameMove(ctx);
  if (reposition) return reposition;

  const targets = rankedTargets(ctx, 2);
  if (targets.length) {
    const target = targets[0];
    if (target.terrain === 'plain' || target.age <= 1 || ctx.random() < 0.5) {
      return attackAction(ctx, target.segment);
    }
  }

  const guard = compartmentGuard(ctx, { chance: 0.6, minLevel: 3, onlyNear: true });
  if (guard) return guard;

  const blind = blindAttack(ctx, { chance: 0.45 });
  if (blind) return blind;

  if (ctx.legal.canHideEffective) {
    const last = ctx.memory.lastObserveRound ?? -99;
    if (ctx.round - last >= 1 && ctx.random() < 0.62) {
      ctx.memory.lastObserveRound = ctx.round;
      return observeAction(ctx, { style: 'search' });
    }
    return { type: 'hide' };
  }

  const pillar = pillarMove(ctx);
  if (pillar && ctx.random() < 0.8) {
    return { type: 'slip', dir: pillar.dir, distance: pillar.distance };
  }
  return observeAction(ctx, { style: 'search' });
}
