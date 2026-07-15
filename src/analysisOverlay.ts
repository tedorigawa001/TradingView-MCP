import type { ChartContext, IndicatorInputs } from "./tradingview.js";

export const ANALYSIS_OVERLAY_NAME = "Bushido Analysis Overlay";
export const ANALYSIS_OVERLAY_VERSION = "1.0";

export const ANALYSIS_OVERLAY_INPUTS = [
  { id: "in_0", name: "Analysis ID", key: "analysisId" },
  { id: "in_1", name: "Analyzed At", key: "analyzedAt" },
  { id: "in_2", name: "Bias", key: "bias" },
  { id: "in_3", name: "Entry Low", key: "entryLow" },
  { id: "in_4", name: "Entry High", key: "entryHigh" },
  { id: "in_5", name: "Confirmation", key: "confirmation" },
  { id: "in_6", name: "Invalidation", key: "invalidation" },
  { id: "in_7", name: "Stop", key: "stop" },
  { id: "in_8", name: "Target 1", key: "target1" },
  { id: "in_9", name: "Target 2", key: "target2" },
  { id: "in_10", name: "Target 3", key: "target3" },
  { id: "in_11", name: "Confidence", key: "confidence" },
  { id: "in_12", name: "Expires At", key: "expiresAt" },
  { id: "in_13", name: "Note", key: "note" },
] as const;

export type AnalysisBias = "bullish" | "bearish" | "neutral";

export interface AnalysisOverlayPayload {
  analysisId: string;
  analyzedAt: string;
  expiresAt?: string;
  bias: AnalysisBias;
  entryLow: number;
  entryHigh: number;
  confirmation?: number;
  invalidation: number;
  stop: number;
  targets: number[];
  confidence: number;
  note?: string;
}

export const ANALYSIS_OVERLAY_SOURCE = `//@version=6
indicator("${ANALYSIS_OVERLAY_NAME}", overlay = true, max_lines_count = 10, max_labels_count = 10, max_boxes_count = 5)

analysisId  = input.string("unassigned", "Analysis ID")
analyzedAt  = input.time(timestamp("01 Jan 2020 00:00 +0000"), "Analyzed At")
bias        = input.string("neutral", "Bias", options = ["bullish", "bearish", "neutral"])
entryLow    = input.float(1.0, "Entry Low")
entryHigh   = input.float(1.0, "Entry High")
confirmation = input.float(0.0, "Confirmation")
invalidation = input.float(1.0, "Invalidation")
stopLevel   = input.float(1.0, "Stop")
target1     = input.float(0.0, "Target 1")
target2     = input.float(0.0, "Target 2")
target3     = input.float(0.0, "Target 3")
confidence  = input.float(0.5, "Confidence", minval = 0.0, maxval = 1.0, step = 0.01)
expiresAt   = input.time(0, "Expires At")
analysisNote = input.string("", "Note")

expired = expiresAt > 0 and timenow > expiresAt
biasColor = expired ? color.gray : bias == "bullish" ? color.lime : bias == "bearish" ? color.red : color.yellow

var box entryBox = na
var line confirmationLine = na
var line invalidationLine = na
var line stopLine = na
var line target1Line = na
var line target2Line = na
var line target3Line = na
var label analysisLabel = na

if barstate.islast
    box.delete(entryBox)
    line.delete(confirmationLine)
    line.delete(invalidationLine)
    line.delete(stopLine)
    line.delete(target1Line)
    line.delete(target2Line)
    line.delete(target3Line)
    label.delete(analysisLabel)

    entryBox := box.new(left = analyzedAt, top = entryHigh, right = time, bottom = entryLow, xloc = xloc.bar_time, extend = extend.right, bgcolor = color.new(biasColor, 86), border_color = biasColor, text = "ENTRY")
    if confirmation > 0
        confirmationLine := line.new(x1 = analyzedAt, y1 = confirmation, x2 = analyzedAt + 1, y2 = confirmation, xloc = xloc.bar_time, extend = extend.right, color = color.aqua, style = line.style_dashed)
    invalidationLine := line.new(x1 = analyzedAt, y1 = invalidation, x2 = analyzedAt + 1, y2 = invalidation, xloc = xloc.bar_time, extend = extend.right, color = color.orange, style = line.style_dashed)
    stopLine := line.new(x1 = analyzedAt, y1 = stopLevel, x2 = analyzedAt + 1, y2 = stopLevel, xloc = xloc.bar_time, extend = extend.right, color = color.red, width = 2)
    if target1 > 0
        target1Line := line.new(x1 = analyzedAt, y1 = target1, x2 = analyzedAt + 1, y2 = target1, xloc = xloc.bar_time, extend = extend.right, color = color.lime)
    if target2 > 0
        target2Line := line.new(x1 = analyzedAt, y1 = target2, x2 = analyzedAt + 1, y2 = target2, xloc = xloc.bar_time, extend = extend.right, color = color.lime)
    if target3 > 0
        target3Line := line.new(x1 = analyzedAt, y1 = target3, x2 = analyzedAt + 1, y2 = target3, xloc = xloc.bar_time, extend = extend.right, color = color.lime)
    status = expired ? "EXPIRED" : str.upper(bias)
    labelText = status + " " + str.tostring(confidence * 100.0, "#.0") + "%" + (analysisNote == "" ? "\\n" + analysisId : "\\n" + analysisNote)
    analysisLabel := label.new(bar_index + 1, entryHigh, labelText, color = color.new(biasColor, 15), textcolor = color.black, style = label.style_label_left, size = size.small)
`;

function normalizeResolution(value: string): string {
  const upper = value.trim().toUpperCase();
  const hours = upper.match(/^(\d+)H$/);
  if (hours) return String(Number(hours[1]) * 60);
  if (upper === "D") return "1D";
  if (upper === "W") return "1W";
  if (upper === "M") return "1M";
  return upper;
}

export function resolveAnalysisChart(
  context: ChartContext,
  chartIndex: number | undefined,
  expectedSymbol: string,
  expectedTimeframe: string,
) {
  const resolvedIndex = chartIndex ?? context.activeChartIndex;
  if (resolvedIndex === null || resolvedIndex === undefined) {
    throw new Error("TradingView has no active chart; pass chart_index explicitly");
  }
  const chart = context.charts.find((candidate) => candidate.index === resolvedIndex);
  if (!chart) throw new Error(`chart_index ${resolvedIndex} does not exist in the current layout`);
  if (chart.symbol.toUpperCase() !== expectedSymbol.toUpperCase()) {
    throw new Error(
      `chart symbol mismatch: expected ${expectedSymbol}, current chart is ${chart.symbol}`,
    );
  }
  if (normalizeResolution(chart.resolution) !== normalizeResolution(expectedTimeframe)) {
    throw new Error(
      `chart timeframe mismatch: expected ${expectedTimeframe}, current chart is ${chart.resolution}`,
    );
  }
  return chart;
}

export function assertAnalysisOverlayStudy(studies: IndicatorInputs[], studyId: string): IndicatorInputs {
  const study = studies.find((candidate) => candidate.id === studyId);
  if (!study) throw new Error(`study ${studyId} was not returned by get_indicator_inputs`);
  if (study.name !== ANALYSIS_OVERLAY_NAME) {
    throw new Error(
      `study ${studyId} is not ${ANALYSIS_OVERLAY_NAME}; refusing to modify an unrelated indicator`,
    );
  }
  for (const expected of ANALYSIS_OVERLAY_INPUTS) {
    const actual = study.inputs.find((input) => input.id === expected.id);
    if (!actual || actual.name !== expected.name) {
      throw new Error(
        `study ${studyId} does not match overlay input contract at ${expected.id} (${expected.name})`,
      );
    }
  }
  return study;
}

export function validateAnalysisPayload(payload: AnalysisOverlayPayload, now = new Date()): {
  stale: boolean;
  warnings: string[];
} {
  const analyzedAt = new Date(payload.analyzedAt);
  if (!Number.isFinite(analyzedAt.getTime())) throw new Error("analyzed_at must be a valid ISO-8601 timestamp");
  if (analyzedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new Error("analyzed_at cannot be more than five minutes in the future");
  }
  if (payload.entryLow > payload.entryHigh) throw new Error("entry_low must be <= entry_high");
  const levels = [
    payload.entryLow,
    payload.entryHigh,
    payload.invalidation,
    payload.stop,
    ...payload.targets,
    ...(payload.confirmation === undefined ? [] : [payload.confirmation]),
  ];
  if (levels.some((level) => !Number.isFinite(level) || level <= 0)) {
    throw new Error("all supplied price levels must be finite and greater than zero");
  }
  if (payload.bias === "bullish") {
    if (payload.stop >= payload.entryLow || payload.invalidation >= payload.entryLow) {
      throw new Error("bullish stop and invalidation must be below entry_low");
    }
    if (payload.targets.some((target) => target <= payload.entryHigh)) {
      throw new Error("bullish targets must be above entry_high");
    }
    if (payload.confirmation !== undefined && payload.confirmation <= payload.entryHigh) {
      throw new Error("bullish confirmation must be above entry_high");
    }
  }
  if (payload.bias === "bearish") {
    if (payload.stop <= payload.entryHigh || payload.invalidation <= payload.entryHigh) {
      throw new Error("bearish stop and invalidation must be above entry_high");
    }
    if (payload.targets.some((target) => target >= payload.entryLow)) {
      throw new Error("bearish targets must be below entry_low");
    }
    if (payload.confirmation !== undefined && payload.confirmation >= payload.entryLow) {
      throw new Error("bearish confirmation must be below entry_low");
    }
  }

  // Neutral scenarios intentionally allow levels on either side of the entry zone.

  let stale = false;
  const warnings: string[] = [];
  if (payload.expiresAt) {
    const expiresAt = new Date(payload.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) throw new Error("expires_at must be a valid ISO-8601 timestamp");
    if (expiresAt <= analyzedAt) throw new Error("expires_at must be later than analyzed_at");
    stale = expiresAt <= now;
    if (stale) warnings.push("analysis has expired; the overlay will be rendered in the expired state");
  }
  return { stale, warnings };
}

export function buildAnalysisOverlayInputs(payload: AnalysisOverlayPayload) {
  const targets = [...payload.targets, 0, 0, 0];
  const values: Record<(typeof ANALYSIS_OVERLAY_INPUTS)[number]["key"], string | number> = {
    analysisId: payload.analysisId,
    // Pine input.time values use Unix epoch milliseconds, matching Date.getTime().
    analyzedAt: new Date(payload.analyzedAt).getTime(),
    bias: payload.bias,
    entryLow: payload.entryLow,
    entryHigh: payload.entryHigh,
    confirmation: payload.confirmation ?? 0,
    invalidation: payload.invalidation,
    stop: payload.stop,
    target1: targets[0],
    target2: targets[1],
    target3: targets[2],
    confidence: payload.confidence,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt).getTime() : 0,
    note: payload.note ?? "",
  };
  return ANALYSIS_OVERLAY_INPUTS.map((input) => ({ id: input.id, value: values[input.key] }));
}
