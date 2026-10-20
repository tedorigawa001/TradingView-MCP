# Cost-Adjusted Risk/Reward

`compute_cost_adjusted_risk_reward` implements `cost_adjusted_risk_reward_v1`: deterministic, caller-supplied **conditional scenario arithmetic**. `status: computed` means the arithmetic succeeded, not that a quote is fresh, a plan is approved, a trade is executable or an edge exists. `candidateEligible` is always false.

## Required Inputs

- A bounded `symbol`, explicit `direction` (`long` or `short`), and positive finite `entry_price`, `stop_price`, `target_price`, `bid`, and `ask`. Ask must be at least bid. Stop and target must strictly bracket entry in the declared direction.
- `price_basis`: `bid`, `ask`, `mid`, or `executable`, with the meanings below. It is never inferred from an exchange, symbol or chart type.
- `price_unit`: a caller-declared, nonblank label of at most 80 characters without C0/DEL controls, such as `JPY per MXN` or `USD per troy ounce`. This label is not verified against instrument metadata.
- Nonnegative finite `entry_slippage_price`, `stop_slippage_price`, `target_slippage_price`, and `round_trip_fee_price`. All four are required: use explicit zero when excluding a component, not omission.

All levels and costs share the same native price unit. Slippage is an adverse **price amount**, not pips, ticks or basis points. The fee is the **total entry-plus-one-exit fee**, already converted to the same per-instrument-unit price equivalent; it is not a fee per side, lot or account-currency amount. Do not embed those costs in the input levels and add them again.

Only positive prices and linear price-difference PnL are supported. The tool does not infer pip size, lot size, quantity, contract multiplier or currency conversion, and does not report money PnL or position size. Unknown registry symbols can still be calculated because all required price assumptions are explicit. Inputs and modeled prices must remain positive and all arithmetic must remain finite; overflow is refused rather than serialized as null.

## Price Basis and Spread

Let `s = ask - bid`. In `bid`, `ask`, or `mid` mode, **all three levels** share that same reference side. The supplied spread is assumed constant at all three hypothetical levels. Translate each reference level to its transaction side using:

| Input basis | Sell-side (bid) adjustment | Buy-side (ask) adjustment |
|---|---:|---:|
| `bid` | 0 | +s |
| `ask` | -s | 0 |
| `mid` | -s/2 | +s/2 |
| `executable` | 0 | 0 |

A long entry uses the ask side; both alternative long exits use the bid side. A short entry uses the bid side; both alternative short exits use the ask side. This follows the [bid/ask transaction convention](https://help.oanda.com/us/en/faqs/bid-ask-price.htm), **not any broker's stop/limit trigger rules**.

`executable` is different: the entry level already represents the entry-side quote, and each exit level already represents the opposite-side quote, before explicit slippage and fees. No extra spread is applied. The supplied bid/ask remains informational, marked `used_for_spread_adjustment: false`; changing it cannot change the scenario outcome in this mode.

The returned `fills` show each reference price, transaction side, quote side, signed spread adjustment, signed adverse slippage adjustment and modeled price. Buy slippage increases a price; sell slippage decreases it. These are scenario prices, not orders, actual executions or guaranteed limit-order fills.

## Formula

For direction sign `d = +1` for long or `-1` for short:

```text
gross_risk   = d * (entry - stop)
gross_reward = d * (target - entry)
spread_cost  = 0 if executable basis, otherwise ask - bid
stop_cost    = spread_cost + entry_slippage + stop_slippage   + round_trip_fee
target_cost  = spread_cost + entry_slippage + target_slippage + round_trip_fee
net_loss_at_stop     = gross_risk   + stop_cost
net_profit_at_target = gross_reward - target_cost
gross_reward_to_risk = gross_reward / gross_risk
net_reward_to_risk   = net_profit_at_target / net_loss_at_stop
```

Stop and target are **alternative outcomes**. Stop slippage is not charged to a target outcome or vice versa, and the total round-trip fee is charged once in each alternative calculation. Negative net target profit and negative ratios are retained, not clamped. `target_profitable_after_costs` is a mathematical sign check, not a recommendation or eligibility gate. Results use ordinary floating-point arithmetic without invented tick rounding.

For a hypothetical long with entry 100, stop 95, target 110, bid/ask 99.9/100.1 and mid basis, adverse slippage 0.1/0.2/0.05 and a round-trip fee of 0.04: modeled entry/stop/target are 100.2/94.7/109.85; gross RR is 2, net stop loss is 5.54, net target profit is 9.61 and net RR is approximately 1.73466. These are illustrative price-unit amounts, not current market quotes or cash returns.

## Evidence and Scope

Quotes are `caller_supplied`, with `observed_at: null` and `freshness_verified: false`. The tool does not fetch a quote, infer a quote timestamp or access the chart. A caller may obtain separate evidence from `get_execution_snapshot`, but copying a pair here does not preserve or revalidate its freshness. Even a verified current quote cannot establish future spread, liquidity or fills.

Financing, swap, taxes, impact and other costs are excluded unless included explicitly in the supplied fee/slippage amounts. Gaps and spread widening can produce losses beyond the stop scenario; there is no maximum-loss guarantee. The result is conditional reward/risk, not expected return, win probability, profit factor or a backtest.

No CDP, scanner, external feed, chart lock, private journal, account, order or alert access is needed, and no state is changed or persisted. Existing `compute_round_trip_cost`, `compute_position_size`, and `validate_trade_plan` are unchanged; their different unit/fee/plan conventions are not silently replaced or automatically joined to this calculation.
