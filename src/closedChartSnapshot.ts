import { randomUUID } from "node:crypto";
import { normalizeResolution } from "./analysisOverlay.js";
import { CLOSED_MTF_TIMEFRAMES, selectClosedNativeBars, summarizeClosedTimeframe } from "./closedMtfSummary.js";
import type { ClosedMtfTimeframe } from "./closedMtfSummary.js";
import type { ChartContext, TradingView } from "./tradingview.js";

type SnapshotApi = Pick<TradingView, "getChartContext" | "getReplayStatus" | "getOhlcv" | "setResolution">;
type Target = { chartIndex: number; symbol: string; expectedTimeframe: string };
export type ClosedChartSnapshotOptions = {
  targets: Target[];
  timeframes?: ClosedMtfTimeframe[];
  count?: number;
  recentCount?: number;
  confirm?: boolean;
};

class LayoutChanged extends Error {}
class ReplayBlocked extends Error {}

function signature(context: ChartContext) {
  return JSON.stringify({
    layout: context.layoutName, active: context.activeChartIndex, count: context.chartsCount,
    charts: context.charts.map((c) => ({ index: c.index, symbol: c.symbol,
      resolution: normalizeResolution(c.resolution), studies: c.studies.map((s) => s.id).sort() }))
      .sort((a, b) => a.index - b.index),
  });
}

/** Caller holds the shared chart-operation lock for the entire snapshot, including restoration and quotes. */
export async function buildClosedChartSnapshot(
  tv: SnapshotApi,
  readExecution: () => Promise<{ status: string }>,
  options: ClosedChartSnapshotOptions,
  now: () => Date = () => new Date(),
) {
  const frames = options.timeframes ?? ["15", "60"];
  const count = options.count ?? 300, recentCount = options.recentCount ?? 40;
  if (!Array.isArray(options.targets) || options.targets.length < 1 || options.targets.length > 4
    || options.targets.some((t) => !Number.isInteger(t.chartIndex) || t.chartIndex < 0
      || typeof t.symbol !== "string" || !/^[\w]+:[\w.!/-]+$/.test(t.symbol)
      || !CLOSED_MTF_TIMEFRAMES.includes(normalizeResolution(t.expectedTimeframe) as ClosedMtfTimeframe))
    || new Set(options.targets.map((t) => t.chartIndex)).size !== options.targets.length
    || frames.length < 1 || frames.length > 6 || new Set(frames).size !== frames.length
    || frames.some((f) => !CLOSED_MTF_TIMEFRAMES.includes(f))
    || !Number.isInteger(count) || count < 2 || count > 1000
    || !Number.isInteger(recentCount) || recentCount < 1 || recentCount > 100 || recentCount >= count) {
    throw new Error("invalid closed chart snapshot targets, timeframes or history limits");
  }
  const before = structuredClone(await tv.getChartContext());
  if (!before.charts.some((c) => c.index === before.activeChartIndex)) throw new Error("selected pane unavailable");
  for (const target of options.targets) {
    const pane = before.charts.find((c) => c.index === target.chartIndex);
    if (!pane || pane.symbol !== target.symbol
      || normalizeResolution(pane.resolution) !== normalizeResolution(target.expectedTimeframe)) {
      throw new Error("snapshot target does not match the displayed pane");
    }
  }
  let expected = structuredClone(before);
  const layoutCheck = async () => {
    const actual = await tv.getChartContext();
    if (signature(actual) !== signature(expected)) throw new LayoutChanged("chart layout changed; refusing overwrite");
    return actual;
  };
  const guard = async () => {
    await layoutCheck();
    let replay;
    try { replay = await tv.getReplayStatus(); }
    catch { throw new ReplayBlocked("Replay status could not be verified"); }
    if (!replay.available || replay.started || replay.toolbarVisible) throw new ReplayBlocked("inactive Replay required");
  };
  await guard();
  const asOf = now();
  if (!Number.isFinite(asOf.getTime())) throw new Error("invalid snapshot cutoff");
  const plan = options.targets.map((t) => ({ chart_index: t.chartIndex, symbol: t.symbol,
    original_timeframe: t.expectedTimeframe, timeframes: frames }));
  const base = {
    schema_version: "1.0", snapshot_id: randomUUID(), as_of: asOf.toISOString(),
    source: "tradingview_native_ohlcv", price_basis: "unknown", candidateEligible: false,
    chart_changes: plan,
    limitations: [
      "Descriptive evidence only; no trading, scenario evaluation, alerts, delivery or journal writes.",
      "Only loaded native history is used; no history loading, resampling or scanner indicator substitution.",
      "Confirmation names the successor open, not exchange publication or first availability. This is not vintage evidence.",
      "A shared OHLC cutoff is not simultaneous acquisition. Quotes have separate observation times and are not OHLC evidence.",
      "OHLC bid/ask/mid basis is unknown. Quote freshness and ready do not guarantee execution.",
      "Layout checks detect observed drift, not every transient UI edit; chart access is not atomic against manual actions.",
    ],
  };
  const needsSwitch = options.targets.some((t) => frames.some((f) => f !== normalizeResolution(t.expectedTimeframe)));
  if (needsSwitch && !options.targets.some((t) => t.chartIndex === before.activeChartIndex)) {
    throw new Error("selected pane must be included in targets for selection restoration");
  }
  if (needsSwitch && options.confirm !== true) {
    return { ...base, status: "confirmation_required", panes: [], execution: null,
      restoration: { verified: null, before, after: null }, quality_issues: ["confirm_required_for_temporary_timeframe_switch"] };
  }

  const issues: string[] = [];
  let blocked = false, restoreFailed = false;
  const change = async (index: number, resolution: string) => {
    await layoutCheck();
    const previous = structuredClone(expected), next = structuredClone(expected);
    next.charts.find((c) => c.index === index)!.resolution = resolution;
    next.activeChartIndex = index;
    let result: Awaited<ReturnType<SnapshotApi["setResolution"]>>;
    try { result = await tv.setResolution(resolution, index); }
    catch (error) {
      const actual = await tv.getChartContext();
      // The low-level API may roll its own failed change back. Never repair unrelated drift.
      if (signature(actual) === signature(previous)) expected = previous;
      else if (signature(actual) === signature(next)) expected = next;
      else throw new LayoutChanged("chart drift during timeframe change; refusing overwrite");
      throw error;
    }
    expected = next;
    await layoutCheck();
    if (result?.note !== undefined) throw new Error("timeframe data readiness unverified");
  };
  const read = async (target: Target, timeframe: string) => {
    await guard();
    const raw = await tv.getOhlcv(count, target.chartIndex);
    const observedAt = now().toISOString();
    await guard();
    const summary = summarizeClosedTimeframe(raw, target.symbol, timeframe, asOf);
    const selected = selectClosedNativeBars(raw, target.symbol, timeframe, asOf);
    const start = Math.max(0, selected.closed.length - recentCount);
    const bars = selected.closed.slice(start).map((b, i) => ({
      bar_open_at: b.timeIso, confirmed_at: selected.eligible[start + i + 1].timeIso,
      open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    return { ...summary, observed_at: observedAt, recent_closed_bars: bars };
  };
  const panes: Array<{ chart_index: number; symbol: string; original: Awaited<ReturnType<typeof read>>;
    series: Array<Awaited<ReturnType<typeof read>>> }> = [];
  let execution: { status: string } | null = null;
  try {
    for (const target of options.targets) {
      const original = before.charts.find((c) => c.index === target.chartIndex)!;
      await guard();
      const pane = { chart_index: target.chartIndex, symbol: target.symbol,
        original: await read(target, original.resolution), series: [] as Array<Awaited<ReturnType<typeof read>>> };
      panes.push(pane);
      try {
        for (const frame of frames) {
          await guard();
          if (normalizeResolution(expected.charts.find((c) => c.index === target.chartIndex)!.resolution) !== frame) {
            await change(target.chartIndex, frame);
          }
          pane.series.push(normalizeResolution(original.resolution) === frame ? pane.original : await read(target, frame));
        }
      } finally {
        try {
          await layoutCheck();
          if (normalizeResolution(expected.charts.find((c) => c.index === target.chartIndex)!.resolution)
            !== normalizeResolution(original.resolution)) await change(target.chartIndex, original.resolution);
          await layoutCheck();
        } catch (error) {
          restoreFailed = true;
          throw error;
        }
      }
    }
  } catch (error) {
    blocked = error instanceof LayoutChanged || error instanceof ReplayBlocked || restoreFailed;
    issues.push(error instanceof LayoutChanged ? "manual_layout_change" : error instanceof ReplayBlocked
      ? "replay_safety_failed" : restoreFailed ? "pane_restore_failed" : "native_acquisition_failed");
  } finally {
    try {
      await layoutCheck();
      if (!restoreFailed && expected.activeChartIndex !== before.activeChartIndex) {
        const active = before.charts.find((c) => c.index === before.activeChartIndex)!;
        // Use an approved timeframe round trip; no symbol or study mutation is needed to restore selection.
        try {
          await change(active.index, normalizeResolution(active.resolution) === "15" ? "60" : "15");
        } finally {
          await layoutCheck();
          if (normalizeResolution(expected.charts.find((c) => c.index === active.index)!.resolution)
            !== normalizeResolution(active.resolution)) await change(active.index, active.resolution);
        }
      }
    } catch {
      restoreFailed = true; blocked = true; issues.push("selection_or_layout_restore_failed");
    }
  }
  let after = await tv.getChartContext();
  let verified = !restoreFailed && signature(after) === signature(before);
  if (!verified) { blocked = true; issues.push("final_layout_mismatch"); }
  if (!blocked) {
    try { await guard(); } catch { blocked = true; issues.push("final_chart_or_replay_safety_failed"); }
  }
  if (!blocked) {
    try { execution = await readExecution(); }
    catch { issues.push("execution_snapshot_failed"); }
    try { await guard(); }
    catch { blocked = true; issues.push("layout_or_replay_changed_during_quotes"); }
    after = await tv.getChartContext();
    verified = signature(after) === signature(before);
    if (!verified) { blocked = true; issues.push("final_layout_mismatch"); }
  }
  const partial = issues.length > 0 || panes.some((p) => [p.original, ...p.series].some((s) => s.status !== "complete"))
    || execution?.status !== "ready";
  return { ...base, status: blocked ? "blocked" : partial ? "partial" : "complete",
    panes: blocked ? [] : panes, execution: blocked ? null : execution,
    restoration: { verified, before, after }, quality_issues: [...new Set(issues)] };
}
