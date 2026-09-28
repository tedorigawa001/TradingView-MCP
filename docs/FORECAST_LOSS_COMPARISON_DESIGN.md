# Forecast loss comparison: design memo (rev 4.2, implemented; code review folded in)

Backlog #101, item 2. Review history:
- rev 1: BLOCK, 14 findings (F1–F14);
- rev 2: APPROVE WITH FINDINGS, 12 new findings (N1–N12);
- rev 3: APPROVE WITH FINDINGS, 7 new findings (M1–M3, L1–L4);
- rev 4: APPROVE WITH FINDINGS, LOW only (P1–P3), with no further design round needed;
- code review of the implementation: APPROVE WITH FINDINGS, 2 MEDIUM and 9 LOW (CR-M1, CR-M2,
  CR-L1–CR-L9).

Rev 4.1 folded in P1–P3 as clarifications. Rev 4.2 folds in the design-level code-review findings,
approved by the user on 2026-09-28:
- non-finite losses fail closed (CR-M1);
- the near-copy rule for the secondary (CR-M2);
- the trim conflict is tested through k* (CR-L1);
- distinctness is judged whenever a secondary is present (CR-L2);
- the access-ID collision rule is amended (CR-L4).

The implementation is in docs/FORECAST_LOSS_COMPARISON.md.

## Problem

Comparing two forecasts by their mean loss is how a weak forecast gets adopted. In the FX
covariance study (#100), HMM2 beat EWMA on the mean QLIKE difference with a significant
Diebold-Mariano test (p = 0.016). But:
- the advantage came from a few extreme days: removing the 1% of days most favourable to HMM2
  turned the mean difference positive;
- a second realized proxy reversed it.

The tool returns the DM test together with a fixed battery. It leads with a mean advantage that
the battery does not support, and with how much searching preceded the call. It never returns a
statement of superiority.

## Scope (v1)

- **Forecasts:** two forecast series, A and B. The labels are the caller's and carry no meaning:
  every rule is symmetric in A and B (F3). Each day's forecast is a variance (scalar) or a full
  n x n covariance matrix, with n ≤ 8 and n constant across days. Horizon 1 only (F7): each
  forecast is made for the next day's proxy, and proxies do not overlap.
- **Proxies:** a primary proxy and a secondary proxy per day. Without a secondary proxy the result
  can never be `no_listed_conflict` (F1).
- **The secondary must be distinct from the primary (N2, M3):**
  - **Rejected as input:**
    - a secondary equal to the primary, by component hash or element-wise;
    - a scaled copy (P1). λ is the median of ‖P₂_t‖_F / ‖P_t‖_F over the days on which both
      proxies are nonzero. It is a scaled copy if ‖P₂_t − λP_t‖_F ≤ 1e-12·‖P₂_t‖_F on all of those
      days and there are at least 2 of them. Days on which exactly one proxy is zero do not enter
      the test.
  - **Measure:** for both losses, d_t = c_t + ⟨G_t, P_t⟩, where c_t and G_t depend only on the
    forecasts:
    - QLIKE: c = log det S_A − log det S_B, G = S_A⁻¹ − S_B⁻¹;
    - MSE: c = ‖S_A‖² − ‖S_B‖², G = −2(S_A − S_B).

    The shared forecast-only term c_t inflates any correlation of the two d series. So
    distinctness is measured on the proxy-dependent parts only: the Spearman ρ between ⟨G_t, P_t⟩
    and ⟨G_t, P₂_t⟩ over the days used by both. The share of days on which d changes sign between
    the two proxies is reported as well.
  - If ρ > 0.99, or if ρ is undefined (a constant series, or all ties), the secondary is
    `not_distinct`.
  - **Near copies (CR-M2):**
    - The secondary is also `not_distinct` when one common scaling of the primary covers more
      than 5% of the jointly nonzero days, among the days used by both. That is the largest group
      of days on which P₂ is within 1e-12 of λP for one λ, with the group's ratios agreeing within
      1e-12 relative.
    - Without this rule, a copy of the primary altered on one extreme day passes: the input rule
      needs every day, and one full-range rank move pulls ρ below 0.99.
  - Distinctness is judged whenever a secondary is present, even when it is not evaluable, so
    row 6 is listed alongside row 5 (CR-L2).
  - Both parts still share the sign and scale of G_t, so ρ remains biased upward. The bias is
    conservative: it can only produce more `not_distinct`, never a pass. A limitation says so (P2).
  - Whether the secondary is independent of the primary is the caller's assertion, and a
    limitation says so.
- **Losses** (lower is better; d = loss(A) − loss(B)):
  - `qlike`: log det S + tr(S⁻¹P); for a scalar, log s + p/s. This differs from Patton's
    normalized form only by a term that depends on the proxy alone, which cancels in d.
  - `mse`: the squared Frobenius norm ‖S − P‖²_F.
- **Validity (F8):**
  - A forecast is valid if it is finite, symmetric within 1e-12·max|S|, and Cholesky
    positive-definite.
  - A proxy is valid if it is finite, symmetric within the same tolerance, and positive
    semi-definite within tolerance: smallest eigenvalue ≥ −1e-12·max|P|. The all-zero matrix is
    valid, and a scalar proxy must be ≥ 0. A rank-one r·r' proxy is therefore valid, and scaling P
    by c > 0 never changes validity (N11).
- **Not in v1:** forecast generation, VaR and portfolio backtests (#101 item 3), realized-covariance
  construction (item 4), comparisons across more than two forecasts.

## Days, drops and evaluability (F2)

- **Denominator:** all dates in the set, N.
- **Drop causes:** each date is either used or dropped for exactly one cause, checked in this order
  (N9):
  1. `proxy_invalid` (primary proxy): no loss exists without a valid proxy;
  2. `both_null`;
  3. `a_only_null` or `b_only_null`.

  All four counts are reported.
- **Evaluability:** the result is `not_evaluable` if dropped/N > 5%, or if the number of used
  days T < 100.
- **Non-finite losses (CR-M1):** a loss can overflow even when the forecasts and proxies are
  valid, for example with a proxy of 1e155 under MSE.
  - A non-finite d on a used day makes the result `not_evaluable` with reason
    `non_finite_loss`, checked first.
  - A non-finite secondary d, or a non-finite proxy-dependent part, makes that day an invalid
    secondary day.
- **Hard-day diagnostics:**
  - B's mean loss on `a_only_null` days is reported next to B's mean loss on used days.
  - A's mean loss on `b_only_null` days is reported next to A's mean loss on used days.
  - These show whether the dropped days were hard.
- **Own-null rule** (the user chose worst-case imputation for N5; defined precisely per M1):
  - Let m be the favoured side's own-null count: `a_only_null` if A is favoured, `b_only_null` if
    B is. Only the favoured side's own nulls are imputed, never the other side's.
  - **The imputed sample D′** is the T used d values plus m copies of the least favourable d
    observed on used days: the largest d if A is favoured, the smallest if B is. It is always
    applied, whatever m is.
  - The decisive trim and k* are both computed on D′, identically (below).
  - The trim count stays k = ceil(T/100), computed on the used days.
  - `no_listed_conflict` is impossible when m > k. With m ≤ k it is allowed, subject to the
    other rows.
  - The favoured side therefore gets no help from its own nulls beyond the trim itself. The
    secondary-proxy mean is not imputed, so own nulls can still help the favoured side there, and
    a limitation says so.
- **Secondary proxy:** it is evaluated on the used days where it is valid, with its own drop count.
  Above 5% dropped, it is `not_evaluable`. A non-evaluable secondary raises no conflict; its mean,
  if computed, goes in `non_decisive_disagreements[]` (N3).

## The fixed battery

Nothing in the battery can be set per call: it is part of the contract `forecast_loss_comparison_v1`.

**DM (F7)**
- Mean d̄ over the T used days, and e_t = d_t − d̄.
- Long-run variance S = γ₀ + 2 Σ_{l=1..L} (1 − l/(L+1)) γ_l, where γ_l = (1/T) Σ_{t>l} e_t e_{t−l},
  with the divisor T.
- Lag L = min(T − 1, floor(4 (T/100)^(2/9))).
- DM = d̄ / sqrt(S/T). Normal reference: p_A = Φ(DM) for "A better" and p_B = 1 − p_A.
- If S ≤ 0 or S < 1e-12·mean(d²): `not_evaluable`, with no clamping.
- The existing `neweyWestConfidenceInterval` helper clamps S and must not be reused.

**Favoured side**
- `mean_favours` is `A` if p_A < 0.05, `B` if p_B < 0.05, else `neither`.
- This is a 10% two-sided test, and the output says so.

**Sub-periods (F1)**
- The tool splits the used days, in date order, into 4 contiguous blocks with equal counts (the
  first T mod 4 blocks get one extra day).
- Each block's mean d is reported.
- Only these fixed blocks can raise a conflict. Caller labels, if supplied, are reported as
  descriptive means and never raise a conflict.

**Trimmed means (F3, F12)**
- The trim count is k = ceil(T/100), computed in integers.
- **Decisive trim:** the k values of D′ most favourable to the favoured side are removed: the
  smallest if A is favoured, the largest if B is. `trimmed_mean_decisive` is the mean of the
  remaining T + m − k values, reported with `own_nulls_imputed_worst_case: m`.
- The trimmed mean does not depend on which of several tied days is removed.
- **Symmetric trim (N7):** the both-tail 1% trimmed mean (k removed from each tail) is also reported.
  It is non-decisive. The one-sided trim of the other tail is not reported: it can never reverse
  the mean, so it would suggest a check that does not exist.
- **`neither` (N8):** when `mean_favours = neither`, both one-sided trims are reported, labelled by
  forecast (`trimmed_mean_a_tail_removed` and `trimmed_mean_b_tail_removed`). None is decisive.

**Breakdown count (F11)**
- k* is the smallest number of values of D′ most favourable to the favoured side whose removal
  makes the mean of the remaining values cross zero (≥ 0 when A is favoured, ≤ 0 when B is).
- Reported as k* and k*/(T + m). It is descriptive and never a conflict.
- If no removal crosses zero, k* is null with `k_star_status: no_crossing`. With `neither` it is not
  computed (N8).
- Consistency, tested: removing a most-favourable value never moves the mean toward the favoured
  side, so on the same D′ with the same k, a decisive-trim conflict occurs exactly when k* ≤ k.
- **Rounding (CR-L1):**
  - The trimmed means and k* read one array of means computed from one suffix-sum pass.
  - The conflict is raised when k* ≤ k. Mathematically this is the same as the decisive mean
    crossing zero, and it stays exact at rounding level, where separate summations had disagreed.

**Secondary proxy**
- The mean d under the secondary proxy.

**Bootstrap (F6)**
- A stationary bootstrap:
  - geometric block lengths with mean 20, wrapping circularly;
  - R = 2,000 draws with a fixed seed, using the repository's seeded generator (`createRandom`,
    extracted to a shared module; the three existing copies are the same generator, so their
    sequences are unchanged).
- For the favoured side, it reports the centred, unstudentized p:
  p = (1 + #{s·(d̄*_r − d̄) ≤ s·d̄}) / (1 + R), where s = +1 if A is favoured and −1 if B is.
- With `neither`, s = sign(d̄), or null if d̄ = 0 (N8).
- The Monte Carlo standard error is reported as well. The bootstrap is descriptive.

## Conflicts and outcome (F1, F3, F5)

With `mean_favours = A`, a conflict is any of the following. With B favoured, every sign is
mirrored.
- a fixed sub-period mean ≥ 0;
- the decisive trimmed mean ≥ 0;
- the secondary-proxy mean ≥ 0.

`battery_outcome` is the first matching row, top to bottom (N3):

| Order | Value | When |
|---|---|---|
| 1 | `not_evaluable` | The primary is not evaluable (any evaluability rule above). |
| 2 | `not_applicable` | `mean_favours = neither`. There are no conflicts to evaluate. |
| 3 | `conflicts_found` | At least one conflict. They are listed in `robustness_conflicts[]`. |
| 4 | `blocked_by_dropped_days` | The favoured side's own nulls exceed ceil(T/100). |
| 5 | `not_assessed_secondary_proxy_absent` | The secondary proxy is missing or not evaluable. |
| 6 | `not_assessed_secondary_proxy_not_distinct` | The secondary's ρ exceeds 0.99 or is undefined (N2), or it is a near copy (CR-M2). |
| 7 | `no_listed_conflict_untracked` | The call has no `research_id` (F4). |
| 8 | `no_listed_conflict` | None of the above. The listed sign checks did not flip; this is not superiority. |

`withheld_reasons[]` lists every one of rows 4–7 that applies, whichever row won, including when
`conflicts_found` wins. So no reason is ever hidden behind another.

When row 1 or 2 wins, no side is favoured, so row 4 (own nulls) is undefined. Only the
side-independent reasons (rows 5, 6, 7) are listed, and the output says so (L1).

`non_decisive_disagreements[]` lists what is not a conflict:
- the both-tail trimmed mean reversing;
- the bootstrap p ≥ 0.05 while the favoured side's DM p (p_a or p_b) < 0.05;
- caller-label periods reversing;
- a non-evaluable secondary's mean reversing.

An empty conflicts list therefore does not hide these.

## Output

- **Field order:** `contract`, `status` (with a reason when `not_evaluable`), then:
  - `battery_outcome`, `robustness_conflicts[]`, `non_decisive_disagreements[]`;
  - `search` (below);
  - the statistics: `dm {dbar, S, L, DM, p_a, p_b, T}`, `mean_favours`, `drops {…by cause, N}`,
    hard-day diagnostics, `sub_periods[4]`, `trimmed_mean_decisive` (with
    `own_nulls_imputed_worst_case`), `trimmed_mean_both_tails`, `breakdown {k_star, fraction,
    k_star_status}`, `secondary {mean, used, dropped, spearman_rho, sign_change_share}`,
    `bootstrap {p, mc_se}`, and descriptive `caller_label_means`.
- **Always the same:** `candidateEligible: false`, `statistical_calibration: "not_assessed"`.
- **Limitations:**
  - `no_listed_conflict_is_not_evidence_of_superiority`;
  - `battery_checks_sign_not_significance`;
  - `battery_items_are_not_independent_tests`;
  - `proxy_noise_can_reverse_rankings`;
  - `one_historical_path_no_forward_evidence`;
  - `pairwise_only_no_correction_across_multiple_benchmarks`;
  - `dm_normal_approximation_weak_under_heavy_tailed_d`;
  - `forecast_units_and_variance_vs_volatility_are_caller_asserted`;
  - `not_a_trading_or_risk_management_result`;
  - `secondary_proxy_independence_is_caller_asserted`;
  - `secondary_proxy_mean_not_imputed_for_own_nulls`;
  - `distinctness_measure_shares_forecast_difference_factor`;
  - `search_counts_cover_this_journal_only`;
  - `inline_input_not_stored_hash_not_reverifiable` when the input was inline.

## Input (F10)

**A forecast evaluation set** holds the following. The artifact schema is strict:

| Field | Content |
|---|---|
| `source_id`, `source_sha256`, `evidence_tier` | Where the set came from |
| `horizon` | Must be 1 |
| `n` | Dimension |
| `underlying_series_ids` | 1..n unique stable series IDs, for example `fxdata-m1:EURUSD` (M2) |
| `dates` | Strictly increasing unique calendar dates |
| `windows` | Each date's realized window as explicit UTC `[from, to)` canonical timestamps. Windows must be strictly increasing and non-overlapping. There is no time-zone rule (N6). Each window's `from` must fall on its date or on the calendar day before it (covering FX days that start around 21:00–22:00 UTC the previous day) (L4). |
| `a`, `b`, `primary` | Full n x n matrices, or scalars, per date |
| `secondary` | Optional |
| `labels` | Optional descriptive labels |

Limits:
- at most 5,000 dates;
- at most 24 MiB for the normalized artifact, below the store's 32 MiB file limit;
- underlying series IDs may not start with the reserved prefixes `ledger-source:` or
  `forecast-set-source:` (N4).

**Normalization (N12):** an n = 1 set is canonicalized to scalars, so a 1x1-matrix encoding and a
scalar encoding of the same data hash identically.

**Two ways in:**
- **Artifact:** the import CLI (with a `bin` entry) normalizes and hashes the set and stores it in
  its own directory, `TRADINGVIEW_MCP_FORECAST_SET_DIR`. The tool takes the `artifact_id`.
- **Inline:** a scalar set of up to 2,000 dates, in exactly the same schema. It is normalized and
  hashed by the same function, so the same content gets the same hash on either path.

## Records (F4, F9, F13)

With `research_id` and an optional `usage_access_id`, records are written in this order, and then
the response:
1. **Period usage** (`tool_observed`, `purpose: exploration`), through a new store method
   `recordToolAccessBatch`, built on the existing atomic `recordBound`:
   - one record per underlying series ID, plus one for `forecast-set-source:` + sha256(source_id);
   - access IDs are the base + `:` + index. The base is capped at 100 characters, so every ID
     stays within the 120-character identifier rule (L3):
     - the base is `usage_access_id`, or `forecast-access:<uuid>` when it is omitted, as the
       ledger does with `ledger-access:<uuid>`;
     - index 0 is the `forecast-set-source:` record, and the underlying series follow in artifact
       order, so a retry maps to the same access IDs;
     - access IDs share one namespace with every other tool and manual report, so a base whose
       `<base>:<index>` IDs already exist with other content fails closed as a conflict. Amended
       by CR-L4: a base that merely equals another access ID is not rejected. It creates no
       ambiguity, since the exact-ID conflict check is what protects retries;
   - `request_sha256` is the hash of {contract, artifact hash, loss}, so a retry with a different
     loss conflicts rather than becoming idempotent;
   - the envelope runs from the earliest validated window start to the latest window end, over
     all dates including dropped ones;
   - the limitation is `forecast_estimation_history_not_covered`.
   - **Store changes (N4):**
     - The current discriminated union cannot take a second `tool_observed` variant: zod 4 rejects
       a duplicate discriminator value.
     - Instead, use one `tool_observed` variant with `tool_name` and `scope` enums, plus a
       refinement that binds each tool to its own scope. That way a ledger record cannot carry the
       forecast scope.
     - Make `assess()` emit the ledger-specific limitations only for ledger records.
     - Update the contract doc's statement that only the ledger summary is tracked.
2. **Exploration journal:**
   - a new namespace and file, `forecast_loss_comparison_exploration` under its own environment
     variable;
   - one record per call, with the contract, loss, research_id, artifact hash, per-component
     hashes (dates, a, b, primary, secondary or absent, labels), `battery_outcome`, and (M2)
     sha256(source_id), the sorted `underlying_series_ids` and the window envelope [from, to).

Any response that exposes a statistic is recorded, `not_evaluable` included. If either write
fails, no statistics are returned. As with the ledger, a failure between the two writes can leave
the period record without its journal entry; the response says so.

`search` reports two scopes.

**This research_id, across all artifacts:**
- the number of calls;
- the distinct A hashes for the same (B, primary, dates);
- distinct sub-period label sets;
- distinct secondaries, with absent counted as one;
- distinct losses queried;
- how many earlier calls returned `no_listed_conflict`.

**All research IDs, keyed by overlapping data (N1, M2):** the overlap set is every earlier journal
record, under any research ID, that shares at least one underlying series ID with this call and
whose envelope overlaps this call's envelope. Exact hashes are not the key, because dropping one
date or rescaling a proxy would change them. Over the overlap set, `search` reports:
- calls;
- distinct research IDs;
- earlier `no_listed_conflict` outcomes;
- sub-counts by exact hash:
  - distinct unordered {A, B} pairs, so role swaps are visible;
  - distinct B hashes;
  - distinct `dates` hashes, since shifting the start moves the block boundaries;
  - distinct primary hashes.

It also includes the period records' `prior_overlap`, which covers all research IDs, including
calls from other tools. It is aggregated into `summary_only` form (P3):
- counts per underlying series ID, with the `forecast-set-source:` record listed as its own entry;
- the union of research IDs across the n + 1 records;
- `overlapping_research_ids_truncated`, true if any record's matches were truncated (the summary
  takes research IDs from the first 100 matches), so the union never silently undercounts. Underlying series IDs must be unique,
so no record's `prior_overlap` counts a sibling from the same batch. A fresh research_id per
variant therefore still shows the search.

Without `research_id`, `search` is `untracked`, and the outcome can be at most
`no_listed_conflict_untracked`.

## Tests (F14)

- **Reference values:**
  - HAC variance, DM and the lag on fixed fixtures, pinned from an independent implementation
    computed offline (N10):
    - statsmodels OLS of d on a constant with `cov_type="HAC"`,
      `cov_kwds={"maxlags": L, "use_correction": False}` and z-based inference;
    - or R `sandwich::NeweyWest(lag = L, prewhite = FALSE, adjust = FALSE)`, with `lag` passed
      explicitly;
  - the source and version are recorded next to the fixture;
  - R `dm.test` uses a different variance and is not a reference.
- **Hand-computed checks:** QLIKE and MSE on 2x2 matrices, the trim with ties, k*, the block
  split with T mod 4 ≠ 0.
- **Pattern fixtures (synthetic only):**
  - a few-day advantage produces a decisive-trim conflict;
  - a uniform advantage with a secondary proxy and a research_id gives `no_listed_conflict`;
  - the same without a secondary gives `not_assessed_secondary_proxy_absent`;
  - a secondary proxy with the opposite ranking gives a conflict;
  - A null on the hardest days beyond ceil(T/100) gives `blocked_by_dropped_days`;
  - a skewed d where the centred and percentile bootstrap p differ by more than 0.05;
  - a secondary identical to the primary is rejected, and a near-copy (ρ > 0.99) gives
    `not_assessed_secondary_proxy_not_distinct`;
  - a fresh research_id per variant still shows the calls in the data-keyed `search`;
  - own nulls imputed worst case turn a borderline pass into a decisive-trim conflict;
  - a decisive-trim conflict occurs exactly when k* ≤ k, on the same imputed sample D′, including
    at m = k;
  - a scaled copy of the primary is rejected, including in matrix form, and a set with fewer than
    2 jointly nonzero days is not rejected;
  - a genuinely different proxy is not flagged `not_distinct` when the forecasts differ strongly
    in level. The fixture uses realistic proxy noise (a squared-return-like secondary,
    P₂ = P·χ²₁) and is fixed before the implementation is run, so it cannot be tuned to pass (P2);
  - dropping one date or rescaling a proxy still lands in the data-keyed overlap set.
- **Metamorphic:**
  - swapping A and B mirrors every output;
  - scaling S and P by c > 0 leaves QLIKE d unchanged;
  - reversing the date order leaves DM unchanged;
  - an iid mean-zero d gives a roughly uniform bootstrap p over seeds (in the test only).
- **Mutation targets:**
  - the sign of d, and the p tail (Φ vs 1 − Φ);
  - the Bartlett weight (L+1 vs L), the autocovariance divisor (T vs T − l) and the lag cap;
  - QLIKE tr(S⁻¹P) vs tr(P⁻¹S);
  - the trim side and the trim count;
  - the conflict comparison (≥ vs >);
  - the 4-block split;
  - the secondary-required rule and the own-null rule;
  - the `neither` branch;
  - bootstrap centring and direction;
  - the proxy PSD rule;
  - the untracked cap;
  - the outcome row order, and `withheld_reasons` completeness;
  - the drop-cause order;
  - the secondary identity, scaled-copy and ρ rules, and ρ taken on d instead of the
    proxy-dependent parts;
  - the worst-case own-null imputation: imputing the wrong side, a different sample for k* and
    the trim, the denominator, and the m = k boundary;
  - the overlap-set key (series and envelope, not hashes);
  - the tool/scope binding in the period store;
  - `candidateEligible`.

## Decisions (user, 2026-09-28)

1. **Input:** an artifact through the import CLI, plus inline scalar sets of up to 2,000 dates in
   the same schema.
2. **Records:** `research_id` writes the period-usage records (per underlying series, through the
   batch call) and the tool's own exploration journal.
3. **Trim** (revised after review F3): both tails are reported. The tail favourable to the side
   the mean favours is decisive.
4. **Losses:** `qlike` and `mse` only in v1.
5. **Sub-periods (F1):** 4 fixed contiguous equal-count blocks decide. Caller labels are
   descriptive only.
6. **Untracked calls (F4):** at most `no_listed_conflict_untracked`.
7. **Reference values (F14):** pinned from statsmodels, computed offline. statsmodels is not
   installed here; installing it needs the user's permission at implementation time.
8. **Own nulls (N5):** worst-case imputation in the decisive trim, plus the ceil(T/100) cap.
9. **Windows (N6):** explicit per-date UTC windows only.
10. **Secondary distinctness (N2):** Spearman ρ > 0.99 means not distinct. Per M3 it is measured
    on the proxy-dependent parts of d, and scaled copies are rejected outright. Per CR-M2, a
    common scaling on more than 5% of jointly nonzero days also means not distinct.
