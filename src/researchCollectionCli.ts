import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CdpClient } from "./cdp.js";
import { assertChartState, changeChartState, readChartState, restoreChartState } from "./chartTransaction.js";
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
type CollectionResult = { id: string; source: unknown; sample: unknown; qualityIssues: string[]; primaryAvailableEvents: number; result: unknown };

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

function sourceFor(history: { bars: Array<{ timeIso: string; forming?: boolean }> }, chartIndex: number) {
  const closed = history.bars.filter((bar) => bar.forming !== true);
  return { chartIndex, requestedBars: 5000, returnedBars: history.bars.length, closedBars: closed.length, from: closed[0]?.timeIso ?? null, to: closed.at(-1)?.timeIso ?? null };
}

async function collectFvg(tv: TradingView): Promise<CollectionResult> {
  return withChartTargets(tv, [{ chartIndex: 0, symbol: "OANDA:XAUUSD", resolution: "15" }], async () => {
    const history = await tv.getOhlcv(5000, 0);
    const result = runFvgRetestStudy({ bars: history.bars, symbol: history.symbol, timeframe: history.resolution, minimumGapBps: 3, retestWithinBars: 48, minImpulseBodyRatio: 0.6, requireBoundaryHold: true, horizons: [4, 16, 48], targetReturnBps: 10, minimumEvents: 50, folds: [], eventLimit: 0, confidenceLevel: 0.95, configurationTrials: 1, regime: REGIME, signalFrom: "2026-07-26T02:30:00.000Z", signalTo: null, branchFilter: "bearish", regimeFilter: { directional: "trend_down", volatility: null } });
    return { id: "xauusd-15m-bearish-fvg-trend-down-forward-20260726", source: sourceFor(history, 0), sample: result.sample, qualityIssues: result.qualityIssues, primaryAvailableEvents: result.byBranch.fvg_retest_bearish.horizons["16"].availableEvents, result };
  });
}

async function collectYieldPrice(tv: TradingView): Promise<CollectionResult> {
  return withChartTargets(tv, [{ chartIndex: 0, symbol: "OANDA:EURUSD", resolution: "1D" }, { chartIndex: 1, symbol: "TVC:US10Y", resolution: "1D" }], async () => {
    const [target, driver] = await Promise.all([tv.getOhlcv(5000, 0), tv.getOhlcv(5000, 1)]);
    const result = runYieldPriceNonconfirmationStudy({ targetBars: target.bars, driverBars: driver.bars, targetSymbol: target.symbol, driverSymbol: driver.symbol, targetTimeframe: target.resolution, driverTimeframe: driver.resolution, relationship: "inverse", driverLookback: 5, driverChangeThreshold: 0.001, priceBreakoutLookback: 2, nonconfirmationBars: 2, triggerLookback: 2, triggerWithinBars: 5, maxDriverAgeBars: 1, horizons: [1, 5, 10, 20], targetReturnBps: 10, minimumEvents: 30, folds: [], eventLimit: 0, driverLagBars: 0, configurationTrials: 1, contextRegime: null, contextIndicator: null });
    const primary = Object.values(result.byBranch).reduce((sum, branch) => sum + branch.horizons["5"].availableEvents, 0);
    return { id: "eurusd-us10y-nonconfirmation-daily-20260726", source: { target: sourceFor(target, 0), driver: sourceFor(driver, 1) }, sample: result.sample, qualityIssues: result.qualityIssues, primaryAvailableEvents: primary, result };
  });
}

async function collectFeature(tv: TradingView): Promise<CollectionResult> {
  return withChartTargets(tv, [{ chartIndex: 0, symbol: "OANDA:EURUSD", resolution: "50" }], async () => {
    const history = await tv.getOhlcv(5000, 0);
    const result = computeFeatureOutcomeRelationships({ bars: history.bars, symbol: history.symbol, timeframe: history.resolution, features: ["wick_imbalance"], selection: { feature: "wick_imbalance", bucket: "lower_wick_dominant" }, signalFrom: "2026-07-27T08:39:13.383Z", signalTo: null, atrLookback: 14, atrBaselineLookback: 50, rangeLookback: 20, streakMinimumBars: 3, bodyRatioThreshold: 0.5, wickImbalanceThreshold: 0.2, atrCompressionLowRatio: 0.75, atrCompressionHighRatio: 1.5, rangePositionLower: 0.33, rangePositionUpper: 0.67, gapAtrThreshold: 0.25, horizons: [1, 5, 10], minimumObservations: 50, folds: [], regime: { directionalRegime: "trend_down", volatilityRegime: null, trendLookback: 20, atrLookback: 14, volatilityBaselineLookback: 50, trendEfficiencyThreshold: 0.6, rangeEfficiencyThreshold: 0.25, directionalMoveAtrThreshold: 2, highVolatilityRatio: 1.5, lowVolatilityRatio: 0.75 }, observationLimit: 0 });
    return { id: "eurusd-50m-lower-wick-trend-down-forward-20260727", source: sourceFor(history, 0), sample: result.sample, qualityIssues: result.qualityIssues, primaryAvailableEvents: result.selectionContrast?.horizons["5"].selected.availableObservations ?? 0, result };
  });
}

function compact(value: CollectionResult) {
  const result = value.result as { methodologyVersion: string; status: string };
  const evidence = { hypothesisId: value.id, source: value.source, sample: value.sample, result: value.result };
  return { schema_version: "1.0", event_id: randomUUID(), recorded_at: new Date().toISOString(), hypothesis_id: value.id, methodology_version: result.methodologyVersion, status: result.status, source: value.source, sample: value.sample, primary_available_events: value.primaryAvailableEvents, quality_issues: value.qualityIssues, evidence_hash: `sha256:${createHash("sha256").update(JSON.stringify(evidence)).digest("hex")}` };
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
    for (const record of records) if (record.status === "complete" && record.value.primary_available_events > 0) {
      if (await appendOwnerOnly(args.outputPath, record.value)) written += 1;
    }
    process.stdout.write(`${JSON.stringify({ status: records.some((item) => item.status === "error") ? "partial" : "complete", output_path: args.outputPath, records, written })}\n`);
    if (records.some((item) => item.status === "error")) process.exitCode = 1;
  } finally {
    cdp.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`research collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
