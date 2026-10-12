# Reality Check and SPA (`compute_reality_check`)

BACKLOG 103-8. A pure computation: it reads no chart, journal or file, and writes nothing. It answers one question:
once the search over every configuration tried is accounted for, does the best one still beat the benchmark?

Methods:
- White (2000), "A Reality Check for Data Snooping", Econometrica 68(5).
- Hansen (2005), "A Test for Superior Predictive Ability", Journal of Business & Economic Statistics 23(4).
- The stationary bootstrap of Politis and Romano (1994), Journal of the American Statistical Association 89(428).

## Inputs

| Field | Meaning |
|---|---|
| `configurations` | 1 to 1,000 objects `{ id, returns }`, one per configuration tried, discarded ones included. Each `id` is 1 to 80 characters and unique. Every `returns` holds the same number n of per-period returns (10 to 100,000), aligned in time, each a finite number of magnitude at most 1e300 |
| `benchmark` | Optional: the benchmark's n per-period returns, aligned with the configurations. Default: zero, so the test asks whether the best configuration's mean return is positive |
| `mean_block` | The stationary bootstrap's mean block length in periods, from 1 (an i.i.d. bootstrap) to n/2; fractional values are allowed. Default: round(n^(1/3)), the rate of the optimal block length |
| `draws` | Bootstrap draws B, an integer from 100 to 10,000. Default: 2,000 |
| `seed` | The seed of the generator, an integer from 0 to 4,294,967,295. Default: 20,261,011 |

- n × N is at most 500,000 numbers. The sizes are checked before any value is read.
- The bootstrap's work, draws × (n / mean_block) × (20 + N), is at most 2e9. At the cap the time is about 1 to 3.6
  seconds. Drawing a run (two draws and a logarithm) costs up to about twenty times summing one configuration over it.
- Every numeric input must be a finite number of type number. Null, strings, booleans and the holes of a sparse array
  are refused, even on a direct call of the function. Through MCP, an unknown field is refused rather than ignored.
- **Choosing the mean block.** It should cover the serial dependence of the differences: longer for returns of
  overlapping holding periods or for volatility clustering. The p-values depend on it; report it with them.

## Computation

1. **Differences.** d_{k,t} = r_{k,t} − b_t, configuration k's return minus the benchmark's, or r_{k,t} with no
   benchmark. Performance is the mean difference d̄_k. It is not risk-adjusted: White's and Hansen's tests compare
   expected performance.
2. **Identical and constant configurations.**
   - **Rounding share.** Returns computed from prices carry rounding of about 1e-16 of the price ratio, not of the
     return. That is about 1e-11 of returns of 1e-5: two formulas for the same simple return differ by that much. The
     tool therefore treats a difference of at most 1e-9 of a configuration's largest return as rounding.
   - **Identical.** A configuration whose differences are all at most 1e-9 of the largest magnitude of its returns is
     identical to the benchmark. Its returns then have the benchmark's magnitude. It contributes 0: its d̄ is 0, and
     its bootstrap mean is 0. A configuration of all-zero returns against no benchmark is identical too.
   - **Constant.** Differences whose range is at most 1e-9 of the larger of the returns' largest magnitude and the
     differences' own are constant. Their standard error is 0 (see Not evaluable).
     - The larger of the two, because a difference's rounding is proportional to the returns it came from. A
       benchmark plus 1e-6 varies by the benchmark's rounding, which is about 1e-12 of 1e-6 when the benchmark is near
       0.01. Judged against the difference alone, such a configuration had a t of about 1e13.
   - **Nearly constant.** A range of at most 1e-6 on the same scale is real but negligible. A t built on it reflects
     rounding or fee granularity more than a strategy. Such configurations are evaluated, listed in
     `nearly_constant_configurations`, and warned about.
3. **Standard errors.** ω̂²_k is the variance of √n times the stationary-bootstrap mean of the differences, exactly
   (Politis and Romano 1994, Lemma 1), as Hansen uses it:

     ω̂² = γ̂₀ + 2 Σ_{i=1}^{n−1} κ(n, i) γ̂_i,  κ(n, i) = (1 − i/n) ρ^i + (i/n) ρ^{n−i},  ρ = 1 − 1/mean_block

   with the autocovariances γ̂_i = n⁻¹ Σ_{j=1}^{n−i} (d_j − d̄)(d_{j+i} − d̄).
   - It equals γ̂₀ + 2 Σ (1 − h/n) ρ^h C_h with circular autocovariances C_h. The tool computes that sum in O(n), by
     backward recursions for Σ_i ρ^i c_{t+i} and Σ_i i ρ^i c_{t+i}.
   - It does not depend on the draws, so the observed statistics do not depend on the seed.
   - With a mean block of 1 it is the population variance, γ̂₀.
   - Each configuration is divided by the largest magnitude of its differences first, so proportional inputs give the
     same statistics and p-values at any finite scale.
   - The mean is computed in two passes: the second removes the first's rounding residue. The centred values then
     sum to 0 to rounding, and the bootstrap means carry no drift.
   - The t of configuration k is t_k = √n d̄_k / ω̂_k.
4. **Statistics.**
   - Reality Check: V = max_k √n d̄_k, over every configuration (an identical one counts with d̄ = 0). Its best is the
     configuration with the highest mean difference.
   - SPA: T = max(max_k t_k, 0), over the configurations that differ from the benchmark. The maximum with 0 is part of
     Hansen's definition, and also covers identical configurations, which have no t. Its best, reported as `best`, is
     the configuration with the highest t.
   - Mean differences are compared in units of the largest scale among the configurations, never in the input's
     unit, where subnormal means round to 0 (two losses and gains of 5e-324 would tie, and the input order would choose
     the best). A mean below 1e-12 of its own configuration's largest difference is rounding level and counts as 0, in
     the comparison and in `positive_mean_configurations`; its t is at most about √n · 3e-12.
   - The best configurations are chosen on rounded values: t to 12 decimal places, mean differences to 12 significant
     digits. Ties that rounding has split by a few ulps therefore go to the earliest configuration. Examples are a
     series and its reverse with a mean block of 1. Two values that straddle a rounding boundary can still differ;
     that is rare.
5. **Bootstrap.** One `createRandom(seed)` stream (mulberry32) across the draws. Every configuration uses the same
   resampled time indices, so their dependence is kept.
   - Each run starts at floor(u·n) and continues at (previous + 1) mod n, circularly.
   - Its length is geometric with mean `mean_block`: 1 + floor(ln(1 − u′) / ln(1 − 1/mean_block)). This is the same as
     starting a new run at each period with probability 1/mean_block. With a mean block of 1, every run has length 1
     and u′ is not drawn.
   - The last run is cut at n periods.
   - Each run's sum is read from the prefix sums of the centred differences. One draw b gives z_{k,b} = √n (d̄*_{k,b} −
     d̄_k) for every configuration.
   - The bootstrap works in normalised units. The studentized z_{k,b}/ω̂_k is formed within each configuration's own
     units, so a tiny scale cannot round ω̂ to 0. (In the input's unit, a loss of 5e-324 has ω̂ = 0, and 0/0 made a
     statistic NaN.) The Reality Check's z_{k,b} and V are taken in units of the largest scale among the
     configurations, which keeps them comparable.
6. **Null distributions.**
   - Reality Check: V*_b = max_k z_{k,b}, not studentized and not recentred.
   - SPA: T*_b = max(0, max_k (z_{k,b} / ω̂_k + s_k)), with Hansen's recentring s_k:
     - upper: s_k = 0, every configuration at the boundary of the null. This is the studentized Reality Check, and
       the most conservative.
     - consistent: s_k = t_k when t_k < −√(2 ln ln n), else 0. Configurations clearly worse than the benchmark are
       moved below it, so they no longer inflate the p-value. Recommended.
     - lower: s_k = min(t_k, 0). The most liberal.
7. **P-values** = (1 + the number of draws with a null statistic ≥ the observed one) / (1 + B). This form is never 0 and
   is valid at a finite B. With an observed SPA statistic of 0, every draw reaches it and p = 1.
   - **Ties.** A null statistic counts as reaching the observed one when it is within 1e-9 of it. The share is taken
     of the larger of 1 and |T| for SPA and the nominal p-value, and of the larger of |V| and the widest bootstrap
     spread max_k ω̂_k for the Reality Check (in the units above).
     - Discrete returns make null statistics equal to the observed one on paper. One profit among 20 periods with a
       mean block of 1 is an example: a draw reaches the statistic exactly when it picks that period twice.
     - Rounding must not decide whether such a draw counts. Without the tolerance, scaling that profit from 1 to
       0.001 moved the SPA p-value from 0.095 to 0.161, against 0.269 counted with integers.
     - The share is far above the rounding of a bootstrap statistic (about 1e-14 in units of t) and far below any
       spacing that matters.
   - The best configuration's **nominal p-value** applies the same rule to its own studentized z alone. That is the
     Reality Check's p-value had it been the only configuration tried; with one configuration and t > 0, all five
     p-values coincide. It has no floor at t ≤ 0, where a lone SPA p-value would be 1. The gap between it and the
     consistent p-value is the price of the search.

## Output
- `status`: `evaluated` or `not_evaluable`.
- `configurations` N, `observations` n, `benchmark` (`zero` or `given`).
- `bootstrap`: `method` (`stationary`), `draws`, `mean_block`, `mean_block_source` (`default` or `given`), `seed`.
- `reality_check`: `statistic` V, `p_value`, `monte_carlo_error` √(p(1 − p)/B), and `best`: the configuration with
  the highest mean difference, with its `id` and `mean_difference`.
- `spa`:
  - `statistic` T;
  - `p_values` `lower`, `consistent` and `upper`;
  - `monte_carlo_error` of the consistent p-value;
  - `threshold` √(2 ln ln n);
  - `recentred_configurations`: the number moved by the consistent recentring.
- `best`: the configuration with the highest t among those that differ, with `id`, `mean_difference`,
  `standard_error` ω̂/√n, `t` and `nominal_p_value`.
- `positive_mean_configurations` and `identical_to_benchmark`: counts. A mean below 1e-12 of its configuration's largest
  difference is not positive (step 4).
- `nearly_constant_configurations`: the ids of configurations whose differences vary by at most 1e-6 (see step 2).
- `top_by_t`: up to 10 configurations that differ, by t, with id, mean difference and t. Ties go to input order.
- `warnings` and `limitations`.

Every returned number is finite. A final check throws if one would not be.

### Not evaluable
The status is `not_evaluable`, with `configurations`, `observations`, `benchmark` and `limitations`, and no test, when:
- some configurations differ from the benchmark by a constant (at rounding level). The reason names every one, and
  `constant_configurations` lists them. Their standard error is 0, so the studentized statistic is undefined. A
  constant difference is rarely real: check that the returns are aligned and not a fill value;
- every configuration is identical to the benchmark, so there is nothing to test.

A configuration that varies has a positive bootstrap variance, at least γ̂₀(1 − ρ)/(1 + ρ). A computed ω̂ of 0 for one
would throw, as a guard.

### Warnings

| Warning | Condition |
|---|---|
| `short_sample` | n < 100: the bootstrap's approximation is coarse |
| `few_draws` | B < 1,000: the p-values carry a large Monte Carlo error |
| `long_mean_block` | The mean block exceeds n/10: few independent blocks |
| `identical_to_benchmark` | Some configuration is identical to the benchmark, to rounding |
| `nearly_constant_difference` | Some configuration's differences vary by at most 1e-6 of its returns' magnitude: its t reflects rounding or fee granularity more than a strategy |

## Limitations, stated in every response
- The configurations must be every one tried, discarded ones included, over the same aligned periods. The tests
  describe the best among the configurations given.
- Performance is the mean per-period excess return: not risk-adjusted, with no costs beyond those already in the
  returns.
- The stationary bootstrap assumes stationary, weakly dependent differences. The mean block should cover their serial
  dependence, and the p-values depend on it.
- The tests ask only whether the best configuration beats the benchmark. They say neither which others do (a stepwise
  procedure would) nor how large the edge is after costs.
- Differences from the benchmark, or variation in them, of at most 1e-9 of a configuration's largest return are
  treated as rounding.
- The Reality Check is conservative when many configurations are poor; the consistent SPA p-value is recommended.
  P-values carry Monte Carlo error.
