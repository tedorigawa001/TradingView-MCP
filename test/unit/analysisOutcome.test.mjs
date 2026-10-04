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

test("history reaching the expiry closes it without a terminal: a last bar ending at it, or one after it across a gap", () => {
  const atExpiry = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, quiet("2026-07-15T10:30:00.000Z"),
    quiet("2026-07-15T10:45:00.000Z")], "15", after);
  assert.deepEqual([atExpiry.status, atExpiry.outcome], ["complete", "no_terminal_event"]);
  // 10:30 and 10:45 were never printed (a closure), but the feed has a bar after the expiry, so nothing is missing.
  const acrossGap = evaluateAnalysisOverlayOutcome(state, [analysisBar, entry, quiet("2026-07-15T11:15:00.000Z")], "15", after);
  assert.deepEqual([acrossGap.status, acrossGap.outcome], ["complete", "no_terminal_event"]);
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
