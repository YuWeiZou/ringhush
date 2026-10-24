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
  id: 'survivor',
  name: '潜行者',
  version: '2.3.3',
  generation: 8,
  style: { aggression: 0.3, observation: 0.35, hide: 0.8, trapCommit: 0.55, blindFire: 0.25, longArc: 0.4, compartmentClear: 0.65, bombCaution: 0.9 },
  description: '2.2：保命优先；中局先排同一隔断的未清段，防溜刀；残局换区并低概率盲狙。',
};

export function chooseAction(ctx) {
  refreshKnown(ctx);

  const escape = bombEscape(ctx);
  if (escape) return escape;

  const reposition = endgameMove(ctx);
  if (reposition) return reposition;

  if (ctx.legal.canHideEffective) {
    // 只在刚看到人、且目标在原上时，赌一枪。
    const targets = rankedTargets(ctx, 1);
    if (targets.length && targets[0].terrain === 'plain' && ctx.random() < 0.35) {
      return attackAction(ctx, targets[0].segment, { mode: 'short' });
    }
    const blind = blindAttack(ctx, { chance: 0.3 });
    if (blind) return blind;
    const guard = compartmentGuard(ctx, { chance: 0.35, minLevel: 4, onlyNear: true });
    if (guard) return guard;
    if (ctx.random() < 0.12) return observeAction(ctx, { style: 'narrow' });
    return { type: 'hide' };
  }

  const pillar = pillarMove(ctx);
  if (pillar) return { type: 'slip', dir: pillar.dir, distance: pillar.distance };

  return observeAction(ctx);
}
