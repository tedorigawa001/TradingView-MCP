import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, open } from "node:fs/promises";
import { ResearchCollectionHeartbeatStore, resolveResearchCollectionHeartbeatPath } from "./researchCollectionHeartbeat.js";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CdpClient } from "./cdp.js";
import { assertChartState, changeChartState, readChartState, restoreChartState } from "./chartTransaction.js";
// Paging a chart back to a required bar count is shared with the server, so it lives on its own.
import { loadRequiredHistory, type HistoryCoverage } from "./chartHistory.js";
export { loadRequiredHistory } from "./chartHistory.js";

/**
 * The instant each forward hypothesis started counting. The study filters signals to at or after it,
 * and the loaded window has to reach back to it, so both read the same constant rather than two
 * literals that can drift apart.
 */
export const FORWARD_SIGNAL_START = {
  "xauusd-15m-bearish-fvg-trend-down-forward-20260726": "2026-07-26T02:30:00.000Z",
  "eurusd-us10y-nonconfirmation-daily-20260726": "2026-07-26T03:23:15.913Z",
  "eurusd-50m-lower-wick-trend-down-forward-20260727": "2026-07-27T08:39:13.383Z",
} as const;

import { computeFeatureOutcomeRelationships } from "./featureOutcomeRelationships.js";
import { runFvgRetestStudy } from "./fvgRetestStudy.js";
import { runYieldPriceNonconfirmationStudy } from "./yieldPriceNonconfirmation.js";
import { TradingView } from "./tradingview.js";
import { ChartOperationLock } from "./chartOperationLock.js";
import { resolveStrategyResearchJournalPath, StrategyResearchJournalStore } from "./strategyResearchJournal.js";

const DEFAULT_OUTPUT_PATH = join(homedir(), ".tradingview-mcp", "research-collection.jsonl");
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const HYPOTHESIS_IDS = [
  "xauusd-15m-bearish-fvg-trend-down-forward-20260726",
  "eurusd-us10y-nonconfirmation-daily-20260726",
  "eurusd-50m-lower-wick-trend-down-forward-20260727",
] as const;

export type ResearchCollectionCliArguments = { confirmChartSwitch: boolean; outputPath: string };

export function parseResearchCollectionCliArguments(argv: string[], env = process.env): ResearchCollectionCliArguments {
  let confirmChartSwitch = env.TRADINGVIEW_MCP_RESEARCH_COLLECTION_CONFIRM_CHART_SWITCH === "1";
  let outputPath = env.TRADINGVIEW_MCP_RESEARCH_COLLECTION_PATH?.trim() || DEFAULT_OUTPUT_PATH;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--confirm-chart-switch") confirmChartSwitch = true;
    else if (argv[index] === "--output-path") {
      outputPath = argv[++index] ?? "";
      if (!outputPath) throw new Error("--output-path requires a value");
    } else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!confirmChartSwitch) throw new Error("chart switching is disabled; pass --confirm-chart-switch or set TRADINGVIEW_MCP_RESEARCH_COLLECTION_CONFIRM_CHART_SWITCH=1");
  return { confirmChartSwitch, outputPath };
}

type ChartTarget = { chartIndex: number; symbol: string; resolution: string };

type CollectionResult = { id: string; source: unknown; coverage: { charts: HistoryCoverage[]; sufficient: boolean }; sample: unknown; qualityIssues: string[]; primaryAvailableEvents: number; result: unknown };
type ResearchCollectionRunRecord =
  | { status: "complete"; value: { status: string } }
  | { status: "error"; hypothesisId: string; error: string };

const REGIME = { trendLookback: 20, atrLookback: 14, volatilityBaselineLookback: 50, trendEfficiencyThreshold: 0.55, rangeEfficiencyThreshold: 0.25, directionalMoveAtrThreshold: 1.5, highVolatilityRatio: 1.25, lowVolatilityRatio: 0.8, minimumClassifiedBars: 100, minimumGroupEvents: 10, minimumCoverageRatio: 0.8, maxRegimeAgeBars: 1 };

async function withChartTargets<T>(tv: TradingView, targets: ChartTarget[], operation: () => Promise<T>): Promise<T> {
  if (new Set(targets.map((item) => item.chartIndex)).size !== targets.length) throw new Error("research collection targets must use distinct charts");
  const originals = await Promise.all(targets.map(async (target) => ({ target, state: await readChartState(tv, target.chartIndex) })));
  let value: T | undefined;
  let operationError: unknown = null;
  try {
    for (const { target } of originals) await changeChartState(tv, target.chartIndex, { symbol: target.symbol, resolution: target.resolution });
    for (const { target } of originals) await assertChartState(tv, target.chartIndex, target);
    value = await operation();
  } catch (error) { operationError = error; }
  const restoreErrors: string[] = [];
  for (const { target, state } of [...originals].reverse()) {
    try {
      await restoreChartState(tv, target.chartIndex, { symbol: state.symbol, resolution: state.resolution });
      await assertChartState(tv, target.chartIndex, { symbol: state.symbol, resolution: state.resolution });
    } catch (error) { restoreErrors.push(error instanceof Error ? error.message : String(error)); }
  }
  if (restoreErrors.length > 0) throw new Error(`research collection failed (${operationError instanceof Error ? operationError.message : operationError === null ? "none" : String(operationError)}) and chart restoration also failed (${restoreErrors.join("; ")})`);
  if (operationError !== null) throw operationError;
  return value as T;
}


export function sourceFor(history: { bars: Array<{ timeIso: string; forming?: boolean }> }, chartIndex: number, requestedBars: number) {
  const closed = history.bars.filter((bar) => bar.forming !== true);
  return { chartIndex, requestedBars, returnedBars: history.bars.length, closedBars: closed.length, from: closed[0]?.timeIso ?? null, to: closed.at(-1)?.timeIso ?? null };
}

function insufficientHistory(id: string, methodologyVersion: string, source: unknown, coverage: HistoryCoverage[], sample: unknown): CollectionResult {
  return { id, source, coverage: { charts: coverage, sufficient: false }, sample, qualityIssues: ["insufficient_loaded_history"], primaryAvailableEvents: 0,
    result: { methodologyVersion, status: "partial" } };
}

async function collectFvg(tv: TradingView): Promise<CollectionResult> {
  return withChartTargets(tv, [{ chartIndex: 0, symbol: "OANDA:XAUUSD", resolution: "15" }], async () => {
    const { history, coverage } = await loadRequiredHistory(tv, 0, 5000, FORWARD_SIGNAL_START["xauusd-15m-bearish-fvg-trend-down-forward-20260726"]);
    if (!coverage.sufficient) return insufficientHistory("xauusd-15m-bearish-fvg-trend-down-forward-20260726", "fvg_retest_event_study_v3", sourceFor(history, 0, 5000), [coverage], { barsReceived: history.bars.length });
    const result = runFvgRetestStudy({ bars: history.bars, symbol: history.symbol, timeframe: history.resolution, minimumGapBps: 3, retestWithinBars: 48, minImpulseBodyRatio: 0.6, requireBoundaryHold: true, overlapPolicy: "exclude_later_event", horizons: [4, 16, 48], targetReturnBps: 10, minimumEvents: 50, folds: [], eventLimit: 0, confidenceLevel: 0.95, configurationTrials: 1, regime: REGIME, signalFrom: FORWARD_SIGNAL_START["xauusd-15m-bearish-fvg-trend-down-forward-20260726"], signalTo: null, branchFilter: "bearish", regimeFilter: { directional: "trend_down", volatility: null } });
    return { id: "xauusd-15m-bearish-fvg-trend-down-forward-20260726", source: sourceFor(history, 0, 5000), coverage: { charts: [coverage], sufficient: true }, sample: result.sample, qualityIssues: result.qualityIssues, primaryAvailableEvents: result.byBranch.fvg_retest_bearish.horizons["16"].availableEvents, result };
  });
}

async function collectYieldPrice(tv: TradingView): Promise<CollectionResult> {
  return withChartTargets(tv, [{ chartIndex: 0, symbol: "OANDA:EURUSD", resolution: "1D" }, { chartIndex: 1, symbol: "TVC:US10Y", resolution: "1D" }], async () => {
    const yieldStart = FORWARD_SIGNAL_START["eurusd-us10y-nonconfirmation-daily-20260726"];
    const [targetEvidence, driverEvidence] = await Promise.all([loadRequiredHistory(tv, 0, 1000, yieldStart), loadRequiredHistory(tv, 1, 1000, yieldStart)]);
    const { history: target, coverage: targetCoverage } = targetEvidence;
    const { history: driver, coverage: driverCoverage } = driverEvidence;
    const source = { target: sourceFor(target, 0, 1000), driver: sourceFor(driver, 1, 1000) };
    if (!targetCoverage.sufficient || !driverCoverage.sufficient) return insufficientHistory("eurusd-us10y-nonconfirmation-daily-20260726", "yield_price_nonconfirmation_event_study_v2", source, [targetCoverage, driverCoverage], { targetBarsReceived: target.bars.length, driverBarsReceived: driver.bars.length });
    const result = runYieldPriceNonconfirmationStudy({ targetBars: target.bars, driverBars: driver.bars, targetSymbol: target.symbol, driverSymbol: driver.symbol, targetTimeframe: target.resolution, driverTimeframe: driver.resolution, relationship: "inverse", driverLookback: 5, driverChangeThreshold: 0.001, priceBreakoutLookback: 2, nonconfirmationBars: 2, triggerLookback: 2, triggerWithinBars: 5, maxDriverAgeBars: 1, horizons: [1, 5, 10, 20], targetReturnBps: 10, minimumEvents: 30, signalFrom: yieldStart, folds: [], eventLimit: 0, driverLagBars: 0, configurationTrials: 1, contextRegime: null, contextIndicator: null });
    const primary = Object.values(result.byBranch).reduce((sum, branch) => sum + branch.horizons["5"].availableEvents, 0);
    return { id: "eurusd-us10y-nonconfirmation-daily-20260726", source, coverage: { charts: [targetCoverage, driverCoverage], sufficient: true }, sample: result.sample, qualityIssues: result.qualityIssues, primaryAvailableEvents: primary, result };
  });
}

async function collectFeature(tv: TradingView): Promise<CollectionResult> {
  return withChartTargets(tv, [{ chartIndex: 0, symbol: "OANDA:EURUSD", resolution: "50" }], async () => {
    const { history, coverage } = await loadRequiredHistory(tv, 0, 500, FORWARD_SIGNAL_START["eurusd-50m-lower-wick-trend-down-forward-20260727"]);
    if (!coverage.sufficient) return insufficientHistory("eurusd-50m-lower-wick-trend-down-forward-20260727", "feature_outcome_relationships_v1", sourceFor(history, 0, 500), [coverage], { barsReceived: history.bars.length });
    const result = computeFeatureOutcomeRelationships({ bars: history.bars, symbol: history.symbol, timeframe: history.resolution, features: ["wick_imbalance"], selection: { feature: "wick_imbalance", bucket: "lower_wick_dominant" }, signalFrom: FORWARD_SIGNAL_START["eurusd-50m-lower-wick-trend-down-forward-20260727"], signalTo: null, atrLookback: 14, atrBaselineLookback: 50, rangeLookback: 20, streakMinimumBars: 3, bodyRatioThreshold: 0.5, wickImbalanceThreshold: 0.2, atrCompressionLowRatio: 0.75, atrCompressionHighRatio: 1.5, rangePositionLower: 0.33, rangePositionUpper: 0.67, gapAtrThreshold: 0.25, horizons: [1, 5, 10], minimumObservations: 50, minimumEffectBps: 10, folds: [], regime: { directionalRegime: "trend_down", volatilityRegime: null, trendLookback: 20, atrLookback: 14, volatilityBaselineLookback: 50, trendEfficiencyThreshold: 0.6, rangeEfficiencyThreshold: 0.25, directionalMoveAtrThreshold: 2, highVolatilityRatio: 1.5, lowVolatilityRatio: 0.75 }, observationLimit: 0 });
    return { id: "eurusd-50m-lower-wick-trend-down-forward-20260727", source: sourceFor(history, 0, 500), coverage: { charts: [coverage], sufficient: true }, sample: result.sample, qualityIssues: result.qualityIssues, primaryAvailableEvents: result.selectionContrast?.horizons["5"].selected.availableObservations ?? 0, result };
  });
}

function compact(value: CollectionResult) {
  const result = value.result as { methodologyVersion: string; status: string };
  const evidence = { hypothesisId: value.id, source: value.source, coverage: value.coverage, sample: value.sample, result: value.result };
  return { schema_version: "1.0", event_id: randomUUID(), recorded_at: new Date().toISOString(), hypothesis_id: value.id, methodology_version: result.methodologyVersion, status: result.status, source: value.source, coverage: value.coverage, sample: value.sample, primary_available_events: value.primaryAvailableEvents, quality_issues: value.qualityIssues, evidence_hash: `sha256:${createHash("sha256").update(JSON.stringify(evidence)).digest("hex")}` };
}

export function summarizeResearchCollection(
  records: ResearchCollectionRunRecord[],
  outputPath: string,
  written: number,
) {
  const collectionStatus = records.some((item) => item.status === "error") ? "partial" as const : "complete" as const;
  const researchStatus = records.every((item) => item.status === "complete" && item.value.status === "complete") ? "complete" as const : "partial" as const;
  return {
    status: collectionStatus === "complete" && researchStatus === "complete" ? "complete" as const : "partial" as const,
    collection_status: collectionStatus,
    research_status: researchStatus,
    output_path: outputPath,
    records,
    written,
  };
}

async function appendOwnerOnly(path: string, row: { hypothesis_id: string; primary_available_events: number }): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(path));
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) throw new Error("research collection directory is unsafe");
  let existingPrimaryEvents = 0;
  try {
    const existing = await open(path, "r");
    try {
      const stat = await existing.stat();
      if (!stat.isFile() || stat.size > MAX_OUTPUT_BYTES) throw new Error("research collection output is unsafe");
      const rows = (await existing.readFile("utf8")).trim().split("\n").filter(Boolean);
      for (const line of rows) {
        const parsed = JSON.parse(line) as { hypothesis_id?: unknown; primary_available_events?: unknown };
        if (parsed.hypothesis_id === row.hypothesis_id && typeof parsed.primary_available_events === "number") {
          existingPrimaryEvents = Math.max(existingPrimaryEvents, parsed.primary_available_events);
        }
      }
    } finally { await existing.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (row.primary_available_events <= existingPrimaryEvents) return false;
  const handle = await open(path, "a", 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_OUTPUT_BYTES) throw new Error("research collection output is unsafe");
    await handle.chmod(0o600);
    await appendFile(handle, `${JSON.stringify(row)}\n`, "utf8");
  } finally { await handle.close(); }
  return true;
}

export async function runResearchCollection(
  tv: TradingView,
  researchJournal: Pick<StrategyResearchJournalStore, "assertEventHypothesesRegistered">,
  chartLock: Pick<ChartOperationLock, "acquire"> = new ChartOperationLock(),
) {
  await researchJournal.assertEventHypothesesRegistered([...HYPOTHESIS_IDS]);
  const release = await chartLock.acquire();
  try {
    const replay = await tv.getReplayStatus();
    if (replay.started || replay.toolbarVisible) throw new Error("research collection is blocked while Bar Replay is active");
    const results: Array<{ status: "complete"; value: ReturnType<typeof compact> } | { status: "error"; hypothesisId: string; error: string }> = [];
    for (const collector of [collectFvg, collectYieldPrice, collectFeature]) {
      try { results.push({ status: "complete", value: compact(await collector(tv)) }); }
      catch (error) { results.push({ status: "error", hypothesisId: HYPOTHESIS_IDS[results.length], error: error instanceof Error ? error.message : String(error) }); }
    }
    return results;
  } finally {
    await release();
  }
}

async function main(): Promise<void> {
  const args = parseResearchCollectionCliArguments(process.argv.slice(2));
  const cdp = new CdpClient();
  try {
    const records = await runResearchCollection(
      new TradingView(cdp),
      new StrategyResearchJournalStore(resolveStrategyResearchJournalPath()),
    );
    let written = 0;
    const recorded = new Set<string>();
    for (const record of records) if (record.status === "complete" && record.value.coverage.sufficient && record.value.primary_available_events > 0) {
      if (await appendOwnerOnly(args.outputPath, record.value)) { written += 1; recorded.add(record.value.hypothesis_id); }
    }
    // Written whether or not anything was observed. The evidence file only grows
    // when a hypothesis fires, so without this a silent week and a dead
    // collector are the same record, and the second cannot be recovered later.
    const heartbeat = await new ResearchCollectionHeartbeatStore(resolveResearchCollectionHeartbeatPath()).recordRun({
      observed_at: new Date().toISOString(),
      hypotheses: records.map((record, index) => record.status === "complete"
        ? {
          hypothesis_id: record.value.hypothesis_id,
          status: record.value.coverage.sufficient ? "complete" as const : "partial" as const,
          events: record.value.primary_available_events,
          recorded: recorded.has(record.value.hypothesis_id),
        }
        : { hypothesis_id: HYPOTHESIS_IDS[index], status: "partial" as const, events: 0, recorded: false }),
      chart_restored: records.every((record) => record.status === "complete"),
    });
    process.stdout.write(`${JSON.stringify({ ...summarizeResearchCollection(records, args.outputPath, written), heartbeat: { sequence: heartbeat.sequence, recorded_at: heartbeat.first_seen_at } })}\n`);
    if (records.some((item) => item.status === "error")) process.exitCode = 1;
  } finally {
    cdp.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`research collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
