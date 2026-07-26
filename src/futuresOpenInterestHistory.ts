import { homedir } from "node:os";
import { join } from "node:path";
import {
  AppendOnlyFirstSeenLog,
  isCalendarDate,
  isCanonicalTimestamp,
  type FirstSeenRecordBase,
} from "./firstSeenStore.js";

const MAX_HISTORY_BYTES = 32 * 1024 * 1024;
const MAX_RECORD_BYTES = 2_048;
const MAX_BATCH = 5_000;

export const resolveFuturesOpenInterestHistoryPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_FUTURES_OI_HISTORY_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "futures-open-interest-first-seen-v3.jsonl");

export const resolveFuturesOpenInterestV2HistoryPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_FUTURES_OI_V2_HISTORY_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "futures-open-interest-first-seen-v2.jsonl");

export const resolveLegacyFuturesOpenInterestHistoryPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_FUTURES_OI_LEGACY_HISTORY_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "futures-open-interest-first-seen.jsonl");

/**
 * TradingView timestamps a CME/COMEX daily futures bar at the opening of its evening session.
 * That open is on the preceding UTC date, while the exchange labels the completed session with
 * the following trading date. Persist the latter so daily OI can join COT and external labels.
 */
export const futuresSessionObservationDate = (barOpenTime: string): string => {
  if (!isCanonicalTimestamp(barOpenTime)) throw new Error("futures OI bar time must be a canonical timestamp");
  const open = new Date(barOpenTime);
  // CME Globex opens the session at 17:00 CT, which is 22:00 UTC under CDT and 23:00 UTC under
  // CST. Those two hours are the only ones the shift below is correct for, so accept nothing else.
  // Any other stamping convention, midnight bars most of all, would be shifted a day the wrong way
  // and nothing downstream could detect it: the store only rejects an observation dated after its
  // first_seen_at, so a date that is early by a day passes silently. That is exactly how the
  // original defect survived. Refuse the timestamp instead of guessing which session it belongs to.
  const openHour = open.getUTCHours();
  if (openHour !== 22 && openHour !== 23) {
    throw new Error(`futures OI bar time ${barOpenTime} does not open a CME evening session at ` +
      "22:00 or 23:00 UTC, so its trading date cannot be derived by shifting to the next UTC day");
  }
  return new Date(open.getTime() + 86_400_000).toISOString().slice(0, 10);
};

/**
 * `scope` records whether the value covers only the front contract or every listed month. Today's
 * investigation showed these are different quantities on the same symbol, front-month open interest
 * decaying into every expiry, so a log that conflated them would be unusable.
 */
export type FuturesOpenInterestScope = "front_month" | "all_months_aggregated";

export type FuturesOpenInterestRecord = FirstSeenRecordBase & {
  schema_version: "1.0";
  futures_symbol: string;
  scope: FuturesOpenInterestScope;
  open_interest: number;
  source: string;
  source_detail: string | null;
};

export type FuturesOpenInterestObservation = {
  futures_symbol: string;
  scope: FuturesOpenInterestScope;
  observation_date: string;
  open_interest: number;
  source: string;
  source_detail?: string | null;
  observed_at: string;
};

const SYMBOL_PATTERN = /^[\w!.:&-]{1,48}$/;
const SOURCE_PATTERN = /^[\w.:-]{1,64}$/;

const validateRecord = (value: unknown, line?: number): FuturesOpenInterestRecord => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid futures open interest record${suffix}`);
  }
  const record = value as Partial<FuturesOpenInterestRecord>;
  if (record.schema_version !== "1.0") throw new Error(`unsupported futures open interest schema${suffix}`);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) {
    throw new Error(`invalid futures open interest sequence${suffix}`);
  }
  if (typeof record.futures_symbol !== "string" || !SYMBOL_PATTERN.test(record.futures_symbol)) {
    throw new Error(`invalid futures open interest symbol${suffix}`);
  }
  if (record.scope !== "front_month" && record.scope !== "all_months_aggregated") {
    throw new Error(`invalid futures open interest scope${suffix}`);
  }
  if (typeof record.observation_date !== "string" || !isCalendarDate(record.observation_date)) {
    throw new Error(`invalid futures open interest observation_date${suffix}`);
  }
  if (typeof record.open_interest !== "number" || !Number.isFinite(record.open_interest) ||
      record.open_interest < 0 || record.open_interest > 1e12) {
    throw new Error(`invalid futures open interest value${suffix}`);
  }
  if (typeof record.source !== "string" || !SOURCE_PATTERN.test(record.source)) {
    throw new Error(`invalid futures open interest source${suffix}`);
  }
  if (record.source_detail !== null && typeof record.source_detail !== "string") {
    throw new Error(`invalid futures open interest source_detail${suffix}`);
  }
  if (typeof record.source_detail === "string" && record.source_detail.length > 256) {
    throw new Error(`futures open interest source_detail is too long${suffix}`);
  }
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at)) {
    throw new Error(`invalid futures open interest first_seen_at${suffix}`);
  }
  if (record.observation_date > record.first_seen_at.slice(0, 10)) {
    throw new Error(`futures open interest observation_date is after first_seen_at${suffix}`);
  }
  return record as FuturesOpenInterestRecord;
};

/**
 * First-seen log for daily futures open interest.
 *
 * Open interest for a session is published after that session closes and is revised once from
 * preliminary to final, so a series downloaded today is not what was visible at the time. This log
 * records what was actually observed and when, which is the only way a later study can ask what was
 * known on a past date. It can only build that record forward from the first observation; nothing
 * recovers the vintages of days that passed before collection started.
 */
export class FuturesOpenInterestFirstSeenStore {
  private readonly log: AppendOnlyFirstSeenLog<FuturesOpenInterestRecord>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "futures open interest", validateRecord,
      { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  /**
   * Appends only the observations whose value differs from the newest one already held for the same
   * symbol, scope, source definition and date. Re-reading an unchanged series is the normal case and
   * must not grow the log, while a preliminary value later corrected to a final one is exactly what
   * has to be kept. A chart-built basket and an exchange aggregate are different definitions, even
   * when both call themselves all-month OI, so they must never become revisions of one another.
   */
  async observeMany(observations: FuturesOpenInterestObservation[]): Promise<{
    recorded: FuturesOpenInterestRecord[];
    unchanged: number;
    revisions: number;
  }> {
    if (observations.length === 0 || observations.length > MAX_BATCH) {
      throw new Error(`futures open interest batch must contain 1 to ${MAX_BATCH} observations`);
    }
    return this.log.serialize(async () => {
      const seen = new Set<string>();
      const candidates = observations.map((observation) => {
        const key = `${observation.futures_symbol}|${observation.scope}|${observation.source}|${observation.source_detail ?? ""}|${observation.observation_date}`;
        if (seen.has(key)) {
          throw new Error(`duplicate futures open interest observation in batch ${key}`);
        }
        seen.add(key);
        return validateRecord({
          schema_version: "1.0",
          sequence: 1,
          futures_symbol: observation.futures_symbol,
          scope: observation.scope,
          observation_date: observation.observation_date,
          open_interest: observation.open_interest,
          source: observation.source,
          source_detail: observation.source_detail ?? null,
          first_seen_at: new Date(observation.observed_at).toISOString(),
        });
      });

      const records = await this.log.readAllUnlocked();
      const latestFirstSeen = records.map((record) => record.first_seen_at).sort().at(-1);
      const latestFor = (candidate: FuturesOpenInterestRecord) => records
        .filter((record) => record.futures_symbol === candidate.futures_symbol &&
          record.scope === candidate.scope &&
          record.source === candidate.source &&
          record.source_detail === candidate.source_detail &&
          record.observation_date === candidate.observation_date)
        .sort((a, b) => b.sequence - a.sequence)[0];

      // Writing a new value with a first-seen earlier than one already recorded would make the log
      // claim we knew something before we did.
      if (latestFirstSeen !== undefined && candidates.some((candidate) =>
        latestFor(candidate)?.open_interest !== candidate.open_interest &&
        candidate.first_seen_at < latestFirstSeen)) {
        throw new Error("futures open interest first-seen clock moved backwards");
      }

      const recorded: FuturesOpenInterestRecord[] = [];
      let unchanged = 0;
      let revisions = 0;
      let nextSequence = records.reduce((maximum, record) => Math.max(maximum, record.sequence), 0);
      for (const candidate of candidates) {
        const current = latestFor(candidate);
        if (current?.open_interest === candidate.open_interest) { unchanged += 1; continue; }
        if (current !== undefined) revisions += 1;
        const version = { ...candidate, sequence: ++nextSequence };
        await this.log.appendUnlocked(version);
        records.push(version);
        recorded.push(version);
      }
      return { recorded, unchanged, revisions };
    });
  }

  /**
   * The series for one symbol and scope as it stood at a moment: for every observation date, the
   * newest value whose first-seen is at or before `asOf`. Dates first observed later are absent
   * rather than filled, because they were genuinely unknown then.
   */
  async getSeriesAsOf(input: {
    futuresSymbol: string;
    scope: FuturesOpenInterestScope;
    source?: string;
    sourceDetail?: string | null;
    asOf: Date;
    from?: string;
    to?: string;
  }): Promise<Array<{ observation_date: string; open_interest: number; first_seen_at: string }>> {
    if (!Number.isFinite(input.asOf.getTime())) throw new Error("as_of must be a valid timestamp");
    for (const bound of [input.from, input.to]) {
      if (bound !== undefined && !isCalendarDate(bound)) throw new Error("from and to must be calendar dates");
    }
    const asOfIso = input.asOf.toISOString();
    return this.log.serialize(async () => {
      const eligible = (await this.log.readAllUnlocked()).filter((record) =>
        record.futures_symbol === input.futuresSymbol &&
        record.scope === input.scope &&
        (input.source === undefined || record.source === input.source) &&
        (input.sourceDetail === undefined || record.source_detail === input.sourceDetail) &&
        record.first_seen_at <= asOfIso &&
        (input.from === undefined || record.observation_date >= input.from) &&
        (input.to === undefined || record.observation_date <= input.to));
      const newestByDate = new Map<string, FuturesOpenInterestRecord>();
      for (const record of eligible) {
        const current = newestByDate.get(record.observation_date);
        if (current === undefined || record.sequence > current.sequence) {
          newestByDate.set(record.observation_date, record);
        }
      }
      return [...newestByDate.values()]
        .sort((a, b) => a.observation_date.localeCompare(b.observation_date))
        .map((record) => ({
          observation_date: record.observation_date,
          open_interest: record.open_interest,
          first_seen_at: record.first_seen_at,
        }));
    });
  }

  async coverage(): Promise<{
    records: number;
    series: Array<{ futures_symbol: string; scope: FuturesOpenInterestScope; source: string; source_detail: string | null; dates: number;
      revisions: number; earliest_date: string; latest_date: string; first_collected_at: string }>;
  }> {
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const groups = new Map<string, FuturesOpenInterestRecord[]>();
      for (const record of records) {
        const key = `${record.futures_symbol}|${record.scope}|${record.source}|${record.source_detail ?? ""}`;
        const list = groups.get(key);
        if (list === undefined) groups.set(key, [record]); else list.push(record);
      }
      return {
        records: records.length,
        series: [...groups.values()].map((group) => {
          const dates = new Set(group.map((record) => record.observation_date));
          return {
            futures_symbol: group[0].futures_symbol,
            scope: group[0].scope,
            source: group[0].source,
            source_detail: group[0].source_detail,
            dates: dates.size,
            revisions: group.length - dates.size,
            earliest_date: group.map((record) => record.observation_date).sort()[0],
            latest_date: group.map((record) => record.observation_date).sort().at(-1)!,
            first_collected_at: group.map((record) => record.first_seen_at).sort()[0],
          };
        }).sort((a, b) => a.futures_symbol.localeCompare(b.futures_symbol) || a.scope.localeCompare(b.scope) ||
          a.source.localeCompare(b.source) || (a.source_detail ?? "").localeCompare(b.source_detail ?? "")),
      };
    });
  }

  async records(): Promise<FuturesOpenInterestRecord[]> {
    return this.log.serialize(() => this.log.readAllUnlocked());
  }
}
