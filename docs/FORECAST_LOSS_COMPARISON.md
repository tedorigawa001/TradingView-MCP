# Forecast Loss Comparison

`compare_forecast_losses` compares two variance or covariance forecasts, A and B, on one
forecast evaluation set. It returns the Diebold–Mariano (DM) test together with a fixed
robustness battery, and it counts how much searching preceded the call. It leads with the ways a
mean advantage can fail to hold. It never returns a statement that one forecast is better:
`no_listed_conflict` means only that the listed sign checks did not flip.

The contract is `forecast_loss_comparison_v1`. Nothing in the battery can be set per call.
`candidateEligible` is always false and `statistical_calibration` is always `not_assessed`.
The tool does not read charts, place orders, or take file paths. The design and its review history
are in [FORECAST_LOSS_COMPARISON_DESIGN.md](FORECAST_LOSS_COMPARISON_DESIGN.md).

## Input

Pass exactly one of:
- `artifact_id`: a set registered with the import CLI (below);
- `inline_set`: a scalar set (n = 1) of at most 2,000 dates, in the same schema.

Both paths normalize and hash the set with the same function, so the same content gets the same
`artifact_id` either way. An inline set is not stored, so its hash cannot be re-verified later; the
response then adds `inline_input_not_stored_hash_not_reverifiable`.

Other arguments:
- `loss`: `qlike` or `mse`;
- `research_id` (optional): writes the records described under [Records](#records);
- `usage_access_id` (optional, 1–100 characters, only with `research_id`): makes period-record
  retries idempotent.

Any other argument is an error, so a misspelled `research_id` cannot run silently untracked.

### Import

After building a checkout:

```sh
npm run import:forecast-set -- --input /absolute/path/set.json --confirm-local-import
```

The installed package exposes the same command as `tradingview-mcp-import-forecast-set`. It returns
`artifact_id`, the number of dates and n. Importing the same normalized content again returns the
same ID without replacing the stored file.

Storage defaults to `~/.tradingview-mcp/forecast-sets`. Set
`TRADINGVIEW_MCP_FORECAST_SET_DIR` identically for the CLI and the MCP process to use another
private directory. The store follows the ledger store: owner-only, exclusive create, sync before
publishing by hard link, and a hash check on every read. Hash integrity is not source
authentication.

### Set schema

The schema is strict:

| Field | Content |
|---|---|
| `schema_version` | `"1.0"` |
| `source_id`, `source_sha256`, `evidence_tier` | Where the set came from; the tier is `historical_exploration`, `prospective` or `synthetic_test` |
| `horizon` | Must be 1: each forecast is for the next day's proxy, and proxies do not overlap |
| `n` | Dimension, 1–8 |
| `underlying_series_ids` | 1..n unique stable series IDs, for example `fxdata-m1:EURUSD`. The prefixes `ledger-source:` and `forecast-set-source:` are reserved. |
| `dates` | Strictly increasing calendar dates, at most 5,000 |
| `windows` | Each date's realized window as canonical UTC `[from, to)`. Windows are strictly increasing and non-overlapping, and each `from` falls on its date or the day before (FX days that start around 21:00–22:00 UTC). |
| `a`, `b`, `primary` | Per date: a scalar, a full n×n matrix, or null |
| `secondary` | Optional, same form |
| `labels` | Optional descriptive labels: at most 50 distinct values, each 1–64 characters |

The normalized set is at most 24 MiB. An n = 1 set is stored as scalars, so a 1×1-matrix encoding
and a scalar encoding hash identically.

A secondary proxy that is identical to the primary, or a scaled copy of it, is rejected as input.
λ is the median of ‖P₂‖/‖P‖ over the days on which both are nonzero (the mean of the two middle
values for an even count); it is a scaled copy if ‖P₂ − λP‖ ≤ 1e-12·‖P₂‖ on every such day and
there are at least 2 of them.

### Validity and precision

- A forecast is valid if it is finite, symmetric within 1e-12·max|S|, and positive-definite
  (Cholesky succeeds). An invalid forecast counts as null.
- A proxy is valid if it is finite, symmetric within the same tolerance, and positive
  semi-definite within τ = 1e-12·max|P|: Cholesky of P + τI succeeds. The all-zero matrix is valid;
  a scalar proxy must be ≥ 0. Scaling P never changes validity.
- **Write proxies at full double precision.** A rank-one proxy r·rᵀ computed in double precision
  is valid. The same matrix with each element rounded separately (for example to 7 significant
  digits) is indefinite by about the rounding error, far beyond τ, and every such day is dropped as
  `proxy_invalid`. Round r if you must, then form the products without rounding them.

## Days and evaluability

Each date is used or dropped for exactly one cause, checked in this order: `proxy_invalid` (the
primary), `both_null`, then `a_only_null` or `b_only_null`. `drops` reports N (all dates), `used`
and each cause.

The result is `not_evaluable`, with the first matching reason, if:
- a loss on a used day is not finite (`non_finite_loss`). A loss can overflow even when the
  forecasts and proxies are valid, for example with a proxy of 1e155 under MSE;
- more than 5% of dates are dropped (`more_than_5_percent_of_dates_dropped`);
- fewer than 100 days are used (`fewer_than_100_used_days`);
- the HAC variance is not positive (`hac_variance_not_positive`: S ≤ 0 or S < 1e-12·mean(d²);
  S is never clamped).

`hard_days` reports B's mean loss on `a_only_null` days next to its mean on used days, and A's
mean loss on `b_only_null` days next to its mean on used days, so you can see whether the
dropped days were hard.

## Losses

d = loss(A) − loss(B); lower is better, so negative d favours A.
- `qlike`: log det S + tr(S⁻¹P); for a scalar, log s + p/s.
- `mse`: the squared Frobenius norm ‖S − P‖².

## The battery

**DM with Newey–West HAC**
- d̄ is the mean over the T used days.
- The long-run variance is S = γ₀ + 2 Σ_{l=1..L} (1 − l/(L+1)) γ_l, where the autocovariances
  γ_l have divisor T.
- The lag is L = min(T − 1, ⌊4(T/100)^(2/9)⌋).
- DM = d̄/√(S/T), with p_A = Φ(DM) and p_B = Φ(−DM). The upper tail is never computed as 1 − Φ.
- Φ uses Cody's erfc, which matches scipy to a relative 1e-12 in both tails.

**Favoured side.** `mean_favours` is `A` if p_A < 0.05, `B` if p_B < 0.05, otherwise
`neither`. This is a two-sided 10% test (`mean_favours_test: two_sided_10_percent`).

**Sub-periods.** The used days, in date order, are split into 4 contiguous blocks of equal
count; the first T mod 4 blocks get one extra day. `sub_periods` gives each block's dates, days
and mean d. Only these blocks can raise a conflict. `caller_label_means` are descriptive.

**Own nulls and the decisive trim.**
- m is the favoured side's own null count: `a_only_null` if A is favoured, `b_only_null` if B is.
- D′ is the used d values plus m copies of the least favourable d observed: the largest d if A is
  favoured, the smallest if B is.
- k = ⌈T/100⌉, counted on used days.
- `trimmed.decisive.mean` is the mean of D′ after removing the k values most favourable to the
  favoured side, reported with `own_nulls_imputed_worst_case: m`.
- `trimmed.both_tails` removes k from each tail of the used d. It is non-decisive.
- With `neither`, `trimmed.decisive` is null, and `a_tail_removed` and `b_tail_removed` give both
  one-sided trims, labelled by forecast.

**Breakdown count.**
- `breakdown.k_star` is the fewest most-favourable values of D′ whose removal makes the mean cross
  zero (≥ 0 for A, ≤ 0 for B); `fraction` is k*/(T + m).
- `k_star_status` is `crossed`, or `no_crossing` with a null k*.
- The trimmed means and k* are read from one array of means, computed from one suffix-sum pass.
- `trimmed_mean_reverses` is raised when k* ≤ k, that is, when removing k or fewer of the most
  favourable values makes the mean cross zero. Removing such a value never moves the mean toward
  the favoured side, so this is the decisive trimmed mean crossing zero. Testing it through k*
  keeps the two exactly consistent at rounding level.
- k* itself is descriptive.
- It is null with `neither`.

**Secondary proxy.**
- It is evaluated on the used days where it is valid and its losses are finite. More than 5% of
  those dropped makes it `not_evaluable`, as does a mean that is not finite (finite days whose
  sum overflows).
- `secondary.mean` is the mean d under it.
- Distinctness is the Spearman ρ between the proxy-dependent parts ⟨G, P⟩ and ⟨G, P₂⟩, where
  G = S_A⁻¹ − S_B⁻¹ for QLIKE and −2(S_A − S_B) for MSE. The forecast-only term of d is left
  out, because it inflates the correlation of the two d series.
- ρ > 0.99, or ρ undefined (a constant rank vector), means not distinct. Spearman uses average
  ranks for ties.
- **Near copies:**
  - `near_copy_share` is the largest share of jointly nonzero days, among those used, on which P₂
    is one common scaling of P.
    - On each such day, P₂ is within 1e-3 relative of rP, where r = ‖P₂‖/‖P‖.
    - The days' ratios agree within 1e-3 relative.
    - Norms are computed with `Math.hypot`, so rescaling a matrix set changes nothing.
  - Above 0.5, a majority of days, the secondary is not distinct, whatever ρ is.
    - Without this rule, a copy of the primary altered on a few days is missed: the input rule
      needs every day, and one extreme day can pull ρ below 0.99.
    - The 1e-3 (0.1%) tolerance also catches a copy that went through rounding of up to that
      relative error, as in common export formats: `%g` in printf or awk keeps 6 significant
      digits, and fixed decimals such as `%.8f` on variances near 1e-4 err by about 1e-4.
  - Genuinely different proxies can share one scale on a minority of days.
    - A scalar day is always a multiple of itself, so it forms a group of at least one.
    - Coarse-tick proxies, for example a squared close-to-close move against a Parkinson range,
      coincide up to a constant on the days that close at one extreme. Floors shared by both
      proxies add more.
    - In the review's measurements across seeds, such proxies stayed below about 0.45 of days from
      about five price changes a day upward. The majority line leaves them distinct.
  - With only a handful of price changes a day, the two proxies coincide on most days and are
    flagged. They then carry nearly the same information, so that is intended.
  - The share is null with fewer than 2 jointly nonzero days.
- `distinct` is judged whenever a secondary is present, even when it is not evaluable, so
  `not_assessed_secondary_proxy_not_distinct` is listed next to
  `not_assessed_secondary_proxy_absent` when both apply.
- `sign_change_share` is the share of days on which d changes sign between the proxies, with
  sign(0) = 0.

**Bootstrap.** A stationary bootstrap with mean block length 20, R = 2,000 draws, seed 20260928:
- The draws share one `createRandom` stream, in order.
- For each draw, the first index is ⌊u·T⌋.
- At each later position, with u < 1/20 the index jumps to ⌊u′·T⌋ with a fresh draw u′;
  otherwise it moves to (previous + 1) mod T.
- The centred, unstudentized one-sided p is (1 + #{s·(d̄* − d̄) ≤ s·d̄})/(1 + R), with s = +1 for A
  and −1 for B.
- With `neither`, s = sign(d̄), or no bootstrap if d̄ = 0.
- `mc_se` = √(p(1 − p)/R). The bootstrap is descriptive.

## Outcome

With A favoured, a conflict is a sub-period mean ≥ 0, a decisive trimmed mean ≥ 0, or an
evaluable secondary's mean ≥ 0; with B favoured every sign is mirrored. `robustness_conflicts`
lists them as `sub_period_<i>_reverses`, `trimmed_mean_reverses` and `secondary_proxy_reverses`.

`battery_outcome` is the first row that matches:

| Order | Value | When |
|---|---|---|
| 1 | `not_evaluable` | The primary is not evaluable |
| 2 | `not_applicable` | `mean_favours` is `neither` |
| 3 | `conflicts_found` | At least one conflict |
| 4 | `blocked_by_dropped_days` | The favoured side's own nulls exceed k (m > k) |
| 5 | `not_assessed_secondary_proxy_absent` | The secondary is missing or not evaluable |
| 6 | `not_assessed_secondary_proxy_not_distinct` | The secondary is not distinct (ρ or near copy) |
| 7 | `no_listed_conflict_untracked` | The call has no `research_id` |
| 8 | `no_listed_conflict` | None of the above. This is not superiority. |

`withheld_reasons` lists every one of rows 4–7 that applies, whichever row won, including when
`conflicts_found` wins, so no reason hides behind another. When row 1 or 2 wins, no side is
favoured and row 4 is undefined, so only rows 5–7 are listed and `withheld_reasons_scope` is
`side_independent_only`; otherwise it is `all`.

`non_decisive_disagreements` lists what is not a conflict:
- `both_tail_trimmed_mean_reverses`;
- `bootstrap_p_not_below_0.05_while_favoured_dm_p_is`;
- `caller_label_reverses:<label>`;
- `non_evaluable_secondary_mean_reverses`.

## Response

Fields appear in this order:
1. `contract`, `status` (`evaluable` and a `reason` when not evaluable);
2. `battery_outcome`, `robustness_conflicts`, `non_decisive_disagreements`, `withheld_reasons`,
   `withheld_reasons_scope`;
3. `search` and `period_usage` (below);
4. `input` (`artifact` or `inline`) and `artifact_id`;
5. the statistics: `loss`, `dm {dbar, S, L, DM, p_a, p_b, T}`, `mean_favours`,
   `mean_favours_test`, `drops`, `hard_days`, `sub_periods`, `trimmed`, `breakdown`, `secondary`,
   `bootstrap {p, mc_se, draws, mean_block, seed}`, `caller_label_means`;
6. `candidateEligible: false`, `statistical_calibration: "not_assessed"`, `limitations`.

When the result is not evaluable, the statistics after `drops` are null where they cannot be
computed; `dm` keeps d̄, S and L when there are at least 2 used days, with `DM` null. No per-date
series is returned. With 5,000 dates, 50 maximum-length labels and a saturated research-ID union,
the response is about 26 KB.

`limitations`:
- `no_listed_conflict_is_not_evidence_of_superiority`
- `battery_checks_sign_not_significance`
- `battery_items_are_not_independent_tests`
- `proxy_noise_can_reverse_rankings`
- `one_historical_path_no_forward_evidence`
- `pairwise_only_no_correction_across_multiple_benchmarks`
- `dm_normal_approximation_weak_under_heavy_tailed_d`
- `forecast_units_and_variance_vs_volatility_are_caller_asserted`
- `not_a_trading_or_risk_management_result`
- `secondary_proxy_independence_is_caller_asserted`
- `secondary_proxy_mean_not_imputed_for_own_nulls`
- `distinctness_measure_shares_forecast_difference_factor`
- `search_counts_cover_this_journal_only`
- `inline_input_not_stored_hash_not_reverifiable`, for inline input

## Records

Without `research_id`, nothing is written: `search` and `period_usage` are `untracked` and the
outcome is at most `no_listed_conflict_untracked`. With it, two records are written, in this order,
before the response.

### Period usage

One `tool_observed` record per series goes to the
[period usage journal](RESEARCH_PERIOD_USAGE.md#automatic-forecast-loss-tracking) as one batch:
every record is validated and conflict- and capacity-checked before any is written. The append
itself is sequential; an I/O failure part-way follows the
[batch resume rule](RESEARCH_PERIOD_USAGE.md#batch). The scope is
`forecast_evaluation_window_only`.
- Index 0 is `forecast-set-source:` plus the lowercase SHA-256 hex digest of the UTF-8
  `source_id`; the underlying series follow in artifact order.
- Access IDs are `<base>:<index>`. The base is `usage_access_id`, or `forecast-access:<uuid>` when
  it is omitted.
- `data_version` is the `artifact_id`. The interval is the window envelope: the earliest window
  start to the latest window end, over every date, dropped ones included.
- `request_sha256` is the SHA-256 of `{"artifact":…,"contract":…,"loss":…}` in that key order.
  A retry with the same base, artifact and loss is idempotent; reusing the base for another loss
  or artifact conflicts.
- Access IDs share one namespace with the other tools, so a base whose `<base>:<index>` IDs exist
  with other content fails closed as a conflict.

`period_usage` returns the `access_id_base`, each record's `access_id`, `series_id` and whether it
was an idempotent retry, and its limitations. Provide `usage_access_id` before the first call when
retries must be idempotent; a generated base is lost with a lost response.

### Exploration journal

One line per call, in the namespace `forecast_loss_comparison_exploration`, at
`TRADINGVIEW_MCP_FORECAST_LOSS_JOURNAL_PATH` (default
`~/.tradingview-mcp/forecast-loss-journal.jsonl`), on the same append-only, owner-only first-seen
log as the other journals, with 32 MiB file and 16 KiB record limits. A record holds:
- the contract, loss, `research_id` and `artifact_id`;
- the per-component hashes: `dates`, `a`, `b`, `primary`, and `secondary` and `labels` (or
  `absent`). Each is the SHA-256 of `JSON.stringify` of the normalized component, a format that
  persists across versions;
- `source_hash`, the SHA-256 of the raw UTF-8 `source_id`: the same digest as the period
  record's `forecast-set-source:` series, so the two records join on it;
- the sorted `underlying_series_ids` and the window `envelope`;
- the `battery_outcome`.

Some damage fails closed without appending: one `artifact_id` recorded with different content, a
torn line, a blank line, or an edit that breaks the schema or the sequence. An edit that keeps a
record valid, such as a changed outcome or research ID, is not detected. The journal is private
local state, not tamper evidence. `not_evaluable` results are recorded too: any response that exposes a
statistic is recorded. Retries are additional calls.

### Failures

If either write fails, the tool returns an error and no statistics. The two journals are not one
transaction. If the journal write fails after the period records were written, the error names
them (`<base>:0-<last>`). A recorded period is an attempted exposure, not proof that anyone saw
the result.

### Search

`search` reports two scopes. Both include this call; the `earlier_no_listed_conflict` counts do
not.
- **`this_research_id`, across all artifacts:**
  - `calls`;
  - `distinct_a_for_same_b_primary_dates`: distinct A hashes among calls with this call's B,
    primary and dates hashes;
  - `distinct_label_sets` and `distinct_secondaries`, with `absent` counted as one value;
  - `distinct_losses`;
  - `earlier_no_listed_conflict`.
- **`overlapping_data`, under any research ID** (including this one):
  - Membership is keyed by data, not by exact hashes. A record is in the set when it shares at
    least one underlying series ID with this call and its envelope overlaps this call's (half-open,
    so touching end to start is not an overlap). Dropping one date or rescaling a proxy therefore
    still lands in the set, and a fresh research ID per variant still shows the search.
  - It reports `calls`, `distinct_research_ids` and `earlier_no_listed_conflict`.
  - It also reports sub-counts by exact hash: `distinct_unordered_ab_pairs` (a swap of A and B is
    the same pair), `distinct_b`, `distinct_dates` and `distinct_primary`.
- **`period_usage_prior_overlap`:** the period records' `prior_overlap` in summary form.
  - It covers every research ID and every tool that recorded the same series, including manual
    reports.
  - `per_series` gives the counts per series ID; the `forecast-set-source:` record is its own
    entry.
  - `overlapping_research_ids` is the sorted union, capped at 100, with
    `overlapping_research_ids_seen`.
  - `overlapping_research_ids_truncated` is true if any record's matches were truncated (each
    assessment carries its first 100) or the union exceeds the cap.
  - Matching records are never listed; use `check_research_period_usage` for detail.

Search counts cover this local journal only. Earlier calls, untracked calls, other machines and
exploration outside this tool are not counted, and the counts are not a multiple-testing
correction.

## Performance

`node scripts/benchmark-forecast-loss.mjs` (after `npm run build`) times a worst-case set: 5,000
dates of 8×8 matrices with a secondary and labels, 18.2 MiB normalized. On the development
machine:
- registering took about 0.6 s;
- reading and verifying took about 0.26 s;
- each comparison, including the 2,000-draw bootstrap, took about 0.15 s.

The benchmark is outside the unit suite so that tests never depend on timing.
