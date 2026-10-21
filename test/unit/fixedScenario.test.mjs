import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFixedScenario, fixedScenarioConditionsHash } from "../../build/fixedScenario.js";

const iso = (minutes) => new Date(Date.UTC(2026, 9, 21, 0, minutes)).toISOString();
const bar = (minutes, close, duration = 15) => ({ bar_open_at: iso(minutes), confirmed_at: iso(minutes + duration),
  open: close, high: close + 0.01, low: close - 0.01, close });
const rule = (direction = "below", any_of = [{ timeframe: "15", consecutive_closes: 2 }]) => ({
  band: { lower: 8.541, upper: 8.549 }, direction, any_of,
});
function input(closes = [8.540, 8.539]) {
  const definition = { id: "mxnjpy-test", version: "1", known_at: iso(-60), symbol: "PEPPERSTONE:MXNJPY",
    source: "tradingview_native_ohlcv", price_basis: "unknown", main_scenario: "Support break observation",
    opposing_scenario: null, activation: rule(), invalidation: null, valid_until: null };
  return { definition, expected_conditions_sha256: null,
    previous: { analysis_id: "previous-analysis", as_of: iso(0), conditions_sha256: null, activation_confirmed_at: null },
    evidence: { snapshot_id: "snapshot", as_of: iso(closes.length * 15), symbol: definition.symbol, source: definition.source,
      price_basis: "unknown", restoration_verified: true,
      series: [{ timeframe: "15", observed_at: iso(180), bars: closes.map((close, i) => bar(i * 15, close)) }] } };
}

test("fixed bands use strict boundaries and retain the complete frozen definition and evidence", () => {
  const x = input([8.540, 8.539]); const original = structuredClone(x);
  x.expected_conditions_sha256 = fixedScenarioConditionsHash(x.definition);
  const r = evaluateFixedScenario(x);
  assert.equal(r.classification, "triggered"); assert.equal(r.classification_ja, "条件発火");
  assert.equal(r.definition_pin_verified, true); assert.equal(r.conditions_sha256, x.expected_conditions_sha256);
  assert.deepEqual(r.definition, x.definition); assert.deepEqual(r.previous, x.previous);
  assert.deepEqual(r.activation.first_match.bars, x.evidence.series[0].bars);
  assert.equal(r.activation.first_match.confirmed_at, iso(30));
  assert.equal(r.activation.maintained_at_window_end, true);
  assert.deepEqual(x.definition, original.definition); assert.equal(r.candidateEligible, false);
});

test("inside, both boundaries, and isolated crossings never become two consecutive closes", () => {
  for (const closes of [[8.541, 8.539], [8.549, 8.539], [8.545, 8.539], [8.539, 8.545, 8.539]]) {
    const r = evaluateFixedScenario(input(closes));
    assert.equal(r.classification, "not_triggered"); assert.equal(r.activation.first_match, null);
    assert.equal(r.activation.branches[0].trailing_qualifying_closes, 1);
  }
  const r = evaluateFixedScenario(input([8.54, 8.541, 8.545, 8.549, 8.55]));
  assert.deepEqual(r.activation.branches[0].position_counts,
    { below: 1, lower_boundary: 1, inside: 1, upper_boundary: 1, above: 1 });
});

test("above direction compares strictly to the upper edge without epsilon or rounding", () => {
  const x = input([8.549, 8.55, 8.551]); x.definition.activation.direction = "above";
  const r = evaluateFixedScenario(x); assert.equal(r.classification, "triggered");
  assert.equal(r.activation.first_match.bars[0].bar_open_at, iso(15));
  assert.equal(r.activation.branches[0].position_counts.upper_boundary, 1);
});

test("timeframe OR matches the hourly branch independently and never pools 15m and 1h closes", () => {
  const x = input([8.54]);
  x.definition.activation.any_of.push({ timeframe: "60", consecutive_closes: 1 });
  x.evidence.as_of = iso(60);
  x.evidence.series.push({ timeframe: "60", observed_at: iso(180), bars: [bar(0, 8.54, 60)] });
  const r = evaluateFixedScenario(x);
  assert.equal(r.classification, "triggered"); assert.equal(r.activation.first_match.timeframe, "60");
  x.definition.activation.any_of[1].consecutive_closes = 2;
  assert.notEqual(evaluateFixedScenario(x).classification, "triggered");
});

test("missing an OR branch prevents a negative conclusion but not a proven match in another branch", () => {
  const x = input([8.545, 8.545]); x.definition.activation.any_of.push({ timeframe: "60", consecutive_closes: 1 });
  assert.equal(evaluateFixedScenario(x).classification, "not_evaluable");
  x.evidence.series[0].bars = [bar(0, 8.54), bar(15, 8.539)];
  assert.equal(evaluateFixedScenario(x).classification, "triggered");
});

test("already confirmed, forming and future confirmations are never counted or carried into a new streak", () => {
  const x = input([8.54, 8.539]); x.previous.as_of = iso(15);
  let r = evaluateFixedScenario(x);
  assert.equal(r.classification, "not_triggered"); assert.equal(r.activation.branches[0].excluded.already_confirmed, 1);
  x.previous.as_of = iso(0); x.evidence.series[0].bars[1].forming = true;
  r = evaluateFixedScenario(x); assert.equal(r.classification, "not_evaluable");
  assert.equal(r.activation.branches[0].excluded.forming, 1);
  delete x.evidence.series[0].bars[1].forming; x.evidence.as_of = iso(20);
  r = evaluateFixedScenario(x); assert.equal(r.classification, "not_triggered");
  assert.equal(r.activation.branches[0].excluded.after_cutoff, 1);
});

test("missing bars, session gaps and truncated comparison windows remain uncertain and break streaks", () => {
  for (const bars of [[bar(0, 8.54), bar(30, 8.539)], [bar(0, 8.54, 30), bar(30, 8.539)], [bar(15, 8.545)]]) {
    const x = input(); x.evidence.as_of = iso(45); x.evidence.series[0].bars = bars;
    const r = evaluateFixedScenario(x); assert.equal(r.classification, "not_evaluable");
    assert.equal(r.activation.first_match, null);
  }
  const x = input([8.545, 8.545]); x.evidence.as_of = iso(60);
  assert.equal(evaluateFixedScenario(x).classification, "not_evaluable");
});

test("a later observed run can match after a gap without claiming full coverage or current maintenance", () => {
  const x = input(); x.evidence.as_of = iso(60);
  x.evidence.series[0].bars = [bar(0, 8.54), bar(30, 8.54), bar(45, 8.539)];
  const r = evaluateFixedScenario(x);
  assert.equal(r.classification, "triggered"); assert.equal(r.activation.first_match.bars[0].bar_open_at, iso(30));
  assert.equal(r.activation.maintained_at_window_end, false);
  assert.ok(r.activation.branches[0].issues.includes("native_gap_or_unverified_session_interval"));
});

test("unspecified rules, baseline, known time and validity remain explicit rather than inferred", () => {
  for (const change of [x => x.definition.activation = null, x => x.previous = null, x => x.definition.known_at = null,
    x => x.definition.known_at = iso(1), x => x.previous.as_of = iso(30)]) {
    const x = input(); change(x); assert.equal(evaluateFixedScenario(x).classification, "not_evaluable");
  }
  const r = evaluateFixedScenario(input());
  assert.equal(r.definition.opposing_scenario, null); assert.equal(r.invalidation.status, "unspecified");
  assert.equal(r.comparison.valid_until, null);
  const x = input(); x.definition.valid_until = iso(15);
  assert.equal(evaluateFixedScenario(x).classification, "not_triggered");
  assert.equal(evaluateFixedScenario(x).comparison.through, iso(15));
});

test("definition hash is stable across key order and changes with bands, counts, text or version; pins fail closed", () => {
  const x = input(), h = fixedScenarioConditionsHash(x.definition);
  assert.equal(fixedScenarioConditionsHash(Object.fromEntries(Object.entries(x.definition).reverse())), h);
  for (const change of [d => d.activation.band.lower = 8.53, d => d.activation.any_of[0].consecutive_closes = 1,
    d => d.version = "2", d => d.main_scenario = "changed"]) {
    const y = structuredClone(x); y.expected_conditions_sha256 = h; change(y.definition);
    const r = evaluateFixedScenario(y); assert.equal(r.classification, "not_evaluable");
    assert.ok(r.issues.includes("conditions_hash_mismatch")); assert.equal(r.activation, null);
  }
  x.previous.conditions_sha256 = "sha256:" + "0".repeat(64);
  assert.ok(evaluateFixedScenario(x).issues.includes("previous_conditions_hash_mismatch"));
});

test("prior activation is hash-bound, never a new achievement, and does not invent an invalidation rule", () => {
  const x = input(); x.previous.conditions_sha256 = fixedScenarioConditionsHash(x.definition);
  x.previous.activation_confirmed_at = iso(-15);
  let r = evaluateFixedScenario(x); assert.equal(r.classification, "continuation_pending");
  x.evidence.series[0].bars = [bar(0, 8.545), bar(15, 8.545)];
  r = evaluateFixedScenario(x); assert.equal(r.classification, "continuation_pending");
  assert.equal(r.activation.maintained_at_window_end, false); assert.equal(r.invalidation.status, "unspecified");
  x.previous.conditions_sha256 = null;
  assert.equal(evaluateFixedScenario(x).classification, "not_evaluable");
});

test("explicit invalidation and conflicting conditions are separate, with no invented lifecycle order", () => {
  const x = input([8.55, 8.551]); x.definition.invalidation = rule("above");
  assert.equal(evaluateFixedScenario(x).classification, "invalidated");
  const y = input([8.54, 8.539, 8.55, 8.551]); y.definition.invalidation = rule("above");
  const r = evaluateFixedScenario(y); assert.equal(r.classification, "not_evaluable");
  assert.equal(r.activation.status, "matched"); assert.equal(r.invalidation.status, "matched");
  assert.ok(r.issues.includes("both_conditions_matched_no_lifecycle_precedence"));
});

test("source, exact symbol, OHLC basis and restoration mismatch refuse all evidence", () => {
  for (const change of [x => x.evidence.symbol = "OANDA:MXNJPY", x => x.evidence.source = "scanner",
    x => x.evidence.price_basis = "bid", x => x.evidence.restoration_verified = false]) {
    const x = input(); change(x); const r = evaluateFixedScenario(x);
    assert.equal(r.classification, "not_evaluable"); assert.equal(r.activation, null);
  }
});

test("reject malformed, unordered, overlapping, non-finite, unknown-key and unsupported-rule inputs", () => {
  for (const change of [x => x.evidence.series[0].bars.reverse(), x => x.evidence.series[0].bars[0].high = 1,
    x => x.evidence.series[0].bars[0].close = NaN, x => x.definition.activation.band.upper = 8,
    x => x.definition.activation.any_of[0].timeframe = "240", x => x.evidence.series.push(x.evidence.series[0]),
    x => x.definition.activation.any_of.push(x.definition.activation.any_of[0]), x => x.definition.notify = true,
    x => x.evidence.series[0].bars[0].confirmed_at = iso(20), x => x.evidence.series[0].observed_at = iso(1),
    x => x.definition.valid_until = iso(-90), x => delete x.definition.invalidation]) {
    const x = input(); change(x); assert.throws(() => evaluateFixedScenario(x));
  }
});

test("deterministic, stateless output neither changes input nor depends on wall-clock time", () => {
  const x = input(), before = structuredClone(x);
  assert.deepEqual(evaluateFixedScenario(x), evaluateFixedScenario(x)); assert.deepEqual(x, before);
});

test("off-grid intraday bars cannot use UTC-grid coverage or establish a supported confirmation", () => {
  const x = input(); x.previous.as_of = iso(7); x.evidence.as_of = iso(37);
  x.evidence.series[0].bars = [bar(7, 8.54), bar(22, 8.539)];
  const r = evaluateFixedScenario(x);
  assert.equal(r.classification, "not_evaluable");
  assert.equal(r.activation.first_match, null);
});

test("independent finite sequence oracle agrees across all five close positions, directions and run lengths", () => {
  const prices = [8.54, 8.541, 8.545, 8.549, 8.55];
  for (let code = 0; code < 625; code++) {
    let rest = code; const closes = Array.from({ length: 4 }, () => { const c = prices[rest % 5]; rest = Math.floor(rest / 5); return c; });
    for (const direction of ["above", "below"]) for (const count of [1, 2, 3]) {
      const x = input(closes); x.definition.activation.direction = direction;
      x.definition.activation.any_of[0].consecutive_closes = count;
      const qualifies = closes.map(c => direction === "above" ? c > 8.549 : c < 8.541);
      const first = qualifies.findIndex((_, i) => i + 1 >= count && qualifies.slice(i + 1 - count, i + 1).every(Boolean));
      const r = evaluateFixedScenario(x);
      assert.equal(r.classification, first < 0 ? "not_triggered" : "triggered");
      assert.equal(r.activation.first_match?.confirmed_at ?? null, first < 0 ? null : iso((first + 1) * 15));
      assert.equal(r.activation.maintained_at_window_end, qualifies.slice(-count).every(Boolean));
    }
  }
});

test("single-crossing progress and separate matching segments do not count overlap as new events", () => {
  const x = input([8.54, 8.539, 8.538, 8.545, 8.54]);
  let r = evaluateFixedScenario(x);
  assert.equal(r.activation.branches[0].matching_segments, 1);
  assert.equal(r.activation.branches[0].latest_run_state, "single_crossing");
  x.evidence.series[0].bars.push(bar(75, 8.539)); x.evidence.as_of = iso(90);
  r = evaluateFixedScenario(x); assert.equal(r.activation.branches[0].matching_segments, 2);
  assert.equal(r.activation.branches[0].latest_run_state, "confirmed_run");
});

test("gap counters do not invent excluded input rows, and negative comparisons retain the latest price evidence", () => {
  const x = input(); x.evidence.as_of = iso(45); x.evidence.series[0].bars = [bar(0, 8.545), bar(30, 8.549)];
  const branch = evaluateFixedScenario(x).activation.branches[0];
  assert.equal(branch.excluded.unverified_interval, 0);
  assert.equal(branch.coverage_discontinuities, 1);
  assert.deepEqual(branch.latest_observation, x.evidence.series[0].bars[1]);
});
