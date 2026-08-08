// Deterministic RNG so game reducers stay pure (React StrictMode safe).

/** mulberry32 — small fast seeded PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates with a seed; returns the shuffled copy and the next seed. */
export function shuffled<T>(items: readonly T[], seed: number): { items: T[]; nextSeed: number } {
  const rng = mulberry32(seed)
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return { items: out, nextSeed: Math.floor(rng() * 2 ** 31) }
}

/** One deterministic draw in [0, 1) from a seed, plus the next seed. */
export function nextRandom(seed: number): { value: number; nextSeed: number } {
  const rng = mulberry32(seed)
  const value = rng()
  return { value, nextSeed: Math.floor(rng() * 2 ** 31) }
}
