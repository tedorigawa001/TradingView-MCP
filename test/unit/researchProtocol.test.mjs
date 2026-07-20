import assert from "node:assert/strict";
import test from "node:test";
import { auditPineSource } from "../../build/pineAudit.js";
import { validateResearchProtocol } from "../../build/researchProtocol.js";

const hash = (letter) => `sha256:${letter.repeat(64)}`;
const evaluatedAt = "2026-07-21T00:00:00.000Z";

function definition(overrides = {}) {
  return {
    pineId: "USER;aaaaaaaaaaaaaaaa",
    pineVersion: "3.0",
    pineKind: "strategy",
    candidateIds: [hash("a"), hash("b")],
    windows: [
      { windowId: "is", population: "in_sample", from: "2025-01-01T00:00:00.000Z", to: "2025-07-01T00:00:00.000Z" },
      { windowId: "oos", population: "out_of_sample", from: "2025-07-02T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
    ],
    minimumTrades: 30,
    observedTrades: 45,
    costs: { spreadPips: 1, slippagePipsPerSide: 0.2, commissionPerRoundTrip: 10 },
    closedBarsOnly: true,
    restartDiffChecked: true,
    definitionFrozenAt: "2025-01-01T00:00:00.000Z",
    definitionLastChangedAt: "2025-01-01T00:00:00.000Z",
    oosFirstViewedAt: null,
    ...overrides,
  };
}

test("research protocol is ready only when all adoption gates are explicit", () => {
  const first = validateResearchProtocol(definition(), auditPineSource("//@version=6\nstrategy('x')\nplot(close)"), evaluatedAt);
  const second = validateResearchProtocol(definition(), auditPineSource("//@version=6\nstrategy('x')\nplot(close)"), evaluatedAt);
  assert.equal(first.status, "ready");
  assert.equal(first.adoptionEligible, true);
  assert.deepEqual(first.issues, []);
  assert.equal(first.protocolId, second.protocolId);
});

test("research protocol blocks leakage, missing costs, and insufficient samples", () => {
  const result = validateResearchProtocol(definition({
    windows: [
      { windowId: "is", population: "in_sample", from: "2025-01-01T00:00:00.000Z", to: "2025-08-01T00:00:00.000Z" },
      { windowId: "oos", population: "out_of_sample", from: "2025-07-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" },
    ],
    observedTrades: 12,
    costs: { spreadPips: null, slippagePipsPerSide: 0.2, commissionPerRoundTrip: null },
    closedBarsOnly: false,
    definitionFrozenAt: "2025-07-10T00:00:00.000Z",
    definitionLastChangedAt: "2025-07-12T00:00:00.000Z",
    oosFirstViewedAt: "2025-07-11T00:00:00.000Z",
  }), auditPineSource("//@version=6\nstrategy('x', calc_on_every_tick=true)\nvarip float x = na"), evaluatedAt);
  const codes = new Set(result.issues.map((issue) => issue.code));
  assert.equal(result.status, "blocked");
  assert.equal(result.adoptionEligible, false);
  for (const code of ["forming_bars_included", "future_window", "is_oos_overlap",
    "minimum_trade_count_not_met", "cost_assumptions_incomplete", "definition_changed_after_freeze",
    "definition_changed_after_oos_access", "pine_varip", "pine_calc_on_every_tick"]) {
    assert.ok(codes.has(code), `missing ${code}`);
  }
});

test("research protocol warns for exploratory choices without inventing blockers", () => {
  const result = validateResearchProtocol(definition({
    candidateIds: [hash("a"), hash("b"), hash("c"), hash("d"), hash("e")],
    minimumTrades: 5,
    observedTrades: null,
    costs: { spreadPips: 0, slippagePipsPerSide: 0, commissionPerRoundTrip: 0 },
    restartDiffChecked: false,
  }), auditPineSource("//@version=6\nstrategy('x')\nx=request.security(syminfo.tickerid, 'D', close)"), evaluatedAt);
  assert.equal(result.status, "warning");
  assert.equal(result.counts.blocked, 0);
  assert.ok(result.issues.some((issue) => issue.code === "multiple_testing_pressure"));
  assert.ok(result.issues.some((issue) => issue.code === "zero_cost_assumption"));
  assert.ok(result.issues.some((issue) => issue.code === "restart_difference_not_checked"));
});
