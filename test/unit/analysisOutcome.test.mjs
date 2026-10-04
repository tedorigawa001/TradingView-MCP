import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAnalysisPathMetrics,
  evaluateAnalysisOverlayOutcome,
  historyCoversExpiry,
} from "../../build/analysisOutcome.js";

const state = {
  analysisId: "USDJPY-outcome",
  analyzedAt: "2026-07-15T10:05:00.000Z",
  expiresAt: "2026-07-15T11:00:00.000Z",
  bias: "bullish",
  entryLow: 162.1,
  entryHigh: 162.2,
  confirmation: null,
  invalidation: 161.95,
  stop: 161.9,
  targets: [162.6, 162.8],
  confidence: 0.6,
  note: "",
};

const bar = (timeIso, values, forming = false) => ({
  time: Date.parse(timeIso) / 1000,
  timeIso,
  open: values.open,
  high: values.high,
  low: values.low,
  close: values.close,
  volume: null,
  ...(forming ? { forming: true } : {}),
});

test("analysis outcome records target before stop from post-analysis closed bars", () => {
  const result = evaluateAnalysisOverlayOutcome(
    state,
    [
      bar("2026-07-15T10:00:00.000Z", { open: 162.4, high: 162.7, low: 161.8, close: 162.3 }),
      bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 }),
      bar("2026-07-15T10:30:00.000Z", { open: 162.25, high: 162.85, low: 162.22, close: 162.75 }),
    ],
    "15",
    new Date("2026-07-15T11:05:00.000Z"),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.outcome, "target_before_stop");
  assert.equal(result.activation.entryAt, "2026-07-15T10:15:00.000Z");
  assert.deepEqual(result.terminal, {
    kind: "target",
    targetIndex: 1,
    price: 162.6,
    barTime: "2026-07-15T10:30:00.000Z",
  });
  assert.equal(result.evidence.evaluatedBars, 2);
  assert.equal(result.evidence.skippedAnalysisBar, true);
});

test("analysis outcome refuses target and stop ordering inside one bar", () => {
  const result = evaluateAnalysisOverlayOutcome(
    state,
    [
      bar("2026-07-15T10:00:00.000Z", { open: 162.3, high: 162.4, low: 162.25, close: 162.3 }),
      bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 }),
      bar("2026-07-15T10:30:00.000Z", { open: 162.25, high: 162.65, low: 161.85, close: 162.1 }),
    ],
    "15",
    new Date("2026-07-15T11:05:00.000Z"),
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.outcome, "terminal_order_unknown");
  assert.deepEqual(result.qualityIssues, ["target_and_stop_touched_same_bar"]);
  assert.equal(result.terminal, null);
});

test("analysis outcome requires confirmation after entry before evaluating stop", () => {
  const result = evaluateAnalysisOverlayOutcome(
    { ...state, confirmation: 162.4 },
    [
      bar("2026-07-15T10:00:00.000Z", { open: 162.3, high: 162.35, low: 162.25, close: 162.3 }),
      bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 }),
      bar("2026-07-15T10:30:00.000Z", { open: 162.25, high: 162.45, low: 162.22, close: 162.42 }),
      bar("2026-07-15T10:45:00.000Z", { open: 162.42, high: 162.43, low: 161.85, close: 162.0 }),
    ],
    "15",
    new Date("2026-07-15T11:05:00.000Z"),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.outcome, "stop_before_target");
  assert.equal(result.activation.entryAt, "2026-07-15T10:15:00.000Z");
  assert.equal(result.activation.confirmationAt, "2026-07-15T10:30:00.000Z");
  assert.equal(result.terminal.kind, "stop");
});

test("analysis outcome invalidates a setup when the entry bar reaches invalidation before confirmation", () => {
  const result = evaluateAnalysisOverlayOutcome(
    { ...state, confirmation: 162.4 },
    [
      bar("2026-07-15T10:00:00.000Z", { open: 162.3, high: 162.35, low: 162.25, close: 162.3 }),
      bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.35, low: 161.94, close: 162.1 }),
      bar("2026-07-15T10:30:00.000Z", { open: 162.1, high: 162.45, low: 162.05, close: 162.42 }),
      bar("2026-07-15T10:45:00.000Z", { open: 162.42, high: 162.65, low: 162.4, close: 162.6 }),
    ],
    "15",
    new Date("2026-07-15T11:05:00.000Z"),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.outcome, "invalidated_before_confirmation");
  assert.deepEqual(result.terminal, {
    kind: "invalidation",
    price: 161.95,
    barTime: "2026-07-15T10:15:00.000Z",
  });
});

test("analysis outcome refuses confirmation and invalidation ordering inside one bar", () => {
  const result = evaluateAnalysisOverlayOutcome(
    { ...state, confirmation: 162.4 },
    [
      bar("2026-07-15T10:00:00.000Z", { open: 162.3, high: 162.35, low: 162.25, close: 162.3 }),
      bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 }),
      bar("2026-07-15T10:30:00.000Z", { open: 162.25, high: 162.45, low: 161.94, close: 162.1 }),
    ],
    "15",
    new Date("2026-07-15T11:05:00.000Z"),
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.outcome, "activation_order_unknown");
  assert.deepEqual(result.qualityIssues, ["confirmation_and_invalidation_touched_same_bar"]);
});

test("analysis outcome reports incomplete history instead of assuming no entry", () => {
  const result = evaluateAnalysisOverlayOutcome(
    state,
    [
      bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 }),
      bar("2026-07-15T10:30:00.000Z", { open: 162.25, high: 162.65, low: 162.22, close: 162.55 }),
    ],
    "15",
    new Date("2026-07-15T11:05:00.000Z"),
  );

  assert.equal(result.status, "incomplete");
  assert.equal(result.outcome, "history_incomplete");
  assert.deepEqual(result.qualityIssues, ["history_does_not_cover_analysis_start"]);
});

test("analysis outcome is incomplete when the whole window is inside the analysis bar", () => {
  const result = evaluateAnalysisOverlayOutcome(
    { ...state, expiresAt: "2026-07-15T10:10:00.000Z" },
    [
      bar("2026-07-15T10:00:00.000Z", { open: 162.3, high: 162.65, low: 161.85, close: 162.2 }),
      bar(
        "2026-07-15T10:15:00.000Z",
        { open: 162.2, high: 162.3, low: 162.1, close: 162.25 },
        true,
      ),
    ],
    "15",
    new Date("2026-07-15T10:20:00.000Z"),
  );

  assert.equal(result.status, "incomplete");
  assert.equal(result.outcome, "no_closed_bars_in_evaluation_window");
  assert.deepEqual(result.qualityIssues, ["no_post_analysis_closed_bar_before_expiry"]);
});

test("analysis outcome excludes a forming bar that reaches the target", () => {
  const result = evaluateAnalysisOverlayOutcome(
    { ...state, expiresAt: null },
    [
      bar("2026-07-15T10:00:00.000Z", { open: 162.3, high: 162.35, low: 162.25, close: 162.3 }),
      bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 }),
      bar(
        "2026-07-15T10:30:00.000Z",
        { open: 162.25, high: 162.65, low: 162.22, close: 162.55 },
        true,
      ),
    ],
    "15",
    new Date("2026-07-15T10:40:00.000Z"),
  );

  assert.equal(result.status, "ongoing");
  assert.equal(result.outcome, "awaiting_terminal");
  assert.equal(result.terminal, null);
  assert.equal(result.evidence.closedBars, 2);
});

test("analysis outcome does not infer a fill when a bar gaps across a terminal", () => {
  const result = evaluateAnalysisOverlayOutcome(
    state,
    [
      bar("2026-07-15T10:00:00.000Z", { open: 162.3, high: 162.35, low: 162.25, close: 162.3 }),
      bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 }),
      bar("2026-07-15T10:30:00.000Z", { open: 162.7, high: 162.75, low: 162.65, close: 162.7 }),
    ],
    "15",
    new Date("2026-07-15T11:05:00.000Z"),
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.outcome, "gap_across_terminal");
  assert.deepEqual(result.qualityIssues, ["bar_open_gapped_across_terminal_level"]);
});

test("analysis outcome accepts TradingView daily and weekly resolution aliases", () => {
  const dailyState = {
    ...state,
    analyzedAt: "2026-07-14T12:00:00.000Z",
    expiresAt: "2026-07-18T00:00:00.000Z",
  };
  const dailyBars = [
    bar("2026-07-14T00:00:00.000Z", { open: 162.3, high: 162.4, low: 162.2, close: 162.3 }),
    bar("2026-07-15T00:00:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 }),
    bar("2026-07-16T00:00:00.000Z", { open: 162.25, high: 162.65, low: 162.2, close: 162.55 }),
  ];
  const daily = evaluateAnalysisOverlayOutcome(
    dailyState,
    dailyBars,
    "D",
    new Date("2026-07-18T01:00:00.000Z"),
  );
  assert.equal(daily.outcome, "target_before_stop");

  const weekly = evaluateAnalysisOverlayOutcome(
    { ...dailyState, expiresAt: "2026-08-10T00:00:00.000Z" },
    dailyBars,
    "W",
    new Date("2026-07-18T01:00:00.000Z"),
  );
  assert.notEqual(weekly.status, "not_evaluable");
});

test("analysis outcome reports calendar-month resolution as not evaluable", () => {
  const result = evaluateAnalysisOverlayOutcome(state, [], "M");
  assert.equal(result.status, "not_evaluable");
  assert.equal(result.outcome, "calendar_month_resolution_unsupported");
});

test("path metrics use entry geometry and exclude activation and terminal bar OHLC", () => {
  const bars = [
    bar("2026-07-15T10:00:00.000Z", { open: 162.3, high: 162.4, low: 162.2, close: 162.3 }),
    bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.3, low: 162.1, close: 162.2 }),
    bar("2026-07-15T10:30:00.000Z", { open: 162.2, high: 162.5, low: 162, close: 162.4 }),
    bar("2026-07-15T10:45:00.000Z", { open: 162.4, high: 162.7, low: 162.3, close: 162.6 }),
  ];
  const result = evaluateAnalysisOverlayOutcome(
    state,
    bars,
    "15",
    new Date("2026-07-15T11:05:00.000Z"),
  );
  const metrics = computeAnalysisPathMetrics(state, bars, result);
  assert.equal(result.outcome, "target_before_stop");
  assert.ok(Math.abs(metrics.referenceEntry - 162.15) < 1e-9);
  assert.ok(Math.abs(metrics.structuralRiskPrice - 0.25) < 1e-9);
  assert.ok(Math.abs(metrics.excursion.mfeR - 1.8) < 1e-9);
  assert.ok(Math.abs(metrics.excursion.maeR - 0.6) < 1e-9);
  assert.ok(Math.abs(metrics.grossRealizedR - 1.8) < 1e-9);
  assert.equal(metrics.excursion.interiorBars, 1);
  assert.equal(metrics.timing.activationToTerminalMs, 30 * 60_000);
});

// BACKLOG 102-04: a result without a terminal is final only once the history reaches the expiry (11:00 here).
const quiet = (timeIso) => bar(timeIso, { open: 162.3, high: 162.35, low: 162.25, close: 162.3 });
const entry = bar("2026-07-15T10:15:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 });
const analysisBar = bar("2026-07-15T10:00:00.000Z", { open: 162.4, high: 162.45, low: 162.3, close: 162.4 });
const after = new Date("2026-07-15T12:00:00.000Z");

test("history that stops before the expiry leaves an active analysis incomplete, and a later bar can still reach the stop", () => {
  const short = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry], "15", after);
  assert.deepEqual([short.status, short.outcome, short.qualityIssues], ["incomplete", "history_ends_before_expiry", ["history_ends_before_expiry"]]);
  assert.equal(short.activation.entryAt, "2026-07-15T10:15:00.000Z", "what the history shows is kept");
  const longer = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry,
    bar("2026-07-15T10:30:00.000Z", { open: 162.2, high: 162.25, low: 161.85, close: 161.9 })], "15", after);
  assert.deepEqual([longer.status, longer.outcome], ["complete", "stop_before_target"], "the reported case");
});

test("history reaching the expiry closes it without a terminal only when no bar is missing before it", () => {
  const atExpiry = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, quiet("2026-07-15T10:30:00.000Z"),
    quiet("2026-07-15T10:45:00.000Z")], "15", after);
  assert.deepEqual([atExpiry.status, atExpiry.outcome], ["complete", "no_terminal_event"]);
  assert.deepEqual([atExpiry.evidence.expiryCoveredBy, atExpiry.evidence.gaps, atExpiry.evidence.gapCount], ["closed_bar", [], 0]);
  // 10:30 and 10:45 are missing and a bar after the expiry cannot show they were a closure: the tail runs to the expiry.
  const acrossGap = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, quiet("2026-07-15T11:15:00.000Z")], "15", after);
  assert.deepEqual([acrossGap.status, acrossGap.outcome, acrossGap.qualityIssues, acrossGap.terminal],
    ["incomplete", "gap_in_evaluation_window", ["gap_in_evaluation_window"], null]);
  assert.deepEqual(acrossGap.evidence.gaps, [{ from: "2026-07-15T10:30:00.000Z", to: "2026-07-15T11:00:00.000Z" }]);
  assert.equal(acrossGap.activation.entryAt, "2026-07-15T10:15:00.000Z");
  // Before the expiry by the clock the window is simply still open.
  const open = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry], "15", new Date("2026-07-15T10:40:00.000Z"));
  assert.deepEqual([open.status, open.outcome], ["ongoing", "awaiting_terminal"]);
});

test("no entry, or an entry without confirmation, is not final while the history stops before the expiry", () => {
  const noEntry = [analysisBar, quiet("2026-07-15T10:15:00.000Z")];
  const shortNoEntry = evaluateAnalysisOverlayOutcome(state, noEntry, "15", after);
  assert.deepEqual([shortNoEntry.status, shortNoEntry.outcome], ["incomplete", "history_ends_before_expiry"]);
  const fullNoEntry = evaluateAnalysisOverlayOutcome(state, [...noEntry, quiet("2026-07-15T10:30:00.000Z"), quiet("2026-07-15T10:45:00.000Z")], "15", after);
  assert.deepEqual([fullNoEntry.status, fullNoEntry.outcome], ["complete", "not_activated"]);
  const confirming = { ...state, confirmation: 162.5 };
  const unconfirmed = evaluateAnalysisOverlayOutcome(confirming, [analysisBar, entry], "15", after);
  assert.deepEqual([unconfirmed.status, unconfirmed.outcome], ["incomplete", "history_ends_before_expiry"]);
  const fullUnconfirmed = evaluateAnalysisOverlayOutcome(confirming, [analysisBar, entry, quiet("2026-07-15T10:30:00.000Z"),
    quiet("2026-07-15T10:45:00.000Z")], "15", after);
  assert.deepEqual([fullUnconfirmed.status, fullUnconfirmed.outcome], ["complete", "expired_without_confirmation"]);
});

test("historyCoversExpiry: the last closed bar must end at or after the expiry", () => {
  assert.equal(historyCoversExpiry("2026-07-15T10:45:00.000Z", "15", "2026-07-15T11:00:00.000Z"), true);
  assert.equal(historyCoversExpiry("2026-07-15T10:30:00.000Z", "15", "2026-07-15T11:00:00.000Z"), false);
  assert.equal(historyCoversExpiry("2026-07-15T10:00:00.000Z", "60", "2026-07-15T11:00:00.000Z"), true);
  assert.equal(historyCoversExpiry(null, "15", "2026-07-15T11:00:00.000Z"), false);
  assert.equal(historyCoversExpiry(null, "15", null), true, "no expiry, nothing to reach");
  assert.equal(historyCoversExpiry("2026-07-15T10:45:00.000Z", "1M", "2026-07-15T11:00:00.000Z"), false, "no fixed bar length");
});

test("the open result keeps a confirmation and its evidence, and an empty window after the expiry says the history is short", () => {
  const confirming = { ...state, confirmation: 162.5 };
  const confirmed = evaluateAnalysisOverlayOutcome(confirming, [analysisBar, entry,
    bar("2026-07-15T10:30:00.000Z", { open: 162.3, high: 162.55, low: 162.28, close: 162.5 })], "15", after);
  assert.deepEqual([confirmed.status, confirmed.outcome, confirmed.activation],
    ["incomplete", "history_ends_before_expiry", { entryAt: "2026-07-15T10:15:00.000Z", confirmationAt: "2026-07-15T10:30:00.000Z" }]);
  assert.deepEqual([confirmed.evidence.evaluatedBars, confirmed.evidence.evidenceThrough], [2, "2026-07-15T10:30:00.000Z"]);
  // Only the analysis bar after the expiry: no window bar yet because the history stops, not because the timeframe is long.
  const empty = evaluateAnalysisOverlayOutcome(state, [analysisBar], "15", after);
  assert.deepEqual([empty.status, empty.outcome], ["incomplete", "history_ends_before_expiry"]);
});

test("a forming bar running past the expiry proves the window closed; one ending at the expiry does not", () => {
  const past = evaluateAnalysisOverlayOutcome({ ...state, expiresAt: "2026-07-15T10:55:00.000Z" }, [analysisBar, entry,
    quiet("2026-07-15T10:30:00.000Z"), bar("2026-07-15T10:45:00.000Z", { open: 162.3, high: 162.35, low: 162.25, close: 162.3 }, true)],
    "15", after);
  assert.deepEqual([past.status, past.outcome], ["complete", "no_terminal_event"], "10:45 + 15 minutes runs past 10:55");
  assert.deepEqual([past.evidence.expiryCoveredBy, past.evidence.gapCount], ["forming_bar", 0], "the tail ends at the forming bar");
  // A forming bar off the grid at 10:55 still proves the window closed, but nothing shows the 10:45 bar.
  const offGrid = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, quiet("2026-07-15T10:30:00.000Z"),
    bar("2026-07-15T10:55:00.000Z", { open: 162.3, high: 162.35, low: 162.25, close: 162.3 }, true)], "15", after);
  assert.deepEqual([offGrid.outcome, offGrid.evidence.expiryCoveredBy, offGrid.evidence.gaps], ["gap_in_evaluation_window", "forming_bar",
    [{ from: "2026-07-15T10:45:00.000Z", to: "2026-07-15T10:55:00.000Z" }]]);
  const atExpiry = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, quiet("2026-07-15T10:30:00.000Z"),
    bar("2026-07-15T10:45:00.000Z", { open: 162.3, high: 162.35, low: 161.5, close: 161.6 }, true)], "15", after);
  assert.deepEqual([atExpiry.status, atExpiry.outcome], ["incomplete", "history_ends_before_expiry"],
    "the last window bar is still forming and may yet reach the stop");
});

// BACKLOG 102-04 (follow-up): a bar missing inside the window may hide an entry, invalidation or terminal.
const stopBar = (timeIso) => bar(timeIso, { open: 162.2, high: 162.25, low: 161.85, close: 161.9 });

test("a bar missing inside the window keeps a result without a terminal open, and the gap is recorded", () => {
  // The reported case: 10:30 is missing, 10:45 is there, so the history reaches the expiry.
  const gapped = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, quiet("2026-07-15T10:45:00.000Z")], "15", after);
  assert.deepEqual([gapped.status, gapped.outcome, gapped.qualityIssues], ["incomplete", "gap_in_evaluation_window", ["gap_in_evaluation_window"]]);
  assert.deepEqual([gapped.evidence.gaps, gapped.evidence.gapCount, gapped.evidence.expiryCoveredBy],
    [[{ from: "2026-07-15T10:30:00.000Z", to: "2026-07-15T10:45:00.000Z" }], 1, "closed_bar"]);
  // Without an entry, and with no window bar at all: the bar after the analysis is the one missing.
  const noEntry = evaluateAnalysisOverlayOutcome(state, [analysisBar, quiet("2026-07-15T10:30:00.000Z"), quiet("2026-07-15T10:45:00.000Z")], "15", after);
  assert.deepEqual([noEntry.outcome, noEntry.evidence.gaps], ["gap_in_evaluation_window",
    [{ from: "2026-07-15T10:15:00.000Z", to: "2026-07-15T10:30:00.000Z" }]]);
  const empty = evaluateAnalysisOverlayOutcome(state, [analysisBar, quiet("2026-07-15T11:15:00.000Z")], "15", after);
  assert.deepEqual([empty.status, empty.outcome, empty.activation, empty.evidence.gaps], ["incomplete", "gap_in_evaluation_window",
    { entryAt: null, confirmationAt: null }, [{ from: "2026-07-15T10:15:00.000Z", to: "2026-07-15T11:00:00.000Z" }]]);
  // A short history is reported as short first: the missing tail is not a gap until the history reaches the expiry.
  const short = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry], "15", after);
  assert.deepEqual([short.outcome, short.evidence.gaps, short.evidence.expiryCoveredBy], ["history_ends_before_expiry", [], null]);
  const shortGapped = evaluateAnalysisOverlayOutcome(state, [analysisBar, quiet("2026-07-15T10:30:00.000Z")], "15", after);
  assert.deepEqual([shortGapped.outcome, shortGapped.evidence.gapCount, shortGapped.evidence.expiryCoveredBy],
    ["gap_in_evaluation_window", 1, null], "a gap already found stays whatever later history shows");
  // While the window is open, a gap before it changes nothing yet.
  const open = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, quiet("2026-07-15T10:45:00.000Z")], "15",
    new Date("2026-07-15T10:59:00.000Z"));
  assert.deepEqual([open.status, open.outcome], ["ongoing", "awaiting_terminal"]);
});

test("a result decided after a gap stays open; one decided before the gap stands", () => {
  const afterGap = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, stopBar("2026-07-15T10:45:00.000Z")], "15", after);
  assert.deepEqual([afterGap.status, afterGap.outcome, afterGap.terminal], ["incomplete", "gap_in_evaluation_window", null],
    "the target may have been hit at 10:30");
  assert.equal(afterGap.activation.entryAt, "2026-07-15T10:15:00.000Z");
  const beforeGap = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, stopBar("2026-07-15T10:30:00.000Z"),
    quiet("2026-07-15T11:00:00.000Z")], "15", after);
  assert.deepEqual([beforeGap.status, beforeGap.outcome], ["complete", "stop_before_target"]);
  assert.equal(beforeGap.evidence.gapCount, 1, "the gap at 10:45 is still recorded");
  // An entry after a gap may have followed an invalidation inside it.
  const invalidation = bar("2026-07-15T10:30:00.000Z", { open: 162.05, high: 162.08, low: 161.92, close: 162 });
  const invalidatedAfterGap = evaluateAnalysisOverlayOutcome(state, [analysisBar, invalidation], "15", new Date("2026-07-15T10:50:00.000Z"));
  assert.deepEqual([invalidatedAfterGap.status, invalidatedAfterGap.outcome], ["incomplete", "gap_in_evaluation_window"]);
  const invalidatedFirst = evaluateAnalysisOverlayOutcome(state, [analysisBar, quiet("2026-07-15T10:15:00.000Z"), invalidation], "15",
    new Date("2026-07-15T10:50:00.000Z"));
  assert.deepEqual([invalidatedFirst.status, invalidatedFirst.outcome], ["complete", "invalidated_before_entry"]);
  // A bar touching both levels after a gap is not ambiguous between them: an earlier bar may have settled it.
  const both = bar("2026-07-15T10:45:00.000Z", { open: 162.3, high: 162.65, low: 161.85, close: 162.3 });
  const bothAfterGap = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, both], "15", after);
  assert.deepEqual([bothAfterGap.status, bothAfterGap.outcome], ["incomplete", "gap_in_evaluation_window"]);
  const bothFirst = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, quiet("2026-07-15T10:30:00.000Z"), both], "15", after);
  assert.deepEqual([bothFirst.status, bothFirst.outcome], ["ambiguous", "terminal_order_unknown"]);
});

test("daily bars that shift an hour with daylight saving are not gaps; a missing day is", () => {
  const daily = { ...state, analyzedAt: "2026-03-05T23:00:00.000Z", expiresAt: "2026-03-10T21:00:00.000Z" };
  const day = (timeIso) => quiet(timeIso);
  // New York moves to daylight time on 8 March 2026, so the 17:00 open moves from 22:00Z to 21:00Z (a 23-hour bar).
  const bars = ["2026-03-05T22:00:00.000Z", "2026-03-06T22:00:00.000Z", "2026-03-07T22:00:00.000Z",
    "2026-03-08T21:00:00.000Z", "2026-03-09T21:00:00.000Z"].map(day);
  const spring = evaluateAnalysisOverlayOutcome(daily, bars, "D", new Date("2026-03-11T00:00:00.000Z"));
  assert.deepEqual([spring.status, spring.outcome, spring.evidence.gapCount], ["complete", "not_activated", 0]);
  const autumn = evaluateAnalysisOverlayOutcome({ ...daily, analyzedAt: "2026-10-30T22:00:00.000Z", expiresAt: "2026-11-03T22:00:00.000Z" },
    ["2026-10-30T21:00:00.000Z", "2026-10-31T21:00:00.000Z", "2026-11-01T22:00:00.000Z", "2026-11-02T22:00:00.000Z"].map(day),
    "D", new Date("2026-11-04T00:00:00.000Z"));
  assert.deepEqual([autumn.status, autumn.outcome, autumn.evidence.gapCount], ["complete", "not_activated", 0], "a 25-hour bar");
  const missingDay = evaluateAnalysisOverlayOutcome(daily, bars.filter((_, index) => index !== 2), "D", new Date("2026-03-11T00:00:00.000Z"));
  assert.deepEqual([missingDay.outcome, missingDay.evidence.gaps], ["gap_in_evaluation_window",
    [{ from: "2026-03-07T22:00:00.000Z", to: "2026-03-08T21:00:00.000Z" }]]);
  // The last window bar missing after the change: the tail ends at the next bar, so it is measured the same way.
  const missingLast = evaluateAnalysisOverlayOutcome({ ...daily, expiresAt: "2026-03-09T21:00:00.000Z" },
    bars.filter((_, index) => index !== 3), "D", new Date("2026-03-11T00:00:00.000Z"));
  assert.deepEqual([missingLast.outcome, missingLast.evidence.gaps], ["gap_in_evaluation_window",
    [{ from: "2026-03-08T22:00:00.000Z", to: "2026-03-09T21:00:00.000Z" }]]);
  // Weekly bars move the same hour.
  const weeklyState = { ...daily, analyzedAt: "2026-03-01T23:00:00.000Z", expiresAt: "2026-03-15T21:00:00.000Z" };
  const weeks = ["2026-03-01T22:00:00.000Z", "2026-03-08T21:00:00.000Z", "2026-03-15T21:00:00.000Z"].map(day);
  const weekly = evaluateAnalysisOverlayOutcome(weeklyState, weeks, "W", new Date("2026-03-23T00:00:00.000Z"));
  assert.deepEqual([weekly.status, weekly.outcome, weekly.evidence.gapCount], ["complete", "not_activated", 0]);
  const missingWeek = evaluateAnalysisOverlayOutcome(weeklyState, [weeks[0], weeks[2]], "W", new Date("2026-03-23T00:00:00.000Z"));
  assert.deepEqual([missingWeek.outcome, missingWeek.evidence.gaps], ["gap_in_evaluation_window",
    [{ from: "2026-03-08T22:00:00.000Z", to: "2026-03-15T21:00:00.000Z" }]]);
});

test("the forming bar ends the tail: one bar missing before it is a gap, none is not", () => {
  const offGrid = { ...state, expiresAt: "2026-07-15T11:07:00.000Z" };
  const forming = bar("2026-07-15T11:00:00.000Z", { open: 162.3, high: 162.35, low: 162.25, close: 162.3 }, true);
  const whole = evaluateAnalysisOverlayOutcome(offGrid, [analysisBar, entry, quiet("2026-07-15T10:30:00.000Z"),
    quiet("2026-07-15T10:45:00.000Z"), forming], "15", after);
  assert.deepEqual([whole.status, whole.outcome, whole.evidence.expiryCoveredBy, whole.evidence.gapCount],
    ["complete", "no_terminal_event", "forming_bar", 0]);
  const missing = evaluateAnalysisOverlayOutcome(offGrid, [analysisBar, entry, quiet("2026-07-15T10:30:00.000Z"), forming], "15", after);
  assert.deepEqual([missing.outcome, missing.evidence.gaps], ["gap_in_evaluation_window",
    [{ from: "2026-07-15T10:45:00.000Z", to: "2026-07-15T11:00:00.000Z" }]]);
  // A missing 11:00 bar would have ended past the 11:10 expiry, so it was never part of the window.
  const pastExpiry = evaluateAnalysisOverlayOutcome({ ...state, expiresAt: "2026-07-15T11:10:00.000Z" }, [analysisBar, entry,
    quiet("2026-07-15T10:30:00.000Z"), quiet("2026-07-15T10:45:00.000Z"), quiet("2026-07-15T11:15:00.000Z")], "15", after);
  assert.deepEqual([pastExpiry.status, pastExpiry.outcome, pastExpiry.evidence.gapCount], ["complete", "no_terminal_event", 0]);
});

test("the evidence keeps the first ten gaps and counts them all", () => {
  const minutes = { ...state, analyzedAt: "2026-07-15T10:00:30.000Z", expiresAt: "2026-07-15T10:40:00.000Z" };
  const sparse = [];
  for (let minute = 0; minute <= 40; minute += 2) {
    sparse.push(quiet(new Date(Date.parse("2026-07-15T10:00:00.000Z") + minute * 60_000).toISOString()));
  }
  const result = evaluateAnalysisOverlayOutcome(minutes, sparse, "1", after);
  assert.deepEqual([result.outcome, result.evidence.gapCount, result.evidence.gaps.length], ["gap_in_evaluation_window", 20, 10], "19 between bars, and 10:39 before the expiry");
  assert.deepEqual(result.evidence.gaps[0], { from: "2026-07-15T10:01:00.000Z", to: "2026-07-15T10:02:00.000Z" });
});

test("a gap result reports only the entry and confirmation found before the gap, and no excursions", () => {
  // 10:30 is missing and the entry shows at 10:45: an earlier entry may have been inside the gap.
  const lateEntry = evaluateAnalysisOverlayOutcome(state, [analysisBar, quiet("2026-07-15T10:15:00.000Z"),
    bar("2026-07-15T10:45:00.000Z", { open: 162.3, high: 162.35, low: 162.15, close: 162.25 })], "15", after);
  assert.deepEqual([lateEntry.outcome, lateEntry.activation], ["gap_in_evaluation_window", { entryAt: null, confirmationAt: null }]);
  const confirming = { ...state, confirmation: 162.5 };
  const lateConfirmation = evaluateAnalysisOverlayOutcome(confirming, [analysisBar, entry,
    bar("2026-07-15T10:45:00.000Z", { open: 162.3, high: 162.55, low: 162.28, close: 162.5 })], "15", after);
  assert.deepEqual([lateConfirmation.outcome, lateConfirmation.activation],
    ["gap_in_evaluation_window", { entryAt: "2026-07-15T10:15:00.000Z", confirmationAt: null }]);
  const bars = [analysisBar, entry, stopBar("2026-07-15T10:45:00.000Z")];
  const gapped = evaluateAnalysisOverlayOutcome(state, bars, "15", after);
  const metrics = computeAnalysisPathMetrics(state, bars, gapped);
  assert.deepEqual([metrics.excursion, metrics.grossRealizedR, metrics.measurement],
    [null, null, "entry_midpoint_reference; bars missing inside the window"]);
  assert.equal(metrics.timing.analyzedToEntryMs, 10 * 60_000, "the entry before the gap is known");
});

test("without an expiry a result decided after a gap stays open, and seconds bars are checked too", () => {
  const open = evaluateAnalysisOverlayOutcome({ ...state, expiresAt: null }, [analysisBar, entry, stopBar("2026-07-15T10:45:00.000Z")], "15", after);
  assert.deepEqual([open.status, open.outcome, open.evidence.expiryCoveredBy, open.evidence.gapCount],
    ["incomplete", "gap_in_evaluation_window", null, 1]);
  const seconds = { ...state, analyzedAt: "2026-07-15T10:00:05.000Z", expiresAt: "2026-07-15T10:02:00.000Z" };
  const thirty = ["2026-07-15T10:00:00.000Z", "2026-07-15T10:00:30.000Z", "2026-07-15T10:01:00.000Z", "2026-07-15T10:02:00.000Z"].map(quiet);
  const result = evaluateAnalysisOverlayOutcome(seconds, thirty, "30S", after);
  assert.deepEqual([result.outcome, result.evidence.gaps], ["gap_in_evaluation_window",
    [{ from: "2026-07-15T10:01:30.000Z", to: "2026-07-15T10:02:00.000Z" }]]);
});
