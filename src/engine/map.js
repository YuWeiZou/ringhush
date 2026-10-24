import { shuffle } from './rng.js';

export function segmentCount(n) {
  const base = 3 * n;
  return base % 2 === 1 ? base : base + 1;
}

export function pillarCount(n) {
  return Math.floor(1.5 * n);
}

export function createMap(n, rng) {
  const S = segmentCount(n);
  const P = pillarCount(n);
  const terrains = Array(S).fill('plain');
  const order = shuffle([...Array(S).keys()], rng);
  for (let i = 0; i < P; i++) terrains[order[i]] = 'pillar';
  const starts = shuffle([...Array(S).keys()], rng).slice(0, n);
  return {
    S,
    P,
    terrains,
    starts,
    ruins: Array(S).fill(false),
  };
}
