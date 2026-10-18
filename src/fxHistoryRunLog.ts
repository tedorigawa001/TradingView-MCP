import { stampedAhead } from "./collectionHealth.js";
import { AppendOnlyFirstSeenLog, isCanonicalTimestamp } from "./firstSeenStore.js";
import { isOandaFxInstrument, OANDA_FX_INSTRUMENTS, oandaPageRanges, resolveFxHistoricalManifestPathFor, type OandaFxInstrument } from "./oandaHistoricalFx.js";
import { wallTimeToUtc } from "./zonedTime.js";

const MAX_RUN_LOG_BYTES = 32 * 1024 * 1024;
const MAX_RUN_RECORD_BYTES = 32 * 1024;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const HASH = /^sha256:[a-f0-9]{64}$/;

/**
 * One collection run of one instrument (BACKLOG 103-5): how it was started (the daily schedule or by hand), when it started
 * and finished, the range it requested, the raw response of each page and the normalized hash of the bars, written for
 * every successful run, also when the content is the same as an earlier run's (the manifest then records nothing new).
 * The normalized hash names the manifest record holding the bars.
 */
export type FxHistoricalRun = {
  schema_version: "1.0"; sequence: number; series: "fx_historical_m15_run"; observation_date: string; first_seen_at: string;
  instrument: OandaFxInstrument; trigger: "daily" | "manual"; environment: "practice" | "live"; requested_from: string; requested_to: string;
  started_at: string; retrieved_at: string; raw_sha256: string[]; normalized_sha256: string; bar_count: number; first_bar_at: string; last_bar_at: string;
  resumed_pages: number; unfinished_pages: number; manifest_recorded: boolean;
};
export type FxHistoricalRunInput = Omit<FxHistoricalRun, "schema_version" | "sequence" | "series" | "observation_date" | "first_seen_at" | "instrument">;
/** prepare reads the log before a run fetches anything, and refuses a start before the latest recorded run. */
export type FxHistoricalRunLogPort = { readonly instrument: OandaFxInstrument; prepare(startedAt: string): Promise<void>; append(run: FxHistoricalRunInput): Promise<{ sequence: number }> };

/** An instrument's run log sits beside its manifest: `<manifest>.runs`. */
export const resolveFxHistoricalRunLogPathFor = (instrument: OandaFxInstrument, configuredPath?: string) =>
  `${resolveFxHistoricalManifestPathFor(instrument, configuredPath)}.runs`;

const FIELDS = ["schema_version", "sequence", "series", "observation_date", "first_seen_at", "instrument", "trigger", "environment", "requested_from", "requested_to",
  "started_at", "retrieved_at", "raw_sha256", "normalized_sha256", "bar_count", "first_bar_at", "last_bar_at", "resumed_pages", "unfinished_pages", "manifest_recorded"];
const count = (value: unknown, minimum: number) => Number.isSafeInteger(value) && (value as number) >= minimum;

const validateRun = (value: unknown, instrument: OandaFxInstrument): FxHistoricalRun => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid FX history run");
  const row = value as Partial<FxHistoricalRun>;
  if (Object.keys(row).some((key) => !FIELDS.includes(key)) || FIELDS.some((key) => !(key in row))) throw new Error("FX history run fields are not the expected ones");
  if (row.schema_version !== "1.0" || row.series !== "fx_historical_m15_run" || row.instrument !== instrument || (row.environment !== "practice" && row.environment !== "live")
    || (row.trigger !== "daily" && row.trigger !== "manual")) throw new Error("unsupported FX history run");
  if (!count(row.sequence, 1) || !count(row.bar_count, 1) || !count(row.resumed_pages, 0) || !count(row.unfinished_pages, 0) || typeof row.manifest_recorded !== "boolean") throw new Error("invalid FX history run counters");
  for (const timestamp of [row.requested_from, row.requested_to, row.started_at, row.retrieved_at, row.first_seen_at, row.first_bar_at, row.last_bar_at]) if (typeof timestamp !== "string" || !isCanonicalTimestamp(timestamp)) throw new Error("invalid FX history run timestamp");
  if (row.requested_from! >= row.requested_to! || row.first_bar_at! > row.last_bar_at! || row.first_seen_at !== row.retrieved_at || row.observation_date !== row.retrieved_at!.slice(0, 10)
    || !Array.isArray(row.raw_sha256) || row.raw_sha256.length < 1 || row.raw_sha256.some((hash) => typeof hash !== "string" || !HASH.test(hash)) || typeof row.normalized_sha256 !== "string" || !HASH.test(row.normalized_sha256)
    || row.resumed_pages! + row.unfinished_pages! > row.raw_sha256.length || row.started_at! > row.retrieved_at!) throw new Error("invalid FX history run fields");
  // One raw response per page of the requested range, and the bars inside it.
  if (oandaPageRanges(row.requested_from!, row.requested_to!).length !== row.raw_sha256.length || row.first_bar_at! < row.requested_from! || row.last_bar_at! > row.requested_to!) {
    throw new Error("FX history run does not match its requested range");
  }
  return row as FxHistoricalRun;
};

export class FxHistoricalRunLog implements FxHistoricalRunLogPort {
  private readonly log: AppendOnlyFirstSeenLog<FxHistoricalRun>;
  /** Bound to one instrument; without a path it uses the run log beside that instrument's manifest. */
  constructor(path?: string, readonly instrument: OandaFxInstrument = "EUR_USD") {
    if (!isOandaFxInstrument(instrument)) throw new Error(`instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
    this.log = new AppendOnlyFirstSeenLog(path ?? resolveFxHistoricalRunLogPathFor(instrument), "FX history run", (value) => validateRun(value, instrument), { maxFileBytes: MAX_RUN_LOG_BYTES, maxRecordBytes: MAX_RUN_RECORD_BYTES });
  }
  /** The log's repair of a tail stamped ahead of the clock (by first_seen_at, which is retrieved_at), for tradingview-mcp-repair-first-seen (BACKLOG 103-11). */
  stampedAheadRepair() { return this.log.stampedAheadRepair(); }
  /** Reads (and so checks) the log before a run fetches anything; a start before the latest recorded run is refused. */
  async prepare(startedAt: string) {
    await this.log.serialize(async () => {
      const latest = (await this.log.readAllUnlocked()).at(-1);
      if (latest && startedAt < latest.retrieved_at) throw new Error("FX history run starts before the latest recorded run finished; the clock moved back");
    });
  }
  /**
   * Appends one run. A run that finished before the latest recorded one (a clock moved back, or a concurrent run of the same
   * instrument that recorded first) is refused and nothing is written.
   */
  async append(run: FxHistoricalRunInput) {
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const candidate = validateRun({ schema_version: "1.0", sequence: records.length + 1, series: "fx_historical_m15_run", observation_date: run.retrieved_at.slice(0, 10),
        first_seen_at: run.retrieved_at, instrument: this.instrument, ...run }, this.instrument);
      const latest = records.at(-1);
      if (latest && candidate.retrieved_at < latest.retrieved_at) throw new Error("FX history run finished before the latest recorded run; the clock moved back");
      await this.log.assertAppendableUnlocked(records, [candidate]);
      await this.log.appendUnlocked(candidate);
      return { sequence: candidate.sequence };
    });
  }
  async records(): Promise<FxHistoricalRun[]> { return this.log.serialize(async () => this.log.readAllUnlocked()); }
}

// ---------------------------------------------------------------------------------------------------------------
// The daily range (BACKLOG 103-5). Days run from 17:00 New York time to 17:00 the next day, as FX trades.
const NEW_YORK = "America/New_York";
const newYork5pm = (date: string) => {
  const resolved = wallTimeToUtc(NEW_YORK, date, 17, 0);
  if (resolved.kind !== "unique") throw new Error(`17:00 New York time on ${date} is not a single instant`);
  return resolved.instant;
};
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => isoDate(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const newYorkDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: NEW_YORK, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
/** The trading day an instant falls in: the New York date, or the next date from 17:00 New York time on. */
export function fxTradingDay(ms: number) {
  const date = newYorkDate(ms);
  return ms >= newYork5pm(date) ? addDays(date, 1) : date;
}
/** The session of trading day D: from 17:00 New York time the day before to 17:00 on D. */
export const fxSession = (day: string) => ({ start: newYork5pm(addDays(day, -1)), end: newYork5pm(day) });
/** The weekdays before trading day D, nearest first. */
export function weekdaysBefore(day: string, count: number) {
  const out: string[] = [];
  for (let date = addDays(day, -1); out.length < count; date = addDays(date, -1)) if (weekday(date) !== 0 && weekday(date) !== 6) out.push(date);
  return out;
}

/** How long after a candle closes a daily run waits before it counts on it (clock skew, OANDA finishing the candle). */
export const FX_DAILY_CLOSE_MARGIN_MS = 60_000;
/**
 * The range a daily run requests at `now` (BACKLOG 103-5). It ends at `to`, the open of the last candle that closed at
 * least a minute ago (the candle at `to` is returned, OANDA's ranges include their end), so every page is final when it is
 * read (BACKLOG 102-12). The sessions covered are the `lookbackWeekdays` weekdays before the trading day that the end
 * of that candle falls in, and the range starts at the first one's session start, so each is covered whole: from its
 * start to its last candle, which opens 15 minutes before its end.
 */
export function dailyFxHistoryRange(now: Date, lookbackWeekdays: number) {
  if (!Number.isSafeInteger(lookbackWeekdays) || lookbackWeekdays < 1 || lookbackWeekdays > 20) throw new Error("lookback weekdays must be an integer from 1 to 20");
  const ms = now.getTime();
  if (!Number.isFinite(ms)) throw new Error("now must be a valid time");
  const to = Math.floor((ms - FX_DAILY_CLOSE_MARGIN_MS) / FIFTEEN_MINUTES) * FIFTEEN_MINUTES - FIFTEEN_MINUTES;
  const covered = weekdaysBefore(fxTradingDay(to + FIFTEEN_MINUTES), lookbackWeekdays);
  const from = fxSession(covered.at(-1)!).start;
  if (from >= to) throw new Error("the daily range is empty");
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), sessions_covered: [...covered].reverse() };
}

// ---------------------------------------------------------------------------------------------------------------
// The daily schedule's health (BACKLOG 103-5): a run every Sunday to Thursday night, between 17:15 and 08:00 New York time.
/**
 * The latest deadline at or before `now` (08:00 New York time on a Monday to Friday), the window before it (from 17:15
 * New York time the day before) and the session the run in it must cover whole: the weekday before the deadline's day.
 */
export function latestFxDailyWindow(now: Date) {
  const ms = now.getTime();
  for (let date = newYorkDate(ms); ; date = addDays(date, -1)) {
    if (weekday(date) === 0 || weekday(date) === 6) continue;
    const resolved = wallTimeToUtc(NEW_YORK, date, 8, 0);
    if (resolved.kind !== "unique") throw new Error(`08:00 New York time on ${date} is not a single instant`);
    if (resolved.instant > ms) continue;
    const opens = wallTimeToUtc(NEW_YORK, addDays(date, -1), 17, 15);
    if (opens.kind !== "unique") throw new Error(`17:15 New York time before ${date} is not a single instant`);
    const [previous] = weekdaysBefore(date, 1);
    return { day: date, opens_at: opens.instant, deadline: resolved.instant, session: fxSession(previous) };
  }
}

/**
 * Whether the schedule held at the latest deadline, by the rule a forward study reads the log with: of the daily runs that
 * finished by the deadline, the last one (manual runs do not count) must have finished in the window, requested the
 * session before it whole (from its start to its last candle, which opens 15 minutes before its end), and read only
 * final pages. latest_run_at is the latest daily run's finishing time, null when there is none. The log orders every
 * run, daily or manual, by its finishing time and refuses one that starts before the latest finished, so the run that
 * holds the others off is the latest of either trigger: latest_recorded_run_at and latest_recorded_trigger name it, and
 * latest_in_future says it is stamped ahead of the clock (after `now`, and more than a minute after `readAt`, when the
 * log was read; see stampedAhead and CLOCK_AHEAD_TOLERANCE_MS): the log refuses every later run until the clock reaches
 * it (BACKLOG 102-36 review). A manual run stamped ahead used to go unreported, while it blocked the daily runs and
 * showed only as a missed window at the next deadline (BACKLOG 103-11).
 */
export function fxDailyCoverage(runs: Pick<FxHistoricalRun, "trigger" | "retrieved_at" | "requested_from" | "requested_to" | "unfinished_pages">[], now: Date, readAt = now.getTime()) {
  const window = latestFxDailyWindow(now);
  const daily = runs.filter((run) => run.trigger === "daily");
  const latest = daily.length ? daily.map((run) => run.retrieved_at).sort().at(-1)! : null;
  let recorded: (typeof runs)[number] | undefined;
  for (const run of runs) if (!recorded || run.retrieved_at >= recorded.retrieved_at) recorded = run;
  let last: (typeof daily)[number] | undefined;
  for (const run of daily) if (Date.parse(run.retrieved_at) <= window.deadline && (!last || run.retrieved_at >= last.retrieved_at)) last = run;
  const meets = last !== undefined && Date.parse(last.retrieved_at) >= window.opens_at && Date.parse(last.requested_from) <= window.session.start
    && Date.parse(last.requested_to) >= window.session.end - FIFTEEN_MINUTES && last.unfinished_pages === 0;
  return { latest_run_at: latest, window_opens_at: new Date(window.opens_at).toISOString(), window_closes_at: new Date(window.deadline).toISOString(), latest_window_met: meets,
    latest_recorded_run_at: recorded?.retrieved_at ?? null, latest_recorded_trigger: recorded?.trigger ?? null,
    latest_in_future: recorded !== undefined && stampedAhead(recorded.retrieved_at, now, readAt) };
}
