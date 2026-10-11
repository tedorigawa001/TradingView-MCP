# Probability of backtest overfitting (`compute_backtest_overfitting`)

BACKLOG 103-3. A pure computation: it reads no chart, journal or file, and writes nothing. It answers one question:
when the configuration that looks best on part of the history is chosen, how often does it fall to the bottom half on
the rest?

Method: combinatorially symmetric cross-validation (CSCV), Bailey, Borwein, López de Prado and Zhu (2017), "The
Probability of Backtest Overfitting", Journal of Computational Finance 20(4).

## Inputs

| Field | Meaning |
|---|---|
| `configurations` | 2 to 1,000 objects `{ id, returns }`, one per configuration tried, discarded ones included. Each `id` is 1 to 80 characters and unique. Every `returns` holds the same number T of per-period returns, aligned in time (row t is the same period for every configuration), each a finite number of magnitude at most 1e300 |
| `blocks` | S, the number of contiguous blocks the T periods are split into: an even integer from 2 to 16, default 16. Each block must hold at least 2 periods, so T ≥ 2·S |

- T × N is at most 500,000 numbers.
- Every numeric input must be a finite number of type number. Null, strings, booleans and the holes of a sparse array
  are refused, even on a direct call of the function.
- Through MCP, an unknown field (a misspelt `block`, say) is refused rather than ignored.
- **Choosing S.** At least 20 periods per block are recommended (`short_blocks` warns below that). For a short history,
  choose fewer blocks: with S = 16, T should be at least 320. More blocks give more splits, but shorter sets.

## Computation
1. **Blocks.** The T periods are split into S contiguous blocks. Their sizes differ by at most one: the first T mod S
   blocks hold one period more.
2. **Splits.** Every choice of S/2 blocks is a training set J, and the other S/2 blocks are its testing set J̄. There are
   C(S, S/2) such choices, in lexicographic order; each split appears twice, once in each orientation. With S = 16 that
   is 12,870.
3. **Performance.** On each set, each configuration's performance is its per-period Sharpe ratio: the mean divided by
   the standard deviation with n − 1, and no risk-free rate.
   - Statistics are combined from per-block counts, means and centred sums of squares (Chan, Golub and LeVeque), so
     every split costs O(N·S).
   - Each configuration is divided by its largest magnitude first, so proportional inputs give the same result,
     subnormal ones included.
   - **A set whose returns are all zero has a Sharpe ratio of 0**: no exposure, no performance. A configuration that
     trades in some blocks only is therefore evaluated (`zero_return_sets` notes it).
   - A set constant at a nonzero value has no Sharpe ratio (see Not evaluable). Constancy is decided on the raw
     minimum and maximum of the set, exactly, and a standard deviation below 1e-12 of the set's largest magnitude
     (in the normalised units) also counts as constant: such a set varies only at rounding level.
4. **Comparison.** Selection, ranks and the sign of a loss compare the Sharpe ratios rounded to 12 decimal places. A
   Sharpe ratio is unitless, so the grid is the same at every scale. Ties and zeros that rounding has split by a few
   ulps (a permutation of the same returns, a mean that is exactly 0 on paper) then compare as one. Two values that
   straddle a rounding boundary can still differ; that is rare.
5. **Selection.** n* is the configuration with the highest training Sharpe ratio. Ties go to the earliest in the input
   order.
6. **Out-of-sample rank.** ω̄ = rank of n*'s testing Sharpe ratio among all N testing Sharpe ratios / (N + 1), ranked in
   ascending order with average ranks for ties. Then the logit λ = ln(ω̄ / (1 − ω̄)). The classification below uses
   the integer 2·rank against N + 1, so a split exactly at the median is recognised without rounding.
7. **PBO** = (the number of splits below the median + half the number at the median) / C(S, S/2).
   - With no skill, the selection's testing rank is uniform, so PBO is about 0.5 for any N. Counting the median as
     overfit would put that baseline at (N + 1)/(2N) for odd N: 2/3 for N = 3.
   - `pbo_inclusive` is the share with λ ≤ 0, the paper's integral, which counts the median as overfit.
   - `splits_at_median` is the number of splits exactly at the median; the two values differ by half of it, as a
     share.

**Performance degradation** (reported) uses the selected configuration's training Sharpe ratio (x) and testing Sharpe
ratio (y) over all splits, unrounded:
- the OLS line y = a + b·x, with b, a and R². The slope is negative even with no skill: each split's training and
  testing sets are complements, so a configuration that is high on one tends to be lower on the other. A negative
  slope alone is not evidence of overfitting;
- the probability of an out-of-sample loss, P(y < 0), with y rounded as in step 4.

## Output
- `status`: `evaluated` or `not_evaluable`.
- `configurations` N, `observations` T, `blocks` S, `block_size` (min and max), `splits` C(S, S/2).
- `pbo`, `pbo_inclusive`, `splits_at_median`.
- `logit`: its mean and its quantiles: minimum, 5%, 25%, median, 75%, 95%, maximum. The 5–95% quantiles use linear
  interpolation between order statistics.
- `oos_relative_rank_mean`: the mean of ω̄.
- `selected`:
  - the mean and median of the training Sharpe ratio;
  - the mean and median of the testing Sharpe ratio;
  - `probability_oos_loss`.
- `degradation`: `slope`, `intercept`, `r_squared`.
  - All three are null, with `reason`, when the training Sharpe ratios of the selections do not vary.
  - `r_squared` alone is null, with `r_squared_reason`, when their testing Sharpe ratios do not vary.
- `selection_frequency`: up to 10 configurations by the number of splits that selected them, with id, count and share.
  Ties go to input order.
- `warnings` and `limitations`.

Every returned number is finite. A final check throws if one would not be.

### Not evaluable
The status is `not_evaluable` when a configuration is constant at a nonzero value on a training or testing set (or
varies only at rounding level there). Its Sharpe ratio is then undefined. The splits are checked in order, and the
first split with such a set is reported:
- `reason`, naming every such configuration and set;
- `constant_configurations`: `{ id, set }` for each, in input order, training sets first;
- `split`: its `index` and its `training_blocks` and `testing_blocks`, each `{ block, first_period, last_period }`
  (0-based periods, inclusive);
- `configurations`, `observations`, `blocks`, `splits` and `limitations`. No PBO is reported.

A constant nonzero return is rarely a real strategy's: it usually means a carry-forward or a fill value. Give the
actual returns, or zeros where the configuration had no position.

### Warnings

| Warning | Condition |
|---|---|
| `short_blocks` | A block holds fewer than 20 periods |
| `few_configurations` | N < 10. Ranks are coarse, and PBO moves in large steps |
| `few_splits` | S < 8. PBO is estimated from few splits |
| `dominant_selection` | One configuration is selected in more than half of the splits |
| `extreme_sharpe` | Some per-period Sharpe ratio on a set exceeds 10 in magnitude: implausible for real returns, and a sign of nearly constant values |
| `zero_return_sets` | Some configuration's returns are all zero on a set, where its Sharpe ratio is taken as 0 |

## Limitations, stated in every response
- The configurations must be every one tried, discarded ones included, over the same aligned periods. PBO describes
  the selection among the configurations given.
- Performance is the per-period Sharpe ratio, with no costs beyond those already in the returns. An all-zero set has a
  Sharpe ratio of 0, and Sharpe ratios are compared after rounding to 12 decimal places.
- PBO counts a split at the median as half, so its no-skill baseline is about 0.5; `pbo_inclusive` counts it as
  overfit. The degradation slope is negative even with no skill.
- Contiguous blocks keep serial dependence inside a block, but blocks next to each other share boundaries. Training and
  testing sets are interleaved in time, not ordered.
- PBO is not a p-value. A low PBO says the in-sample ranking tends to persist out of sample among these
  configurations; it does not say the best one is profitable.
- Few blocks or few configurations give a coarse estimate.
