# Security Review (2026-07-07)

Scope: initial implementation (`src/cdp.ts`, `src/tradingview.ts`, `src/server.ts`, and `src/index.ts`).

Method: manual code review, `npm audit`, and unit-test verification. Run the repository security-review workflow on every pull request.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Local attack surface from the CDP debug port | Medium | Documented and accepted |
| 2 | Code injection through `Runtime.evaluate` | High -> none | Mitigated and tested |
| 3 | Substring-based CDP target selection | Low | Fixed |
| 4 | Known dependency vulnerabilities | - | `npm audit`: zero |
| 5 | Page-controlled data entering the AI context | Low | Documented |
| 6 | Screenshot information disclosure | Informational | Documented |

## Details

### 1. CDP Debug Port 9222 - Medium, Accepted

While TradingView runs with `--remote-debugging-port=9222`, **any process on the same machine** can fully control the signed-in TradingView session.

Mitigations:

- Chrome/Electron binds the port to localhost by default.
- Chromium rejects browser-origin WebSocket connections carrying an `Origin` header, preventing the ordinary web-page DNS-rebinding path.
- An attacker otherwise needs existing local code execution, which is outside this threat model.

Operational rules:

- Enable the debug port **only while using the MCP server**; launch normally at other times.
- Do not use this configuration on a shared machine.

### 2. `Runtime.evaluate` Injection - Mitigated

User or AI input embedded into in-page JavaScript expressions could be an injection point. Controls are layered:

- Strings such as `symbol` are converted to literals with `JSON.stringify`.
- `resolution` is also allowlisted with `/^[0-9]*[SDWM]?$/i`.
- Numeric values such as `count` and `chartIndex` enter expressions only after finite/integer validation.
- Zod validates type and range at the MCP boundary and rejects invalid input with `-32602` before the handler.
- **No MCP tool exposes arbitrary JavaScript execution**; evaluation remains an internal API.

`test/unit/tradingview.test.mjs` verifies escaping of malicious symbols and pre-page rejection of invalid resolution, count, and chart index.

### 3. CDP Target Selection - Fixed

The former `t.url.includes("tradingview.com/chart")` check could match a URL such as `https://evil.example/tradingview.com/chart`. `findChartTarget` now parses the URL and requires HTTPS, `tradingview.com` or a subdomain, and a path beginning with `/chart`.

### 4. Dependencies - Clean

- Runtime dependencies are limited to `@modelcontextprotocol/sdk`, `ws`, and `zod`.
- `npm audit --audit-level=high`: **zero vulnerabilities** as of 2026-07-20 on Node 24.18.0.
- `package-lock.json` is committed, and CI runs the audit.

### 5. Page Data Entering AI Context - Low

Page strings such as symbol, indicator, and layout names enter tool results. Malicious text could theoretically carry an indirect prompt injection, but the source is the user's own TradingView session. Reassess this risk before adding public ideas, comments, or other third-party content.

### 6. Screenshot Disclosure - Informational

`get_chart_screenshot` sends the visible TradingView UI, including watchlists, account-related UI, and the full layout, to the AI provider. The README states that everything visible is transmitted.

## Addendum: Phase 3 (2026-07-07)

Review of `get_indicator_values` and `get_indicator_inputs`:

- In-page filtering removes `text`, `pineId`, `pineVersion`, and `pineFeatures`; strings over 200 characters are truncated. Integration tests verify no Pine-source leakage.
- `study_id` is validated by `/^[\w$]{1,64}$/` at both Zod and TradingView layers and embedded with `JSON.stringify`.
- Only read-only tools were added.

## Addendum: Phase 4 (2026-07-07)

- `scanner.tradingview.com` uses a fixed HTTPS base URL. Market, field, ticker, and operator inputs are allowlisted; responses are Zod-validated and requests use `AbortController` timeouts.
- Watchlist retrieval performs a read-only same-origin GET with `credentials: "include"` and no external expression input.
- Public scanner descriptions enter AI context, retaining the Low indirect-injection assessment.
- Watchlist writes remained unavailable. Alert creation was later added only through #26's constrained confirmation path.

## Addendum: Phase 5 (2026-07-08)

- `list_alerts` performs read-only GETs to `pricealerts.tradingview.com`; messages are truncated to 300 characters.
- `get_indicator_graphics` is read-only, validates `study_id`, and constrains `limit_per_kind` to 1-500.
- `load_more_history` changes only loaded history, not viewport/layout; count is 1-5,000 and polling terminates within 15 seconds.

## Addendum: Backlog #5/#6 (2026-07-08)

- `get_key_levels` composes existing read-only data. `range_percent` is `(0, 50]`, `limit` is 1-200, and non-price studies are excluded so oscillator values cannot be presented as prices.
- `get_economic_events` performs an unauthenticated GET to a fixed HTTPS host. Country, ISO dates, a 92-day range, and limit 1-200 are validated before query construction. Zod and field guards discard unknown long fields. Public event text retains the Low indirect-injection assessment.

## Addendum: Backlog #9 (2026-07-08)

`get_indicator_tables` is read-only. It validates `study_id` and nonnegative `chart_index`, truncates cell text/tooltips to 200 characters, and caps tables at 2,000 cells.

## Addendum: Backlog #10 (2026-07-08)

`list_pine_scripts` and `get_pine_source` are limited to user-owned scripts:

- `pineId` must match `/^USER;[\w]{8,64}$/`; `PUB;` scripts are rejected before network access, and listings use only `filter=saved`.
- Only GET requests reach pine-facade; save, delete, and publish endpoints are absent.
- IDs are allowlisted, JSON-embedded, and URL-encoded in page context.
- Full user-owned source is intellectual property sent into the AI context; onward handling follows the MCP client's policy.

## Addendum: Backlog #8 (2026-07-08)

`run_backtest` temporarily adds a strategy, retrieves its report, and removes it. Removal runs by default even after report failure; failures are surfaced as warnings, and `keep_on_chart:true` is explicit opt-in. Only `USER;` strategies are accepted and `isTVScriptStrategy` is checked before addition. Because stale watched values may remain, reports require an active strategy and matching ownership. Replay buy/sell APIs remain unexposed; Pine backtests do not access real accounts or orders. Integration tests verify the post-run study set.

## Addendum: Backlog #11 (2026-07-08) - First Write Tools

`save_pine_script` and `add_pine_to_chart` introduced writes only for user-owned Pine with confirmation:

- Without `confirm:true`, tools return a dry-run and write nothing.
- New scripts use `saveNew` without overwrite; duplicate names are rejected.
- Existing scripts receive only a new `saveNext` version, and every previous version remains retrievable.
- Compile failures include `compileOk`, line-specific `compileErrors`, and `revertHint`; source is read back and verified.
- The `USER;` gate exists at Zod and TradingView layers.
- `add_pine_to_chart` only adds. The later #16 tool handles confirmed removal of one verified owned study.
- Orders, existing-alert modification, webhooks, watchlist writes, Pine-library deletion, and Replay buy/sell remain unavailable.

## Addendum: Backlog #12 (2026-07-09)

`set_indicator_input` changes only inputs on an existing study. It does not save Pine source, but the live chart input may persist through TradingView layout autosave. Hidden Pine inputs (`text`, `pineId`, `pineVersion`, `pineFeatures`, and `__profile`) are rejected. Study and input IDs are dual-layer allowlisted, values are primitive only, and unknown IDs are rejected before `setInputValues`. The tool neither deletes nor replaces studies.

## Addendum: Backlog #15 (2026-07-15)

Review of `get_analysis_overlay_template` and `apply_analysis_overlay`:

- Pine source is a fixed template; analysis text and external data are passed only as typed inputs, preventing Pine-code injection.
- Chart index, exact symbol/timeframe, study name, and the fixed input contract are verified before writes.
- Without `confirm:true`, only contract validation and preview occur.
- Future analysis times, inverted Entry bands, directionally inconsistent levels, and nonpositive values are rejected. Expired analyses render as `EXPIRED` rather than being deleted or presented as current.
- Inputs are read back after writing. If recalculation does not settle within 20 seconds, the result is unverified and stale drawing checks are skipped with a warning.
- `input.time` uses Unix epoch milliseconds; USDJPY 4H readback and drawing position were verified on the real app.
- The tool does not delete Pine-library scripts or access orders or alerts. Layout autosave may preserve inputs.

## Addendum: Backlog #16 (2026-07-15)

`ensure_analysis_overlay` and `remove_owned_study` enforce ownership and transaction ordering:

- Only `USER;` Pine is removable. Public and TradingView layers both verify chart/study association and hidden `pineId` before `removeEntity`.
- Delete, add, update, and migration require confirmation; one current instance is reused without writing.
- The latest library source must exactly match the normalized fixed template.
- Logical overlay version and TradingView Pine-library version remain separate.
- Migration adds and verifies the new 18-input instance before deleting the legacy 14-input instance. Failure removes the new study and preserves the old one.
- If current and outdated instances coexist, only the outdated one is removed and preview warns that its inputs are not migrated.
- Multiple current instances, multiple legacy instances, or three or more total instances are rejected as ambiguous.

## Addendum: Backlog #17 (2026-07-15)

`get_analysis_overlay_status` is read-only. It verifies owned Pine ID, exact script identity/type, single placement, deployed version/source, and all 18 inputs. Missing, ambiguous, default/unconfigured, source-mismatched, or corrupt states are not trusted. Context mismatch stops price interpretation. Current close geometry never claims historical touch order, fills, or P&L. Drawing-count checks detect missing primitives but do not prove coordinates or visibility.

## Addendum: Backlog #18 (2026-07-15)

`evaluate_analysis_overlay_outcome` reuses #17's trust boundary. It excludes the analysis-time and forming bars, and only includes bars closing before expiry. It does not infer intrabar order or a fill across an opening gap. Invalidation before Confirmation cancels the setup; after activation, Target 1 versus Stop is a binary first-hit evaluation. Daily/weekly aliases are supported, while calendar-month `M` is not approximated. Insufficient history returns `incomplete`, not no-entry. Results are closed-OHLC evidence, not orders, fills, slippage, or realized P&L.

## Addendum: Backlog #19 (2026-07-16)

An optional `evaluation_timeframe` temporarily changes only the verified target chart and always attempts restoration. Symbol, chart index, and timeframe are checked before, after, and after restoration. Stale bars or zero-bar evidence fail closed. A restoration failure preserves the evaluation result but returns `chartState.restored:false`, current timeframe, and the restore error. In-process operations are serialized; manual UI actions and other processes remain residual races detected through readback.

## Addendum: Backlog #20 (2026-07-16)

The analysis journal is local-only and defaults to `~/.tradingview-mcp/analysis-journal.jsonl`:

- Directories/files require 0700/0600, current-user ownership, regular files, size limits, `O_NOFOLLOW`, full writes, fsync, and an owner-token cross-process lock.
- Corrupt JSONL, missing sequence numbers, and symlinks fail closed. A stale lock is reclaimed only after PID, descriptor, inode, and mtime checks.
- Business `analysisId` is separate from event UUIDs. Definitions are SHA-256 bound to symbol, timeframe, time, levels, confidence, note, and optional snapshot/strategy version.
- Confirmed overlay input readback is required before automatic recording. Outcome recording remains opt-in with `record:true`.
- Journal failure after chart success does not roll back the chart; it returns `journal.recorded:false` with a redacted error.
- Completed outcomes cannot regress to `ongoing`, identical evidence is idempotent, and conflicting completed labels are rejected.
- Calibration uses only Target-before-Stop as 1 and Stop-before-Target as 0; all ambiguous and nonterminal cases are exclusions.
- The JSONL is not encrypted and does not protect confidentiality after OS-account compromise. It has no automatic rotation and stops at 64 MiB.

## Addendum: Backlog #22 (2026-07-20)

`validate_trade_plan` is a pure Node calculation with no CDP, TradingView, network, journal, alert, or order side effect. It blocks directional inconsistency, expiry, future/stale evidence, already-terminal geometry, event blackout, and inadequate net reward/risk with structured reasons. It never infers historical touches or execution. Round-trip cost is explicitly in instrument price units.

## Addendum: Backlog #23 (2026-07-20)

`get_trade_decision_context` combines read-only chart, OHLC, levels, scanner, calendar, COT, and real-yield evidence. Exact chart binding is checked before and after acquisition. Each source retains required/status/time/freshness metadata; failures are never replaced with zero or another source. `decision_status` is a completeness/event/execution gate and `directional_recommendation` is always null. Chart quotes require fresh `lp_time`, streaming, active session, real-time load, and valid bid/ask. Scanner fallback proves only local liveness after an observed quote change; receipt time is not a market timestamp. `trade_ready` does not guarantee fills, liquidity, or exchange sequencing.

## Addendum: Backlog #25 (2026-07-20)

`compute_position_size` is a pure calculation. It includes Stop distance and round-trip cost, floors to `quantity_step`, and reduces another step if floating-point error exceeds the risk budget. Unsupported precision is rejected. Cross-currency sizing requires a positive, fresh, timestamped conversion with its symbol. Results are instrument units, not lots; broker limits and multipliers are caller-supplied. The estimate does not cover gaps, slippage, margin calls, tax, swap, liquidity, or fillability.

## Addendum: Backlog #26 (2026-07-20)

`create_analysis_alerts` is a constrained confirmed write:

- Without confirmation it only previews. After confirmation it requires the exact owned template, one placement, 18 valid inputs, matching analysis ID/context, and future expiry.
- Ownership names are fixed as `BUSHIDO-MCP:<first-16-SHA256-of-analysisId>:<kind>`. Exact alerts are reused; mismatched, stopped, or duplicate alerts are not modified, restarted, or deleted.
- Requests use a fixed HTTPS origin and validate symbol, resolution, operator, positive level, future expiry, owner name, and bounded message before POST and readback.
- Only mobile push and popup are enabled by default; email, SMS, and webhook remain disabled. No order or broker API is used.
- Current close geometry can suppress or reject alerts but never proves pre-creation touches.
- Creation stops after the first unverified error and re-lists all targets. Timeout does not trigger automatic deletion or immediate retry. Journal failure never rolls back valid TradingView alerts.

## Addendum: Backlog #27 (2026-07-20)

`evaluate_due_analyses` is a dry-run without confirmation. Confirmed execution uses one chart index, a verified journal definition, bounded scanning, and serialized symbol/timeframe/history/evaluation operations. Every item restores and verifies the original chart; ordinary item failures continue, but restoration failure stops the batch. Optional history loading is disclosed as persistent because loaded bars cannot be unloaded. Records remain definition-hash bound and idempotent.

## Addendum: Backlog #28 (2026-07-20)

`get_analysis_performance` reads only the validated live-analysis journal. It stores derived path metrics rather than raw OHLC and excludes activation/terminal-bar highs and lows whose intrabar order is unknowable. Entry midpoint and gross/net R are analytical geometry, not fill price or account return. Missing costs are excluded rather than treated as zero. Each metric reports its own population and exclusions, accepts only methodology version `1.0`, rejects duplicate symbol costs, and discloses the 500-definition scan limit.

## Addendum: Backlog #29 (2026-07-20)

`set_symbol` and `set_timeframe` accept an explicit nonnegative existing chart index, snapshot the original context, read back every stage, and roll back partial application. A rollback error is reported alongside the original operation error. Shared temporary-chart operations reuse the same transaction. In-process serialization cannot exclude manual UI or another MCP process; readback detects mismatches, while a race after final readback remains residual risk.

## Addendum: Backlog #8 Bar Replay (2026-07-20)

The public surface is limited to `get_replay_status`, `start_chart_replay`, `step_chart_replay`, and `stop_chart_replay`. Replay buy/sell/close, positions/P&L, autoplay, random/first date, and resolution changes remain private. Start and stop default to dry-run, require confirmation and exact symbol/timeframe binding, and verify state within a deadline. A start accepts only a canonical historical ISO timestamp, and partial startup attempts cleanup. Steps are limited to 1-100 while paused and must advance Replay time. `get_trade_decision_context` blocks while Replay is active so historical chart evidence cannot be mixed with real-time alerts, orders, or quotes. Internal API changes fail explicitly; there is no UI-click fallback. In-process chart serialization cannot prevent concurrent manual UI changes or a second MCP process, so final readback is a detection boundary rather than a global lock.

## Addendum: Backlog #31 (2026-07-20)

`get_strategy_trade_ledger` is read-only and rejects residual reports without an active strategy. A canonical SHA-256 `ledgerId` binds strategy, symbol/timeframe, Pine ID/version, public inputs, period, currency, capital, and all normalized trades; pagination stops if the expected ID changes. Internal Pine fields and unsupported values are excluded. Pages are capped at 500 trades and offset at 10,000,000. Missing Strategy Tester fields are not imputed. A trailing live row is classified as open only under strict summary and exit-ID conditions. Results remain simulated and do not prove fills, intrabar order, liquidity, or account P&L. Private API changes produce explicit quality errors rather than guessed field mappings.

## Addendum: Backlog #32 (2026-07-20)

`run_strategy_experiment` defaults to dry-run and compares exactly two variants only after confirmation and exact chart/Pine binding. Overrides are at most 20 primitive known inputs. Full ledgers are paginated and hash-bound; methodology and experiment definitions also receive SHA-256 IDs. No aggregate score or automatic adoption is returned, and differing costs, capital, fill settings, or periods make variants non-comparable. Each temporary owned study is removed after success or failure. Baseline or cleanup failure prevents the candidate; candidate failure preserves baseline evidence. Real-app testing verified input readback, distinct ledgers, cleanup, and restoration.

## Addendum: Backlog #33 (2026-07-20)

`run_backtest_matrix` permits 1-24 explicit jobs after confirmation, at most 20 primitive inputs each, bounded strings, and a 30-1,800 second soft deadline. Jobs run serially and bind exact Pine version, symbol/timeframe, definition hash, and full ledger ID. Normal failures are isolated; cleanup or restoration failure stops remaining jobs. The deadline prevents starting a new job but never force-cancels an in-flight operation that still needs cleanup. Results stay in input order with no ranking or automatic adoption.

## Addendum: Backlog #34 (2026-07-20)

`run_strategy_walk_forward` partitions complete ledgers without private Deep Backtesting writes or Pine modification. Only trades whose Entry and Exit are both within `[from,to)` are included; crossing, open, and untimestamped trades are counted separately. Inputs are bounded to 2-8 candidates, 2-12 folds, and explicit embargo. Selection uses train only, hides unselected candidates' test metrics, rejects ties, and requires every candidate to pass collection, ownership, quality, coverage, cleanup, and comparable-condition checks. Drawdown is explicitly closed-trade-equity drawdown, not TradingView's bar-level maximum DD. Ledger partitioning does not neutralize repainting and may retain pre-fold warm-up state; it is identified as `ledger_partition_v1`.

## Addendum: Backlog #35 (2026-07-21)

`validate_research_protocol` is read-only and binds an exact user-owned Pine version, canonical windows, candidate set, and lifecycle. Overlapping/future/OOS-modified protocols are blocked. Static Pine risks and unverified restart behavior remain warnings, and adoption requires no warnings. `stress_test_strategy` defaults to dry-run, serially reruns at most eight explicit scenarios after confirmation, and includes only ledgers with verified ownership, cleanup, and chart restoration. Regime matrices are bounded, serial, and do not rank or pool currencies. Session classification is explicit, DST-aware, and nonexclusive by default. Cost models do not guess pip/account conversion, and seeded trade-order bootstrap is not presented as a market-path Monte Carlo. No raw ledgers, arbitrary grids, automatic adoption, or orders are returned.

## Addendum: Backlog #36 Session Auction v1 (2026-07-21)

`run_market_event_study` is read-only, exact-chart-bound, Replay-blocked, and limited to 5,000 loaded closed bars. IANA timezone conversion handles DST for same-day ordered windows; overnight sessions, holiday calendars, and early closes are outside v1. The first post-range boundary touch is classified without inferring intrabar order, and ambiguous sweeps remain ambiguous. Horizons, folds, events, targets, and response detail are bounded; raw OHLC is never returned. Confidence intervals are descriptive asymptotic/Wilson intervals, not causal or profitability claims. Trial count is caller-declared and multiple-comparison limitations are explicit. Optional regimes use only labels closed before the signal. Session-auction horizons require timestamp continuity and do not forward-fill weekends.

## Addendum: Backlog #37 Market Regime v1 (2026-07-21)

`compute_market_regimes` is read-only, exact-chart-bound, Replay-blocked, and uses only evidence available by each bar. It never uses full-period quantiles, revised thresholds, or forward fill. Lookbacks and output are bounded and raw OHLC is omitted. Labels describe past price paths rather than predictions or trade permission. Strategy regime analysis temporarily runs exact owned Pine after confirmation, obtains a complete ledger, removes it, restores the chart, and joins Entry only to labels already closed. Session assignment is explicit and DST-aware; nonexclusive matching is the default. Strategy Tester values are not reconstructed from OHLC and do not prove real execution.

## Addendum: Backlog #41 Yield-Price Nonconfirmation (2026-07-21)

The study requires distinct target and driver charts and verifies both chart context and returned OHLC. A driver bar is unavailable until its nominal close, and no target bar beginning earlier is joined. Exact timestamp matching and forward fill are absent; calendar months and Replay are rejected. Output is bounded aggregate/fold/event evidence without raw OHLC. Signal close is a reference, not a fill. Nominal close, caller-supplied direct/inverse relation, thresholds, and multiple-trial handling remain residual methodological risks. Horizons count observed target bars and may include weekend reopening moves; quality flags distinguish this from contiguous-clock studies.

## Addendum: Backlog #38 Feature-Outcome Relationships (2026-07-21)

Features use only signal-bar and prior ATR/range/close evidence; future bars appear only in outcomes. Full-period quantiles, optimization, and forward fill are prohibited. Output is bounded and does not imply causality, prediction, fills, costs, or PF. Horizons count observed market bars and explicitly include calendar gaps. Fold timestamps are canonical UTC ISO only at both MCP and internal validation layers.

## Addendum: Backlog #40 Session Profile (2026-07-21)

`compute_session_profile` is read-only, exact-symbol-bound, Replay-blocked, and accepts numeric minute timeframes only. One to eight IANA sessions are assigned deterministically with DST and overnight ownership by session start. No holiday calendar is inferred; missing weekday sessions reduce coverage. Inputs and output are bounded, forming bars are excluded, and gaps are not filled. TradingView volume is labelled `unverified_tick_or_exchange_volume` and is not presented as centralized FX or institutional flow.

## Addendum: Backlog #39 Futures Flow Context (2026-07-21)

`get_futures_flow_context` uses fixed spot-to-continuous-futures mappings, explicit chart index, exact symbol, and daily closed bars. It does not treat TradingView volume as a CME final bulletin. Without an authenticated first-seen OI provider, OI-derived quadrants remain unavailable rather than being imputed from COT or volume. Inputs and response size are bounded, and COT failure does not discard price/volume evidence. Top-level status is derived from final quality issues. Volume Z-score is activity evidence, not identification of institutions, aggressors, or new long/short positions; roll, basis, vendor aggregation, and preliminary/final differences remain residual risks.

## Addendum: Backlog #42 (2026-07-20)

Strategy research records are isolated from live analysis, evaluation logs, and TradingView in a local JSONL. Inputs are limited to concise hypotheses, structured contracts, exact Pine/ledger IDs, allowlisted metrics, guardrails, and decisions; raw OHLC, Pine source, arbitrary code/metrics, and account credentials are rejected. Definition and evidence hashes are recomputed on read. Sequence, entity, parent-child order, hypothesis existence, and evidence collisions fail closed. File safety requires 0700/0600, current ownership, regular files, no-follow, size limits, full writes, fsync, and verified stale-lock recovery. Comparisons require exact hashes and matching population, symbol/timeframe, methodology, and conditions; heterogeneous evidence is never ranked.

`register_event_study_hypothesis` and `get_event_study_journal` use the same bounded, append-only research-journal boundary for event and observational feature studies. Registration canonicalizes and hash-binds the immutable audit definition and evaluation contract. Evidence comparison requires paired `study_ids` and `evidence_hashes` of equal bounded length; the read path never accesses TradingView. These records are research evidence, not live-analysis state or authorization to trade.

## Addendum: Price Action and Volume Profile Research (2026-08-13)

`get_price_action_context_template` and `get_volume_profile_context_template` return fixed local Pine source only. Their context readers accept only `USER;...` script IDs and verify the saved script name, kind, latest version, exact source bytes, on-chart placement, input contract, symbol, and timeframe before returning values. `get_price_action_context` rejects disabled close confirmation; an unconfirmed zero is not represented as a confirmed absence. These patterns describe candle geometry, not order flow or participant intent.

`run_price_action_pattern_study` is exact-chart-bound and caps requested history at 5,000 bars. History paging may enlarge TradingView's local loaded-history cache but does not change the symbol, timeframe, Pine source, alerts, or orders. Returned intervals are explicitly descriptive because events and forward windows can overlap.

`get_volume_profile_context` accepts completed prior-session levels only. `run_volume_profile_reaction_study` and `run_volume_profile_poc_reversion_study` are Replay-blocked, verify the audited template and frozen 24-row/70-percent/exchange-volume inputs, bind returned OHLC to the expected chart, bound bars and event output, and keep the reaction and POC populations separate. TradingView volume remains an exchange- or vendor-reported chart field; none of these tools claims Bid/Ask flow, MBO, institutional activity, or executable fills.

## Addendum: Read-Only Context and Calibration Tools (2026-08-13)

`get_dxy_context_gate_template` returns a fixed `lookahead_off` Pine template and performs no chart or filesystem write. `compute_correlation_regimes` requires two distinct explicit chart bindings, joins closed bars on exact UTC timestamps, never forward-fills, and returns descriptive labels rather than a signal. `run_lead_lag_falsification_audit` is bounded deterministic synthetic computation: it does not read TradingView, call a network, write a journal, or establish profitability.

`get_oanda_flow_collection_readiness` reports only whether the token environment variable is configured; it neither returns the credential nor makes a network request. Its evidence label is broker-client retail percentages, not market-wide flow. `get_cot_crowding_unwind_context` is daily-chart-bound and Replay-blocked; its leveraged-money percentile plus prior-range break is a proxy, not observed orders, stops, institutions, or execution. `get_cot_crowding_unwind_overlay_template` is fixed source and consumes explicit MCP-produced COT inputs rather than fetching data from Pine.

`get_carry_core_primary_readiness` reads local first-seen policy-rate versions and complete collection heartbeats without changing a chart. `run_carry_core_primary_test` requires confirmation before temporarily collecting the frozen five-pair daily panel, restores chart state, uses only versions available by each anchor close, and remains `not_evaluable` below the preregistered 60 complete clusters. Revised official-history data is kept outside this primary-test evidence path.

## Addendum: Cross-Asset Shock Research (Backlog #82, 2026-08-13)

`preflight_cross_asset_shock`, `classify_cross_asset_shocks`, and `evaluate_cross_asset_shock_outcomes` bind an EURUSD or USDJPY target and a distinct auxiliary chart at M5 or M15. They temporarily reuse the auxiliary chart for fixed DXY, US10Y, and XAUUSD sources under serialized chart operations and restore it after each read. Returned evidence is intersected on exact closed-bar UTC timestamps without forward filling. Counts, history loads, states, and events are bounded; optional history loading can persist in TradingView's local cache.

The preflight reports coverage only, classification reports contemporaneous frozen states only, and outcome evaluation excludes overlapping state windows. None returns an order-flow claim, candidate, trading instruction, or order. Manual UI changes and other processes remain residual chart-race risks; symbol/timeframe readback and restoration checks fail closed when detected.

## Addendum: Bookmap Local Evidence Preflight (Backlog #83, 2026-08-13)

`preflight_bookmap_flow_price_join` is the externally configurable local-evidence read boundary. It reads from `TRADINGVIEW_MCP_BOOKMAP_FLOW_DIRECTORY`, defaulting to `/Volumes/HD/bookmap_data`, and accepts only a basename matching `bookmap-flow-*.jsonl`; path separators, traversal, absolute paths, and `bookmap-flow-signals-*` research outputs are rejected. The configured directory must be a real nonsymlink directory, and listed or selected sessions must be real nonsymlink regular files. A session is capped at 64 MiB and each JSONL line at 256 KiB before schema processing.

Every row must be valid JSON with supported `source: "bookmap"`, schema version, event type, instrument alias, and canonicalizable receipt timestamp. Mixed instruments, duplicate instrument records, unsupported provenance, and missing instrument metadata fail closed. Crypto, unconfirmed full depth, missing snapshot completion, legacy timestamp precision, and absent trades become explicit quality issues. The reader is read-only: it does not write, delete, follow a user-supplied path, change the chart, access Bookmap over the network, create a candidate, or place an order.

The join is limited to an active, exactly bound EURUSD M1 or M5 chart and is blocked during Replay. It aggregates by local receipt time and treats CME futures flow as a single-venue proxy, never as complete spot-FX flow. Receipt time is not exchange event time, delayed/replay feeds are not live evidence, and exact bar association does not prove causal ordering. A filesystem replacement between `lstat` and `readFile` is a residual local same-user race because the current implementation does not open the file with an atomic no-follow descriptor.

## Handoff for Future Phases

- Keep trading and Replay Trading APIs private. Alert exposure remains limited to #26's confirmed creation path; modification, restart, deletion, and webhooks remain unavailable.
- External scanner response validation was completed in Phase 4 with Zod.
- CI was introduced in #30. Update the Node matrix and `engines` at LTS/EOL transitions and periodically review pinned GitHub Actions SHAs as dependencies.
