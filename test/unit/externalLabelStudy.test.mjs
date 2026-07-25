import assert from "node:assert/strict";
import test from "node:test";
import { runExternalLabelStudy } from "../../build/externalLabelStudy.js";

// Weekday-only daily bars, so consecutive bars are one day apart except across weekends. They sit
// at 22:00 UTC like a real COMEX daily bar, so a date-only label cannot match by exact timestamp.
function dailyBars(count, closes) {
  const bars = [];
  let day = Date.UTC(2026, 0, 5, 22); // a Monday
  for (let index = 0; index < count; index += 1) {
    const date = new Date(day);
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
    const close = closes?.[index] ?? 100 + index;
    bars.push({
      time: date.getTime() / 1000,
      timeIso: new Date(date.getTime()).toISOString(),
      open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1,
    });
    day = date.getTime() + 86_400_000;
  }
  return bars;
}

const BASE = {
  symbol: "COMEX_DL:GC1!",
  timeframe: "1D",
  horizons: [1, 5],
  targetReturnBps: 20,
  minimumEvents: 1,
  folds: [],
  eventLimit: 50,
  confidenceLevel: 0.95,
  configurationTrials: 1,
  regime: null,
  overlapPolicy: "exclude_later_event",
};

test("external label study refuses a zero observation lag", () => {
  const bars = dailyBars(40);
  assert.throws(() => runExternalLabelStudy({
    ...BASE, bars,
    observations: [{ time: bars[0].timeIso, label: "up" }],
    acceptedLabels: [{ label: "up", direction: "long" }],
    observationLagBars: 0,
  }), /observation_lag_bars must be an integer from 1 to 20/);
});

test("external label study places the signal that many bars after the observation bar", () => {
  const bars = dailyBars(40);
  const result = runExternalLabelStudy({
    ...BASE, bars,
    observations: [{ time: bars[10].timeIso, label: "up" }],
    acceptedLabels: [{ label: "up", direction: "long" }],
    observationLagBars: 2,
  });
  assert.equal(result.sample.events, 1);
  const [event] = result.events;
  assert.equal(event.observationTime, bars[10].timeIso);
  assert.equal(event.signalTime, bars[12].timeIso);
  // The whole point of the lag: the signal bar must start strictly after the observation bar.
  assert.ok(Date.parse(event.signalTime) > Date.parse(event.observationTime));
  assert.equal(result.conditionContract.observationLagBars, 2);
  assert.equal(result.conditionContract.zeroLagRejected, true);
});

test("external label horizons count observed bars, so a weekend does not void the window", () => {
  const bars = dailyBars(40);
  const result = runExternalLabelStudy({
    ...BASE, bars,
    observations: [{ time: bars[2].timeIso, label: "up" }],
    acceptedLabels: [{ label: "up", direction: "long" }],
    observationLagBars: 1,
  });
  // A five bar window over weekday bars always spans at least one weekend. Under a contiguous
  // nominal-bar clock every one of these outcomes would be null.
  assert.equal(result.outcomeContract.horizonClock, "observed_market_bars");
  assert.equal(result.outcomeContract.contiguousBarsRequired, false);
  assert.equal(result.byBranch.up.horizons["5"].availableEvents, 1);
  assert.equal(result.byBranch.up.horizons["5"].unavailableEvents, 0);
  assert.ok(result.byBranch.up.horizons["5"].directionalReturn.mean !== null);
});

test("external label study maps direction per label and reports both branches", () => {
  const bars = dailyBars(60);
  const result = runExternalLabelStudy({
    ...BASE, bars,
    observations: [
      { time: bars[0].timeIso, label: "build" },
      { time: bars[20].timeIso, label: "unwind" },
      { time: bars[40].timeIso, label: "build" },
    ],
    acceptedLabels: [
      { label: "build", direction: "long" },
      { label: "unwind", direction: "short" },
    ],
    observationLagBars: 1,
  });
  assert.equal(result.byBranch.build.direction, "long");
  assert.equal(result.byBranch.unwind.direction, "short");
  assert.equal(result.byBranch.build.events, 2);
  assert.equal(result.byBranch.unwind.events, 1);
  // Closes rise monotonically here, so a short label must show a negative directional return.
  assert.ok(result.byBranch.unwind.horizons["5"].directionalReturn.mean < 0);
  assert.ok(result.byBranch.build.horizons["5"].directionalReturn.mean > 0);
});

test("external label study excludes overlapping evaluation windows", () => {
  const bars = dailyBars(60);
  const result = runExternalLabelStudy({
    ...BASE, bars,
    // Three observations inside one five bar window; only the first can be kept.
    observations: [0, 1, 2, 30].map((i) => ({ time: bars[i].timeIso, label: "up" })),
    acceptedLabels: [{ label: "up", direction: "long" }],
    observationLagBars: 1,
  });
  assert.equal(result.sample.events, 2);
  assert.equal(result.quality.overlappingEventsExcluded, 2);
  assert.ok(result.qualityIssues.includes("overlapping_evaluation_windows_excluded"));
});

test("external label study can keep overlapping windows, and says the intervals are then narrower", () => {
  const bars = dailyBars(60);
  const observations = [0, 1, 2, 30].map((i) => ({ time: bars[i].timeIso, label: "up" }));
  const acceptedLabels = [{ label: "up", direction: "long" }];

  const excluded = runExternalLabelStudy({
    ...BASE, bars, observations, acceptedLabels, observationLagBars: 1,
    overlapPolicy: "exclude_later_event",
  });
  const kept = runExternalLabelStudy({
    ...BASE, bars, observations, acceptedLabels, observationLagBars: 1,
    overlapPolicy: "allow_overlapping_windows",
  });

  // A dense series loses most of its sample under exclusion, which is the reason the option exists.
  assert.equal(excluded.sample.events, 2);
  assert.equal(kept.sample.events, 4);
  assert.equal(kept.quality.overlappingEventsExcluded, 0);
  assert.ok(kept.inferenceWarnings.includes(
    "overlapping_evaluation_windows_kept_so_intervals_are_narrower_than_the_effective_sample"));
  assert.ok(kept.qualityIssues.includes("overlapping_evaluation_windows_kept"));
  assert.equal(excluded.inferenceWarnings.some((w) => /overlapping_evaluation_windows_kept/.test(w)), false);
});

test("external label study counts unmatched, unaccepted and duplicate observations", () => {
  const bars = dailyBars(40);
  const result = runExternalLabelStudy({
    ...BASE, bars,
    observations: [
      { time: bars[0].timeIso, label: "up" },
      { time: bars[0].timeIso, label: "up" },             // duplicate timestamp
      { time: bars[20].timeIso, label: "ignored" },        // label not accepted
      { time: "2001-01-02T00:00:00.000Z", label: "up" },   // no such bar
    ],
    acceptedLabels: [{ label: "up", direction: "long" }],
    observationLagBars: 1,
  });
  assert.equal(result.quality.observationsReceived, 4);
  assert.equal(result.quality.duplicateObservationTimes, 1);
  assert.equal(result.quality.unacceptedLabelObservations, 1);
  assert.equal(result.quality.unmatchedObservations, 1);
  assert.equal(result.sample.events, 1);
  assert.ok(result.qualityIssues.includes("one_or_more_observations_matched_no_loaded_bar"));
  assert.ok(result.qualityIssues.includes("duplicate_observation_timestamps_ignored"));
});

test("external label study joins a date-only observation only when one bar carries that date", () => {
  const daily = dailyBars(30);
  const dateOnly = daily[5].timeIso.slice(0, 10) + "T00:00:00.000Z";
  const matched = runExternalLabelStudy({
    ...BASE, bars: daily,
    observations: [{ time: dateOnly, label: "up" }],
    acceptedLabels: [{ label: "up", direction: "long" }],
    observationLagBars: 1,
  });
  assert.equal(matched.quality.matchedByUniqueDate, 1);
  assert.equal(matched.sample.events, 1);

  // Two intraday bars share a date, so the same coarse timestamp is ambiguous and is refused
  // rather than silently attached to one of them.
  const intraday = [0, 1, 2, 3].map((i) => ({
    time: Date.UTC(2026, 0, 5, i * 6) / 1000,
    timeIso: new Date(Date.UTC(2026, 0, 5, i * 6)).toISOString(),
    open: 100, high: 101, low: 99, close: 100 + i, volume: 1,
  }));
  const ambiguous = runExternalLabelStudy({
    ...BASE, bars: intraday, timeframe: "360",
    observations: [{ time: "2026-01-05T03:00:00.000Z", label: "up" }],
    acceptedLabels: [{ label: "up", direction: "long" }],
    observationLagBars: 1,
  });
  assert.equal(ambiguous.quality.ambiguousDateObservations, 1);
  assert.equal(ambiguous.sample.events, 0);
  assert.ok(ambiguous.qualityIssues.includes("one_or_more_observation_dates_matched_multiple_bars"));
});

test("external label study warns that branch means share the window drift", () => {
  const bars = dailyBars(60);
  const result = runExternalLabelStudy({
    ...BASE, bars,
    observations: [{ time: bars[0].timeIso, label: "a" }, { time: bars[30].timeIso, label: "b" }],
    acceptedLabels: [{ label: "a", direction: "long" }, { label: "b", direction: "long" }],
    observationLagBars: 1,
  });
  assert.ok(result.inferenceWarnings.includes(
    "comparing_branches_requires_the_caller_to_account_for_the_shared_unconditional_drift"));
  assert.equal(result.inferenceContract.ranking, false);
  assert.ok(result.limitations.some((item) => /unconditional drift/i.test(item)));
});

test("external label study rejects repeated accepted labels and bad folds", () => {
  const bars = dailyBars(40);
  const observations = [{ time: bars[0].timeIso, label: "up" }];
  assert.throws(() => runExternalLabelStudy({
    ...BASE, bars, observations, observationLagBars: 1,
    acceptedLabels: [{ label: "up", direction: "long" }, { label: "up", direction: "short" }],
  }), /must not repeat a label/);

  assert.throws(() => runExternalLabelStudy({
    ...BASE, bars, observations, observationLagBars: 1,
    acceptedLabels: [{ label: "up", direction: "long" }],
    folds: [
      { foldId: "a", from: "2026-01-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" },
      { foldId: "a", from: "2026-03-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" },
    ],
  }), /fold ids must be unique/);
});
