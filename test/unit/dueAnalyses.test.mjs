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

test("a terminal-less complete recorded without history through the expiry is rechecked after the due analyses (102-32)", () => {
  // The journal now lets a later evaluation replace such a record (it ranks below any other), so it is rechecked; it
  // goes with the evaluated open results, after the analyses that just became due, so it crowds none of them out.
  const withEvidence = (label, closedThrough, evidenceTimeframe = "15") =>
    ({ ...outcome("complete", label), evidenceTimeframe, result: { evidence: { closedThrough } } });
  const selected = selectDueAnalyses([
    record("short", "2026-07-20T02:00:00.000Z", withEvidence("no_terminal_event", "2026-07-20T01:00:00.000Z")),
    record("covered", "2026-07-20T02:00:00.000Z", withEvidence("no_terminal_event", "2026-07-20T01:45:00.000Z")),
    record("unknown", "2026-07-20T02:00:00.000Z", outcome("complete", "not_activated")),
    record("unconfirmed", "2026-07-20T02:00:00.000Z", withEvidence("expired_without_confirmation", "2026-07-20T01:30:00.000Z")),
    record("garbled", "2026-07-20T02:00:00.000Z", withEvidence("no_terminal_event", "2026-07-20T01:45:00.000Z", "fortnight")),
    record("stopped", "2026-07-20T02:00:00.000Z", outcome("complete", "stop_before_target")),
    record("due", "2026-07-20T02:30:00.000Z"),
  ], { now: new Date("2026-07-20T03:00:00.000Z"), limit: 1 });
  assert.deepEqual(selected.candidates.map((candidate) => candidate.analysisId), ["due"], "the due analysis is not crowded out");
  assert.deepEqual([selected.eligible, selected.truncated, selected.legacyCompleteWithoutCoverage], [5, true, 4]);
  assert.deepEqual(selected.skipped.map((item) => [item.analysisId, item.reason]), [
    ["covered", "terminal_evaluation_exists"], ["stopped", "terminal_evaluation_exists"]]);
  const all = selectDueAnalyses([
    record("short", "2026-07-20T02:00:00.000Z", withEvidence("no_terminal_event", "2026-07-20T01:00:00.000Z")),
    record("unknown", "2026-07-20T02:00:00.000Z", outcome("complete", "not_activated")),
    record("due", "2026-07-20T02:30:00.000Z"),
  ], { now: new Date("2026-07-20T03:00:00.000Z") });
  assert.deepEqual(all.candidates.map((candidate) => [candidate.analysisId, candidate.reason]), [
    ["due", "expired_without_terminal"], ["short", "legacy_complete_recheck"], ["unknown", "legacy_complete_recheck"]]);
});

test("a complete that names its proof of reaching the expiry is final, a forming bar included (102-04 follow-up)", () => {
  // The last closed 15-minute bar ends at 02:00, before the 02:07 expiry: only the recorded proof can show coverage.
  const proven = (id, coveredBy) => record(id, "2026-07-20T02:07:00.000Z", { ...outcome("complete", "no_terminal_event"),
    result: { evidence: { closedThrough: "2026-07-20T01:45:00.000Z", expiryCoveredBy: coveredBy } } });
  const selected = selectDueAnalyses([proven("forming", "forming_bar"), proven("closed", "closed_bar"), proven("none", null),
    proven("garbled", "yes")], { now: new Date("2026-07-20T03:00:00.000Z") });
  assert.deepEqual(selected.skipped.map((item) => [item.analysisId, item.reason]), [
    ["forming", "terminal_evaluation_exists"], ["closed", "terminal_evaluation_exists"]]);
  assert.deepEqual(selected.candidates.map((candidate) => [candidate.analysisId, candidate.reason]), [
    ["garbled", "legacy_complete_recheck"], ["none", "legacy_complete_recheck"]]);
});

test("evaluated results that stayed open go last in the order they were recorded, so due analyses are not starved", () => {
  const evaluated = (status, label, evaluatedAt) => ({ ...outcome(status, label), evaluatedAt });
  const records = [
    record("gapStale", "2026-07-20T00:15:00.000Z", evaluated("incomplete", "gap_in_evaluation_window", "2026-07-20T02:50:00.000Z")),
    record("shortOld", "2026-07-20T00:30:00.000Z", evaluated("incomplete", "history_ends_before_expiry", "2026-07-20T02:10:00.000Z")),
    record("fresh", "2026-07-20T02:30:00.000Z"),
    record("checkedBefore", "2026-07-20T02:00:00.000Z", evaluated("ongoing", "awaiting_terminal", "2026-07-20T01:00:00.000Z")),
    record("active", "2026-07-21T00:00:00.000Z", evaluated("ongoing", "awaiting_terminal", "2026-07-20T01:00:00.000Z")),
    // Decided before its expiry: a recheck with the same result records nothing, so its time never moves on.
    record("ambiguousEarly", "2026-07-20T02:45:00.000Z", evaluated("ambiguous", "terminal_order_unknown", "2026-07-20T01:30:00.000Z")),
    // Still in progress when recorded at the expiry: it needs its final evaluation.
    record("ongoingAtExpiry", "2026-07-20T01:00:00.000Z", evaluated("ongoing", "awaiting_terminal", "2026-07-20T01:00:00.000Z")),
  ];
  const now = new Date("2026-07-20T03:00:00.000Z");
  assert.deepEqual(selectDueAnalyses(records, { now }).candidates.map((candidate) => candidate.analysisId),
    ["ongoingAtExpiry", "checkedBefore", "fresh", "active", "ambiguousEarly", "shortOld", "gapStale"]);
  assert.deepEqual(selectDueAnalyses(records, { now, limit: 3 }).candidates.map((candidate) => candidate.analysisId),
    ["ongoingAtExpiry", "checkedBefore", "fresh"], "the oldest expiries no longer take every slot");
});

test("an ambiguous or gapped result with history through the expiry is named unless rechecked on another timeframe", () => {
  // The analysis timeframe is 60, so a run without evaluation_timeframe evaluates on 60.
  const settled = (id, status, label, coveredBy, evidenceTimeframe = "60") => record(id, "2026-07-20T02:00:00.000Z",
    { ...outcome(status, label), evidenceTimeframe, result: { evidence: { expiryCoveredBy: coveredBy } } });
  const records = [
    settled("gap", "incomplete", "gap_in_evaluation_window", "closed_bar"),
    settled("ambiguous", "ambiguous", "terminal_order_unknown", "forming_bar"),
    settled("fiveMinute", "incomplete", "gap_in_evaluation_window", "closed_bar", "5"),
    settled("gapEarly", "incomplete", "gap_in_evaluation_window", null),
    settled("short", "incomplete", "history_ends_before_expiry", null),
    // An earlier version's ambiguous record names no proof, so it stays a recheck (in the open group).
    record("legacy", "2026-07-20T02:00:00.000Z", outcome("ambiguous", "terminal_order_unknown")),
  ];
  const now = new Date("2026-07-20T03:00:00.000Z");
  const ids = (selection) => selection.candidates.map((candidate) => candidate.analysisId);
  const plain = selectDueAnalyses(records, { now });
  // Equal expiries and evaluation times: by id. The 5-minute record may come out otherwise on 60.
  assert.deepEqual(ids(plain), ["fiveMinute", "gapEarly", "legacy", "short"]);
  assert.deepEqual(plain.skipped.map((item) => [item.analysisId, item.reason]),
    [["gap", "open_result_fixed_for_timeframe"], ["ambiguous", "open_result_fixed_for_timeframe"]]);
  assert.deepEqual(ids(selectDueAnalyses(records, { now, evaluationTimeframe: "1h" })), ids(plain), "1h is 60, the same run");
  assert.deepEqual(ids(selectDueAnalyses(records, { now, evaluationTimeframe: "5" })), ["ambiguous", "gap", "gapEarly", "legacy", "short"]);
  assert.deepEqual(ids(selectDueAnalyses(records, { now, includeFixed: true })),
    ["ambiguous", "fiveMinute", "gap", "gapEarly", "legacy", "short"]);
});
