import assert from "node:assert/strict";
import test from "node:test";
import { CARRY_CORE_PRIMARY_PAIRS, runCarryPanelPrimaryTest } from "../../build/carryPanelPrimaryTest.js";
import { getCarryCorePrimaryReadiness } from "../../build/carryPanelPrimaryReadiness.js";

const bars = (multiplier) => Array.from({ length: 120 }, (_, index) => ({
  timeIso: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
  close: 100 * Math.exp(multiplier * index),
}));

const record = (currency, observationDate, value, firstSeenAt, sequence) => ({
  schema_version: "1.0",
  sequence,
  series: "policy_rate",
  currency,
  source_symbol: `ECONOMICS:${currency === "EUR" ? "EU" : currency}INTR`,
  observation_date: observationDate,
  value,
  source_observed_at: `${observationDate}T00:00:00.000Z`,
  available_at: `${observationDate}T00:00:00.000Z`,
  available_at_basis: "next_utc_business_day_start",
  first_seen_at: firstSeenAt,
});

const pairs = [
  { pair_id: "EURUSD", base_currency: "EUR", quote_currency: "USD", bars: bars(0.001) },
  { pair_id: "AUDUSD", base_currency: "AUD", quote_currency: "USD", bars: bars(0.0012) },
];

test("carry primary test fits pair fixed effects and refits them in anchor-date blocks", () => {
  const result = runCarryPanelPrimaryTest({
    pairs,
    policyRateVersions: {
      EUR: [record("EUR", "2025-12-31", 1, "2025-12-31T00:00:00.000Z", 1), record("EUR", "2026-02-15", 2, "2026-02-15T00:00:00.000Z", 2)],
      AUD: [record("AUD", "2025-12-31", 2, "2025-12-31T00:00:00.000Z", 3), record("AUD", "2026-02-15", 3, "2026-02-15T00:00:00.000Z", 4)],
      USD: [record("USD", "2025-12-31", 0, "2025-12-31T00:00:00.000Z", 5)],
    },
    collectionHeartbeats: pairs[0].bars.map((bar) => ({ first_seen_at: bar.timeIso })),
    from: "2026-01-01",
    to: "2026-04-30",
    horizonBusinessDays: 5,
    minimumAnchorClusters: 6,
    blockLengthAnchors: 2,
    iterations: 100,
    seed: "carry-primary-test",
  });
  assert.equal(result.status, "complete");
  assert.equal(result.evidence_tier, "prospective_first_seen");
  assert.equal(result.contract.regime_condition, "none; the unconditional fixed-pair panel is the pre-registered baseline");
  // Thursdays from 2026-01-01, every five business days, the last ending by 2026-04-30.
  assert.equal(result.anchor_clusters, 17);
  assert.equal(result.observations, 34);
  assert.ok(Number.isFinite(result.model.beta));
  assert.equal(result.bootstrap.iterations, 100);
  assert.equal(result.bootstrap.block_length_anchors, 2);
});

test("carry primary test excludes anchors whose rates were first seen only later", () => {
  const result = runCarryPanelPrimaryTest({
    pairs,
    policyRateVersions: {
      EUR: [record("EUR", "2026-01-01", 2, "2026-04-15T00:00:00.000Z", 1)],
      AUD: [record("AUD", "2026-01-01", 3, "2026-04-15T00:00:00.000Z", 2)],
      USD: [record("USD", "2026-01-01", 1, "2026-04-15T00:00:00.000Z", 3)],
    },
    collectionHeartbeats: pairs[0].bars.map((bar) => ({ first_seen_at: bar.timeIso })),
    from: "2026-01-01",
    to: "2026-04-30",
    horizonBusinessDays: 5,
    minimumAnchorClusters: 6,
    blockLengthAnchors: 2,
    iterations: 100,
    seed: "carry-primary-no-leak",
  });
  assert.equal(result.status, "not_evaluable");
  assert.ok(result.anchors_excluded_for_unavailable_or_zero_policy_difference > 0);
  assert.equal(result.model, null);
});

test("carry primary test excludes an entire anchor cluster after the fixed heartbeat gap", () => {
  const result = runCarryPanelPrimaryTest({
    pairs,
    policyRateVersions: {
      EUR: [record("EUR", "2025-12-31", 2, "2025-12-31T00:00:00.000Z", 1)],
      AUD: [record("AUD", "2025-12-31", 3, "2025-12-31T00:00:00.000Z", 2)],
      USD: [record("USD", "2025-12-31", 1, "2025-12-31T00:00:00.000Z", 3)],
    },
    collectionHeartbeats: [{ first_seen_at: "2026-01-01T12:00:00.000Z" }],
    from: "2026-01-01",
    to: "2026-04-30",
    horizonBusinessDays: 5,
    minimumAnchorClusters: 6,
    blockLengthAnchors: 2,
    iterations: 100,
    seed: "carry-primary-heartbeat-gap",
  });
  assert.equal(result.anchor_clusters, 2);
  assert.equal(result.anchors_excluded_for_collection_gap, 15);
  assert.equal(result.status, "not_evaluable");
});

// BACKLOG 102-14: anchors sit on the fixed business-day grid, so a missing close never moves another anchor.
// Rates that change often enough for every bootstrap sample of a dozen anchors to vary within each pair.
const changing = (currency, values, first) => values.map(([date, value], index) => record(currency, date, value, `${date}T00:00:00.000Z`, first + index));
const baseInput = (pairList) => ({
  pairs: pairList,
  policyRateVersions: {
    EUR: changing("EUR", [["2025-12-31", 1], ["2026-01-20", 2], ["2026-02-15", 1.5], ["2026-03-10", 2.5], ["2026-04-05", 1]], 1),
    AUD: changing("AUD", [["2025-12-31", 2], ["2026-01-25", 3], ["2026-02-20", 2.5], ["2026-03-15", 3.5], ["2026-04-10", 2]], 6),
    USD: changing("USD", [["2025-12-31", 0]], 11),
  },
  collectionHeartbeats: pairs[0].bars.map((bar) => ({ first_seen_at: bar.timeIso })),
  from: "2026-01-01", to: "2026-04-30", horizonBusinessDays: 5, minimumAnchorClusters: 6, blockLengthAnchors: 2, iterations: 100, seed: "carry-primary-grid",
});
const without = (pair, dates) => ({ ...pair, bars: pair.bars.filter((bar) => !dates.includes(bar.timeIso.slice(0, 10))) });
const summary = (result) => [result.anchor_clusters, result.observations, result.anchors_excluded_for_missing_price, result.model?.beta];

test("a close missing off the grid moves no anchor, and one missing on it drops the two windows that use it", () => {
  const baseline = runCarryPanelPrimaryTest(baseInput(pairs));
  assert.deepEqual(summary(baseline).slice(0, 3), [17, 34, 0]);
  // A Tuesday is neither an anchor nor an endpoint: nothing changes but the count of common price dates.
  const offGrid = runCarryPanelPrimaryTest(baseInput([without(pairs[0], ["2026-02-10"]), pairs[1]]));
  assert.deepEqual(summary(offGrid), summary(baseline));
  assert.equal(offGrid.common_price_dates, baseline.common_price_dates - 1);
  // Thursday 2026-02-12 ends one window and starts the next; both are excluded, and every other anchor stays.
  const onGrid = runCarryPanelPrimaryTest(baseInput([pairs[0], without(pairs[1], ["2026-02-12"])]));
  assert.deepEqual(summary(onGrid).slice(0, 3), [15, 30, 2]);
  assert.equal(onGrid.candidate_anchor_clusters, 17);
});

test("a stretch of missing closes never stretches a window past its horizon", () => {
  // Prices grow with the calendar day, so every five-business-day window returns the same; a window stretched over the
  // missing February weeks would return more, and with the February rate change that would show as a slope.
  const gap = Array.from({ length: 26 }, (_, index) => new Date(Date.UTC(2026, 1, 2 + index)).toISOString().slice(0, 10));
  const result = runCarryPanelPrimaryTest(baseInput(pairs.map((pair) => without(pair, gap))));
  // Thursdays 2026-01-29 (its endpoint is missing) through 2026-02-26 are excluded; twelve anchors remain.
  assert.deepEqual(summary(result).slice(0, 3), [12, 24, 5]);
  assert.ok(Math.abs(result.model.beta) < 1e-9, `beta ${result.model.beta}`);
});

test("the anchor grid starts on a business day", () => {
  assert.throws(() => runCarryPanelPrimaryTest({ ...baseInput(pairs), from: "2026-01-03" }), /Monday-to-Friday business day/);
  assert.throws(() => runCarryPanelPrimaryTest({ ...baseInput(pairs), from: "2026-01-04" }), /Monday-to-Friday business day/);
});

test("a missing close is counted as such before a heartbeat gap, and a forming last bar is no close", () => {
  // Only the first two anchors have a recent heartbeat; the price missing on Thursday 2026-03-12 still counts as missing.
  const gapped = runCarryPanelPrimaryTest({ ...baseInput([pairs[0], without(pairs[1], ["2026-03-12"])]), collectionHeartbeats: [{ first_seen_at: "2026-01-01T12:00:00.000Z" }], minimumAnchorClusters: 60 });
  assert.deepEqual([gapped.anchor_clusters, gapped.anchors_excluded_for_missing_price, gapped.anchors_excluded_for_collection_gap], [2, 2, 13]);
  // On the run date the last bar is still forming, so the window ending there has no endpoint close yet.
  const forming = (pair) => ({ ...pair, bars: pair.bars.map((bar) => bar.timeIso.startsWith("2026-04-30") ? { ...bar, forming: true } : bar) });
  const today = runCarryPanelPrimaryTest(baseInput(pairs.map(forming)));
  assert.deepEqual([today.anchor_clusters, today.anchors_excluded_for_missing_price], [16, 1]);
});

test("under the frozen contract the anchors are the readiness tool's grid, complete on its estimated date", () => {
  // Weekday bars for the five core pairs, a policy-rate history that changes now and then (never leaving a pair at a
  // zero differential), and a heartbeat every weekday.
  const weekdays = [];
  for (let time = Date.UTC(2026, 6, 1); time <= Date.UTC(2031, 5, 30); time += 86_400_000) {
    const day = new Date(time).getUTCDay();
    if (day !== 0 && day !== 6) weekdays.push(new Date(time).toISOString());
  }
  let state = 12345;
  const noise = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 - 0.5; };
  const corePairs = CARRY_CORE_PRIMARY_PAIRS.map((pair) => {
    let close = 100;
    return { pair_id: pair.pair_id, base_currency: pair.base_currency, quote_currency: pair.quote_currency, bars: weekdays.map((timeIso) => ({ timeIso, close: (close *= Math.exp(noise() * 0.01)) })) };
  });
  const rates = { USD: [4, 4.5, 3.5, 4.25], EUR: [2, 2.5, 1.5, 3], AUD: [3, 2.5, 3.25, 2], JPY: [0.5, 0.25, 0.75, 0.1], CAD: [3.25, 2.75, 3.75, 3], CHF: [1, 1.5, 0.5, 1.25] };
  const changes = ["2026-07-30", "2027-09-15", "2028-11-15", "2030-01-15"];
  const policyRateVersions = Object.fromEntries(Object.entries(rates).map(([currency, values], currencyIndex) => [currency,
    values.map((value, index) => ({ ...record(currency, changes[index], value, `${changes[index]}T00:00:00.000Z`, currencyIndex * 10 + index + 1), first_seen_at: `${changes[index]}T00:00:00.000Z` }))]));
  const collectionHeartbeats = weekdays.filter((timeIso) => timeIso >= "2026-07-30").map((timeIso) => ({ first_seen_at: timeIso.replace("T00:00:00.000Z", "T01:45:00.000Z") }));
  const readiness = getCarryCorePrimaryReadiness({ asOf: "2031-06-30T12:00:00.000Z", policyRateVersions, collectionHeartbeats });
  assert.equal(readiness.first_eligible_anchor_date, "2026-08-25");
  const estimated = readiness.estimated_earliest_complete_window_date;
  const run = (to) => runCarryPanelPrimaryTest({ pairs: corePairs, policyRateVersions, collectionHeartbeats, from: "2026-07-28", to, iterations: 100, seed: "frozen-grid" });
  const dayBefore = new Date(Date.parse(`${estimated}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const before = run(dayBefore);
  assert.deepEqual([before.status, before.anchor_clusters, before.anchors_excluded_for_missing_price], ["not_evaluable", 59, 0]);
  const due = run(estimated);
  assert.deepEqual([due.status, due.anchor_clusters, due.anchors_excluded_for_collection_gap], ["complete", 60, 1]);
});
