import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  canonicalizeRules, planCalendar, assertWindowWithinLag, assertSeriesAgainstRules, isoWeekday, addDays,
  REALIZED_COVARIANCE_MAX_DATES,
} from '../../build/realizedCovarianceRules.js';

const iso = (ms) => new Date(ms).toISOString();
// #100's rules as the worked example (design section "Rules").
const RULES_100 = { interval_minutes: 15, time_zone: 'America/New_York', day_end_local: '16:45', day_weekdays: [1, 2, 3, 4, 5],
  max_missing_slots: 6, first_interval: 'from_previous_endpoint', return_unit: 'log_percent' };
const rules = (patch = {}) => canonicalizeRules({ ...RULES_100, ...patch }).rules;
const fails = (fn, code) => assert.throws(fn, (error) => error.code === code || new RegExp(code).test(error.message));

test('rules canonicalize to a fixed key order and sorted weekdays, hashed as JSON', () => {
  const { rules: canonical, rules_sha256 } = canonicalizeRules({ return_unit: 'log_percent', ...RULES_100, day_weekdays: [5, 3, 1, 2, 4] });
  assert.deepEqual(Object.keys(canonical), ['interval_minutes', 'time_zone', 'day_end_local', 'day_weekdays', 'max_missing_slots',
    'first_interval', 'return_unit']);
  assert.deepEqual(canonical.day_weekdays, [1, 2, 3, 4, 5]);
  assert.equal(rules_sha256, 'sha256:' + createHash('sha256').update(JSON.stringify(canonical)).digest('hex'));
  assert.equal(canonicalizeRules(RULES_100).rules_sha256, rules_sha256);
  assert.notEqual(canonicalizeRules({ ...RULES_100, max_missing_slots: 5 }).rules_sha256, rules_sha256);
});

test('rule bounds, duplicates, units and zone names are validated (Q11, Q12, G7)', () => {
  const bad = (patch, code) => (code ? fails(() => canonicalizeRules({ ...RULES_100, ...patch }), code)
    : assert.throws(() => canonicalizeRules({ ...RULES_100, ...patch })));
  bad({ day_end_local: '24:00' });
  bad({ day_end_local: '9:30' });
  bad({ max_missing_slots: 1441 });
  bad({ max_missing_slots: -1 });
  bad({ max_missing_slots: 1.5 });
  bad({ day_weekdays: [] });
  bad({ day_weekdays: [0] });
  bad({ day_weekdays: [8] });
  bad({ day_weekdays: [1, 1] }, 'invalid_rules');
  bad({ interval_minutes: 7 }, 'interval_mismatch');
  bad({ first_interval: 'previous_close' });
  bad({ return_unit: 'simple' });
  bad({ extra: 1 });
  bad({ time_zone: 'Not/AZone' }, 'unknown_time_zone');
  // A case variant is rejected; an alias is accepted verbatim with its own hash (only these two are pinned, Q13).
  assert.throws(() => canonicalizeRules({ ...RULES_100, time_zone: 'america/new_york' }), /time_zone/);
  const alias = canonicalizeRules({ ...RULES_100, time_zone: 'US/Eastern' });
  assert.equal(alias.rules.time_zone, 'US/Eastern');
  assert.notEqual(alias.rules_sha256, canonicalizeRules(RULES_100).rules_sha256);
});

test("#100 rules: 96 slots, Monday windows start at Friday's endpoint, and the first day reads a previous endpoint (D9)", () => {
  const { days } = planCalendar(rules(), '2026-03-06', '2026-03-10');   // NY switches to EDT on Sunday 2026-03-08
  assert.deepEqual(days.map((d) => [d.label, iso(d.start), iso(d.end), d.previous_label, iso(d.window_from), d.expected_slots]), [
    ['2026-03-06', '2026-03-05T21:45:00.000Z', '2026-03-06T21:45:00.000Z', '2026-03-05', '2026-03-05T21:45:00.000Z', 96],
    ['2026-03-09', '2026-03-08T20:45:00.000Z', '2026-03-09T20:45:00.000Z', '2026-03-06', '2026-03-06T21:45:00.000Z', 96],
    ['2026-03-10', '2026-03-09T20:45:00.000Z', '2026-03-10T20:45:00.000Z', '2026-03-09', '2026-03-09T20:45:00.000Z', 96],
  ]);
  // within_day reports each day's own window.
  const within = planCalendar(rules({ first_interval: 'within_day' }), '2026-03-09', '2026-03-09').days[0];
  assert.equal(iso(within.window_from), '2026-03-08T20:45:00.000Z');
});

test('labels by rule arithmetic: 00:00, Tokyo 07:00, and no duplicates where DST starts at midnight (G1)', () => {
  const utc = planCalendar(rules({ time_zone: 'UTC', day_end_local: '00:00', day_weekdays: [1, 2, 3, 4, 5, 6, 7], first_interval: 'within_day' }),
    '2026-06-16', '2026-06-16').days[0];
  assert.deepEqual([iso(utc.start), iso(utc.end)], ['2026-06-16T00:00:00.000Z', '2026-06-17T00:00:00.000Z']);
  // At m = interval exactly (00:15 with 15-minute bars) the last slot opens at 00:00 on x, so the label is x.
  const edge = planCalendar(rules({ time_zone: 'UTC', day_end_local: '00:15', day_weekdays: [1, 2, 3, 4, 5, 6, 7], first_interval: 'within_day' }),
    '2026-06-16', '2026-06-16').days[0];
  assert.deepEqual([iso(edge.start), iso(edge.end)], ['2026-06-15T00:15:00.000Z', '2026-06-16T00:15:00.000Z']);
  const tokyo = planCalendar(rules({ time_zone: 'Asia/Tokyo', day_end_local: '07:00' }), '2026-06-16', '2026-06-16').days[0];
  assert.deepEqual([iso(tokyo.start), iso(tokyo.end)], ['2026-06-14T22:00:00.000Z', '2026-06-15T22:00:00.000Z']);
  for (const zone of ['Africa/Cairo', 'America/Havana']) {
    const { days } = planCalendar(rules({ time_zone: zone, day_end_local: '01:00', day_weekdays: [1, 2, 3, 4, 5, 6, 7] }), '2026-02-01', '2026-11-30');
    const labels = days.map((d) => d.label);
    assert.equal(new Set(labels).size, labels.length, zone);
    days.forEach((d, i) => { if (i > 0) assert.equal(d.start, days[i - 1].end, `${zone} ${d.label} is contiguous`); });
  }
});

test('DST days get their exact grid slot counts: Cairo Fridays 92 and 100, Lord Howe Sundays 98 and 94 (Q14)', () => {
  const cairo = planCalendar(rules({ time_zone: 'Africa/Cairo', day_end_local: '01:00', day_weekdays: [5] }), '2026-04-17', '2026-11-06').days;
  assert.deepEqual(cairo.filter((d) => d.expected_slots !== 96).map((d) => [d.label, d.expected_slots]), [['2026-04-24', 92], ['2026-10-30', 100]]);
  const lordHowe = planCalendar(rules({ time_zone: 'Australia/Lord_Howe', day_weekdays: [7] }), '2026-03-29', '2026-10-11').days;
  assert.deepEqual(lordHowe.filter((d) => d.expected_slots !== 96).map((d) => [d.label, d.expected_slots]), [['2026-04-05', 98], ['2026-10-04', 94]]);
});

test('call validation: grid, DST gap or fold, slot minimum, dates, and the window backstop', () => {
  // Off-grid: Kolkata 17:00 is 11:30Z, fine for 15-minute bars but not for 60-minute ones.
  assert.doesNotThrow(() => planCalendar(rules({ time_zone: 'Asia/Kolkata', day_end_local: '17:00' }), '2026-06-15', '2026-06-19'));
  fails(() => planCalendar(rules({ time_zone: 'Asia/Kolkata', day_end_local: '17:00', interval_minutes: 60, max_missing_slots: 0 }),
    '2026-06-15', '2026-06-19'), 'boundary_not_on_grid');
  // NY 16:00 with 120-minute bars is on the grid in summer (20:00Z) but not in winter (21:00Z).
  const twoHour = rules({ day_end_local: '16:00', interval_minutes: 120, max_missing_slots: 0 });
  assert.doesNotThrow(() => planCalendar(twoHour, '2026-06-15', '2026-06-19'));
  fails(() => planCalendar(twoHour, '2026-10-26', '2026-11-06'), 'boundary_not_on_grid');
  // A 02:30 boundary falls in the spring gap, and 01:30 in the autumn fold, via Monday's s(D) on Sunday.
  fails(() => planCalendar(rules({ day_end_local: '02:30' }), '2026-03-02', '2026-03-13'), 'boundary_in_dst_gap_or_fold');
  fails(() => planCalendar(rules({ day_end_local: '01:30' }), '2026-10-26', '2026-11-06'), 'boundary_in_dst_gap_or_fold');
  assert.doesNotThrow(() => planCalendar(rules({ day_end_local: '02:30' }), '2026-06-01', '2026-06-30'));
  // A daily interval leaves one slot: RC would equal the daily outer product (F11).
  fails(() => planCalendar(rules({ time_zone: 'UTC', day_end_local: '00:00', interval_minutes: 1440, max_missing_slots: 0 }),
    '2026-06-15', '2026-06-19'), 'too_few_slots_for_rule');
  fails(() => planCalendar(rules({ max_missing_slots: 95 }), '2026-06-15', '2026-06-19'), 'too_few_slots_for_rule');
  assert.doesNotThrow(() => planCalendar(rules({ max_missing_slots: 94 }), '2026-06-15', '2026-06-19'));
  fails(() => planCalendar(rules({ first_interval: 'within_day', max_missing_slots: 94 }), '2026-06-15', '2026-06-19'), 'too_few_slots_for_rule');
  fails(() => planCalendar(rules(), '2026-06-19', '2026-06-15'), 'invalid_date_range');
  fails(() => planCalendar(rules(), '2026-02-30', '2026-03-02'), 'invalid_date_range');
  // Out-of-range fields are invalid dates, not a RangeError from toISOString (re-review R1).
  for (const bad of ['2026-13-01', '2026-01-32', '2026-00-10', '2026-99-99']) fails(() => planCalendar(rules(), bad, '2026-12-31'), 'invalid_date_range');
  fails(() => planCalendar(rules(), '2026-06-15', '2026-06-31'), 'invalid_date_range');
  // Dates stay inside the bar range (code review C1): past 9999-12-31 the next day is an extended year that string
  // comparison sorts before it, which looped forever; years 0-99 went through Date.UTC as 1900-1999.
  fails(() => planCalendar(rules(), '9999-12-27', '9999-12-31'), 'invalid_date_range');
  fails(() => planCalendar(rules({ time_zone: 'UTC' }), '0050-01-04', '0050-01-08'), 'invalid_date_range');
  fails(() => planCalendar(rules(), '1969-12-29', '1970-01-02'), 'invalid_date_range');
  fails(() => planCalendar(rules(), '2099-12-28', '2100-01-01'), 'invalid_date_range');
  assert.equal(planCalendar(rules(), '1970-01-01', '1970-01-02').days.length, 2, 'the first bound is inclusive');
  assert.equal(planCalendar(rules(), '2099-12-28', '2099-12-31').days.length, 4, 'the last bound is inclusive');
  fails(() => planCalendar(rules({ day_weekdays: [6] }), '2026-06-15', '2026-06-19'), 'no_produced_days');
  const everyDay = rules({ time_zone: 'UTC', day_end_local: '00:00', day_weekdays: [1, 2, 3, 4, 5, 6, 7], first_interval: 'within_day' });
  assert.equal(planCalendar(everyDay, '2000-01-01', addDays('2000-01-01', REALIZED_COVARIANCE_MAX_DATES - 1)).days.length, 5000);
  fails(() => planCalendar(everyDay, '2000-01-01', addDays('2000-01-01', REALIZED_COVARIANCE_MAX_DATES)), 'too_many_dates');
  // The window backstop (G5): unreachable from valid rules, so it is tested directly.
  assert.doesNotThrow(() => assertWindowWithinLag(Date.UTC(2026, 5, 8, 12), '2026-06-16'));
  fails(() => assertWindowWithinLag(Date.UTC(2026, 5, 7, 23, 59), '2026-06-16'), 'window_too_long');
});

test('series checks: duplicate artifacts or series IDs, and interval mismatch (F11, Q12)', () => {
  const r = rules();
  const s = (artifact, id, interval = 15) => ({ artifact_id: `sha256:${artifact.repeat(64)}`, series_id: id, interval_minutes: interval });
  assert.doesNotThrow(() => assertSeriesAgainstRules([s('a', 'x'), s('b', 'y')], r));
  fails(() => assertSeriesAgainstRules([s('a', 'x'), s('a', 'y')], r), 'duplicate_series');
  fails(() => assertSeriesAgainstRules([s('a', 'x'), s('b', 'x')], r), 'duplicate_series');
  fails(() => assertSeriesAgainstRules([s('a', 'x', 5)], r), 'interval_mismatch');
});

test('the injected resolver drives the calendar and reports its tzdata', () => {
  const fixed = { tzdata: 'test-2099a', formatAt: (zone, ms) => {
    const d = new Date(ms + 3 * 3_600_000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
  } };
  const plan = planCalendar({ ...rules(), time_zone: 'Test/Plus3' }, '2026-06-16', '2026-06-16', fixed);
  assert.equal(plan.tzdata, 'test-2099a');
  assert.equal(iso(plan.days[0].end), '2026-06-16T13:45:00.000Z');
  assert.equal(isoWeekday('2026-06-15'), 1);
  assert.equal(isoWeekday('2026-06-21'), 7);
});
