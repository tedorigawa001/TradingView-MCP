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
  // The analysis never looked at goes first, then the ongoing ones looked at longest ago, by expiry when they were looked
  // at together (BACKLOG 102-34).
  assert.deepEqual(selectDueAnalyses(records, { now }).candidates.map((candidate) => candidate.analysisId),
    ["fresh", "ongoingAtExpiry", "checkedBefore", "active", "ambiguousEarly", "shortOld", "gapStale"]);
  assert.deepEqual(selectDueAnalyses(records, { now, limit: 3 }).candidates.map((candidate) => candidate.analysisId),
    ["fresh", "ongoingAtExpiry", "checkedBefore"], "the oldest expiries no longer take every slot");
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

// BACKLOG 102-34: a recheck that finds the same result, or fails, records nothing in the journal, so due selection had
// no time it last looked at an analysis. The attempt log beside the journal gives one.
const attempts = (entries) => new Map(entries.map(([id, attemptedAt, result]) => [id, { attemptedAt, result, definitionHash: `hash-${id}` }]));

test("open results take turns, looked at longest ago first, as the attempt log notes rechecks that found the same (102-34)", () => {
  const open = (id, evaluatedAt) => record(id, "2026-07-20T00:00:00.000Z", { ...outcome("incomplete", "history_ends_before_expiry"), evaluatedAt });
  const records = [open("a", "2026-07-20T01:00:00.000Z"), open("b", "2026-07-20T01:10:00.000Z"), open("c", "2026-07-20T01:20:00.000Z")];
  const now = new Date("2026-07-21T00:00:00.000Z");
  const pick = (log) => selectDueAnalyses(records, { now, limit: 1, lastAttempts: attempts(log) }).candidates[0];
  // Without the log the result recorded first goes first, as before; once its recheck is noted, the next one does.
  assert.equal(pick([]).analysisId, "a");
  const log = [["a", "2026-07-21T00:00:00.000Z", "unchanged"]];
  assert.equal(pick(log).analysisId, "b");
  log.push(["b", "2026-07-21T00:01:00.000Z", "unchanged"]);
  assert.equal(pick(log).analysisId, "c");
  log.push(["c", "2026-07-21T00:02:00.000Z", "unchanged"]);
  const again = pick(log);
  assert.deepEqual([again.analysisId, again.lastSeenAt, again.lastAttempt], ["a", "2026-07-21T00:00:00.000Z", { attemptedAt: "2026-07-21T00:00:00.000Z", result: "unchanged" }]);
  // Among open results, turns do not depend on expiry: one still active, looked at longer ago, goes first.
  const activeOpen = record("activeOpen", "2026-07-25T00:00:00.000Z", { ...outcome("ambiguous", "terminal_order_unknown"), evaluatedAt: "2026-07-20T00:30:00.000Z" });
  assert.equal(selectDueAnalyses([...records, activeOpen], { now, limit: 1 }).candidates[0].analysisId, "activeOpen");
  // When it was last looked at is the later of its last recorded outcome and its last attempt.
  const recorded = selectDueAnalyses([open("a", "2026-07-21T05:00:00.000Z")], { now, lastAttempts: attempts(log) }).candidates[0];
  assert.equal(recorded.lastSeenAt, "2026-07-21T05:00:00.000Z");
  // An attempt noted for another definition of the id is not this analysis's.
  const other = new Map([["b", { attemptedAt: "2026-07-21T09:00:00.000Z", result: "unchanged", definitionHash: "hash-other" }]]);
  assert.equal(selectDueAnalyses(records, { now, lastAttempts: other }).candidates.find((item) => item.analysisId === "b").lastAttempt, null);
});

test("an analysis whose evaluation keeps failing takes turns with the open results, behind the due ones, and is not shut out (102-34)", () => {
  const now = new Date("2026-07-21T00:00:00.000Z");
  const records = [
    record("failing", "2026-07-19T00:00:00.000Z"),
    record("open", "2026-07-19T12:00:00.000Z", { ...outcome("incomplete", "history_ends_before_expiry"), evaluatedAt: "2026-07-20T01:00:00.000Z" }),
    record("fresh", "2026-07-20T12:00:00.000Z"),
  ];
  const ids = (log, limit = 3) => selectDueAnalyses(records, { now, limit, lastAttempts: attempts(log) }).candidates.map((item) => item.analysisId);
  // Never looked at, the oldest expiry goes first; after it fails, the due one goes first and it waits its turn among
  // the open results, by when each was last looked at.
  assert.deepEqual(ids([]), ["failing", "fresh", "open"]);
  assert.deepEqual(ids([["failing", "2026-07-20T00:30:00.000Z", "failed"]]), ["fresh", "failing", "open"]);
  assert.deepEqual(ids([["failing", "2026-07-20T02:00:00.000Z", "failed"]]), ["fresh", "open", "failing"]);
  assert.deepEqual(ids([["failing", "2026-07-20T02:00:00.000Z", "failed"]], 1), ["fresh"], "a failing analysis does not take the due one's slot");
  // A failed recheck of an ongoing result moves it back too; an outcome recorded after the failure brings it forward.
  const ongoing = (evaluatedAt) => record("ongoing", "2026-07-22T00:00:00.000Z", { ...outcome("ongoing", "awaiting_terminal"), evaluatedAt });
  const withOngoing = (evaluatedAt, log) => selectDueAnalyses([ongoing(evaluatedAt), records[1]], { now, lastAttempts: attempts(log) })
    .candidates.map((item) => item.analysisId);
  assert.deepEqual(withOngoing("2026-07-20T00:00:00.000Z", []), ["ongoing", "open"]);
  assert.deepEqual(withOngoing("2026-07-20T00:00:00.000Z", [["ongoing", "2026-07-20T03:00:00.000Z", "failed"]]), ["open", "ongoing"]);
  assert.deepEqual(withOngoing("2026-07-20T04:00:00.000Z", [["ongoing", "2026-07-20T03:00:00.000Z", "failed"]]), ["ongoing", "open"]);
  // In front, an analysis whose window has closed comes before the active ones, even one never looked at; among those,
  // the one never looked at goes first.
  const activeNew = record("activeNew", "2026-07-23T00:00:00.000Z");
  assert.deepEqual(selectDueAnalyses([activeNew, ongoing("2026-07-20T00:00:00.000Z"), { ...ongoing("2026-07-20T00:00:00.000Z"),
    definition: { ...record("closed", "2026-07-20T12:00:00.000Z").definition } }], { now, includeActive: true }).candidates
    .map((item) => item.analysisId), ["closed", "activeNew", "ongoing"]);
  // A recheck that found the same ongoing result stays in front.
  assert.deepEqual(withOngoing("2026-07-20T00:00:00.000Z", [["ongoing", "2026-07-20T03:00:00.000Z", "unchanged"]]), ["ongoing", "open"]);
});

test("groups go by the outcome recorded last: an ongoing latest after a recheck with less evidence does not hold a front slot (102-34)", () => {
  const now = new Date("2026-07-21T00:00:00.000Z");
  const withRecent = (id, latest, recent) => ({ ...record(id, "2026-07-20T00:00:00.000Z", latest),
    recentOutcome: { ...record(id, "2026-07-20T00:00:00.000Z", recent).latestOutcome, sequence: 3 } });
  const ongoing = { ...outcome("ongoing", "awaiting_terminal"), evidenceTimeframe: "60", evaluatedAt: "2026-07-19T23:00:00.000Z" };
  const fresh = record("fresh", "2026-07-20T12:00:00.000Z");
  // The latest stays ongoing (more evidence), but the last recheck found the history ending before the expiry.
  const stopped = withRecent("stopped", ongoing, { ...outcome("incomplete", "history_ends_before_expiry"), evidenceThrough: "2026-07-19T20:00:00.000Z", evaluatedAt: "2026-07-20T06:00:00.000Z" });
  assert.deepEqual(selectDueAnalyses([stopped, fresh], { now, limit: 1 }).candidates.map((item) => item.analysisId), ["fresh"]);
  // It goes after an ongoing analysis, even one still active and looked at later.
  const other = record("other", "2026-07-22T00:00:00.000Z", { ...ongoing, evaluatedAt: "2026-07-20T07:00:00.000Z" });
  assert.deepEqual(selectDueAnalyses([stopped, other], { now }).candidates.map((item) => item.analysisId), ["other", "stopped"]);
  const candidate = selectDueAnalyses([stopped], { now }).candidates[0];
  assert.deepEqual([candidate.latestOutcome.outcome, candidate.recentOutcome.outcome], ["awaiting_terminal", "history_ends_before_expiry"]);
  // The last recheck found a history that no longer reaches back on the same request: named, not picked on every call.
  const short = withRecent("short", ongoing, { ...outcome("incomplete", "history_incomplete"), evidenceTimeframe: "60", evidenceThrough: null,
    evaluatedAt: "2026-07-20T06:00:00.000Z", result: { source: { requestedBars: 1000, loadMoreBars: 0 } } });
  const named = selectDueAnalyses([short], { now, requestedBars: 1000 });
  assert.deepEqual([named.candidates, named.skipped], [[], [{ analysisId: "short", reason: "history_short_fixed_for_request" }]]);
  // A caller without the outcome recorded last groups by the latest, as before.
  const plain = record("plain", "2026-07-20T00:00:00.000Z", ongoing);
  assert.equal(selectDueAnalyses([plain], { now }).candidates[0].recentOutcome.outcome, "awaiting_terminal");
});
