/**
 * mulberry32: a seeded uniform [0, 1) generator. Seeded audits and bootstraps must be reproducible
 * exactly, so they never touch Math.random. Moved unchanged from three identical private copies;
 * golden values in test/unit/seededRandom.test.mjs pin the sequence.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
