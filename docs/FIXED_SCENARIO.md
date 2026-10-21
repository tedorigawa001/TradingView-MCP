# Fixed Scenario Comparison (105-2)

`evaluate_fixed_scenario` is a stateless comparison of caller-declared conditions and supplied native bars. It does not acquire evidence, read the automation prompt, persist anything, decide notification eligibility, or connect to charts, quotes, accounts, orders, alerts or journals. Dot remains paused. Existing monitoring/notification conditions are not replaced or modified.

## Frozen Definition

All fields are explicit, with `null` for unspecified information:

- `id`, `version`, `known_at` (canonical UTC ISO timestamp or null).
- Exact exchange-qualified `symbol`, `source`, `price_basis` (`unknown`, `bid`, `ask`, `mid`). Only `tradingview_native_ohlcv` evidence is supported. Unknown basis remains unknown, never inferred from quotes.
- `main_scenario`, `opposing_scenario`: original text or null. Text is retained, not parsed into rules. This version supports only explicit close-band rules; RSI, touches, wick order, lower highs and compound textual conditions must not be silently translated into this subset.
- `activation`, `invalidation`: each null or `{ band: { lower, upper }, direction: "above" | "below", any_of: [{ timeframe, consecutive_closes }] }`. Bounds must be positive and strictly ordered. Supported native timeframes are `15` and `60`, distinct within each rule, and each explicit confirmation count is 1-100. No defaults are supplied for bands, counts, direction, expiry or invalidation. Invalidation is a separate explicit condition, not inferred by reversing activation.
- `valid_until`: original expiry or null (unspecified). No retrospective deadline is invented. When present it caps the comparison window.

`conditions_sha256` hashes the complete parsed definition plus contract version `fixed-close-band-scenario-v1`, using the existing canonical key-sorted JSON helper. Key order does not change the hash; array order is retained. Version, scenario text, known time, bands, counts, price basis and validity changes all change it. The tool returns the original definition alongside its hash. A hash pins content, not proof that it existed at a past time.

`expected_conditions_sha256` is required but nullable. Null permits first calculation of a hash and reports `definition_pin_verified: false`. Supply the previously saved hash on subsequent comparisons; a mismatch refuses evaluation instead of refitting the rule. This tool neither loads nor updates a saved definition automatically.

## Previous Analysis And Evidence

`previous` is null or `{ analysis_id, as_of, conditions_sha256, activation_confirmed_at }`. Missing baseline or `known_at`, definitions only known after the previous cutoff, empty/reversed comparison windows and mismatched previous hashes are not evaluable. A null previous hash leaves comparison provenance unpinned. A previously confirmed activation is caller-supplied; accepting it requires the current definition hash, a timestamp no later than the previous cutoff and no earlier than `known_at`. This does not authenticate prior outcomes or delivery.

`evidence` contains `snapshot_id`, `as_of`, `symbol`, `source`, `price_basis`, `restoration_verified` and up to two distinct `series`. Each series declares `timeframe`, `observed_at`, and at most 100 `bars` with `bar_open_at`, `confirmed_at`, OHLC and optional volume/forming. These are caller-supplied native bars, not a resampling request. To use 105-1, explicitly project one target pane's 15/60 `recent_closed_bars` to `bars`, preserve each `observed_at`, and copy the source, basis, snapshot id, cutoff and restoration result. Do not include execution quotes or infer their price basis. No native indicator values are needed by this close-band-only comparator.

Canonical UTC times, strictly ordered/non-overlapping bars and valid finite positive OHLC are mandatory; confirmation must follow open and cannot follow that series' observation time. Symbol, feed and price basis must exactly match the definition; unverified restoration refuses evidence. These caller declarations are not cryptographic authentication of a live snapshot.

Only bars whose confirmation is **after** `previous.as_of` and **at or before** the effective cutoff count. A bar can open before the previous cutoff and be confirmed afterward. Previously confirmed bars never seed the new streak. Future confirmations and forming bars are excluded. `confirmed_at` names the native successor open, not exchange publication/first availability; `observed_at` is retained separately and is not a first-seen vintage. 105-3 will address persisted availability/revision evidence; this tool must not be used to claim it already does.

## Matching And Uncertainty

- `above` means close strictly greater than upper; `below` means close strictly less than lower. No epsilon, rounding, quote conversion or adjusted band is applied. Boundary equality and inside-band closes break qualifying streaks. Counts and latest position distinguish `below`, `lower_boundary`, `inside`, `upper_boundary`, `above`; latest run state distinguishes non-qualifying, single crossing, pending confirmations and a confirmed run.
- Consecutiveness requires adjacent supplied native intervals, a nominal 15/60-minute open-to-successor duration and both timestamps aligned to the UTC 15/60-minute grid. Off-grid native sessions are outside this version's supported coverage contract, not resampled. A missing bar, forming row, off-grid or non-nominal interval resets the streak. Session closures/holidays are not inferred; even a genuine session gap leaves coverage uncertain rather than being filled.
- Each timeframe branch is evaluated independently, then combined by OR. Two 15-minute closes are not made from one 15-minute and one hourly observation. One proven branch suffices even if the other is unavailable. A negative conclusion requires coverage for every branch.
- Coverage checks require a usable head reaching the previous cutoff, no intervening gaps/exclusions, and a tail reaching the last nominal UTC 15/60 boundary at the effective cutoff. Empty, truncated or stale windows are not evaluated as absence of an event. No session calendar or historical completeness claim is made. A later complete run after a gap can still prove that observed match, but cannot establish complete-window maintenance.
- `first_match` retains all supporting bars, with both open and confirmation timestamps. Latest matching run, latest price observation (including for non-matches), matching segment count, trailing closes, excluded input rows, coverage discontinuities, per-position counts and issues remain separate. A missing interval is not counted as an excluded supplied bar. Overlapping windows within one run are not counted as new matching segments. A past match that later returns inside is not silently turned into an invalidation.

Classification labels are `not_triggered` (条件未発火), `triggered` (条件発火), `continuation_pending` (条件に対する継続確認中), `invalidated` (明示した否定条件が成立), `not_evaluable` (評価不能). `continuation_pending` means a supplied previous activation exists and no explicit invalidation was established; consult rule status and `maintained_at_window_end` to distinguish maintenance from lack of a fresh confirmation. It never invents an invalidation or says the scenario remains valid unconditionally. A null invalidation stays `unspecified`, not `not_matched`.

Both activation and invalidation matching in the comparison window returns both proofs and `not_evaluable`: lifecycle precedence, reactivation, latest-state policy and notification transitions are not defined by this tool. Same-bar high/low order is never inferred. A match is not a new state transition or permission to send; repeated identical inputs are deterministic, with no delivery state, event ledger or deduplication service. Those are separately scoped in 105-4.

This is descriptive rule/evidence comparison, not trading wins/losses, predictive accuracy, calibrated signals, optimization, executable breakthroughs, or guaranteed fills. No integration into Dot, threshold changes or notification changes is included in 105-2.
