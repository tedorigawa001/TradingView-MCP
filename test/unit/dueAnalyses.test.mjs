import test from "node:test";
import assert from "node:assert/strict";
import { selectDueAnalyses } from "../../build/dueAnalyses.js";

const record = (id, expiresAt, latest = null, bias = "bullish") => ({
  definition: {
    schema_version: "1.0",
    event_id: `event-${id}`,
    sequence: 1,
    recorded_at: "2026-07-20T00:00:00.000Z",
    kind: "analysis_applied",
    analysis_id: id,
    definition_hash: `hash-${id}`,
    payload: {
      analysisId: id,
      analyzedAt: "2026-07-20T00:00:00.000Z",
      expiresAt,
      bias,
      entryLow: 1,
      entryHigh: 1.1,
      confirmation: 1.2,
      invalidation: 0.9,
      stop: 0.8,
      targets: [1.3],
      confidence: 0.5,
      note: "",
      symbol: "OANDA:EURUSD",
      timeframe: "60",
      chartIndex: 0,
      pineId: null,
      pineVersion: null,
      studyId: "study",
    },
  },
  latestOutcome: latest === null ? null : {
    schema_version: "1.0",
    event_id: `outcome-${id}`,
    sequence: 2,
    recorded_at: "2026-07-20T01:00:00.000Z",
    kind: "outcome_evaluated",
    analysis_id: id,
    definition_hash: `hash-${id}`,
    payload: latest,
  },
  outcomeCount: latest === null ? 0 : 1,
});

const outcome = (status, label) => ({
  status,
  outcome: label,
  evaluatedAt: "2026-07-20T01:00:00.000Z",
  evidenceTimeframe: "15",
  evidenceThrough: "2026-07-20T00:45:00.000Z",
  result: {},
});

test("selectDueAnalyses selects expired and non-terminal records but skips terminal and neutral", () => {
  const selected = selectDueAnalyses([
    record("expired", "2026-07-20T02:00:00.000Z"),
    record("ongoing", "2026-07-21T00:00:00.000Z", outcome("ongoing", "awaiting_terminal")),
    record("complete", "2026-07-20T02:00:00.000Z", outcome("complete", "target_before_stop")),
    record("neutral", "2026-07-20T02:00:00.000Z", null, "neutral"),
    record("active", "2026-07-21T00:00:00.000Z"),
  ], { now: new Date("2026-07-20T03:00:00.000Z") });
  assert.deepEqual(selected.candidates.map((candidate) => candidate.analysisId), ["expired", "ongoing"]);
  assert.deepEqual(selected.skipped.map((item) => item.reason), [
    "terminal_evaluation_exists",
    "neutral_analysis",
    "active_not_due",
  ]);
});

test("selectDueAnalyses can include active analyses and applies a deterministic limit", () => {
  const selected = selectDueAnalyses([
    record("later", "2026-07-22T00:00:00.000Z"),
    record("earlier", "2026-07-21T00:00:00.000Z"),
  ], { now: new Date("2026-07-20T03:00:00.000Z"), includeActive: true, limit: 1 });
  assert.equal(selected.candidates[0].analysisId, "earlier");
  assert.equal(selected.eligible, 2);
  assert.equal(selected.truncated, true);
});
