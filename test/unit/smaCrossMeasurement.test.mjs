import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as measurement from "../../build/smaCrossMeasurement.js";

const definition = JSON.parse(await readFile(new URL("../fixtures/sma-cross-measurement-v2.json", import.meta.url), "utf8"));
const contract = () => ({ definition: structuredClone(definition), definitionHash: measurement.SMA_CROSS_V2_HASH, series: [] });

// Fictional continuous native calendar and prices: never fetched from TradingView or a journal.
function syntheticSeries(timeframe = "30", symbol = "OANDA:EURUSD", fullYear = false) {
  const duration = Number(timeframe) * 60000;
  const length = fullYear ? (measurement.SMA_PERIOD_END - measurement.SMA_PERIOD_START) / duration + 126 : 150;
  const bars = Array.from({ length }, (_, i) => {
    const endAt = measurement.SMA_PERIOD_START + (i - 125) * duration;
    return { openAt: endAt - duration, endAt, close: 100 + 5 * Math.sin(i * 2 * Math.PI / 17) + i * 0.005,
      confirmed: endAt < measurement.SMA_PERIOD_END, confirmationObservedAt: measurement.SMA_PERIOD_END + 1000,
      confirmationEvidence: "synthetic-confirmation", continuity: i ? "continuous" : "start", continuityEvidence: "synthetic-calendar" };
  });
  return { symbol, timeframe, timeBasis: "confirmed_bar_end_utc_ms", nativeEvidence: "synthetic-native-calendar",
    coverage: { from: bars[0].openAt, through: measurement.SMA_PERIOD_END,
      tail: fullYear ? "continuous" : "scheduled_closure", evidenceRef: "synthetic-coverage-only" }, bars };
}

test("v2 keeps the first origin across an equality touch and same-direction recross", () => {
  const start = Date.parse("2025-11-14T04:57:31Z");
  const points = [-1, 1, 0, 1, -1].map((difference, i) => ({
    at: start + i - 1, close: [100, 101, 102, 103, 99][i],
    fast: 100 + difference, slow: 100,
  }));
  const result = measurement.segmentSmaCrossV2(points);
  const complete = result.intervals.filter(x => !x.leftCensored && !x.rightCensored);
  assert.equal(complete.length, 1);
  assert.equal(complete[0].startAt, start);
  assert.equal(complete[0].endAt, start + 3);
  assert.equal(complete[0].startClose, 101);
  assert.equal(complete[0].direction, 1);
  assert.equal(result.intervals.at(-1).startAt, start + 3);
  assert.equal(result.intervals.at(-1).direction, -1);
  assert.equal(result.intervals.at(-1).rightCensored, true);
});

test("v2 rejects ambiguous bar order and invalid numeric input instead of repairing it", () => {
  const start = measurement.SMA_PERIOD_START;
  const point = { at: start - 1, close: 100, fast: 99, slow: 100 };
  assert.throws(() => measurement.segmentSmaCrossV2([point, { ...point }]), /bar_order/);
  assert.throws(() => measurement.segmentSmaCrossV2([{ ...point, at: start + 0.5 }]), /bar_time/);
  assert.throws(() => measurement.segmentSmaCrossV2([{ ...point, close: 0 }]), /invalid_price/);
  assert.throws(() => measurement.segmentSmaCrossV2([{ ...point, fast: NaN }]), /invalid_price/);
  assert.throws(() => measurement.segmentSmaCrossV2(new Array(2)), /sparse/);
  assert.throws(() => measurement.segmentSmaCrossV2([{ at: start - 1, close: 100, differenceSign: 2 }]), /invalid_sma_difference/);
  assert.throws(() => measurement.segmentSmaCrossV2([{ ...point, differenceSign: 1 }]), /invalid_sma_difference/);
});

test("approved stopping thresholds cannot be reached and a stopped budget cannot resume", () => {
  const limits = measurement.SMA_MEASUREMENT_LIMITS;
  assert.equal(limits.barsPerSeries, 65536);
  assert.equal(limits.barsTotal, 262144);
  assert.equal(limits.initialSearch, 8192);
  assert.equal(limits.intervalsPerGroup, 8192);
  assert.equal(limits.intervalsTotal, 65536);
  assert.equal(limits.workSteps, 4194304);
  assert.equal(limits.outputBytes, 8388608);
  const budget = new measurement.SmaMeasurementBudget();
  budget.step(limits.workSteps - 1);
  assert.throws(() => budget.step(), /work_step_limit/);
  assert.throws(() => budget.step(), /work_step_limit/);
  const intervals = new measurement.SmaMeasurementBudget();
  for (let i = 0; i < 8191; i++) intervals.addInterval("one", 1);
  assert.throws(() => intervals.addInterval("one", 1), /group_interval_limit/);
  assert.throws(() => intervals.addInterval("two", 1), /group_interval_limit/);
  const output = new measurement.SmaMeasurementBudget();
  assert.throws(() => output.checkOutputBytes(limits.outputBytes - 1024), /output_size_limit/);
});

test("Holm keeps all 16 slots, including unavailable groups, with independent golden values", () => {
  const input = measurement.SMA_MEASUREMENT_GROUPS.map((g, i) => ({
    groupId: g.id, pValue: [0.001, 0.004, 0.02][i] ?? null, eligible: i < 3,
  }));
  const result = measurement.holm16(input);
  assert.equal(result.length, 16);
  assert.deepEqual(result.slice(0, 3).map(x => x.adjustedP), [0.016, 0.06, 0.28]);
  assert.deepEqual(result.slice(0, 3).map(x => x.decision), ["rejected", "not_rejected", "not_rejected"]);
  assert.ok(result.slice(3).every(x => x.effectiveP === 1 && x.decision === "held"));
  const tied = measurement.holm16(input.map(x => ({ ...x, pValue: 0.001, eligible: true })));
  assert.ok(tied.every(x => x.adjustedP === 0.016 && x.decision === "rejected"));
  assert.throws(() => measurement.holm16(input.slice(1)), /family/);
  assert.throws(() => measurement.holm16(input.map((x, i) => i ? x : { ...x, pValue: NaN })), /p_value/);
});

test("Student t tails and descriptive statistics match independent analytic references", () => {
  const refs = [
    [1, 1, 0.5], [2, Math.sqrt(2 / 3), 0.5],
    // Independent finite cosine-power integral recurrence, not the incomplete-beta implementation.
    [29, 1, 0.32558198801619576], [29, 2, 0.054943637182969574],
    [30, 3, 0.005389964065657504], [100, 2, 0.04821217873113315],
  ];
  for (const [df, t, p] of refs) {
    assert.ok(Math.abs(measurement.studentTTwoSidedP(t, df) - p) < 1e-12);
    assert.ok(Math.abs(measurement.studentTTwoSidedP(-t, df) - p) < 1e-12);
  }
  assert.equal(measurement.studentTTwoSidedP(0, 29), 1);
  const values = Array.from({ length: 30 }, (_, i) => [-1, 0, 1][i % 3]);
  const verified = { independentObservations: true, evidenceRef: "synthetic-analytic-case" };
  const stat = measurement.calculateSmaStatistic(values, verified);
  assert.equal(stat.t, 0);
  assert.ok(Math.abs(stat.sd - Math.sqrt(20 / 29)) < 1e-14);
  assert.equal(stat.pValue, 1);
  assert.equal(measurement.calculateSmaStatistic(values, {}).eligible, false);
  assert.equal(measurement.calculateSmaStatistic(values.slice(1), verified).t, null);
  assert.equal(measurement.calculateSmaStatistic(new Array(30).fill(0), verified).t, null);
});

test("bound v2 calculation retains 16 held slots for absent series and rejects changed definitions", () => {
  assert.equal(measurement.SMA_PERIOD_START, Date.parse("2025-11-14T04:57:31Z"));
  assert.equal(measurement.SMA_PERIOD_END, Date.parse("2026-11-14T04:57:31Z"));
  assert.equal(measurement.SMA_CROSS_V2_HASH, "sha256:8dc5c2d46af53161f69fe8427403510b8bfb247e486fcccab152b27c6a5b3573");
  const input = contract();
  const report = measurement.measureSmaCrossV2(input);
  assert.equal(report.status, "complete");
  assert.equal(report.groups.length, 16);
  assert.ok(report.groups.every(g => g.statistics.n === 0 && !g.observationsKnown && g.holm.decision === "held"));
  assert.equal(report.executionAllowed, false);
  assert.equal(report.adoptionAllowed, false);
  const changed = contract(); changed.definition.thesis += "changed";
  const rejected = measurement.measureSmaCrossV2(changed);
  assert.equal(rejected.status, "aborted");
  assert.equal(rejected.stopReason, "definition_mismatch");
  assert.equal(rejected.progress.processedGroups, 0);
});

test("native end-time pipeline agrees with an independent nonzero-sign-run oracle and ignores future prices", () => {
  const series = syntheticSeries("30", "OANDA:EURUSD", true);
  const input = { ...contract(), series: [series] };
  const original = JSON.stringify(input);
  const report = measurement.measureSmaCrossV2(input);
  assert.equal(report.status, "complete");
  const group = report.groups[0];
  assert.equal(group.observationsKnown, true);
  const meanAt = (i, n) => series.bars.slice(i - n + 1, i + 1).reduce((s, b) => s + b.close, 0) / n;
  let direction = 0;
  const boundaries = [];
  for (let i = 39; i < series.bars.length; i++) {
    const bar = series.bars[i]; if (bar.endAt >= measurement.SMA_PERIOD_END) break;
    const sign = Math.sign(meanAt(i, 10) - meanAt(i, 40));
    if (!sign) continue;
    if (bar.endAt < measurement.SMA_PERIOD_START) { direction = sign; continue; }
    if (sign !== direction) { boundaries.push(bar.endAt); direction = sign; }
  }
  const expected = boundaries.slice(1).map((t, i) => [boundaries[i], t]);
  const complete = group.intervals.filter(x => !x.leftCensored && !x.rightCensored);
  assert.deepEqual(complete.map(x => [x.startAt, x.endAt]), expected);
  assert.ok(group.statistics.n >= 30);
  assert.equal(group.statistics.eligible, false); // No declaration of inferential prerequisites.
  assert.equal(group.holm.decision, "held");
  assert.equal(JSON.stringify(input), original);
  const future = { ...series, bars: [...series.bars] };
  future.bars[future.bars.length - 1] = { ...future.bars.at(-1), close: 1e100 };
  const again = measurement.measureSmaCrossV2({ ...contract(), series: [future] });
  assert.deepEqual(again.groups, report.groups);
});

test("half-open period, left-state equality and right censoring keep unique intervals", () => {
  const s = measurement.SMA_PERIOD_START, e = measurement.SMA_PERIOD_END;
  const point = (at, diff, close = 100) => ({ at, close, fast: 100 + diff, slow: 100 });
  const boundary = measurement.segmentSmaCrossV2([point(s - 1, -1), point(s, 1), point(e, -1, 200)]);
  assert.equal(boundary.intervals.length, 2);
  assert.equal(boundary.intervals[0].leftCensored, true);
  assert.equal(boundary.intervals[0].endAt, s);
  assert.equal(boundary.intervals[1].rightCensored, true);
  assert.equal(boundary.intervals[1].endAt, null);
  assert.equal(boundary.intervals[1].directionalLogChange, null);
  const held = measurement.segmentSmaCrossV2([point(s - 1, 0), point(s, 1)]);
  assert.equal(held.reason, "initial_direction_unknown");
  const left = measurement.segmentSmaCrossV2([point(s - 2, 1), point(s - 1, 0), point(s, 1), point(s + 1, 0)]);
  assert.equal(left.intervals.length, 1);
  assert.equal(left.intervals[0].leftCensored && left.intervals[0].rightCensored, true);
  assert.equal(left.intervals[0].startClose, null);
  const short = measurement.segmentSmaCrossV2([point(s - 1, 1), point(s, -1, 100), point(s + 1, 1, 90)]);
  const complete = short.intervals.find(x => !x.leftCensored && !x.rightCensored);
  assert.equal(complete.direction, -1);
  assert.ok(Math.abs(complete.directionalLogChange + Math.log(0.9)) < 1e-15);
});

test("lookback threshold aborts rather than guessing a boundary direction or continuing", () => {
  const s = measurement.SMA_PERIOD_START;
  const points = Array.from({ length: 8193 }, (_, i) => ({ at: s - 8192 + i, close: 100,
    fast: i === 0 ? 99 : i === 8192 ? 101 : 100, slow: 100 }));
  const budget = new measurement.SmaMeasurementBudget();
  assert.throws(() => measurement.segmentSmaCrossV2(points, budget), /initial_search_limit/);
  assert.throws(() => budget.step(), /initial_search_limit/);
});

test("global interval and input thresholds are exclusive, and output reserves its stop envelope", () => {
  const near = new measurement.SmaMeasurementBudget(); near.checkInputCounts([65535]);
  assert.throws(() => new measurement.SmaMeasurementBudget().checkInputCounts([65536]), /series_bar_limit/);
  assert.throws(() => new measurement.SmaMeasurementBudget().checkInputCounts([65536, 65536, 65536, 65536]), /total_bar_limit/);
  const global = new measurement.SmaMeasurementBudget();
  for (let g = 0; g < 8; g++) for (let i = 0; i < 8191; i++) global.addInterval(`g${g}`, 1);
  for (let i = 0; i < 7; i++) global.addInterval("last", 1);
  assert.equal(global.intervals, 65535);
  assert.throws(() => global.addInterval("last", 1), /total_interval_limit/);
  const bytes = new measurement.SmaMeasurementBudget();
  bytes.checkOutputBytes(8388608 - 1024 - 1);
  assert.throws(() => bytes.checkOutputBytes(8388608 - 1024), /output_size_limit/);
  const input = { ...contract(), series: [{ ...syntheticSeries(), bars: new Array(65536) }] };
  const report = measurement.measureSmaCrossV2(input);
  assert.equal(report.stopReason, "series_bar_limit");
  assert.equal(report.progress.validatedBars, 0);
});

test("data/evidence insufficiency holds affected groups without filling or interpreting it as zero", () => {
  for (const [mutate, reason] of [
    [s => { s.bars[130].close = null; }, "close_missing"],
    [s => { s.bars[130].confirmed = false; }, "confirmation_unverified"],
    [s => { s.bars[130].continuity = "unknown"; }, "continuity_unverified"],
    [s => { s.coverage.through = measurement.SMA_PERIOD_END - 1; }, "coverage_unverified"],
    [s => { s.timeBasis = "bar_open_seconds"; }, "time_contract_unverified"],
  ]) {
    const series = syntheticSeries(); mutate(series);
    const report = measurement.measureSmaCrossV2({ ...contract(), series: [series] });
    assert.equal(report.status, "complete");
    assert.ok(report.groups.slice(0, 4).every(g => g.reason === reason && !g.observationsKnown && g.holm.decision === "held"));
    assert.ok(report.groups.every(g => g.holm.effectiveP === 1));
  }
});

test("a later malformed series stops globally while earlier groups and remaining counts survive", () => {
  const good = syntheticSeries(), bad = syntheticSeries("60");
  bad.bars[130].openAt = bad.bars[129].openAt;
  bad.bars[130].endAt = bad.bars[129].endAt;
  const report = measurement.measureSmaCrossV2({ ...contract(), series: [good, bad] });
  assert.equal(report.status, "aborted");
  assert.equal(report.stopReason, "bar_order");
  assert.equal(report.progress.processedGroups, 4);
  assert.equal(report.progress.remainingGroups, 12);
  assert.equal(report.groups[0].observationsKnown, true);
  assert.ok(report.groups[0].intervals.length > 0);
  assert.ok(report.progress.remainingBars > 0);
  assert.ok(report.groups.every(g => g.holm === null));
});

test("all held tests, alpha boundary, and false prerequisite assertions do not shrink or expand the family", () => {
  const rows = measurement.SMA_MEASUREMENT_GROUPS.map(g => ({ groupId: g.id, eligible: false, pValue: null }));
  assert.ok(measurement.holm16(rows).every(x => x.decision === "held" && x.adjustedP === 1));
  rows[0] = { ...rows[0], eligible: true, pValue: 0.05 / 16 };
  assert.equal(measurement.holm16(rows)[0].decision, "rejected");
  rows[0] = { ...rows[0], eligible: false, pValue: 0 };
  assert.equal(measurement.holm16(rows)[0].effectiveP, 1);
  assert.throws(() => measurement.holm16([...rows, ...rows]), /family/);
  assert.throws(() => measurement.holm16(rows.map((x, i) => i === 1 ? rows[0] : x)), /family/);
});

test("quality reasons are counted separately while unknowable withheld intervals stay unknown", () => {
  const series = syntheticSeries();
  series.bars[130].close = null;
  series.bars[131].close = null;
  series.bars[132].continuity = "unknown";
  const report = measurement.measureSmaCrossV2({ ...contract(), series: [series] });
  assert.equal(report.status, "complete");
  for (const g of report.groups.slice(0, 4)) {
    assert.equal(g.qualityFlagCounts.close_missing, 2);
    assert.equal(g.qualityFlagCounts.continuity_unverified, 1);
    assert.equal(g.withheldIntervalCount, null);
    assert.equal(g.intervalCounts, null);
  }
});

test("four synthetic sources isolate all 16 group states and make inference explicitly conditional", () => {
  const series = [syntheticSeries(), syntheticSeries("60"), syntheticSeries("30", "OANDA:XAUUSD"), syntheticSeries("60", "OANDA:XAUUSD")];
  const report = measurement.measureSmaCrossV2({ ...contract(), series });
  assert.equal(report.status, "complete");
  assert.equal(report.familyEvaluated, true);
  assert.equal(new Set(report.groups.map(g => g.id)).size, 16);
  const expected = ["OANDA:EURUSD", "OANDA:XAUUSD"].flatMap(symbol => ["30", "60"].flatMap(timeframe =>
    [[10, 40], [40, 60], [60, 90], [90, 120]].map(([fast, slow]) => `${symbol}|${timeframe}|${fast}/${slow}`)));
  assert.deepEqual(report.groups.map(g => g.id), expected);
  assert.ok(report.groups.every(g => g.observationsKnown && g.holm.decision === "held"));
  assert.equal(report.progress.processedGroups, 16);
  assert.equal(report.progress.remainingBars, 0);
  assert.equal(report.groups[0].intervals[0].endAt - measurement.SMA_PERIOD_START,
    (report.groups[4].intervals[0].endAt - measurement.SMA_PERIOD_START) / 2);
  const changed = [...series];
  changed[2] = { ...changed[2], bars: changed[2].bars.map(b => ({ ...b, close: b.close * 3 })) };
  const again = measurement.measureSmaCrossV2({ ...contract(), series: changed });
  assert.deepEqual(again.groups.slice(0, 8), report.groups.slice(0, 8));
  assert.deepEqual(again.groups.slice(12), report.groups.slice(12));
  const full = syntheticSeries("30", "OANDA:EURUSD", true);
  const groupId = measurement.SMA_MEASUREMENT_GROUPS[0].id;
  const inferred = measurement.measureSmaCrossV2({ ...contract(), series: [full],
    inference: { [groupId]: { independentObservations: true, evidenceRef: "synthetic-mechanism-test-only" } } });
  assert.equal(inferred.groups[0].statistics.eligible, true);
  assert.equal(inferred.inferenceEvidenceIsCallerSupplied, true);
  assert.equal(inferred.adoptionAllowed, false);
  assert.ok(Buffer.byteLength(JSON.stringify(inferred)) < measurement.SMA_MEASUREMENT_LIMITS.outputBytes - 1024);
});

test("native closure evidence is required for gaps and confirmation receipt time is not event time", () => {
  const continuous = syntheticSeries(); continuous.bars.splice(130, 1);
  assert.equal(measurement.measureSmaCrossV2({ ...contract(), series: [continuous] }).groups[0].reason, "continuity_unverified");
  continuous.bars[130] = { ...continuous.bars[130], continuity: "scheduled_closure", continuityEvidence: "synthetic-declared-closure" };
  const accepted = measurement.measureSmaCrossV2({ ...contract(), series: [continuous] });
  assert.equal(accepted.groups[0].observationsKnown, true);
  assert.equal(accepted.progress.validatedBars, 149);
  const unconfirmed = syntheticSeries(); unconfirmed.bars[130].confirmationObservedAt = unconfirmed.bars[130].endAt - 1;
  assert.equal(measurement.measureSmaCrossV2({ ...contract(), series: [unconfirmed] }).groups[0].reason, "confirmation_unverified");
});

test("warmup insufficiency is group-specific and a flat history cannot invent an initial direction", () => {
  const short = syntheticSeries(); short.bars = short.bars.slice(10); short.bars[0] = { ...short.bars[0], continuity: "start" };
  const result = measurement.measureSmaCrossV2({ ...contract(), series: [short] });
  assert.equal(result.groups[0].observationsKnown, true);
  assert.equal(result.groups[3].observationsKnown, false);
  assert.equal(result.groups[3].reason, "initial_direction_unknown");
  const flat = syntheticSeries(); flat.bars = flat.bars.map(b => ({ ...b, close: 100 }));
  const held = measurement.measureSmaCrossV2({ ...contract(), series: [flat] });
  assert.ok(held.groups.slice(0, 4).every(g => !g.observationsKnown && g.reason === "initial_direction_unknown"));
});

test("malformed, sparse and duplicate inputs stop without sorting, filling, or widening the scope", () => {
  for (const [make, reason] of [
    [() => { const s = syntheticSeries(); s.bars[130].close = Infinity; return [s]; }, "invalid_price"],
    [() => { const s = syntheticSeries(); delete s.bars[130]; return [s]; }, "sparse_bars"],
    [() => [syntheticSeries(), syntheticSeries()], "duplicate_series"],
    [() => [syntheticSeries("30", "OTHER:EURUSD")], "invalid_series"],
  ]) {
    const report = measurement.measureSmaCrossV2({ ...contract(), series: make() });
    assert.equal(report.status, "aborted"); assert.equal(report.stopReason, reason);
    assert.equal(report.familyEvaluated, false);
    assert.ok(report.groups.every(g => g.holm === null));
  }
  const changed = contract(); changed.definition.hypothesisId = "sma-cross-adj-30m60m-1y-20261114-v1";
  assert.equal(measurement.measureSmaCrossV2(changed).stopReason, "definition_mismatch");
  const extra = contract(); extra.definition.unapproved = true;
  assert.equal(measurement.measureSmaCrossV2(extra).stopReason, "definition_mismatch");
  const sparse = contract(); sparse.series = new Array(1);
  assert.equal(measurement.measureSmaCrossV2(sparse).status, "aborted");
});

test("group interval stop retains earlier intervals and cannot resume with a different group", () => {
  const s = measurement.SMA_PERIOD_START;
  const points = Array.from({ length: 8200 }, (_, i) => ({ at: s + i - 1, close: 100 + (i % 2),
    fast: i % 2 ? 101 : 99, slow: 100 }));
  const budget = new measurement.SmaMeasurementBudget();
  assert.throws(() => measurement.segmentSmaCrossV2(points, budget), error => {
    assert.equal(error.reason, "group_interval_limit");
    assert.equal(error.partialIntervals.length, 8191);
    assert.equal(error.partialIntervals[0].leftCensored, true);
    return true;
  });
  assert.throws(() => measurement.segmentSmaCrossV2([], budget, "another"), /group_interval_limit/);
});

test("numeric tails are bounded and extreme positive prices do not overflow the log ratio", () => {
  assert.equal(measurement.studentTTwoSidedP(1e308, 29), 0);
  assert.throws(() => measurement.studentTTwoSidedP(Infinity, 29), /invalid_student/);
  assert.throws(() => measurement.studentTTwoSidedP(1, 0), /invalid_student/);
  assert.throws(() => measurement.studentTTwoSidedP(1, 8192), /invalid_student/);
  const s = measurement.SMA_PERIOD_START;
  const result = measurement.segmentSmaCrossV2([
    { at: s - 1, close: 1, fast: 99, slow: 100 },
    { at: s, close: Number.MIN_VALUE, fast: 101, slow: 100 },
    { at: s + 1, close: Number.MAX_VALUE, fast: 99, slow: 100 },
  ]);
  assert.equal(result.intervals[1].directionalLogChange, Math.log(Number.MAX_VALUE) - Math.log(Number.MIN_VALUE));
  assert.equal(measurement.calculateSmaStatistic(new Array(30).fill(1e308), {}).eligible, false);
});

// Independent oracle: direct integer window sums and cross multiplication, no rolling accumulator,
// floating mean, production sign decoder, or production segmentation routine.
function exactIntegerBoundaries(units, bars, fast, slow) {
  const sumAt = (i, n) => units.slice(i - n + 1, i + 1).reduce((sum, v) => sum + v, 0n);
  let direction = 0;
  const boundaries = [];
  for (let i = slow - 1; i < units.length; i++) {
    const at = bars[i].endAt;
    if (at >= measurement.SMA_PERIOD_END) break;
    const difference = sumAt(i, fast) * BigInt(slow) - sumAt(i, slow) * BigInt(fast);
    const sign = difference > 0n ? 1 : difference < 0n ? -1 : 0;
    if (!sign) continue;
    if (at < measurement.SMA_PERIOD_START) { direction = sign; continue; }
    if (sign !== direction) { boundaries.push({ at, direction: sign }); direction = sign; }
  }
  assert.notEqual(direction, 0);
  return boundaries.slice(1).map((b, i) => [boundaries[i].at, b.at, boundaries[i].direction]);
}

test("crosses match exact BigInt windows after a large value exits and near rounded-mean ties", () => {
  const largeExit = Array.from({ length: 600 }, (_, i) => BigInt(i === 0 ? 1e16 : i < 125 ? 1 : 1 + Math.floor((i - 125) / 7) % 3));
  const nearTie = Array.from({ length: 600 }, (_, i) => 2n ** 53n + BigInt(i === 120 || (i >= 125 && (i - 125) % 7 < 3) ? 2 : 0));
  const tiny = Array.from({ length: 600 }, (_, i) => BigInt(i === 120 ? 2 : i < 125 ? 1 : 1 + Math.floor((i - 125) / 7) % 3));
  const largestUnits = ((1n << 53n) - 1n) << 2045n;
  const mixed = [...tiny]; mixed[0] = largestUnits;
  const mixedPrices = tiny.map((value, i) => i === 0 ? Number.MAX_VALUE : Number(value) * Number.MIN_VALUE);
  const cases = [
    ["large value exits", largeExit, 1],
    ["rounded means tie", nearTie, 1],
    ["power-of-two scaling", nearTie, 2 ** -500],
    ["subnormal closes", tiny, Number.MIN_VALUE],
    ["near maximum normal exponent", nearTie, 2 ** 970],
    ["maximum finite exits into subnormals", mixed, null, mixedPrices],
  ];
  for (const [name, units, scale, prices] of cases) {
    const source = syntheticSeries();
    source.bars = units.map((value, i) => {
      const endAt = measurement.SMA_PERIOD_START + (i - 125) * 1800000;
      return { openAt: endAt - 1800000, endAt, close: prices ? prices[i] : Number(value) * scale,
        confirmed: true, confirmationObservedAt: measurement.SMA_PERIOD_END + 1,
        confirmationEvidence: "synthetic", continuity: i ? "continuous" : "start", continuityEvidence: "synthetic" };
    });
    source.coverage.from = source.bars[0].openAt;
    const original = JSON.stringify(source);
    const report = measurement.measureSmaCrossV2({ ...contract(), series: [source] });
    assert.equal(report.status, "complete", name);
    for (const group of report.groups.slice(0, 4)) {
      const expected = exactIntegerBoundaries(units, source.bars, group.fast, group.slow);
      const actual = group.intervals.filter(x => !x.leftCensored && !x.rightCensored)
        .map(x => [x.startAt, x.endAt, x.direction]);
      assert.equal(group.observationsKnown, true, `${name}: ${group.id}`);
      assert.deepEqual(actual, expected, `${name}: ${group.id}`);
      assert.equal(group.statistics.n, expected.length);
    }
    assert.equal(JSON.stringify(source), original);
  }
});
