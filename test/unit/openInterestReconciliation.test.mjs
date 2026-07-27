import assert from "node:assert/strict";
import test from "node:test";
import { reconcileGoldOpenInterest } from "../../build/openInterestReconciliation.js";

test("gold OI reconciliation only joins an exact COT report date", () => {
  const result = reconcileGoldOpenInterest([
    { report_date: "2026-07-21T00:00:00.000Z", open_interest: 383368 },
    { report_date: "2026-07-14T00:00:00.000Z", open_interest: 383689 },
  ], [
    { observation_date: "2026-07-21", open_interest: 379963, first_seen_at: "2026-07-22T15:00:00.000Z" },
    { observation_date: "2026-07-15", open_interest: 380000, first_seen_at: "2026-07-16T15:00:00.000Z" },
  ]);

  assert.equal(result.status, "partial");
  assert.deepEqual(result.comparisons, [{
    observation_date: "2026-07-21",
    cot_open_interest: 383368,
    cme_open_interest: 379963,
    difference_contracts: -3405,
    cme_minus_cot_percent: (-3405 / 383368) * 100,
    cme_first_seen_at: "2026-07-22T15:00:00.000Z",
  }]);
  assert.deepEqual(result.unmatched_cot_dates, ["2026-07-14"]);
  assert.deepEqual(result.quality_issues, ["one_or_more_cot_report_dates_missing_same_day_cme_official_oi"]);
});

test("gold OI reconciliation never substitutes a missing COT OI", () => {
  const result = reconcileGoldOpenInterest([
    { report_date: "2026-07-21T00:00:00.000Z", open_interest: null },
  ], [
    { observation_date: "2026-07-21", open_interest: 376079, first_seen_at: "2026-07-25T15:00:00.000Z" },
  ]);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.comparisons, []);
  assert.deepEqual(result.excluded_cot_dates, ["2026-07-21"]);
  assert.deepEqual(result.quality_issues, [
    "no_same_day_cme_official_oi_collected",
    "one_or_more_cot_observations_missing_valid_open_interest",
  ]);
});
