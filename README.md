# TradingView-MCP

**Let an AI inspect your TradingView Desktop app and help analyze your charts.**

**100+ MCP tools** for chart inspection and control, indicators, Pine Script, backtesting, market research, falsification audits, point-in-time evidence, and cross-market analysis.

Register this server with an AI agent such as Claude Code, Codex, or Antigravity, and the agent can read the chart you are currently viewing. Your signed-in account, saved layouts, and purchased custom indicators remain available in the Desktop app.

## What You Can Do

Example requests:

- "**Analyze the current chart.**" -> combine the chart image, candles, and indicator values.
- "**Read this indicator's signals.**" -> retrieve BUY/SELL labels and support/resistance values.
- "**Assess the market on both the daily and four-hour timeframes.**" -> retrieve multiple-timeframe evidence without moving the chart.
- "**Find Japanese stocks with RSI below 30.**" -> search the market scanner.
- "**Check every symbol in my watchlist.**" -> retrieve quotes for the complete list.

## How It Works

TradingView Desktop is an Electron application. When launched with its debugging endpoint enabled, an external program can inspect the chart. This MCP server provides that bridge.

```
AI agent <-> tradingview-mcp <-> TradingView Desktop (your chart)
                              <-> TradingView public APIs (quotes and scanner)
```

## Requirements

- macOS and [TradingView Desktop](https://www.tradingview.com/desktop/) (the free plan is sufficient)
- [Node.js](https://nodejs.org/) 22 or later (check with `node --version`; Node 20 is EOL)
- An AI agent such as [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex), or [Antigravity](https://antigravity.google/)

## Setup in Three Steps

### Step 1: Install the Server

In a terminal:

```bash
git clone https://github.com/tedorigawa001/TradingView-MCP.git
cd TradingView-MCP
npm install
npm run build
```

### Step 2: Launch TradingView in Debug Mode

**Important:** The AI cannot inspect TradingView when it is launched normally from the app icon. If TradingView is running, quit it with Cmd+Q, then run:

```bash
open -a TradingView --args --remote-debugging-port=9222
```

To avoid typing the full command each time, add an alias and launch it with `tv`:

```bash
echo 'alias tv="open -a TradingView --args --remote-debugging-port=9222"' >> ~/.zshrc
source ~/.zshrc
```

### Step 3: Register the MCP Server

Choose the instructions for your agent. Replace `/path/to/TradingView-MCP` with the cloned repository path (run `pwd` from the repository to find it).

<details>
<summary><b>Claude Code</b></summary>

Run one command:

```bash
claude mcp add tradingview -- node /path/to/TradingView-MCP/build/index.js
```

Alternatively, open Claude Code in this repository. The bundled `.mcp.json` registers the server automatically.

Verify by running `/mcp` in Claude Code and confirming that `tradingview` appears.

</details>

<details>
<summary><b>Codex (OpenAI)</b></summary>

Option 1 - add it with the CLI:

```bash
codex mcp add tradingview -- node /path/to/TradingView-MCP/build/index.js
```

Option 2 - add it directly to `~/.codex/config.toml`:

```toml
[mcp_servers.tradingview]
command = "node"
args = ["/path/to/TradingView-MCP/build/index.js"]
```

Verify by running `/mcp` in Codex and confirming that `tradingview` appears.

</details>

<details>
<summary><b>Antigravity (Google)</b></summary>

Create or update `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/path/to/TradingView-MCP/build/index.js"]
    }
  }
}
```

From the IDE, open the same file from `...` -> `MCP Servers` -> `Manage MCP Servers` -> `View raw config` in the upper-right corner of the agent panel. Saving reloads it automatically.

</details>

## Try It

With TradingView running in debug mode, ask your AI agent:

> Analyze the current chart.

The agent can combine tools such as `get_chart_context` (what is displayed), `get_chart_screenshot` (visual evidence), and `get_ohlcv` (numeric evidence).

## Tools (101 Total)

The AI selects the appropriate tools automatically; you do not need to memorize them.

**Read charts**

| Tool | Description |
|---|---|
| `get_chart_context` | Lists the symbol, timeframe, and indicators for every visible chart |
| `get_chart_screenshot` | Captures the chart; `chart_index` can crop one chart at high resolution |
| `get_ohlcv` | Candle data with ISO timestamps and a `forming` flag for the live bar |
| `get_indicator_values` | Indicator plot values such as signals and bands |
| `get_indicator_inputs` | Indicator input names, current values, and defaults |
| `get_indicator_graphics` | Indicator labels, lines, and boxes, including Elliott Wave counts |
| `get_indicator_tables` | Indicator tables, such as MTF trend grids, reconstructed as cell matrices |
| `get_key_levels` | Aggregates sourced support and resistance within +/-N% of price |
| `load_more_history` | Loads additional historical candles without moving the viewport |

**Operate charts**

| Tool | Description |
|---|---|
| `set_symbol` | Changes the selected pane's symbol; defaults to the active pane and rolls back on failure |
| `set_timeframe` | Changes the selected pane's timeframe with the same rollback behavior |
| `set_indicator_input` | Temporarily changes indicator or strategy inputs without saving them |
| `get_replay_status` | Reads Bar Replay availability, state, and historical cursor time |
| `start_chart_replay` | Verifies symbol/timeframe and starts Replay after dry-run and confirmation |
| `step_chart_replay` | Advances a paused Replay by 1-100 bars and verifies time advancement |
| `stop_chart_replay` | Stops Replay after dry-run and confirmation and returns to real time |

**Data outside the chart**

| Tool | Description |
|---|---|
| `get_quotes` | Quotes and technicals such as RSI and aggregate ratings |
| `get_mtf_overview` | Batch snapshots for multiple symbols and timeframes without chart interference |
| `scan_market` | Market screening, for example Japanese stocks with RSI below 30 sorted by volume |
| `get_economic_events` | Economic calendar filtered by country and importance |
| `get_watchlist` | Your TradingView watchlist |
| `list_alerts` | Read-only list of your price alerts |
| `create_analysis_alerts` | Previews and idempotently creates expiring Confirmation, Invalidation, and Target 1 alerts after explicit confirmation |

**Market context and evaluation**

| Tool | Description |
|---|---|
| `get_market_snapshot` | Combines multiple markets, timeframes, and events in one acquisition window with explicit quality status |
| `get_execution_snapshot` | Normalizes bid/ask, spread, pip/tick, and feed mode; reports ready only after observing a post-request price update |
| `get_trade_decision_context` | Binds chart, OHLC, levels, MTF, events, COT, real yield, and bid/ask to one `snapshot_id`; blocks live execution evidence during Replay |
| `get_aligned_history` | Strictly aligns closed bars from multiple charts by UTC timestamp without forward filling |
| `compute_market_features` | Deterministically computes returns, ATR, volatility, and correlation from aligned history |
| `compute_market_regimes` | Classifies closed OHLC as trend/range/transition and low/normal/high volatility using only prior evidence and explicit thresholds; it does not optimize or recommend trades |
| `compute_correlation_regimes` | Classifies rolling return correlation between two exact chart bindings; uses closed bars matched by UTC timestamp without forward filling |
| `run_strategy_regime_analysis` | Runs an exact saved strategy temporarily, joins its full ledger to labels closed before entry, and reports PF, expectancy, win rate, drawdown, and coverage by directional, volatility, combined, and optional DST-aware session regimes; verifies cleanup and chart restoration |
| `run_strategy_regime_matrix` | Serially evaluates up to 12 symbol/timeframe/strategy jobs under one regime/session contract, optionally loading up to 20,000 bars per job; isolates failures, restores after every job, stops after restoration failure, and does not rank or pool currencies |
| `run_market_event_study` | Runs closed-OHLC event studies with exclusive branches, decision-time-correct session handoffs, same-timestamp policy, Bonferroni reference, returns, MFE/MAE, folds, confidence intervals, declared trials, and optional prior price/volatility regimes; FVG populations can be frozen by time window, direction, and regime |
| `run_event_study_falsification_audit` | Calibrates frozen FVG retest, session auction, and event-aftershock candidate rules against white-noise, regime-switching-volatility, and bid-ask-bounce synthetic OHLC; it does not access charts, networks, or journals or pool rates across models |
| `register_event_study_hypothesis` | Registers an immutable event-study or feature-study hypothesis and outcome contract in the local append-only research journal |
| `get_event_study_journal` | Lists hash-bound event-study evidence or compares exact selected records without accessing a chart |
| `get_dxy_context_gate_template` | Returns the fixed Pine template that reads confirmed DXY daily data with `lookahead_off` and exposes its return and gate plots |
| `run_yield_price_nonconfirmation_study` | Uses two exact charts to detect a target that fails to follow a confirmed driver and then breaks structure in the opposite direction; returns multi-horizon and fold-level return/MFE/MAE without exact-time matching or forward fill |
| `run_external_label_study` | Measures outcomes after caller-supplied point labels such as daily OI; requires at least one-bar lag, rejects zero lag, supports daily/weekly data, and guarantees point-in-time behavior only for the join, not the supplied labels |
| `compute_lead_lag_relationships` | Joins closed returns by exact UTC time and reports every lag from -N to +N, Fisher-z intervals, and fold sign stability. Default v3 causally standardizes each series by the preceding 20-return RMS. It reports Bonferroni and empirical family-wise p-values without selecting a best lag. Because the shared clustered-volatility null still exceeded nominal 5%, `candidateEligible` and journal recording remain fail-closed pending recalibration. `return_standardization: none` exists only to reproduce raw-return v2. |
| `run_lead_lag_falsification_audit` | Runs the frozen lead-lag gate against paired synthetic nulls and returns a fully resolved, hash-bound calibration configuration without reading TradingView |
| `run_feature_outcome_falsification_audit` | Runs the actual `candidateEligible` rule against three deterministic synthetic nulls, including fixed 1,000-repetition empirical-null calibration, and reports per-model candidate rates, Wilson intervals, and unevaluable seeds |
| `run_feature_outcome_power_audit` | Injects a signed next-bar effect after a frozen body-direction bucket and reports detection, Wilson interval, and miss rate by effect and model; it preserves signal-bar shape but does not establish market alpha or profitability |
| `compute_feature_outcome_relationships` | Classifies ATR compression, body direction, wick imbalance, streak, range position, and gaps using only contemporaneously available evidence, with outcomes and fold distributions by bucket. Optional selection compares against all bars in the same time/regime population. Empirical calibration uses a fixed 1,000-repetition circular moving-block null and requires Newey-West, Bonferroni, and family-wise empirical tests at horizon 1; it does not optimize thresholds or recommend trades |
| `compute_session_profile` | Computes DST-aware, cross-midnight session ranges, returns, opening-range extension, high/low times, VWAP behavior, prior-session level tests, holiday/short-session quality, gaps/overlaps, and volume coverage; TradingView volume is explicitly unverified tick/exchange volume |
| `get_price_action_context_template` | Returns the audited close-confirmed Pine template for pin bars, engulfing bars, and 20-bar sweeps |
| `get_price_action_context` | Reads the latest price-action plots only after verifying the exact saved template, on-chart instance, inputs, symbol, and timeframe |
| `run_price_action_pattern_study` | Descriptively measures naked-entry outcomes for the three frozen price-action patterns and reports same-clock-hour baselines |
| `get_volume_profile_context_template` | Returns the audited Pine proxy for completed prior-session POC, VAH, and VAL derived from chart-bar volume allocation |
| `get_volume_profile_context` | Reads completed profile levels only after exact source, version, placement, input, symbol, and timeframe verification |
| `run_volume_profile_reaction_study` | Runs the frozen 60- or 240-minute VAH/VAL reaction study with same-prior-regime controls; it does not claim order-flow evidence |
| `run_volume_profile_poc_reversion_study` | Runs the separately frozen 60-minute POC-reversion study and keeps its population separate from VAH/VAL reactions |
| `compute_round_trip_cost` | Computes round-trip spread, slippage, and commission under explicit assumptions |
| `compute_position_size` | Floors position size from loss limit, Entry/Stop, costs, quantity constraints, and fresh FX conversion evidence |
| `evaluate_due_analyses` | Previews due nonterminal journal analyses, then after confirmation temporarily switches the selected chart, evaluates, records, and restores it |
| `get_analysis_performance` | Aggregates the live journal into outcomes, gross/net R, MFE/MAE, and time-to-hit with explicit populations and exclusions |
| `validate_trade_plan` | Validates direction, expiry, current price, evidence freshness, event blackout, and net reward/risk without touching the chart |
| `get_cme_gold_open_interest` | Reads `TOTAL GC FUT` all-contract OI from the CME Daily Bulletin and records first-seen preliminary/final state without mixing chart contract baskets |
| `reconcile_gold_open_interest` | Reconciles COT gold OI with locally first-seen CME `TOTAL GC FUT` on exact dates only, with no nearest-date interpolation |
| `get_positioning_context` | Returns CFTC COT history, OI normalization, weekly change, and three-year percentile; when first-seen storage exists, `available_at` is the observed time rather than an estimate |
| `get_futures_flow_context` | Combines directed CME/COMEX daily futures price/volume Z-score with weekly COT. Chart OI is the default; `cme_daily_bulletin` is XAUUSD-only, keeps preliminary/final and contract baskets separate, records prospective first-seen revisions, never fills missing CME dates from chart data, and supports `as_of` vintages |
| `get_real_yield_context` | U.S. Treasury 10-year par real CMT, restricted to locally first-seen versions when `as_of` is supplied |
| `get_policy_rate_context` | Returns first-seen policy rates for eight currencies as of a requested time, requiring both conservative `available_at` and observed `first_seen_at` |
| `get_exploratory_policy_rate_history` | Returns isolated official revised policy-rate history for exploration only; it makes no historical-availability claim and cannot support prospective/OOS evidence |
| `carry_panel_preflight` | Checks common policy-rate start, non-overlapping anchors, OOS remainder, and gaps for a frozen pair/period/horizon; it never backfills uncollected history and reports `not_evaluable` below the requirement |
| `estimate_carry_panel_effective_sample` | Estimates correlation-adjusted effective sample size from frozen carry returns using date-level circular moving-block bootstrap; it does not select or optimize |
| `measure_carry_panel_dependence` | Temporarily acquires a daily FX panel and reports observed pairwise rho and block-bootstrap design effect on exact non-overlapping dates; dynamic official-rate signs remain exploratory and non-point-in-time |
| `get_carry_core_primary_readiness` | Reads the frozen carry primary-test readiness from first-seen rates and complete collection heartbeats without switching a chart |
| `run_carry_core_primary_test` | Runs the frozen five-pair carry panel with first-seen rates, pair fixed effects, and anchor-date block bootstrap; remains `not_evaluable` below 60 complete clusters |
| `get_oanda_flow_collection_readiness` | Reports whether the local OANDA retail-flow collector is configured without making a request or exposing its token |
| `get_cot_crowding_unwind_overlay_template` | Returns the audited Pine overlay for supplied COT crowding context and prior daily structure; it does not fetch or infer orders or stops |
| `get_cot_crowding_unwind_context` | Describes a daily EURUSD/USDJPY leveraged-money crowding and price-break proxy without claiming observed execution flow |
| `preflight_cross_asset_shock` | Verifies exact closed-bar coverage for an EURUSD/USDJPY, DXY, US10Y, and XAUUSD shock study while restoring the temporary auxiliary chart |
| `classify_cross_asset_shocks` | Classifies frozen same-UTC cross-asset shock states without producing outcomes, candidates, or trade instructions |
| `evaluate_cross_asset_shock_outcomes` | Measures descriptive 15/30/60/120-minute outcomes for non-overlapping frozen shock states without producing a candidate |
| `preflight_bookmap_flow_price_join` | Reads one bounded local Bookmap Collector JSONL and verifies conservative receipt-time coverage against active EURUSD M1/M5; CME flow remains a single-venue futures proxy |
| `audit_pine_indicator` | Statically audits a user-owned Pine indicator for repainting risks |
| `compare_indicator_observations` | Detects changes in the same-bar values before and after reload |

### First-seen collection CLI

`npm run collect:first-seen -- --cot-symbol OANDA:EURUSD --cot-symbol OANDA:XAUUSD` collects COT, the U.S. 10-year real yield, and all-contract GC open interest from the CME Daily Bulletin into append-only first-seen logs. `npm run coverage:first-seen` reports collection days, revisions, and first/last observation dates for COT, real yield, futures OI, and policy rates as JSON. Set scheduled COT symbols with `TRADINGVIEW_MCP_COLLECTION_COT_SYMBOLS=OANDA:EURUSD,OANDA:XAUUSD`.

`npm run collect:policy-rates` reads `ECONOMICS:*INTR` for USD/EUR/JPY/GBP/AUD/NZD/CAD/CHF in sequence and appends changes to `~/.tradingview-mcp/policy-rate-first-seen.jsonl`. Every run that successfully acquires all eight currencies, persists values, and restores the chart is also recorded in `~/.tradingview-mcp/policy-rate-collection-heartbeats.jsonl`, whether or not a value changed. This lets the primary test verify first-seen values and collection continuity separately. Override the heartbeat path with `TRADINGVIEW_MCP_POLICY_RATE_COLLECTION_HEARTBEAT_PATH`. Coverage reports distinct run days, same-day reruns, maximum business-day age between runs, intervals beyond the frozen five-day limit, and latest-run age. The script uses the same cross-process chart lock as the MCP server, passes the approved `--confirm-chart-switch`, and verifies restoration after every currency. Because TradingView's 00:00 UTC bar is not a release timestamp, `available_at` is conservatively set to 00:00 UTC on the next business day. This reproducible boundary prevents meeting-day lookahead but is not the actual publication time.

`npm run collect:official-policy-rates` writes to a separate exploration-only official-history store. Sources include the ECB Deposit Facility SDMX CSV; BoC Valet `V39079`; the exclusive date splice of FRED `DFEDTAR` with the midpoint of `DFEDTARL`/`DFEDTARU` from 2008-12-16; RBA F1 `FIRMMCRTD`, joining the official legacy XLS (1990-08-02 through 2010-12-31) to the current daily CSV from 2011-01-04; the SNB policy rate and legacy Libor target-range midpoint; and a frozen BoJ meeting-decision manifest. BoJ periods without a single short-rate target are stored as `value: null` so an obsolete rate is not carried forward. Effective market rates are not substituted for policy targets. Unchanged observations are reduced to change points, while raw snapshots retain original row count and first/last dates to distinguish missing data from unchanged values. Raw bodies retain `raw_sha256`, retrieval time, and Last-Modified vintage and are stored owner-only at `~/.tradingview-mcp/policy-rate-official-raw/<sha256>.raw`; reused hashes are revalidated. This is revised history and must not support prospective/OOS evidence, the primary test, or adoption decisions.

`npm run collect:fx-history -- --from 2022-01-01T00:00:00.000Z --to 2026-01-01T00:00:00.000Z` reads `OANDA_FX_HISTORY_ACCOUNT_ID` and `OANDA_FX_HISTORY_ACCESS_TOKEN` only from the environment and retrieves confirmed OANDA v20 `EUR_USD` midpoint M15 candles. Choose `practice` (default) or `live`; credentials and account IDs are never written to stdout, manifests, or raw evidence. Requests are paged at no more than 4,000 bars and timeouts, 429s, and 5xx responses are retried up to three times per page. Successful pages are archived before checkpoints are appended to `~/.tradingview-mcp/fx-history-m15-manifest.jsonl.checkpoints`, so rerunning the same range revalidates archived raw data and resumes from the first incomplete page. Raw responses are stored owner-only by content hash under `~/.tradingview-mcp/fx-history-raw/<sha256>.raw`. The manifest records range, retrieval time, raw and normalized hashes, counts, first/last bars, boundary duplicates, and weekday discontinuities. Equal duplicates are removed; conflicting duplicates stop the run. This revised official history is not a first-seen series and currently supports exploratory long-run CPI/NFP/FOMC research only, not existing OOS adoption gates.

On macOS, register `com.tradingview-mcp.policy-rate-collection` for weekdays at 10:45 JST without `RunAtLoad`, so login and MCP restart do not immediately move the chart. External first-seen collection runs at 10:30 and 22:30 JST on weekdays to create two observation windows for preliminary-to-final CME OI revisions; this schedule does not guarantee the final publication. Both jobs share the chart-operation lock, so they wait or fail during MCP use rather than restoring another process's temporary symbol.

### Macro surprise forward collection

`npm run coverage:macro-surprise -- --events CPI_ARTIFACT --events NFP_ARTIFACT --events FOMC_ARTIFACT --confirm-local-import` reconciles official release artifacts with local first-seen evidence and separately reports pre-collection events, missed forward consensus/actual values, releases still inside the 15-minute actual-capture window, and evaluable surprises. Revised official history does not prove that historical consensus was known, so `events_before_collection` is not a gap. A nonzero `missing_forward_consensus` or `missing_forward_actual` blocks the directional study.

macOS examples are provided for [daily consensus collection](docs/launchd/com.tradingview-mcp.macro-consensus-collection.plist.example), [five-minute actual collection](docs/launchd/com.tradingview-mcp.macro-actual-collection.plist.example), and [daily coverage checks](docs/launchd/com.tradingview-mcp.macro-surprise-coverage.plist.example). Actual collection fetches official documents only within 15 minutes of release. Set `TRADINGVIEW_MCP_TRADING_ECONOMICS_API_KEY` in the launchd environment before loading the consensus job. The examples reference real 2016-2026 artifacts; update all three paths to the same artifact set each year. Keep the mapping JSON private and outside Git.

### Event-study falsification audit CLI

`npm run audit:event-studies -- --config fvg-audit.json` calibrates a frozen event-study definition against synthetic nulls. Defaults are 400 replications per model, 5,000 bars, nominal alpha 5%, and three folds; white noise, regime-switching volatility, and bid-ask bounce are reported **separately**. The audit never accesses TradingView, the network, or local journals. For a quick smoke test, override with `--model white_noise --replications 20 --bars 1200`.

The configuration contains only the study definition and candidate rule. For example:

```json
{
  "study": {
    "type": "fvg_retest",
    "definition": {
      "symbol": "SYNTH:FVG_RETEST",
      "timeframe": "15",
      "minimumGapBps": 10,
      "retestWithinBars": 24,
      "minImpulseBodyRatio": 0.5,
      "requireBoundaryHold": true,
      "horizons": [1, 4, 8],
      "targetReturnBps": 20,
      "minimumEvents": 30,
      "eventLimit": 0,
      "confidenceLevel": 0.95,
      "configurationTrials": 1,
      "regime": null,
      "branchFilter": "bearish"
    }
  },
  "candidate": {
    "branch": "fvg_retest_bearish",
    "horizon": 4,
    "minimumEvents": 30,
    "minimumFoldEvents": 5,
    "folds": 3
  }
}
```

Each model's Wilson interval is used to assess whether its candidate rate exceeds nominal alpha. This does not prove profitability or future edge; it audits how often the adoption rule fires on a series with no signal.

For an event-aftershock-retest audit, provide `eventSchedule` instead of real economic-event times. `firstBar`, `everyBars`, and `maximumEvents` define a relative exogenous schedule within each synthetic series; they do not predict, substitute for, or reproduce real events.

### Periodic research-hypothesis collection

`npm run collect:research-hypotheses` serially collects three prospective hypotheses: XAUUSD M15 bearish FVG x `trend_down`, daily EURUSD/U.S. 10-year nonconfirmation, and EURUSD M50 lower-wick x `trend_down`. It refuses to run during Bar Replay, temporarily switches the two existing panes, and restores their original symbols and timeframes after success or failure. It does not modify orders, alerts, Pine scripts, or studies.

Only aggregates are stored in `~/.tradingview-mcp/research-collection.jsonl`, and a record is appended only when the primary horizon has at least one closed event. Startup verifies that all three hypothesis IDs are preregistered in the research journal. The MCP server and CLI share one owner-only chart-operation lock. In stdout, `collection_status` describes execution and `research_status` describes evidence sufficiency; either being `partial` makes the top-level status partial. For scheduled macOS operation, copy and load the launchd examples for [research hypotheses](docs/launchd/com.tradingview-mcp.research-hypotheses.plist.example), [external first-seen collection](docs/launchd/com.tradingview-mcp.first-seen-collection.plist.example), and [policy rates](docs/launchd/com.tradingview-mcp.policy-rate-collection.plist.example). TradingView must be running with CDP enabled. The research example runs hourly to reduce visible chart interference.

Required history is frozen per job: 5,000 bars for FVG, 1,000 per series for the daily rate nonconfirmation, and 500 for the M50 feature study. Missing bars are loaded on the same temporary chart, and `coverage` records initial, added, and final counts, provider capacity, and sufficiency. If the requirement cannot be met, `insufficient_loaded_history` stops analysis and evidence recording; short history is never presented as complete evidence.

`get_execution_snapshot` first reads `bid`, `ask`, `lp_time`, session state, real-time load state, and price increment from open TradingView charts. `lp_time` is the last-price time in the same quote snapshot, not an exchange timestamp for each bid/ask. A chart quote is `ready` only when it is no more than five seconds old by default and is streaming, in an active session, and real-time loaded. If the symbol is not open, the tool falls back to the scanner. The scanner has no market-side bid/ask timestamp or session calendar, so receipt time is never substituted for market time; the fallback is ready only after observing a bid/ask change within the default 1.2-second window. No movement returns `wait`. This does not guarantee fillability or liquidity and does not change accounts, orders, or charts.

`compute_position_size` returns instrument units, not broker-specific lots. Supply `quantity_step`, `minimum_quantity`, and where needed `maximum_quantity` and `contract_multiplier` according to the execution venue. Loss includes Entry-to-Stop distance plus explicit round-trip cost such as `compute_round_trip_cost.total_price_per_unit`, converted to account currency. When quote and account currencies differ, size is returned only with a fresh account-currency/quote-currency rate, symbol, and observation time. The tool does not connect to an account, read balances, place orders, or persist positions.

Real-yield first-seen history is appended to `~/.tradingview-mcp/real-yield-first-seen.jsonl` by default; override it with `TRADINGVIEW_MCP_REAL_YIELD_HISTORY_PATH`. Historical rows fetched on first startup are not backdated to past publication times and become eligible for backtests only after the time they were actually stored.

Futures-OI first-seen history is appended to `~/.tradingview-mcp/futures-open-interest-first-seen-v3.jsonl` by default; override it with `TRADINGVIEW_MCP_FUTURES_OI_HISTORY_PATH`. Chart-derived OI is recorded when read by `get_futures_flow_context`, and official CME all-contract GC OI is recorded by `get_cme_gold_open_interest` and the collection CLI. Chart proxies and official CME values remain separate. Pre-collection vintages cannot be reconstructed: historical values downloaded today are revised values, not necessarily what was visible at the time.

If a process crashes while writing history and leaves a `.lock`, history access stops rather than deleting it automatically. Confirm that no other TradingView-MCP process is running before deleting only the adjacent `.lock` file.

The evaluation CLI uses the snapshot's `request_completed_at` as evaluation time and binds `evaluation_context.real_yield_10y` only to a version first seen by that time. It never falls back to the current value or a later revision.

```bash
npm run evaluate -- --log evaluation.jsonl --snapshot snapshot.json
```

Use `--real-yield-history PATH` for an isolated store. If the snapshot has no completion time, supply canonical UTC with `--as-of 2026-07-01T12:00:00.000Z`. An `--as-of` later than `request_completed_at` is rejected as lookahead. Missing history is not imputed and records `point_in_time_status=blocked`; corrupt history or lock failure prevents the snapshot itself from being appended.

**Pine scripts (user-owned only)**

| Tool | Description |
|---|---|
| `list_pine_scripts` | Lists saved user-owned Pine scripts and the chart indicators that use them |
| `get_pine_source` | Retrieves full source for a user-owned script, optionally by version for recovery |
| `save_pine_script` | Saves AI-modified source; **dry-run without confirmation**, creates only a new script or version, never overwrites history |
| `add_pine_to_chart` | Adds a user-owned script to the chart; removal is separate |
| `remove_owned_study` | Verifies `USER;` Pine ID, chart, and internal study ID before removing one instance; **dry-run without confirmation** |
| `evaluate_analysis_overlay_outcome` | Evaluates an audited analysis on later closed bars, optionally using a temporary evidence timeframe; appends to the journal only with `record:true` |
| `get_analysis_journal` | Reads definitions and latest evaluations without allowing a later stale `ongoing` record to reverse a completed result |
| `get_analysis_calibration` | Reports Brier score and realized rates by confidence band, using Target-first as positive and Stop-first as negative with explicit exclusions |
| `get_analysis_overlay_status` | Validates expiry, current-price geometry, and drawing count; returns `unconfigured` or `blocked` without changing the chart |
| `get_analysis_overlay_template` | Returns the fixed Pine template for Entry, Invalidation, Stop, Targets, and analysis time |
| `ensure_analysis_overlay` | Idempotently reuses, installs, or after confirmation migrates a legacy 14-input overlay to the context-bound 18-input version; **dry-run without confirmation** |
| `apply_analysis_overlay` | Applies structured analysis with symbol/timeframe and optional snapshot/strategy version, verifies fail-closed readback, and journals after success; **dry-run without confirmation** |

To overlay analysis on the chart, save the template once with `save_pine_script`, then use `ensure_analysis_overlay` to place, update, and obtain its `study_id`. An existing current version is reused without writing, so each analysis does not create another script or study. If a legacy migration preview returns `contextBindingRequired:true`, confirmation binds that analysis to the currently verified symbol/timeframe. Expired analyses remain visible as `EXPIRED`. Template defaults are not treated as analysis and return `unconfigured`. After application, status rechecks inputs, current-price geometry, and drawings; a chart that differs from the stored context returns `stale_context` and `trusted:false`.

Current-price geometry does not establish historical hit order. `evaluate_analysis_overlay_outcome` evaluates closed OHLC after the analysis, excluding both the analysis-time bar and the forming bar. After Entry, an optional Confirmation must occur on a later bar; Invalidation before confirmation cancels the setup. Once active, Target 1 versus Stop is evaluated first-hit. This does not prove fills or P&L: touching opposing levels in one bar or opening across a terminal returns `ambiguous`. If history is short, load more or request a shorter `evaluation_timeframe`. The latter keeps the `expected_timeframe` overlay contract, temporarily switches only the selected chart, verifies symbol/resolution/bar evidence, and restores it. If `chartState.restored` is false, inspect `currentTimeframe` and restore manually. Daily and weekly aliases are supported; calendar-month `M` is `not_evaluable` because its duration varies.

The analysis journal defaults to `~/.tradingview-mcp/analysis-journal.jsonl`; override it with `TRADINGVIEW_MCP_ANALYSIS_JOURNAL_PATH`. `apply_analysis_overlay(confirm:true)` records the definition after verified readback, while outcome evaluation appends only with explicit `record:true`. The same ID and definition are idempotent; reusing an ID for a different definition or assigning conflicting completed labels is rejected. A definition conflict requires a new `analysis_id`, not a retry. If only journal writing fails, the application/evaluation result remains available with `journal.recorded:false` and a warning. Calibration uses only `target_before_stop=1` and `stop_before_target=0`; all other outcomes are counted by exclusion reason.

The journal reclaims a `.lock` only when it is older than 60 seconds and its recorded owner PID no longer exists. A live, unverifiable, or recent lock is never stolen, and the timeout names its path. Before manually deleting that lock, confirm that no TradingView-MCP process is using it.

This enables a read -> modify -> save -> backtest improvement loop:

> Read the BushidoScalp source, implement a change that reduces false signals, save it, backtest it on USDJPY 4H, and compare it with the original.

**Backtesting**

| Tool | Description |
|---|---|
| `run_backtest` | Temporarily applies a user-owned strategy, retrieves results, and removes it, leaving the chart unchanged |
| `get_strategy_report` | Reads net profit, win rate, PF, drawdown, and recent trades for the active strategy |
| `get_strategy_trade_ledger` | Pages the full Strategy Tester ledger in batches of up to 500, binds it to a SHA-256 ID, rejects cross-page recomputation, exposes available costs/run-up/drawdown/inputs/Pine version, and separates the trailing mark-to-market open row |
| `run_strategy_experiment` | Serially compares baseline and candidate on one chart; dry-run by default, then after confirmation reports exact Pine versions, ledger IDs, inputs, minimum trades, condition match, and metric deltas before removing both |
| `run_backtest_matrix` | Runs up to 24 explicit symbol/timeframe/input combinations with a 30-minute soft deadline, per-row full-ledger IDs, insufficiency/failure reasons, and verified restoration; it does not rank results |
| `run_strategy_walk_forward` | Splits full ledgers for 2-8 candidates into 2-12 explicit train/embargo/test windows, selects on train only, and returns OOS only for the selected candidate with anchored/rolling, tie, minimum-trade, quality, and coverage checks |
| `validate_research_protocol` | Validates an exact Pine version and frozen protocol, classifying IS/OOS overlap, future windows, forming bars, trial count, minimum trades, missing costs, static Pine risks, and post-OOS changes as blocked or warning |
| `stress_test_strategy` | Binds to a frozen protocol and stress-tests full ledgers under cost/time/bootstrap models plus up to eight explicit Pine input reruns, evaluating delays, Stop/Target, and nearby parameters through the strategy itself with cleanup, restoration, failures, and degradation rates |
| `register_strategy_hypothesis` | Registers a hypothesis and prospective evaluation contract in a local append-only research journal separate from live analysis |
| `record_strategy_experiment` | Binds experiment ID, Pine version, ledger ID, known metrics, guardrails, and decision to the hypothesis |
| `compare_strategy_experiments` | Compares exact experiment IDs and evidence hashes and rejects population, symbol, timeframe, or methodology mismatches |

## Troubleshooting

| Symptom | Cause and resolution |
|---|---|
| `TradingView desktop app is not reachable` | TradingView is not in debug mode. Quit it and relaunch it with the Step 2 command |
| Tools do not appear in the AI | Reconnect or restart the agent and confirm that `npm run build` has been run |
| Behavior does not change after rebuilding | The MCP process keeps the startup build; reconnect the agent session |
| `no tradingview.com/chart page found` | Open a chart tab in TradingView |

## Security

See [docs/security-review.md](docs/security-review.md) for the full review. At minimum:

- While the debug port is open, any program on the same machine can control the signed-in TradingView session. Launch in debug mode **only while using the AI**, use normal mode otherwise, and do not use this setup on a shared machine.
- The server is **read-oriented**. Writes are limited to non-destructive user-owned Pine versioning, adding/changing/removing verified owned studies, creating expiring alerts from audited analysis, and starting/stepping/stopping Bar Replay. Confirmation gates protect the relevant tools. Orders, Replay Trading, Replay autoplay, modification/resume/deletion of existing alerts, webhooks, watchlist changes, and Pine-library deletion are intentionally absent.
- `get_chart_screenshot` sends everything visible on screen, including watchlists, to the AI provider.

## Development

### Testing

```bash
npm test                   # Node unit tests + Bookmap Java tests
npm run test:integration   # Integration tests (requires the app in debug mode)
npm run test:e2e           # Real-app E2E over MCP stdio (configuration below)
```

`npm test` does not require TradingView. With the complete Bookmap SDK installed locally, it also runs the Collector, signal-engine, and Bookmap-adapter Java tests. With no or partial SDK, it builds and tests only the SDK-free `FlowSignalEngine` for Java 17 and explicitly skips adapter tests.

On pull requests and pushes, GitHub Actions runs `npm test` on Node.js 22 and 24, including the SDK-free signal engine. A separate `npm audit` job rejects high or critical vulnerabilities.

Integration tests temporarily change symbols and timeframes and restore them afterward.

For walk-forward E2E, set `TRADINGVIEW_WALK_FORWARD_E2E_CONFIG` to JSON matching the current chart and saved strategy. Do not include `confirm`; the test owns confirmation.

```bash
TRADINGVIEW_WALK_FORWARD_E2E_CONFIG='{"expected_symbol":"OANDA:USDJPY","expected_timeframe":"240","candidates":[{"pine_id":"USER;YOUR_PINE_ID","inputs":[{"id":"in_20","value":false}]},{"pine_id":"USER;YOUR_PINE_ID","inputs":[{"id":"in_20","value":true}]}],"folds":[{"fold_id":"f1","train_from":"2025-03-01T00:00:00.000Z","train_to":"2025-09-01T00:00:00.000Z","test_from":"2025-09-02T00:00:00.000Z","test_to":"2025-12-01T00:00:00.000Z"},{"fold_id":"f2","train_from":"2025-03-01T00:00:00.000Z","train_to":"2025-12-01T00:00:00.000Z","test_from":"2025-12-02T00:00:00.000Z","test_to":"2026-03-01T00:00:00.000Z"}],"mode":"anchored","embargo_bars":1,"minimum_train_trades":5,"minimum_test_trades":3,"selection_metric":"expectancy","max_runtime_seconds":180}' npm run test:e2e
```

For analysis-alert E2E, set `TRADINGVIEW_ANALYSIS_ALERTS_E2E_CONFIG` to match the installed analysis overlay.

```bash
TRADINGVIEW_ANALYSIS_ALERTS_E2E_CONFIG='{"pine_id":"USER;YOUR_PINE_ID","expected_symbol":"OANDA:USDJPY","expected_timeframe":"4H","analysis_id":"USDJPY-20260724-001","confirm":false}' npm run test:e2e
```

For Fair Value Gap Retest event-study E2E, set `TRADINGVIEW_FVG_RETEST_E2E_CONFIG` to match the chart.

```bash
TRADINGVIEW_FVG_RETEST_E2E_CONFIG='{"expected_symbol":"OANDA:EURUSD","expected_timeframe":"60","count":5000,"condition":{"type":"fair_value_gap_retest","minimum_gap_bps":10,"retest_within_bars":24,"min_impulse_body_ratio":0.5,"require_boundary_hold":true},"horizons":[1,2,4,8],"target_return_bps":20,"minimum_events":1,"event_limit":50,"confidence_level":0.95,"configuration_trials":1}' npm run test:e2e
```

Futures-flow E2E requires `open_interest_study_id`, `open_interest_plot_title`, and an `open_interest_scope` that freezes the value's meaning in `TRADINGVIEW_FUTURES_FLOW_E2E_CONFIG`. Scope must be paired with explicit OI data or study selection and cannot accompany pure autodetection, which reads only TradingView's official front-month Open Interest study. Otherwise a front-month value could be mislabeled as an aggregate. Missing OI fails explicitly so a broken first-seen collector cannot pass silently. The test redirects collection to a temporary file and does not contaminate production logs.

```bash
TRADINGVIEW_FUTURES_FLOW_E2E_CONFIG='{"target_symbol":"OANDA:XAUUSD","futures_chart_index":1,"expected_futures_symbol":"COMEX_DL:GC1!","count":250,"observation_limit":0,"minimum_observations":100,"cot_weeks":1,"open_interest_study_id":"YOUR_STUDY_ID","open_interest_plot_title":"Total OI","open_interest_scope":"all_months_aggregated"}' npm run test:e2e
```

E2E verifies rejection of incorrect chart binding, deterministic dry-runs, train-only selection, suppression of unselected candidates' OOS results, protocol validation, ledger stress, seeded bootstrap, real alert creation and ownership naming, bounded responses, and complete chart restoration. Missing configuration causes a skip.

### Repository Layout

- `src/` - TypeScript source
  - `cdp.ts` - CDP connection, evaluation, and screenshots
  - `tradingview.ts` - in-page TradingView API layer
  - `scanner.ts` - public scanner API client
  - `server.ts` - dependency-injected MCP tool definitions
  - `index.ts` - stdio entry point
- `test/unit/` - unit tests with mock CDP and scanner
- `test/e2e/` - configuration-driven E2E from MCP stdio to the real app
- `test/smoke.mjs` - integration smoke test against the real app
- `build/` - ignored TypeScript output
- `docs/` - design and research documentation

### Documentation

- [docs/STRATEGY.md](docs/STRATEGY.md) - overall strategy and progress
- [docs/phase0-findings.md](docs/phase0-findings.md) / [phase3](docs/phase3-findings.md) / [phase4](docs/phase4-findings.md) / [phase5](docs/phase5-findings.md) - internal API research
- [docs/security-review.md](docs/security-review.md) - security review
- [docs/BACKLOG.md](docs/BACKLOG.md) - future improvements
