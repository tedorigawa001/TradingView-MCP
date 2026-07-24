import type { OhlcvBar } from "./tradingview.js";

export const OUTSIDE_DEFINED_SESSIONS_ID = "outside_defined_sessions";

export interface SessionProfileDefinition {
  sessionId: string;
  timezone: string;
  start: string;
  end: string;
  minimumCoverage: number;
}

export type SessionClockDefinition = Omit<SessionProfileDefinition, "minimumCoverage">;

export interface SessionClockMatch {
  sessionId: string;
  timezone: string;
  sessionDate: string;
  minutesFromStart: number;
}

export interface SessionProfileInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  sessions: SessionProfileDefinition[];
  openingRangeBars: number;
  minimumSessionDays: number;
  observationLimit: number;
}

type LocalBar = OhlcvBar & {
  localDate: string;
  localMinute: number;
  minutesFromStart: number;
};

type SessionObservation = {
  sessionId: string;
  timezone: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  bars: number;
  expectedBars: number;
  coverage: number;
  complete: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  range: number;
  return: number;
  openingRange: number | null;
  extensionFromOpeningRange: number | null;
  highMinutesFromStart: number;
  lowMinutesFromStart: number;
  tickVolume: number | null;
  volumeCoverage: number;
  vwap: number | null;
  vwapDistanceRatio: number | null;
  previousClosedSessionId: string | null;
  previousHigh: number | null;
  previousLow: number | null;
  previousClose: number | null;
  gapFromPreviousClose: number | null;
  previousRangeOverlapRatio: number | null;
  testedPreviousHigh: boolean | null;
  testedPreviousLow: boolean | null;
  brokePreviousHigh: boolean | null;
  brokePreviousLow: boolean | null;
  failedPreviousHighBreak: boolean | null;
  failedPreviousLowBreak: boolean | null;
  holidayOrEarlyCloseDetected: boolean;
  firstTimeMs: number;
  lastCloseAvailableMs: number;
};

function clockMinute(value: string, label: string): number {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`${label} must use HH:MM`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function timeframeMinutes(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("session profile requires a minute-based timeframe");
  return Number(value);
}

function formatter(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
  } catch {
    throw new Error(`invalid IANA timezone: ${timezone}`);
  }
}

function shiftDate(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new Error(`invalid local session date: ${date}`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

export function validateSessionClockDefinitions(sessions: SessionClockDefinition[]): void {
  if (sessions.length < 1 || sessions.length > 8 ||
      new Set(sessions.map((session) => session.sessionId)).size !== sessions.length) {
    throw new Error("sessions must contain one to eight unique session ids");
  }
  for (const session of sessions) {
    if (!/^[\w.:-]{1,80}$/.test(session.sessionId)) throw new Error("invalid session id");
    if (session.sessionId === OUTSIDE_DEFINED_SESSIONS_ID) throw new Error("reserved session id");
    const startMinute = clockMinute(session.start, `${session.sessionId}.start`);
    const endMinute = clockMinute(session.end, `${session.sessionId}.end`);
    if (startMinute === endMinute) throw new Error("session start and end must differ");
    formatter(session.timezone);
  }
}

export function classifyTimestampSessions(
  timestampMs: number,
  sessions: SessionClockDefinition[],
): SessionClockMatch[] {
  return createSessionClockClassifier(sessions)(timestampMs);
}

export function createSessionClockClassifier(sessions: SessionClockDefinition[]) {
  validateSessionClockDefinitions(sessions);
  const prepared = sessions.map((session) => ({
    ...session,
    startMinute: clockMinute(session.start, `${session.sessionId}.start`),
    endMinute: clockMinute(session.end, `${session.sessionId}.end`),
    dateFormatter: formatter(session.timezone),
  }));
  return (timestampMs: number): SessionClockMatch[] => {
    if (!Number.isFinite(timestampMs)) throw new Error("session timestamp must be finite");
    return prepared.flatMap((session) => {
      const { startMinute, endMinute } = session;
      const parts = Object.fromEntries(session.dateFormatter.formatToParts(new Date(timestampMs))
        .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
      const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
      const crossMidnight = startMinute >= endMinute;
      const included = crossMidnight
        ? localMinute >= startMinute || localMinute < endMinute
        : localMinute >= startMinute && localMinute < endMinute;
      if (!included) return [];
      const localDate = `${parts.year}-${parts.month}-${parts.day}`;
      const sessionDate = crossMidnight && localMinute < endMinute ? shiftDate(localDate, -1) : localDate;
      if (!isWeekday(sessionDate)) return [];
      return [{
        sessionId: session.sessionId,
        timezone: session.timezone,
        sessionDate,
        minutesFromStart: localMinute >= startMinute
          ? localMinute - startMinute
          : 1_440 - startMinute + localMinute,
      }];
    });
  };
}

function percentile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function stats(values: number[]) {
  return {
    count: values.length,
    mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(values, 0.5),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    minimum: values.length === 0 ? null : Math.min(...values),
    maximum: values.length === 0 ? null : Math.max(...values),
  };
}

function validateBars(bars: OhlcvBar[]): OhlcvBar[] {
  if (bars.length < 3) throw new Error("session profile requires at least three OHLC bars");
  const ordered = [...bars].sort((left, right) => left.time - right.time);
  if (ordered.some((bar, index) => index > 0 && bar.time === ordered[index - 1].time)) {
    throw new Error("OHLC bars contain duplicate timestamps");
  }
  if (ordered.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) || !Number.isFinite(bar.close) || bar.close <= 0 ||
      bar.low > bar.high || bar.open < bar.low || bar.open > bar.high ||
      bar.close < bar.low || bar.close > bar.high)) {
    throw new Error("OHLC bars contain invalid values");
  }
  return ordered;
}

function localize(bar: OhlcvBar, timezone: string, startMinute: number, endMinute: number): LocalBar | null {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(new Date(bar.time * 1_000))
    .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
  const crossMidnight = startMinute >= endMinute;
  const included = crossMidnight
    ? localMinute >= startMinute || localMinute < endMinute
    : localMinute >= startMinute && localMinute < endMinute;
  if (!included) return null;
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const sessionDate = crossMidnight && localMinute < endMinute ? shiftDate(localDate, -1) : localDate;
  return {
    ...bar,
    localDate: sessionDate,
    localMinute,
    minutesFromStart: localMinute >= startMinute ? localMinute - startMinute : 1_440 - startMinute + localMinute,
  };
}

function summarizeSession(rows: SessionObservation[]) {
  const complete = rows.filter((row) => row.complete);
  return {
    sessionDays: rows.length,
    completeSessionDays: complete.length,
    incompleteSessionDays: rows.length - complete.length,
    coverage: stats(rows.map((row) => row.coverage)),
    range: stats(complete.map((row) => row.range)),
    return: stats(complete.map((row) => row.return)),
    positiveReturnRate: complete.length === 0 ? null : complete.filter((row) => row.return > 0).length / complete.length,
    openingRange: stats(complete.map((row) => row.openingRange).filter((value): value is number => value !== null)),
    extensionFromOpeningRange: stats(complete.map((row) => row.extensionFromOpeningRange)
      .filter((value): value is number => value !== null)),
    highMinutesFromStart: stats(complete.map((row) => row.highMinutesFromStart)),
    lowMinutesFromStart: stats(complete.map((row) => row.lowMinutesFromStart)),
    tickVolume: stats(complete.map((row) => row.tickVolume).filter((value): value is number => value !== null)),
    volumeCoverage: stats(complete.map((row) => row.volumeCoverage)),
    vwapDistanceRatio: stats(complete.map((row) => row.vwapDistanceRatio).filter((value): value is number => value !== null)),
    gapFromPreviousClose: stats(complete.map((row) => row.gapFromPreviousClose)
      .filter((value): value is number => value !== null)),
    previousRangeOverlapRatio: stats(complete.map((row) => row.previousRangeOverlapRatio)
      .filter((value): value is number => value !== null)),
    testedPreviousHighRate: complete.filter((row) => row.testedPreviousHigh !== null).length === 0 ? null
      : complete.filter((row) => row.testedPreviousHigh === true).length / complete.filter((row) => row.testedPreviousHigh !== null).length,
    testedPreviousLowRate: complete.filter((row) => row.testedPreviousLow !== null).length === 0 ? null
      : complete.filter((row) => row.testedPreviousLow === true).length / complete.filter((row) => row.testedPreviousLow !== null).length,
    failedPreviousHighBreakRate: complete.filter((row) => row.failedPreviousHighBreak !== null).length === 0 ? null
      : complete.filter((row) => row.failedPreviousHighBreak === true).length / complete.filter((row) => row.failedPreviousHighBreak !== null).length,
    failedPreviousLowBreakRate: complete.filter((row) => row.failedPreviousLowBreak !== null).length === 0 ? null
      : complete.filter((row) => row.failedPreviousLowBreak === true).length / complete.filter((row) => row.failedPreviousLowBreak !== null).length,
  };
}

export function computeSessionProfile(input: SessionProfileInput) {
  const timeframe = timeframeMinutes(input.timeframe);
  const timeframeMs = timeframe * 60_000;
  if (!Number.isInteger(input.openingRangeBars) || input.openingRangeBars < 1 || input.openingRangeBars > 100) {
    throw new Error("invalid opening range bars");
  }
  if (!Number.isInteger(input.minimumSessionDays) || input.minimumSessionDays < 1 || input.minimumSessionDays > 5_000) {
    throw new Error("invalid minimum session days");
  }
  if (!Number.isInteger(input.observationLimit) || input.observationLimit < 0 || input.observationLimit > 500) {
    throw new Error("invalid observation limit");
  }
  validateSessionClockDefinitions(input.sessions);
  const barsAll = validateBars(input.bars);
  const formingBarsExcluded = barsAll.filter((bar) => bar.forming === true).length;
  const bars = barsAll.filter((bar) => bar.forming !== true);
  const rows: SessionObservation[] = [];

  for (const session of input.sessions) {
    if (!(session.minimumCoverage > 0 && session.minimumCoverage <= 1)) throw new Error("invalid minimum session coverage");
    const startMinute = clockMinute(session.start, `${session.sessionId}.start`);
    const endMinute = clockMinute(session.end, `${session.sessionId}.end`);
    const durationMinutes = startMinute < endMinute ? endMinute - startMinute : 1_440 - startMinute + endMinute;
    const expectedBars = Math.ceil(durationMinutes / timeframe);
    const grouped = new Map<string, LocalBar[]>();
    for (const bar of bars) {
      const localized = localize(bar, session.timezone, startMinute, endMinute);
      if (!localized || !isWeekday(localized.localDate)) continue;
      const group = grouped.get(localized.localDate) ?? [];
      group.push(localized);
      grouped.set(localized.localDate, group);
    }
    for (const [sessionDate, groupUnsorted] of grouped) {
      const group = [...groupUnsorted].sort((left, right) => left.time - right.time);
      const high = Math.max(...group.map((bar) => bar.high));
      const low = Math.min(...group.map((bar) => bar.low));
      const range = high - low;
      const coverage = Math.min(1, group.length / expectedBars);
      const opening = group.slice(0, input.openingRangeBars);
      const openingRange = opening.length === input.openingRangeBars
        ? Math.max(...opening.map((bar) => bar.high)) - Math.min(...opening.map((bar) => bar.low)) : null;
      const highBar = group.find((bar) => bar.high === high)!;
      const lowBar = group.find((bar) => bar.low === low)!;
      const volumeValues = group.map((bar) => bar.volume).filter((value): value is number => value !== null);

      let vwap: number | null = null;
      let vwapDistanceRatio: number | null = null;
      if (volumeValues.length === group.length && volumeValues.length > 0) {
        const sumVol = volumeValues.reduce((sum, v) => sum + v, 0);
        if (sumVol > 0) {
          const sumPv = group.reduce((sum, bar) => {
            const tp = (bar.high + bar.low + bar.close) / 3;
            return sum + tp * (bar.volume ?? 0);
          }, 0);
          vwap = sumPv / sumVol;
          vwapDistanceRatio = group.at(-1)!.close / vwap - 1;
        }
      }

      rows.push({
        sessionId: session.sessionId,
        timezone: session.timezone,
        sessionDate,
        startTime: group[0].timeIso,
        endTime: group.at(-1)!.timeIso,
        bars: group.length,
        expectedBars,
        coverage,
        complete: coverage >= session.minimumCoverage,
        open: group[0].open,
        high,
        low,
        close: group.at(-1)!.close,
        range,
        return: group.at(-1)!.close / group[0].open - 1,
        openingRange,
        extensionFromOpeningRange: openingRange === null || openingRange === 0 ? null : range / openingRange - 1,
        highMinutesFromStart: highBar.minutesFromStart,
        lowMinutesFromStart: lowBar.minutesFromStart,
        tickVolume: volumeValues.length === group.length ? volumeValues.reduce((sum, value) => sum + value, 0) : null,
        volumeCoverage: volumeValues.length / group.length,
        vwap,
        vwapDistanceRatio,
        previousClosedSessionId: null,
        previousHigh: null,
        previousLow: null,
        previousClose: null,
        gapFromPreviousClose: null,
        previousRangeOverlapRatio: null,
        testedPreviousHigh: null,
        testedPreviousLow: null,
        brokePreviousHigh: null,
        brokePreviousLow: null,
        failedPreviousHighBreak: null,
        failedPreviousLowBreak: null,
        holidayOrEarlyCloseDetected: coverage < 0.5,
        firstTimeMs: group[0].time * 1_000,
        lastCloseAvailableMs: group.at(-1)!.time * 1_000 + timeframeMs,
      });
    }
  }

  rows.sort((left, right) => left.firstTimeMs - right.firstTimeMs || left.sessionId.localeCompare(right.sessionId));
  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index];
    const previous = rows.slice(0, index)
      .filter((row) => row.complete && row.lastCloseAvailableMs <= current.firstTimeMs)
      .sort((left, right) => left.lastCloseAvailableMs - right.lastCloseAvailableMs).at(-1);
    if (!previous) continue;
    const overlap = Math.max(0, Math.min(current.high, previous.high) - Math.max(current.low, previous.low));
    const denominator = Math.min(current.range, previous.range);
    current.previousClosedSessionId = previous.sessionId;
    current.previousHigh = previous.high;
    current.previousLow = previous.low;
    current.previousClose = previous.close;
    current.gapFromPreviousClose = current.open / previous.close - 1;
    current.previousRangeOverlapRatio = denominator === 0 ? null : overlap / denominator;

    current.testedPreviousHigh = current.high >= previous.high;
    current.testedPreviousLow = current.low <= previous.low;
    current.brokePreviousHigh = current.close > previous.high;
    current.brokePreviousLow = current.close < previous.low;
    current.failedPreviousHighBreak = current.high >= previous.high && current.close < previous.high;
    current.failedPreviousLowBreak = current.low <= previous.low && current.close > previous.low;
  }

  const bySession = Object.fromEntries(input.sessions.map((session) => {
    const selected = rows.filter((row) => row.sessionId === session.sessionId);
    return [session.sessionId, { definition: session, ...summarizeSession(selected) }];
  }));
  const incompleteSessionDays = rows.filter((row) => !row.complete).length;
  const holidayOrEarlyCloseDays = rows.filter((row) => row.holidayOrEarlyCloseDetected).length;
  const irregularIntervals = bars.slice(1).filter((bar, index) => bar.time * 1_000 - bars[index].time * 1_000 > timeframeMs * 1.5).length;
  const qualityIssues = [
    ...input.sessions.filter((session) => rows.filter((row) => row.sessionId === session.sessionId && row.complete).length < input.minimumSessionDays)
      .map((session) => `minimum_session_days_not_met:${session.sessionId}`),
    ...(incompleteSessionDays > 0 ? ["one_or_more_sessions_have_incomplete_coverage"] : []),
    ...(irregularIntervals > 0 ? ["irregular_timestamps_not_forward_filled"] : []),
  ];
  const returned = input.observationLimit === 0 ? [] : rows.slice(-input.observationLimit);
  return {
    schemaVersion: "1.1" as const,
    methodologyVersion: "session_profile_v2" as const,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    volumeKind: "tradingview_bar_volume_unverified_tick_or_exchange_volume" as const,
    openingRangeBars: input.openingRangeBars,
    sample: { barsReceived: input.bars.length, closedBars: bars.length, sessionObservations: rows.length },
    quality: { formingBarsExcluded, incompleteSessionDays, holidayOrEarlyCloseDays, irregularIntervals },
    qualityIssues,
    bySession,
    observations: returned.map(({ firstTimeMs: _first, lastCloseAvailableMs: _last, ...row }) => row),
    observationsReturned: returned.length,
    observationsTruncated: rows.length > returned.length,
  };
}
