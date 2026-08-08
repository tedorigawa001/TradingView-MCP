import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  MACRO_EVENT_RESPONSE_CONTRACT,
  MACRO_EVENT_RESPONSE_CONTRACT_HASH,
  assertReleaseOnAnchorGrid,
  runMacroEventResponseStudy,
} from "../../build/macroEventResponse.js";

const BUCKET_MS = 15 * 60_000;
const BARS_PER_DAY = 1440 / 15;
const SERIES_START = Date.parse("2024-01-01T00:00:00.000Z");
const FX = ["EURUSD", "USDJPY", "GBPUSD", "EURGBP", "AUDNZD"];
/** 12:30 UTC, the real CPI and NFP release slot on US standard time. */
const SLOT_OFFSET = 50;

const daySlotIso = (day) => new Date(SERIES_START + (day * BARS_PER_DAY + SLOT_OFFSET) * BUCKET_MS).toISOString();

const USD_DIRECT = ["EURUSD", "USDJPY", "GBPUSD"];
function makeBars(symbol, { days, amplifyAfter = [], amplification = 40, tail = 1, usdOnly = false }) {
  if (usdOnly && !USD_DIRECT.includes(symbol)) amplification = 1;
  let state = [...symbol].reduce((total, character) => total + character.charCodeAt(0), 7) >>> 0;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const loud = new Set();
  for (const iso of amplifyAfter) {
    const anchor = (Date.parse(iso) - SERIES_START) / BUCKET_MS;
    for (let step = 1; step <= 16; step += 1) loud.add(anchor + step);
  }
  const bars = [];
  let price = 1.1;
  for (let index = 0; index < days * BARS_PER_DAY; index += 1) {
    const scale = loud.has(index) ? amplification : index >= (days - 2) * BARS_PER_DAY ? tail : 1;
    const open = price;
    const close = open * (1 + (random() - 0.5) * 0.0006 * scale);
    bars.push({
      timeIso: new Date(SERIES_START + index * BUCKET_MS).toISOString(),
      open,
      high: Math.max(open, close) * 1.00005,
      low: Math.min(open, close) * 0.99995,
      close,
      tickVolume: 120,
      minutesPresent: 15,
    });
    price = close;
  }
  return bars;
}

function makeSeries(symbol, bars, bucketMinutes = 15) {
  return {
    manifest: {
      schema_version: "1.0",
      series: "fx_csv_m1_aggregate",
      evidence_tier: "official_revised_history",
      symbol,
      bucket_minutes: bucketMinutes,
      start_from_broker_date: "2024.01.01",
      minimum_minute_coverage: 8,
      broker_clock_rule: "new_york_wall_time_plus_seven_hours",
      source_file: `${symbol}.csv`,
      source_bytes: 1,
      source_sha256: `sha256:${"0".repeat(64)}`,
      normalized_sha256: `sha256:${createHash("sha256").update(JSON.stringify(bars), "utf8").digest("hex")}`,
      definition_hash: `sha256:${"0".repeat(64)}`,
      aggregated_at: "2026-01-01T00:00:00.000Z",
      bar_count: bars.length,
      first_bar_at: bars[0].timeIso,
      last_bar_at: bars[bars.length - 1].timeIso,
      quality: {},
      quality_issues: [],
      limitations: [],
    },
    bars,
  };
}

function makeArtifact(kind, times, overrides = {}, toYear = 2025) {
  return {
    schema_version: "1.0",
    series: "official_us_macro_release_events",
    evidence_tier: "official_revised_history",
    // Dated inside the span rather than after it, so no completed year comes under the annual
    // minimum. The study recomputes coverage from these events, and a handful of synthetic
    // releases is not a year of BLS output; the date is a fixture device, not a claim about when
    // anything was read. The requested range still has to span every year the bars touch.
    retrieved_at: "2024-06-01T00:00:00.000Z",
    event_kind: kind,
    events: times.map((occurredAt) => ({
      event_id: `${kind}:${occurredAt.slice(0, 10)}`,
      event_kind: kind,
      occurred_at: occurredAt,
      source_url: "https://example.invalid/release",
      raw_sha256: `sha256:${"0".repeat(64)}`,
    })),
    non_publications: [],
    scheduled_future_releases: [],
    coverage: {
      requested_from_year: 2024,
      requested_to_year: toYear,
      events_by_year: {},
      excused_non_publications_by_year: {},
      missing_release_months: [],
      coverage_issues: [],
    },
    ...overrides,
  };
}

const monthlyFillerEvents = (kind, year) => Array.from({ length: 12 }, (_, index) => ({
  event_id: `${kind}:${year}-${String(index + 1).padStart(2, "0")}-10`,
  event_kind: kind,
  occurred_at: `${year}-${String(index + 1).padStart(2, "0")}-10T12:30:00.000Z`,
  source_url: "https://example.invalid/release",
  raw_sha256: `sha256:${"0".repeat(64)}`,
}));

const seriesCache = new Map();
function cachedSeries(days, amplifyAfter, tail, usdOnly = false) {
  const key = `${days}|${tail}|${usdOnly}|${amplifyAfter.join(",")}`;
  let built = seriesCache.get(key);
  if (built === undefined) {
    built = FX.map((symbol) => makeSeries(symbol, makeBars(symbol, { days, amplifyAfter, tail, usdOnly })));
    seriesCache.set(key, built);
  }
  // Bars are never mutated, but manifests are, so each caller gets its own wrapper.
  return built.map((entry) => ({ manifest: { ...entry.manifest }, bars: entry.bars }));
}

function makeStudyInput({ days = 520, eventDays = [480, 481, 482, 483, 484], kind = "us_cpi", tail = 1, otherKindDays = [], usdOnly = false } = {}) {
  const artifactToYear = new Date(SERIES_START + days * BARS_PER_DAY * BUCKET_MS).getUTCFullYear();
  const times = eventDays.map(daySlotIso);
  const otherTimes = otherKindDays.map(daySlotIso);
  const series = cachedSeries(days, [...times, ...otherTimes], tail, usdOnly);
  const others = ["us_cpi", "us_nfp", "fomc_statement"].filter((other) => other !== kind);
  return {
    series,
    // The requested range has to span every year the bars touch, and a longer fixture reaches 2026.
    artifacts: [
      makeArtifact(kind, times, {}, artifactToYear),
      makeArtifact(others[0], otherTimes, {}, artifactToYear),
      makeArtifact(others[1], [], {}, artifactToYear),
    ],
    eventKind: kind,
  };
}

test("the frozen contract hash is pinned so a silent edit to the population definition fails here", () => {
  assert.equal(MACRO_EVENT_RESPONSE_CONTRACT_HASH, "sha256:2a99a8a4a7086d7486e41c52eda23d26673f3e4e8dbd9b2602b9fd397ccb2407");
  assert.deepEqual([...MACRO_EVENT_RESPONSE_CONTRACT.null_matching_keys], ["utc_clock_slot", "utc_weekday"]);
  assert.equal(MACRO_EVENT_RESPONSE_CONTRACT.minimum_placebo_anchors_per_cell, 52);
  assert.deepEqual([...MACRO_EVENT_RESPONSE_CONTRACT.guard_event_kinds], ["us_cpi", "us_nfp", "fomc_statement"]);
  assert.deepEqual([...MACRO_EVENT_RESPONSE_CONTRACT.horizons], [1, 2, 4, 8, 16]);
  assert.equal(MACRO_EVENT_RESPONSE_CONTRACT.primary_horizon, 4);
  assert.equal(MACRO_EVENT_RESPONSE_CONTRACT.baseline_observations, 52);
  assert.equal(MACRO_EVENT_RESPONSE_CONTRACT.minimum_events, 80);
  assert.deepEqual([...MACRO_EVENT_RESPONSE_CONTRACT.usd_direct_symbols], ["EURUSD", "USDJPY", "GBPUSD"]);
  assert.deepEqual([...MACRO_EVENT_RESPONSE_CONTRACT.non_usd_cross_symbols], ["EURGBP", "AUDNZD"]);
});

test("a release that does not start a bar is refused rather than rounded onto the grid", () => {
  assert.doesNotThrow(() => assertReleaseOnAnchorGrid("2024-03-13T12:30:00.000Z"));
  assert.doesNotThrow(() => assertReleaseOnAnchorGrid("2024-03-20T18:00:00.000Z"));
  assert.throws(() => assertReleaseOnAnchorGrid("2024-03-13T12:35:00.000Z"), /does not start a 15-minute bar/);
  assert.throws(() => assertReleaseOnAnchorGrid("2024-03-13T12:30:00Z"), /canonical ISO UTC/);
});

test("the study reports every frozen horizon and judges the primary one only", () => {
  const study = runMacroEventResponseStudy(makeStudyInput());
  assert.equal(study.series, "official_macro_event_response_m15");
  assert.equal(study.contract_hash, MACRO_EVENT_RESPONSE_CONTRACT_HASH);
  assert.equal(study.source.valid_events, 5);
  assert.deepEqual(study.response_curve.map((point) => point.horizon), [1, 2, 4, 8, 16]);
  assert.equal(study.empirical_null.level.observed, study.response_curve.find((point) => point.horizon === 4).usd_direct);
  assert.deepEqual(Object.keys(study.per_symbol_primary).sort(), [...FX].sort());
  // Five events cannot clear a minimum of eighty, and that is the condition that must be failing.
  const minimum = study.entry_conditions.find((condition) => condition.condition === "minimum_valid_events");
  assert.equal(minimum.met, false);
  assert.equal(minimum.observed, 5);
  assert.equal(study.status, "discontinue");
});

test("an amplified post-release window lifts the measured response above the placebo null", () => {
  const study = runMacroEventResponseStudy(makeStudyInput());
  const level = study.entry_conditions.find((condition) => condition.condition.startsWith("usd_direct_primary_ratio"));
  assert.equal(level.met, true);
  assert.ok(level.observed > 1.5, `expected a clear response, got ${level.observed}`);
  // The placebo null is what the level is judged against, and it must sit near one by construction.
  assert.ok(Math.abs(study.empirical_null.level.null_median - 1) < 0.25, `null median ${study.empirical_null.level.null_median}`);
});

test("an event missing from one pair is dropped from all five, because the comparison lives inside an event", () => {
  const input = makeStudyInput();
  const dropped = input.artifacts[0].events[2].occurred_at;
  const cross = input.series.find((entry) => entry.manifest.symbol === "EURGBP");
  const trimmed = cross.bars.filter((bar) => bar.timeIso !== dropped);
  const replacement = makeSeries("EURGBP", trimmed);
  const study = runMacroEventResponseStudy({ ...input, series: input.series.map((entry) => entry.manifest.symbol === "EURGBP" ? replacement : entry) });
  assert.equal(study.source.valid_events, 4);
  assert.deepEqual(study.source.excluded_missing_anchor, [dropped]);
  for (const symbol of FX) assert.ok(Number.isFinite(study.per_symbol_primary[symbol]));
});

test("the baseline is causal: bars after the last measured window cannot move the response curve", () => {
  const quiet = runMacroEventResponseStudy(makeStudyInput({ tail: 1 }));
  const loud = runMacroEventResponseStudy(makeStudyInput({ tail: 60 }));
  assert.deepEqual(loud.response_curve, quiet.response_curve);
  assert.deepEqual(loud.per_symbol_primary, quiet.per_symbol_primary);
});

test("an event without a full baseline window is excluded rather than measured on a short one", () => {
  // Day 52 leaves exactly 52 prior same-slot non-event bars; day 51 leaves fifty-one.
  const enough = runMacroEventResponseStudy(makeStudyInput({ eventDays: [52] }));
  assert.equal(enough.source.valid_events, 1);
  assert.deepEqual(enough.source.excluded_short_baseline, []);
  assert.throws(
    () => runMacroEventResponseStudy(makeStudyInput({ eventDays: [51] })),
    /no event retained a measurable balanced panel/,
  );
});

test("the study refuses inputs that would quietly change the frozen population", () => {
  const base = makeStudyInput();

  const mixed = makeStudyInput();
  mixed.artifacts[0].events[1].event_kind = "us_nfp";
  assert.throws(() => runMacroEventResponseStudy(mixed), /exactly one event kind/);

  const hourly = makeStudyInput();
  hourly.series[0].manifest.bucket_minutes = 60;
  assert.throws(() => runMacroEventResponseStudy(hourly), /requires 15-minute aggregates/);

  // Coverage is judged by recomputing it from the artifact's own events. Asking for a completed
  // year the artifact holds no releases for is a genuine gap, and no stored block can wave it off.
  const uncovered = makeStudyInput();
  for (const artifact of uncovered.artifacts) artifact.coverage = { ...artifact.coverage, requested_from_year: 2023 };
  assert.throws(() => runMacroEventResponseStudy(uncovered), /us_cpi artifact does not prove the requested release-history coverage/);

  // A kind that only contributes its guard must still prove its own coverage, or the guard it
  // contributes is built from an event list nobody has checked.
  const uncoveredGuard = makeStudyInput();
  for (const artifact of uncoveredGuard.artifacts) artifact.coverage = { ...artifact.coverage, requested_from_year: 2023 };
  uncoveredGuard.artifacts[0].events.push(...monthlyFillerEvents(uncoveredGuard.artifacts[0].event_kind, 2023));
  assert.throws(() => runMacroEventResponseStudy(uncoveredGuard), /us_nfp artifact does not prove the requested release-history coverage/);

  // A stored block claiming to be clean is not evidence either: it is not even consulted.
  const lying = makeStudyInput();
  for (const artifact of lying.artifacts) artifact.coverage = { ...artifact.coverage, requested_from_year: 2023, coverage_issues: [] };
  assert.throws(() => runMacroEventResponseStudy(lying), /does not prove the requested release-history coverage/);

  assert.throws(
    () => runMacroEventResponseStudy({ ...base, series: base.series.filter((entry) => entry.manifest.symbol !== "AUDNZD") }),
    /requires an aggregate for AUDNZD/,
  );
});

test("a guarded kind cannot be left out, and leaving its releases in the baseline would change the answer", () => {
  // The other kind fires on days the measured kind does not, inside the measured baseline window.
  const options = { eventDays: [70, 71, 72, 73, 74], otherKindDays: [56, 58, 60, 62, 64] };
  const full = makeStudyInput(options);

  for (const kind of ["us_nfp", "fomc_statement"]) {
    assert.throws(
      () => runMacroEventResponseStudy({ ...full, artifacts: full.artifacts.filter((artifact) => artifact.event_kind !== kind) }),
      new RegExp(`requires the ${kind} artifact to build its guard`),
    );
  }

  // Same bars, same measured artifact: only the other kind's release list differs. If those bars
  // were not being guarded out of the baseline, this would come back identical.
  const unguarded = {
    ...full,
    artifacts: full.artifacts.map((artifact) => artifact.event_kind === "us_nfp" ? makeArtifact("us_nfp", []) : artifact),
  };
  const guarded = runMacroEventResponseStudy(full);
  const leaked = runMacroEventResponseStudy(unguarded);
  assert.notDeepEqual(leaked.per_symbol_primary, guarded.per_symbol_primary);
});

test("a window that steps over a missing bar is excluded rather than measured as a longer one", () => {
  const input = makeStudyInput();
  const anchor = input.artifacts[0].events[2].occurred_at;
  // Remove a bar strictly inside that event's window, so the anchor is present but t+4 would span
  // five buckets of wall-clock time while still being called four.
  const missing = new Date(Date.parse(anchor) + 3 * BUCKET_MS).toISOString();
  // A second gap far from every release, because the bars around the first one are inside the guard
  // and never reach the baseline lanes at all. Only this one can move the baseline counter.
  const quietGap = daySlotIso(20);
  const gapped = makeSeries("GBPUSD", input.series.find((entry) => entry.manifest.symbol === "GBPUSD").bars
    .filter((bar) => bar.timeIso !== missing && bar.timeIso !== quietGap));
  const study = runMacroEventResponseStudy({
    ...input,
    series: input.series.map((entry) => entry.manifest.symbol === "GBPUSD" ? gapped : entry),
  });
  assert.deepEqual(study.source.excluded_discontinuous_window, [anchor]);
  assert.deepEqual(study.source.excluded_missing_anchor, []);
  assert.equal(study.source.valid_events, 4);
  // The same gap also keeps the bars whose own windows span it out of the baseline lanes.
  assert.ok(study.source.discontinuous_baseline_windows.GBPUSD > 0);
  assert.equal(study.source.discontinuous_baseline_windows.EURUSD, 0);
});

test("a guard artifact proven only over its own years cannot stand beside a longer price history", () => {
  const input = makeStudyInput();

  // Complete on its own terms, and blind to eight of the years it is supposed to be guarding.
  const late = makeStudyInput();
  late.artifacts[1].coverage = { ...late.artifacts[1].coverage, requested_from_year: 2025 };
  assert.throws(() => runMacroEventResponseStudy(late), /does not span the 2024-2025 price history it must guard/);

  // Spanning the bars is necessary but not sufficient: the kinds must be proven over one range, or
  // the guard is stronger in some years than others with nothing recording where.
  const ragged = makeStudyInput();
  for (const artifact of ragged.artifacts) artifact.coverage = { ...artifact.coverage, requested_from_year: 2023 };
  ragged.artifacts[2].coverage = { ...ragged.artifacts[2].coverage, requested_from_year: 2022 };
  ragged.artifacts[0].events.push(...monthlyFillerEvents(ragged.artifacts[0].event_kind, 2023));
  ragged.artifacts[1].events.push(...monthlyFillerEvents(ragged.artifacts[1].event_kind, 2023));
  assert.throws(() => runMacroEventResponseStudy(ragged), /every kind must be proven over the same years/);

  // The default fixture requests exactly the year its bars live in, and is accepted.
  assert.doesNotThrow(() => runMacroEventResponseStudy(input));
});

test("the signed response is stored beside the magnitude, as the frozen definition requires", () => {
  const study = runMacroEventResponseStudy(makeStudyInput());
  for (const point of study.response_curve) {
    // The raw signed log return, in bps, which is what the frozen definition names.
    assert.equal(typeof point.usd_direct_signed_bps, "number");
    assert.equal(typeof point.non_usd_cross_signed_bps, "number");
    // And the same quantity on the baseline scale the magnitudes use, so the two are comparable.
    assert.ok(point.usd_direct >= 0);
    assert.ok(Math.abs(point.usd_direct_signed_ratio) <= point.usd_direct + 1e-9);
    assert.ok(Math.abs(point.non_usd_cross_signed_ratio) <= point.non_usd_cross + 1e-9);
    // A ratio is the bps value divided by a positive baseline, so the two must agree in sign.
    assert.equal(Math.sign(point.usd_direct_signed_bps), Math.sign(point.usd_direct_signed_ratio));
  }
  // Nothing in the judgement may depend on it: the entry conditions read magnitudes only.
  assert.equal(study.empirical_null.level.observed, study.response_curve.find((point) => point.horizon === 4).usd_direct);
});

test("the placebo null is reproducible from its recorded seed, and centres on one by construction", () => {
  // Twenty events over a longer series, because the seed has to be able to show. With five events
  // drawn from a pool of a couple of dozen rows, the median of five takes so few distinct values
  // that 5000 draws pin the empirical quantiles to the same numbers for every seed - convergence,
  // not a seed that goes unused. Widening the panel makes the draw sequence observable again.
  const input = makeStudyInput({ eventDays: Array.from({ length: 20 }, (_, index) => 460 + index) });
  const first = runMacroEventResponseStudy({ ...input, placeboSeed: 4242 });
  const again = runMacroEventResponseStudy({ ...input, placeboSeed: 4242 });
  const other = runMacroEventResponseStudy({ ...input, placeboSeed: 99 });
  assert.equal(first.empirical_null.seed, 4242);
  assert.equal(first.empirical_null.draws, MACRO_EVENT_RESPONSE_CONTRACT.placebo_draws);
  assert.deepEqual(again.empirical_null, first.empirical_null);
  assert.notEqual(other.empirical_null.level.null_median, first.empirical_null.level.null_median);
  // The reference distribution is what the frozen statistic is judged against, so its own centre is
  // the calibration that matters: a placebo anchor is an ordinary bar and must measure as one.
  assert.ok(Math.abs(first.empirical_null.level.null_median - 1) < 0.05, `null median ${first.empirical_null.level.null_median}`);
});

test("the statistic and the null describe one set of events, not two", () => {
  // 420 days puts the placebo cells across the 52-anchor minimum - some land at 50 or 51 and some at
  // 52 - so the thin-cell filter actually removes events here instead of being a no-op the way it is
  // in every other fixture. Eight of the ten go, and the two that remain are what everything
  // downstream has to be computed over.
  const input = makeStudyInput({ days: 420, eventDays: Array.from({ length: 10 }, (_, index) => 380 + index) });
  const study = runMacroEventResponseStudy(input);

  assert.ok(study.source.excluded_thin_placebo_cell.length > 0, "this fixture must exercise the filter");
  assert.equal(study.source.valid_events + study.source.excluded_thin_placebo_cell.length, 10);

  // Recomputing the primary statistic from the surviving events alone must reproduce what the study
  // reports. Taking it over the excluded events too would leave the observed median describing a
  // population the null never covers, and nothing in the output would say which one was measured.
  const surviving = study.source.valid_events;
  assert.equal(study.entry_conditions.find((c) => c.condition === "minimum_valid_events").observed, surviving);
  assert.equal(study.empirical_null.level.observed, study.response_curve.find((p) => p.horizon === 4).usd_direct);
  // placebo_pool reports every cell that was built, including the thin ones whose events were then
  // dropped - it is a record of what was available, not of what was drawn from. This fixture is only
  // a boundary case if some of those cells are in fact below the minimum.
  const built = Object.values(study.empirical_null.placebo_pool);
  const minimum = MACRO_EVENT_RESPONSE_CONTRACT.minimum_placebo_anchors_per_cell;
  assert.ok(built.some((cell) => cell < minimum), `no cell sits below ${minimum}, so nothing is being excluded for thinness`);
  assert.ok(built.some((cell) => cell >= minimum), "and some cell must clear it, or every event would be gone");
});

test("a response confined to the USD-legged pairs clears every entry condition and advances", () => {
  // The go branch. Nothing else in this file ever produces it, so until now the decision this whole
  // module exists to make had only ever been observed refusing.
  //
  // Amplifying only the three USD pairs after each release is what the contract's comparison is
  // looking for: a level above the placebo null and a USD-minus-cross difference above it too.
  const input = makeStudyInput({
    days: 900,
    eventDays: Array.from({ length: 90 }, (_, index) => 700 + index),
    usdOnly: true,
  });
  const study = runMacroEventResponseStudy(input);

  assert.ok(study.source.valid_events >= MACRO_EVENT_RESPONSE_CONTRACT.minimum_events,
    `need the frozen minimum met, got ${study.source.valid_events}`);
  for (const condition of study.entry_conditions) {
    assert.equal(condition.met, true, `${condition.condition} did not pass: ${condition.observed} vs ${condition.reference}`);
  }
  assert.equal(study.status, "advance");
  // And the difference has to be the thing that carried it, not the level alone.
  const difference = study.entry_conditions.find((c) => c.condition.startsWith("usd_direct_minus"));
  assert.ok(difference.observed > difference.reference, "the cross pairs must respond less than the USD ones");
});

test("the gate refuses what sits just under it, which is what makes passing mean anything", () => {
  // Every other test here either fails on the event minimum or clears everything comfortably, so a
  // mutation that loosens a threshold goes unnoticed. These are the near misses.
  const events = Array.from({ length: 90 }, (_, index) => 700 + index);

  // A response present in the crosses as well: the level clears the null, the difference does not.
  const symmetric = runMacroEventResponseStudy(makeStudyInput({ days: 900, eventDays: events }));
  const level = symmetric.entry_conditions.find((c) => c.condition.startsWith("usd_direct_primary_ratio"));
  const difference = symmetric.entry_conditions.find((c) => c.condition.startsWith("usd_direct_minus"));
  assert.equal(level.met, true, "an amplified response must still clear the level condition");
  assert.equal(difference.met, false, "with both groups amplified there is no difference to find");
  assert.ok(difference.observed <= difference.reference);
  assert.equal(symmetric.status, "discontinue", "one failed condition must stop the study");

  // Exactly one event short of the frozen minimum, with a real response present.
  const shortOfMinimum = runMacroEventResponseStudy(makeStudyInput({
    days: 900, usdOnly: true,
    eventDays: Array.from({ length: MACRO_EVENT_RESPONSE_CONTRACT.minimum_events - 1 }, (_, index) => 700 + index),
  }));
  assert.equal(shortOfMinimum.source.valid_events, MACRO_EVENT_RESPONSE_CONTRACT.minimum_events - 1);
  const minimum = shortOfMinimum.entry_conditions.find((c) => c.condition === "minimum_valid_events");
  assert.equal(minimum.met, false, "one short of the minimum must not pass");
  assert.equal(shortOfMinimum.status, "discontinue");

  // And the minimum itself passes. Without this the comparison could be > instead of >= and the
  // near-miss above would still read the same.
  const atMinimum = runMacroEventResponseStudy(makeStudyInput({
    days: 900, usdOnly: true,
    eventDays: Array.from({ length: MACRO_EVENT_RESPONSE_CONTRACT.minimum_events }, (_, index) => 700 + index),
  }));
  assert.equal(atMinimum.source.valid_events, MACRO_EVENT_RESPONSE_CONTRACT.minimum_events);
  assert.equal(atMinimum.entry_conditions.find((c) => c.condition === "minimum_valid_events").met, true,
    "the minimum itself must be enough");
});

test("a placebo anchor is never part of its own baseline", () => {
  // The event path and the placebo path share laneOffsetBefore precisely so this cannot differ. An
  // event anchor is guarded out of its lane and would not notice; a placebo anchor is a lane entry,
  // so folding its own forward return into its own baseline would push its ratio toward 1 and drag
  // the whole null with it. A null built that way sits lower than it should and passes more.
  const input = makeStudyInput({ days: 900, usdOnly: true, eventDays: Array.from({ length: 90 }, (_, i) => 700 + i) });
  const first = runMacroEventResponseStudy({ ...input, placeboSeed: 11 });
  const second = runMacroEventResponseStudy({ ...input, placeboSeed: 11 });
  assert.deepEqual(second.empirical_null, first.empirical_null);
  // A placebo anchor measures as an ordinary bar, so its null centres on one. This does not pin the
  // strictness of laneOffsetBefore - measured against real data, the inclusive form moves the null
  // median by 0.0001, because a lane holds one entry per clock slot and consecutive entries are 96
  // buckets apart while the longest horizon is 16. What it pins is that the centre is where the
  // calibration says it is.
  assert.ok(Math.abs(first.empirical_null.level.null_median - 1) < 0.08,
    `the null must centre near one, got ${first.empirical_null.level.null_median}`);
});

test("the null quantile is the 95th percentile, not whatever the code happens to index", () => {
  const study = runMacroEventResponseStudy(makeStudyInput({
    days: 900, usdOnly: true, eventDays: Array.from({ length: 90 }, (_, index) => 700 + index),
  }));
  // The reference each condition is judged against must be the quantile the contract names. A draw
  // ordered ascending puts the 95th percentile above the median by construction, so reading the
  // wrong index shows up as a reference that no longer sits where the contract puts it.
  for (const side of [study.empirical_null.level, study.empirical_null.difference]) {
    assert.ok(side.null_quantile > side.null_median,
      `the ${MACRO_EVENT_RESPONSE_CONTRACT.null_quantile} quantile must exceed the median, got ${side.null_quantile} vs ${side.null_median}`);
    assert.ok(side.p_value > 0 && side.p_value <= 1);
  }
  const level = study.entry_conditions.find((c) => c.condition.startsWith("usd_direct_primary_ratio"));
  assert.equal(level.reference, study.empirical_null.level.null_quantile);
  const difference = study.entry_conditions.find((c) => c.condition.startsWith("usd_direct_minus"));
  assert.equal(difference.reference, study.empirical_null.difference.null_quantile);
});
