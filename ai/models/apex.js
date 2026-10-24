import fs from 'node:fs';
import { candidateActions, featureVector, scoreVector } from '../lib/featurePolicy.js';
import { chooseAction as adaptiveAction } from './adaptive.js';

export const meta = {
  id: 'apex',
  name: '学徒·JSON',
  version: '0.1.0',
  generation: 1,
  author: 'dark-forest training',
  description: '从 adaptive 自博弈中训练的内置候选动作排序器；权重保存在 apex.weights.json。',
  randomPool: false,
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

let cachedWeights = null;
try {
  const raw = fs.readFileSync(new URL('./apex.weights.json', import.meta.url), 'utf8');
  cachedWeights = JSON.parse(raw.replace(/^\uFEFF/, ''));
} catch {
  cachedWeights = null;
}

export function rankCandidates(ctx) {
  if (!cachedWeights?.layers?.length) return null;
  const candidates = candidateActions(ctx);
  if (!candidates.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreVector(featureVector(ctx, candidate), cachedWeights);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return { best, bestScore };
}

export function chooseAction(ctx) {
  const rank = rankCandidates(ctx);
  if (!rank?.best) return adaptiveAction(ctx);
  return rank.best;
}
