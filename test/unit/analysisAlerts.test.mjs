import test from "node:test";
import assert from "node:assert/strict";
import {
  analysisAlertOwnershipName,
  buildAnalysisAlertPlans,
  matchExistingAnalysisAlerts,
} from "../../build/analysisAlerts.js";

const analysis = {
  analysisId: "USDJPY-20260720-01",
  analyzedAt: "2026-07-20T08:00:00.000Z",
  expiresAt: "2026-07-21T08:00:00.000Z",
  bias: "bullish",
  entryLow: 162.1,
  entryHigh: 162.2,
  confirmation: 162.3,
  invalidation: 161.9,
  stop: 161.8,
  targets: [162.6],
  confidence: 0.65,
  note: "",
  analysisSymbol: "OANDA:USDJPY",
  analysisTimeframe: "240",
  snapshotId: null,
  strategyVersion: null,
};

test("buildAnalysisAlertPlans derives bounded directional level alerts", () => {
  const plans = buildAnalysisAlertPlans(analysis, "OANDA:USDJPY", "4H", new Date("2026-07-20T09:00:00Z"));
  assert.deepEqual(plans.map(({ kind, operator, level }) => ({ kind, operator, level })), [
    { kind: "confirmation", operator: "cross_up", level: 162.3 },
    { kind: "invalidation", operator: "cross_down", level: 161.9 },
    { kind: "target_1", operator: "cross_up", level: 162.6 },
  ]);
  assert.equal(plans[0].resolution, "240");
  assert.match(plans[0].ownershipName, /^BUSHIDO-MCP:[0-9a-f]{16}:confirmation$/);
  assert.equal(plans[0].expiration, "2026-07-21T08:00:00.000Z");
  assert.ok(!plans[0].message.includes(analysis.analysisId));
});

test("alert ownership names are deterministic without exposing the analysis id", () => {
  const name = analysisAlertOwnershipName("sensitive-analysis-id", "target_1");
  assert.equal(name, analysisAlertOwnershipName("sensitive-analysis-id", "target_1"));
  assert.ok(!name.includes("sensitive-analysis-id"));
});

test("buildAnalysisAlertPlans rejects neutral, expired, and unbounded analyses", () => {
  assert.throws(() => buildAnalysisAlertPlans({ ...analysis, bias: "neutral" }, "OANDA:USDJPY", "240"), /neutral/);
  assert.throws(() => buildAnalysisAlertPlans({ ...analysis, expiresAt: null }, "OANDA:USDJPY", "240"), /expires_at is required/);
  assert.throws(() => buildAnalysisAlertPlans(analysis, "OANDA:USDJPY", "240", new Date("2026-07-22T00:00:00Z")), /must be in the future/);
});

test("matchExistingAnalysisAlerts distinguishes exact idempotence from ownership conflicts", () => {
  const [plan] = buildAnalysisAlertPlans(analysis, "OANDA:USDJPY", "240", new Date("2026-07-20T09:00:00Z"));
  const exactAlert = {
    id: 42,
    name: plan.ownershipName,
    symbol: plan.symbol,
    resolution: plan.resolution,
    condition: {
      type: plan.operator,
      series: [{ type: "barset" }, { type: "value", value: plan.level }],
    },
    message: plan.message,
    active: true,
    type: "price",
    createTime: null,
    lastFireTime: null,
    expiration: plan.expiration,
    lastError: null,
  };
  assert.equal(matchExistingAnalysisAlerts([plan], [exactAlert])[0].status, "exact");
  const conflict = matchExistingAnalysisAlerts([plan], [{ ...exactAlert, expiration: "2026-07-22T08:00:00Z" }])[0];
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(conflict.mismatches, ["expiration"]);
  assert.equal(matchExistingAnalysisAlerts([plan], [exactAlert, { ...exactAlert, id: 43 }])[0].status, "conflict");
});
