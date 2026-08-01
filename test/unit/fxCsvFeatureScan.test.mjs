import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  FX_CSV_FEATURE_SCAN_CONTRACT,
  assertAdmissibleAggregate,
  parseFxCsvFeatureScanCliArguments,
  scanAggregatedBars,
} from "../../build/fxCsvFeatureScanCli.js";
import {
  FEATURE_OUTCOME_CALIBRATED_STUDY,
  FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS,
  assertCalibratedStudy,
  computeFeatureOutcomeRelationships,
} from "../../build/featureOutcomeRelationships.js";

const manifest = {
  schema_version: "1.0",
  series: "fx_csv_m1_aggregate",
  evidence_tier: "official_revised_history",
  symbol: "TESTFX",
  bucket_minutes: 60,
  start_from_broker_date: "2016.01.01",
  minimum_minute_coverage: 30,
  broker_clock_rule: "new_york_wall_time_plus_seven_hours",
  source_file: "TESTFX_M1.csv",
  source_bytes: 1,
  source_sha256: "sha256:aaaa",
  definition_hash: "sha256:cccc",
  aggregated_at: "2026-08-01T00:00:00.000Z",
  normalized_sha256: "sha256:bbbb",
  bar_count: 0,
  first_bar_at: null,
  last_bar_at: null,
  quality: {},
  quality_issues: ["one_or_more_source_rows_were_out_of_order"],
  limitations: [],
};

const syntheticBars = (count) => {
  const bars = [];
  let price = 1.1;
  let state = 7;
  for (let index = 0; index < count; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const step = ((state / 2147483648) - 0.5) * 0.002;
    const open = price;
    const close = open + step;
    bars.push({
      timeIso: new Date(Date.UTC(2024, 0, 1) + index * 3_600_000).toISOString(),
      open, high: Math.max(open, close) + 0.0005, low: Math.min(open, close) - 0.0005, close,
      tickVolume: 10 + (index % 7), minutesPresent: 60,
    });
    price = close;
  }
  return bars;
};

// A manifest that actually describes these bars. Anything the tests then change on either side has
// to be a change they meant, not a fixture that never agreed with itself in the first place.
const manifestFor = (bars, overrides = {}) => ({
  ...manifest,
  bar_count: bars.length,
  first_bar_at: bars[0]?.timeIso ?? null,
  last_bar_at: bars.at(-1)?.timeIso ?? null,
  normalized_sha256: `sha256:${createHash("sha256").update(JSON.stringify(bars), "utf8").digest("hex")}`,
  ...overrides,
});

test("the scan contract is the configuration the candidate rule was calibrated at", () => {
  // These thresholds are not defaults - they are the ones the false-positive rates and the power
  // curve across the floor were measured at. A change here silently invalidates both, so it has to
  // break this test rather than a run.
  assert.deepEqual(FX_CSV_FEATURE_SCAN_CONTRACT.features, [
    "atr_compression", "body_direction", "wick_imbalance", "directional_streak", "range_position", "gap_direction",
  ]);
  assert.equal(FX_CSV_FEATURE_SCAN_CONTRACT.wickImbalanceThreshold, 0.6);
  assert.equal(FX_CSV_FEATURE_SCAN_CONTRACT.atrCompressionLowRatio, 0.8);
  assert.equal(FX_CSV_FEATURE_SCAN_CONTRACT.atrCompressionHighRatio, 1.2);
  assert.equal(FX_CSV_FEATURE_SCAN_CONTRACT.gapAtrThreshold, 0.5);
  assert.equal(FX_CSV_FEATURE_SCAN_CONTRACT.minimumObservations, 30);
  assert.deepEqual(FX_CSV_FEATURE_SCAN_CONTRACT.horizons, [1, 5, 21]);
  assert.equal(FX_CSV_FEATURE_SCAN_CONTRACT.minimumEffectBps, FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS);
  assert.equal(FX_CSV_FEATURE_SCAN_CONTRACT.minimumEffectBps, 10);
});

test("a scan names the exact bytes it was computed from and reports every bucket it judged", () => {
  const bars = syntheticBars(700);
  const consistent = manifestFor(bars);
  const scan = scanAggregatedBars(consistent, bars);
  assert.equal(scan.symbol, "TESTFX");
  assert.equal(scan.bucket_minutes, 60);
  assert.equal(scan.source.source_sha256, "sha256:aaaa");
  assert.equal(scan.source.normalized_sha256, consistent.normalized_sha256);
  assert.equal(scan.source.aggregation_definition_hash, "sha256:cccc");
  // The aggregate's own reservations travel with the scan rather than being left behind in a file
  // nobody opens next to it.
  assert.deepEqual(scan.source.aggregation_quality_issues, ["one_or_more_source_rows_were_out_of_order"]);
  assert.ok(scan.bucket_count > 0);
  assert.equal(scan.buckets.length, scan.bucket_count);
  assert.equal(scan.contract_hash, scanAggregatedBars(consistent, bars).contract_hash);
});

test("a random walk produces no candidate, and every rejection names what it failed", () => {
  const bars = syntheticBars(700);
  const scan = scanAggregatedBars(manifestFor(bars), bars);
  assert.equal(scan.candidate_count, 0);
  for (const bucket of scan.buckets) {
    assert.equal(bucket.candidateEligible, false);
    assert.ok(bucket.candidateBlockers.length > 0, `${bucket.feature}/${bucket.bucket} refused without a reason`);
  }
});

test("an aggregate whose bars need not fill their interval cannot be scanned for candidates", () => {
  // Gold's maintenance break arrived as hourly bars made of a couple of stray prints, and the gap
  // between those and real trading read as a +38bps reversion that cleared every stage of the rule.
  const bars = syntheticBars(200);
  const ok = manifestFor(bars);
  assert.doesNotThrow(() => assertAdmissibleAggregate(ok, bars));
  assert.throws(
    () => assertAdmissibleAggregate({ ...ok, minimum_minute_coverage: 1 }, bars),
    /must cover at least 30 minutes/,
  );
  assert.throws(
    () => scanAggregatedBars({ ...ok, minimum_minute_coverage: 29 }, bars),
    /must cover at least 30 minutes/,
  );
  // The floor scales with the bar rather than being a fixed minute count.
  assert.throws(
    () => assertAdmissibleAggregate({ ...ok, bucket_minutes: 240, minimum_minute_coverage: 119 }, bars),
    /must cover at least 120 minutes/,
  );
});

test("the bars are checked against the manifest rather than the manifest being taken at its word", () => {
  // A manifest states what the aggregation was asked for. It is not evidence that the bars beside it
  // honour it, and both sit in one file that can be partly edited or swapped for another.
  const bars = syntheticBars(200);
  const ok = manifestFor(bars);

  // Each mutation gets a manifest that agrees with it, so what fires is the specific check rather
  // than the digest catching everything and telling us nothing about which rule the bars broke.
  const thin = bars.map((bar, index) => (index === 50 ? { ...bar, minutesPresent: 1 } : bar));
  assert.throws(() => assertAdmissibleAggregate(manifestFor(thin), thin), /reports 1 of 60 minutes/);
  const overfull = bars.map((bar, index) => (index === 7 ? { ...bar, minutesPresent: 61 } : bar));
  assert.throws(() => assertAdmissibleAggregate(manifestFor(overfull), overfull), /reports 61 of 60 minutes/);

  assert.throws(() => assertAdmissibleAggregate(ok, bars.slice(0, 199)), /but its manifest counts 200/);
  const shortened = bars.slice(0, 199);
  assert.throws(() => assertAdmissibleAggregate({ ...manifestFor(shortened), first_bar_at: "2001-01-01T00:00:00.000Z" },
    shortened), /but its manifest claims/);

  const reordered = [...bars]; [reordered[3], reordered[4]] = [reordered[4], reordered[3]];
  assert.throws(() => assertAdmissibleAggregate(manifestFor(reordered), reordered), /not strictly increasing/);
  const offGrid = bars.map((bar, index) => (index === 9
    ? { ...bar, timeIso: new Date(Date.parse(bar.timeIso) + 60_000).toISOString() } : bar));
  assert.throws(() => assertAdmissibleAggregate(manifestFor(offGrid), offGrid), /not aligned to a 60-minute bucket/);

  const notACandle = bars.map((bar, index) => (index === 11 ? { ...bar, high: bar.low - 1 } : bar));
  assert.throws(() => assertAdmissibleAggregate(manifestFor(notACandle), notACandle), /is not a candle/);
  // Infinity does not survive JSON, so it arrives as null and is refused just the same.
  const infinite = bars.map((bar, index) => (index === 12 ? { ...bar, high: Infinity } : bar));
  assert.throws(() => assertAdmissibleAggregate(manifestFor(infinite), infinite), /is not a candle/);

  assert.throws(() => assertAdmissibleAggregate(ok, []), /manifest counts 200/);
  assert.throws(() => assertAdmissibleAggregate({ ...ok, bar_count: 0 }, []), /holds no bars/);
});

test("bars swapped for a different well-formed series are caught by the manifest digest", () => {
  // Every structural check above passes on this substitution: the count, the grid, the coverage and
  // the candles are all correct. Only the digest knows these are not the bars that were aggregated.
  const bars = syntheticBars(200);
  const ok = manifestFor(bars);
  const substituted = bars.map((bar) => ({ ...bar, close: bar.close + 0.0001 }));
  assert.doesNotThrow(() => assertAdmissibleAggregate(manifestFor(substituted), substituted));
  assert.throws(() => assertAdmissibleAggregate(ok, substituted), /but its manifest records sha256:/);
  // A single bar edited in place, leaving everything else intact.
  const nudged = bars.map((bar, index) => (index === 77 ? { ...bar, tickVolume: bar.tickVolume + 1 } : bar));
  assert.throws(() => assertAdmissibleAggregate(ok, nudged), /the file was edited or its two halves come from different runs/);
});

test("a bucket length that does not tile a day is refused by the scan as well as the aggregation", () => {
  const bars = syntheticBars(50);
  for (const bucket of [7, 50, 1441, 0, 1.5]) {
    assert.throws(() => assertAdmissibleAggregate(manifestFor(bars, { bucket_minutes: bucket }), bars),
      /unusable bucket_minutes/, `bucket_minutes ${bucket} was accepted`);
  }
  for (const bucket of [15, 60, 120, 240]) {
    const aligned = bars.map((bar, index) => ({
      ...bar, timeIso: new Date(Date.UTC(2024, 0, 1) + index * bucket * 60_000).toISOString(),
      minutesPresent: bucket,
    }));
    assert.doesNotThrow(() => assertAdmissibleAggregate(
      manifestFor(aligned, { bucket_minutes: bucket, minimum_minute_coverage: Math.ceil(bucket / 2) }), aligned));
  }
});

test("empirical-null calibration is bound to the study it was calibrated at", () => {
  const base = {
    bars: syntheticBars(300).map((bar, index) => ({
      time: Math.floor(Date.parse(bar.timeIso) / 1000) + index * 0, timeIso: bar.timeIso,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.tickVolume,
    })),
    symbol: "TESTFX", timeframe: "60",
    features: [...FEATURE_OUTCOME_CALIBRATED_STUDY.features],
    selection: null, signalFrom: null, signalTo: null,
    atrLookback: 14, atrBaselineLookback: 50, rangeLookback: 20, streakMinimumBars: 3,
    bodyRatioThreshold: 0.5, wickImbalanceThreshold: 0.6,
    atrCompressionLowRatio: 0.8, atrCompressionHighRatio: 1.2,
    rangePositionLower: 0.33, rangePositionUpper: 0.67, gapAtrThreshold: 0.5,
    horizons: [1, 5, 21], minimumObservations: 30, folds: [], regime: null,
    observationLimit: 0, confidenceLevel: 0.95, configurationTrials: 1,
    minimumEffectBps: FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS,
  };
  // The thresholds decide what a bucket is, and the minimum observation count decides which buckets
  // enter the empirical-null family - raising it shrinks the family and loosens the test.
  for (const override of [
    { wickImbalanceThreshold: 0.2 },
    { atrCompressionLowRatio: 0.75 },
    { atrCompressionHighRatio: 1.5 },
    { gapAtrThreshold: 0.25 },
    { minimumObservations: 100 },
    { horizons: [1] },
    { features: ["body_direction"] },
  ]) {
    const key = Object.keys(override)[0];
    assert.throws(
      () => assertCalibratedStudy({ ...base, ...override }),
      /bound to the study those verdicts were calibrated at/,
      `${key} was accepted at a verdict-issuing boundary`,
    );
    // The computation itself reports rather than refuses, so an audit can still measure the error
    // rate of a new configuration - which is the only way one ever becomes calibrated.
    const result = computeFeatureOutcomeRelationships({ ...base, ...override, empiricalNullCalibration: true });
    assert.equal(result.inferenceContract.matchesCalibratedStudy, false, key);
    assert.ok(result.inferenceContract.calibratedStudyDepartures.some((item) => item.startsWith(key)),
      `${key} was not named among the departures`);
  }
  // Stating more configuration trials only shrinks the Bonferroni threshold, so it stays allowed.
  assert.doesNotThrow(() => assertCalibratedStudy({ ...base, configurationTrials: 40 }));
  const calibrated = computeFeatureOutcomeRelationships({ ...base, empiricalNullCalibration: true });
  assert.equal(calibrated.inferenceContract.matchesCalibratedStudy, true);
});

test("the scan refuses to run without the local-import acknowledgement or a source", () => {
  assert.throws(() => parseFxCsvFeatureScanCliArguments(["--aggregate", "a.json"]), /--confirm-local-import/);
  assert.throws(() => parseFxCsvFeatureScanCliArguments(["--confirm-local-import"]), /--aggregate/);
  assert.throws(() => parseFxCsvFeatureScanCliArguments(["--confirm-local-import", "--nope"]), /unknown argument/);
  const parsed = parseFxCsvFeatureScanCliArguments(["--confirm-local-import", "--aggregate", "/tmp/EURUSD_M60.json"]);
  assert.match(parsed.outputPath, /EURUSD_M60_scan\.json$/);
});
