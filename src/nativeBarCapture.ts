import { buildClosedChartSnapshot } from "./closedChartSnapshot.js";
import { normalizeResolution } from "./analysisOverlay.js";
import { evidenceHash, nativeBarCaptureSchema, nativeSeriesContextSchema } from "./nativeBarEvidence.js";
import type { NativeBarTargets } from "./nativeBarEvidence.js";
import type { TradingView } from "./tradingview.js";

export type NativeBarCaptureApi = Pick<TradingView, "getChartContext" | "getReplayStatus" | "getOhlcv" | "setResolution" | "getNativeBarSeriesContext">;

/** Caller takes the store lock, then the shared chart lock. No disk IO is done here. */
export async function captureNativeBarEvidence(tv: NativeBarCaptureApi, targets: NativeBarTargets, now: () => Date = () => new Date()) {
  const contexts = new Map<string, { context: ReturnType<typeof nativeSeriesContextSchema.parse>;
    observed_at: string; provenance: { session_holidays: string | null; corrections: string | null } }>();
  const api = {
    getChartContext: () => tv.getChartContext(), getReplayStatus: () => tv.getReplayStatus(),
    setResolution: (tf: string, index?: number) => tv.setResolution(tf, index),
    getOhlcv: async (count: number, index?: number) => {
      const pane = (await tv.getChartContext()).charts.find((c) => c.index === index);
      if (!pane) throw new Error("native pane missing");
      if (pane.resolution !== "15" && pane.resolution !== "60") return tv.getOhlcv(count, index);
      const before = await tv.getNativeBarSeriesContext(index!);
      if (before.symbol !== pane.symbol || before.resolution !== pane.resolution) throw new Error("native context binding mismatch");
      const raw = await tv.getOhlcv(count, index);
      const observedAt = now().toISOString();
      const after = await tv.getNativeBarSeriesContext(index!);
      if (evidenceHash(before) !== evidenceHash(after)) throw new Error("native context changed during read");
      const context = nativeSeriesContextSchema.parse(before.context);
      contexts.set(`${pane.index}/${pane.resolution}`, { context, observed_at: observedAt, provenance: before.provenance });
      return raw;
    },
  };
  const snapshot = await buildClosedChartSnapshot(api, async () => {
    for (const target of targets) {
      const final = await tv.getNativeBarSeriesContext(target.chart_index);
      const hash = evidenceHash(nativeSeriesContextSchema.parse(final.context));
      if (final.symbol !== target.symbol || normalizeResolution(final.resolution) !== normalizeResolution(target.expected_timeframe)
        || ["15", "60"].some((tf) => hash !== evidenceHash(contexts.get(`${target.chart_index}/${tf}`)?.context))) {
        throw new Error("native context changed before final restoration verification");
      }
    }
    return { status: "ready" };
  }, {
    targets: targets.map((t) => ({ chartIndex: t.chart_index, symbol: t.symbol, expectedTimeframe: t.expected_timeframe })),
    timeframes: ["15", "60"], count: 41, recentCount: 40, confirm: true,
  }, now);
  if (snapshot.status === "blocked" || snapshot.restoration.verified !== true || snapshot.quality_issues.length
    || snapshot.panes.length !== 2 || snapshot.panes.some((p) => p.series.length !== 2)) {
    throw new Error(`native_capture_aborted: restoration=${snapshot.restoration.verified}; ${snapshot.quality_issues.join(",")}`);
  }
  return nativeBarCaptureSchema.parse({ capture_as_of: snapshot.as_of, restoration_verified: true,
    restoration_hash: evidenceHash(snapshot.restoration.before),
    series: snapshot.panes.flatMap((p) => p.series.map((s) => {
      const read = contexts.get(`${p.chart_index}/${s.timeframe}`);
      if (!read) throw new Error("mandatory native context missing");
      return { symbol: p.symbol, timeframe: s.timeframe, source: "tradingview_native_ohlcv", price_basis: "unknown",
        ...read, series_context_id: evidenceHash(read.context), history_shortage: s.recent_closed_bars.length < 40,
        bars: s.recent_closed_bars.map(({ confirmed_at, ...b }) => ({ ...b, confirmed_by_next_bar_at: confirmed_at })) };
    })),
  });
}
