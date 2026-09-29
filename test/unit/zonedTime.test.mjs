import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wallTimeToUtc, checkTimeZoneName, intlZoneResolver, offsetAt, offsetTimeline } from '../../build/zonedTime.js';

// Hand-derived from the published zone rules and cross-checked with Python zoneinfo (plan section 3a).
const REFERENCE = JSON.parse(readFileSync(new URL('../fixtures/realized-covariance/calendar-reference.json', import.meta.url), 'utf8')).cases;
const iso = (ms) => new Date(ms).toISOString();

test('wall time resolves to the hand-derived instant, gap or fold in every reference case', () => {
  assert.equal(REFERENCE.length, 19);
  for (const c of REFERENCE) {
    const [hour, minute] = c.time.split(':').map(Number);
    const got = wallTimeToUtc(c.zone, c.date, hour, minute);
    const shown = got.kind === 'unique' ? iso(got.instant) : got.kind === 'fold' ? got.instants.map(iso) : 'gap';
    assert.deepEqual(shown, c.expect, `${c.zone} ${c.date} ${c.time} (${c.rule})`);
  }
});

test('midnight resolves with hourCycle h23, not as a 24:00 gap (plan review Q3)', () => {
  const r = wallTimeToUtc('UTC', '2026-06-16', 0, 0);
  assert.deepEqual(r, { kind: 'unique', instant: Date.UTC(2026, 5, 16) });
  assert.equal(intlZoneResolver.formatAt('UTC', Date.UTC(2026, 5, 16)).hour, 0);
  assert.equal(wallTimeToUtc('Asia/Tokyo', '2026-06-16', 0, 0).kind, 'unique');
});

test('offsets come from the injected resolver, and folds list every surviving instant in order', () => {
  // A resolver with a fixed +02:00 offset, and one that shows the same wall time twice.
  const fixed = { tzdata: 'test-fixed', formatAt: (zone, ms) => {
    const d = new Date(ms + 2 * 3_600_000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
  } };
  assert.deepEqual(wallTimeToUtc('Test/Fixed', '2026-06-16', 12, 0, fixed), { kind: 'unique', instant: Date.UTC(2026, 5, 16, 10) });
  assert.equal(offsetAt('Test/Fixed', Date.UTC(2026, 5, 16), fixed), 2 * 3_600_000);
  const nyFold = wallTimeToUtc('America/New_York', '2026-11-01', 1, 30);
  assert.deepEqual(nyFold.instants.map(iso), ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
});

test('zone names: unknown names and case variants are rejected; aliases are accepted verbatim (G7, H3, Q13)', () => {
  assert.equal(checkTimeZoneName('America/New_York'), 'ok');
  assert.equal(checkTimeZoneName('US/Eastern'), 'ok');
  assert.notEqual(checkTimeZoneName('america/new_york'), 'ok');
  assert.equal(checkTimeZoneName('Not/AZone'), 'unknown_time_zone');
});

test('the offset timeline equals a direct lookup at every minute around each transition, including 30-minute shifts', () => {
  for (const [zone, from, to] of [['America/New_York', Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1)],
    ['Australia/Lord_Howe', Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1)], ['Africa/Cairo', Date.UTC(2026, 3, 20), Date.UTC(2026, 10, 5)]]) {
    const timeline = offsetTimeline(zone, from, to);
    // Every minute within 90 minutes of each change found by a coarse hourly scan, plus a sparse sweep.
    const checks = [];
    for (let t = from; t < to; t += 3_600_000) {
      if (offsetAt(zone, t) !== offsetAt(zone, t + 3_600_000)) for (let m = t - 5_400_000; m <= t + 5_400_000; m += 60_000) checks.push(m);
    }
    assert.ok(checks.length > 0, `${zone} has transitions in the range`);
    for (let t = from; t < to; t += 7 * 3_600_000 + 13 * 60_000) checks.push(t);
    for (const t of checks) assert.equal(timeline(t), offsetAt(zone, t), `${zone} ${new Date(t).toISOString()}`);
  }
});
