import { newYorkCivilTimeToIso } from "./cot.js";

const MINUTE_MS = 60_000;

export type AggregatedBar = {
  timeIso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Upstream tick count, not traded size. Summed across the minutes present in the bucket. */
  tickVolume: number;
  /** Source minutes that fell in this bucket, out of bucketMinutes. */
  minutesPresent: number;
};

export type FxCsvM1AggregationQuality = {
  rowsRead: number;
  rowsBeforeStart: number;
  rowsMalformed: number;
  duplicateTimestampsDropped: number;
  conflictingDuplicateTimestamps: number;
  /**
   * Rows whose timestamp went backwards. A file that repeats a whole month elsewhere in the stream
   * arrives here rather than as an adjacent duplicate, so the span is reported: a range confined to
   * a known repeated period is a repeat, while a wider one would mean real rows are being refused.
   */
  outOfOrderRows: number;
  outOfOrderRange: { from: string; to: string } | null;
  bucketsBelowMinimumCoverage: number;
  /**
   * Buckets discarded because a repeated minute disagreed with the one already folded in. Counting a
   * conflict while keeping whichever copy arrived first would decide a source disagreement by file
   * order, so the whole bucket goes: a gap is handled downstream, an arbitrated price is not.
   */
  bucketsDroppedForConflictingDuplicates: number;
};

export type FxCsvM1AggregationResult = {
  schemaVersion: "1.0";
  methodologyVersion: "fx_csv_m1_aggregation_v2";
  evidenceTier: "official_revised_history";
  brokerClockRule: "new_york_wall_time_plus_seven_hours";
  bucketMinutes: number;
  minimumMinuteCoverage: number;
  startFromBrokerDate: string;
  bars: AggregatedBar[];
  quality: FxCsvM1AggregationQuality;
  qualityIssues: string[];
};

export interface FxCsvM1AggregationInput {
  /** `YYYY.MM.DD HH:MM,open,high,low,close,volume` rows, no header. */
  lines: Iterable<string>;
  bucketMinutes: number;
  /**
   * Broker calendar date before which rows are refused. Every file in this vendor family switched
   * its clock convention mid-history, and not on the same date or from the same one: the five FX
   * pairs ran on fixed Tokyo time until the weekend of 2015-06-27 and on New York plus seven after,
   * while gold ran on a fixed UTC+2 until late 2018. A start boundary is therefore required rather
   * than defaulted, and cannot be forgotten into a silent multi-hour shift. Verify each new file
   * before choosing one; the rule below is asserted, not detected.
   */
  startFromBrokerDate: string;
  /** Minutes that must be present in a bucket for it to be emitted. */
  minimumMinuteCoverage: number;
}

const ROW = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}),([\d.]+),([\d.]+),([\d.]+),([\d.]+),(\d+)$/;

/**
 * The row pattern accepts any two digits per field, and Date.UTC would roll 2024.02.30 forward to
 * March rather than reject it, placing a bar at a time the source never named. Existence is checked
 * against the calendar instead of left to that normalization.
 */
function isRealBrokerMinute(year: number, month: number, day: number, hour: number, minute: number): boolean {
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Broker wall clock to UTC. The clock tracks New York, not Europe: Friday's last traded minute
 * stays at 23:49 broker time through the weeks when US daylight saving is active and European is
 * not, which an EET clock would have shifted by an hour.
 */
export function brokerWallTimeToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const newYorkWall = Date.UTC(year, month - 1, day, hour, minute) - 7 * 60 * MINUTE_MS;
  const wall = new Date(newYorkWall);
  return new Date(newYorkCivilTimeToIso(
    wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(),
  )).getTime();
}

function validate(input: FxCsvM1AggregationInput) {
  if (!Number.isInteger(input.bucketMinutes) || input.bucketMinutes < 2 || input.bucketMinutes > 1440 ||
      1440 % input.bucketMinutes !== 0) {
    throw new Error("bucket minutes must divide a day evenly and be an integer from 2 to 1440");
  }
  if (!Number.isInteger(input.minimumMinuteCoverage) || input.minimumMinuteCoverage < 1 ||
      input.minimumMinuteCoverage > input.bucketMinutes) {
    throw new Error("minimum minute coverage must be an integer from one to the bucket length");
  }
  const start = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(input.startFromBrokerDate);
  if (start === null || !isRealBrokerMinute(Number(start[1]), Number(start[2]), Number(start[3]), 0, 0)) {
    throw new Error("start_from_broker_date must be a YYYY.MM.DD broker calendar date");
  }
}

export function aggregateFxCsvM1(input: FxCsvM1AggregationInput): FxCsvM1AggregationResult {
  validate(input);
  const bucketMs = input.bucketMinutes * MINUTE_MS;
  const quality: FxCsvM1AggregationQuality = {
    rowsRead: 0, rowsBeforeStart: 0, rowsMalformed: 0, duplicateTimestampsDropped: 0,
    conflictingDuplicateTimestamps: 0, outOfOrderRows: 0, outOfOrderRange: null, bucketsBelowMinimumCoverage: 0,
    bucketsDroppedForConflictingDuplicates: 0,
  };
  const bars: AggregatedBar[] = [];
  let current: (AggregatedBar & { bucketStartMs: number; conflicted: boolean }) | null = null;
  let previousMinuteMs = -Infinity;
  let previousRow: string | null = null;

  const flush = () => {
    if (current === null) return;
    const { bucketStartMs, conflicted, ...bar } = current;
    void bucketStartMs;
    if (conflicted) quality.bucketsDroppedForConflictingDuplicates += 1;
    else if (bar.minutesPresent < input.minimumMinuteCoverage) quality.bucketsBelowMinimumCoverage += 1;
    else bars.push(bar);
    current = null;
  };

  for (const line of input.lines) {
    const row = line.trim();
    if (row === "") continue;
    quality.rowsRead += 1;
    const match = ROW.exec(row);
    if (match === null) { quality.rowsMalformed += 1; continue; }
    const [, y, mo, d, h, mi, o, hi, lo, c, v] = match;
    if (`${y}.${mo}.${d}` < input.startFromBrokerDate) { quality.rowsBeforeStart += 1; continue; }
    if (!isRealBrokerMinute(Number(y), Number(mo), Number(d), Number(h), Number(mi))) {
      quality.rowsMalformed += 1;
      continue;
    }
    const minuteMs = brokerWallTimeToUtcMs(Number(y), Number(mo), Number(d), Number(h), Number(mi));
    if (minuteMs === previousMinuteMs) {
      // These files repeat whole months. An identical repeat is dropped; a repeat that disagrees is
      // a source conflict, and the bucket already holding the first copy is discarded at flush so
      // that file order never decides which price wins.
      if (previousRow !== row) {
        quality.conflictingDuplicateTimestamps += 1;
        if (current !== null) current.conflicted = true;
      }
      quality.duplicateTimestampsDropped += 1;
      continue;
    }
    if (minuteMs < previousMinuteMs) {
      quality.outOfOrderRows += 1;
      const iso = new Date(minuteMs).toISOString();
      quality.outOfOrderRange = quality.outOfOrderRange === null
        ? { from: iso, to: iso }
        : { from: iso < quality.outOfOrderRange.from ? iso : quality.outOfOrderRange.from,
            to: iso > quality.outOfOrderRange.to ? iso : quality.outOfOrderRange.to };
      continue;
    }
    const open = Number(o), high = Number(hi), low = Number(lo), close = Number(c), volume = Number(v);
    // A long enough run of digits parses to Infinity, which satisfies every ordering comparison below
    // and would reach the output as a null price, so finiteness is checked before consistency.
    if (![open, high, low, close, volume].every(Number.isFinite) ||
        !(low <= Math.min(open, close) && high >= Math.max(open, close) && high >= low && high > 0)) {
      quality.rowsMalformed += 1;
      continue;
    }
    // Only an accepted row advances the position. Advancing on a rejected one would make the next
    // row at the same minute - the correction for it - look like a duplicate and be dropped too.
    previousMinuteMs = minuteMs;
    previousRow = row;
    // Absolute UTC bucketing. A weekend leaves its buckets empty rather than joining Friday to
    // Monday, because a bucket is a fixed wall-clock slot and never a run of consecutive rows.
    const bucketStartMs = Math.floor(minuteMs / bucketMs) * bucketMs;
    if (current === null || current.bucketStartMs !== bucketStartMs) {
      flush();
      current = {
        bucketStartMs, timeIso: new Date(bucketStartMs).toISOString(),
        open, high, low, close, tickVolume: volume, minutesPresent: 1, conflicted: false,
      };
      continue;
    }
    current.high = Math.max(current.high, high);
    current.low = Math.min(current.low, low);
    current.close = close;
    current.tickVolume += volume;
    current.minutesPresent += 1;
  }
  flush();

  const qualityIssues = [
    ...(quality.rowsMalformed > 0 ? ["one_or_more_source_rows_were_unusable"] : []),
    ...(quality.conflictingDuplicateTimestamps > 0 ? ["one_or_more_duplicate_timestamps_disagreed"] : []),
    ...(quality.bucketsDroppedForConflictingDuplicates > 0 ? ["one_or_more_buckets_dropped_for_conflicting_duplicates"] : []),
    ...(quality.outOfOrderRows > 0 ? ["one_or_more_source_rows_were_out_of_order"] : []),
    ...(bars.length === 0 ? ["no_bars_met_minimum_minute_coverage"] : []),
  ];
  return {
    schemaVersion: "1.0",
    methodologyVersion: "fx_csv_m1_aggregation_v2",
    evidenceTier: "official_revised_history",
    brokerClockRule: "new_york_wall_time_plus_seven_hours",
    bucketMinutes: input.bucketMinutes,
    minimumMinuteCoverage: input.minimumMinuteCoverage,
    startFromBrokerDate: input.startFromBrokerDate,
    bars,
    quality,
    qualityIssues,
  };
}
