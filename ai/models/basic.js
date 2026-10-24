import { observeAction } from '../lib/common.js';

export const meta = {
  id: 'basic',
  name: '守夜人',
  version: '1.0.0',
  generation: 1,
  randomPool: false,
  description: '旧版占位策略：柱上藏，原上整圈观察；不移动、不攻击。用来做基线。',
};

export function chooseAction(ctx) {
  if (ctx.legal.canHideEffective) return { type: 'hide' };
  return observeAction(ctx);
}
