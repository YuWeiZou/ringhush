export const CW = 1;
export const CCW = -1;

export function mod(n, m) {
  return ((n % m) + m) % m;
}

/** 观测弧：从 start 开始，沿 dir 连续 length 段（含起点）。 */
export function observeSegments(start, dir, length, S) {
  const out = [];
  const n = Math.max(1, Math.min(S, length));
  for (let i = 0; i < n; i++) out.push(mod(start + dir * i, S));
  return out;
}

/** 从 start 到 target 沿 dir 走过的步数；同段返回 0。 */
export function steps(start, target, dir, S) {
  return dir === CW ? mod(target - start, S) : mod(start - target, S);
}

/** 攻击弧：不含起点，含目标段。 */
export function attackArc(start, target, dir, S) {
  const n = steps(start, target, dir, S);
  if (n === 0) return [];
  const out = [];
  for (let i = 1; i <= n; i++) out.push(mod(start + dir * i, S));
  return out;
}

/** 以 observer 为参照，target 在左半（顺时针先到）还是右半（逆时针先到）。 */
export function halfPlane(observer, target, S) {
  const cw = mod(target - observer, S);
  const ccw = mod(observer - target, S);
  if (cw === 0) return 'same';
  return cw < ccw ? 'left' : 'right';
}

/** S 为奇数时，左右半各 (S-1)/2 段。 */
export function halfSegments(observer, side, S) {
  const count = Math.floor(S / 2);
  const dir = side === 'left' ? CW : CCW;
  const out = [];
  for (let i = 1; i <= count; i++) out.push(mod(observer + dir * i, S));
  return out;
}
