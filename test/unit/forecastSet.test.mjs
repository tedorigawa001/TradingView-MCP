import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, chmod, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ForecastSetStore, normalizeForecastSet, normalizeInlineForecastSet, forecastSetComponentHashes, secondaryCopyReason,
  FORECAST_SET_MAX_LABELS, largestCommonScaleGroup, forecastSetSourceDigest, NEAR_COPY_TOLERANCE,
} from '../../build/forecastSet.js';
import { importForecastSet } from '../../build/forecastSetCli.js';

const day = (i) => new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
// FX-style windows: [D-1 21:00Z, D 21:00Z).
const window = (i) => ({ from: `${day(i - 1)}T21:00:00.000Z`, to: `${day(i)}T21:00:00.000Z` });
function scalarSet(count = 5, patch = {}) {
  const idx = Array.from({ length: count }, (_, i) => i);
  return {
    schema_version: '1.0', source_id: 'test-source', source_sha256: 'sha256:' + 'a'.repeat(64),
    evidence_tier: 'synthetic_test', horizon: 1, n: 1, underlying_series_ids: ['fxdata-m1:EURUSD'],
    dates: idx.map(day), windows: idx.map(window),
    a: idx.map((i) => 1 + i / 10), b: idx.map((i) => 1.2 + i / 20), primary: idx.map((i) => 0.5 + (i % 3) / 4),
    secondary: idx.map((i) => 0.4 + ((i + 1) % 4) / 5), labels: idx.map((i) => (i % 2 ? 'odd' : 'even')),
    ...patch,
  };
}
const matrix = (x, y, c) => [[x, c], [c, y]];
function matrixSet(count = 4) {
  const idx = Array.from({ length: count }, (_, i) => i);
  return {
    ...scalarSet(count), n: 2, underlying_series_ids: ['fxdata-m1:EURUSD', 'fxdata-m1:USDJPY'],
    a: idx.map((i) => matrix(1 + i, 2, 0.1)), b: idx.map((i) => matrix(1.5, 2 + i, 0.2)),
    primary: idx.map((i) => matrix(1, 1 + i / 2, 0.05)), secondary: idx.map((i) => matrix(0.5 + i, 1, -0.1)),
  };
}
async function tempStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forecast-set-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: new ForecastSetStore(join(directory, 'sets')) };
}

test('a valid set normalizes to a fixed form and a stable content hash', () => {
  const first = normalizeForecastSet(scalarSet());
  const second = normalizeForecastSet(JSON.parse(JSON.stringify(scalarSet())));
  assert.equal(first.artifact_id, second.artifact_id);
  assert.match(first.artifact_id, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(first.set), ['schema_version', 'source_id', 'source_sha256', 'evidence_tier', 'horizon', 'n',
    'underlying_series_ids', 'dates', 'windows', 'a', 'b', 'primary', 'secondary', 'labels']);
  // Key order in the input does not matter; the normalized form fixes it.
  const reordered = Object.fromEntries(Object.entries(scalarSet()).reverse());
  assert.equal(normalizeForecastSet(reordered).artifact_id, first.artifact_id);
  const noSecondary = normalizeForecastSet(scalarSet(5, { secondary: undefined, labels: undefined }));
  assert.deepEqual([noSecondary.set.secondary, noSecondary.set.labels], [null, null]);
});

test('an n = 1 set written as 1x1 matrices hashes like its scalar form', () => {
  const scalar = scalarSet();
  const wrapped = { ...scalar, a: scalar.a.map((x) => [[x]]), primary: scalar.primary.map((x) => [[x]]) };
  assert.equal(normalizeForecastSet(wrapped).artifact_id, normalizeForecastSet(scalar).artifact_id);
});

test('shape, dates, windows, series IDs and labels are validated', () => {
  const bad = (patch, pattern, label) => assert.throws(() => normalizeForecastSet({ ...scalarSet(), ...patch }), pattern, label);
  bad({ horizon: 2 }, undefined, 'horizon');
  bad({ extra: true }, undefined, 'strict');
  bad({ a: [1, 2, 3, 4] }, /4 entries for 5 dates/, 'length');
  bad({ dates: [day(0), day(2), day(1), day(3), day(4)] }, /strictly increasing/, 'order');
  bad({ dates: [day(0), day(0), day(2), day(3), day(4)] }, /strictly increasing/, 'duplicate');
  bad({ dates: ['2024-02-30', day(70), day(71), day(72), day(73)] }, undefined, 'calendar');
  bad({ windows: [window(0), { from: `${day(0)}T20:00:00.000Z`, to: `${day(1)}T21:00:00.000Z` }, window(2), window(3), window(4)] },
    /overlap/, 'overlap');
  // A gap between windows is allowed; only overlap and disorder are refused.
  assert.doesNotThrow(() => normalizeForecastSet({ ...scalarSet(), windows: [window(0), { from: `${day(0)}T22:00:00.000Z`, to: `${day(1)}T21:00:00.000Z` }, window(2), window(3), window(4)] }));
  bad({ windows: [{ from: `${day(-2)}T21:00:00.000Z`, to: `${day(0)}T21:00:00.000Z` }, window(1), window(2), window(3), window(4)] },
    /its date or the day before/, 'two days early');
  bad({ windows: [{ from: `${day(0)}T21:00:00.000Z`, to: `${day(0)}T21:00:00.000Z` }, window(1), window(2), window(3), window(4)] },
    /from before to/, 'empty window');
  bad({ underlying_series_ids: ['x', 'y'] }, /more underlying series than dimensions/, 'too many series');
  bad({ underlying_series_ids: ['ledger-source:abc'] }, /reserved prefix/, 'ledger prefix');
  bad({ underlying_series_ids: ['forecast-set-source:abc'] }, /reserved prefix/, 'forecast prefix');
  bad({ a: [[[1, 2], [3, 4]]], }, undefined, 'matrix in scalar set');
  bad({ labels: ['x'.repeat(65), 'a', 'b', 'c', 'd'] }, undefined, 'label length');
  const many = scalarSet(FORECAST_SET_MAX_LABELS + 1);
  assert.throws(() => normalizeForecastSet({ ...many, labels: many.dates.map((d) => `l${d}`) }), /at most 50 distinct labels/);
  assert.doesNotThrow(() => normalizeForecastSet({ ...many, labels: many.dates.map((_, i) => `l${i % FORECAST_SET_MAX_LABELS}`) }));
  // A window starting on the previous calendar day (FX) and one starting on the date itself are both fine.
  assert.doesNotThrow(() => normalizeForecastSet(scalarSet(5, { windows: [0, 1, 2, 3, 4].map((i) => ({
    from: `${day(i)}T00:00:00.000Z`, to: `${day(i)}T23:00:00.000Z` })) })));
  const m = matrixSet();
  assert.throws(() => normalizeForecastSet({ ...m, underlying_series_ids: ['fxdata-m1:EURUSD', 'fxdata-m1:EURUSD'] }), /must be unique/);
  assert.throws(() => normalizeForecastSet({ ...m, a: [[[1, 2]], ...m.a.slice(1)] }), /not a 2 x 2 matrix/);
  assert.throws(() => normalizeForecastSet({ ...m, a: [5, ...m.a.slice(1)] }), /scalar but n = 2/);
  const { set } = normalizeForecastSet(m);
  assert.equal(set.n, 2);
});

test('null days are data, not errors', () => {
  const s = scalarSet();
  const { set } = normalizeForecastSet({ ...s, a: [null, ...s.a.slice(1)], primary: [...s.primary.slice(0, 4), null] });
  assert.equal(set.a[0], null);
  assert.equal(set.primary[4], null);
});

test('the date and size limits hold', () => {
  assert.throws(() => normalizeForecastSet(scalarSet(5001)));
  assert.throws(() => normalizeForecastSet(scalarSet(), { maxBytes: 200 }), /exceeds the size limit/);
  assert.doesNotThrow(() => normalizeForecastSet(scalarSet(5000, { labels: undefined })));
});

test('a secondary identical to the primary or a scaled copy of it is rejected (N2, M3, P1)', () => {
  const s = scalarSet();
  assert.throws(() => normalizeForecastSet({ ...s, secondary: [...s.primary] }), /identical to the primary/);
  assert.throws(() => normalizeForecastSet({ ...s, secondary: s.primary.map((x) => 1.5 * x) }), /scaled copy/);
  const m = matrixSet();
  assert.throws(() => normalizeForecastSet({ ...m, secondary: m.primary.map((p) => p.map((row) => row.map((x) => 3 * x))) }), /scaled copy/);
  // Zero days and null days do not enter the test; fewer than 2 jointly nonzero days is never a copy.
  assert.equal(secondaryCopyReason([2, 0, null, 4], [3, 5, 1, 6]), 'scaled_copy');
  assert.equal(secondaryCopyReason([2, 0, 0, 0], [3, 5, 1, 6]), null);
  assert.equal(secondaryCopyReason([2, 1, 4], [3, 1.5, 6.0000001]), null);
  // λ is the median of the ratios; for an even count, the mean of the two middle values.
  assert.equal(secondaryCopyReason([1, 1], [2, 2]), 'scaled_copy');
  assert.equal(secondaryCopyReason([1, 1, 1, 1], [1, 2, 3, 4]), null);
});

test('the inline path is the same hash, limited to scalar sets of at most 2,000 dates', () => {
  assert.equal(normalizeInlineForecastSet(scalarSet()).artifact_id, normalizeForecastSet(scalarSet()).artifact_id);
  assert.throws(() => normalizeInlineForecastSet(matrixSet()), /inline sets must be scalar/);
  assert.throws(() => normalizeInlineForecastSet(scalarSet(2001, { labels: undefined })), /at most 2000 dates/);
});

test('component hashes are deterministic and mark absent parts', () => {
  const { set } = normalizeForecastSet(scalarSet());
  const hashes = forecastSetComponentHashes(set);
  assert.deepEqual(Object.keys(hashes), ['dates', 'a', 'b', 'primary', 'secondary', 'labels', 'source']);
  assert.deepEqual(hashes, forecastSetComponentHashes(normalizeForecastSet(scalarSet()).set));
  const bare = forecastSetComponentHashes(normalizeForecastSet(scalarSet(5, { secondary: undefined, labels: undefined })).set);
  assert.deepEqual([bare.secondary, bare.labels], ['absent', 'absent']);
  assert.equal(bare.primary, hashes.primary);
  assert.notEqual(forecastSetComponentHashes(normalizeForecastSet(scalarSet(5, { b: [9, 9, 9, 9, 9] })).set).b, hashes.b);
});

test('the store registers immutably, returns the same ID on re-import and refuses a tampered artifact', async (t) => {
  const { directory, store } = await tempStore(t);
  const first = await store.register(scalarSet());
  assert.deepEqual([first.dates, first.n], [5, 1]);
  assert.equal((await store.register(scalarSet())).artifact_id, first.artifact_id);
  const files = (await readdir(join(directory, 'sets'))).filter((f) => !f.startsWith('.'));
  assert.deepEqual(files, [`${first.artifact_id.slice(7)}.json`]);
  const loaded = await store.get(first.artifact_id);
  assert.deepEqual(loaded, normalizeForecastSet(scalarSet()).set);
  const path = join(directory, 'sets', files[0]);
  const body = await readFile(path, 'utf8');
  await chmod(path, 0o600);
  await writeFile(path, body.replace('"n":1', '"n":1 '));
  await assert.rejects(store.get(first.artifact_id), /hash mismatch/);
  await assert.rejects(store.get('not-a-hash'));
  // Without a secondary or labels the stored form holds nulls, and it still reads back.
  const bare = scalarSet(5, { secondary: undefined, labels: undefined });
  const registered = await store.register(bare);
  assert.equal(registered.artifact_id, normalizeForecastSet(bare).artifact_id);
  assert.deepEqual(await store.get(registered.artifact_id), normalizeForecastSet(bare).set);
});

test('the import CLI requires both flags and registers the file', async (t) => {
  const { directory, store } = await tempStore(t);
  const input = join(directory, 'set.json');
  await writeFile(input, JSON.stringify(scalarSet()));
  await assert.rejects(importForecastSet(['--input', input], store), /--confirm-local-import are required/);
  await assert.rejects(importForecastSet(['--confirm-local-import'], store), /--input/);
  const result = await importForecastSet(['--input', input, '--confirm-local-import'], store);
  assert.equal(result.artifact_id, normalizeForecastSet(scalarSet()).artifact_id);
});

test('the near-copy measure finds the largest group sharing one scale, over jointly nonzero days (M2)', () => {
  // Scalars: 3 days at ×2, 2 at ×5, one other ratio; zero and null days do not count.
  const primary = [1, 2, 3, 4, 5, 6, 0, 7, null];
  const secondary = [2, 4, 6, 20, 25, 1, 3, 0, 1];
  assert.deepEqual(largestCommonScaleGroup(primary, secondary), { jointly_nonzero: 6, largest_group: 3 });
  // Ratios within 1e-6 relative join one group, so rounding-level copies count (R-M1); 1e-5 apart they do not.
  assert.equal(NEAR_COPY_TOLERANCE, 1e-6);
  assert.equal(largestCommonScaleGroup([1, 1], [2, 2 * (1 + 5e-7)]).largest_group, 2);
  assert.equal(largestCommonScaleGroup([1, 1], [2, 2 * (1 + 1e-5)]).largest_group, 1);
  // Matrices: a day counts only if P₂ is proportional to P, not merely equal in norm.
  const p = [[1, 0.2], [0.2, 1]];
  const scaled = p.map((row) => row.map((x) => 3 * x));
  const sameNorm = [[1, -0.2], [-0.2, 1]].map((row) => row.map((x) => 3 * x));
  assert.deepEqual(largestCommonScaleGroup([p, p, p], [scaled, scaled, sameNorm]), { jointly_nonzero: 3, largest_group: 2 });
  // A matrix off proportional by 1e-5 relative is not a copy day; by 1e-7 it is.
  const offBy = (e) => [[3, 0.6], [0.6, 3 * (1 + e)]];
  assert.equal(largestCommonScaleGroup([p, p], [scaled, offBy(1e-5)]).largest_group, 1);
  assert.equal(largestCommonScaleGroup([p, p], [scaled, offBy(1e-7)]).largest_group, 2);
  assert.deepEqual(largestCommonScaleGroup([], []), { jointly_nonzero: 0, largest_group: 0 });
});

test('the source digest is sha256 of the raw source_id and is the journal component (L5)', () => {
  const set = normalizeForecastSet(scalarSet()).set;
  assert.equal(forecastSetSourceDigest('test-source'),
    'sha256:' + createHash('sha256').update('test-source').digest('hex'));
  assert.equal(forecastSetComponentHashes(set).source, forecastSetSourceDigest('test-source'));
});

test('the store refuses a symlinked artifact and a group-readable directory', async (t) => {
  const { directory, store } = await tempStore(t);
  const { artifact_id } = await store.register(scalarSet());
  const sets = join(directory, 'sets');
  const path = join(sets, `${artifact_id.slice(7)}.json`);
  const moved = join(directory, 'elsewhere.json');
  await writeFile(moved, await readFile(path));
  await chmod(path, 0o600);
  await unlink(path);
  await symlink(moved, path);
  await assert.rejects(store.get(artifact_id), /symlink|regular file/);
  await unlink(path);
  await store.register(scalarSet());
  await chmod(sets, 0o750);
  await assert.rejects(store.get(artifact_id), /owner-only/);
  await chmod(sets, 0o700);
  assert.deepEqual(await store.get(artifact_id), normalizeForecastSet(scalarSet()).set);
});

test('both copy rules hold for matrices at extreme scales (R-L3)', () => {
  const m = (x, y, c) => [[x, c], [c, y]];
  const primary = Array.from({ length: 10 }, (_, i) => m(1 + i, 2, 0.1));
  for (const scale of [1, 1e-170, 1e160]) {
    const p = primary.map((v) => v.map((row) => row.map((x) => x * scale)));
    const copy = p.map((v) => v.map((row) => row.map((x) => 3 * x)));
    assert.deepEqual(largestCommonScaleGroup(p, copy), { jointly_nonzero: 10, largest_group: 10 }, `scale ${scale}`);
    assert.equal(secondaryCopyReason(p, copy), 'scaled_copy', `scale ${scale}`);
    const other = copy.map((v, i) => (i === 0 ? v.map((row) => row.map((x) => x * 2)) : v));
    assert.equal(secondaryCopyReason(p, other), null, `scale ${scale}`);
  }
});
