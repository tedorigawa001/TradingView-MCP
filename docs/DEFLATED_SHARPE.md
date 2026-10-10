# Deflated Sharpe ratio (`compute_deflated_sharpe`)

BACKLOG 103-2. A pure computation: it reads no chart, journal or file, and writes nothing. It answers one question:
after trying N configurations, is the selected one's Sharpe ratio still credible?

## Inputs

| Field | Meaning |
|---|---|
| `returns` | The selected configuration's per-period returns: 2 to 100,000 finite numbers in one unit (simple or log, any scale) |
| `trial_sharpes` | The per-period Sharpe ratios of **every** configuration tried, including the selected one and every discarded one: 2 to 100,000 finite numbers |
| `trial_count`, `trial_sharpe_variance` | Instead of `trial_sharpes`: the number of trials N (2 to 1,000,000,000, an integer) and the variance of their per-period Sharpe ratios (≥ 0). Give both or neither |
| `periods_per_year` | Optional, positive. Annualises the Sharpe ratio for display, and gives the minimum backtest length in periods |
| `target_annual_sharpe` | Optional, positive, default 1. The annualised Sharpe ratio the minimum backtest length guards against |

Exactly one of `trial_sharpes` and the pair (`trial_count`, `trial_sharpe_variance`) is required.

All Sharpe ratios are **per period** in the frequency of `returns`. Annualised trial Sharpe ratios must be divided by
the square root of the periods per year before they are passed.

## Computation

**Sample statistics** of `returns`, over T observations:
- the mean μ̂, and the standard deviation σ̂ with T − 1 in the denominator;
- SR̂ = μ̂/σ̂;
- skewness γ₃ = m₃/m₂^{3/2} and kurtosis γ₄ = m₄/m₂² (not excess; 3 for a normal distribution), where m_k = (1/T) Σ (r − μ̂)^k.

**Standard error of the Sharpe ratio** (Mertens 2002, as used by Bailey and López de Prado):

  se = sqrt((1 − γ₃·SR̂ + ((γ₄ − 1)/4)·SR̂²) / (T − 1))

**Probabilistic Sharpe ratio:** PSR(SR*) = Φ((SR̂ − SR*)/se). `psr_zero` is PSR(0).

**Expected maximum Sharpe ratio of N trials with no skill** (Bailey and López de Prado 2014, JPM 40(5)):

  SR₀ = sqrt(V) · ((1 − γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)))

- V is the variance of the trials' Sharpe ratios. From `trial_sharpes` it is the sample variance, with N − 1 in the
  denominator.
- γ ≈ 0.5772156649 is the Euler–Mascheroni constant.

**Deflated Sharpe ratio:** DSR = PSR(SR₀), the probability that the true Sharpe ratio exceeds what N unskilled trials
would be expected to reach.

**Minimum backtest length** (Bailey, Borwein, López de Prado and Zhu 2014, Notices of the AMS 61(5)):

  MinBTL ≈ (((1 − γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e))) / target_annual_sharpe)² years

- It is the shortest backtest in which N trials of strategies with no skill are not expected to show an annualised
  Sharpe ratio of `target_annual_sharpe` by luck. With N = 7 and a target of 1 it is about 1.92 years.
- The paper's upper bound 2·ln(N)/target² is reported beside it.
- With `periods_per_year`, the length is also given in periods.

**Numerics.**
- Φ is computed from the repository's erfc; Φ⁻¹ uses Wichura's AS241 (relative error about 1e-16).
- The moments use two passes for stability.

## Output
- `observations`, `mean`, `standard_deviation`, `sharpe` (per period), and `annualized_sharpe` when
  `periods_per_year` is given;
- `skewness`, `kurtosis`, `sharpe_standard_error`, `psr_zero`;
- `trials`:
  - `count`, `sharpe_variance`, `source` (`trial_sharpes` or `summary`);
  - from `trial_sharpes` also `mean_sharpe`, `max_sharpe`, and `selected_matches_a_trial`: whether SR̂ equals some
    trial's Sharpe ratio within 1e-9·max(1, |SR̂|);
- `expected_max_sharpe` (SR₀, per period), `deflated_sharpe`;
- `min_backtest_length`: `target_annual_sharpe`, `years`, `upper_bound_years`, and `periods` when `periods_per_year` is
  given;
- `warnings`, `limitations`.

### Not evaluable
The status is `not_evaluable`, with a reason and no statistics derived from it, when any of the following holds:
- σ̂ is 0;
- the variance term 1 − γ₃·SR̂ + ((γ₄ − 1)/4)·SR̂² is not positive;
- any result is non-finite.

Otherwise the status is `evaluated`.

### Warnings
- `short_sample`: T < 30.
- `trial_count_from_summary`: N and V were given, not derived, so they cannot be checked.
- `selected_not_among_trials`: `trial_sharpes` was given and no trial matches SR̂.
- `selected_below_trial_max`: SR̂ is below the trials' maximum.

## Limitations, stated in every response
- SR₀ assumes the N trials are independent. Correlated trials have a smaller effective N, so SR₀ and MinBTL then
  overstate the bar. Pass an effective N when it is known.
- N must count every configuration tried, discarded ones included. An undercount inflates the DSR.
- The standard error assumes no serial correlation in the returns. Autocorrelated returns (for example intraday bars)
  can misstate the Sharpe ratio's precision (Lo 2002).
- A high DSR is not evidence that a strategy will be profitable after costs. It only says the selection is unlikely to
  be luck alone, given the stated N and V.
