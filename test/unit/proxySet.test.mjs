import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ProxySetStore, normalizeProxySet, verifyProxySet } from '../../build/proxySet.js';
import { exportProxySet } from '../../build/proxySetCli.js';
import { RealizedCovarianceJournalStore } from '../../build/realizedCovarianceJournal.js';
import { computeRealizedCovariance } from '../../build/realizedCovariance.js';
import { canonicalizeRules, hashRules } from '../../build/realizedCovarianceRules.js';
import { normalizeBarSeries } from '../../build/barSeries.js';
import { intlZoneResolver } from '../../build/zonedTime.js';

const RAW = JSON.parse(await readFile(new URL('../fixtures/realized-covariance/reference.json', import.meta.url), 'utf8'));
const scenarioA = RAW.scenarios.find((s) => s.name === 'A_100_shaped');
const barsA = RAW.bar_sets[scenarioA.bars];
const artifact = (i) => `sha256:${String(i).padStart(64, '0')}`;
function compute(resolver) {
  const { rules, rules_sha256 } = canonicalizeRules(scenarioA.rules);
  const series = barsA.map((s, i) => ({ artifact_id: artifact(i), bars: normalizeBarSeries({ schema_version: '1.0', source_id: 'reference',
    source_sha256: 'sha256:' + 'a'.repeat(64), evidence_tier: 'synthetic_test', series_id: s.series_id, interval_minutes: 15,
    open_time: s.open_time, close: s.close }).series }));
  return computeRealizedCovariance({ rules, rules_sha256, from_date: scenarioA.from_date, to_date: scenarioA.to_date, series, resolver });
}
const RESULT = compute();
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'proxy-set-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: new ProxySetStore(join(directory, 'proxy')), journal: new RealizedCovarianceJournalStore(join(directory, 'journal.jsonl')) };
}
const exposure = (result, proxySetId, patch = {}) => ({
  rules: result.proxy.rules, rules_sha256: result.proxy.rules_sha256, bar_series: result.proxy.bar_series,
  underlying_series_ids: result.proxy.underlying_series_ids, from_date: result.proxy.from_date, to_date: result.proxy.to_date,
  proxy_set_id: proxySetId, research_id: 'research:rc', tzdata: result.tzdata,
  kept_days: result.summary.kept_days, dropped_days: result.summary.produced_days - result.summary.kept_days, envelope: result.envelope, ...patch,
});
const code = (c) => (error) => error.code === c;

test('a computed proxy set normalizes to its canonical form; tzdata is not part of the content (F17)', () => {
  const { set, artifact_id } = normalizeProxySet(RESULT.proxy);
  assert.equal(JSON.stringify(set), JSON.stringify(RESULT.proxy), 'the computation already emits the canonical form');
  assert.equal(artifact_id, 'sha256:' + createHash('sha256').update(JSON.stringify(set)).digest('hex'));
  // Another resolver that resolves the same boundaries but reports another tzdata gives the same ID.
  const other = compute({ tzdata: 'test-2099z', formatAt: intlZoneResolver.formatAt });
  assert.equal(other.tzdata, 'test-2099z');
  assert.equal(normalizeProxySet(other.proxy).artifact_id, artifact_id);
});

test('structural checks: lengths, value shape against drop cause and n, pairs, order, slot counts', () => {
  const p = RESULT.proxy, kept = p.drop_cause.indexOf(null), dropped = p.drop_cause.findIndex((c) => c !== null);
  const bad = (patch, pattern) => assert.throws(() => normalizeProxySet({ ...p, ...patch }), pattern);
  bad({ rc: p.rc.slice(1) }, /rc has/);
  bad({ rc: p.rc.map((v, i) => (i === kept ? null : v)) }, /do not match its drop cause/);
  bad({ daily_outer: p.daily_outer.map((v, i) => (i === dropped ? [[1, 0], [0, 1]] : v)) }, /do not match its drop cause/);
  bad({ rc: p.rc.map((v, i) => (i === kept ? 1 : v)) }, /n = 2/);
  bad({ identical_close_pairs: [[1, 0]] }, /identical_close_pairs/);
  bad({ identical_close_pairs: [[0, 2]] }, /identical_close_pairs/);
  bad({ dates: [...p.dates].reverse() }, /strictly increasing/);
  bad({ common_slots: p.common_slots.map((c, i) => (i === 0 ? p.expected_slots[0] + 1 : c)) }, /exceed/);
  bad({ underlying_series_ids: ['only-one'] }, /differ in length/);
  bad({ algorithm_version: 'realized_covariance_v2' });
  bad({ extra: 1 });
  // Rules are stored in canonical form: sorted weekdays and a fixed key order, whatever the input order.
  const { rules } = p;
  const shuffled = { return_unit: rules.return_unit, ...rules, day_weekdays: [...rules.day_weekdays].reverse() };
  const normalized = normalizeProxySet({ ...p, rules: shuffled });
  assert.deepEqual(normalized.set.rules, rules);
  assert.equal(normalized.artifact_id, normalizeProxySet(p).artifact_id);
});

test('the store registers idempotently and refuses tampering and non-canonical files', async (t) => {
  const { directory, store } = await setup(t);
  const first = await store.register(RESULT.proxy);
  assert.equal((await store.register(RESULT.proxy)).artifact_id, first.artifact_id);
  assert.equal(JSON.stringify(await store.get(first.artifact_id)), JSON.stringify(RESULT.proxy));
  const dir = join(directory, 'proxy');
  const path = join(dir, `${first.artifact_id.slice(7)}.json`);
  const body = await readFile(path);
  await chmod(path, 0o600);
  await writeFile(path, Buffer.concat([body.subarray(0, body.length - 1), Buffer.from(' }')]));
  await assert.rejects(store.get(first.artifact_id), /hash mismatch/);
  const reordered = JSON.stringify({ rc: RESULT.proxy.rc, ...RESULT.proxy });
  const id = 'sha256:' + createHash('sha256').update(reordered).digest('hex');
  await writeFile(join(dir, `${id.slice(7)}.json`), reordered, { mode: 0o600 });
  await assert.rejects(store.get(id), /not in normalized form/);
});

test('verification order: not found, rules and dates, journal, then windows under the current tzdata (Q4, R1)', async (t) => {
  const { store, journal } = await setup(t);
  const deps = { proxySets: store, journal };
  await assert.rejects(verifyProxySet(artifact(9), deps), code('proxy_set_not_found'));
  // 2. rules_sha256 or dates differ: rejected before the journal is consulted, even with no record at all.
  const wrongHash = await store.register({ ...RESULT.proxy, rules_sha256: artifact(7) });
  await assert.rejects(verifyProxySet(wrongHash.artifact_id, deps), code('proxy_set_rules_mismatch'));
  const drop = 3, without = (list) => list.filter((_, i) => i !== drop);
  const p = RESULT.proxy;
  const removed = await store.register({ ...p, dates: without(p.dates), windows: without(p.windows), rc: without(p.rc), daily_outer: without(p.daily_outer),
    common_slots: without(p.common_slots), expected_slots: without(p.expected_slots), drop_cause: without(p.drop_cause) });
  await assert.rejects(verifyProxySet(removed.artifact_id, deps), code('proxy_set_rules_mismatch'), 'a removed date');
  // A stored range past the date bounds is a mismatch too, and returns at once instead of looping (code review C1).
  const farFuture = await store.register({ ...p, to_date: '9999-12-31' });
  await assert.rejects(verifyProxySet(farFuture.artifact_id, deps), code('proxy_set_rules_mismatch'), 'an out-of-range to_date');
  // 3. No journal record for the set.
  const good = await store.register(p);
  await assert.rejects(verifyProxySet(good.artifact_id, deps), code('proxy_set_not_journaled'));
  await journal.record(exposure(RESULT, good.artifact_id));
  const verified = await verifyProxySet(good.artifact_id, deps);
  assert.equal(JSON.stringify(verified), JSON.stringify(p));
  // 4. A moved window, journaled under the current tzdata, is tampering: proxy_set_rules_mismatch.
  const moved = await store.register({ ...p, windows: p.windows.map((w, i) => (i === 0 ? { ...w, from: '2026-01-05T20:45:00.000Z' } : w)) });
  await journal.record(exposure(RESULT, moved.artifact_id));
  await assert.rejects(verifyProxySet(moved.artifact_id, deps), code('proxy_set_rules_mismatch'));
});

test('tzdata drift: windows re-derived under another tzdata report both versions; the same version is a mismatch (H4, H6)', async (t) => {
  const { store, journal } = await setup(t);
  const { artifact_id } = await store.register(RESULT.proxy);
  await journal.record(exposure(RESULT, artifact_id));
  // A resolver whose New York is one hour later everywhere: every boundary moves.
  const shifted = (tzdata) => ({ tzdata, formatAt: (zone, ms) => intlZoneResolver.formatAt(zone, ms + 3_600_000) });
  await assert.rejects(verifyProxySet(artifact_id, { proxySets: store, journal, resolver: shifted('test-2099z') }),
    (e) => e.code === 'proxy_set_windows_changed_under_current_tzdata' && e.message.includes('test-2099z') && e.message.includes(RESULT.tzdata));
  await assert.rejects(verifyProxySet(artifact_id, { proxySets: store, journal, resolver: shifted('unknown') }),
    code('proxy_set_windows_changed_under_current_tzdata'), 'unknown never counts as equal');
  await assert.rejects(verifyProxySet(artifact_id, { proxySets: store, journal, resolver: shifted(RESULT.tzdata) }),
    code('proxy_set_rules_mismatch'), 'the same tzdata version cannot move a boundary');
  // A resolver that makes re-derivation throw (every boundary in a gap) is treated the same way.
  const gaps = { tzdata: 'test-gaps', formatAt: () => ({ year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 }) };
  await assert.rejects(verifyProxySet(artifact_id, { proxySets: store, journal, resolver: gaps }), code('proxy_set_windows_changed_under_current_tzdata'));
});

test('verification does not re-run the zone-name check, so a case variant stored earlier still verifies (H3)', async (t) => {
  const { store, journal } = await setup(t);
  const rules = { ...RESULT.proxy.rules, time_zone: 'america/new_york' };
  const set = { ...RESULT.proxy, rules, rules_sha256: hashRules(rules) };
  const { artifact_id } = await store.register(set);
  await journal.record(exposure({ ...RESULT, proxy: set }, artifact_id));
  await assert.doesNotReject(verifyProxySet(artifact_id, { proxySets: store, journal }));
});

test('the export CLI needs every flag and an absolute path, writes the stored bytes, and never overwrites', async (t) => {
  const { directory, store } = await setup(t);
  const { artifact_id } = await store.register(RESULT.proxy);
  const output = join(directory, 'export.json');
  await assert.rejects(exportProxySet(['--artifact', artifact_id, '--output', output], store), /confirm-local-write/);
  await assert.rejects(exportProxySet(['--artifact', artifact_id, '--output', 'relative.json', '--confirm-local-write'], store), /absolute/);
  const result = await exportProxySet(['--artifact', artifact_id, '--output', output, '--confirm-local-write'], store);
  assert.deepEqual(result, { artifact_id, output, dates: RESULT.proxy.dates.length });
  assert.equal('sha256:' + createHash('sha256').update(await readFile(output)).digest('hex'), artifact_id);
  await assert.rejects(exportProxySet(['--artifact', artifact_id, '--output', output, '--confirm-local-write'], store), { code: 'EEXIST' });
  assert.deepEqual((await readdir(directory)).sort(), ['export.json', 'proxy']);
});

test('verification details: the journal record must carry the same rules; slot counts are checked; unknown never matches unknown', async (t) => {
  const { store, journal } = await setup(t);
  const p = RESULT.proxy;
  const { artifact_id } = await store.register(p);
  // A record naming this ID but with other rules does not count.
  const other = canonicalizeRules({ ...p.rules, max_missing_slots: 5 });
  await journal.record(exposure(RESULT, artifact_id, { rules: other.rules, rules_sha256: other.rules_sha256 }));
  await assert.rejects(verifyProxySet(artifact_id, { proxySets: store, journal }), code('proxy_set_not_journaled'));
  // Expected slots alone changed, windows intact, journaled under the current tzdata: tampering.
  const slots = await store.register({ ...p, expected_slots: p.expected_slots.map((e, i) => (i === 0 ? e - 1 : e)),
    common_slots: p.common_slots.map((c, i) => (i === 0 ? Math.min(c, p.expected_slots[0] - 1) : c)) });
  await journal.record(exposure(RESULT, slots.artifact_id));
  await assert.rejects(verifyProxySet(slots.artifact_id, { proxySets: store, journal }), code('proxy_set_rules_mismatch'));
  // Journaled with tzdata "unknown" and verified with "unknown": still reported as tzdata drift, never as equal versions.
  const { artifact_id: unknownId } = await store.register({ ...p, windows: p.windows.map((w, i) => (i === 1 ? { ...w, to: '2026-01-07T22:45:00.000Z' } : w)) });
  await journal.record(exposure(RESULT, unknownId, { tzdata: 'unknown' }));
  const unknown = { tzdata: 'unknown', formatAt: intlZoneResolver.formatAt };
  await assert.rejects(verifyProxySet(unknownId, { proxySets: store, journal, resolver: unknown }), code('proxy_set_windows_changed_under_current_tzdata'));
});
