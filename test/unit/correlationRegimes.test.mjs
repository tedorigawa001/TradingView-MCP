import assert from "node:assert/strict";
import test from "node:test";
import { computeCorrelationRegimes } from "../../build/correlationRegimes.js";

function bar(time, close, forming = false) {
  return { time, timeIso: new Date(time * 1000).toISOString(), open: close, high: close, low: close, close, volume: 1, forming };
}

test("correlation regimes use only exact closed timestamps and label strong inverse correlation", () => {
  const primary = [100, 101, 103, 106, 110, 115].map((close, index) => bar(index * 60, close));
  const reference = [100, 99, 97, 94, 90, 85].map((close, index) => bar(index * 60, close));
  const result = computeCorrelationRegimes({ primaryBars: primary, referenceBars: reference,
    timeframe: "1", window: 3, strongThreshold: 0.7, neutralThreshold: 0.2 });
  assert.equal(result.alignmentPolicy, "exact_utc_timestamp_no_forward_fill");
  assert.equal(result.sample.alignedBars, 6);
  assert.equal(result.observations.length, 3);
  assert.equal(result.observations.at(-1).regime, "strong_negative");
});

test("correlation regimes do not manufacture observations from forming or missing bars", () => {
  const result = computeCorrelationRegimes({
    primaryBars: [bar(0, 100), bar(60, 101), bar(120, 102, true)],
    referenceBars: [bar(0, 100), bar(120, 98)],
    timeframe: "1", window: 2, strongThreshold: 0.7, neutralThreshold: 0.2,
  });
  assert.equal(result.observations.length, 0);
  assert.ok(result.qualityIssues.includes("insufficient_exactly_aligned_history"));
});

test("correlation regimes retain but disclose irregular exact-time intervals", () => {
  const times = [0, 60, 120, 300, 360];
  const result = computeCorrelationRegimes({
    primaryBars: times.map((time, index) => bar(time, 100 + index)),
    referenceBars: times.map((time, index) => bar(time, 100 - index)),
    timeframe: "1", window: 2, strongThreshold: 0.7, neutralThreshold: 0.2,
  });
  assert.equal(result.quality.irregularIntervals, 1);
  assert.ok(result.qualityIssues.includes("one_or_more_non_contiguous_bar_intervals"));
  assert.equal(result.observations.length, 3);
});
