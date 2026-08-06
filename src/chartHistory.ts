import type { TradingView } from "./tradingview.js";

/**
 * A chart holds only a few hundred bars until it is paged backwards, so asking getOhlcv for five
 * thousand returns whatever is loaded and says nothing about the rest. Anything that measures over a
 * history has to page first and then report how far it actually got, or a short read looks exactly
 * like a long one with fewer events in it.
 */
const MAX_HISTORY_LOAD_ATTEMPTS = 8;
const MAX_HISTORY_LOAD_CHUNK = 1000;
const MAX_CONSECUTIVE_EMPTY_HISTORY_LOADS = 2;

export type HistoryCoverage = {
  chartIndex: number;
  requiredBars: number;
  initialBars: number;
  loadedBars: number;
  finalBars: number;
  sufficient: boolean;
  moreAvailable: boolean | null;
};

export async function loadRequiredHistory(
  tv: Pick<TradingView, "getOhlcv" | "loadMoreHistory">,
  chartIndex: number,
  requiredBars: number,
) {
  const initial = await tv.getOhlcv(requiredBars, chartIndex);
  if (initial.bars.length >= requiredBars) {
    return {
      history: initial,
      coverage: {
        chartIndex, requiredBars, initialBars: initial.bars.length, loadedBars: 0,
        finalBars: initial.bars.length, sufficient: true, moreAvailable: null,
      } satisfies HistoryCoverage,
    };
  }
  let history = initial;
  let moreAvailable: boolean | null = null;
  let consecutiveEmptyLoads = 0;
  for (let attempt = 0; attempt < MAX_HISTORY_LOAD_ATTEMPTS && history.bars.length < requiredBars; attempt += 1) {
    const barsBefore = history.bars.length;
    const loaded = await tv.loadMoreHistory({ count: Math.min(requiredBars - barsBefore, MAX_HISTORY_LOAD_CHUNK), chartIndex });
    history = await tv.getOhlcv(requiredBars, chartIndex);
    moreAvailable = loaded.moreAvailable;
    if (history.bars.length > barsBefore) {
      consecutiveEmptyLoads = 0;
      continue;
    }
    consecutiveEmptyLoads += 1;
    // TradingView may briefly report no pagination immediately after a chart change.
    if (consecutiveEmptyLoads >= MAX_CONSECUTIVE_EMPTY_HISTORY_LOADS) break;
  }
  return {
    history,
    coverage: {
      chartIndex, requiredBars, initialBars: initial.bars.length,
      loadedBars: Math.max(0, history.bars.length - initial.bars.length),
      finalBars: history.bars.length, sufficient: history.bars.length >= requiredBars, moreAvailable,
    } satisfies HistoryCoverage,
  };
}
