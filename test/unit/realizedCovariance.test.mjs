import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRealizedCovariance, REALIZED_COVARIANCE_LIMITATIONS, FIRST_INTERVAL_LIMITATION } from '../../build/realizedCovariance.js';
import { canonicalizeRules } from '../../build/realizedCovarianceRules.js';
import { normalizeBarSeries } from '../../build/barSeries.js';
import { normalizeProxySet } from '../../build/proxySet.js';

// Independent numpy reference over fixed-offset calendars (plan section 3b). Exact fields must match exactly;
// RC and daily_outer to relative 1e-12, since numpy's summation order and log can differ by an ulp.
const RAW = JSON.parse(readFileSync(new URL('../fixtures/realized-covariance/reference.json', import.meta.url), 'utf8'));
const REFERENCE = { ...RAW, scenarios: RAW.scenarios.map((s) => ({ ...s, series: RAW.bar_sets[s.bars] })) };

const artifact = (i) => `sha256:${String(i).padStart(64, '0')}`;
function bars(spec, tier = 'synthetic_test') {
  return normalizeBarSeries({ schema_version: '1.0', source_id: 'reference', source_sha256: 'sha256:' + 'a'.repeat(64), evidence_tier: tier,
    series_id: spec.series_id, interval_minutes: spec.interval_minutes, open_time: spec.open_time, close: spec.close }).series;
}
function run(scenario, order) {
  const { rules, rules_sha256 } = canonicalizeRules(scenario.rules);
  const series = scenario.series.map((s, i) => ({ artifact_id: artifact(i), bars: bars({ ...s, interval_minutes: rules.interval_minutes }) }));
  return computeRealizedCovariance({ rules, rules_sha256, from_date: scenario.from_date, to_date: scenario.to_date,
    series: order ? order.map((i) => series[i]) : series });
}
const close = (got, want, label) => {
  const scale = Math.max(1e-300, Math.abs(want));
  assert.ok(Math.abs(got - want) <= 1e-12 * scale, `${label}: ${got} vs ${want}`);
};
/**
 * Tolerance from the precision of the log levels, not a flat relative bound. Every step and r_D is a
 * difference of levels near 100 (log_percent) whose rounding, and a one-ulp numpy/V8 log difference, give
 * an absolute error of at most δ = 1e-13 per difference. So |Δ(r_i r_j)| ≤ δ(|r_i| + |r_j|), and
 * |ΔRC_ij| ≤ δ(Σ|s_i| + Σ|s_j|) ≤ δ(√(m·RC_ii) + √(m·RC_jj)) for m steps. A relative 1e-12 is added on top.
 */
const DELTA = 1e-13;
const closeProxy = (got, want, steps, kind, label) => {
  if (want === null) return assert.equal(got, null, label);
  const matrix = typeof want === 'number' ? [[want]] : want;
  const actual = typeof got === 'number' ? [[got]] : got;
  const spread = (i) => (kind === 'rc' ? Math.sqrt(steps * Math.abs(matrix[i][i])) : Math.sqrt(Math.abs(matrix[i][i])));
  matrix.forEach((row, i) => row.forEach((x, j) => {
    const tolerance = DELTA * (spread(i) + spread(j)) + 1e-12 * Math.abs(x);
    assert.ok(Math.abs(actual[i][j] - x) <= tolerance, `${label}[${i}][${j}]: ${actual[i][j]} vs ${x} (tolerance ${tolerance})`);
  }));
};

test('every numpy reference scenario matches: calendar, slots and drops exactly, RC and daily_outer within level precision', () => {
  assert.deepEqual(REFERENCE.scenarios.map((s) => s.name), ['A_100_shaped', 'B_within_day_log', 'E_tuesday_to_friday', 'C_utc_midnight',
    'D_tokyo_0700', 'F_eight_series', 'G_identical_pair']);
  for (const scenario of REFERENCE.scenarios) {
    const r = run(scenario), want = scenario.expected, name = scenario.name;
    for (const field of ['dates', 'windows', 'expected_slots', 'common_slots', 'drop_cause', 'identical_close_pairs']) {
      assert.deepEqual(r.proxy[field], want[field], `${name} ${field}`);
    }
    assert.deepEqual(r.envelope, want.envelope, `${name} envelope`);
    assert.deepEqual(r.diagnostics.map((d) => d.non_slot_bars), want.non_slot_bars, `${name} non_slot_bars`);
    assert.deepEqual(r.diagnostics.map((d) => d.invalid_closes), want.invalid_closes, `${name} invalid_closes`);
    r.proxy.rc.forEach((v, i) => closeProxy(v, want.rc[i], want.common_slots[i] + 1, 'rc', `${name} rc ${want.dates[i]}`));
    r.proxy.daily_outer.forEach((v, i) => closeProxy(v, want.daily_outer[i], 1, 'outer', `${name} daily_outer ${want.dates[i]}`));
  }
});

test('the #100-shaped scenario: causes in order, the D9 first day, non-slot bars, diagnostics and summary', () => {
  const scenario = REFERENCE.scenarios.find((s) => s.name === 'A_100_shaped');
  const r = run(scenario);
  const cause = (date) => r.proxy.drop_cause[r.proxy.dates.indexOf(date)];
  assert.equal(r.proxy.dates[0], '2026-01-06', 'the first day is kept by reading Monday\'s endpoint before from_date');
  assert.equal(cause('2026-01-06'), null);
  assert.equal(cause('2026-01-14'), 'no_endpoint', 'the holiday');
  assert.equal(cause('2026-01-15'), 'no_previous_endpoint', 'the day after the holiday');
  assert.equal(cause('2026-01-22'), 'too_many_missing_slots');
  assert.equal(cause('2026-01-20'), null, 'three missing slots, a null and a zero close stay within max_missing_slots 6');
  // Monday windows start at Friday's endpoint; slot 0 (Sunday 16:45) is absent, one missing slot.
  const monday = r.proxy.dates.indexOf('2026-01-12');
  assert.deepEqual(r.proxy.windows[monday], { from: '2026-01-09T21:45:00.000Z', to: '2026-01-12T21:45:00.000Z' });
  assert.equal(r.proxy.expected_slots[monday] - r.proxy.common_slots[monday], 1);
  // The Saturday bar and the Friday 16:45 bar are non-slot bars inside Monday windows.
  assert.deepEqual(r.diagnostics.map((d) => d.non_slot_bars), [2, 2]);
  const eurusd = r.diagnostics[0];
  const byWeekday = Object.fromEntries(eurusd.modal_local_times.map((m) => [m.weekday, m]));
  assert.equal(byWeekday[7].first_bar, '17:00', 'Sunday opens at 17:00 local');
  assert.equal(byWeekday[5].last_bar, '16:30', 'Friday usually ends with the 16:30 bar');
  assert.equal(byWeekday[6].dates, 1, 'one Saturday bar');
  assert.equal(r.diagnostics[1].invalid_closes, 4, 'three nulls and a zero close');
  assert.deepEqual(r.summary.dropped, { no_endpoint: 1, no_previous_endpoint: 1, too_many_missing_slots: 1, numerically_not_psd: 0 });
  assert.equal(r.summary.kept_days, 16);
  assert.equal(r.summary.missing_slots.days, 19);
  assert.equal(r.summary.missing_slots.max, 96, 'the holiday misses every slot');
  assert.deepEqual(r.limitations, [...REALIZED_COVARIANCE_LIMITATIONS, FIRST_INTERVAL_LIMITATION]);
  const within = run(REFERENCE.scenarios.find((s) => s.name === 'B_within_day_log'));
  assert.ok(!within.limitations.includes(FIRST_INTERVAL_LIMITATION), 'the first-interval limitation is conditional');
});

test('hand-computed RC and daily_outer for n = 1 and n = 2 over two days', () => {
  // UTC days of four 6-hour slots, from_previous_endpoint, log_percent. Day 1 reads the 18:00 bar of 2026-03-01.
  const t = (day, hour) => Date.UTC(2026, 2, day, hour) / 1000;
  const times = [t(1, 18), t(2, 0), t(2, 6), t(2, 12), t(2, 18), t(3, 0), t(3, 6), t(3, 12), t(3, 18)];
  const p = [100, 101, 100, 102, 103, 103, 101, 104, 102];
  const q = [50, 50.5, 51, 50, 49, 49.5, 49, 50, 51];
  const rulesInput = { interval_minutes: 360, time_zone: 'UTC', day_end_local: '00:00', day_weekdays: [1, 2, 3, 4, 5, 6, 7],
    max_missing_slots: 0, first_interval: 'from_previous_endpoint', return_unit: 'log_percent' };
  const { rules, rules_sha256 } = canonicalizeRules(rulesInput);
  const mk = (id, closes) => bars({ series_id: id, interval_minutes: 360, open_time: times, close: closes });
  const one = computeRealizedCovariance({ rules, rules_sha256, from_date: '2026-03-02', to_date: '2026-03-03',
    series: [{ artifact_id: artifact(0), bars: mk('x:P', p) }] });
  // Day 2026-03-02 uses closes 100 (the previous endpoint), 101, 100, 102, 103; day 03 uses 103 … 102.
  const rc = (c) => c.slice(1).reduce((sum, x, i) => sum + (100 * Math.log(x / c[i])) ** 2, 0);
  close(one.proxy.rc[0], rc([100, 101, 100, 102, 103]), 'RC day 1');
  close(one.proxy.rc[1], rc([103, 103, 101, 104, 102]), 'RC day 2');
  close(one.proxy.daily_outer[0], (100 * Math.log(103 / 100)) ** 2, 'outer day 1');
  const two = computeRealizedCovariance({ rules, rules_sha256, from_date: '2026-03-02', to_date: '2026-03-02',
    series: [{ artifact_id: artifact(0), bars: mk('x:P', p) }, { artifact_id: artifact(1), bars: mk('x:Q', q) }] });
  const steps = (c) => c.slice(1).map((x, i) => 100 * Math.log(x / c[i]));
  const sp = steps([100, 101, 100, 102, 103]), sq = steps([50, 50.5, 51, 50, 49]);
  close(two.proxy.rc[0][0][1], sp.reduce((sum, x, i) => sum + x * sq[i], 0), 'RC cross term');
  assert.equal(two.proxy.rc[0][0][1], two.proxy.rc[0][1][0], 'mirrored');
  close(two.proxy.daily_outer[0][0][1], 100 * Math.log(103 / 100) * 100 * Math.log(49 / 50), 'outer cross term');
});

test('metamorphic: permuting series permutes axes; scaling prices leaves RC unchanged within tolerance', () => {
  const eight = REFERENCE.scenarios.find((s) => s.name === 'F_eight_series');
  const base = run(eight), order = [7, 6, 5, 4, 3, 2, 1, 0];
  const permuted = run(eight, order);
  assert.deepEqual(permuted.proxy.underlying_series_ids, order.map((i) => base.proxy.underlying_series_ids[i]));
  base.proxy.rc.forEach((m, d) => m.forEach((row, i) => row.forEach((x, j) => {
    assert.equal(permuted.proxy.rc[d][order.indexOf(i)][order.indexOf(j)], x, `rc ${d} ${i} ${j}`);
  })));
  const scaled = { ...eight, series: eight.series.map((s) => ({ ...s, close: s.close.map((c) => c * 3.7) })) };
  const r = run(scaled);
  r.proxy.rc.forEach((m, d) => m.forEach((row, i) => row.forEach((x, j) => {
    assert.ok(Math.abs(x - base.proxy.rc[d][i][j]) <= 1e-9 * Math.abs(base.proxy.rc[d][i][i] * base.proxy.rc[d][j][j]) ** 0.5, `scaled rc ${d}`);
  })));
});

test('identical closes: a copy with unused bars removed is still a pair, its RC is singular but PSD, and no kept day means none (Q1, R4)', () => {
  const g = run(REFERENCE.scenarios.find((s) => s.name === 'G_identical_pair'));
  assert.deepEqual(g.proxy.identical_close_pairs, [[0, 1]]);
  const m = g.proxy.rc[0];
  assert.ok(Math.abs(m[0][0] * m[1][1] - m[0][1] ** 2) <= 1e-12 * m[0][0] * m[1][1], 'singular');
  // With no kept day, the list is empty (R4): every day of a one-day range dropped.
  const a = REFERENCE.scenarios.find((s) => s.name === 'A_100_shaped');
  const holidayOnly = run({ ...a, from_date: '2026-01-14', to_date: '2026-01-14',
    series: [a.series[0], { ...a.series[0], series_id: 'fx:copy' }] });
  assert.equal(holidayOnly.summary.kept_days, 0);
  assert.deepEqual(holidayOnly.proxy.identical_close_pairs, []);
});

test('near-parity series with r_D exactly 0 pass the scaled invariant', () => {
  const t = (day, hour) => Date.UTC(2026, 2, day, hour) / 1000;
  const times = [t(1, 18), t(2, 0), t(2, 6), t(2, 12), t(2, 18)];
  const { rules, rules_sha256 } = canonicalizeRules({ interval_minutes: 360, time_zone: 'UTC', day_end_local: '00:00', day_weekdays: [1, 2, 3, 4, 5, 6, 7],
    max_missing_slots: 0, first_interval: 'from_previous_endpoint', return_unit: 'log_percent' });
  const r = computeRealizedCovariance({ rules, rules_sha256, from_date: '2026-03-02', to_date: '2026-03-02',
    series: [{ artifact_id: artifact(0), bars: bars({ series_id: 'x:parity', interval_minutes: 360, open_time: times, close: [1.00001, 1.00003, 0.99998, 1.00002, 1.00001] }) }] });
  assert.equal(r.proxy.daily_outer[0], 0);
  assert.ok(r.proxy.rc[0] > 0);
});

test("coverage: a range reading outside any series is rejected with every series' bounds; within_day may start exactly at s(first)", () => {
  const a = REFERENCE.scenarios.find((s) => s.name === 'A_100_shaped');
  assert.throws(() => run({ ...a, from_date: '2026-01-05' }), (e) => e.code === 'range_outside_series_coverage' && /fx:EURUSD .*fx:USDJPY/.test(e.message));
  assert.throws(() => run({ ...a, to_date: '2026-02-02' }), (e) => e.code === 'range_outside_series_coverage');
  // within_day reads from s(first), the Monday 2026-01-12 slot 0 at Sunday 16:45 local; a series starting exactly there is accepted.
  const start = Date.UTC(2026, 0, 11, 21, 45) / 1000;
  const times = Array.from({ length: 96 * 2 }, (_, k) => start + k * 900);
  const within = { ...a, rules: { ...a.rules, first_interval: 'within_day' }, from_date: '2026-01-12', to_date: '2026-01-13',
    series: [{ series_id: 'fx:W', open_time: times, close: times.map((_, k) => 1 + k / 1e4) }] };
  assert.doesNotThrow(() => run(within));
  assert.throws(() => run({ ...within, series: [{ ...within.series[0], open_time: times.slice(1), close: within.series[0].close.slice(1) }] }),
    (e) => e.code === 'range_outside_series_coverage');
});

test('summary: missing-slot quantiles and kept days by weekday match an independent count (Q11)', () => {
  const scenario = REFERENCE.scenarios.find((s) => s.name === 'A_100_shaped');
  const r = run(scenario), want = scenario.expected;
  const missing = want.expected_slots.map((e, i) => e - want.common_slots[i]).sort((x, y) => x - y);
  const rank = (q) => missing[Math.ceil(q * missing.length) - 1];
  assert.deepEqual(r.summary.missing_slots, { days: missing.length, zero_missing_days: missing.filter((m) => m === 0).length,
    min: missing[0], p50: rank(0.5), p90: rank(0.9), max: missing[missing.length - 1] });
  const byWeekday = {};
  want.dates.forEach((date, i) => {
    if (want.drop_cause[i] === null) {
      const weekday = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
      byWeekday[weekday] = (byWeekday[weekday] ?? 0) + 1;
    }
  });
  assert.deepEqual(r.summary.kept_by_weekday, byWeekday);
});

test('identical pairs need equality at every used point, not just the first (Q1)', () => {
  const g = REFERENCE.scenarios.find((s) => s.name === 'G_identical_pair');
  // S0copy with one close changed at a common slot of a kept day: the first point still matches, but it is not a pair.
  const copy = g.series[1];
  const target = copy.open_time.indexOf(Date.UTC(2026, 0, 7, 3, 0) / 1000);
  assert.ok(target > 0);
  const changed = { ...copy, close: copy.close.map((c, i) => (i === target ? c * 1.0001 : c)) };
  const r = run({ ...g, series: [g.series[0], changed, g.series[2]] });
  assert.equal(r.proxy.drop_cause[0], null);
  assert.deepEqual(r.proxy.identical_close_pairs, []);
});

test('modal local times break ties toward the earlier time', () => {
  // UTC days of 15-minute bars from 2026-01-05 to 2026-01-12, except 2026-01-12's 00:00 bar: the two Mondays
  // open at 00:00 and 00:15, once each, so the tie goes to 00:00.
  const { rules, rules_sha256 } = canonicalizeRules({ interval_minutes: 15, time_zone: 'UTC', day_end_local: '00:00', day_weekdays: [1, 2, 3, 4, 5, 6, 7],
    max_missing_slots: 90, first_interval: 'within_day', return_unit: 'log' });
  const start = Date.UTC(2026, 0, 5) / 1000;
  const times = Array.from({ length: 96 * 8 }, (_, k) => start + k * 900).filter((t) => t !== Date.UTC(2026, 0, 12) / 1000);
  const series = [{ artifact_id: artifact(0), bars: bars({ series_id: 'x:M', interval_minutes: 15, open_time: times, close: times.map((_, k) => 1 + k / 1e4) }) }];
  const one = computeRealizedCovariance({ rules, rules_sha256, from_date: '2026-01-05', to_date: '2026-01-05', series });
  assert.deepEqual(one.diagnostics[0].modal_local_times, [{ weekday: 1, dates: 1, first_bar: '00:00', last_bar: '23:45' }],
    'only bars in the read span count');
  const both = computeRealizedCovariance({ rules, rules_sha256, from_date: '2026-01-05', to_date: '2026-01-12', series });
  const mondays = both.diagnostics[0].modal_local_times.find((m) => m.weekday === 1);
  assert.deepEqual([mondays.dates, mondays.first_bar], [2, '00:00']);
});

test('regression goldens: rules hashes, proxy-set IDs and the bits of the first kept day (plan section 3d)', () => {
  // Pinned from the step 8 build on Node 24. A change here changes every ID for the same bars and rules.
  const bits = (x) => { const b = Buffer.alloc(8); b.writeDoubleBE(x); return b.toString('hex'); };
  const pick = (v) => (typeof v === 'number' ? [bits(v)] : [bits(v[0][0]), bits(v[0][1]), bits(v[1][1])]);
  const GOLDEN = {
    A_100_shaped: ['sha256:5e1a2a693fa3476bb3debe5f3acf044b879fc00a3f7419b740801c666de46346',
      'sha256:75ee68c3142e297811477dc5083bd3a4bf5a174ef9c93fc7c6c5af23976fa7b9',
      ['3faa74fb742a477d', 'bf8917ca123eaadf', '3fb568087e274499'], ['3fb2534e41f42853', 'bfc6685ccd9cfcde', '3fdb663892dfe37a']],
    B_within_day_log: ['sha256:c921334fe9f0ddeefcf41e730cc04ad2ea4ed6665f0968b8fac63ad44c7bc82a',
      'sha256:9dee5f04052f47052899bd7c4dd65f952d4a0e57f0220c31759bcc0ae5fd0c53',
      ['3ed59c11675a2b32', 'beb4073d69f18f36', '3ee1665cd02c3a30'], ['3ee06de520c47c80', 'bef3f38871c36b92', '3f083a759bb4c880']],
    D_tokyo_0700: ['sha256:1acae4b7ef9fe01e3220e1f8c0a4ca77d4d0d4b9e0df19d212d6a910e3f78b18',
      'sha256:46de8aee69d591ae146abcdd7b5b27dd51397b3348be9a5bc3c4ab721865386a',
      ['3fb5831b266f89bf', '3f6bc547576edf5f', '3f6a2e3126e21dc6'], ['3fd22fffef9d8b4f', 'bfa1bf6ff91be0b8', '3f715198a879d8c2']],
  };
  for (const [name, [rulesSha, proxySetId, rcBits, outerBits]] of Object.entries(GOLDEN)) {
    const r = run(REFERENCE.scenarios.find((s) => s.name === name));
    assert.equal(r.proxy.rules_sha256, rulesSha, `${name} rules_sha256`);
    assert.equal(normalizeProxySet(r.proxy).artifact_id, proxySetId, `${name} proxy_set_id`);
    assert.equal(r.proxy.drop_cause[0], null, `${name} keeps its first day`);
    assert.deepEqual(pick(r.proxy.rc[0]), rcBits, `${name} rc bits`);
    assert.deepEqual(pick(r.proxy.daily_outer[0]), outerBits, `${name} daily_outer bits`);
  }
});

test('a day lacking both its endpoint and the previous one is no_endpoint: the first cause wins', () => {
  // A_100_shaped already lacks Wednesday 2026-01-14's endpoint. Removing Thursday's endpoint bar (16:30 New York)
  // from one series leaves Thursday without both; Friday then lacks only the previous endpoint.
  const scenario = REFERENCE.scenarios.find((s) => s.name === 'A_100_shaped');
  const thursdayEndpoint = Date.parse('2026-01-15T21:30:00.000Z') / 1000;
  const [first, ...rest] = scenario.series;
  const keep = first.open_time.map((t) => t !== thursdayEndpoint);
  const trimmed = { ...first, open_time: first.open_time.filter((_, i) => keep[i]), close: first.close.filter((_, i) => keep[i]) };
  const r = run({ ...scenario, series: [trimmed, ...rest] });
  assert.deepEqual(r.proxy.dates.slice(6, 9), ['2026-01-14', '2026-01-15', '2026-01-16']);
  assert.deepEqual(r.proxy.drop_cause.slice(6, 9), ['no_endpoint', 'no_endpoint', 'no_previous_endpoint']);
});

test('bars outside the span read are ignored: a 1970-2099 M1 series computes one day from its own bars (code review C3)', () => {
  // The dense grid used to follow each series' whole extent: 547 MB per series here. Now only the day's bars count.
  const { rules, rules_sha256 } = canonicalizeRules({ interval_minutes: 1, time_zone: 'UTC', day_end_local: '00:00',
    day_weekdays: [1, 2, 3, 4, 5, 6, 7], max_missing_slots: 0, first_interval: 'within_day', return_unit: 'log' });
  const day = Date.UTC(2026, 2, 2) / 1000;
  const spec = (id, drift) => {
    const open_time = [0, ...Array.from({ length: 1440 }, (_, k) => day + 60 * k), 4_102_444_740];
    return bars({ series_id: id, interval_minutes: 1, open_time, close: open_time.map((_, k) => 100 + drift * Math.sin(k)) });
  };
  const series = [spec('far:A', 0.01), spec('far:B', 0.02)].map((b, i) => ({ artifact_id: artifact(i), bars: b }));
  const r = computeRealizedCovariance({ rules, rules_sha256, from_date: '2026-03-02', to_date: '2026-03-02', series });
  assert.deepEqual([r.summary.kept_days, r.proxy.common_slots[0], r.proxy.expected_slots[0]], [1, 1440, 1440]);
  assert.deepEqual(r.diagnostics.map((d) => [d.first_bar, d.last_bar, d.invalid_closes]),
    [0, 1].map(() => ['1970-01-01T00:00:00.000Z', '2099-12-31T23:59:00.000Z', 0]));
  // The same day computed from the day's bars alone gives the same proxies.
  const alone = (b) => ({ ...b, open_time: b.open_time.slice(1, -1), close: b.close.slice(1, -1) });
  const bare = computeRealizedCovariance({ rules, rules_sha256, from_date: '2026-03-02', to_date: '2026-03-02',
    series: series.map((s) => ({ ...s, bars: alone(s.bars) })) });
  assert.deepEqual([r.proxy.rc, r.proxy.daily_outer], [bare.proxy.rc, bare.proxy.daily_outer]);
});
