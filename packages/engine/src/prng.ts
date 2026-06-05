/**
 * Seeded PRNG using mulberry32 algorithm.
 * Fully deterministic: same seed = same sequence.
 * State is a single number, JSON-serializable.
 */
export interface PRNGState {
  seed: number;
  state: number;
}

export function createPRNG(seed: number): PRNGState {
  return { seed, state: seed };
}

/** Returns [0, 1) and advances state. Returns [value, newState]. */
export function nextRandom(prng: PRNGState): [number, PRNGState] {
  let t = (prng.state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, { seed: prng.seed, state: (prng.state + 0x6d2b79f5) | 0 }];
}

/** Returns integer in [min, max] inclusive. */
export function nextInt(prng: PRNGState, min: number, max: number): [number, PRNGState] {
  const [val, next] = nextRandom(prng);
  return [min + Math.floor(val * (max - min + 1)), next];
}

/** Shuffle array (Fisher-Yates), returns new array and new PRNG state. */
export function shuffle<T>(prng: PRNGState, arr: readonly T[]): [T[], PRNGState] {
  const result = [...arr];
  let current = prng;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, next] = nextInt(current, 0, i);
    current = next;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return [result, current];
}
