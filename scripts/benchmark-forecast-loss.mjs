#!/usr/bin/env node
// Performance check for compare_forecast_losses (docs/FORECAST_LOSS_COMPARISON_PLAN.md, section 4).
// Kept out of the unit suite so the suite never depends on timing. Run after `npm run build`:
//   node scripts/benchmark-forecast-loss.mjs
// It builds a synthetic worst-case set (5,000 dates of 8x8 matrices with a secondary proxy and labels),
// registers it in a temporary store, then times reading it back and each loss.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRandom } from '../build/seededRandom.js';
import { ForecastSetStore, FORECAST_SET_MAX_BYTES } from '../build/forecastSet.js';
import { compareForecastLosses } from '../build/forecastLossComparison.js';

const DATES = 5000, N = 8;
const random = createRandom(1);
const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
const round = (x) => Number(x.toPrecision(7));
/** A symmetric positive-definite matrix L·Lᵀ + 0.1·I, rounded symmetrically. */
function covariance() {
  const l = Array.from({ length: N }, () => Array.from({ length: N }, () => normal() * 0.3));
  const m = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) for (let j = 0; j <= i; j++) {
    let sum = i === j ? 0.1 : 0;
    for (let k = 0; k < N; k++) sum += l[i][k] * l[j][k];
    m[i][j] = m[j][i] = round(sum);
  }
  return m;
}
/**
 * A rank-one r·rᵀ proxy, like a daily outer product of returns. The products stay at full double
 * precision: rounding them separately makes the matrix indefinite far beyond the PSD tolerance.
 */
function outer() {
  const r = Array.from({ length: N }, () => round(normal()));
  return r.map((x) => r.map((y) => x * y));
}
const day = (i) => new Date(Date.UTC(2006, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const idx = Array.from({ length: DATES }, (_, i) => i);
const input = {
  schema_version: '1.0', source_id: 'benchmark', source_sha256: 'sha256:' + '0'.repeat(64), evidence_tier: 'synthetic_test',
  horizon: 1, n: N, underlying_series_ids: Array.from({ length: N }, (_, i) => `bench:${i}`), dates: idx.map(day),
  windows: idx.map((i) => ({ from: `${day(i)}T00:00:00.000Z`, to: `${day(i)}T23:00:00.000Z` })),
  a: idx.map(covariance), b: idx.map(covariance), primary: idx.map(outer), secondary: idx.map(outer),
  labels: idx.map((i) => `year-${day(i).slice(0, 4)}`),
};

const directory = await mkdtemp(join(tmpdir(), 'forecast-loss-benchmark-'));
try {
  const store = new ForecastSetStore(join(directory, 'sets'));
  let started = performance.now();
  const { artifact_id } = await store.register(input);
  const registerMs = performance.now() - started;
  started = performance.now();
  const set = await store.get(artifact_id);
  const readMs = performance.now() - started;
  const bytes = Buffer.byteLength(JSON.stringify(set));
  const rows = [['register (normalize, hash, write, read back)', registerMs], ['read and verify', readMs]];
  for (const loss of ['qlike', 'mse']) {
    started = performance.now();
    const result = compareForecastLosses(set, { loss, tracked: true });
    rows.push([`compare ${loss} (${result.battery_outcome}, T = ${result.drops.used})`, performance.now() - started]);
  }
  console.log(`set: ${DATES} dates, ${N}x${N}, ${(bytes / 2 ** 20).toFixed(1)} MiB of ${FORECAST_SET_MAX_BYTES / 2 ** 20} MiB`);
  for (const [label, ms] of rows) console.log(`${label}: ${ms.toFixed(0)} ms`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
