import type { IndicatorInputs, IndicatorValues } from "./tradingview.js";

export const VOLUME_PROFILE_CONTEXT_NAME = "Bushido Volume Profile Context";
export const VOLUME_PROFILE_CONTEXT_VERSION = "2.0";

export const VOLUME_PROFILE_CONTEXT_INPUTS = [
  { id: "in_0", name: "Rows" },
  { id: "in_1", name: "Value Area %" },
  { id: "in_2", name: "Volume Type" },
  { id: "in_3", name: "Maximum Session Bars" },
] as const;

export const VOLUME_PROFILE_CONTEXT_PLOTS = [
  "Prior POC",
  "Prior VAH",
  "Prior VAL",
  "Profile Start",
  "Profile End",
  "Trading Day",
  "Profile Complete",
  "Bars Included",
] as const;

export type VolumeType = "unknown" | "provider_tick_volume" | "exchange_reported_volume";

export interface VolumeProfileContext {
  status: "ready" | "unavailable";
  levels: { poc: number; vah: number; val: number } | null;
  profile: {
    start: string;
    end: string;
    tradingDay: string;
    rows: number;
    valueAreaPercent: number;
    barsIncluded: number;
  } | null;
  volumeType: VolumeType;
  qualityIssues: string[];
}

// The logical template version is intentionally independent from TradingView's saved Pine version.
// The desktop Pine compiler used by this project does not expose volume.profile_session. This
// deliberately transparent fallback distributes each completed chart bar's volume equally over
// the price rows it spans. It is a chart-bar proxy, not TradingView's native lower-timeframe VP.
export const VOLUME_PROFILE_CONTEXT_SOURCE = `//@version=6
indicator("${VOLUME_PROFILE_CONTEXT_NAME}", overlay = true)

rows = input.int(24, "Rows", minval = 4, maxval = 200)
valueAreaPercent = input.int(70, "Value Area %", minval = 1, maxval = 100)
volumeType = input.string("unknown", "Volume Type", options = ["unknown", "provider_tick_volume", "exchange_reported_volume"])
maximumSessionBars = input.int(500, "Maximum Session Bars", minval = 10, maxval = 1000)

var array<float> sessionHighs = array.new_float()
var array<float> sessionLows = array.new_float()
var array<float> sessionVolumes = array.new_float()
var int activeProfileStart = na
var bool activeProfileTruncated = false
var float priorPoc = na
var float priorVah = na
var float priorVal = na
var int priorProfileStart = na
var int priorProfileEnd = na
var int priorTradingDay = na
var bool priorProfileComplete = false
var int priorBarsIncluded = na

newTradingDay = na(time_tradingday[1]) or time_tradingday != time_tradingday[1]
if newTradingDay
    if array.size(sessionHighs) > 0
        priorProfileComplete := not activeProfileTruncated
        priorBarsIncluded := array.size(sessionHighs)
        if priorProfileComplete
            profileLow = array.min(sessionLows)
            profileHigh = array.max(sessionHighs)
            rowHeight = (profileHigh - profileLow) / rows
            if rowHeight > 0
                bins = array.new_float(rows, 0.0)
                totalVolume = 0.0
                for barIndex = 0 to array.size(sessionHighs) - 1
                    barLow = array.get(sessionLows, barIndex)
                    barHigh = array.get(sessionHighs, barIndex)
                    barVolume = array.get(sessionVolumes, barIndex)
                    firstRow = math.max(0, math.min(rows - 1, int(math.floor((barLow - profileLow) / rowHeight))))
                    lastRow = math.max(0, math.min(rows - 1, int(math.floor((barHigh - profileLow) / rowHeight))))
                    rowCount = lastRow - firstRow + 1
                    allocation = barVolume / rowCount
                    for row = firstRow to lastRow
                        array.set(bins, row, array.get(bins, row) + allocation)
                    totalVolume += barVolume
                pocRow = 0
                for row = 1 to rows - 1
                    if array.get(bins, row) > array.get(bins, pocRow)
                        pocRow := row
                lowerRow = pocRow
                upperRow = pocRow
                includedVolume = array.get(bins, pocRow)
                targetVolume = totalVolume * valueAreaPercent / 100.0
                while includedVolume < targetVolume and (lowerRow > 0 or upperRow < rows - 1)
                    lowerCandidate = lowerRow > 0 ? array.get(bins, lowerRow - 1) : -1.0
                    upperCandidate = upperRow < rows - 1 ? array.get(bins, upperRow + 1) : -1.0
                    if upperCandidate >= lowerCandidate
                        upperRow += 1
                        includedVolume += upperCandidate
                    else
                        lowerRow -= 1
                        includedVolume += lowerCandidate
                priorPoc := profileLow + (pocRow + 0.5) * rowHeight
                priorVah := profileLow + (upperRow + 1.0) * rowHeight
                priorVal := profileLow + lowerRow * rowHeight
            else
                priorProfileComplete := false
        if priorProfileComplete
            priorProfileStart := activeProfileStart
            priorProfileEnd := time
            priorTradingDay := time_tradingday[1]
        else
            priorPoc := na
            priorVah := na
            priorVal := na
            priorProfileStart := na
            priorProfileEnd := na
            priorTradingDay := na
        array.clear(sessionHighs)
        array.clear(sessionLows)
        array.clear(sessionVolumes)
    // The chart's first bar has nothing accumulated behind it, so the branch above does not run
    // and this is the only place that session's start is recorded. Keeping it inside that branch
    // left the first completed profile with an unset start, which the reader then reported as no
    // profile having completed at all - losing a day and naming the wrong reason for it.
    activeProfileStart := time
    activeProfileTruncated := false

if not na(volume) and volume > 0
    if array.size(sessionHighs) < maximumSessionBars
        array.push(sessionHighs, high)
        array.push(sessionLows, low)
        array.push(sessionVolumes, volume)
    else
        activeProfileTruncated := true

plot(priorPoc, "Prior POC", color = color.orange, style = plot.style_linebr)
plot(priorVah, "Prior VAH", color = color.aqua, style = plot.style_linebr)
plot(priorVal, "Prior VAL", color = color.aqua, style = plot.style_linebr)
plot(priorProfileStart, "Profile Start", display = display.data_window)
plot(priorProfileEnd, "Profile End", display = display.data_window)
plot(priorTradingDay, "Trading Day", display = display.data_window)
plot(priorProfileComplete ? 1 : 0, "Profile Complete", display = display.data_window)
plot(priorBarsIncluded, "Bars Included", display = display.data_window)
`;

export function assertVolumeProfileContextStudy(
  studies: IndicatorInputs[],
  studyId: string,
): IndicatorInputs {
  const study = studies.find((candidate) => candidate.id === studyId);
  if (!study) throw new Error(`study ${studyId} was not returned by get_indicator_inputs`);
  if (study.name !== VOLUME_PROFILE_CONTEXT_NAME) {
    throw new Error(`study ${studyId} is not ${VOLUME_PROFILE_CONTEXT_NAME}`);
  }
  for (const expected of VOLUME_PROFILE_CONTEXT_INPUTS) {
    const actual = study.inputs.find((input) => input.id === expected.id);
    if (!actual || actual.name !== expected.name) {
      throw new Error(
        `study ${studyId} does not match volume-profile input contract at ${expected.id} (${expected.name})`,
      );
    }
  }
  return study;
}

function finitePositive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number`);
  }
  return value;
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer Unix timestamp in milliseconds`);
  }
  // A safe positive integer is already a representable epoch millisecond, so the only check worth
  // making here is the one above. The comparison that used to sit here rebuilt the same Date and
  // compared it with itself, so it read as validation while testing nothing.
  return value;
}

function inputValue(study: IndicatorInputs, id: string): unknown {
  const input = study.inputs.find((candidate) => candidate.id === id);
  if (!input) throw new Error(`volume-profile input ${id} is missing`);
  return input.value;
}

export function parseVolumeProfileContext(
  study: IndicatorInputs,
  values: IndicatorValues[],
): VolumeProfileContext {
  const valueStudy = values.find((candidate) => candidate.id === study.id);
  if (!valueStudy || valueStudy.hasError || valueStudy.error) {
    throw new Error(`study ${study.id} did not return readable volume-profile plots`);
  }
  const row = valueStudy.bars.at(-1);
  if (!row) throw new Error(`study ${study.id} returned no volume-profile values`);
  const volumeType = inputValue(study, "in_2");
  if (volumeType !== "unknown" && volumeType !== "provider_tick_volume" && volumeType !== "exchange_reported_volume") {
    throw new Error("Volume Type must be one of the audited template options");
  }

  const raw = row.values;
  const complete = VOLUME_PROFILE_CONTEXT_PLOTS.every((plot) => raw[plot] !== null && raw[plot] !== undefined);
  const qualityIssues = volumeType === "unknown"
    ? ["volume_type_not_declared"]
    : volumeType === "provider_tick_volume"
      ? ["provider_tick_volume_not_consolidated_order_flow"]
      : [];
  if (!complete) {
    return { status: "unavailable", levels: null, profile: null, volumeType, qualityIssues: [...qualityIssues, "no_completed_session_profile"] };
  }

  if (raw["Profile Complete"] !== 1) {
    return { status: "unavailable", levels: null, profile: null, volumeType, qualityIssues: [...qualityIssues, "profile_is_incomplete_or_truncated"] };
  }

  const poc = finitePositive(raw["Prior POC"], "Prior POC");
  const vah = finitePositive(raw["Prior VAH"], "Prior VAH");
  const val = finitePositive(raw["Prior VAL"], "Prior VAL");
  if (val > poc || poc > vah) throw new Error("volume-profile levels must satisfy VAL <= POC <= VAH");
  const start = timestamp(raw["Profile Start"], "Profile Start");
  const end = timestamp(raw["Profile End"], "Profile End");
  const tradingDay = timestamp(raw["Trading Day"], "Trading Day");
  if (start >= end) throw new Error("volume-profile Profile Start must precede Profile End");
  const rows = finitePositive(inputValue(study, "in_0"), "Rows");
  const valueAreaPercent = finitePositive(inputValue(study, "in_1"), "Value Area %");
  const maximumSessionBars = finitePositive(inputValue(study, "in_3"), "Maximum Session Bars");
  if (!Number.isInteger(rows) || rows < 4 || rows > 200) throw new Error("Rows must be an integer in [4, 200]");
  if (!Number.isInteger(valueAreaPercent) || valueAreaPercent > 100) throw new Error("Value Area % must be an integer in [1, 100]");
  if (!Number.isInteger(maximumSessionBars) || maximumSessionBars < 10 || maximumSessionBars > 1000) {
    throw new Error("Maximum Session Bars must be an integer in [10, 1000]");
  }
  const barsIncluded = finitePositive(raw["Bars Included"], "Bars Included");
  if (!Number.isInteger(barsIncluded) || barsIncluded > maximumSessionBars) {
    throw new Error("Bars Included must be an integer no greater than Maximum Session Bars");
  }

  return {
    status: "ready",
    levels: { poc, vah, val },
    profile: {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      tradingDay: new Date(tradingDay).toISOString(),
      rows,
      valueAreaPercent,
      barsIncluded,
    },
    volumeType,
    qualityIssues,
  };
}
