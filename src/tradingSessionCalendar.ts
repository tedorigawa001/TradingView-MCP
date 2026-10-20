import { createHash } from "node:crypto";
import type { OhlcvBar, TradingSessionMetadata } from "./tradingview.js";
import { normalizeResolution } from "./analysisOverlay.js";
import { checkTimeZoneName, intlZoneResolver, wallTimeToUtc } from "./zonedTime.js";

const DAY = 86400_000, MINUTE = 60_000;
const MAX_DAYS = 8000, MAX_OPENS = 50_000, MAX_WINDOWS = 20_000;
type Range = { start: number; end: number };
type Window = { start: number; end: number; date: string };
type Closure = { start: number; end: number; reason: string };
const dateAt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dateMs = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const addDays = (date: string, n: number) => dateAt(dateMs(date) + n * DAY);
const weekday = (date: string) => new Date(dateMs(date)).getUTCDay() + 1;

export function assertTradingSessionBinding(metadata: TradingSessionMetadata, symbol: string, timeframe: string, chartIndex?: number) {
  if (metadata.symbol.toUpperCase() !== symbol.toUpperCase() || metadata.fullName?.toUpperCase() !== symbol.toUpperCase()
    || normalizeResolution(metadata.resolution) !== normalizeResolution(timeframe) || metadata.source !== "tradingview_symbol_info"
    || chartIndex !== undefined && metadata.chartIndex !== chartIndex) {
    throw new Error("trading session metadata does not match the bound symbol, timeframe and chart index");
  }
}

function calendarDate(raw: string) {
  if (!/^\d{8}$/.test(raw)) throw new Error("invalid_session_exception_date");
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (!Number.isFinite(dateMs(date)) || dateAt(dateMs(date)) !== date) throw new Error("invalid_session_exception_date");
  return date;
}

function ranges(text: string): Range[] {
  return text.split(",").map((part) => {
    const match = /^(\d{2})(\d{2})(?:F([1-6])?)?-(\d{2})(\d{2})(?:F([1-6])?)?$/.exec(part);
    if (!match) throw new Error("unsupported_session_format");
    const startHour = Number(match[1]), endHour = Number(match[4]);
    const startMinute = Number(match[2]), endMinute = Number(match[5]);
    if (startHour > 47 || endHour > 47 || startMinute > 59 || endMinute > 59) throw new Error("invalid_session_clock");
    const explicitStart = part.split("-")[0].includes("F"), explicitEnd = part.split("-")[1].includes("F");
    let start = startHour * 60 + startMinute - (explicitStart ? Number(match[3] ?? 1) * 1440 : 0);
    let end = endHour * 60 + endMinute - (explicitEnd ? Number(match[6] ?? 1) * 1440 : 0);
    if (!explicitStart && !explicitEnd && start >= end) {
      if (start === 0 && end === 0) end = 1440;
      else start -= 1440;
    }
    if (start >= end || end - start > 7 * 1440) throw new Error("invalid_session_range");
    return { start, end };
  });
}

function weeklySchedule(text: string) {
  if (text === "24x7") return { firstDay: 2, days: new Map(Array.from({ length: 7 }, (_, i) => [i + 1, [{ start: 0, end: 1440 }]])) };
  let firstDay = 2;
  if (/^[1-7];/.test(text)) { firstDay = Number(text[0]); text = text.slice(2); }
  else if (/;[1-7]$/.test(text)) { firstDay = Number(text.at(-1)); text = text.slice(0, -2); }
  if (text.length > 4096 || /[#/;]/.test(text)) throw new Error("unsupported_session_history_or_format");
  let defaults: Range[] | null = null;
  const days = new Map<number, Range[]>();
  for (const part of text.split("|")) {
    const match = /^(.*):([1-7]+)$/.exec(part);
    if (match) {
      if (new Set(match[2]).size !== match[2].length) throw new Error("ambiguous_session_weekdays");
      const value = ranges(match[1]);
      for (const day of match[2]) {
        if (days.has(Number(day))) throw new Error("ambiguous_session_weekdays");
        days.set(Number(day), value);
      }
    } else {
      if (defaults !== null) throw new Error("ambiguous_default_session");
      defaults = ranges(part);
    }
  }
  for (const day of [2, 3, 4, 5, 6]) if (!days.has(day)) days.set(day, defaults ?? []);
  return { firstDay, days };
}

function exceptionDates(holidays: string | null, corrections: string | null) {
  if ((holidays?.length ?? 0) > 65536 || (corrections?.length ?? 0) > 65536) throw new Error("session_exceptions_too_large");
  const closed = new Set<string>(), overrides = new Map<string, Range[]>();
  for (const day of holidays ? holidays.split(",") : []) {
    const date = calendarDate(day);
    if (closed.has(date)) throw new Error("duplicate_session_holiday");
    closed.add(date);
  }
  for (const entry of corrections ? corrections.split(";") : []) {
    const match = /^([^:|#;]+):(\d{8}(?:,\d{8})*)$/.exec(entry);
    if (!match) throw new Error("unsupported_session_correction");
    const value = ranges(match[1]);
    for (const raw of match[2].split(",")) {
      const date = calendarDate(raw);
      if (overrides.has(date)) throw new Error("duplicate_session_correction");
      overrides.set(date, value);
    }
  }
  if (closed.size + overrides.size > 4096) throw new Error("session_exceptions_too_large");
  return { closed, overrides };
}

function localInstant(zone: string, date: string, minutes: number) {
  const dayOffset = Math.floor(minutes / 1440), clock = minutes - dayOffset * 1440;
  const resolved = wallTimeToUtc(zone, addDays(date, dayOffset), Math.floor(clock / 60), clock % 60);
  if (resolved.kind !== "unique") throw new Error("ambiguous_or_nonexistent_session_boundary");
  return resolved.instant;
}

function windows(zone: string, date: string, value: Range[]): Window[] {
  return value.map((range) => ({ start: localInstant(zone, date, range.start), end: localInstant(zone, date, range.end), date }));
}

function removedWindows(base: Window[], actual: Window[], reason: string): Closure[] {
  return base.flatMap((window) => {
    let remaining = [{ start: window.start, end: window.end }];
    for (const active of actual) remaining = remaining.flatMap((part) => active.end <= part.start || active.start >= part.end ? [part]
      : [{ start: part.start, end: Math.min(part.end, active.start) }, { start: Math.max(part.start, active.end), end: part.end }].filter((p) => p.start < p.end));
    return remaining.map((part) => ({ ...part, reason }));
  });
}

/** A bound provider calendar is evidence about expected bars, not proof that a vendor never omits a holiday. */
export function classifyTradingSessionIntervals(metadata: TradingSessionMetadata | null | undefined, symbol: string, timeframe: string,
  bars: OhlcvBar[], gapLimitSeconds: number) {
  const tf = normalizeResolution(timeframe);
  const wallGaps = bars.map((bar, i) => i > 0 && bar.time - bars[i - 1].time > gapLimitSeconds);
  const unavailable = (reason: string) => ({ unsafeBefore: [...wallGaps], resetBefore: [...wallGaps],
    evidence: { status: "unavailable", reason, source: "tradingview_symbol_info", symbol,
      counts: { scheduled_closures: 0, missing_expected_bar_intervals: 0, unclassified_intervals: wallGaps.filter(Boolean).length },
      intervals: bars.flatMap((bar, i) => wallGaps[i] ? [{ from: bars[i - 1].timeIso, to: bar.timeIso, classification: "unclassified_gap" }] : []).slice(0, 50),
      intervals_omitted: Math.max(0, wallGaps.filter(Boolean).length - 50) } });
  if (!metadata) return unavailable("session_metadata_not_available");
  assertTradingSessionBinding(metadata, symbol, tf);
  try {
    if (!metadata.timezone || checkTimeZoneName(metadata.timezone) !== "ok" || !metadata.session) throw new Error("invalid_session_timezone_or_hours");
    if ([metadata.sessionHolidays, metadata.corrections, metadata.subsessionId].some((value) => value !== null && typeof value !== "string")
      || !Array.isArray(metadata.subsessions) || metadata.subsessions.length > 16) throw new Error("invalid_session_metadata_fields");
    if (metadata.subsessionId && metadata.subsessions.length > 0) {
      const selected = metadata.subsessions.filter((item) => item.id === metadata.subsessionId);
      if (selected.length !== 1 || selected[0].session !== metadata.session) throw new Error("session_subsession_mismatch");
    }
    const schedule = weeklySchedule(metadata.session);
    const exceptions = exceptionDates(metadata.sessionHolidays, metadata.corrections);
    const first = bars[0]?.time, last = bars.at(-1)?.time;
    if (first === undefined || last === undefined) return unavailable("no_native_bars_for_session_alignment");
    const from = dateAt(first * 1000 - 8 * DAY), to = dateAt(last * 1000 + 8 * DAY);
    if ((dateMs(to) - dateMs(from)) / DAY > MAX_DAYS) throw new Error("session_schedule_budget_exceeded");
    const active: Window[] = [], closures: Closure[] = [];
    const unresolvedDefaults: string[] = [];
    let expandedWindows = 0;
    const resolveWindows = (date: string, value: Range[]) => {
      if (expandedWindows + value.length > MAX_WINDOWS) throw new Error("session_schedule_budget_exceeded");
      expandedWindows += value.length;
      return windows(metadata.timezone!, date, value);
    };
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const regularRanges = schedule.days.get(weekday(date)) ?? [];
      const override = exceptions.overrides.get(date);
      const holiday = exceptions.closed.has(date);
      // Resolve only the effective schedule first. Unused defaults must not invalidate a holiday/correction.
      const current = resolveWindows(date, override ?? (holiday ? [] : regularRanges));
      active.push(...current);
      if (override || holiday) {
        try {
          const regular = resolveWindows(date, regularRanges);
          closures.push(...removedWindows(regular, current, override ? "session_correction" : "session_holiday"));
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "ambiguous_or_nonexistent_session_boundary") throw error;
          // This affects only optional explanation of an already valid effective schedule, never its expected opens.
          unresolvedDefaults.push(date);
        }
      }
    }
    active.sort((a, b) => a.start - b.start);
    if (active.some((window, i) => window.start >= window.end || i > 0 && window.start < active[i - 1].end)) throw new Error("overlapping_session_windows");
    const expected = new Map<number, string>();
    const record = (time: number, date: string) => {
      if (time < first * 1000 || time > last * 1000) return;
      expected.set(time, date);
      if (expected.size > MAX_OPENS) throw new Error("session_schedule_budget_exceeded");
    };
    let timestampBasis = "intraday_session_grid";
    if (/^\d+$/.test(tf)) {
      const step = Number(tf) * MINUTE;
      for (const window of active) for (let at = window.start; at < window.end; at += step) record(at, window.date);
    } else {
      const sessions = new Map<string, number>();
      for (const window of active) sessions.set(window.date, Math.min(window.start, sessions.get(window.date) ?? Infinity));
      if (tf === "1W") {
        const weeks = new Map<string, number>();
        for (const [date, start] of sessions) {
          const week = addDays(date, -(weekday(date) - schedule.firstDay + 7) % 7);
          weeks.set(week, Math.min(start, weeks.get(week) ?? Infinity));
        }
        sessions.clear(); for (const [week, start] of weeks) sessions.set(week, start);
      } else if (tf !== "1D") throw new Error("unsupported_calendar_timeframe");
      const nativeStarts = new Set(sessions.values());
      const utcDates = new Set([...sessions.keys()].map(dateMs));
      if (bars.every((bar) => nativeStarts.has(bar.time * 1000))) {
        timestampBasis = tf === "1D" ? "native_session_open" : "native_week_first_session_open";
        for (const [date, start] of sessions) record(start, date);
      } else if (bars.every((bar) => utcDates.has(bar.time * 1000))) {
        timestampBasis = tf === "1D" ? "utc_trading_date" : "utc_week_trading_date";
        for (const date of sessions.keys()) record(dateMs(date), date);
      } else throw new Error("calendar_bar_timestamp_alignment_unverified");
    }
    const times = [...expected.keys()].sort((a, b) => a - b);
    const unsafeBefore = bars.map(() => false), resetBefore = [...wallGaps];
    const intervals: Array<{ from: string; to: string; classification: string; expected_missing_bars: number;
      missing_bar_examples: string[]; closure_reasons: string[] }> = [];
    let cursor = 0, scheduled = 0, missingIntervals = 0, unclassified = 0;
    for (let i = 1; i < bars.length; i++) {
      const start = bars[i - 1].time * 1000, end = bars[i].time * 1000;
      while (cursor < times.length && times[cursor] <= start) cursor++;
      const fromIndex = cursor;
      while (cursor < times.length && times[cursor] < end) cursor++;
      const missing = times.slice(fromIndex, cursor);
      const aligned = expected.has(start) && expected.has(end);
      if (!aligned || missing.length > 0) { unsafeBefore[i] = true; resetBefore[i] = true; }
      if (!wallGaps[i] && aligned && missing.length === 0) continue;
      const classification = !aligned ? "unverified_bar_alignment" : missing.length > 0 ? "missing_expected_trading_bars" : "scheduled_closure";
      if (!aligned) unclassified++; else if (missing.length > 0) missingIntervals++; else scheduled++;
      const reasons = [...new Set(closures.filter((part) => part.start < end && part.end > start).map((part) => part.reason))];
      if (classification === "scheduled_closure" && reasons.length === 0) reasons.push("regular_session_break");
      intervals.push({ from: bars[i - 1].timeIso, to: bars[i].timeIso, classification, expected_missing_bars: missing.length,
        missing_bar_examples: missing.slice(0, 5).map((time) => new Date(time).toISOString()), closure_reasons: reasons });
    }
    return { unsafeBefore, resetBefore, evidence: { status: "available", reason: null, source: metadata.source, symbol,
      full_name: metadata.fullName, timezone: metadata.timezone, session: metadata.session, subsession_id: metadata.subsessionId,
      metadata_sha256: createHash("sha256").update(JSON.stringify(metadata)).digest("hex"), tzdata: intlZoneResolver.tzdata,
      holiday_metadata_provided: metadata.sessionHolidays !== null, correction_metadata_provided: metadata.corrections !== null,
      unresolved_default_exception_dates: unresolvedDefaults, expanded_session_windows: expandedWindows,
      timestamp_basis: timestampBasis, counts: { scheduled_closures: scheduled, missing_expected_bar_intervals: missingIntervals, unclassified_intervals: unclassified },
      intervals: intervals.slice(0, 50), intervals_omitted: Math.max(0, intervals.length - 50) } };
  } catch (error) { return unavailable(error instanceof Error ? error.message : "invalid_session_metadata"); }
}
