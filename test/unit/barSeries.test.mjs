import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, chmod, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  BarSeriesStore, normalizeBarSeries, BAR_SERIES_MAX_BARS, BAR_SERIES_MAX_OPEN_TIME,
} from '../../build/barSeries.js';
import { importBarSeries } from '../../build/barSeriesCli.js';
import { posixModeEnforced } from '../../build/fsDurability.js';

// 2024-01-08 (a Monday) 21:45Z, on the 15-minute grid.
const T0 = Date.UTC(2024, 0, 8, 21, 45) / 1000;
function series(count = 8, patch = {}) {
  const idx = Array.from({ length: count }, (_, i) => i);
  return {
    schema_version: '1.0', source_id: 'synthetic-m15', source_sha256: 'sha256:' + 'a'.repeat(64),
    evidence_tier: 'synthetic_test', series_id: 'fxdata-m15:EURUSD', interval_minutes: 15,
    open_time: idx.map((i) => T0 + i * 900), close: idx.map((i) => 1.1 + i / 1000),
    ...patch,
  };
}
async function tempStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bar-series-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: new BarSeriesStore(join(directory, 'bars')) };
}

test('a valid series normalizes to a fixed key order and a stable hash', () => {
  const first = normalizeBarSeries(series());
  const shuffled = normalizeBarSeries(JSON.parse(JSON.stringify({ close: series().close, ...series() })));
  assert.equal(first.artifact_id, shuffled.artifact_id);
  assert.deepEqual(Object.keys(first.series), ['schema_version', 'source_id', 'source_sha256', 'evidence_tier', 'series_id',
    'interval_minutes', 'open_time', 'close']);
  assert.equal(first.artifact_id, 'sha256:' + createHash('sha256').update(JSON.stringify(first.series)).digest('hex'));
  // Null and non-positive closes are kept as imported; the computation treats them as missing.
  const kept = normalizeBarSeries(series(4, { close: [1.1, null, 0, -1] }));
  assert.deepEqual(kept.series.close, [1.1, null, 0, -1]);
});

test('the grid, order, length, range, interval and schema rules are enforced', () => {
  const bad = (patch, pattern) => assert.throws(() => normalizeBarSeries(series(8, patch)), pattern);
  bad({ interval_minutes: 7, open_time: series().open_time.map((_, i) => T0 - (T0 % 420) + i * 420) }, /divide 1440/);
  bad({ interval_minutes: 0 });
  bad({ interval_minutes: 2880 });
  bad({ open_time: series().open_time.map((t, i) => (i === 3 ? t + 60 : t)) }, /not on the 15-minute grid/);
  bad({ open_time: series().open_time.map((t, i) => (i === 3 ? series().open_time[2] : t)) }, /strictly increasing/);
  bad({ open_time: [...series().open_time].reverse() }, /strictly increasing/);
  bad({ close: series().close.slice(1) }, /7 entries for 8 bars/);
  bad({ open_time: series().open_time.map((t) => t - T0 - 900) });                 // a negative time
  // The bound is 2100-01-01T00:00Z, pinned as a literal, not read back from the constant under test.
  assert.equal(new Date(BAR_SERIES_MAX_OPEN_TIME * 1000).toISOString(), '2100-01-01T00:00:00.000Z');
  bad({ open_time: [4_102_444_800 + 900], close: [1] });
  assert.doesNotThrow(() => normalizeBarSeries(series(1, { open_time: [4_102_444_800], close: [1] })));
  bad({ open_time: series().open_time.map((t) => t + 0.5) });                      // not integer seconds
  bad({ evidence_tier: 'production' });
  bad({ extra: true });
  bad({ close: series().close.map(() => '1.1') });
  bad({ open_time: [], close: [] });
  assert.equal(BAR_SERIES_MAX_BARS, 600_000);
  // The size limit is checked on the normalized bytes.
  assert.throws(() => normalizeBarSeries(series(), { maxBytes: 100 }), /size limit/);
});

test('reserved series prefixes are rejected at import, including proxy-set-source: (G3)', () => {
  for (const prefix of ['ledger-source:', 'forecast-set-source:', 'proxy-set-source:']) {
    assert.throws(() => normalizeBarSeries(series(8, { series_id: `${prefix}x` })), /reserved prefix/, prefix);
  }
});

test('intervals that divide 1440 are accepted, from 1 minute to a day', () => {
  for (const interval of [1, 5, 15, 30, 60, 120, 1440]) {
    const step = interval * 60, start = Math.ceil(T0 / step) * step;
    assert.doesNotThrow(() => normalizeBarSeries(series(3, { interval_minutes: interval,
      open_time: [0, 1, 2].map((i) => start + i * step), close: [1, 2, 3] })), `${interval}`);
  }
});

test('the store registers immutably, is idempotent, and refuses tampering, symlinks and group access', async (t) => {
  const { directory, store } = await tempStore(t);
  const first = await store.register(series());
  assert.deepEqual([first.series_id, first.bars, first.interval_minutes], ['fxdata-m15:EURUSD', 8, 15]);
  assert.equal((await store.register(series())).artifact_id, first.artifact_id);
  const bars = join(directory, 'bars');
  const files = (await readdir(bars)).filter((f) => !f.startsWith('.'));
  assert.deepEqual(files, [`${first.artifact_id.slice(7)}.json`]);
  assert.deepEqual(await store.get(first.artifact_id), normalizeBarSeries(series()).series);
  const path = join(bars, files[0]);
  const body = await readFile(path);
  await chmod(path, 0o600);
  await writeFile(path, Buffer.concat([body.subarray(0, body.length - 1), Buffer.from(' }')]));
  await assert.rejects(store.get(first.artifact_id), /hash mismatch/);
  await writeFile(path, body);
  const moved = join(directory, 'elsewhere.json');
  await writeFile(moved, body);
  await unlink(path);
  await symlink(moved, path);
  await assert.rejects(store.get(first.artifact_id), /symlink|regular file/);
  await unlink(path);
  await store.register(series());
  // POSIX modes only: Windows has no owner-only mode bits, and the stores skip the check there.
  if (posixModeEnforced()) {
    await chmod(bars, 0o750);
    await assert.rejects(store.get(first.artifact_id), /owner-only/);
    await chmod(bars, 0o700);
  }
  await assert.rejects(store.get('not-a-hash'));
  // A file whose bytes hash to its own name, but which is not the canonical form (keys reordered), is refused.
  const reordered = JSON.stringify({ close: series().close, ...series() });
  const reorderedId = 'sha256:' + createHash('sha256').update(reordered).digest('hex');
  await writeFile(join(bars, `${reorderedId.slice(7)}.json`), reordered, { mode: 0o600 });
  await assert.rejects(store.get(reorderedId), /not in normalized form/);
});

test('the import CLI requires both flags, rejects invalid UTF-8 and registers the file', async (t) => {
  const { directory, store } = await tempStore(t);
  const input = join(directory, 'bars.json');
  await writeFile(input, JSON.stringify(series()));
  await assert.rejects(importBarSeries(['--input', input], store), /--confirm-local-import are required/);
  await assert.rejects(importBarSeries(['--confirm-local-import'], store), /--input/);
  const result = await importBarSeries(['--input', input, '--confirm-local-import'], store);
  assert.equal(result.artifact_id, normalizeBarSeries(series()).artifact_id);
  const invalid = join(directory, 'invalid.json');
  const text = Buffer.from(JSON.stringify(series(8, { source_id: 'x' })));
  await writeFile(invalid, Buffer.concat([text.subarray(0, 10), Buffer.from([0xff]), text.subarray(10)]));
  await assert.rejects(importBarSeries(['--input', invalid, '--confirm-local-import'], store), /not valid UTF-8/);
});
