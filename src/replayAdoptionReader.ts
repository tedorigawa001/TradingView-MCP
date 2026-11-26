import { createHash, randomBytes } from "node:crypto";
import type { ReplayCandidateReader } from "./replayAdoptionCandidate.js";

/**
 * Stage B: a live ReplayCandidateReader. A passive page-side recorder is
 * installed before Replay starts. It counts every fire of the TradingView
 * delegates that move the evidence (Replay session and point, main-series
 * data, strategy data, status and report) and keeps a bounded log with a
 * native fingerprint per event. Reads compare the current fingerprint with
 * the last recorded one, so a change that no delegate announced still bumps
 * the revision. The evidence is derived only from what the recorder saw
 * after it observed this Replay session start: the last bar's final update,
 * the strategy's completed calculation and the report change that followed.
 * There is no MCP entry point; adoption stays unauthorized.
 */

export const RECORDER_KEY = "tradingview-mcp.replayAdoptionRecorder.v1";
export const RECORDER_LOG_LIMIT = 512;
const BAR_SECONDS = 300;
const ID = /^[\w:;.-]{1,128}$/;
const SHA = /^sha256:[a-f0-9]{64}$/;

export interface ReplayFingerprint {
  chartSession: string | null;
  replaySession: string | null;
  replayTurnaround: number | null;
  seriesInstance: string | null;
  sourceInstance: string | null;
  strategyTurnaround: string | null;
  activeStudy: string | null;
  symbol: string | null;
  resolution: string | null;
  seriesSession: string | null;
  lastBar: number[] | null;
  reportEnd: number | null;
  loading: boolean | null;
  completed: boolean | null;
  inputs: string | null;
  replay: {
    started: boolean | null;
    autoplay: boolean | null;
    cursor: number | null;
    selected: number | null;
    resolution: string | null;
  };
}

export interface RecorderEvent {
  seq: number;
  name: string;
  args: Array<string | number | boolean | null>;
  fp: ReplayFingerprint;
}

export interface RecorderSnapshot {
  recorderId: string;
  seq: number;
  overflow: boolean;
  current: ReplayFingerprint;
  log?: RecorderEvent[];
}

export interface ReplayReaderTarget {
  chartIndex: number;
  studyId: string;
  pineId: string;
  pineVersion: string;
  symbol: string;
  seriesId: string;
  timeframe: "5";
}

interface ReplayBarDiagnosis {
  status: string;
  reason: string | null;
  studyId?: string;
  symbol?: string;
  resolution?: string;
  selectedTime?: string;
  cursorTime?: string;
  reportEndTime?: string;
  barOpen?: string;
  barEndExclusive?: string;
  pineId?: string;
  pineVersion?: string;
  ledgerId?: string;
  reportStateSha256?: string;
}

interface LedgerRead {
  ledgerId: string;
  availableTrades: number;
  totalTrades: number | null;
  offset: number;
  nextOffset: number | null;
  currency: string | null;
  initialCapital: number | null;
  inputs: Array<{ id: string; name: string; value: unknown }>;
  trades: Array<{ reportIndex: number; status: "closed" | "open" }>;
}

/** What the reader needs from a page connection; TradingView and CdpClient satisfy it. */
export interface ReplayReaderDeps {
  evaluate<T>(expression: string): Promise<T>;
  diagnose(options: { chartIndex: number; expectedStudyId: string }): Promise<ReplayBarDiagnosis>;
  ledger(options: {
    chartIndex: number; expectedStudyId: string; offset: number; limit: number; expectedLedgerId?: string;
  }): Promise<LedgerRead>;
}

/** Adapter over the existing CDP client and TradingView operations. */
export function replayReaderDeps(
  cdp: { evaluate<T>(expression: string): Promise<T> },
  tv: {
    diagnoseReplayStrategyBar(options: { chartIndex: number; expectedStudyId: string }): Promise<ReplayBarDiagnosis>;
    getStrategyTradeLedger(options: {
      chartIndex: number; expectedStudyId: string; offset: number; limit: number; expectedLedgerId?: string;
    }): Promise<LedgerRead>;
  },
): ReplayReaderDeps {
  return {
    evaluate: expression => cdp.evaluate(expression),
    diagnose: options => tv.diagnoseReplayStrategyBar(options),
    ledger: options => tv.getStrategyTradeLedger(options),
  };
}

function checkChart(chartIndex: number, studyId: string) {
  if (!Number.isSafeInteger(chartIndex) || chartIndex < 0) throw new Error("chartIndex must be a non-negative integer");
  if (!/^[\w.-]{1,128}$/.test(studyId)) throw new Error("studyId must be a TradingView study id");
}

/**
 * In-page recorder script. Modes: install (needs a new recorder id and a
 * stopped Replay), revision and evidence (fingerprint check, then counters or
 * the full log), remove (unsubscribe the owner token from every delegate).
 */
export function recorderScript(mode: "install" | "revision" | "evidence" | "remove",
  options: { chartIndex: number; studyId: string; recorderId?: string }): string {
  checkChart(options.chartIndex, options.studyId);
  if (mode === "install" && !/^[a-f0-9]{32}$/.test(options.recorderId ?? "")) throw new Error("recorderId must be 32 hex digits");
  return `
    (async () => {
      const KEY = Symbol.for(${JSON.stringify(RECORDER_KEY)});
      const mode = ${JSON.stringify(mode)};
      const chartIndex = ${options.chartIndex};
      const studyId = ${JSON.stringify(options.studyId)};
      const api = window.TradingViewApi;
      if (!api || typeof api.replayApi !== "function") throw new Error("Replay API unavailable");
      const existing = window[KEY];
      if (mode === "remove") {
        if (!existing) return { removed: false };
        let left = 0;
        for (const delegate of existing.delegates) {
          try { delegate.unsubscribeAll(existing.token); } catch (e) {}
          if (Array.isArray(delegate._listeners) && delegate._listeners.some(l => l && l.object === existing.token)) left++;
        }
        delete window[KEY];
        return { removed: true, left, recorderId: existing.recorderId };
      }
      const chart = api.chart(chartIndex);
      const model = chart._chartWidget._lineToolsSynchronizer._chartModel;
      const series = model.mainSeries();
      const holder = typeof model.activeStrategySource === "function" ? model.activeStrategySource() : null;
      const replay = await api.replayApi();
      const rs = replay._replayUIController._replayManager._replaySession;
      const unwrap = value => value && typeof value.value === "function" ? value.value() : value;
      const num = value => typeof value === "number" && Number.isFinite(value) ? value : null;
      const str = value => typeof value === "string" ? value.slice(0, 128) : null;
      const bool = value => typeof value === "boolean" ? value : null;
      const attempt = (fn, fallback = null) => { try { return fn(); } catch (e) { return fallback; } };
      const fnv = text => { let h1 = 0x811c9dc5, h2 = 0x9747b28c;
        for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i);
          h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0; }
        return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"); };
      const sourceNow = () => attempt(() => holder && typeof holder.value === "function" ? holder.value() : null);
      const fingerprint = () => {
        const source = sourceNow();
        const bar = attempt(() => series.bars()._items.at(-1));
        const last = bar && Array.isArray(bar.value) ? [num(bar.index), ...bar.value.slice(0, 5).map(num)] : null;
        const sourceId = attempt(() => typeof source.id === "function" ? source.id() : source.id);
        return {
          chartSession: str(attempt(() => model._chartSession._sessionId)),
          replaySession: str(attempt(() => rs._sessionId)),
          replayTurnaround: num(attempt(() => rs._turnaroundIndex)),
          seriesInstance: str(attempt(() => series._instanceId)),
          sourceInstance: str(attempt(() => source._instanceId)),
          strategyTurnaround: str(attempt(() => source.turnaround())),
          activeStudy: str(sourceId),
          symbol: str(attempt(() => chart.symbol())),
          resolution: str(attempt(() => chart.resolution())),
          seriesSession: str(attempt(() => series.sessionId())),
          lastBar: last && last.every(v => v !== null) ? last : null,
          reportEnd: num(attempt(() => source._reportData.settings.dateRange.backtest.to)),
          loading: bool(attempt(() => source.isLoading())),
          completed: bool(attempt(() => source.isCompleted())),
          inputs: attempt(() => fnv(JSON.stringify(chart.getStudyById(studyId).getInputValues()))),
          replay: {
            started: bool(attempt(() => unwrap(replay.isReplayStarted()))),
            autoplay: bool(attempt(() => unwrap(replay.isAutoplayStarted()))),
            cursor: num(attempt(() => unwrap(replay.currentDate()))),
            selected: num(attempt(() => unwrap(replay.getReplaySelectedDate()))),
            resolution: str(attempt(() => unwrap(replay.currentReplayResolution()) ?? unwrap(replay.autoReplayResolution()))),
          },
        };
      };
      const record = (state, name, args) => {
        state.seq++;
        state.last = fingerprint();
        if (state.log.length < ${RECORDER_LOG_LIMIT}) {
          state.log.push({ seq: state.seq, name, args: args.slice(0, 3).map(v =>
            v === null || v === undefined ? null : ["number", "boolean"].includes(typeof v) ? v :
            typeof v === "string" ? v.slice(0, 128) : null), fp: state.last });
        } else state.overflow = true;
      };
      if (mode === "install") {
        if (existing) throw new Error("A replay recorder is already installed");
        if (unwrap(replay.isReplayStarted()) !== false) throw new Error("Install the recorder before Replay starts");
        if (sourceNow() === null) throw new Error("No active strategy on the chart");
        const dataEvents = series.dataEvents();
        const pick = (owner, name) => attempt(() => typeof owner[name] === "function" ? owner[name]() : owner["_" + name]);
        const sources = {
          replaySession: () => rs.onSessionIdChanged(), replayPoint: () => rs.onReplayPointChanged(),
          replayEnd: () => rs.onEndOfDataReached(), replayModified: () => model.onReplayModified(),
          barReceived: () => pick(dataEvents, "barReceived"), seriesUpdated: () => pick(dataEvents, "dataUpdated"),
          seriesCompleted: () => pick(dataEvents, "completed"), seriesModified: () => pick(dataEvents, "modified"),
          seriesLoading: () => pick(dataEvents, "loading"), seriesCleared: () => pick(dataEvents, "cleared"),
          sourceUpdated: () => sourceNow().onDataUpdated(), sourceStatus: () => sourceNow().onStatusChanged(),
          reportChanged: () => sourceNow().reportChanged(),
        };
        const state = { recorderId: ${JSON.stringify(options.recorderId ?? "")}, token: {}, seq: 0, overflow: false,
          log: [], delegates: [], last: null, studyId, chartIndex };
        for (const [name, get] of Object.entries(sources)) {
          const delegate = attempt(get);
          // Only TradingView delegates: subscribe(owner, member) with an owner token to remove later.
          if (!delegate || typeof delegate.subscribe !== "function" || typeof delegate.unsubscribeAll !== "function" ||
              typeof delegate.fire !== "function" || !Array.isArray(delegate._listeners)) {
            for (const done of state.delegates) attempt(() => done.unsubscribeAll(state.token));
            throw new Error("Replay recorder source unavailable: " + name);
          }
          delegate.subscribe(state.token, (...args) => record(state, name, args));
          state.delegates.push(delegate);
        }
        state.last = fingerprint();
        window[KEY] = state;
        return { recorderId: state.recorderId, seq: state.seq, sources: Object.keys(sources) };
      }
      if (!existing) throw new Error("No replay recorder is installed");
      if (existing.chartIndex !== chartIndex || existing.studyId !== studyId) throw new Error("The recorder watches another chart or study");
      // A change that no delegate announced is recorded as its own revision.
      const now = fingerprint();
      if (JSON.stringify(now) !== JSON.stringify(existing.last)) record(existing, "unobserved_change", []);
      const snapshot = { recorderId: existing.recorderId, seq: existing.seq, overflow: existing.overflow, current: existing.last };
      return mode === "evidence" ? { ...snapshot, log: existing.log.slice() } : snapshot;
    })()
  `;
}

const SERIES_DATA = new Set(["barReceived", "seriesUpdated", "seriesModified", "seriesLoading", "seriesCleared"]);
const AFTER_REPORT = new Set(["sourceUpdated", "sourceStatus", "reportChanged"]);

export interface DerivedReplayEvidence {
  reason: string | null;
  update: { seriesId: string; openTimeMs: number; updateId: string } | null;
  finalUpdateConfirmed: boolean;
  calculatedFrom: { seriesId: string; openTimeMs: number; updateId: string } | null;
  calculationComplete: boolean;
}

const sameBar = (a: number[] | null, b: number[] | null) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
function lastIndex<T>(items: T[], predicate: (item: T, index: number) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i], i)) return i;
  return -1;
}

/**
 * Pure: the bar update and report provenance from a recorder snapshot.
 * Every step must have been seen after this Replay session started.
 */
export function deriveReplayEvidence(snapshot: RecorderSnapshot, seriesId: string): DerivedReplayEvidence {
  const none = (reason: string): DerivedReplayEvidence =>
    ({ reason, update: null, finalUpdateConfirmed: false, calculatedFrom: null, calculationComplete: false });
  const log = snapshot.log ?? [];
  const current = snapshot.current;
  if (snapshot.overflow) return none("recorder_overflow");
  const session = current.replaySession;
  if (!session) return none("replay_session_unconfirmed");
  // The start: the session id changed to this session after installation.
  const start = lastIndex(log, e => e.name === "replaySession" && e.args[0] === session);
  if (start < 0) return none("replay_start_unobserved");
  const after = log.slice(start + 1);
  if (after.some(e => e.name === "replaySession" || e.name === "unobserved_change" || e.name === "replayEnd")) {
    return none("replay_session_changed");
  }
  const bar = current.lastBar;
  if (!bar) return none("bar_unconfirmed");
  const open = bar[1];
  const point = lastIndex(after, e => e.name === "replayPoint");
  if (point < 0 || after[point].fp.replay.cursor !== current.replay.cursor) return none("replay_point_unobserved");
  const updateAt = lastIndex(after, e => (e.name === "barReceived" || e.name === "seriesUpdated") && sameBar(e.fp.lastBar, bar));
  if (updateAt < 0) return none("bar_update_unobserved");
  const updateEvent = after[updateAt];
  const update = { seriesId, openTimeMs: open * 1000, updateId: `${snapshot.recorderId}:${updateEvent.seq}` };
  const completeAt = after.findIndex((e, i) => i > updateAt && e.name === "seriesCompleted" && sameBar(e.fp.lastBar, bar));
  const laterSeries = after.some((e, i) => i > updateAt && (SERIES_DATA.has(e.name) || e.name === "replayPoint" || e.name === "replayModified"));
  const replay = current.replay;
  // laterSeries also rules out a Replay point after the update, so the point preceded it.
  const finalUpdateConfirmed = completeAt >= 0 && !laterSeries && replay.started === true &&
    replay.autoplay === false && replay.resolution === "5" && current.resolution === "5" &&
    replay.cursor === open + BAR_SECONDS - 1;
  if (!finalUpdateConfirmed) return { ...none("bar_final_update_unconfirmed"), update };
  // The report: the strategy finished after that final update and the report then changed to end at the bar.
  const reportAt = lastIndex(after, (e, i) => i > completeAt && e.name === "reportChanged" &&
    e.fp.reportEnd === open * 1000 && e.fp.loading === false && sameBar(e.fp.lastBar, bar));
  const settled = reportAt >= 0 && after.some((e, i) => i > completeAt && i <= reportAt && e.name === "sourceStatus" && e.fp.loading === false);
  const clean = reportAt >= 0 && after.slice(reportAt + 1).every(e => AFTER_REPORT.has(e.name) &&
    e.fp.reportEnd === open * 1000 && e.fp.loading === false && sameBar(e.fp.lastBar, bar));
  const calculationComplete = settled && clean && current.loading === false && current.completed === true &&
    current.reportEnd === open * 1000;
  if (!calculationComplete) return { ...none("report_final_update_unconfirmed"), update, finalUpdateConfirmed };
  return { reason: null, update, finalUpdateConfirmed, calculatedFrom: { ...update }, calculationComplete };
}

const sha256 = (value: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
const timeMs = (iso: string | undefined) => {
  const value = iso === undefined ? NaN : Date.parse(iso);
  return Number.isSafeInteger(value) ? value : -1;
};

/** The live target to bind before calling checkReplayAdoptionCandidate. */
export async function readReplayTarget(deps: ReplayReaderDeps, chartIndex: number, studyId: string): Promise<ReplayReaderTarget> {
  checkChart(chartIndex, studyId);
  const [diagnosis, snapshot] = await Promise.all([
    deps.diagnose({ chartIndex, expectedStudyId: studyId }),
    deps.evaluate<RecorderSnapshot>(recorderScript("revision", { chartIndex, studyId })),
  ]);
  return liveTarget(chartIndex, diagnosis, snapshot.current);
}

function liveTarget(chartIndex: number, diagnosis: ReplayBarDiagnosis, fp: ReplayFingerprint): ReplayReaderTarget {
  return {
    chartIndex, studyId: diagnosis.studyId ?? "", pineId: diagnosis.pineId ?? "", pineVersion: diagnosis.pineVersion ?? "",
    symbol: diagnosis.symbol ?? "", seriesId: `candles:${fp.seriesSession ?? ""}:${fp.symbol ?? ""}:${fp.resolution ?? ""}`,
    timeframe: diagnosis.resolution as "5",
  };
}

/** Install the passive recorder; Replay must still be stopped so its start is observed. */
export async function installReplayRecorder(deps: ReplayReaderDeps, chartIndex: number, studyId: string) {
  const recorderId = randomBytes(16).toString("hex");
  return deps.evaluate<{ recorderId: string; seq: number; sources: string[] }>(
    recorderScript("install", { chartIndex, studyId, recorderId }));
}

export async function removeReplayRecorder(deps: ReplayReaderDeps, chartIndex: number, studyId: string) {
  return deps.evaluate<{ removed: boolean; left?: number; recorderId?: string }>(recorderScript("remove", { chartIndex, studyId }));
}

/** A ReplayCandidateReader over the installed recorder and the existing strict report reads. */
export function createReplayAdoptionReader(deps: ReplayReaderDeps): ReplayCandidateReader {
  const revisionOf = (snapshot: RecorderSnapshot) => ({
    appInstanceId: snapshot.recorderId, replaySessionId: snapshot.current.replaySession ?? "", revision: snapshot.seq,
  });
  return {
    async readLiveRevision(target) {
      const snapshot = await deps.evaluate<RecorderSnapshot>(recorderScript("revision", target));
      return revisionOf(snapshot);
    },
    async readEvidence(target, expected) {
      const diagnosis = await deps.diagnose({ chartIndex: target.chartIndex, expectedStudyId: target.studyId });
      const first = await deps.ledger({ chartIndex: target.chartIndex, expectedStudyId: target.studyId, offset: 0, limit: 1,
        ...(expected ? { expectedLedgerId: expected.ledgerId } : {}) });
      const snapshot = await deps.evaluate<RecorderSnapshot>(recorderScript("evidence", target));
      const live = liveTarget(target.chartIndex, diagnosis, snapshot.current);
      const derived = deriveReplayEvidence(snapshot, live.seriesId);
      const sameBarStatus = diagnosis.status === "same_bar" && diagnosis.reason === null;
      const open = timeMs(diagnosis.barOpen);
      if (!SHA.test(diagnosis.ledgerId ?? "") || diagnosis.ledgerId !== first.ledgerId || !SHA.test(diagnosis.reportStateSha256 ?? "") ||
          first.totalTrades === null || !ID.test(snapshot.recorderId)) {
        throw new Error("Replay report binding unconfirmed");
      }
      const settings = { currency: first.currency, initialCapital: first.initialCapital, inputs: first.inputs };
      return {
        binding: {
          liveRevision: revisionOf(snapshot), snapshotId: `${snapshot.recorderId}:${snapshot.seq}`,
          ledgerId: first.ledgerId, reportStateSha256: diagnosis.reportStateSha256, settingsSha256: sha256(settings),
        },
        target: live,
        replay: {
          paused: snapshot.current.replay.started === true && snapshot.current.replay.autoplay === false,
          selectedTimeMs: timeMs(diagnosis.selectedTime), cursorTimeMs: timeMs(diagnosis.cursorTime),
        },
        bar: {
          update: derived.update ?? { seriesId: live.seriesId, openTimeMs: open, updateId: "unconfirmed" },
          endTimeMs: timeMs(diagnosis.barEndExclusive),
          nativeBoundaryConfirmed: sameBarStatus, continuityConfirmed: sameBarStatus,
          finalUpdateConfirmed: derived.finalUpdateConfirmed,
        },
        report: {
          endTimeMs: timeMs(diagnosis.reportEndTime),
          calculatedFrom: derived.calculatedFrom ?? { seriesId: live.seriesId, openTimeMs: -1, updateId: "unconfirmed" },
          calculationComplete: derived.calculationComplete,
          availableTrades: first.availableTrades, closedTrades: first.totalTrades,
        },
      };
    },
    async readLedgerPage(target, request) {
      const page = await deps.ledger({ chartIndex: target.chartIndex, expectedStudyId: target.studyId, offset: request.offset,
        limit: request.limit, expectedLedgerId: request.binding.ledgerId });
      return {
        binding: page.ledgerId === request.binding.ledgerId ? request.binding : { ...request.binding, ledgerId: page.ledgerId },
        offset: page.offset, nextOffset: page.nextOffset, availableTrades: page.availableTrades,
        trades: page.trades.map(trade => ({ reportIndex: trade.reportIndex, status: trade.status })),
      };
    },
  };
}
