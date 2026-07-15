import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_OVERLAY_INPUTS,
  ANALYSIS_OVERLAY_NAME,
  ANALYSIS_OVERLAY_SOURCE,
  assertAnalysisOverlayStudy,
  buildAnalysisOverlayInputs,
  computeAnalysisOverlayPriceStatus,
  parseAnalysisOverlayState,
  resolveAnalysisChart,
  validateAnalysisPayload,
} from "../../build/analysisOverlay.js";

const bullish = {
  analysisId: "USDJPY-20260715-1930",
  analyzedAt: "2026-07-15T10:30:00.000Z",
  expiresAt: "2026-07-15T14:30:00.000Z",
  bias: "bullish",
  entryLow: 162.28,
  entryHigh: 162.35,
  confirmation: 162.43,
  invalidation: 162.18,
  stop: 162.15,
  targets: [162.6, 162.85],
  confidence: 0.72,
  note: "PPI risk",
};

test("analysis overlay template exposes the stable input contract", () => {
  assert.match(ANALYSIS_OVERLAY_SOURCE, /indicator\("Bushido Analysis Overlay"/);
  assert.match(ANALYSIS_OVERLAY_SOURCE, /\\n" \+ analysisNote/);
  assert.match(ANALYSIS_OVERLAY_SOURCE, /label\.style_label_left, size = size\.small/);
  assert.doesNotMatch(ANALYSIS_OVERLAY_SOURCE, /" \| " \+ analysisId/);
  assert.equal(ANALYSIS_OVERLAY_INPUTS.length, 14);
  assert.equal(ANALYSIS_OVERLAY_INPUTS[13].name, "Note");
});

test("resolveAnalysisChart validates symbol and equivalent timeframe aliases", () => {
  const context = {
    layoutName: "FX",
    activeChartIndex: 0,
    chartsCount: 1,
    charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
  };
  assert.equal(resolveAnalysisChart(context, undefined, "oanda:usdjpy", "4H").index, 0);
  assert.throws(
    () => resolveAnalysisChart(context, undefined, "OANDA:EURUSD", "4H"),
    /chart symbol mismatch/,
  );
  assert.throws(
    () => resolveAnalysisChart(context, undefined, "OANDA:USDJPY", "15"),
    /chart timeframe mismatch/,
  );
});

test("validateAnalysisPayload enforces directional levels and marks expiry", () => {
  assert.deepEqual(
    validateAnalysisPayload(bullish, new Date("2026-07-15T11:00:00.000Z")),
    { stale: false, warnings: [] },
  );
  const stale = validateAnalysisPayload(bullish, new Date("2026-07-15T15:00:00.000Z"));
  assert.equal(stale.stale, true);
  assert.equal(stale.warnings.length, 1);
  assert.throws(
    () => validateAnalysisPayload({ ...bullish, stop: 162.3 }, new Date("2026-07-15T11:00:00.000Z")),
    /bullish stop and invalidation/,
  );
  assert.throws(
    () =>
      validateAnalysisPayload(
        { ...bullish, confirmation: 162.3 },
        new Date("2026-07-15T11:00:00.000Z"),
      ),
    /bullish confirmation must be above entry_high/,
  );
  assert.throws(
    () =>
      validateAnalysisPayload(
        { ...bullish, targets: [162.85, 162.6] },
        new Date("2026-07-15T11:00:00.000Z"),
      ),
    /bullish targets must be strictly increasing/,
  );
  assert.throws(
    () =>
      validateAnalysisPayload(
        { ...bullish, stop: 162.2 },
        new Date("2026-07-15T11:00:00.000Z"),
      ),
    /bullish stop must be below invalidation/,
  );
  assert.throws(
    () =>
      validateAnalysisPayload(
        {
          ...bullish,
          bias: "bearish",
          entryLow: 1.141,
          entryHigh: 1.142,
          confirmation: 1.1415,
          invalidation: 1.143,
          stop: 1.144,
          targets: [1.139],
        },
        new Date("2026-07-15T11:00:00.000Z"),
      ),
    /bearish confirmation must be below entry_low/,
  );
  assert.throws(
    () =>
      validateAnalysisPayload(
        {
          ...bullish,
          bias: "bearish",
          entryLow: 1.141,
          entryHigh: 1.142,
          confirmation: 1.14,
          invalidation: 1.143,
          stop: 1.144,
          targets: [1.137, 1.139],
        },
        new Date("2026-07-15T11:00:00.000Z"),
      ),
    /bearish targets must be strictly decreasing/,
  );
  assert.doesNotThrow(() =>
    validateAnalysisPayload(
      {
        ...bullish,
        bias: "neutral",
        invalidation: 162.1,
        stop: 162.05,
        confirmation: 162.3,
        targets: [162.2, 162.5],
      },
      new Date("2026-07-15T11:00:00.000Z"),
    ),
  );
});

test("buildAnalysisOverlayInputs maps optional values to inert defaults", () => {
  const inputs = buildAnalysisOverlayInputs({
    ...bullish,
    confirmation: undefined,
    expiresAt: undefined,
    targets: [162.6],
    note: undefined,
  });
  assert.equal(inputs.length, 14);
  assert.deepEqual(inputs.find((input) => input.id === "in_1"), {
    id: "in_1",
    value: Date.parse(bullish.analyzedAt),
  });
  assert.deepEqual(inputs.find((input) => input.id === "in_5"), { id: "in_5", value: 0 });
  assert.deepEqual(inputs.find((input) => input.id === "in_9"), { id: "in_9", value: 0 });
  assert.deepEqual(inputs.find((input) => input.id === "in_12"), { id: "in_12", value: 0 });
});

test("assertAnalysisOverlayStudy refuses unrelated studies", () => {
  assert.throws(
    () =>
      assertAnalysisOverlayStudy(
        [{ id: "st1", name: "RSI", title: "RSI", inputs: [] }],
        "st1",
      ),
    /refusing to modify an unrelated indicator/,
  );
  const study = {
    id: "overlay1",
    name: ANALYSIS_OVERLAY_NAME,
    title: ANALYSIS_OVERLAY_NAME,
    inputs: ANALYSIS_OVERLAY_INPUTS.map((input) => ({
      id: input.id,
      name: input.name,
      type: "string",
      value: 0,
      defval: 0,
      tooltip: null,
    })),
  };
  assert.equal(assertAnalysisOverlayStudy([study], "overlay1"), study);
  assert.throws(
    () =>
      assertAnalysisOverlayStudy(
        [{ ...study, name: `${ANALYSIS_OVERLAY_NAME} v2`, title: `${ANALYSIS_OVERLAY_NAME} v2` }],
        "overlay1",
      ),
    /refusing to modify an unrelated indicator/,
  );
});

test("parseAnalysisOverlayState and price status preserve current-price semantics", () => {
  const mapped = buildAnalysisOverlayInputs(bullish);
  const study = {
    id: "overlay1",
    name: ANALYSIS_OVERLAY_NAME,
    title: ANALYSIS_OVERLAY_NAME,
    inputs: ANALYSIS_OVERLAY_INPUTS.map((expected) => {
      const input = mapped.find((candidate) => candidate.id === expected.id);
      return {
        id: expected.id,
        name: expected.name,
        type: typeof input.value,
        value: input.value,
        defval: 0,
        tooltip: null,
      };
    }),
  };
  const state = parseAnalysisOverlayState(study);
  assert.equal(state.analyzedAt, bullish.analyzedAt);
  assert.deepEqual(state.targets, [162.6, 162.85]);

  const status = computeAnalysisOverlayPriceStatus(
    state,
    162.45,
    new Date("2026-07-15T11:30:00.000Z"),
  );
  assert.equal(status.lifecycle, "active");
  assert.equal(status.entryRelation, "above_entry");
  assert.equal(status.confirmation, "current_price_at_or_beyond");
  assert.equal(status.targets[0].currentPriceStatus, "current_price_not_at_or_beyond");
  assert.match(status.interpretation, /do not prove historical touch order/);

  const expired = computeAnalysisOverlayPriceStatus(
    state,
    162.3,
    new Date("2026-07-15T15:00:00.000Z"),
  );
  assert.equal(expired.lifecycle, "expired");
  assert.equal(expired.entryRelation, "inside_entry");
});
