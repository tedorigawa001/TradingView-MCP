# FX History Export (`tradingview-mcp-export-fx-history`)

BACKLOG 103-6. Writes OANDA M15 collections made by `npm run collect:fx-history` to a file a research runner, or
`tradingview-mcp-import-bar-series`, can read. Nothing is fetched: every collection is rebuilt from the raw responses
the collector archived and checked against the collector's own manifest record before anything is written.

## What is checked

A collection's manifest record names its requested range `[requested_from, requested_to]` and the SHA-256 of one raw
response per page, in order. The export:

1. derives the pages from the range as the collector does (4,000 candles each, the last one shorter; each page's end is
   the next page's start, so the candle there is read twice) and requires one raw hash per page;
2. reads each raw response from the archive (`TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH`, by default
   `~/.tradingview-mcp/fx-history-raw`), which refuses a file that is not owner-only or does not match its hash, and
   checks the hash again;
3. parses and accumulates the pages with the collector's own code: complete candles only, each in its page and in time
   order, a candle read twice kept once and refused if it changed;
4. requires the rebuilt normalized hash, bar count, first and last bar, duplicates removed and irregular weekday gaps to
   equal the record's;
5. binds the requested range with the page checkpoints beside the manifest. The raw responses do not say which range
   they answered: any range with the same page count, under which each page's bars still fall in its page, rebuilds
   the same bars (a range moved earlier, an end moved in or out, a whole range shifted by hours). The checkpoints are
   kept under a key of the environment (from the record's source URL host), the instrument and the exact range, so a
   checkpoint under the record's key holding one of its pages with that page's raw hash binds both ends. Every
   collector version checkpoints a page that was final when read. A page with no forming candle that ended more than
   15 minutes and an hour before the record was made (a collection reads its pages within an hour) was final, so a
   record with such a page and no matching checkpoint is refused. A record whose pages could all still have been
   forming, such as a range ending just before it was collected, may have no checkpoint; it is exported with
   `range_checkpointed: false`.

Any difference refuses the whole export. The manifest and its checkpoints are read together: by default both are the
instrument's own files, and a directory at `TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH` is refused as the collector refuses
it. Errors name the manifest read, and a raw page that cannot be read is named by collection and page.

Identical reruns of a collection are not recorded again (the manifest keeps one record per normalized hash), so the
export lists each distinct content once, at the time it was first recorded.

## Usage

```bash
tradingview-mcp-export-fx-history --instrument USD_JPY --list
tradingview-mcp-export-fx-history --instrument USD_JPY --sequence 3 --sequence 4 --output usdjpy.json
tradingview-mcp-export-fx-history --instrument EUR_USD --all --output eurusd.json
tradingview-mcp-export-fx-history --instrument EUR_USD --sequence 2 --format bar-series --series-id oanda:EUR_USD:M15 \
  --evidence-tier historical_exploration --output eurusd-series.json
```

`npm run export:fx-history -- ...` runs the same CLI from a built checkout. `--instrument` is required and selects the
instrument's own manifest (`TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH` as for the collector). `--list` prints the manifest
path and the records without their bars: sequence, requested range, retrieval time, environment, pages, bar count,
first and last bar, normalized hash. Every argument is checked before any raw page is read.

Choose collections with one or more `--sequence`, or `--all`; they are written in manifest order. At most 1,000,000
bars go into one export, checked before any raw response is read.

The output is published as a new immutable file: the same bytes already there is reported as `identical`, other bytes
are refused and left as they were. The command prints the output path, `created` or `identical`, the SHA-256 of the
file and each collection's sequence, bar count and normalized hash.

## Formats

`--format collections` (the default) writes one JSON document:

```json
{ "schema_version": "1.0", "series": "fx_historical_m15_export", "source_id": "oanda_v20", "evidence_tier": "official_revised_history",
  "instrument": "EUR_USD", "canonical_symbol": "OANDA:EURUSD", "granularity": "M15", "price": "M",
  "collections": [{ "sequence": 1, "requested_from": "...", "requested_to": "...", "retrieved_at": "...",
    "source_url_template": "https://api-fxpractice.oanda.com/v3/accounts/{account}/instruments/EUR_USD/candles", "raw_sha256": ["sha256:..."],
    "normalized_sha256": "sha256:...", "bar_count": 4, "first_bar_at": "...", "last_bar_at": "...",
    "duplicate_timestamps_removed": 1, "non_contiguous_weekday_intervals": 0, "environment": "practice", "range_checkpointed": true,
    "bars": [{ "time": "2026-01-01T00:00:00.000Z", "open": 1.1, "high": 1.1004, "low": 1.0998, "close": 1.1002, "volume": 17 }] }] }
```

The bars are exactly the collector's normalized bars (OANDA midpoint candles, the time of each candle's open in UTC with
milliseconds): their JSON array hashes to `normalized_sha256`. Nothing in the document depends on when the export ran,
so the same records always give the same bytes.

`--format bar-series` writes one collection, named by one `--sequence`, as the input of
`tradingview-mcp-import-bar-series`: `open_time` in Unix seconds, `close`, `interval_minutes` 15, `source_id` `oanda_v20`
and the collection's normalized hash as `source_sha256`. It holds at most 600,000 bars, the bar-series limit, checked
before any raw page is read. `--series-id` (1-120 of `A-Z a-z 0-9 _ . : -`, no reserved prefix) and `--evidence-tier`
are the caller's claim and are required; the file is checked to be importable before it is written. OANDA's history is
revised, not first-seen: `historical_exploration` fits a collection of the past, and `prospective` only a collection
made by the daily schedule during a declared forward period. Joining several collections into one series is left to the
caller, since overlapping collections can differ.
