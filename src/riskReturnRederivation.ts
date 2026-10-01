import type { BarSeries, BarSeriesStore } from "./barSeries.js";
import type { ForecastSet, ForecastValue } from "./forecastSet.js";
import type { ProxySet } from "./proxySet.js";
import { computeRealizedCovariance } from "./realizedCovariance.js";
import { RealizedCovarianceError } from "./realizedCovarianceRules.js";
import { RiskBacktestError } from "./riskForecastBacktest.js";
import type { ZoneResolver } from "./zonedTime.js";

/**
 * backtest_risk_forecast's signed returns (docs/RISK_FORECAST_BACKTEST_DESIGN.md, "Where the signed returns come from",
 * R1; plan step 4). The joined forecast set holds realized covariance and r·rᵀ, so the sign of each day's return is
 * gone. The bars that produced the proxies are hashed and stored, so the tool recomputes the run from them with the
 * proxy set's stored rules and uses the returns only if every recomputed value equals the stored proxy set. Nothing the
 * caller supplies enters them.
 */

/** The proxy set's arrays over the forecast set's run. */
export interface ProxyRun {
  dates: string[];
  windows: { from: string; to: string }[];
  rc: ForecastValue[];
  daily_outer: ForecastValue[];
  common_slots: number[];
  expected_slots: number[];
  drop_cause: (string | null)[];
}
export interface Recomputed extends ProxyRun {
  returns: (number[] | null)[];
}

/** The run of the proxy set's dates that the forecast set covers; verification has already checked it is contiguous. */
export function proxyRunOf(proxySet: ProxySet, set: Pick<ForecastSet, "dates">): ProxyRun {
  const start = proxySet.dates.indexOf(set.dates[0]);
  const end = start + set.dates.length;
  if (start < 0 || end > proxySet.dates.length || proxySet.dates[end - 1] !== set.dates[set.dates.length - 1]) {
    throw new RiskBacktestError("returns_rederivation_mismatch", `${set.dates[0]} date`);
  }
  const slice = <T>(values: T[]) => values.slice(start, end);
  return {
    dates: slice(proxySet.dates), windows: slice(proxySet.windows), rc: slice(proxySet.rc), daily_outer: slice(proxySet.daily_outer),
    common_slots: slice(proxySet.common_slots), expected_slots: slice(proxySet.expected_slots), drop_cause: slice(proxySet.drop_cause),
  };
}

const FIELDS = [
  ["date", "dates"], ["window", "windows"], ["rc", "rc"], ["daily_outer", "daily_outer"], ["common_slots", "common_slots"],
  ["expected_slots", "expected_slots"], ["drop_cause", "drop_cause"],
] as const;

/**
 * The comparison (design F8), pure so that a tampered recomputation can be passed to it directly in tests. Per date,
 * every field in normalized JSON form, so a recomputed −0 equals a stored 0; then the stored daily_outer against r_i·r_j
 * formed from the exposed vector, which catches a misaligned or permuted vector. The first differing date, and in it
 * the first field in this order, is named: `returns_rederivation_mismatch: <date> <field>`.
 */
export function checkRederivation(run: ProxyRun, recomputed: Recomputed): void {
  const fail = (date: string, field: string): never => { throw new RiskBacktestError("returns_rederivation_mismatch", `${date} ${field}`); };
  if (recomputed.dates.length !== run.dates.length || recomputed.returns.length !== run.dates.length) fail(run.dates[0], "date");
  for (let d = 0; d < run.dates.length; d++) {
    for (const [name, key] of FIELDS) {
      if (JSON.stringify(run[key][d]) !== JSON.stringify(recomputed[key][d])) fail(run.dates[d], name);
    }
    const r = recomputed.returns[d];
    const stored = run.daily_outer[d];
    const outer = r === null ? null : r.length === 1 ? r[0] * r[0] : r.map((x) => r.map((y) => x * y));
    if (JSON.stringify(outer) !== JSON.stringify(stored)) fail(run.dates[d], "returns");
  }
}

export interface RederivationInput {
  set: Pick<ForecastSet, "dates">;
  proxySet: ProxySet;
  barSeries: Pick<BarSeriesStore, "get">;
  /** The resolver the proxy-set verification used, so the two cannot disagree. */
  resolver?: ZoneResolver;
}

/** Recompute the run, check it, and return its returns with the span the computation read. */
export async function rederiveReturns({ set, proxySet, barSeries, resolver }: RederivationInput) {
  const run = proxyRunOf(proxySet, set);
  const series: { artifact_id: string; bars: BarSeries }[] = [];
  for (const artifact_id of proxySet.bar_series) {
    const bars = await barSeries.get(artifact_id).catch((error: NodeJS.ErrnoException): never => {
      if (error?.code === "ENOENT") throw new RiskBacktestError("bar_series_not_found", artifact_id);
      throw error;
    });
    series.push({ artifact_id, bars });
  }
  let computed;
  try {
    computed = computeRealizedCovariance({ rules: proxySet.rules, rules_sha256: proxySet.rules_sha256, from_date: run.dates[0],
      to_date: run.dates[run.dates.length - 1], series, resolver }, { includeReturns: true });
  } catch (error) {
    if (error instanceof RealizedCovarianceError) {
      throw new RiskBacktestError("returns_rederivation_mismatch", `${run.dates[0]} recomputation (${error.message})`);
    }
    throw error;
  }
  const returns = computed.returns as (number[] | null)[];
  checkRederivation(run, { ...computed.proxy, returns });
  return { returns, span: computed.envelope };
}
