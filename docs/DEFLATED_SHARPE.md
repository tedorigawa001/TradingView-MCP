# Deflated Sharpe ratio (`compute_deflated_sharpe`)

BACKLOG 103-2. A pure computation: it reads no chart, journal or file, and writes nothing. It answers one question:
after trying N configurations, is the selected one's Sharpe ratio still credible?

## Units (they decide whether the answer means anything)
- Every Sharpe ratio is **per period** of `returns`: the mean divided by the standard deviation with T − 1, and no
  risk-free rate.
- Every trial covers the **same sample and length** as the selected configuration.
- Converting annualized figures:
  - an annualized Sharpe ratio is divided by √(periods per year);
  - an annualized variance of Sharpe ratios is divided by the periods per year, not by its square root.
- TradingView's `sharpeRatio`, which `get_strategy_report` and the strategy journal expose, is computed against a 2%
  risk-free rate. It is not compatible.

The tool description and schema text repeat these rules, because an MCP client sees only those.

## Inputs

| Field | Meaning |
|---|---|
| `returns` | The selected configuration's per-period returns: 2 to 100,000 finite numbers in one unit, each of magnitude at most 1e300 |
| `trial_sharpes` | The per-period Sharpe ratios of **every** configuration tried, the selected and discarded ones included: 2 to 100,000 finite numbers, each of magnitude at most 1e6 |
| `effective_trial_count` | With `trial_sharpes` only: the effective number of independent trials (2 to 1,000,000,000), when trials are correlated or grouped. It replaces the listed count in SR₀ and the minimum backtest length |
| `trial_count`, `trial_sharpe_variance` | Instead of `trial_sharpes`: the number of (effectively independent) trials N, from 2 to 1,000,000,000, and the variance of their per-period Sharpe ratios, from 0 to 1e12. Give both or neither |
| `periods_per_year` | Optional, positive, at most 1e8. Annualizes the Sharpe ratio for display, gives the minimum backtest length in periods, and enables the unit checks |
| `target_annual_sharpe` | Optional, from 1e-4 to 1e4, default 1. The annualized Sharpe ratio the minimum backtest length guards against |

Exactly one of `trial_sharpes` and the pair (`trial_count`, `trial_sharpe_variance`) is required.

Every numeric input must be a finite number of type number; null, strings and booleans are refused even on a direct
call of the function, where a range comparison alone would coerce them. Only an omitted `target_annual_sharpe` takes
the default. The ranges are wide enough for any real use. They keep every returned number finite, so an MCP response never carries
a null; a final check throws if a non-finite number would still be returned.

## Computation

**Sample statistics** of `returns`, over T observations:
- the mean μ̂, and the standard deviation σ̂ with T − 1;
- SR̂ = μ̂/σ̂;
- skewness γ₃ = m₃/m₂^{3/2} and kurtosis γ₄ = m₄/m₂², not excess (3 for a normal distribution), where m_k =
  (1/T) Σ (r − μ̂)^k.
- The statistics are computed in normalised units. The returns are first divided by their largest magnitude, and the
  deviations again by theirs before the moments are formed. Every step works on numbers near 1, so proportional inputs
  give the same SR̂, γ₃ and γ₄, subnormal ones included: [5e-324, 1e-323] gives what [1, 2] gives.
- The reported `mean` and `standard_deviation` are converted back to the input's unit. For subnormal inputs they may
  round towards zero there; the statistics do not.

**Standard error of the Sharpe ratio**, in the form Bailey and López de Prado use (after Mertens 2002, with T − 1):

  se = sqrt((1 − γ₃·SR̂ + ((γ₄ − 1)/4)·SR̂²) / (T − 1))

The variance term is never negative, because γ₄ ≥ γ₃² + 1 for any distribution, the empirical one included. The tool
still checks it, as a guard against rounding.

**Probabilistic Sharpe ratio:** PSR(SR*) = Φ((SR̂ − SR*)/se). `psr_zero` is PSR(0).

**Expected maximum Sharpe ratio of N unskilled trials** (Bailey and López de Prado 2014, JPM 40(5)):

  SR₀ = sqrt(V) · ((1 − γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)))

- V is the trials' variance; from `trial_sharpes` it is the sample variance with N − 1.
- γ is the Euler–Mascheroni constant.
- The upper quantiles are computed as −Φ⁻¹(1/N) and −Φ⁻¹(1/(N·e)), so 1 − 1/N is never rounded first.
- For small N the approximation runs a few percent below the exact expected maximum (N = 2: 0.520 against 0.564), as in
  the paper.

**Deflated Sharpe ratio:** DSR = PSR(SR₀).

**Minimum backtest length** (Bailey, Borwein, López de Prado and Zhu 2014, Notices of the AMS 61(5)):

  MinBTL ≈ (((1 − γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e))) / target_annual_sharpe)² years

- With N = 7 and a target of 1 it is about 1.92 years; with N = 45, about 5 years.
- The paper's upper bound 2·ln(N)/target² is reported beside it.
- With `periods_per_year`, the length is also given in periods.

**Numerics.** Φ uses the repository's erfc (Cody). Φ⁻¹ uses Wichura's AS241, with the published coefficients,
identical to CPython's `statistics`.

## Output
- `status`: `evaluated` or `not_evaluable`.
- The selected configuration:
  - `observations`, `mean`, `standard_deviation`, `sharpe` (per period);
  - `annualized_sharpe` when `periods_per_year` is given;
  - `skewness`, `kurtosis`, `sharpe_standard_error`, `psr_zero`.
- `trials`:
  - `count`, `sharpe_variance`, `source` (`trial_sharpes` or `summary`);
  - `count_source: effective_trial_count` when that input was used;
  - `variance_to_sampling_variance`: V/se². It is about 1 for independent unskilled trials of the same length; far
    below suggests correlated or duplicated trials, far above suggests annualized or mixed units;
  - from `trial_sharpes` also:
    - `listed`, `mean_sharpe`, `max_sharpe`, `duplicate_values`;
    - `selected_matches_a_trial`: whether the nearest trial is within max(0.01·se, 1e-9·max(1, |SR̂|)) of SR̂. That is
      loose enough for rounding to about eight decimals. A trial computed with the population standard deviation
      differs by SR̂·(sqrt(T/(T − 1)) − 1), so it matches only when that difference is below the tolerance: in long
      samples with modest Sharpe ratios. Thirty alternating returns of −0.01 and +0.03 do not match;
    - `nearest_trial_sharpe` and `nearest_trial_distance`.
- `expected_max_sharpe` (SR₀, per period) and `deflated_sharpe`.
- `min_backtest_length`: `target_annual_sharpe`, `years`, `upper_bound_years`, and `periods` when `periods_per_year` is
  given.
- `warnings` and `limitations`.

### Not evaluable
The status is `not_evaluable`, with a reason, when any of the following holds:
- σ̂ is 0;
- the variance term is not positive (a rounding guard);
- any statistic is non-finite.

The descriptive `observations`, `mean`, `standard_deviation`, `trials` and `min_backtest_length` are still reported. No
Sharpe statistic is.

### Warnings

| Warning | Condition |
|---|---|
| `short_sample` | T < 30 |
| `trial_count_from_summary` | N and V were given, not derived |
| `zero_trial_variance` | V = 0, so SR₀ = 0 and DSR equals PSR(0) |
| `trial_variance_far_below_sampling` | 0 < V/se² < 0.25 |
| `trial_variance_far_above_sampling` | V/se² > 4 |
| `backtest_shorter_than_min_length` | With `periods_per_year`: T / periods_per_year is below the minimum backtest length in years |
| `selected_not_among_trials` | No trial matches SR̂ within the tolerance |
| `selected_below_trial_max` | SR̂ is below the trials' maximum by more than the tolerance |
| `duplicate_trial_sharpes` | Some trial values repeat exactly |
| `trial_sharpes_look_annualized` | With `periods_per_year`: a trial equals the annualized SR̂ (within the tolerance times √ppy) |

## Limitations, stated in every response
- The unit rules above.
- SR₀ assumes independent trials. With `trial_sharpes`, correlated or duplicated trials shrink the estimated V and can
  inflate the DSR, while clusters of similar trials can deflate it, so the direction is not guaranteed. Group similar
  configurations and pass the group-level count and variance, or an `effective_trial_count`.
- N must count every configuration tried, discarded ones included. An undercount inflates the DSR.
- The standard error assumes no serial correlation in the returns. Autocorrelated returns can misstate the Sharpe
  ratio's precision (Lo 2002).
- A high DSR is not evidence of profitability after costs. It says only that the selection is unlikely to be luck alone,
  given the stated N and V.
