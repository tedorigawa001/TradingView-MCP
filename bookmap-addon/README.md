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
instrument under `/Volumes/HD/bookmap_data`; this external-data directory is
not part of Git. Set `TRADINGVIEW_MCP_BOOKMAP_FLOW_DIRECTORY` for the MCP
server when using another location.

The data represents the selected Bookmap feed and instrument only. For FX
research, use CME futures such as `6E`, `6J`, or `GC` as explicitly labelled
single-venue proxies; do not describe it as whole-market FX spot order flow.

## Build

```bash
bookmap-addon/build.sh
```

The script reads the locally installed Bookmap SDK from
`/Applications/Bookmap.app`. It creates two delayed/Replay-only JARs:

- `bookmap-addon/dist/bushidoyasu_flow_collector_delayed_replay_v1_1.jar`:
  raw evidence collector.
- `bookmap-addon/dist/bushidoyasu_flow_signal_research_delayed_replay_v1_0.jar`:
  provisional flow-signal recorder.

This artifact deliberately contains `FlowCollector` only. The pure research
class `FlowSignalEngine` is packaged only into the signal-research JAR. The
two JARs cannot contain one another's Bookmap module. No display-only
real-time JAR exists yet.

Run the no-dependency unit tests with:

```bash
bookmap-addon/test.sh
```

## Install and run

1. In Bookmap, open `Settings` then API plug-in configuration.
2. Add `bushidoyasu_flow_collector_delayed_replay_v1_1.jar` and enable
   **Bushido Flow Collector** only for a delayed or Replay instrument.
3. Keep `/Volumes/HD/bookmap_data` or configure a writable local directory.
4. Confirm that a new JSONL file appears in the configured directory.
5. Disable the add-on before moving or deleting its output files.

## Confirm flow signals

Add `bushidoyasu_flow_signal_research_delayed_replay_v1_0.jar` alongside the
raw collector only on the same delayed or Replay instrument. After Bookmap
delivers `snapshot_end`, it creates a separate
`bookmap-flow-signals-<alias>-<timestamp>.jsonl` file in the configured output
directory. A `flow_signal` record contains `kind`, `direction`, `price_level`,
normalized `price`, callback sequence, episode start timestamp, duration,
trade count, price-level count, and aggressive volume.

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
`bushidoyasu_flow_signal_research_delayed_replay_v1_0.jar` are for delayed
BookmapData or Replay development only: do not add either to a Trading mode
instrument and do not submit either for real-time approval.

A compliant real-time custom add-on must keep all market and derived data
inside Bookmap. Such an add-on requires the Developer Agreement,
`@UnrestrictedData`, a unique JAR name, and Bookmap's server-side upload and
approval process. It must not write files, emit external signals, or otherwise
expose data outside the application until Bookmap and the exchanges explicitly
permit that use. When implemented after approval, it will be a separate JAR
with a different Bookmap module name and no dependency on `FlowCollector`.
