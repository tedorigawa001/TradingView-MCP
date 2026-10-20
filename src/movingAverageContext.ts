import { createHash } from "node:crypto";
import type { OhlcvBar, OhlcvResult, TradingView } from "./tradingview.js";
import { normalizeResolution } from "./analysisOverlay.js";
import { assertChartState, symbolSatisfies } from "./chartTransaction.js";
import { CLOSED_MTF_TIMEFRAMES, selectClosedNativeBars } from "./closedMtfSummary.js";

// Observed metadata contract, not a name-based inference about arbitrary Pine scripts.
export const SMA_TEN_STUDY_ID = "Script$PUB;kWRFasqqymAq56dUJNmDbMqN55wBFWPa@tv-scripting";

export interface MovingAverageStudy {
  id: string;
  name: string;
  metaId: string | null;
  visible: boolean | null;
  hasError: boolean | null;
  inputs: Array<{
    id: string;
    name: string;
    type: string;
    value: number | string | boolean | null
  }>;
  plots: Array<{
    id: string;
    title: string;
    type: string;
    visible: boolean | null;
    display: number | null;
    offset: number | null
  }>;
  bars: Array<{ time: number; timeIso: string; values: Record<string, number | null> }>;
  error?: string;
}

export interface MovingAverageSnapshot {
  source: "tradingview_moving_average_studies";
  symbol: string;
  resolution: string;
  chartIndex: number;
  studies: MovingAverageStudy[];
  unmappedStudies: Array<{ id: string; name: string; metaId: string | null }>;
}

function definition(snapshot: MovingAverageSnapshot) {
  return { ...snapshot, studies: snapshot.studies.map(({ bars: _bars, ...study }) => study) };
}

function bound(snapshot: MovingAverageSnapshot, symbol: string, timeframe: string) {
  if (snapshot.source !== "tradingview_moving_average_studies" || snapshot.symbol.toUpperCase() !== symbol.toUpperCase()
    || normalizeResolution(snapshot.resolution) !== normalizeResolution(timeframe)) throw new Error("moving-average snapshot binding does not match the chart");
  if (snapshot.studies.length > 64 || snapshot.unmappedStudies.length > 64
    || new Set([...snapshot.studies, ...snapshot.unmappedStudies].map(s => s.id)).size !== snapshot.studies.length + snapshot.unmappedStudies.length) {
    throw new Error("moving-average studies must be bounded and uniquely identified");
  }
}

const sources = ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"] as const;

function price(bar: OhlcvBar, source: string) {
  switch (source) {
    case "hl2": return bar.high / 2 + bar.low / 2;
    case "hlc3": return bar.high / 3 + bar.low / 3 + bar.close / 3;
    case "ohlc4": return bar.open / 4 + bar.high / 4 + bar.low / 4 + bar.close / 4;
    default: return bar[source as "open" | "high" | "low" | "close"];
  }
}

function adapter(study: MovingAverageStudy) {
  if (study.metaId !== SMA_TEN_STUDY_ID || study.inputs.length !== 20 || study.plots.length !== 20) return false;
  if (new Set(study.inputs.map(i => i.id)).size !== 20 || new Set(study.plots.map(p => p.id)).size !== 20) return false;
  return Array.from({ length: 10 }, (_, i) => i).every(i => {
    const length = study.inputs.find(v => v.id === `in_${2 * i}`), source = study.inputs.find(v => v.id === `in_${2 * i + 1}`);
    const line = study.plots.find(p => p.id === `plot_${2 * i}`), color = study.plots.find(p => p.id === `plot_${2 * i + 1}`);
    return length?.name === `SMA #${i + 1}` && length.type === "integer" && source?.name === `SMA Source #${i + 1}` && source.type === "source"
      && line?.title === `SMA #${i + 1}` && line.type === "line" && color?.type === "colorer";
  });
}

export function summarizeMovingAverages(
  ohlcv: OhlcvResult,
  snapshot: MovingAverageSnapshot,
  symbol: string,
  timeframe: string,
  asOf: Date
) {
  bound(snapshot, symbol, timeframe);
  const { eligible, closed, end, firstForming, cadence } = selectClosedNativeBars(ohlcv, symbol, timeframe, asOf);
  const latest = closed.at(-1), previous = closed.at(-2);
  const issues: string[] = [];
  const unmapped = snapshot.unmappedStudies.map(s => ({ ...s, reason: "no_verified_moving_average_adapter" }));
  const rows = [];
  if (!latest) issues.push("no_successor_confirmed_native_bar");
  if (firstForming >= 0 && firstForming < eligible.length - 1) issues.push("forming_bar_before_end_of_history");
  for (const study of snapshot.studies) {
    if (!adapter(study)) {
      unmapped.push({
        id: study.id,
        name: study.name,
        metaId: study.metaId,
        reason: "unsupported_or_changed_moving_average_signature"
      });
      continue;
    }
    if (study.bars.length > 1000) throw new Error("moving-average plot history exceeds 1000 rows");
    const values = new Map<number, MovingAverageStudy["bars"][number]>();
    for (const [i, bar] of study.bars.entries()) {
      if (!Number.isSafeInteger(bar.time) || !Number.isFinite(new Date(bar.time * 1000).getTime()) || bar.timeIso !== new Date(bar.time * 1000).toISOString()
        || (i > 0 && bar.time <= study.bars[i - 1].time)) throw new Error("moving-average plot times must be valid and strictly ordered");
      values.set(bar.time, bar);
    }
    for (let i = 0; i < 10; i++) {
      const periodInput = study.inputs.find(v => v.id === `in_${2 * i}`)!;
      const sourceInput = study.inputs.find(v => v.id === `in_${2 * i + 1}`)!;
      const plot = study.plots.find(v => v.id === `plot_${2 * i}`)!;
      const period = periodInput.value, source = sourceInput.value;
      const rowIssues: string[] = [];
      if (!Number.isSafeInteger(period) || Number(period) < 1 || Number(period) > 1e12) rowIssues.push("invalid_period_input");
      if (typeof source !== "string" || !sources.includes(source as typeof sources[number])) rowIssues.push("unsupported_price_source");
      if (plot.offset !== 0) rowIssues.push("nonzero_or_unknown_plot_offset");
      if (study.error || study.hasError !== false) rowIssues.push("study_error_or_unverified_health");
      if (study.visible === null || plot.visible === null || plot.display === null) rowIssues.push("unverified_visibility");
      const read = (bar: OhlcvBar | undefined) => {
        const value = bar ? values.get(bar.time)?.values[plot.id] : null;
        return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
      };
      let value = read(latest), previousValue = read(previous);
      if (value === null) rowIssues.push("latest_confirmed_plot_value_unavailable");
      if (previousValue === null) rowIssues.push("previous_confirmed_plot_value_unavailable");
      let verification = "insufficient_loaded_history", maxError: number | null = null;
      const settingsValid = !rowIssues.some(v => [
        "invalid_period_input",
        "unsupported_price_source",
        "nonzero_or_unknown_plot_offset",
        "study_error_or_unverified_health"
      ].includes(v));
      if (settingsValid && closed.length >= Number(period) + 1 && value !== null && previousValue !== null) {
        const expected = (at: number) => closed.slice(at - Number(period) + 1, at + 1).reduce((sum, b) => sum + price(b, String(source)) / Number(period), 0);
        const currentExpected = expected(closed.length - 1), previousExpected = expected(closed.length - 2);
        maxError = Math.max(Math.abs(value - currentExpected), Math.abs(previousValue - previousExpected));
        if (!Number.isFinite(maxError) || maxError > Math.max(1, Math.abs(currentExpected), Math.abs(previousExpected)) * 1e-8) {
          verification = "native_plot_does_not_match_sma";
          rowIssues.push(verification);
          value = previousValue = null;
        } else verification = "matched_native_ohlcv_sma";
      } else if (settingsValid) rowIssues.push("sma_verification_unavailable");
      if (!settingsValid) {
        value = previousValue = null;
        verification = "unsupported_settings_or_study_error";
      }
      const change = value !== null && previousValue !== null ? value - previousValue : null;
      const bps = value !== null && previousValue !== null ? (value / previousValue - 1) * 1e4 : null;
      if ((change !== null && !Number.isFinite(change)) || (bps !== null && !Number.isFinite(bps))) throw new Error("moving-average slope is not finite");
      const slope = change === null ? null : {
        price_change: change,
        change_bps: bps,
        direction: change > 0 ? "rising" : change < 0 ? "falling" : "flat",
        basis: "two_adjacent_successor_confirmed_native_bars",
        elapsed_seconds: latest!.time - previous!.time
      };
      rows.push({
        study_id: study.id,
        study_name: study.name,
        meta_id: study.metaId,
        plot_id: plot.id,
        plot_title: plot.title,
        settings: {
          method: "SMA",
          period,
          source,
          period_input_id: periodInput.id,
          source_input_id: sourceInput.id,
          offset_bars: plot.offset
        },
        study_visible: study.visible,
        plot_visible: plot.visible === null || plot.display === null ? null : plot.visible && (plot.display & 1) !== 0,
        display_mask: plot.display,
        value,
        previous_value: previousValue,
        bar_open_at: latest?.timeIso ?? null,
        confirmed_at: latest ? eligible[end].timeIso : null,
        previous_bar_open_at: previous?.timeIso ?? null,
        previous_confirmed_at: previous ? latest!.timeIso : null,
        slope,
        verification: { status: verification, maximum_absolute_error: maxError },
        status: rowIssues.length ? "partial" : "complete",
        quality_issues: rowIssues
      });
    }
  }
  if (!rows.length) issues.push("no_supported_moving_average_plots");
  if (snapshot.studies.some(s => !adapter(s))) issues.push("unsupported_or_changed_moving_average_signature");
  if (rows.some(r => r.status === "partial")) issues.push("one_or_more_moving_averages_partial");
  return {
    schema_version: "1.0",
    adapter_version: "observed_ten_sma_v1",
    symbol,
    timeframe: normalizeResolution(timeframe),
    as_of: asOf.toISOString(),
    source: "tradingview_native_study_plots",
    candidateEligible: false,
    status: issues.length ? "partial" : "complete",
    definition_sha256: createHash("sha256").update(JSON.stringify(definition(snapshot))).digest("hex"),
    reference: {
      price: latest?.close ?? null,
      basis: "latest_successor_confirmed_close",
      bar_open_at: latest?.timeIso ?? null,
      confirmed_at: latest ? eligible[end].timeIso : null
    },
    history: {
      loaded_bars: ohlcv.bars.length,
      closed_bars_used: closed.length,
      future_bars_excluded: ohlcv.bars.length - eligible.length,
      unconfirmed_tail_bars_excluded: eligible.length - closed.length
    },
    native_cadence: cadence,
    counts: {
      studies_seen: snapshot.studies.length + snapshot.unmappedStudies.length,
      mapped_plots: rows.length,
      unmapped_studies: unmapped.length
    },
    moving_averages: rows,
    unmapped_studies: unmapped,
    quality_issues: issues,
    limitations: [
      "Descriptive observed study values, not trade signals or proof of an edge. No scanner fallback or replacement values from recomputation.",
      "Only the explicitly identified ten-SMA metadata signature is mapped in v1; other studies are listed without inferring their method from a name. Identity and signature are not a source-code audit or immutable script version.",
      "Latest native bar without a successor is excluded. Plot times must match exact native bar opens; no nearest-time join, forward fill or display-offset adjustment.",
      "Slopes are differences between adjacent observed bars, not per-hour rates; elapsed time can span closures. Loaded OHLC verifies both SMA values when enough history exists; otherwise verification stays partial.",
      "Current plot history may repaint and is not historical point-in-time evidence. Read-only snapshots cannot guarantee atomicity against arbitrary manual UI changes."
    ]
  };
}

type MovingAverageApi = Pick<TradingView, "getChartContext" | "getReplayStatus" | "getOhlcv" | "getMovingAverageStudies">;
export async function buildMovingAverageContext(
  tv: MovingAverageApi,
  options: { symbol: string; expectedTimeframe: string; chartIndex?: number; count?: number },
  now: () => Date = () => new Date()
) {
  const asOf = now(), count = options.count ?? 500, timeframe = normalizeResolution(options.expectedTimeframe);
  if (!Number.isFinite(asOf.getTime())) throw new Error("moving-average context needs a valid cutoff");
  if (!Number.isInteger(count) || count < 3 || count > 1000) throw new Error("moving-average count must be between 3 and 1000");
  if (!CLOSED_MTF_TIMEFRAMES.includes(timeframe as typeof CLOSED_MTF_TIMEFRAMES[number])) throw new Error("unsupported moving-average timeframe");
  const noReplay = async () => {
    const r = await tv.getReplayStatus();
    if (!r.available || r.started || r.toolbarVisible) throw new Error("moving-average context requires verified inactive Bar Replay");
  };
  await noReplay();
  const context = await tv.getChartContext(), index = options.chartIndex ?? context.activeChartIndex;
  if (index === null || !Number.isInteger(index) || index < 0) throw new Error("moving-average context requires an available chart index");
  const selected = context.charts.find(c => c.index === index);
  if (!selected || !symbolSatisfies(selected.symbol, options.symbol, true)) throw new Error("moving-average chart symbol does not match the request");
  const original = await assertChartState(tv, index, { symbol: selected.symbol, resolution: timeframe });
  const before = await tv.getMovingAverageStudies(count, index);
  bound(before, original.symbol, timeframe);
  if (before.chartIndex !== index) throw new Error("moving-average snapshot chart index does not match");
  const identities = (items: Array<{ id: string; name: string }>) => JSON.stringify(items.map(s => [s.id, s.name]).sort((a, b) => a[0].localeCompare(b[0])));
  if (identities([...before.studies, ...before.unmappedStudies]) !== identities(original.studies)) throw new Error("moving-average study set does not match chart context");
  const ohlcv = await tv.getOhlcv(count, index);
  const after = await tv.getMovingAverageStudies(count, index);
  bound(after, original.symbol, timeframe);
  if (JSON.stringify(definition(before)) !== JSON.stringify(definition(after))) throw new Error("moving-average settings or study set changed during acquisition");
  const final = await assertChartState(tv, index, { symbol: original.symbol, resolution: original.resolution });
  if (identities(final.studies) !== identities(original.studies)) throw new Error("moving-average chart study set changed during acquisition");
  await noReplay();
  return {
    ...summarizeMovingAverages(ohlcv, before, original.symbol, timeframe, asOf),
    chart_index: index,
    observed_at: now().toISOString(),
    requested_bars: count,
    chart_changes: false
  };
}
