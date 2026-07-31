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
};

export type FxCsvM1AggregationResult = {
  schemaVersion: "1.0";
  methodologyVersion: "fx_csv_m1_aggregation_v1";
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
   * Broker calendar date before which rows are refused. This file switched its clock convention
   * during 2015 - 2012-2014 runs on Tokyo time and 2016 onward on New York plus seven - so a start
   * boundary is required rather than defaulted, and cannot be forgotten into a silent 7-hour shift.
   */
  startFromBrokerDate: string;
  /** Minutes that must be present in a bucket for it to be emitted. */
  minimumMinuteCoverage: number;
}

const ROW = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}),([\d.]+),([\d.]+),([\d.]+),([\d.]+),(\d+)$/;

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
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(input.startFromBrokerDate)) {
    throw new Error("start_from_broker_date must be a YYYY.MM.DD broker calendar date");
  }
}

export function aggregateFxCsvM1(input: FxCsvM1AggregationInput): FxCsvM1AggregationResult {
  validate(input);
  const bucketMs = input.bucketMinutes * MINUTE_MS;
  const quality: FxCsvM1AggregationQuality = {
    rowsRead: 0, rowsBeforeStart: 0, rowsMalformed: 0, duplicateTimestampsDropped: 0,
    conflictingDuplicateTimestamps: 0, outOfOrderRows: 0, outOfOrderRange: null, bucketsBelowMinimumCoverage: 0,
  };
  const bars: AggregatedBar[] = [];
  let current: (AggregatedBar & { bucketStartMs: number }) | null = null;
  let previousMinuteMs = -Infinity;
  let previousRow: string | null = null;

  const flush = () => {
    if (current === null) return;
    const { bucketStartMs, ...bar } = current;
    void bucketStartMs;
    if (bar.minutesPresent < input.minimumMinuteCoverage) quality.bucketsBelowMinimumCoverage += 1;
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
    const minuteMs = brokerWallTimeToUtcMs(Number(y), Number(mo), Number(d), Number(h), Number(mi));
    if (minuteMs === previousMinuteMs) {
      // The supplied file duplicates two whole months byte for byte. Identical repeats are dropped;
      // a repeat that disagrees is a source conflict and is counted rather than silently resolved.
      if (previousRow !== row) quality.conflictingDuplicateTimestamps += 1;
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
    previousMinuteMs = minuteMs;
    previousRow = row;
    const open = Number(o), high = Number(hi), low = Number(lo), close = Number(c);
    if (!(low <= Math.min(open, close) && high >= Math.max(open, close) && high >= low && high > 0)) {
      quality.rowsMalformed += 1;
      continue;
    }
    // Absolute UTC bucketing. A weekend leaves its buckets empty rather than joining Friday to
    // Monday, because a bucket is a fixed wall-clock slot and never a run of consecutive rows.
    const bucketStartMs = Math.floor(minuteMs / bucketMs) * bucketMs;
    if (current === null || current.bucketStartMs !== bucketStartMs) {
      flush();
      current = {
        bucketStartMs, timeIso: new Date(bucketStartMs).toISOString(),
        open, high, low, close, tickVolume: Number(v), minutesPresent: 1,
      };
      continue;
    }
    current.high = Math.max(current.high, high);
    current.low = Math.min(current.low, low);
    current.close = close;
    current.tickVolume += Number(v);
    current.minutesPresent += 1;
  }
  flush();

  const qualityIssues = [
    ...(quality.rowsMalformed > 0 ? ["one_or_more_source_rows_were_unusable"] : []),
    ...(quality.conflictingDuplicateTimestamps > 0 ? ["one_or_more_duplicate_timestamps_disagreed"] : []),
    ...(quality.outOfOrderRows > 0 ? ["one_or_more_source_rows_were_out_of_order"] : []),
    ...(bars.length === 0 ? ["no_bars_met_minimum_minute_coverage"] : []),
  ];
  return {
    schemaVersion: "1.0",
    methodologyVersion: "fx_csv_m1_aggregation_v1",
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
