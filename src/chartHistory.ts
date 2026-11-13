import type { HistoryLoadResult, TradingView } from "./tradingview.js";

/**
 * A chart holds only a few hundred bars until it is paged backwards, so asking getOhlcv for five
 * thousand returns whatever is loaded and says nothing about the rest. Anything that measures over a
 * history has to page first and then report how far it actually got, or a short read looks exactly
 * like a long one with fewer events in it.
 */
// The window a forward study needs grows every day it runs, so the attempt budget has to be able to
// outrun it rather than sit at the bar count that was enough on day one. Empty loads still stop the
// loop as soon as the provider runs out of history.
export const MAX_HISTORY_LOAD_ATTEMPTS = 24;
const MAX_HISTORY_LOAD_CHUNK = 1000;
const MAX_CONSECUTIVE_EMPTY_HISTORY_LOADS = 2;
const MAX_ADDITIONAL_HISTORY_LOAD_CHUNK = 5000;

export type HistoryLoadStopReason = "consecutive_empty" | "attempt_limit" | "requested_count_reached";

/** Page additional history using actual growth, not requested counts or a transient availability flag. */
export async function loadAdditionalHistory(
  tv: Pick<TradingView, "loadMoreHistory">,
  count: number,
  chartIndex?: number,
  { untilExhausted = false, maxAttempts = MAX_HISTORY_LOAD_ATTEMPTS }:
    { untilExhausted?: boolean; maxAttempts?: number } = {},
) {
  if (!Number.isSafeInteger(count) || count < 0 || (untilExhausted && count === 0)) {
    throw new Error("additional history count must be a nonnegative safe integer (positive until exhausted)");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_HISTORY_LOAD_ATTEMPTS) {
    throw new Error(`history maxAttempts must be between 1 and ${MAX_HISTORY_LOAD_ATTEMPTS}`);
  }
  const loads: HistoryLoadResult[] = [];
  let addedBars = 0;
  let initialBars: number | null = null;
  let previousBars: number | null = null;
  let consecutiveEmptyLoads = 0;
  let stopReason: HistoryLoadStopReason = count === 0 ? "requested_count_reached" : "attempt_limit";
  for (let attempt = 0; attempt < maxAttempts && (untilExhausted || addedBars < count); attempt += 1) {
    const requested = Math.min(MAX_ADDITIONAL_HISTORY_LOAD_CHUNK, untilExhausted ? count : count - addedBars);
    const loaded = await tv.loadMoreHistory({ count: requested, chartIndex });
    loads.push(loaded);
    if (![loaded.barsBefore, loaded.barsAfter, loaded.added].every(Number.isSafeInteger) ||
        loaded.barsBefore < 0 || loaded.added < 0 || loaded.barsAfter - loaded.barsBefore !== loaded.added) {
      throw new Error("history load returned invalid bar counts");
    }
    initialBars ??= loaded.barsBefore;
    previousBars ??= initialBars;
    if (loaded.barsBefore < previousBars) throw new Error("history shrank between load requests");
    // A prior asynchronous request can finish after its reply but before this request starts.
    // Include those bars, even when this request's own added field is zero.
    const observedGrowth = loaded.barsAfter - previousBars;
    addedBars = loaded.barsAfter - initialBars;
    previousBars = loaded.barsAfter;
    consecutiveEmptyLoads = observedGrowth > 0 ? 0 : consecutiveEmptyLoads + 1;
    if (!untilExhausted && addedBars >= count) {
      stopReason = "requested_count_reached";
      break;
    }
    // moreAvailable may be false even on a transient empty response, or while bars are growing.
    if (consecutiveEmptyLoads >= MAX_CONSECUTIVE_EMPTY_HISTORY_LOADS) {
      stopReason = "consecutive_empty";
      break;
    }
  }
  return { loads, addedBars, stopReason, requestedBars: count,
    requestedCountReached: untilExhausted ? null : addedBars >= count };
}

export type AdditionalHistoryLoad = Awaited<ReturnType<typeof loadAdditionalHistory>>;

export function summarizeHistoryLoad(history?: AdditionalHistoryLoad | null) {
  if (!history) return { requestedBars: 0, attempts: 0, addedBars: 0,
    moreAvailable: null, stopReason: null, requestedCountReached: null };
  return {
    requestedBars: history.requestedBars,
    attempts: history.loads.length,
    addedBars: history.addedBars,
    moreAvailable: history.loads.at(-1)?.moreAvailable ?? null,
    stopReason: history.stopReason,
    requestedCountReached: history.requestedCountReached,
  };
}

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
  let attempts = 0;
  let stopReason: HistoryLoadStopReason = "requested_count_reached";
  for (let attempt = 0; attempt < MAX_HISTORY_LOAD_ATTEMPTS && !done(history); attempt += 1) {
    const barsBefore = history.bars.length;
    // Ask for the shortfall while the bar count is unmet, exactly as before. Only when the count is
    // already met and the reach-back is what is short does the shortfall stop being a useful number,
    // and then a full chunk is the request.
    const barsShort = requiredBars - barsBefore;
    const chunk = barsShort > 0 ? Math.min(barsShort, MAX_HISTORY_LOAD_CHUNK) : MAX_HISTORY_LOAD_CHUNK;
    const loaded = await tv.loadMoreHistory({ count: chunk, chartIndex });
    attempts += 1;
    // The read stays pinned to requiredBars unless a reach-back is being chased, so a caller that
    // named no start gets the same bars it always did.
    if (reachBackMs !== null) requested = Math.max(requested, barsBefore + chunk);
    history = await tv.getOhlcv(requested, chartIndex);
    moreAvailable = loaded.moreAvailable;
    stopReason = done(history) ? "requested_count_reached" : "attempt_limit";
    if (history.bars.length > barsBefore) {
      consecutiveEmptyLoads = 0;
      continue;
    }
    consecutiveEmptyLoads += 1;
    // TradingView may briefly report no pagination immediately after a chart change.
    if (consecutiveEmptyLoads >= MAX_CONSECUTIVE_EMPTY_HISTORY_LOADS && !done(history)) {
      stopReason = "consecutive_empty";
      break;
    }
  }
  const reachesBack = reaches(history);
  return {
    history,
    historyLoad: {
      targetKind: "total_bars" as const,
      requestedBars: requiredBars,
      attempts,
      // Growth in the returned OHLC window, which is capped at requiredBars without reach-back.
      addedBars: Math.max(0, history.bars.length - initial.bars.length),
      moreAvailable,
      stopReason,
      requestedCountReached: history.bars.length >= requiredBars,
      sufficient: done(history),
    },
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
