# Bushido Bookmap Flow Collector

Read-only Bookmap API add-on for recording a single instrument's observable
futures-market microstructure evidence as JSON Lines. It does not submit,
modify, or cancel orders, and it does not expose the data over a network.

## Captured evidence

- `instrument`: Bookmap alias, symbol, venue, type, tick/size multipliers,
  full-depth flag, crypto flag, raw feed-delay value and requested symbol at
  initialization. The collector explicitly records that its depth listener is
  price-level aggregated and that it does not capture MBO order identities.
- `trade`: price-level, normalized price, size, aggressor side, raw
  `is_bid_aggressor`, OTC flag, and
  execution start/end flags when Bookmap supplies `TradeInfo`. Every missing
  `TradeInfo` field is stored as `null`; aggressor is then `unknown`, never
  guessed as buy or sell. Bookmap's `is_bid_aggressor: true` means a sell
  market order hit the bid; `aggressor` records this semantic direction.
- `depth`: incremental bid/ask book-level size updates.
- `bbo`: best bid/ask price-level and size updates.
- `snapshot_end`: Bookmap's initial depth snapshot completion marker. Only sessions
  containing this marker can later support a reconstructed book-balance feature.
- `collector_stop`: clean shutdown marker.

Each record has the latest Bookmap timestamp in nanoseconds as a decimal string when available and
the local receipt timestamp, rounded to canonical milliseconds. `bookmap_time_ns` is the most recently received
`TimeListener` value, not a per-callback exchange timestamp; it can be `null`
before the first timestamp callback. Do not treat it as tick-exact ordering
evidence until the selected feed's callback ordering and timestamp semantics
have been measured. The add-on writes one append-only JSONL file per attached
instrument under its Output directory, `~/.tradingview-mcp/bookmap-data` by
default on every platform; this external-data directory is not part of Git. The
MCP server reads the same directory by default. Set
`TRADINGVIEW_MCP_BOOKMAP_FLOW_DIRECTORY` for the server when the add-on writes
elsewhere. Earlier releases read `/Volumes/HD/bookmap_data` on macOS and
`%LOCALAPPDATA%\TradingView-MCP\bookmap-data` on Windows by default; when the
default holds no session and that directory exists, the server names it and the
setting that reads it.

The data represents the selected Bookmap feed and instrument only. For FX
research, use CME futures such as `6E`, `6J`, or `GC` as explicitly labelled
single-venue proxies; do not describe it as whole-market FX spot order flow.

## Episodes

Signals of the same kind and direction, separated by no more than
`Episode gap milliseconds` (30 s by default), form one episode. Every signal is written
to the JSONL with `episode_sequence`, `episode_signal_index` and running
`episode_trade_count`, `episode_price_levels` and `episode_aggressive_volume`,
so the highest index for a sequence carries the totals for the whole run.

Only the first signal of an episode is drawn on the chart. `chart_marker_drawn`
records whether a marker actually rendered, not whether one was wanted: markers
switched off, a missing indicator, or a failing `addIcon` all record `false`.
`episode_price_levels` is the union of every level the run's signals touched, so
a sweep contributes all the levels it crossed rather than only where it ended. On the delayed feed, withdrawals arrive in
runs seconds apart at nearly the same price, and drawing each one stacked the
badges until none could be read. Episodes are kept per kind and direction, so a
sweep between two ask withdrawals does not split the withdrawal run.

## Artifacts

Three JARs, each with one Bookmap module and none of the others:

| JAR | Module | Keeps |
|---|---|---|
| `bushidoyasu_flow_collector_delayed_replay_v1_1.jar` | `FlowCollector` | raw depth/BBO/trade JSONL |
| `bushidoyasu_flow_signal_research_delayed_replay_v1_2.jar` | `FlowSignalResearch` | signal JSONL, draws markers |
| `bushidoyasu_flow_signal_display_v1_0.jar` | `FlowSignalDisplay` | nothing - draws markers only |

The first two are for delayed and Replay data. The display JAR is the one to try
on an instrument that refuses the others; see `display-only/README.md`.

## Build

```bash
npm run build:bookmap-addon
```

The cross-platform build requires a JDK that supports `--release 17`. It uses
`JAVA_21_HOME` or `JAVA_HOME`, then the Homebrew JDK 21 locations on macOS,
and finally the JDK on `PATH`. Set `BOOKMAP_HOME` on Windows to the directory
whose `lib` subdirectory contains the two Bookmap SDK JARs.

When both required Bookmap SDK JARs are available under the default macOS
Bookmap install or configured `BOOKMAP_HOME`, the command creates the three JARs
listed under Artifacts:

- `bookmap-addon/dist/bushidoyasu_flow_collector_delayed_replay_v1_1.jar`:
  raw evidence collector, for delayed and Replay data.
- `bookmap-addon/dist/bushidoyasu_flow_signal_research_delayed_replay_v1_2.jar`:
  provisional flow-signal recorder with in-Bookmap chart markers, for delayed and
  Replay data.
- `bookmap-addon/dist/bushidoyasu_flow_signal_display_v1_0.jar`:
  chart markers only, keeping nothing.

The collector artifact deliberately contains `FlowCollector` only. The pure
classes `FlowSignalEngine` and `FlowSignalMarker` are packaged into the
signal-research and display JARs. No JAR contains another's Bookmap module.

The licensed Bookmap SDK is not available on GitHub-hosted runners. If either
SDK dependency is absent, the build compiles only the SDK-free
`FlowSignalEngine`, removes stale installable JARs from `dist`, and exits
successfully without producing a JAR. A partial SDK installation is treated as
unavailable rather than attempting an incomplete adapter build.

Run the Java tests on macOS, Windows, or Linux with:

```bash
npm run test:bookmap-addon
```

With the complete SDK, this tests the collector, signal engine, chart-marker
presentation, and the Bookmap research and display adapters. Without the SDK, it
tests the engine and marker presentation and reports the three adapter tests as
skipped. `npm test` invokes this script, so GitHub Actions always compiles and
tests the SDK-free signal and display logic while local development with Bookmap
installed exercises all five Java tests.

## Install and run

### Offline sweep evidence replay

`node bookmap-addon/replay.mjs CONFIG.json RAW.jsonl [RAW.jsonl ...]` builds
the Java detector and replays saved standard CME 6E schema-1.2 raw files.
The configuration explicitly supplies `minimumTrades`, `minimumLevels`,
`windowMs`, `episodeGapMs`, `horizonMs`, and `toleranceMs`; there are no
research defaults. Keep hypothesis configurations and results outside Git.

The dedicated sweep stream shares `updateSweep` with the chart detector but
does not lose sweeps to withdrawal display priority. It does not change the
existing chart signal selection. Trades before `snapshot_end` are excluded.
Research, display and offline replay share `nearest_integer_within_4_ulps_v1`:
an SDK price-level double is mapped to its nearest integer only within four
ULPs of that double. Genuine sub-tick prices, non-finite values and values
outside the signed-int range are rejected. The replay report records the
policy, normalized callbacks and rejected callbacks. Original raw bytes are
never rewritten; results from the earlier strict-integer adapter remain separate.
A rejected trade is not scored, but under `trade_without_price_level_breaks_run_v1`
a positive-size one still breaks a sweep's run, whatever its side, as a trade of
unknown direction does. On the chart stream, which the research recorder and the
display module both use, it also drops a withdrawal waiting for its trade when it
is on that side or of unknown direction, so recorded withdrawals follow the same
rule. Earlier builds skipped it, so a sell or unknown trade off the grid between
two buys could join them into one buy sweep. The replay report records
this as `sweep_continuity_policy`; results replayed without it remain separate.
After reloading the research JAR, new signal JSONL records expose
`price_level_policy: "nearest_integer_within_4_ulps_v1"` and
`sweep_continuity_policy: "trade_without_price_level_breaks_run_v1"` for
installation verification, and their `callback_sequence` also counts rejected trades.

Each file starts independent detector and position state. Do not use this
per-file utility to simulate overlapping sessions as one portfolio. Entry is
the first subsequent valid BBO within the configured tolerance; exit is the
first valid BBO at/after the holding horizon, within the same tolerance.
BUY uses ask/bid and SELL uses bid/ask for entry/exit respectively. Only the
first sweep per direction/episode may attempt entry. A missing exit blocks
further entries in that file. No quote is forward-filled.

Reports include raw/source/compiled-class hashes, exact settings, repeat-run
equality, per-signal endpoints and exclusion reasons. Available endpoints do
not prove continuous delivery, executable fills or profitability. Missing
commission and independent collection-continuity evidence still block a
validated execution backtest. This offline tool neither connects to Bookmap
nor places orders, and its replay adapter is not packaged into installable JARs.

1. In Bookmap, open `Settings` then API plug-in configuration.
2. Add `bushidoyasu_flow_collector_delayed_replay_v1_1.jar` and enable
   **Bushido Flow Collector** only for a delayed or Replay instrument.
3. Keep the cross-platform `~/.tradingview-mcp/bookmap-data` default, which the MCP server also reads by default, or configure a writable local directory and set `TRADINGVIEW_MCP_BOOKMAP_FLOW_DIRECTORY` to it for the server.
4. Confirm that a new JSONL file appears in the configured directory.
5. Disable the add-on before moving or deleting its output files.

## Confirm flow signals

Add `bushidoyasu_flow_signal_research_delayed_replay_v1_2.jar` alongside the
raw collector only on the same delayed or Replay instrument. After Bookmap
delivers `snapshot_end`, it creates a separate
`bookmap-flow-signals-<alias>-<timestamp>.jsonl` file in the configured output
directory. A `flow_signal` record contains `kind`, `direction`, `price_level`,
normalized `price`, callback sequence, episode start timestamp, duration,
trade count, price-level count, and aggressive volume.

With **Show chart markers** enabled, the same emitted signal also appears on
the Bookmap heatmap at its integer price level. A sweep uses green `BUY SWEEP`
or red `SELL SWEEP` to identify observed aggressor direction. Absorption uses
neutral `BUY ABSORBED` or `SELL ABSORBED` with `POSSIBLE ABSORPTION`; it does
not reverse that observation into a price forecast. Withdrawal uses neutral
`ASK WITHDRAWAL` or `BID WITHDRAWAL` with `POSSIBLE`. These labels describe
observed or provisional flow mechanics, not a trade recommendation or an
order. Sell sweep, absorption, and withdrawal use separate lanes above the
price so different mechanisms do not directly overlap; buy sweep remains
below the price. Disable the setting to keep JSONL recording without chart
markers. Multiple occurrences of the same mechanism at nearly the same time
and price can still overlap.

Withdrawal, absorption, and sweep windows are configured in milliseconds and use the
Bookmap `TimeListener` clock. They do not depend on a contract's trade
frequency or on the local wall clock, so Replay speed does not change the
market-time window. Callbacks received before the first Bookmap timestamp are
not eligible for a signal.

For a functional check rather than research, lower the add-on's thresholds in
the Bookmap configuration, observe one `flow_signal`, then restore the fixed
research thresholds before collecting evidence. The raw collector's JSONL is
the evidence to use when checking the corresponding depth, BBO, and trade
callbacks.

Bookmap may require an application restart after adding or updating an API
plug-in. Data availability, including aggressor-side and depth/MBO fidelity,
depends on the selected market-data connection and entitlement.

## BookmapData real-time boundary

This collector writes market data and derived data to local JSONL files. Per
Bookmap support, that is data exposure and is not permitted for a custom add-on
on BookmapData real-time instruments, even if the process is local and
read-only. Therefore
both `bushidoyasu_flow_collector_delayed_replay_v1_1.jar` and
`bushidoyasu_flow_signal_research_delayed_replay_v1_2.jar` are for delayed
BookmapData or Replay development only: do not add either to a Trading mode
instrument and do not submit either for real-time approval.

A compliant real-time custom add-on must keep all market and derived data
inside Bookmap. Such an add-on requires the Developer Agreement,
`@UnrestrictedData`, a unique JAR name, and Bookmap's server-side upload and
approval process. It must not write files, emit external signals, or otherwise
expose data outside the application until Bookmap and the exchanges explicitly
permit that use. When implemented after approval, it will be a separate JAR
with a different Bookmap module name and no dependency on `FlowCollector`.
