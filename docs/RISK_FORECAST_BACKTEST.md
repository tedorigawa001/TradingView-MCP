# Risk Forecast Backtest

`backtest_risk_forecast` takes the two variance or covariance forecasts, A and B, of a forecast set
joined to a [realized-covariance proxy set](REALIZED_COVARIANCE.md), and one portfolio weight
vector. It answers two questions:
- **The VaR coverage tests.** Are the forecasts' 1% and 5% VaR hits as frequent as nominal? Do they
  cluster?
- **Ex-post volatility targeting.** What would a position sized by the forecast have done: its
  realized volatility against the target, its drawdown, and the leverage it carried, including into
  rising volatility, where a lagging forecast overshoots?

It is **not** a trading backtest: there are no costs, no execution and no fills, and the position
is a fixed-weight portfolio rescaled once a day. It is **not** evidence of a correct risk model: a
test that does not reject says only that this hit sequence of this length did not contradict the
nominal rate. It is **not** a ranking: A and B are reported side by side, and neither is called
better.

The contract is `risk_forecast_backtest_v1`. `candidateEligible` and `unused_proven` are always
false. The levels, the tests and the Monte Carlo are fixed; nothing in them can be set per call. The
tool reads no chart, places no orders and takes no file paths. The design and its review history
are in [RISK_FORECAST_BACKTEST_DESIGN.md](RISK_FORECAST_BACKTEST_DESIGN.md).

## Workflow

1. Import each bar series with `tradingview-mcp-import-bar-series`.
2. Call `compute_realized_covariance`; it stores a proxy set.
3. Join your forecasts to it with `tradingview-mcp-import-forecast-set --proxy-set`. Join from the
   first date on which the forecasts exist: dates before it are own nulls, and a warm-up of about 22
   dates blocks any run of 2,100 return dates or fewer (see [Days](#days)).
4. Call `backtest_risk_forecast` with the joined set's `artifact_id`, `weights` and
   `target_annual_vol`, and, to keep a record, `research_id`.

**The CLIs and the MCP process must use the same paths.** Set every variable below identically for
the CLIs and the MCP server, or leave them all at their defaults:

| Variable | Default | Used by |
|---|---|---|
| `TRADINGVIEW_MCP_BAR_SERIES_DIR` | `~/.tradingview-mcp/bar-series` | bar import, `compute_realized_covariance`, this tool |
| `TRADINGVIEW_MCP_PROXY_SET_DIR` | `~/.tradingview-mcp/proxy-sets` | `compute_realized_covariance`, export, join, comparison, this tool |
| `TRADINGVIEW_MCP_REALIZED_COVARIANCE_JOURNAL_PATH` | `~/.tradingview-mcp/realized-covariance-journal.jsonl` | `compute_realized_covariance`, join, comparison, this tool |
| `TRADINGVIEW_MCP_FORECAST_SET_DIR` | `~/.tradingview-mcp/forecast-sets` | join, comparison, this tool |
| `TRADINGVIEW_MCP_RISK_BACKTEST_JOURNAL_PATH` | `~/.tradingview-mcp/risk-backtest-journal.jsonl` | this tool only |

## Input

A strict object; any other field is an error:

| Field | Content |
|---|---|
| `artifact_id` | A stored forecast set whose `source_id` is `proxy-set:<hex>`, written by the `--proxy-set` join. A plain set is refused (`risk_backtest_requires_proxy_set_source`). |
| `weights` | n finite numbers, not all zero, in the set's series order. They are divided by max\|wᵢ\| and then by Σ\|wᵢ\|, and echoed. Hits, tests and position returns do not depend on their scale; leverage is then gross exposure per unit of capital. |
| `target_annual_vol` | `{value, unit}`: `value` positive and finite; `unit` is `log` or `log_percent` and must equal the proxy set's `return_unit` (`target_unit_mismatch`), so a 10 meant as 0.10 cannot pass. |
| `research_id` | Optional; writes period usage (see [Records](#records)) |
| `usage_access_id` | Optional, 1–100 characters, only with `research_id`; makes the period-usage records idempotent on retry |

The set is checked in this order, which also decides which error comes first: the forecast-set
store, the source, the weights, the verification against the proxy set (as in
`compare_forecast_losses`), the target unit, then the re-derivation of the returns.

## Signed returns

VaR hits and drawdowns need each day's signed portfolio return. The joined set does not hold it: its
primary proxy is realized covariance and its secondary is the daily outer product r·rᵀ, so the sign
is gone. The tool therefore re-derives the returns from the bars that produced the proxies:
- it loads the bar series the proxy set names (a missing one is `bar_series_not_found`);
- it recomputes the forecast set's run with the proxy set's stored rules, under the same time-zone
  data the verification used;
- for every date of the run it requires the recomputed date, window, `rc`, `daily_outer`, slot
  counts and drop cause to equal the stored proxy set, in normalized JSON form, and the stored
  `daily_outer` to equal rᵢ·rⱼ formed from the returned vector. The first difference is
  `returns_rederivation_mismatch: <date> <field>`; a recomputation that cannot run, for example
  because the bars no longer cover the run, is the same error with its cause.

So nothing the caller supplies enters the returns, and returns edited after seeing the hits cannot
pass. The bars are hashed, which authenticates their content, not their source
(`returns_rederived_from_imported_bars_not_source_authenticated`).

**Under `within_day` rules** a day's return starts at its first common slot's close: it leaves out
that first bar and the weekend or holiday gap before it, where tail losses concentrate. The response
then adds `within_day_returns_exclude_first_interval_and_gaps`.

## Days

The run is the forecast set's dates. Two budgets are kept apart:
- **Missing returns.** A date whose proxy day was dropped has no return. These depend on the bars
  and the rules, not on the forecaster. The result is `not_evaluable` if more than 10% of the run's
  dates are missing (`more_than_10_percent_of_returns_missing`), or else if fewer than 250 dates have
  a return (`fewer_than_250_return_days`). The holiday cascade under `from_previous_endpoint`, about
  7%, fits. `days` reports the missing dates by cause, T (the dates with a return) and
  `chain_breaks`.
- **Own forecast nulls.** Each forecast is evaluated on every date with a return. A forecast that
  is null, invalid under `compare_forecast_losses`' validity rule (finite, symmetric within
  1e-12·max|S|, positive-definite), or whose w'Σ̂w is not finite and positive, is an own null
  there.
  - If a forecast has more than ⌈T/100⌉ own nulls it is `blocked_by_forecast_nulls`: no tests and
    no metrics. The other forecast is unaffected.
  - The other forecast's nulls never remove a date: A's results are the same whether B is null,
    valid or absent.
  - Every VaR test is evaluated twice, with the own nulls as hits and as non-hits (below).

`scale_check` gives, per forecast, the median over dates with a valid forecast and w'RC w > 0 of
σ̂²/(w'RC w). It flags `forecast_scale_differs_from_proxy_by_over_10x` when the median is below 0.1
or above 10. That catches log against log_percent, a factor of 10⁴, not every unit error: a
volatility entered as a variance in `log_percent` gives a ratio near 1–2. A not-evaluable response
carries `days` and `scale_check`, and no tests or metrics.

## VaR hits and coverage tests

For a forecast on a date with a return:
- the portfolio return is r_p = Σᵢ wᵢ·rᵢ and σ̂ = √(w'Σ̂w), with zero mean assumed;
- the VaR threshold at level α is z_α·σ̂, with the correctly rounded quantiles
  z₀.₀₁ = −2.326347874040841 and z₀.₀₅ = −1.6448536269514726;
- a hit is r_p < z_α·σ̂, strictly. An own null is a hit in the **as-hits** case and not in the
  **as-non-hits** case.

Per forecast and level (`var`, one entry per level), over the T dates with a return:
- **Counts:** T, the hits as `without_own_nulls` and `with_own_nulls`, the expected αT,
  `expected_hits_below_10`, and `direction` in each case: `too_many`, `too_few` or `as_expected`.
- **Kupiec (unconditional coverage):** LR_uc = 2·[x·ln(π̂/α) + (T − x)·ln((1 − π̂)/(1 − α))], with
  π̂ = x/T.
- **Christoffersen independence:** transitions are counted between consecutive dates with a return;
  a missing return breaks the chain. LR_ind = 2·Σ n_ij·ln((n_ij·N)/(m_i·c_j)) over the cells with
  n_ij > 0, from exact integer products, so equal conditional and marginal rates give exactly 0.
  `independence_uninformative` is set when fewer than 2 transitions start from a hit.
- **Conditional coverage:** LR_cc = LR_uc + LR_ind.
- All three are computed through a port of fdlibm's log, so every statistic and result is the same
  on every CPU, and clamped at 0.

Each test reports, per case, the statistic, an asymptotic χ² p-value (1 degree of freedom, or 2 for
LR_cc) and a **Monte Carlo** p-value. Only the Monte Carlo p-value decides the result:
- N = 9,999 draws per stream; p = (1 + #{draw ≥ observed})/(N + 1); a test rejects when p ≤ 0.05,
  decided in integers. The size is at most 5%, and below it where the statistic has ties.
- **Coverage (LR_uc, LR_cc):** hit sequences of independent Bernoulli(α) hits over the same dates
  and chain breaks, one stream per level.
- **Independence (LR_ind):** the observed hits placed at uniformly random dates, keeping the chain
  breaks; one stream per forecast, level and own-null case. Simulating it at α instead would make a
  forecast that hits too often look clustered.
- The streams come from the repository's seeded generator, with seeds fixed by the contract.

**Results.** Each test has one `result`:
- `rejected` when it rejects in both own-null cases;
- `not_rejected` when it rejects in neither, or `not_rejected_underpowered` when also αT < 10. With
  250 dates at 1%, αT is 2.5, and a non-rejection says almost nothing;
- `indeterminate_due_to_own_nulls` when the cases split: the own nulls then decide the answer, and
  none is given. Nulling the dates where a forecast misses cannot remove hits (the as-hits case),
  and nulling other dates cannot add them (the as-non-hits case).
- Two refinements:
  - LR_uc is decided against the Kupiec non-rejection region: rejected only if [x₀, x₀ + m] lies
    wholly outside it, not rejected only if wholly inside, and otherwise indeterminate.
  - LR_cc is indeterminate when both cases reject with opposite directions. When neither rejects,
    the general rule gives `not_rejected` (or `not_rejected_underpowered`): by convexity, LR_uc at
    any count in between is at most the larger of the two cases' values. As for LR_ind, the two
    cases cover the two cheap attacks, not every placement of the nulls.

**The Kupiec non-rejection region**, `kupiec_non_rejection_region`, is the interval of hit counts
whose Monte Carlo p for LR_uc exceeds 0.05. It shows how far from αT the count could have been without
a rejection, and where [x₀, x₀ + m] lies against it.

`tests_reported` is 12 with both forecasts evaluated (2 forecasts × 2 levels × 3 tests), each with
its p-values in both cases. There is no multiplicity correction.

## Volatility targeting

Per evaluated forecast, `vol_target`:
- **Target and leverage.** With P = 52 × |`day_weekdays`| (260 for Mon–Fri), the daily target is
  σ* = value/√P and the leverage is L = σ*/σ̂, **uncapped**, so the build-up is visible. On an own
  null the leverage of the most recent date with a valid forecast is carried, across missing returns
  too; before the first valid forecast the position is flat. `own_null_dates_with_carried_leverage`
  counts the carried dates. L is computed as σ*·(1/σ̂), and its statistics as σ* times those of
  1/σ̂, so they are +∞ (null in JSON) only where the value itself is beyond the largest double.
- **Realized volatility against the target** (`realized_to_target`), in log space with
  p_t = L_t·r_p,t:
  - from daily returns, √(P·mean(p_t²)), zero-mean like the VaR;
  - from the intraday proxy, √(P·mean(L_t²·w'RC_t w)), which is far less noisy.

  Each is given annualized and as a ratio to the target. As σ*·√P = value, each ratio equals
  √(mean((x_t/σ̂_t)²)) exactly, with x_t = r_p,t or √(w'RC_t w), and is computed that way, scaled
  so that no square overflows: it is the same for every target. The annualized value is the ratio
  times the target, again +∞ only beyond the largest double. w'RC w below 0, which rounding can leave on a hedged portfolio of series that
  move together, counts as 0 here, in the scale check and in the regime view.
- **Drawdown**, from compounded simple returns R_t = L_t·Σᵢ wᵢ·(exp(rᵢ/s) − 1), with s = 100 for
  `log_percent` and 1 for `log`; wealth starts at 1. It is held relative to its running peak, so a
  run of gains at a large leverage cannot overflow it.
  - If 1 + R_t ≤ 0 the position is **ruined** on that date (`ruined_on`). Wealth stays 0, the
    maximum drawdown is 1, and it is underwater to the end.
  - Otherwise the report gives the maximum drawdown as a fraction of the running peak, its peak and
    trough dates, the longest underwater stretch in dates with a return, and whether it is underwater
    at the end. The starting wealth counts as a peak: when the drawdown is measured from it,
    `peak_date` is null.
  - It also gives the own-null dates within the peak-to-trough stretch.
- **Leverage:** mean, median, nearest-rank 95th percentile, and maximum with its first date.
- **Regime view** (`regime_view`), by a quantity known before each day:
  - g_t is the mean of w'RC w over the 5 earlier dates with a return, divided by its mean over the
    60 earlier ones. Dates without 60 earlier return dates, or with a zero 60-date mean, are
    excluded (`excluded_dates`).
  - The rest are sorted by g_t and split into three equal groups by index: `falling`, `steady` and
    `rising`.
  - Per group: dates, mean leverage, both realized-to-target ratios, the hit rate at each level (on
    dates with a valid forecast), and the own-null dates.
  - **For a correct forecast, both ratios are near 1 and the hit rates near α in every group.** A
    forecast that lags, such as EWMA, overshoots in `rising` (ratios above 1, excess hits) and
    undershoots in `falling`. Mean leverage differs across groups for any forecast that tracks
    volatility, so it is no signature. Grouping by the same day's realized variance would show a
    false lag even for a perfect forecast, which is why the groups use earlier dates only.
- **Worst days** (`worst_days`): the 10 most negative R_t (equal values in date order), each with its
  date, position return, leverage, and the leverage's percentile (r − 0.5)/T among all dates with a
  return, with ties at their mean rank. The mean percentile is about 0.5 for a forecast that carries
  no unusual leverage into its worst days, and higher for one that lags. The own-null dates among the
  10 are counted.
- **Sub-periods:** 4 consecutive blocks of the dates with a return, each with its first and last
  date, the date count, mean leverage, both ratios, hit rates and own-null dates, in that order; the
  regime groups have the same fields without the first and last date.

## Response

In this order:
- `contract`, `candidateEligible: false`, `unused_proven: false`;
- `input`: the set ID, its `evidence_tier`, `source_id`, the proxy-set ID, the series IDs, the run's
  first and last dates, the normalized weights, the target with its unit, and `periods_per_year`;
- `days`;
- `scale_check`;
- `forecasts`: `a` and `b`, each `evaluated` (own nulls, carried dates, `var`, `vol_target`) or
  `blocked_by_forecast_nulls` (own nulls and the cap); null when not evaluable;
- `tests_reported`;
- `search` and `period_usage` (see [Records](#records));
- `limitations`.

## Records

**Period usage**, with `research_id`, is written before the journal and the response, as one batch
of `tool_observed` records with the tool name `backtest_risk_forecast` and the scope
`risk_backtest_bar_window_only`:
- index 0 is the set's source, `forecast-set-source:` plus the hex digest of its `source_id`, with
  the forecast-set ID as `data_version`;
- the underlying series follow, each with the bar-series artifact actually read as `data_version`;
- every record carries the **span the re-derivation read**: from the bar opening one interval
  before the first date's previous endpoint (`from_previous_endpoint`), or from the first date's
  window start (`within_day`), to the last date's endpoint. With `from_previous_endpoint` that is
  one bar wider than the forecast set's window envelope; with `within_day` they are the same;
- access IDs are `<base>:<index>`, with `usage_access_id` or a generated `risk-access:<uuid>` as the
  base. The request hash binds the set, the contract, the normalized weights and the target, so a
  retry whose weights normalize to the same vector is idempotent, and another weight vector or
  target conflicts. Weights that differ only in scale usually normalize to the same vector, but not
  always to the last bit (`[0.1, 0.3]` against `[1, 3]`); such a retry conflicts, the safe direction;
- each record carries `overlapped_forward_period_declarations`, and `search` adds
  `period_usage_prior_overlap`, the records' `prior_overlap` in summary form with
  `active_forward_period_declarations` per series ([FORWARD_PERIOD.md](FORWARD_PERIOD.md)).

Without `research_id`, `period_usage` is `{status: "untracked"}` and nothing is written to the
ledger.

**The search journal** records every call that reaches it, evaluated or not, with or without
`research_id`. A call that fails before it, at any check above or at the period write (for example a
`usage_access_id` conflict), is not journaled. Each record holds the forecast-set, proxy-set and bar-series IDs, the rules hash, the run, the span read,
the hashes of A and B over the run, the normalized weights with their hash, the target, and per
forecast its own nulls and each level's hits and three results. It is written after period usage
and before the response; if it fails, the error returns no statistics and names any period records
already written. It uses the owner-only append-only log with strict framing, like the other
journals.

`search` counts, over journal records that share an underlying series and whose read spans overlap
(half-open), this call included:
- `this_research_id`: calls, distinct weight vectors, distinct A and distinct B hashes, and
  `earlier_no_rejection` per level: earlier calls with an evaluated forecast and no `rejected`
  result. A not-evaluable call, or one with both forecasts blocked, is never counted there. Without
  `research_id` this scope is `{status: "untracked"}`;
- `overlapping_data`, under any research ID: calls, untracked calls, distinct research IDs, distinct
  weight vectors, distinct forecast hashes (A and B together) and `earlier_no_rejection`;
- `proxy_rule_variants` and `proxy_bar_series_versions`: the distinct rules and bar-series tuples in
  the realized-covariance journal over the span read. The rules and bar versions decide the returns
  and the missing dates themselves.

The target is recorded but not counted: hits, tests and every realized-to-target ratio are invariant
to it. Trying weight vectors or forecast variants until a coverage test stops rejecting stays
visible. The counts cover this local journal only.

## Errors

In the order they are checked:
- the forecast-set store errors;
- `risk_backtest_requires_proxy_set_source`;
- `weights_invalid`: the wrong length, a non-finite value, or all zero;
- the proxy-set verification errors and `proxy_set_mismatch`, as in `compare_forecast_losses`;
- `target_unit_mismatch`;
- `bar_series_not_found`, `returns_rederivation_mismatch`;
- after period usage was written, a journal failure, whose message names the period records.

## Limitations

Always returned:
- `var_from_forecast_variance_under_normal_quantile_zero_mean`
- `coverage_non_rejection_is_not_evidence_of_a_correct_risk_model`
- `hit_tests_use_one_hit_sequence_of_this_length`
- `one_realized_history_not_forward_evidence`
- `tests_reported_without_multiplicity_correction`
- `own_nulls_evaluated_both_as_hits_and_as_non_hits`
- `series_returns_combined_without_currency_conversion`
- `forecasts_and_their_timing_are_caller_supplied_and_unverified`
- `forecast_units_and_variance_vs_volatility_are_caller_asserted`
- `vol_targeting_is_ex_post_without_costs_or_execution`
- `leverage_uncapped`
- `position_pnl_on_return_missing_dates_omitted`
- `returns_rederived_from_imported_bars_not_source_authenticated`
- `search_counts_cover_this_journal_only`
- `expected_shortfall_not_assessed`

With `within_day` rules: `within_day_returns_exclude_first_interval_and_gaps`.

The forecasts are the caller's: the tool cannot check that a forecast for a date used only data
known before it. A forecast evaluated on one historical path is not forward evidence; to evaluate
one forward, declare the period first ([FORWARD_PERIOD.md](FORWARD_PERIOD.md)).

## Performance

`node scripts/benchmark-risk-backtest.mjs` (after `npm run build`) uses 8 series of about 383,000
M15 bars each and a joined set of 4,000 dates of 8×8 matrices. Both forecasts have 31 own nulls,
within the cap of 40, so all ten Monte Carlo streams are drawn: the worst case. On the development
machine, at a load average of about 6 on 10 cores:
- reading the set and verifying it against the proxy set took about 0.5 s;
- re-deriving the returns from the bars about 1.8 s (target 3 s);
- the evaluation, Monte Carlo included, about 1.5 s (target 4 s);
- the journal write about 15 ms; the whole call about 3.8 s (target 8 s).

Times depend on the machine and its load; a run beside other test processes took two to three times
as long.

The benchmark is outside the unit suite, so tests never depend on timing. The Monte Carlo sizes are
checked by hand with `node scripts/check-risk-backtest-size.mjs` (about a minute).

## Downgrading

- A version before 0.1.17 rejects the tool name `backtest_risk_forecast` in period-usage records.
  After the first tracked call, every period-usage read or write under that version fails closed,
  including the ledger, forecast-loss, realized-covariance and forward-period tools.
- Older versions ignore the search journal.
