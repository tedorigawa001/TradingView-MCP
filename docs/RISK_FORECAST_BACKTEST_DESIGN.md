# backtest_risk_forecast: design memo (rev 2.4, design review approved; implemented)

Backlog #101, item 3.

Review history:
- rev 1: BLOCK. HIGH F1–F3, MEDIUM F4–F5, LOW F6–F11, NIT F12.
- rev 2: BLOCK, narrow. HIGH N1, LOW N2, NIT N3. F1–F12 were resolved, except that the F1 fix
  opened N1.
- rev 2.1 (diff check): APPROVE WITH FINDINGS. LOW P1 and NITs P2–P3, folded in as rev 2.2.
- plan review: one design gap (Q3), folded in as rev 2.3, and a corrected test statement from the
  plan's diff check (R1).
- code review of the implementation: APPROVE WITH FINDINGS. MEDIUM C1 was this memo's own LR_cc
  rule, corrected as rev 2.4: indeterminate only when both cases reject with opposite directions.
  Rev 2.4 also corrects two counts (C6): the warm-up example and the one-bar difference.

Rev 2 folds in F1–F12:
- own nulls count as hits, with a cap (F1), so `forecasts` is no longer an input;
- the independence test's Monte Carlo is a permutation conditional on the hit count (F2);
- the regime view groups days by a quantity known before the day (F3);
- separate budgets for missing returns and forecast nulls (F4);
- the journal record and the `search` counts are specified (F5);
- the span read is what is recorded (F6);
- the statistics are computed in a form that cannot go negative (F7);
- the re-derivation is compared in JSON form and checks the exposed returns (F8);
- the non-rejection region and an `underpowered` result (F9);
- more limitations (F10);
- compounded drawdown and ruin (F11);
- the pinned definitions (F12).

Rev 2.1 folds in N1–N3: every test is evaluated with own nulls both as hits and as non-hits, and a
split is reported as `indeterminate_due_to_own_nulls` (N1); own nulls are counted where they could
shape the volatility-targeting results (N2); and the remaining pins (N3). Rev 2.2 folds in P1–P3:
an own-null interval that straddles the Kupiec non-rejection region is indeterminate, not rejected
(P1), and two corrections of wording. Rev 2.3 adds `period_usage_prior_overlap` to `search`, as the
other observing tools return it (plan review Q3).

## Problem

The FX covariance study (#100) compared a two-state HMM covariance forecast with RiskMetrics EWMA
(λ 0.94) under QLIKE. As a side note it reported 1% VaR hit rates, HMM2 0.94% and EWMA 2.09%,
computed by hand in the study's scripts. Nothing could be concluded from them:
- there was no coverage test, so 2.09% against 1% had no stated significance;
- there was no test of whether hits cluster, which is the usual failure of a lagging forecast;
- nothing showed what the forecast does to a position sized by it. An EWMA forecast lags: when
  volatility rises after a calm stretch, it still forecasts low variance, so a volatility-targeted
  position carries too much leverage into the rise and its realized volatility overshoots the
  target.

`compare_forecast_losses` (item 2) ranks forecasts by a loss. It says nothing about whether a
forecast's quantiles are calibrated or what it does to a position. This tool answers those two
questions on the same joined forecast sets, with the same discipline: fixed tests, no verdict that
a forecast is correct, `candidateEligible: false`, and every call counted.

## What it is not

- Not a trading backtest. There are no costs, no execution and no fills, and the position is a
  fixed-weight portfolio rescaled once a day.
- Not evidence of a correct risk model. A coverage test that does not reject says only that one
  hit sequence of this length did not contradict the nominal rate.
- Not a ranking of A against B. Both are reported side by side, and neither is called better.

## Scope (v1)

- **In:**
  - joined forecast sets (`proxy-set:` sources); both forecasts, A and B, are always evaluated;
  - one portfolio weight vector per call;
  - VaR at fixed levels, from the forecast variance under a fixed normal quantile;
  - the Kupiec, Christoffersen independence and conditional coverage tests, with asymptotic and
    Monte Carlo p-values;
  - ex-post volatility-targeting metrics: realized volatility against the target, compounded
    drawdown, leverage, a regime view by a quantity known before each day, and the leverage
    carried into the worst days;
  - period usage and a search journal.
- **Not in v1:**
  - expected shortfall backtests and duration-based tests;
  - other quantile distributions (D2);
  - horizons other than one day;
  - caller-supplied returns (D1), inline sets and plain (non-joined) forecast sets;
  - per-series batteries and per-label results; the set's labels are ignored;
  - costs, leverage caps (D5), position limits and rebalancing rules beyond the daily rescale.

## Where the signed returns come from (D1)

VaR hits and drawdowns need each day's signed portfolio return. The joined forecast set does not
hold it: its primary proxy is realized covariance and its secondary is the daily outer product
r·rᵀ, so w'(r·rᵀ)w = (w'r)² and the sign is gone. Three options:

- **R1, re-derive from the proxy set's bars (recommended).** The proxy set names its bar-series
  artifacts, rules and range. The tool loads those bars and reruns `computeRealizedCovariance`
  with the stored rules over the forecast set's run, from its first to its last date. The
  computation already produces r_D per series; it is exposed internally and never stored.
  - **The check (F8).** Before any return is used, for every date of the run:
    - the recomputed date, window, `rc`, `daily_outer`, `common_slots`, `expected_slots` and
      `drop_cause` must equal the stored proxy set in normalized JSON form, the comparison
      `verifyForecastSetAgainstProxySet` uses. So a recomputed −0 equals a stored 0;
    - the stored `daily_outer` must equal r_i·r_j formed from the exposed r vector, in the same
      JSON form. That catches an exposed vector that is misaligned or permuted.

    Any difference is `returns_rederivation_mismatch`. A global sign flip leaves both checks
    unchanged, so the sign is pinned by a fixture and a mutation test instead.
  - **Why the run alone suffices.** Recomputing over the run gives the same values as over the
    full range. Each day depends only on its own bars and, with `from_previous_endpoint`, the
    previous produced day's endpoint, which the computation reads even before `from_date`.
    `identical_close_pairs` depends on the range and is not compared; the join already rejects
    sets that have any.
  - **What follows.** The returns are the tool's own computation from the hashed bars that
    produced the proxies, with the same windows. Nothing the caller supplies enters them.
  - **Costs.** The bars are read again. The bar series must still be stored
    (`bar_series_not_found`). tzdata drift fails closed first, in the proxy-set verification.
- **R2, caller-supplied returns.** A new import with a `returns` field. It is general (strategy
  returns, other data), but the returns are caller-asserted and could be edited after seeing the
  hits; a hash authenticates nothing about their origin.
- **R3, store r in proxy sets.** Changes a released content-addressed format, so every existing
  proxy-set ID would change. Rejected.

v1 accepts only `proxy-set:` sources (`risk_backtest_requires_proxy_set_source`). R2 can be added
later as its own evidence tier, with its own limitation.

## Input

A strict object:

| Field | Content |
|---|---|
| `artifact_id` | A stored forecast set whose `source_id` is `proxy-set:<hex>`. It is verified exactly as `compare_forecast_losses` verifies one (the same errors), then the returns are re-derived (above). |
| `weights` | n finite numbers, not all zero, in the set's series order. They are divided by max\|wᵢ\| and then by Σ\|wᵢ\|, so huge or tiny values cannot overflow or vanish, and echoed. VaR hits and position returns do not depend on the scale; leverage is then gross exposure per unit of capital. |
| `target_annual_vol` | `{value, unit}`: value > 0 and finite; unit `log` or `log_percent`, which must equal the proxy set's `return_unit` (`target_unit_mismatch`). The explicit unit guards against a 10 meant as 0.10. |
| `research_id`, `usage_access_id` | As in `compare_forecast_losses` |

Any other field is an error. Fixed by the contract, not per call:
- VaR levels 1% and 5% (D3), with the correctly rounded quantiles z₀.₀₁ = −2.326347874040841 and
  z₀.₀₅ = −1.6448536269514726 (90-digit bisection on Φ);
- the annualization factor P = 52 × |`day_weekdays`| from the proxy set's rules (260 for Mon–Fri);
- the Monte Carlo draw count, seeds, generator and draw order (below);
- the day budgets (below).

## Days (F1, F4)

Days are the dates of the forecast set's run. Two budgets are kept separate:

- **Missing returns.** A date whose proxy day was dropped has no return (`return_missing`). It
  depends on the bars and the rules, not on the forecaster. The result is `not_evaluable` if more
  than 10% of the run's dates are missing (`more_than_10_percent_of_returns_missing`) or fewer than
  250 dates have a return (`fewer_than_250_return_days`). The #100 rules cascade to about 7% at
  holidays, so they fit. The response names the drop causes.
- **Own forecast nulls.** Each forecast is evaluated on every date with a return. A forecast that
  is null, invalid under `compare_forecast_losses`' validity rule (finite, symmetric,
  positive-definite), or whose σ̂² = w'Σ̂w is not finite and positive, is an **own null** on that
  date.
  - **Both ways (N1).** Every VaR test is evaluated twice: once with the own nulls as hits and once
    as non-hits (below). Counting nulls only as hits is not a worst case: it stops nulls from hiding
    the hits of a forecast with too many, but lets a forecast with too few hits add hits on dates of
    its choosing. In the review, a forecast with 1.5 times the true σ had no 1% hits over 1,900
    dates and was rejected; nulling 19 spread-out dates (the cap) made all three tests not reject.
    Evaluated both ways, nulls on true-hit dates are undone by the as-hits case, and nulls on other
    dates by the as-non-hits case.
  - If a forecast has more than ⌈T/100⌉ own nulls, with T the dates with a return, that forecast is
    `blocked_by_forecast_nulls`: no tests and no metrics. The other forecast is unaffected.
  - The other forecast's nulls never remove a date. A's results are the same whether B is null,
    valid or absent.
  - Nulls before a forecast's first value are own nulls too. A forecast with a warm-up period should
    be joined from its first forecast date: about 22 warm-up dates would block any run of 2,100
    return dates or fewer.

`scale_check` reports, per forecast, the median over dates with a valid forecast and
w'RC_t w > 0 of σ̂²_t/(w'RC_t w). The flag `forecast_scale_differs_from_proxy_by_over_10x` is set
when the median is below 0.1 or above 10. It catches log against log_percent (a factor of 10⁴), not
every unit error: a volatility entered as a variance in `log_percent` gives a ratio near 1–2. The
tool does not fail on the flag, because a genuinely bad forecast can also be off by that much.

## VaR hits and coverage tests

For forecast F on a date t with a return:
- the portfolio return is r_p,t = Σᵢ wᵢ·r_i,t, summed in series order, and
  σ̂_t = √(Σᵢ Σⱼ wᵢ·Σ̂_F,t,ij·wⱼ), summed row-major over the stored matrix as it is (the validity
  rule has already required it to be symmetric within tolerance);
- the VaR threshold at level α is q_t = z_α·σ̂_t, with zero mean assumed (D2);
- a hit is r_p,t < q_t, strictly. An own-null date is a hit in the **as-hits** case and not a hit
  in the **as-non-hits** case.

Per forecast and level, over the T dates with a return, each statistic below is computed in both
cases; with no own nulls the two cases coincide:
- **Counts:** T, the own nulls m, the hits as the interval [x₀, x₀ + m] (x₀ on the dates with a
  valid forecast), the expected αT, and `direction` in each case: `too_many`, `too_few` or
  `as_expected` (x = αT).
- **Kupiec (unconditional coverage):** LR_uc = 2·[x·ln(π̂/α) + (T − x)·ln((1 − π̂)/(1 − α))] with
  π̂ = x/T. A term with a zero count is 0.
- **Christoffersen independence:**
  - The dates with a return form segments of consecutive run dates; a missing return ends a
    segment. Transitions are counted only within a segment, and `chain_breaks` is the number of
    segments minus 1.
  - n_ij counts transitions from state i to state j, with N = Σn_ij,
    m_i = n_i0 + n_i1 (row totals) and c_j = n_0j + n_1j (column totals).
  - LR_ind = 2·Σ n_ij·ln((n_ij·N)/(m_i·c_j)), over the terms with n_ij > 0 (F7). Numerator and
    denominator are exact integer products (below 2⁵³), so when the conditional and marginal
    rates are equal the ratio is exactly 1 and the term exactly 0.
  - `independence_uninformative` is set when fewer than 2 transitions start from a hit
    (n₁₀ + n₁₁ < 2).
- **Conditional coverage:** LR_cc = LR_uc + LR_ind. It is pinned as that sum because
  implementations differ in whether LR_uc uses all T dates or the transition sample.
- LR_uc, LR_ind and LR_cc are clamped at 0. All logarithms use the fdlibm port, so equal counts give
  bit-identical statistics on every CPU, and so do the ≥ comparisons below.
- **Asymptotic p-values:** χ²(1) for LR_uc and LR_ind, χ²(2) for LR_cc: p = erfc(√(LR/2)) and
  p = exp(−LR/2). They are reported beside the Monte Carlo p-values and never decide a result.
- **Monte Carlo p-values (D6, F2):** N = 9,999 draws per stream, p = (1 + #{draw ≥
  observed})/(N + 1). Two nulls are used:
  - **Coverage (LR_uc, LR_cc):** under H₀ the hits are independent Bernoulli(α). Each draw is a
    hit sequence over the same T dates and segments, with a hit when u < α for a uniform u. Draws
    are sequence-major: draw 1's T values first, then draw 2's. One stream per level serves LR_uc
    and LR_cc, for A and B and for both own-null cases, because this null depends on neither the
    forecast nor the observed hits.
  - **Independence (LR_ind):** H₀ leaves the hit rate free, so simulating at α would mix a coverage
    failure into the clustering result. With independent Bernoulli(α), a forecast hitting at 2%
    against 1% made the independence flag fire about twice as often as nominal, with no
    clustering at all (review simulation). Each draw instead places the observed x hits at x
    uniformly chosen dates among the T, by a partial Fisher–Yates shuffle (position i takes index
    i + ⌊u·(T − i)⌋), keeping the segments. The index array is reset to 0, …, T − 1 before every
    draw. That test is exact under exchangeability. One stream per forecast, level and own-null
    case; with no own nulls the as-non-hits stream is not drawn.
  - The generator is the repository's seeded `createRandom`. The seeds are contract constants: one
    for each coverage stream (two levels) and one for each independence stream (two forecasts × two
    levels × two cases).
- **Results (F9, N1):** in each case a test rejects when its Monte Carlo p ≤ 0.05. With
  N + 1 = 10,000 the ≤ rule has size at most 5%; it is below 5% where the statistic is discrete
  with ties, as LR_uc is. Each test then has one `result`:
  - `rejected` when it rejects in both cases;
  - `not_rejected` when it rejects in neither, or `not_rejected_underpowered` if also αT < 10. With
    250 dates at 1%, αT is 2.5, and a non-rejection says almost nothing;
  - `indeterminate_due_to_own_nulls` when the cases split. The own nulls then decide the answer, and
    no answer is given.

  Two refinements (P1). At 1% the cap ⌈T/100⌉ can be wider than the Kupiec non-rejection region
  (from T of about 1,900), so [x₀, x₀ + m] can start below the region and end above it: both cases
  reject, one `too_few` and one `too_many`, while counting only some nulls as hits would not.
  - **LR_uc** depends only on x, so its result is decided against the region directly: `rejected`
    only if [x₀, x₀ + m] does not overlap [x_lo, x_hi], which is exactly "rejected under every
    placement of the nulls"; `not_rejected` only if it lies inside; otherwise indeterminate.
  - **LR_cc** is indeterminate when both cases reject with opposite `direction`s (rev 2.4). When
    neither rejects, the general rule applies and gives `not_rejected`: a placement of the nulls in
    between has a lower LR_uc still, by convexity. Rev 2.3 also called a pair of non-rejections with
    opposite directions indeterminate, which made a calibrated forecast whose null interval contains
    αT lose its LR_cc result (code review C1).
  - For LR_ind and LR_cc the two cases cover the two cheap attacks (nulls on true-hit dates and
    nulls on other dates), not every one of the 2^m placements.

  Both cases' p-values are reported.
- **Non-rejection region (F9):** for Kupiec, the hit counts k from 0 to T whose Monte Carlo p for
  LR_uc(k) exceeds 0.05, from the coverage draws already made, reported as `[x_lo, x_hi]`. It
  depends only on T and α, so it is the same for both cases and both forecasts. LR_uc(k) is convex
  in k, so the set is an interval. The reader then sees how far from αT the count could have been
  without a rejection, and where [x₀, x₀ + m] lies against it.

With both forecasts evaluated there are 2 forecasts × 2 levels × 3 tests: `tests_reported: 12`,
each with an asymptotic and a Monte Carlo p-value per case, and no multiplicity correction. A
blocked forecast reduces the count.

## Volatility targeting (per evaluated forecast)

- **Target:** the daily target σ* = value/√P, in the return unit.
- **Leverage:** L_t = σ*/σ̂_t, uncapped (D5). With normalized weights it is gross exposure per unit
  of capital. On an own-null date the leverage of the most recent date with a valid forecast is
  carried, across missing-return dates too; before the first valid forecast the position is flat
  (L = 0). `own_null_dates_with_carried_leverage` reports the count.
- **Realized volatility against the target**, in log space with p_t = L_t·r_p,t:
  - from daily returns: √(P·mean(p_t²)), zero-mean like the VaR, and its ratio to the target;
  - from the intraday proxy: √(P·mean(L_t²·w'RC_t w)), which is far less noisy, and its ratio.
- **Drawdown (F11)**, from compounded simple returns, because linear log scaling breaks at high
  leverage (at L = 10 and r = −5%, the linear value is −0.50 against a true −0.67):
  - the position's simple return is R_t = L_t·Σᵢ wᵢ·(exp(r_i,t/s) − 1), with s = 100 for
    `log_percent` and 1 for `log`;
  - wealth starts at 1 and W_t = W_{t−1}·(1 + R_t);
  - if 1 + R_t ≤ 0, the position is ruined on t: wealth stays 0 and `ruined_on` gives the date. The
    maximum drawdown is then 1, its peak is the running peak before t, its trough is t, and the
    position is underwater at the end. The final underwater stretch runs to the last date, and the
    longest is the longer of it and any earlier stretch;
  - otherwise: the maximum drawdown as a fraction of the running peak (the initial 1 counts as a
    peak), its peak and trough dates, the longest underwater stretch in dates with a return
    (underwater means wealth below its running peak), and whether it is underwater at the end;
  - `Math.exp` may differ in the last bit between CPUs; no result, flag or record depends on these
    values.
- **Leverage:** mean, median, nearest-rank 95th percentile and maximum, with the date of the
  maximum.
- **Regime view (D7, F3).** Grouping by the same day's realized variance cannot show a lag: a
  perfect forecast then also has its highest leverage on calm days, and the proxy-based ratio is
  circular. The view therefore groups by a quantity known before day t:
  - g_t = mean of w'RC w over the 5 dates with a return before t, divided by the mean over the 60
    dates with a return before t (within the run). Dates with fewer than 60 earlier return dates,
    or whose 60-date mean is 0, have no g_t and are counted in `regime_dates_excluded`.
  - The dates with a g_t are sorted by (g_t, date) and split into three groups by index:
    [⌊kT'/3⌋, ⌊(k + 1)T'/3⌋) for k = 0, 1, 2, where T' is their count. The groups are `falling`,
    `steady` and `rising`.
  - Per group: dates, mean leverage, both realized-to-target ratios, and the hit rate at each
    level. Descriptive hit rates here and in the sub-periods use the dates with a valid forecast;
    the group's own-null dates are counted beside them.
  - **What the view means:** for a correct forecast, both ratios are near 1 and the hit rates near
    α in every group. A forecast that lags shows ratios above 1 and excess hits in `rising`, and
    the reverse in `falling`. Leverage per group is reported but is not a signature, since any
    forecast that tracks volatility varies its leverage.
- **Worst days:** the 10 most negative R_t (equal values in date order), each with its date, L_t
  and L_t's percentile (r − 0.5)/T, where r is its rank by leverage among all dates with a return
  (ties get the mean rank), and their mean percentile. 0.5 is the mean under any ranking that is
  unrelated to the losses: a correct forecast does not carry unusual leverage into its worst days,
  and a lagging one carries more (review simulation: 0.506 against 0.572 for EWMA).
- **Own nulls where they matter (N2).** Carried leverage lets nulls choose which earlier leverage
  stays in force: nulls just before a shock keep a lower leverage running into it. Each forecast
  therefore reports its own-null dates among the 10 worst days and within the maximum drawdown's
  peak-to-trough stretch.
- **Sub-periods:** 4 consecutive blocks of the dates with a return (`compare_forecast_losses`'
  block rule), each with both realized-to-target ratios, mean leverage and the hit rate at each
  level.

## Response

In this order:
- `contract: "risk_forecast_backtest_v1"`, `candidateEligible: false`, `unused_proven: false`;
- the set ID, `evidence_tier`, source, series, the run's dates, the normalized weights, the target
  with its unit, and P;
- `days`: run dates, missing returns by cause, T, `chain_breaks`, and `outcome`: `evaluated` or
  `not_evaluable` with its reason;
- `scale_check`;
- `forecasts.a` and `forecasts.b`, each `evaluated` or `blocked_by_forecast_nulls`, with own nulls,
  `var` (per level: counts, the three tests with their p-values in both own-null cases and one result each, the non-rejection
  region, flags) and `vol_target` (the metrics above);
- `tests_reported`;
- `search` and the period-usage records; without `research_id`, `period_usage` is
  `{status: "untracked"}` as in the other observing tools, and `search` still reports its counts;
- `limitations`.

A `not_evaluable` response carries the days and the scale check but no tests or metrics.

## Records (D8, F5, F6)

**The span read.** With `from_previous_endpoint` the computation reads from the bar opening one
interval before the first date's previous endpoint, as `compute_realized_covariance` records it;
with `within_day` from the first date's window start. It reads to the last date's endpoint. Every
record and the journal's overlap key use this span, not the forecast set's window envelope, which
starts one bar later.

**Period usage**, with `research_id`, before any statistic is returned:
- `tool_observed` records with the new tool name `backtest_risk_forecast` and scope
  `risk_backtest_bar_window_only`, written as one batch like the other observing tools;
- index 0 is the set's `forecast-set-source:` series with the forecast set's artifact ID as
  `data_version`; the underlying series follow, each with its bar-series artifact ID as
  `data_version`, the data actually read, as the realized-covariance records do;
- all records carry the span read;
- the request hash binds the forecast-set artifact, the contract, the normalized weights and the
  target, in that key order;
- assessments add a per-tool limitation block when the ledger holds records from this tool, as
  for the other observing tools.

**The search journal.** A new append-only journal, `TRADINGVIEW_MCP_RISK_BACKTEST_JOURNAL_PATH`
(default `~/.tradingview-mcp/risk-backtest-journal.jsonl`), on the owner-only first-seen log with
strict framing, like the other journals.
- **When:** one entry for every evaluated or not-evaluable call, with or without `research_id`,
  as the realized-covariance journal does, after the period-usage write and before the response.
  A journal failure returns an error without statistics; after a period write, the error names the
  records written.
- **Fields:**
  - the header fields and the contract;
  - `research_id` or null;
  - the forecast-set ID, the proxy-set ID, `rules_sha256` and the bar-series artifact IDs;
  - the underlying series IDs, the run's first and last dates, and the span read;
  - `a_sha256` and `b_sha256`: each forecast's values over the run, in the normalized set form;
  - the normalized weights and `weights_sha256`;
  - the target value and unit;
  - per forecast: `evaluated` or `blocked`, the own nulls m, and per level x₀, T and the three
    results;
  - the outcome.
- **`search`**, on records that share an underlying series and overlap the span read (half-open),
  this call included:
  - `this_research_id`: calls, distinct weight vectors, distinct A and B hashes, and
    `earlier_no_rejection`, per level: the earlier calls with at least one evaluated forecast in
    which no test of an evaluated forecast had the result `rejected`. A `not_evaluable` call, or
    one with both forecasts blocked, is never counted there. Without `research_id` this scope is
    `{status: "untracked"}`;
  - `overlapping_data`, under any research ID: calls, distinct research IDs, distinct weight
    vectors, distinct forecast hashes (the union of the A and B hashes) and
    `earlier_no_rejection`;
  - `period_usage_prior_overlap`, with `research_id`: the period records' `prior_overlap` in
    summary form (`summarizePriorOverlap`), as `compare_forecast_losses` and
    `compute_realized_covariance` return it. Its `per_series` rows carry
    `active_forward_period_declarations` (FORWARD_PERIOD.md);
  - `proxy_rule_variants` and `proxy_bar_series_versions`: the distinct `rules_sha256` and the
    distinct bar-series tuples in the realized-covariance journal, over records that share a series
    and overlap the span read. With `from_previous_endpoint` that is one bar wider than
    `compare_forecast_losses`' window envelope, so it can admit one more adjacent record, the
    conservative direction; with `within_day` the two are the same. Here the rules
    and bar versions decide the returns and the drops themselves.

  The target is recorded but not counted: hits, tests and every realized-to-target ratio are
  invariant to it. Only absolute leverage and drawdown change.
- Forward period declarations are reported through the period-usage record paths, as for the
  other observing tools.

## Limitations

Always returned:
- `var_from_forecast_variance_under_normal_quantile_zero_mean`
- `coverage_non_rejection_is_not_evidence_of_a_correct_risk_model`
- `hit_tests_use_one_hit_sequence_of_this_length`
- `one_realized_history_not_forward_evidence`
- `tests_reported_without_multiplicity_correction`
- `own_nulls_evaluated_both_as_hits_and_as_non_hits`
- `series_returns_combined_without_currency_conversion` (simple returns of series quoted in
  different currencies are summed as they are, a second-order approximation)
- `forecasts_and_their_timing_are_caller_supplied_and_unverified`
- `forecast_units_and_variance_vs_volatility_are_caller_asserted`
- `vol_targeting_is_ex_post_without_costs_or_execution`
- `leverage_uncapped`
- `position_pnl_on_return_missing_dates_omitted`
- `returns_rederived_from_imported_bars_not_source_authenticated`
- `search_counts_cover_this_journal_only`
- `expected_shortfall_not_assessed`

Conditional:
- `within_day_returns_exclude_first_interval_and_gaps`, with `within_day` rules. Under them P₀ is
  the first common slot's close, so a day's return leaves out its first bar and the weekend or
  holiday gap before it, where tail losses concentrate.

## Errors

- `risk_backtest_requires_proxy_set_source`: a plain forecast set;
- the proxy-set verification errors, and `proxy_set_mismatch`, as in `compare_forecast_losses`;
- `bar_series_not_found`, `returns_rederivation_mismatch`;
- `weights_invalid`: the wrong length, a non-finite value, or all zero;
- `target_unit_mismatch`;
- the forecast-set store errors.

## Changes to released tools and storage

- The period-usage store gains the tool name `backtest_risk_forecast` and its scope.
  **Downgrading:** as with 0.1.15, a version that does not know the tool name fails closed on
  every period-usage read or write after the first such record.
- A new journal file, which older versions ignore.
- Docs: FORWARD_PERIOD.md's observing-tool list, RESEARCH_PERIOD_USAGE.md, and the path table in
  REALIZED_COVARIANCE.md (this tool also reads `TRADINGVIEW_MCP_BAR_SERIES_DIR`,
  `TRADINGVIEW_MCP_PROXY_SET_DIR`, `TRADINGVIEW_MCP_FORECAST_SET_DIR` and the realized-covariance
  journal).
- The tool count goes to 112.

**Performance.** At 8 series × 4,000 dates, about 0.9 s to read the bars, 1.1 s to recompute, 0.5
s to verify, and up to about 3 s of Monte Carlo: up to ten streams of 9,999 draws (two coverage
streams, and independence streams for 2 forecasts × 2 levels × 2 cases), at about 0.3 s per stream
as measured in the review. The plan sets thresholds.

## Tests (planned; synthetic fixtures only)

- **The statistics:**
  - hand-computed cases: no hits, all hits, one hit at the end, a chain break, and tables whose
    conditional and marginal rates are equal, which must give exactly 0 (F7);
  - an independent reference computed outside the TypeScript code.
- **The Monte Carlo:**
  - determinism, the (1 + #)/(N + 1) rule and the ≤ 0.05 rule;
  - slow checks outside the unit suite: independent Bernoulli(α) hits reject the coverage tests at
    no more than about 5% (below it where LR_uc's ties make the test conservative); independent hits
    at 2α keep the independence test's rejection rate at or below 5% (F2);
  - the reset of the shuffle's index array before every draw.
- **The re-derivation:**
  - equality with the stored proxy set over a sub-run under both `first_interval` modes, including
    a run whose first date is dropped;
  - a stored 0 against a recomputed −0 (F8);
  - a bar-series edit giving `returns_rederivation_mismatch`;
  - the sign of the returns pinned by a fixture.
- **Volatility targeting**, on simulated paths with a known variance:
  - a perfect forecast gives ratios near 1 and hit rates near α in every regime group, and a worst-
    day percentile near 0.5;
  - a lagged forecast shows excess in `rising`.

  This perfect-forecast control is what makes the test discriminate (F3).
- **Days and inputs:**
  - own nulls in both cases: nulls on true-hit dates of a forecast with too many hits, and nulls on
    other dates of a forecast with too few (1.5 times the true σ, 19 nulls over 1,900 dates), each
    giving `indeterminate_due_to_own_nulls` or `rejected`, never `not_rejected`, for LR_uc and LR_cc
    (N1). LR_ind can rightly be `not_rejected` in both cases there; for it, nulls on the hits of a
    clustered sequence must give `indeterminate_due_to_own_nulls` or `rejected`;
  - an interval straddling the Kupiec region (T = 1,900 at 1%, region [11, 28], x₀ = 10, m = 19)
    giving `indeterminate_due_to_own_nulls` for LR_uc and LR_cc, not `rejected` (P1);
  - the cap, the independence of A from B, the 10% and 250-date budgets, carried leverage across
    missing returns, ruin and its fields, the own-null counts among the worst days and in the
    drawdown stretch, weight normalization (including [1e308, 1e308]), the unit guard and the scale
    flag.
- **Records:** the span read, the bar-series `data_version`, the journal fields and every
  `search` count, and the period-usage tool name with its downgrade behaviour.
- **A mutation run** over:
  - the hit definition, the segments and transitions, the three statistics and the clamp;
  - both Monte Carlo nulls and the ≥ comparison;
  - the two own-null cases and how they combine into one result, the cap, and the day budgets;
  - the regime variable's lookback and the group split;
  - the compounded drawdown and ruin.

## Decisions (user, 2026-10-01)

All as recommended, and agreed by the design review:
1. **D1, return source:** R1, re-derived from the proxy set's bars, with the F8 checks. R2 may
   follow later as its own evidence tier; R3 is rejected.
2. **D2, VaR quantile:** the normal quantile with zero mean only.
3. **D3, levels:** fixed 1% and 5%.
4. **D4, portfolio:** one weight vector per call. Per-series backtests are separate calls with unit
   weights, recognizable in the journal by their weight vectors.
5. **D5, leverage cap:** none, so the build-up is visible, with compounded drawdown and ruin.
6. **D6, p-values:** Monte Carlo results, with the permutation null for independence and the
   Bernoulli(α) null for coverage; asymptotic p-values beside them.
7. **D7, the lag view:** ex-ante groups by the 5/60-date realized-variance ratio, plus the 10 worst
   days.
8. **D8, records:** period usage on the span read, plus a new search journal written on every call.
9. **D9, days:** own nulls evaluated both as hits and as non-hits, a split giving
   `indeterminate_due_to_own_nulls` (with the P1 refinements), with a ⌈T/100⌉ cap; missing returns
   up to 10%; at least 250 return dates; both forecasts always evaluated.
