# backtest_risk_forecast: implementation plan (rev 2.2, implemented)

Implements docs/RISK_FORECAST_BACKTEST_DESIGN.md rev 2.4 (rev 2.2 is commit 2823fab; rev 2.3 adds
`period_usage_prior_overlap` to `search`; rev 2.4 corrects the LR_cc rule after the code review). The design governs: where this plan and the design
differ, the design wins and this plan is corrected. Section 6 fixes the constants the design leaves
open, before any code.

Review history:
- rev 1: APPROVE WITH FINDINGS. LOW Q1–Q6 and NITs Q7–Q10; Q3 was a design gap, folded into the
  design as rev 2.3.
- rev 2 (diff check): APPROVE WITH FINDINGS. LOW R1 and NITs R2–R4, folded in as rev 2.1.
- code review of the implementation: rev 2.2 records two corrections to section 6. The LR_cc rule
  follows design rev 2.4 (C1), and the regime-group and sub-period entries are given as implemented
  (C7).

Rev 2 folds in Q1–Q10: the reference tolerance and its case table (Q1), the re-derivation boundary
(Q2), `period_usage_prior_overlap` (Q3), the constants an implementer would otherwise invent (Q4),
CPU-independent simulations (Q5), a straddle test derived from the region (Q6), and the smaller
items (Q7–Q10).

## 1. Files

| File | New or changed | Content |
|---|---|---|
| `src/realizedCovariance.ts` | changed | An option `{ includeReturns: true }` that also returns each date's r vector (or null when dropped). The proxy set and every existing output stay byte-identical, so no proxy-set ID changes (step 1). |
| `src/riskForecastBacktest.ts` | new | The pure computation: days and budgets, own nulls, hits, segments and transitions, the three statistics, the Monte Carlo streams, the two-case combination, the Kupiec region, volatility targeting, the regime view, worst days, sub-periods, the scale check (steps 2–3) |
| `src/riskReturnRederivation.ts` | new | `rederiveReturns` and the pure checker `checkRederivation` (step 4) |
| `src/riskBacktestJournal.ts` | new | The search journal and its `search` counts (step 5) |
| `src/researchPeriodUsage.ts` | changed | The tool name `backtest_risk_forecast` with scope `risk_backtest_bar_window_only`, and its limitation block in `assess()` (step 5) |
| `src/server.ts` | changed | The tool, its strict input, the call order, the risk journal in ServerDeps (the bar-series store is already there), the response; 112 tools (step 6) |
| `scripts/benchmark-risk-backtest.mjs` | new | Performance check, outside the unit suite, in mkdtemp directories only (step 7) |
| `scripts/check-risk-backtest-size.mjs` | new | The slow Monte Carlo size checks, outside the unit suite (step 2) |
| `test/fixtures/risk-backtest/make-reference.py`, `reference.json` | new | An independent reference for the statistics in standard-library Python with 60-digit `decimal`, and its pinned output (step 2) |
| `test/fixtures/period-usage/make-format-0.1.17.mjs`, `format-0.1.17.jsonl` | new | A golden ledger holding a `backtest_risk_forecast` record, so later versions must keep reading it; the maker refuses to overwrite without `--force` (step 5) |
| `test/unit/*` | new and changed | `riskForecastBacktest.test.mjs`, `riskReturnRederivation.test.mjs`, `riskBacktestJournal.test.mjs`, additions to the realized-covariance, period-usage and server tests. `makeDeps` stubs the risk journal so that it throws; it already stubs the bar-series store. |
| `docs/RISK_FORECAST_BACKTEST.md`, `docs/RESEARCH_PERIOD_USAGE.md`, `docs/FORWARD_PERIOD.md`, `docs/REALIZED_COVARIANCE.md`, `README.md`, `docs/BACKLOG.md` | new or changed | Step 7 |
| `package.json`, `package-lock.json` | changed at release | The version bump only; no new bin or script entry. `files` is `build/**/*.js`, so scripts and fixtures are not published. |

**Paths.** The tool reads the forecast-set store, the proxy-set store, the bar-series store and the
realized-covariance journal through the existing resolvers, and writes the period-usage ledger and
the new journal. The new journal resolves `TRADINGVIEW_MCP_RISK_BACKTEST_JOURNAL_PATH`, defaulting to
`~/.tradingview-mcp/risk-backtest-journal.jsonl`, only in `createServer`'s default; tests inject
stores in mkdtemp directories, and `makeDeps` stubs throw.

**Helpers reused.** `forecastSetSourceDigest` and `forecastSetComponentHashes` from
`forecastSet.ts`; `summarizePriorOverlap` from `forecastLossJournal.ts`;
`RealizedCovarianceJournalStore.search(seriesIds, { from, to })`; `verifyForecastSetAgainstProxySet`
from `proxySet.ts`; `blockBounds` and the forecast validity rule from `forecastLossComparison.ts`;
`erfc` and `averageRanks` from `numerics.ts`; `fdlibmLog`; `createRandom`.

## 2. Order of work

Each step is its own branch and commit, fast-forwarded into main with the full unit suite green.
There is no release until after the code review.

### Step 1. Returns from the realized-covariance computation, with no behaviour change

- `computeRealizedCovariance(input, { includeReturns: true })` adds `returns`: per date, a copy of
  the r vector already computed inside (r_D = L(endpoint) − L(P₀)), an array of n numbers also for
  n = 1, or null on a dropped date. Without the option the result is unchanged.
- **Tests:**
  - the regression goldens (rules hashes, three proxy-set IDs, first kept day's bits) run both with
    and without the option, and the IDs are identical;
  - with the option, r_i·r_j equals `daily_outer` in JSON form on every kept date;
  - the sign on a constructed series whose closes rise then fall (F8);
  - a dropped date gives null; mutating a returned vector does not change the proxy.

### Step 2. The statistics

- In `src/riskForecastBacktest.ts`:
  - the hit rule: a hit is r_p,t < z_α·σ̂_t, strictly; an own-null date is a hit in the as-hits case
    and not in the as-non-hits case;
  - segments from the dates with a return; transitions within segments; `chain_breaks`;
  - LR_uc in the ratio form, LR_ind as 2·Σ n_ij·ln((n_ij·N)/(m_i·c_j)) with integer products, LR_cc
    as their sum, all clamped at 0, all logarithms through `fdlibmLog`;
  - the asymptotic p-values through `erfc` and `Math.exp`;
  - the coverage stream (Bernoulli(α), sequence-major, u < α) and the permutation stream (partial
    Fisher–Yates over an index array that is 0, …, T − 1 at the start of every draw), each
    N = 9,999, seeded per section 6. Undoing the x swaps instead of rebuilding the array, and
    counting transitions from the sorted hit positions, are allowed optimizations because they give
    the same bits;
  - the two own-null cases and their combination into one result, with the P1 rules: LR_uc against
    the region, LR_cc indeterminate when both cases reject with opposite directions (rev 2.4);
  - the Kupiec region from the coverage draws;
  - `direction`, `independence_uninformative`, `expected_hits_below_10`,
    `not_rejected_underpowered`, `tests_reported`.
- **Reference (P1, Q1):** `make-reference.py` recomputes LR_uc, LR_ind, LR_cc and the asymptotic
  p-values for a pinned case table in 60-digit `decimal`, independently of the TypeScript code, and
  writes `reference.json`. It needs no packages.
  - `decimal` has `ln`, `exp` and `sqrt` but no erfc; the script implements it, by the series for
    x < 2 and a continued fraction above.
  - The case table: zero counts; x = 0 and x = T; the tables whose conditional and marginal rates
    are equal ((1805, 95, 95, 5) and (3610, 190, 190, 10), exactly 0); chain breaks; T = 5,000;
    statistics from about 1e-10 to 1e3; p-values across [1e-300, 1].
  - **Tolerance:** |got − exact| ≤ 1e-12·|exact| + 1e-14·T. A small statistic is formed from large
    terms, so its double-precision error is absolute (the review measured up to 1.9e-12, and
    |error|/T up to 4e-16). Asymptotic p-values are compared only where the exact value is ≥ 1e-300,
    because `erfc` returns 0 from about 26.5.
- **Slow checks (P2, Q8)** in `check-risk-backtest-size.mjs`, run by hand, not in CI:
  - configurations: T ∈ {500, 1,900} × α ∈ {1%, 5%} × true hit rate π ∈ {α, 2α}, independent
    hits, one segment;
  - R = 2,000 replications per configuration, seeds 20_261_101 + r for replication r, each calling
    the production functions with N = 9,999 (about 100–200 s per configuration);
  - pass rule: a rejection rate ≤ 0.05 + 2·√(0.05·0.95/R) (about 6.0%) for the coverage tests at
    π = α and for the independence test at both π; and a floor of ≥ 1% for the coverage tests at
    π = α, to catch an over-conservative bug;
  - it prints every rate and exits non-zero on a failure.
- **Tests (Q5):** hit sequences are built directly as integer arrays, never from simulated returns,
  so every count and result is the same on every CPU:
  - hand cases (no hits, all hits, one hit at the end, a chain break) and the exactly-0 tables;
  - Monte Carlo determinism, the (1 + #)/(N + 1) rule, the ≤ 0.05 rule, the reset of the shuffle
    array, and the seed and stream assignment;
  - both own-null attacks, for LR_uc and LR_cc: nulls on the true-hit dates of a sequence with too
    many hits, and nulls on other dates of a sequence with too few (no hits over 1,900 dates plus 19
    nulls), each giving `indeterminate_due_to_own_nulls` or `rejected`, never `not_rejected` (R1).
    LR_ind can rightly be `not_rejected` in both cases there (with x = 0 every permutation ties), so
    for LR_ind the attack is nulls on the hits of a clustered sequence, which must give
    `indeterminate_due_to_own_nulls` or `rejected`;
  - **the straddle case (Q6):** at T = 3,000 and 1% (region about [20, 41], cap 30), the test reads
    the reported region and sets x₀ = x_lo − 1 and m = x_hi − x_lo + 2, asserts m ≤ ⌈T/100⌉, and
    expects `indeterminate_due_to_own_nulls` for LR_uc and LR_cc. Deriving the case from the region
    keeps it meaningful if a seed or N changes.

### Step 3. Days and volatility targeting

- Days: missing returns and their budget, the 250-date minimum, own nulls (null, invalid under
  `compare_forecast_losses`' validity rule, or σ̂² not finite and positive), the cap and
  `blocked_by_forecast_nulls`, the independence of A from B, the scale check. The budgets compare
  exact integers (section 6).
- Volatility targeting: weight normalization (max, then sum), σ̂ in the pinned summation orders,
  leverage with carry across own nulls and missing returns, both realized-to-target ratios,
  compounded drawdown with ruin and its fields, leverage statistics, the regime view (g_t over 5
  and 60 earlier return dates, the index split, groups' descriptive hit rates on valid-forecast
  dates with their own-null counts beside them), worst days with the (r − 0.5)/T percentile, the
  own-null counts among the worst days and in the drawdown stretch, sub-periods with `blockBounds`
  (with the same descriptive hit rates).
- **Tests (Q5)**, on simulated paths built from `createRandom` with pure arithmetic only: a normal
  draw is the Irwin–Hall sum of 12 uniforms minus 6, so the paths are the same on every CPU. Paths
  have at least 5,000 dates and pinned seeds, and ratios are asserted with tolerances:
  - a perfect forecast: ratios near 1 and hit rates near α in every regime group, and a worst-day
    percentile near 0.5;
  - a lagged forecast: ratios above 1 and excess hits in `rising`;
  - ruin and its fields, carry across own nulls and missing returns, the budgets at their exact
    boundaries, the cap, normalization of [1e308, 1e308], the scale flag at 0.1 and 10.

### Step 4. Re-derivation (Q2)

- `rederiveReturns({ set, proxySet, barSeries, resolver })` in `src/riskReturnRederivation.ts`:
  - `barSeries` is `Pick<BarSeriesStore, "get">`. A missing artifact (ENOENT) becomes
    `bar_series_not_found`, as `compute_realized_covariance` maps it;
  - `resolver` is the same zone resolver the verification used, so injected resolvers in tests
    cannot make verification and recomputation disagree;
  - it recomputes over the forecast set's run with the proxy set's stored rules and
    `includeReturns`. A `RealizedCovarianceError` from the recomputation (coverage, the internal
    invariant) becomes `returns_rederivation_mismatch`, with the cause in the detail;
  - it then calls `checkRederivation(proxyRun, recomputed)` and returns
    `{ returns, span }`, where `span` is the recomputation's read envelope, used by the records
    and the journal.
- `checkRederivation(proxyRun, recomputed)` is exported and pure. It compares date, window, `rc`,
  `daily_outer`, `common_slots`, `expected_slots` and `drop_cause` per date in normalized JSON form,
  and the stored `daily_outer` with r_i·r_j from the exposed vector. On a difference it throws
  `returns_rederivation_mismatch: <date> <field>`, for the first differing date and the first field
  in that order (`returns` for the exposed-vector check).
- **Tests:** a sub-run under both `first_interval` modes, a run whose first date is dropped, a DST
  week, a stored 0 against a recomputed −0, a bar-series edit, a missing bar series, a coverage
  error mapped to the mismatch, and a permuted exposed vector passed to `checkRederivation`
  directly. The production path has no injection point.

### Step 5. Records

- `researchPeriodUsage.ts`: the tool name and scope, and the `assess()` limitation block, added
  when the ledger holds a `tool_observed` record from this tool, as for the other observing tools
  (section 6). The 0.1.13 and 0.1.15 goldens still read. That an older schema rejects the new tool
  name is shown by the existing unknown-tool-name test.
- **New golden:** `format-0.1.17.jsonl`, made by `make-format-0.1.17.mjs` with a record from each
  observing tool including `backtest_risk_forecast`, must read, check and extend.
- `riskBacktestJournal.ts`: the record schema (section 6), strict framing, fail-closed reads, the
  overlap key on the span read, and the `search` counts:
  - `this_research_id` (or its untracked form): calls, distinct weight vectors, distinct A and B
    hashes, and `earlier_no_rejection` per level with its exclusions;
  - `overlapping_data`: calls, distinct research IDs, distinct weight vectors, distinct forecast
    hashes (the union of A and B) and `earlier_no_rejection`;
  - `proxy_rule_variants` and `proxy_bar_series_versions` from
    `RealizedCovarianceJournalStore.search` over the span read;
  - `period_usage_prior_overlap` from `summarizePriorOverlap` over the period records, with
    `research_id` (Q3).
- **Tests:** every count, the exclusions, the half-open overlap, an untracked call, a torn journal,
  the per-tool limitation block, and `period_usage_prior_overlap` with a forward period declared on
  one of the series.

### Step 6. The MCP tool

- `server.ts`: `backtest_risk_forecast` with the strict input of the design. The call order, which
  also fixes which error wins (Q9):
  1. load the forecast set; refuse a plain source (`risk_backtest_requires_proxy_set_source`);
  2. validate the weights against n (`weights_invalid`);
  3. verify the set against its proxy set, as `compare_forecast_losses` does;
  4. check the target unit against the proxy set's `return_unit` (`target_unit_mismatch`);
  5. re-derive the returns (`bar_series_not_found`, `returns_rederivation_mismatch`);
  6. evaluate;
  7. with `research_id`, write period usage: one batch over the span read, with section 6's access
     IDs, `data_version`s and request hash;
  8. write the journal; on failure after a period write, the error names the records written;
  9. respond with section 6's skeleton.
- ServerDeps gains the risk journal; `makeDeps` stubs it so that it throws. The tool count goes to
  112.
- **Tests, end to end with real stores in mkdtemp:** a joined set from synthetic bars, tracked and
  untracked; the error order above; the records' span, `data_version`s and
  `overlapped_forward_period_declarations`; the journal, `search` and `period_usage_prior_overlap`;
  `tests_reported`; the `not_evaluable` shape; the response skeleton's key order.

### Step 7. Docs and benchmark

- **`docs/RISK_FORECAST_BACKTEST.md`**, the contract, with its must-say list:
  - not a trading backtest, not evidence of a correct risk model, not a ranking;
  - the returns re-derived from the bars and what that does and does not authenticate;
  - the normal quantile with zero mean;
  - the two own-null cases and `indeterminate_due_to_own_nulls`, and joining from the first
    forecast date;
  - `not_rejected_underpowered` and the Kupiec region;
  - the regime view as ex-ante groups, and what a correct forecast shows there;
  - compounded drawdown, ruin and uncapped leverage;
  - the 10% missing-return budget and the `within_day` limitation;
  - the journal written on every call, the search counts and `period_usage_prior_overlap`;
  - the paths shared with the realized-covariance CLIs.
- **`docs/RESEARCH_PERIOD_USAGE.md`:** an "Automatic Risk-Backtest Tracking" section.
- **`docs/FORWARD_PERIOD.md`:** the tool in the observing-tool lists.
- **`docs/REALIZED_COVARIANCE.md`:** the path table names this tool.
- **README:** 112 tools, the table row, the new environment variable.
- **BACKLOG** #101 item 3, and the release-note text with the downgrade note.
- **`scripts/benchmark-risk-backtest.mjs`** at 8 series × 4,000 dates, with thresholds (section 6).

After step 7: a mutation run over the design's list, a subagent code review with fixes and
re-review, and then release 0.1.17, which is the user's to publish.

## 3. Tests

- Every test listed in the design, mapped to steps 1–6 as above.
- **Determinism:** every count and result depends only on integer counts, `fdlibmLog` and the
  seeded generator; test paths use pure arithmetic. CI runs the suite on arm64 (macOS) and x64.
- **Released-tool compatibility:**

  | Change | Test |
  |---|---|
  | `computeRealizedCovariance` gains an option | the step 1 goldens, with and without it |
  | The period-usage store gains a tool name | step 5; the 0.1.13, 0.1.15 and new 0.1.17 goldens read |
  | Assessments gain a limitation block | step 5 |
  | The tool list: 111 → 112 | server.test.mjs tool-count test |

- **Mutation (after step 7)**, the design's list plus:
  - the `includeReturns` exposure and the exposed-vector check;
  - the JSON-form comparison and the error mapping in `rederiveReturns`;
  - the seed and stream assignment;
  - the request hash, the span read and the error order.

  The run uses copies of `build/` and `test/`, invoked with the repository's Node binary by
  absolute path, and checks first that the copies pass unmutated.

## 4. Risks

- **Proxy-set IDs:** step 1 touches the computation behind content-addressed IDs. The option only
  adds an output, and the goldens run with and without it.
- **Released tools:** only the period-usage store changes (a tool name). Downgrading fails closed
  after the first record, as documented for 0.1.15.
- **Performance:** up to ten Monte Carlo streams of 9,999 draws over T dates. LR_ind per draw needs
  only the four transition counts, so a draw is one pass. The benchmark has thresholds.
- **Cross-CPU drift in tests:** no test asserts results on paths built with `Math.log`, `Math.cos`
  or `Math.exp` (Q5).
- **Test pollution:** stores are injected; no home path is resolved outside `createServer`'s
  default; `makeDeps` stubs throw.
- **Windows:** POSIX-mode assertions are guarded with `posixModeEnforced()`.
- **Estimated size:** about 1,300–1,700 source lines and 1,600–2,100 test lines.

## 5. Decisions (user, 2026-10-01)

1. **P1, reference:** commit the standard-library Python reference and its pinned output, with the
   Q1 tolerance and case table.
2. **P2, slow checks:** a script run by hand, outside CI, as specified in step 2.
3. **P3, order:** steps 1–7 as above.
4. **P4, release:** 0.1.17 after the code review, with 112 tools.

## 6. Implementation constants fixed before coding

| Constant | Value |
|---|---|
| Contract | `risk_forecast_backtest_v1` |
| Levels and quantiles | 0.01 → −2.326347874040841; 0.05 → −1.6448536269514726 |
| Annualization | P = 52 × \|`day_weekdays`\| |
| Budgets | `not_evaluable` when 10·missing > run dates (`more_than_10_percent_of_returns_missing`), or T < 250 (`fewer_than_250_return_days`); `blocked_by_forecast_nulls` when m > ⌈T/100⌉, with ⌈T/100⌉ computed in integers as (T + 99) div 100 |
| Results | `rejected`, `not_rejected`, `not_rejected_underpowered` (αT < 10), `indeterminate_due_to_own_nulls`; rejection at Monte Carlo p ≤ 0.05 |
| Monte Carlo | N = 9,999 per stream; p = (1 + #≥)/(N + 1); `createRandom` |
| Seeds | base 20_261_001; coverage: 1% → base + 1, 5% → base + 2; independence: base + 10·f + 2·ℓ + c + 1, with f = 1 for A and 2 for B, ℓ = 0 for 1% and 1 for 5%, c = 0 as-hits and 1 as-non-hits (A: +11 to +14, B: +21 to +24); slow checks: 20_261_101 + r |
| Regime view | 5 and 60 earlier return dates; groups `falling`, `steady`, `rising` |
| Worst days | 10; percentile (r − 0.5)/T, mean-rank ties (`averageRanks`), equal R_t in date order |
| Sub-periods | 4 blocks by `blockBounds` |
| Scale check | flag when the median is < 0.1 or > 10; dates with w'RC w = 0 excluded |
| Weights | n finite values, not all zero; divided by max\|wᵢ\|, then by Σ\|wᵢ\|; `weights_invalid` otherwise |
| Target | `{value, unit}`, value > 0 and finite, unit equal to the proxy set's `return_unit` (`target_unit_mismatch`) |
| `returns` (step 1) | per date an array of n numbers (also for n = 1), copied, or null |
| Tool, scope | `backtest_risk_forecast`, `risk_backtest_bar_window_only` |
| Period records | index 0: `forecast-set-source:` + the hex of `forecastSetSourceDigest(source_id)`, with the forecast-set artifact ID; then each underlying series with its bar-series artifact ID; all over the span read; access IDs `<base>:<index>`, base `usage_access_id` or `risk-access:<uuid>` |
| Request hash | SHA-256 of `JSON.stringify({artifact, contract, weights, target: {value, unit}})`, keys in that order, weights normalized |
| `period_usage` | tracked: `{status: "tracked", access_id_base, records: [{access_id, series_id, idempotent, overlapped_forward_period_declarations}], limitations}` with limitations `bar_window_read_not_forecast_estimation_history` (R3), `series_ids_are_importer_supplied`, `different_source_ids_and_external_access_are_not_reconciled`, `recorded_attempt_is_not_proof_of_result_delivery`; untracked: `{status: "untracked", limitations: ["research_id_required_for_automatic_period_usage"]}` |
| `assess()` block | when the ledger holds a `tool_observed` record of this tool: `tool_observed_usage_is_risk_backtest_bar_window_only`, `series_id_and_data_version_are_importer_supplied_metadata` |
| Journal | namespace `risk_forecast_backtest_search`, `schema_version` `"1.0"`, the first-seen log with strict framing; 32 MiB file, 16 KiB record; header fields `schema_version`, `namespace`, `sequence`, `first_seen_at`, `observation_date`, as in the forecast-loss and realized-covariance journals (R2) |
| Journal record | header; contract; `research_id` or null; forecast-set ID; proxy-set ID; `rules_sha256`; bar-series IDs; underlying series IDs; run first and last dates; span read; `a_sha256` and `b_sha256` = `forecastSetComponentHashes(set).a` and `.b` (the run is the whole set, so they join with the forecast-loss journal's component hashes); normalized weights and `weights_sha256`; target; per forecast `evaluated` or `blocked`, m, and per level x₀, T and the three results; outcome |
| `search` limitations | `local_recorded_calls_only`, `overlap_key_is_importer_supplied_series_ids_and_read_spans`, `retries_increment_call_counts` |
| Response skeleton | `contract`, `candidateEligible`, `unused_proven`; `input` {`artifact_id`, `evidence_tier`, `source_id`, `proxy_set_id`, `series_ids`, `run` {`from_date`, `to_date`}, `weights`, `target`, `periods_per_year`}; `days` {`run_dates`, `missing_returns` {`total`, `by_cause`}, `return_dates`, `chain_breaks`, `outcome`, `reason`?}; `scale_check` {`a`, `b`: {`median_ratio`, `dates`} or null, `flags`}; `forecasts` {`a`, `b`: {`status`, `own_nulls`, `own_null_dates_with_carried_leverage`, `var`, `vol_target`}}; `tests_reported`; `search`; `period_usage`; `limitations` |
| `var` entry | an array with one entry per level: {`level`, `T`, `hits` {`without_own_nulls`, `with_own_nulls`}, `expected`, `expected_hits_below_10`, `direction` {`as_hits`, `as_non_hits`}, `kupiec`, `independence`, `conditional_coverage`: each {`result`, `as_hits`, `as_non_hits`: {`statistic`, `p_asymptotic`, `p_monte_carlo`}}, plus `independence_uninformative` {`as_hits`, `as_non_hits`} on `independence`; `kupiec_non_rejection_region` [x_lo, x_hi]} |
| `vol_target` entry | `realized_to_target` {`daily_returns`, `intraday_proxy`: {`annualized`, `ratio`}}; `drawdown` {`max`, `peak_date`, `trough_date`, `longest_underwater_dates`, `underwater_at_end`, `ruined_on`, `own_null_dates_in_peak_to_trough`}; `leverage` {`mean`, `median`, `p95`, `max`, `max_date`}; `regime_view` {`excluded_dates`, `groups` {`falling`, `steady`, `rising`}: {`dates`, `mean_leverage`, `realized_to_target` {`daily_returns`, `intraday_proxy`}, `hit_rates`, `own_null_dates`}}; `worst_days` {`days`: [{`date`, `position_return`, `leverage`, `leverage_percentile`}], `mean_leverage_percentile`, `own_null_dates`}; `sub_periods`: [{`from_date`, `to_date`, `dates`, `mean_leverage`, `realized_to_target`, `hit_rates`, `own_null_dates`}] (rev 2.2, C7) |
| Mismatch detail | `returns_rederivation_mismatch: <date> <field>`, the first differing date, then the first field in the order date, window, rc, daily_outer, common_slots, expected_slots, drop_cause, returns |
| Errors | the forecast-set store errors, `risk_backtest_requires_proxy_set_source`, `weights_invalid`, the proxy-set verification errors and `proxy_set_mismatch`, `target_unit_mismatch`, `bar_series_not_found`, `returns_rederivation_mismatch`; in that order of precedence (step 6, R4) |
| Limitations | the design's 15 always-returned items; `within_day_returns_exclude_first_interval_and_gaps` with `within_day` rules |
| Benchmark thresholds | at 8 series × 4,000 dates on the development machine: the whole call under 8 s, re-derivation under 3 s, Monte Carlo under 4 s |
