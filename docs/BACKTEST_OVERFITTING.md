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
| `blocks` | S, the number of contiguous blocks the T periods are split into: an even integer from 2 to 16, default 16. Each block must hold at least 2 periods |

- T × N is at most 500,000 numbers.
- Every numeric input must be a finite number of type number. Null, strings and booleans are refused, even on a
  direct call of the function.

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
4. **Selection.** n* is the configuration with the highest training Sharpe ratio. Ties go to the earliest in the input
   order.
5. **Out-of-sample rank.** ω̄ = rank of n*'s testing Sharpe ratio among all N testing Sharpe ratios / (N + 1), ranked in
   ascending order with average ranks for ties. Then the logit λ = ln(ω̄ / (1 − ω̄)).
6. **PBO** = the share of splits with λ ≤ 0: the best training configuration is at or below the median out of sample.

**Performance degradation** (reported) uses the selected configuration's training Sharpe ratio (x) and testing Sharpe
ratio (y) over all splits:
- the OLS line y = a + b·x, with b, a and R²;
- the probability of an out-of-sample loss, P(y < 0).

## Output
- `status`: `evaluated` or `not_evaluable`.
- `configurations` N, `observations` T, `blocks` S, `block_size` (min and max), `splits` C(S, S/2).
- `pbo`.
- `logit`: its mean and its quantiles: minimum, 5%, 25%, median, 75%, 95%, maximum. The 5–95% quantiles use linear
  interpolation between order statistics.
- `oos_relative_rank_mean`: the mean of ω̄.
- `selected`:
  - the mean and median of the training Sharpe ratio;
  - the mean and median of the testing Sharpe ratio;
  - `probability_oos_loss`.
- `degradation`: `slope`, `intercept`, `r_squared`. They are null, with a reason, when the training Sharpe ratios of
  the selections do not vary.
- `selection_frequency`: up to 10 configurations by the number of splits that selected them, with id, count and share.
  Ties go to input order.
- `warnings` and `limitations`.

Every returned number is finite. A final check throws if one would not be.

### Not evaluable
The status is `not_evaluable`, with a reason that names the configuration and the set, when a configuration has a zero
standard deviation on a training or testing set. Its Sharpe ratio is then undefined. Configurations that never trade
should be left out, or given their actual returns.

### Warnings

| Warning | Condition |
|---|---|
| `short_blocks` | A block holds fewer than 20 periods |
| `few_configurations` | N < 10. Ranks are coarse, and PBO moves in large steps |
| `few_splits` | S < 8. PBO is estimated from few splits |
| `dominant_selection` | One configuration is selected in more than half of the splits |

## Limitations, stated in every response
- The configurations must be every one tried, discarded ones included, over the same aligned periods. PBO describes
  the selection among the configurations given.
- Performance is the per-period Sharpe ratio, with no costs beyond those already in the returns.
- Contiguous blocks keep serial dependence inside a block, but blocks next to each other share boundaries. Training and
  testing sets are interleaved in time, not ordered.
- PBO is not a p-value. A low PBO says the in-sample ranking tends to persist out of sample among these
  configurations; it does not say the best one is profitable.
- Few blocks or few configurations give a coarse estimate.
