# Bushido Bookmap Flow Collector

Read-only Bookmap API add-on for recording a single instrument's observable
futures-market microstructure evidence as JSON Lines. It does not submit,
modify, or cancel orders, and it does not expose the data over a network.

## Captured evidence

- `instrument`: Bookmap alias, symbol, venue, type, tick/size multipliers,
  full-depth flag, crypto flag, raw feed-delay value and requested symbol at
  initialization. The collector explicitly records that its depth listener is
  price-level aggregated and that it does not capture MBO order identities.
- `trade`: price-level, normalized price, size, aggressor side, OTC flag, and
  execution start/end flags when Bookmap supplies `TradeInfo`. Every missing
  `TradeInfo` field is stored as `null`; aggressor is then `unknown`, never
  guessed as buy or sell.
- `depth`: incremental bid/ask book-level size updates.
- `bbo`: best bid/ask price-level and size updates.
- `collector_stop`: clean shutdown marker.

Each record has the latest Bookmap timestamp in nanoseconds when available and
the local receipt timestamp. `bookmap_time_ns` is the most recently received
`TimeListener` value, not a per-callback exchange timestamp; it can be `null`
before the first timestamp callback. Do not treat it as tick-exact ordering
evidence until the selected feed's callback ordering and timestamp semantics
have been measured. The add-on writes one append-only JSONL file per attached
instrument under `fxdata/bookmap-raw/`; this directory is already excluded
from Git.

The data represents the selected Bookmap feed and instrument only. For FX
research, use CME futures such as `6E`, `6J`, or `GC` as explicitly labelled
single-venue proxies; do not describe it as whole-market FX spot order flow.

## Build

```bash
bookmap-addon/build.sh
```

The script reads the locally installed Bookmap SDK from
`/Applications/Bookmap.app`. It creates
`bookmap-addon/dist/bushido-bookmap-flow-collector.jar`.

Run the no-dependency unit tests with:

```bash
bookmap-addon/test.sh
```

## Install and run

1. In Bookmap, open `Settings` then API plug-in configuration.
2. Add the generated JAR and enable **Bushido Flow Collector** for the intended
   futures instrument.
3. Keep the default output directory or configure a writable local directory.
4. Confirm that a new JSONL file appears in `fxdata/bookmap-raw/`.
5. Disable the add-on before moving or deleting its output files.

Bookmap may require an application restart after adding or updating an API
plug-in. Data availability, including aggressor-side and depth/MBO fidelity,
depends on the selected market-data connection and entitlement.
