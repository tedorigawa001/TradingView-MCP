import { z } from "zod";
import { hashIndicatorTable, hashPineSource, PINE_SOURCE_HASH_SCHEMA } from "./pineHashes.js";
export { hashIndicatorTable } from "./pineHashes.js";
import { assertChartState, readChartState, withTemporaryChartState } from "./chartTransaction.js";
import { loadAdditionalHistory, summarizeHistoryLoad } from "./chartHistory.js";
import { redactSecrets } from "./redact.js";
import type { ChartInfo, PineStudyStatus, TradingView } from "./tradingview.js";

const symbol = z.string().regex(/^[\w!.:&-]{1,48}(?:\/[\w!.:&-]{1,48})?$/);
const timeframe = z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SHDWM]|[SDWM])$/i);
export const indicatorTableStudySchema = z.object({
  pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
  pine_version: z.string().regex(/^[0-9]{1,6}(\.[0-9]{1,3})?$/),
  chart_index: z.number().int().min(0),
  expected_symbol: symbol,
  expected_timeframe: timeframe,
  timeframe,
  symbols: z.array(z.object({
    symbol,
    expected_cells: z.array(z.object({
      table_index: z.number().int().min(0).max(31),
      row: z.number().int().min(0).max(1999),
      column: z.number().int().min(0).max(1999),
      text: z.string().max(200),
    }).strict()).max(64).default([]),
  }).strict()).min(1).max(12),
  history_chunk: z.number().int().min(1).max(5000).default(5000),
  max_history_attempts: z.number().int().min(1).max(24).default(24),
  confirm: z.boolean().default(false),
}).strict();

export type IndicatorTableStudyApi = Pick<TradingView, "getChartContext" | "getReplayStatus" |
  "listPineScripts" | "getPineSource" | "setSymbol" | "setResolution" | "loadMoreHistory" |
  "addPineToChart" | "removePineFromChart" | "getPineStudyStatus" | "getIndicatorTables" | "getIndicatorInputs">;

const message = (error: unknown) => redactSecrets(error instanceof Error ? error.message : String(error));
const normalizedTimeframe = (value: string) => {
  const upper = value.toUpperCase();
  if (/^[SDWM]$/.test(upper)) return `1${upper}`;
  return upper.endsWith("H") ? String(Number(upper.slice(0, -1)) * 60) : upper;
};
const studyFingerprint = (chart: ChartInfo) => JSON.stringify([...chart.studies].sort((a, b) => a.id.localeCompare(b.id)));

type HistoryEvidence = ReturnType<typeof summarizeHistoryLoad> & {
  initialBars: number; finalBars: number; oldestTime: number | null; oldestTimeIso: string | null;
};
type JobResult = {
  symbol: string; timeframe: string; status: "complete" | "partial" | "failed";
  studyId: string | null; historyLoad: HistoryEvidence | null;
  tables: ReturnType<typeof hashIndicatorTable>[];
  inputs: Array<{ id: string; value: string | number | boolean | null }>;
  markerChecks: Array<{ tableIndex: number; row: number; column: number; expected: string; actual: string | null; matched: boolean }>;
  qualityIssues: string[]; error: string | null;
  cleanup: { removedStudyIds: string[]; unattributedStudyIds: string[] | null;
    remainingStudies: ChartInfo["studies"] | null; errors: string[] };
  chartRestored: boolean; studiesRestored: boolean; chartStateAfter: ChartInfo | null;
};

export async function runIndicatorTableStudy(tv: IndicatorTableStudyApi, raw: unknown,
  options: { sleep?: (ms: number) => Promise<void>; signal?: AbortSignal } = {}) {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const checkCancelled = () => { if (options.signal?.aborted) throw new Error("indicator table study cancelled"); };
  checkCancelled();
  const input = indicatorTableStudySchema.parse(raw);
  if (new Set(input.symbols.map((job) => job.symbol.toUpperCase())).size !== input.symbols.length) {
    throw new Error("symbols must be unique");
  }
  const initial = await assertChartState(tv, input.chart_index, { symbol: input.expected_symbol, resolution: input.expected_timeframe });
  const replay = await tv.getReplayStatus();
  if (replay.started || replay.toolbarVisible) throw new Error("indicator table study is blocked while Bar Replay is active");
  const script = (await tv.listPineScripts()).find((item) => item.pineId === input.pine_id);
  if (!script || script.kind !== "study") throw new Error("an own saved indicator is required");
  const source = await tv.getPineSource(input.pine_id, input.pine_version);
  if (source.pineId !== input.pine_id || source.version !== input.pine_version || source.kind !== "study" || !source.source.trim()) {
    throw new Error("saved indicator identity or version does not match");
  }
  const pine = { pineId: input.pine_id, version: input.pine_version, name: source.name,
    sourceHashSchema: PINE_SOURCE_HASH_SCHEMA, sourceSha256: hashPineSource(source.source) };
  if (!input.confirm) return { schemaVersion: "1.0", status: "preview", dryRun: true, chartIndex: initial.index, pine,
    symbols: input.symbols, timeframe: input.timeframe, historyChunk: input.history_chunk, maxHistoryAttempts: input.max_history_attempts };
  const initialStudies = studyFingerprint(initial);
  const initialIds = new Set(initial.studies.map((study) => study.id));
  const jobs: JobResult[] = [];
  const replayOff = async () => {
    checkCancelled();
    const replay = await tv.getReplayStatus();
    if (replay.started || replay.toolbarVisible) throw new Error("indicator table study is blocked while Bar Replay is active");
  };
  let aborted = false;
  let abortReason: string | null = null;
  for (const requested of input.symbols) {
    const job: JobResult = { symbol: requested.symbol, timeframe: input.timeframe, status: "failed", studyId: null,
      historyLoad: null, tables: [], inputs: [], markerChecks: [], qualityIssues: [], error: null,
      cleanup: { removedStudyIds: [], unattributedStudyIds: null, remainingStudies: null, errors: [] },
      chartRestored: false, studiesRestored: false, chartStateAfter: null };
    let stopAfterJob = false;
    // Never begin another job on top of an unverified previous restoration.
    try {
      const before = await assertChartState(tv, initial.index, initial);
      if (studyFingerprint(before) !== initialStudies) throw new Error("original study list changed before the job");
      await replayOff();
    } catch (error) { aborted = true; abortReason = message(error); break; }
    const transaction = await withTemporaryChartState(tv, initial.index, { symbol: requested.symbol, resolution: input.timeframe }, async () => {
      const binding = { symbol: requested.symbol, resolution: input.timeframe };
      const loaded = await loadAdditionalHistory({ loadMoreHistory: async (options) => {
        await replayOff();
        await assertChartState(tv, initial.index, binding);
        return tv.loadMoreHistory(options);
      } }, input.history_chunk, initial.index, { untilExhausted: true, maxAttempts: input.max_history_attempts });
      const last = loaded.loads.at(-1)!;
      job.historyLoad = { ...summarizeHistoryLoad(loaded), initialBars: loaded.loads[0].barsBefore,
        finalBars: last.barsAfter, oldestTime: last.earliestTime,
        oldestTimeIso: last.earliestTime === null ? null : new Date(last.earliestTime * 1000).toISOString() };
      if (loaded.stopReason !== "consecutive_empty" || last.barsAfter === 0) {
        job.qualityIssues.push(loaded.stopReason !== "consecutive_empty" ? "history_attempt_limit" : "history_empty");
        job.status = "partial";
        stopAfterJob = true;
        return;
      }
      const beforeAdd = await assertChartState(tv, initial.index, binding);
      if (studyFingerprint(beforeAdd) !== initialStudies) throw new Error("study list changed while loading history");
      let addAttempted = false;
      try {
        await replayOff();
        addAttempted = true;
        const added = await tv.addPineToChart(input.pine_id, initial.index, input.pine_version);
        if (typeof added.studyId !== "string" || !/^[\w$]{1,64}$/.test(added.studyId) || initialIds.has(added.studyId)) {
          throw new Error("addition did not identify a new study");
        }
        if (added.chartIndex !== initial.index) throw new Error("added study is not on the selected chart");
        // Only the acknowledged ID from this add operation establishes which instance we may remove.
        job.studyId = added.studyId;
        if (added.isStrategy) throw new Error("added study is not an indicator on the selected chart");
        const validateStatus = (status: PineStudyStatus) => {
          if (status.studyId !== job.studyId || status.pineId !== input.pine_id || status.pineVersion !== input.pine_version ||
            status.chartIndex !== initial.index || status.symbol.toUpperCase() !== requested.symbol.toUpperCase() ||
            normalizedTimeframe(status.resolution) !== normalizedTimeframe(input.timeframe)) throw new Error("on-chart Pine identity, version or binding changed");
          if (status.barsCount !== last.barsAfter || status.earliestTime !== last.earliestTime) throw new Error("history window changed after pagination; no table accepted");
          if (status.loading === null) throw new Error("indicator readiness is unavailable");
        };
        let ready: PineStudyStatus | null = null;
        let quietObservations = 0;
        let latestTime: number | null = null;
        for (let attempt = 0; attempt < 80; attempt += 1) {
          checkCancelled();
          const status = await tv.getPineStudyStatus(job.studyId, initial.index);
          validateStatus(status);
          if (attempt > 0 && status.latestTime !== latestTime) throw new Error("latest bar changed while waiting for the indicator");
          latestTime = status.latestTime;
          quietObservations = status.loading === false ? quietObservations + 1 : 0;
          if (quietObservations >= 9) { ready = status; break; }
          if (attempt < 79) await sleep(250);
        }
        if (ready === null) throw new Error("indicator readiness did not settle within 80 observations");
        const readInputs = async () => {
          const snapshot = await tv.getIndicatorInputs({ studyId: job.studyId!, chartIndex: initial.index });
          if (snapshot.length !== 1 || snapshot[0].id !== job.studyId || snapshot[0].error) throw new Error("indicator inputs are unavailable");
          const values = snapshot[0].inputs;
          if (values.length > 256 || new Set(values.map((input) => input.id)).size !== values.length) throw new Error("indicator input snapshot is incomplete");
          return values.map(({ id, value }) => {
            if (!/^[\w$]{1,64}$/.test(id) || !(value === null || typeof value === "boolean" ||
              (typeof value === "string" && value.length <= 200) || (typeof value === "number" && Number.isFinite(value)))) {
              throw new Error("indicator input snapshot is clipped or unsupported");
            }
            return { id, value };
          }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        };
        job.inputs = await readInputs();
        await replayOff();
        await assertChartState(tv, initial.index, binding);
        const snapshot = await tv.getIndicatorTables({ studyId: job.studyId, chartIndex: initial.index });
        const after = await tv.getPineStudyStatus(job.studyId, initial.index);
        validateStatus(after);
        if (after.loading !== false || after.latestTime !== ready.latestTime) throw new Error("indicator or history changed during table capture");
        if (JSON.stringify(await readInputs()) !== JSON.stringify(job.inputs)) throw new Error("indicator inputs changed during table capture");
        await replayOff();
        if (snapshot.length !== 1 || snapshot[0].id !== job.studyId || snapshot[0].error) throw new Error("table response is not bound to the added study");
        const tables = snapshot[0].tables;
        if (tables.length > 32 || tables.reduce((sum, table) => sum + table.rows * table.columns, 0) > 2000) throw new Error("table snapshot exceeds the 32-table/2000-cell limit");
        job.tables = tables.map(hashIndicatorTable);
        if (job.tables.length === 0 || job.tables.some((table) => table.sha256 === null)) job.qualityIssues.push("table_snapshot_incomplete");
        job.markerChecks = requested.expected_cells.map((cell) => {
          const actual = job.tables[cell.table_index]?.grid?.[cell.row]?.[cell.column] ?? null;
          return { tableIndex: cell.table_index, row: cell.row, column: cell.column, expected: cell.text, actual, matched: actual === cell.text };
        });
        if (job.markerChecks.length === 0) job.qualityIssues.push("marker_checks_not_requested");
        else if (job.markerChecks.some((cell) => !cell.matched)) {
          job.qualityIssues.push("marker_check_failed"); stopAfterJob = true;
        }
        if (job.qualityIssues.includes("table_snapshot_incomplete")) stopAfterJob = true;
        job.status = job.qualityIssues.length === 0 ? "complete" : "partial";
      } finally {
        if (addAttempted) {
          try {
            const current = await readChartState(tv, initial.index);
            // Pine ID/version and a before/after difference cannot distinguish a concurrent manual add.
            // Leave every instance without an acknowledged operation ID in place for explicit review.
            if (job.studyId !== null && !initialIds.has(job.studyId) && current.studies.some((study) => study.id === job.studyId)) {
              await tv.removePineFromChart(input.pine_id, job.studyId, initial.index);
              job.cleanup.removedStudyIds.push(job.studyId);
            }
          } catch (error) { job.cleanup.errors.push(message(error)); }
        }
      }
    }).catch((error: unknown) => {
      // The transaction's initial read can reject before its operation/finally handlers exist.
      // Keep earlier jobs and leave this unstarted symbol in remaining instead of losing all evidence.
      aborted = true;
      abortReason = message(error);
      return null;
    });
    if (transaction === null) break;
    if (transaction.operationError !== null) { job.error = message(transaction.operationError); job.status = "failed"; }
    if (transaction.restoreError !== null) job.cleanup.errors.push(message(transaction.restoreError));
    try {
      const final = await readChartState(tv, initial.index);
      job.chartStateAfter = final;
      job.cleanup.remainingStudies = final.studies.filter((study) => !initialIds.has(study.id));
      job.cleanup.unattributedStudyIds = job.cleanup.remainingStudies.filter((study) => study.id !== job.studyId).map((study) => study.id);
      if (job.cleanup.unattributedStudyIds.length > 0) job.qualityIssues.push("unattributed_studies_remaining");
      job.chartRestored = transaction.restored && final.symbol.toUpperCase() === initial.symbol.toUpperCase() &&
        normalizedTimeframe(final.resolution) === normalizedTimeframe(initial.resolution);
      job.studiesRestored = studyFingerprint(final) === initialStudies;
    } catch (error) { job.cleanup.errors.push(message(error)); }
    if (!job.chartRestored || !job.studiesRestored || job.cleanup.errors.length > 0) {
      job.status = "failed"; job.qualityIssues.push("cleanup_or_restoration_failed");
    }
    jobs.push(job);
    if (job.status === "failed") { aborted = true; abortReason = job.error ?? job.cleanup.errors[0] ?? "cleanup or restoration failed"; break; }
    if (stopAfterJob) break;
  }
  let chartStateAfter: ChartInfo | null = null;
  let chartRestored = false;
  try {
    chartStateAfter = await readChartState(tv, initial.index);
    chartRestored = chartStateAfter.symbol.toUpperCase() === initial.symbol.toUpperCase() &&
      normalizedTimeframe(chartStateAfter.resolution) === normalizedTimeframe(initial.resolution) && studyFingerprint(chartStateAfter) === initialStudies;
    if (!chartRestored) { aborted = true; abortReason ??= "final chart or study list does not match the original"; }
  } catch (error) { aborted = true; abortReason ??= message(error); }
  return { schemaVersion: "1.0", status: aborted ? "aborted" : jobs.some((job) => job.status !== "complete") ? "partial" : "complete",
    dryRun: false, chartIndex: initial.index, originalChart: initial, pine, jobs, abortReason,
    processed: jobs.length, remaining: input.symbols.length - jobs.length,
    chartRestored, chartStateAfter,
    limitations: ["history exhaustion is only two consecutive empty observations, not proof of all provider history",
      "table content follows the custom indicator, including any forming-bar or repainting logic; no automatic adoption",
      "hashes cover the returned snapshot, not a rendered image; readiness is the observed loading flag"] };
}
