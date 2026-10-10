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
  // The journal now lets what is recorded after such a record replace it, so it is rechecked; it goes after the analyses
  // that just became due and the evaluated open results, so it crowds none of them out.
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

test("legacy rechecks go after the other evaluated open results, so one that keeps failing blocks none of them (102-32 review)", () => {
  const evaluated = (status, label, evaluatedAt) => ({ ...outcome(status, label), evaluatedAt });
  const selected = selectDueAnalyses([
    record("legacyOld", "2026-07-16T05:00:00.000Z", { ...outcome("complete", "not_activated"), evaluatedAt: "2026-07-17T00:00:00.000Z" }),
    record("openRecent", "2026-10-01T05:00:00.000Z", evaluated("incomplete", "history_ends_before_expiry", "2026-10-02T00:00:00.000Z")),
    record("fresh", "2026-10-09T05:00:00.000Z"),
  ], { now: new Date("2026-10-10T00:00:00.000Z") });
  assert.deepEqual(selected.candidates.map((candidate) => candidate.analysisId), ["fresh", "openRecent", "legacyOld"]);
});

test("legacy rechecks go in the order their records were evaluated, not by expiry (102-32 re-review)", () => {
  const legacy = (id, expiresAt, evaluatedAt) => record(id, expiresAt, { ...outcome("complete", "not_activated"), evaluatedAt });
  const selected = selectDueAnalyses([
    legacy("expiresFirst", "2026-07-10T05:00:00.000Z", "2026-07-20T00:00:00.000Z"),
    legacy("evaluatedFirst", "2026-07-15T05:00:00.000Z", "2026-07-16T00:00:00.000Z"),
  ], { now: new Date("2026-10-10T00:00:00.000Z") });
  assert.deepEqual(selected.candidates.map((candidate) => candidate.analysisId), ["evaluatedFirst", "expiresFirst"]);
});

// 102-32 re-review: a history that does not reach back to the analysis only falls further behind on the same request, so
// a recheck on the same timeframe without loading more history comes out the same and would be picked on every call.
test("a result whose history does not reach back is named unless the run loads more or evaluates on another timeframe", () => {
  // Recorded on the analysis timeframe (60), as a recheck without evaluation_timeframe evaluates it, from 1000 bars.
  const short = (id, result = { source: { requestedBars: 1000 } }) => record(id, "2026-07-16T05:00:00.000Z",
    { ...outcome("incomplete", "history_incomplete"), evidenceTimeframe: "60", evaluatedAt: "2026-10-10T00:00:00.000Z", result });
  const options = { now: new Date("2026-10-14T00:00:00.000Z"), requestedBars: 1000 };
  const named = selectDueAnalyses([short("old"), record("fresh", "2026-10-13T00:00:00.000Z")], options);
  assert.deepEqual(named.candidates.map((candidate) => candidate.analysisId), ["fresh"]);
  assert.deepEqual(named.skipped, [{ analysisId: "old", reason: "history_short_fixed_for_request" }]);
  // Fewer bars than the record requested, or no count, change nothing either, nor does the same timeframe written another
  // way.
  for (const extra of [{ requestedBars: 500 }, { requestedBars: undefined }, { evaluationTimeframe: "1h" }]) {
    assert.deepEqual(selectDueAnalyses([short("old")], { ...options, ...extra }).skipped.map((item) => item.reason), ["history_short_fixed_for_request"]);
  }
  for (const extra of [{ loadMoreBars: 5000 }, { evaluationTimeframe: "15" }, { includeFixed: true }, { requestedBars: 5000 }]) {
    const rechecked = selectDueAnalyses([short("old")], { ...options, ...extra });
    assert.deepEqual(rechecked.candidates.map((candidate) => [candidate.analysisId, candidate.reason]), [["old", "non_terminal_recheck"]], JSON.stringify(extra));
  }
  // A load is compared with the record's: no larger load changes nothing, a larger one rechecks it.
  const loaded = short("old", { source: { requestedBars: 1000, loadMoreBars: 2000 } });
  assert.deepEqual(selectDueAnalyses([loaded], { ...options, loadMoreBars: 2000 }).skipped.map((item) => item.reason), ["history_short_fixed_for_request"]);
  assert.deepEqual(selectDueAnalyses([loaded], { ...options, loadMoreBars: 3000 }).candidates.map((candidate) => candidate.analysisId), ["old"]);
  // A record that names no requested count is not rechecked for more bars.
  for (const result of [{}, { source: null }, { source: { requestedBars: "1000" } }]) {
    assert.deepEqual(selectDueAnalyses([short("old", result)], { ...options, requestedBars: 5000 }).skipped.map((item) => item.reason),
      ["history_short_fixed_for_request"], JSON.stringify(result));
  }
});
