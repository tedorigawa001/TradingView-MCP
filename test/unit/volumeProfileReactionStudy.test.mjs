import test from "node:test";
import assert from "node:assert/strict";
import {
  runVolumeProfilePocReversionStudy1h,
  runVolumeProfileReactionStudy,
  runVolumeProfileReactionStudy1h,
} from "../../build/volumeProfileReactionStudy.js";

const base = Date.parse("2026-01-01T00:00:00.000Z") / 1000;
const closes = [100, 111, 112, 109, 109, 89, 88, 91, 91, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 100,
  101, 102, 103, 104, 105, 106, 107, 108, 109, 100];
const bars = closes.map((close, index) => {
  const open = index === 0 ? close : closes[index - 1];
  let high = Math.max(open, close) + 0.5;
  let low = Math.min(open, close) - 0.5;
  if (index === 4) high = 111;
  if (index === 8) low = 89;
  return {
    time: base + index * 14_400,
    timeIso: new Date((base + index * 14_400) * 1000).toISOString(),
    open, high, low, close, volume: 1000,
  };
});

const values = [{
  id: "vp",
  name: "Bushido Volume Profile Context",
  plots: [],
  bars: bars.map((bar) => ({
    time: bar.time,
    timeIso: bar.timeIso,
    values: {
      "Prior POC": 100,
      "Prior VAH": 110,
      "Prior VAL": 90,
      "Profile Start": (base - 86_400) * 1000,
      "Profile End": base * 1000,
      "Trading Day": (base - 43_200) * 1000,
      "Profile Complete": 1,
      "Bars Included": 6,
    },
  })),
}];

test("volume-profile reaction study detects each frozen rejection and acceptance branch once", () => {
  const result = runVolumeProfileReactionStudy({
    bars,
    indicatorValues: values,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "240",
    folds: [],
    eventLimit: 20,
  });
  assert.equal(result.sample.events, 4);
  for (const branch of ["vah_rejection_short", "val_rejection_long", "vah_acceptance_long", "val_acceptance_short"]) {
    assert.equal(result.byBranch[branch].events, 1, branch);
  }
  assert.equal(new Set(result.events.map((event) => event.branch)).size, 4);
  assert.equal(result.inferenceContract.candidacy, "disabled_descriptive_only_pending_falsification");
  assert.ok(result.qualityIssues.includes("one_or_more_branches_below_minimum_event_count"));
});

test("volume-profile reaction study requires both the prior and rejection closes inside value area", () => {
  const crossed = structuredClone(bars);
  crossed[4] = { ...crossed[4], close: 89, low: 88.5 };
  const result = runVolumeProfileReactionStudy({
    bars: crossed,
    indicatorValues: values,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "240",
    folds: [],
    eventLimit: 20,
  });
  assert.equal(result.byBranch.vah_rejection_short.events, 0);
});

test("volume-profile acceptance must start from a close inside both value-area boundaries", () => {
  const approachedFromBelow = structuredClone(bars);
  approachedFromBelow[0] = { ...approachedFromBelow[0], open: 89, high: 89.5, low: 88.5, close: 89 };
  const result = runVolumeProfileReactionStudy({
    bars: approachedFromBelow,
    indicatorValues: values,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "240",
    folds: [],
    eventLimit: 20,
  });
  assert.equal(result.byBranch.vah_acceptance_long.events, 0);
});

test("volume-profile reaction study never uses a profile before its completion time", () => {
  const future = structuredClone(values);
  future[0].bars[0].values["Profile End"] = (base + 14_400) * 1000;
  assert.throws(() => runVolumeProfileReactionStudy({
    bars,
    indicatorValues: future,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "240",
    folds: [],
    eventLimit: 0,
  }), /before its profile ended/);
});

test("volume-profile reaction study validates canonical non-overlapping folds", () => {
  assert.throws(() => runVolumeProfileReactionStudy({
    bars,
    indicatorValues: values,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "240",
    folds: [
      { foldId: "a", from: "2026-01-01T00:00:00.000Z", to: "2026-01-03T00:00:00.000Z" },
      { foldId: "b", from: "2026-01-02T00:00:00.000Z", to: "2026-01-04T00:00:00.000Z" },
    ],
    eventLimit: 0,
  }), /folds must not overlap/);
});

test("volume-profile reaction study compares events with non-event bars in the same prior combined regime", () => {
  const warmup = Array.from({ length: 60 }, (_, index) => {
    const close = index % 2 === 0 ? 99.8 : 100.2;
    return {
      time: base - (60 - index) * 14_400,
      timeIso: new Date((base - (60 - index) * 14_400) * 1000).toISOString(),
      open: 100, high: 100.7, low: 99.3, close, volume: 1000,
    };
  });
  const allBars = [...warmup, ...bars];
  const allValues = [{
    ...values[0],
    bars: [
      ...warmup.map((bar) => ({
        time: bar.time,
        timeIso: bar.timeIso,
        values: { "Profile Complete": 0 },
      })),
      ...values[0].bars,
    ],
  }];
  const result = runVolumeProfileReactionStudy({
    bars: allBars,
    indicatorValues: allValues,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "240",
    folds: [],
    eventLimit: 0,
  });
  const repeated = runVolumeProfileReactionStudy({
    bars: allBars,
    indicatorValues: allValues,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "240",
    folds: [],
    eventLimit: 0,
  });
  assert.equal(result.sameRegimeBaseline.methodologyVersion,
    "volume_profile_same_regime_unconditional_baseline_v1");
  assert.equal(result.sameRegimeBaseline.contract.regimeKey, "directional_regime:volatility_regime");
  assert.equal(result.sameRegimeBaseline.contract.regimeAvailability,
    "latest_regime_bar_with_nominal_close_at_or_before_signal_bar_start");
  assert.equal(result.sameRegimeBaseline.contract.baselinePopulation,
    "closed_non_volume_profile_event_bars_with_the_same_prior_combined_regime");
  assert.equal(result.sameRegimeBaseline.contract.standardization,
    "baseline_regime_means_weighted_by_event_outcome_counts");
  assert.ok(result.sameRegimeBaseline.coverage.joinedEvents > 0);
  assert.equal(result.sameRegimeBaseline.coverage.baselineCandidateBars,
    allBars.length - result.sample.events);
  assert.deepEqual(repeated.sameRegimeBaseline, result.sameRegimeBaseline);
  assert.equal(result.inferenceContract.candidacy,
    "disabled_descriptive_only_pending_falsification");
});

test("volume-profile same-regime baseline fails closed without prior regime warmup", () => {
  const result = runVolumeProfileReactionStudy({
    bars,
    indicatorValues: values,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "240",
    folds: [],
    eventLimit: 0,
  });
  assert.equal(result.sameRegimeBaseline.status, "blocked");
  assert.equal(result.sameRegimeBaseline.coverage.joinedEvents, 0);
  assert.ok(result.sameRegimeBaseline.qualityIssues.includes("no_events_joined_to_prior_regimes"));
  assert.ok(result.sameRegimeBaseline.qualityIssues.includes("minimum_event_regime_join_coverage_not_met"));
});

test("volume-profile 1h variant has an independent methodology identity", () => {
  const hourlyBars = bars.map((bar, index) => ({
    ...bar,
    time: base + index * 3_600,
    timeIso: new Date((base + index * 3_600) * 1000).toISOString(),
  }));
  const hourlyValues = [{
    ...values[0],
    bars: values[0].bars.map((row, index) => ({
      ...row,
      time: hourlyBars[index].time,
      timeIso: hourlyBars[index].timeIso,
    })),
  }];
  const result = runVolumeProfileReactionStudy1h({
    bars: hourlyBars,
    indicatorValues: hourlyValues,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "60",
    folds: [],
    eventLimit: 0,
  });
  assert.equal(result.methodologyVersion, "chart_bar_volume_profile_reaction_event_study_1h_v1");
  assert.equal(result.sameRegimeBaseline.methodologyVersion,
    "volume_profile_same_regime_unconditional_baseline_1h_v1");
  assert.equal(result.inferenceContract.candidacy, "disabled_descriptive_only_pending_falsification");
  assert.throws(() => runVolumeProfileReactionStudy1h({
    bars,
    indicatorValues: values,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "240",
    folds: [],
    eventLimit: 0,
  }), /requires a 60-minute timeframe/);
});

test("POC-reversion study uses the first sufficiently displaced close per profile and direction", () => {
  const hourlyBars = bars.map((bar, index) => ({
    ...bar,
    time: base + index * 3_600,
    timeIso: new Date((base + index * 3_600) * 1000).toISOString(),
  }));
  const hourlyValues = [{
    ...values[0],
    bars: values[0].bars.map((row, index) => ({ ...row, time: hourlyBars[index].time, timeIso: hourlyBars[index].timeIso })),
  }];
  const result = runVolumeProfilePocReversionStudy1h({
    bars: hourlyBars,
    indicatorValues: hourlyValues,
    studyId: "vp",
    symbol: "CME_DL:6E1!",
    timeframe: "60",
    folds: [],
    eventLimit: 20,
  });
  assert.equal(result.methodologyVersion, "chart_bar_volume_profile_poc_reversion_event_study_1h_v1");
  assert.equal(result.byBranch.poc_reversion_from_above_short.events, 1);
  assert.equal(result.byBranch.poc_reversion_from_below_long.events, 1);
  assert.equal(result.events[0].branch, "poc_reversion_from_above_short");
  assert.equal(result.events[1].branch, "poc_reversion_from_below_long");
  assert.equal(result.byBranch.poc_reversion_from_below_long.pocTarget["4"].hits, 1);
  assert.equal(result.inferenceContract.candidacy, "disabled_descriptive_only_pending_falsification");
});

test("a rejection is not claimed across a profile switch, and the switch is counted", () => {
  // The bar that first carries a new profile is the case that used to slip through. Its previous
  // bar belongs to the old profile, so asking whether that bar closed inside the new value area
  // tests limits that did not exist when it closed. Here price sits inside the area throughout and
  // reaches an edge on exactly that bar - the shape that produced a rejection out of nothing.
  const switchIndex = 6;
  const switchBars = Array.from({ length: 12 }, (_, index) => ({
    time: base + index * 14_400,
    timeIso: new Date((base + index * 14_400) * 1000).toISOString(),
    open: 100,
    high: index === switchIndex ? 110 : 100.5,
    low: index === switchIndex ? 90 : 99.5,
    close: 100,
    volume: 1000,
  }));
  const firstProfileEnd = base * 1000;
  const secondProfileEnd = (base + switchIndex * 14_400) * 1000;
  const switchValues = [{
    id: "vp", name: "Bushido Volume Profile Context", plots: [],
    bars: switchBars.map((bar, index) => ({
      time: bar.time, timeIso: bar.timeIso,
      values: {
        "Prior POC": 100, "Prior VAH": 110, "Prior VAL": 90,
        "Profile Start": (index < switchIndex ? base - 86_400 : base) * 1000,
        "Profile End": index < switchIndex ? firstProfileEnd : secondProfileEnd,
        "Trading Day": (index < switchIndex ? base - 43_200 : base + 43_200) * 1000,
        "Profile Complete": 1, "Bars Included": 6,
      },
    })),
  }];
  const result = runVolumeProfileReactionStudy({
    bars: switchBars, indicatorValues: switchValues, studyId: "vp",
    symbol: "CME_DL:6E1!", timeframe: "240", folds: [], eventLimit: 20,
  });
  assert.equal(result.byBranch.vah_rejection_short.events, 0);
  assert.equal(result.byBranch.val_rejection_long.events, 0);
  assert.equal(result.sample.events, 0);
  // Not silently dropped: the reason is counted where a reader can see it. One switch raises the
  // count twice because the two-bar window the rejections need and the three-bar window the
  // acceptances need each span the change, on consecutive bars.
  assert.equal(result.quality.profileChangedInsideConfirmation, 2);
});
