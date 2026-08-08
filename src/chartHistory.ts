import type { TradingView } from "./tradingview.js";

/**
 * A chart holds only a few hundred bars until it is paged backwards, so asking getOhlcv for five
 * thousand returns whatever is loaded and says nothing about the rest. Anything that measures over a
 * history has to page first and then report how far it actually got, or a short read looks exactly
 * like a long one with fewer events in it.
 */
// The window a forward study needs grows every day it runs, so the attempt budget has to be able to
// outrun it rather than sit at the bar count that was enough on day one. Empty loads still stop the
// loop as soon as the provider runs out of history.
const MAX_HISTORY_LOAD_ATTEMPTS = 24;
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
  /** The instant the window has to reach back to, when the caller names one. */
  reachBackTo: string | null;
  earliestBarAt: string | null;
  reachesBack: boolean | null;
};

/**
 * `reachBackTo` is what a forward study needs and a bar count cannot express. A study that only
 * counts signals at or after its own start silently loses the earliest of them once the loaded
 * window no longer extends that far back, and nothing in the result changes to say so: the counter
 * for signals dropped for being too early falls to zero, which is what a healthy run looks like too.
 */
export async function loadRequiredHistory(
  tv: Pick<TradingView, "getOhlcv" | "loadMoreHistory">,
  chartIndex: number,
  requiredBars: number,
  reachBackTo?: string | null,
) {
  const reachBackMs = reachBackTo === undefined || reachBackTo === null ? null : Date.parse(reachBackTo);
  if (reachBackMs !== null && !Number.isFinite(reachBackMs)) {
    throw new Error(`reachBackTo must be a parseable timestamp, got ${reachBackTo}`);
  }
  const earliestOf = (history: { bars: Array<{ timeIso: string }> }) => history.bars[0]?.timeIso ?? null;
  const reaches = (history: { bars: Array<{ timeIso: string }> }) => {
    if (reachBackMs === null) return null;
    const earliest = earliestOf(history);
    return earliest !== null && Date.parse(earliest) <= reachBackMs;
  };
  const done = (history: { bars: Array<{ timeIso: string }> }) =>
    history.bars.length >= requiredBars && reaches(history) !== false;

  const initial = await tv.getOhlcv(requiredBars, chartIndex);
  let history = initial;
  let moreAvailable: boolean | null = null;
  let consecutiveEmptyLoads = 0;
  let requested = requiredBars;
  for (let attempt = 0; attempt < MAX_HISTORY_LOAD_ATTEMPTS && !done(history); attempt += 1) {
    const barsBefore = history.bars.length;
    // Ask for the shortfall while the bar count is unmet, exactly as before. Only when the count is
    // already met and the reach-back is what is short does the shortfall stop being a useful number,
    // and then a full chunk is the request.
    const barsShort = requiredBars - barsBefore;
    const chunk = barsShort > 0 ? Math.min(barsShort, MAX_HISTORY_LOAD_CHUNK) : MAX_HISTORY_LOAD_CHUNK;
    const loaded = await tv.loadMoreHistory({ count: chunk, chartIndex });
    // The read stays pinned to requiredBars unless a reach-back is being chased, so a caller that
    // named no start gets the same bars it always did.
    if (reachBackMs !== null) requested = Math.max(requested, barsBefore + chunk);
    history = await tv.getOhlcv(requested, chartIndex);
    moreAvailable = loaded.moreAvailable;
    if (history.bars.length > barsBefore) {
      consecutiveEmptyLoads = 0;
      continue;
    }
    consecutiveEmptyLoads += 1;
    // TradingView may briefly report no pagination immediately after a chart change.
    if (consecutiveEmptyLoads >= MAX_CONSECUTIVE_EMPTY_HISTORY_LOADS) break;
  }
  const reachesBack = reaches(history);
  return {
    history,
    coverage: {
      chartIndex, requiredBars, initialBars: initial.bars.length,
      loadedBars: Math.max(0, history.bars.length - initial.bars.length),
      finalBars: history.bars.length,
      sufficient: history.bars.length >= requiredBars && reachesBack !== false,
      moreAvailable,
      reachBackTo: reachBackTo ?? null,
      earliestBarAt: earliestOf(history),
      reachesBack,
    } satisfies HistoryCoverage,
  };
}
