import assert from "node:assert/strict";
import test from "node:test";
import { aggregateFxCsvM1, brokerWallTimeToUtcMs } from "../../build/fxCsvM1Aggregation.js";

const row = (stamp, o, h, l, c, v = 1) => `${stamp},${o},${h},${l},${c},${v}`;
const run = (lines, overrides = {}) => aggregateFxCsvM1({
  lines, bucketMinutes: 15, startFromBrokerDate: "2016.01.01", minimumMinuteCoverage: 1, ...overrides,
});

test("broker wall time tracks New York rather than Europe across both daylight-saving regimes", () => {
  // Winter: broker is New York plus seven, so UTC is broker minus two.
  assert.equal(new Date(brokerWallTimeToUtcMs(2024, 1, 12, 23, 45)).toISOString(), "2024-01-12T21:45:00.000Z");
  // Summer: UTC is broker minus three.
  assert.equal(new Date(brokerWallTimeToUtcMs(2024, 7, 12, 23, 45)).toISOString(), "2024-07-12T20:45:00.000Z");
  // The weeks that separate the two rules are the ones that matter. US daylight saving began
  // 2024-03-10 and European on 2024-03-31; an EET clock would place this an hour later.
  assert.equal(new Date(brokerWallTimeToUtcMs(2024, 3, 15, 23, 45)).toISOString(), "2024-03-15T20:45:00.000Z");
  // Back the other way: European daylight saving ended 2024-10-27, American on 2024-11-03.
  assert.equal(new Date(brokerWallTimeToUtcMs(2024, 10, 30, 23, 45)).toISOString(), "2024-10-30T20:45:00.000Z");
});

test("aggregation takes first open, extreme high and low, last close, and summed tick volume", () => {
  const result = run([
    row("2024.01.12 09:00", 1.1, 1.12, 1.09, 1.11, 5),
    row("2024.01.12 09:07", 1.11, 1.15, 1.105, 1.14, 7),
    row("2024.01.12 09:14", 1.14, 1.141, 1.08, 1.09, 3),
  ]);
  assert.equal(result.bars.length, 1);
  assert.deepEqual(result.bars[0], {
    timeIso: "2024-01-12T07:00:00.000Z",
    open: 1.1, high: 1.15, low: 1.08, close: 1.09, tickVolume: 15, minutesPresent: 3,
  });
  assert.deepEqual(result.qualityIssues, []);
});

test("rows before the start boundary are refused rather than converted with the wrong clock", () => {
  // 2012-2014 in the supplied file runs on Tokyo time; converting it as New York plus seven would
  // shift it by hours while still landing on quarter-hour boundaries, so it must not be silent.
  const result = run([
    row("2014.06.02 09:00", 1.1, 1.1, 1.1, 1.1),
    row("2024.01.12 09:00", 1.2, 1.2, 1.2, 1.2),
  ]);
  assert.equal(result.quality.rowsBeforeStart, 1);
  assert.equal(result.bars.length, 1);
  assert.equal(result.bars[0].open, 1.2);
});

test("a weekend leaves its buckets empty instead of joining Friday to Monday", () => {
  const result = run([
    row("2024.01.12 23:45", 1.1, 1.1, 1.1, 1.1),
    row("2024.01.15 00:00", 1.2, 1.2, 1.2, 1.2),
  ]);
  assert.equal(result.bars.length, 2);
  assert.equal(result.bars[0].timeIso, "2024-01-12T21:45:00.000Z");
  assert.equal(result.bars[1].timeIso, "2024-01-14T22:00:00.000Z");
  assert.notEqual(result.bars[0].timeIso, result.bars[1].timeIso);
});

test("identical repeats are dropped and a disagreeing repeat discards the bucket it landed in", () => {
  const same = run([
    row("2024.01.12 09:00", 1.1, 1.1, 1.1, 1.1, 4),
    row("2024.01.12 09:00", 1.1, 1.1, 1.1, 1.1, 4),
  ]);
  assert.equal(same.quality.duplicateTimestampsDropped, 1);
  assert.equal(same.quality.conflictingDuplicateTimestamps, 0);
  assert.equal(same.bars[0].tickVolume, 4);

  // Keeping the copy that arrived first would settle a source disagreement by file order, so the
  // bucket goes. The neighbouring bucket is untouched: the refusal is local to the conflict.
  const conflicting = run([
    row("2024.01.12 09:00", 1.1, 1.1, 1.1, 1.1, 4),
    row("2024.01.12 09:00", 1.2, 1.2, 1.2, 1.2, 9),
    row("2024.01.12 09:15", 1.3, 1.3, 1.3, 1.3, 2),
  ]);
  assert.equal(conflicting.quality.conflictingDuplicateTimestamps, 1);
  assert.equal(conflicting.quality.bucketsDroppedForConflictingDuplicates, 1);
  assert.ok(conflicting.qualityIssues.includes("one_or_more_duplicate_timestamps_disagreed"));
  assert.ok(conflicting.qualityIssues.includes("one_or_more_buckets_dropped_for_conflicting_duplicates"));
  assert.deepEqual(conflicting.bars.map((bar) => bar.timeIso), ["2024-01-12T07:15:00.000Z"]);
});

test("a row rejected as a candle does not make the correction that follows it look like a repeat", () => {
  // Advancing the read position on a rejected row was enough to lose the good row behind it: the
  // two share a minute, so the second arrived at the duplicate branch and was dropped there.
  const result = run([
    row("2024.01.12 09:00", 1.1, 1.05, 1.09, 1.11),
    row("2024.01.12 09:00", 1.1, 1.12, 1.09, 1.11, 6),
  ]);
  assert.equal(result.quality.rowsMalformed, 1);
  assert.equal(result.quality.duplicateTimestampsDropped, 0);
  assert.equal(result.bars.length, 1);
  assert.equal(result.bars[0].tickVolume, 6);
});

test("prices and volumes that parse to infinity are refused rather than serialized as null", () => {
  // A long enough run of digits is still a match for the row pattern, and Infinity satisfies every
  // ordering comparison a candle check makes, so it passed and left the file as a null price.
  const huge = "9".repeat(400);
  const price = run([row("2024.01.12 09:00", 1.1, huge, 1.09, 1.11)]);
  assert.equal(price.quality.rowsMalformed, 1);
  assert.equal(price.bars.length, 0);

  const volume = run([row("2024.01.12 09:00", 1.1, 1.12, 1.09, 1.11, huge)]);
  assert.equal(volume.quality.rowsMalformed, 1);
  assert.equal(volume.bars.length, 0);
});

test("a timestamp the calendar does not have is refused instead of rolled forward", () => {
  // Date.UTC would move February 30th into March and stamp a bar at a time the source never named.
  const result = run([
    row("2024.02.30 09:00", 1.1, 1.1, 1.1, 1.1),
    row("2024.13.01 09:00", 1.1, 1.1, 1.1, 1.1),
    row("2024.01.12 25:00", 1.1, 1.1, 1.1, 1.1),
    row("2024.01.12 09:60", 1.1, 1.1, 1.1, 1.1),
    row("2024.01.12 09:00", 1.1, 1.1, 1.1, 1.1),
  ]);
  assert.equal(result.quality.rowsMalformed, 4);
  assert.deepEqual(result.bars.map((bar) => bar.timeIso), ["2024-01-12T07:00:00.000Z"]);
  // A leap day the year actually has still passes.
  assert.equal(run([row("2024.02.29 09:00", 1.1, 1.1, 1.1, 1.1)]).bars.length, 1);
  assert.equal(run([row("2023.02.29 09:00", 1.1, 1.1, 1.1, 1.1)]).quality.rowsMalformed, 1);
});

test("a month repeated later in the stream is refused and its span is reported", () => {
  // The supplied file repeats two whole months elsewhere in the file rather than adjacently, so the
  // repeat arrives as a backward jump. Reporting the span is what shows no real rows were refused.
  const result = run([
    row("2024.01.12 09:00", 1.1, 1.1, 1.1, 1.1),
    row("2024.02.12 09:00", 1.2, 1.2, 1.2, 1.2),
    row("2024.01.12 09:01", 1.1, 1.1, 1.1, 1.1),
  ]);
  assert.equal(result.quality.outOfOrderRows, 1);
  assert.deepEqual(result.quality.outOfOrderRange, {
    from: "2024-01-12T07:01:00.000Z", to: "2024-01-12T07:01:00.000Z",
  });
  assert.equal(result.bars.length, 2);
});

test("buckets below the minimum minute coverage are counted and withheld", () => {
  const result = run([
    row("2024.01.12 09:00", 1.1, 1.1, 1.1, 1.1),
    row("2024.01.12 09:15", 1.2, 1.2, 1.2, 1.2),
    row("2024.01.12 09:16", 1.2, 1.2, 1.2, 1.2),
  ], { minimumMinuteCoverage: 2 });
  assert.equal(result.quality.bucketsBelowMinimumCoverage, 1);
  assert.equal(result.bars.length, 1);
  assert.equal(result.bars[0].minutesPresent, 2);
});

test("an OHLC row that cannot be a candle is refused", () => {
  const result = run([row("2024.01.12 09:00", 1.1, 1.05, 1.09, 1.11)]);
  assert.equal(result.quality.rowsMalformed, 1);
  assert.equal(result.bars.length, 0);
  assert.ok(result.qualityIssues.includes("one_or_more_source_rows_were_unusable"));
});

test("aggregation refuses a bucket length that does not divide a day", () => {
  assert.throws(() => run([], { bucketMinutes: 7 }), /divide a day evenly/);
  assert.throws(() => run([], { startFromBrokerDate: "2016-01-01" }), /broker calendar date/);
  assert.throws(() => run([], { startFromBrokerDate: "2016.02.30" }), /broker calendar date/);
  assert.throws(() => run([], { startFromBrokerDate: "2016.13.01" }), /broker calendar date/);
  assert.throws(() => run([], { minimumMinuteCoverage: 16 }), /minimum minute coverage/);
});
