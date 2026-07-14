export type IndicatorObservation = {
  study_id: string;
  symbol: string;
  resolution: string;
  bars: Array<{ time: number; values: Record<string, number | string | null> }>;
};

export type IndicatorRestartDiff = {
  status: "stable" | "changed" | "insufficient_overlap" | "incompatible";
  matched_bars: number;
  compared_values: number;
  changed_values: Array<{ time: number; plot: string; before: unknown; after: unknown }>;
};

/** Compare closed-bar observations captured before and after a chart restart/reload. */
export function compareIndicatorObservations(
  before: IndicatorObservation,
  after: IndicatorObservation,
  epsilon = 1e-10,
): IndicatorRestartDiff {
  if (before.study_id !== after.study_id || before.symbol !== after.symbol || before.resolution !== after.resolution) {
    return { status: "incompatible", matched_bars: 0, compared_values: 0, changed_values: [] };
  }
  const afterByTime = new Map(after.bars.map((bar) => [bar.time, bar]));
  const changedValues: IndicatorRestartDiff["changed_values"] = [];
  let matchedBars = 0;
  let comparedValues = 0;
  for (const baseline of before.bars) {
    const current = afterByTime.get(baseline.time);
    if (!current) continue;
    matchedBars += 1;
    const plots = new Set([...Object.keys(baseline.values), ...Object.keys(current.values)]);
    for (const plot of plots) {
      const prior = baseline.values[plot] ?? null;
      const next = current.values[plot] ?? null;
      comparedValues += 1;
      const bothNumbers = typeof prior === "number" && typeof next === "number";
      const equal = bothNumbers ? Math.abs(prior - next) <= epsilon : Object.is(prior, next);
      if (!equal) changedValues.push({ time: baseline.time, plot, before: prior, after: next });
    }
  }
  if (matchedBars === 0) return { status: "insufficient_overlap", matched_bars: 0, compared_values: 0, changed_values: [] };
  return {
    status: changedValues.length === 0 ? "stable" : "changed",
    matched_bars: matchedBars,
    compared_values: comparedValues,
    changed_values: changedValues,
  };
}
