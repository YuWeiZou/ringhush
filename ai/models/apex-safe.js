import { actionEqual, actionKey } from '../lib/featurePolicy.js';
import { rankCandidates } from './apex.js';
import { chooseAction as adaptiveAction } from './adaptive.js';

export const meta = {
  id: 'apex-safe',
  name: '学徒·守门',
  version: '0.2.0',
  generation: 2,
  author: 'dark-forest training',
  description: '学徒·JSON 的保守版：只在动作类型与 adaptive 一致且通过已知目标检查时覆盖；否则回退 adaptive。',
  randomPool: true,
  style: {
    aggression: 0.5,
    observation: 0.5,
    hide: 0.5,
    trapCommit: 0.5,
    blindFire: 0.5,
    longArc: 0.5,
    compartmentClear: 0.5,
    bombCaution: 0.5,
  },
};

function knownSegments(ctx) {
  return new Set(
    (ctx.memory?.known ?? [])
      .filter((k) => ctx.round - k.round <= 3)
      .map((k) => k.segment),
  );
}

export function chooseAction(ctx) {
  const base = adaptiveAction(ctx);
  // The 2-player endgame is already a strong hand-written hunter; do not
  // replace it with a student that was trained mostly on 4/8-player states.
  // This student was trained on 4-player states. In 2/8-player rooms the
  // hand-written adaptive model is the safer floor; fall back to it.
  if (ctx.players.length !== 4) return base;
  const alive = ctx.players.filter((p) => p.alive).length;
  if (alive <= 2) return base;
  const rank = rankCandidates(ctx);
  const learned = rank?.best;
  if (!learned || !base) return base;
  // Never let the student change the high-level action family. Type errors were
  // the catastrophic failure mode of the pure ranker (slip/attack suicides).
  if (learned.type !== base.type) return base;
  if (actionEqual(learned, base)) return base;
  if (learned.type === 'attack') {
    const known = knownSegments(ctx);
    if (!known.has(learned.target)) return base;
  }
  return learned;
}
