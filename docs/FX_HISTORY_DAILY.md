# Daily FX History Collection (`tradingview-mcp-collect-fx-daily`)

BACKLOG 103-5. Collects OANDA M15 midpoint candles every night with `collect:fx-history`'s collector and records each run,
so a forward study can later rebuild what data was in hand at any moment. It uses the collector's manifest, checkpoints
and raw archive (see the README's FX history paragraph) and adds a run log beside them.

## The run log

Every successful run through `npm run collect:fx-history` or the daily CLI appends one record to the instrument's run
log, `<manifest>.runs` (for EUR_USD `~/.tradingview-mcp/fx-history-m15-manifest.jsonl.runs`, for USD_JPY
`fx-history-m15-manifest.USD_JPY.jsonl.runs`). A record holds:

- `trigger`: `daily` for a run of the daily CLI, `manual` for `collect:fx-history`;
- `started_at`, and `retrieved_at`: when the run finished, after its last page was read (also `first_seen_at`);
- `requested_from`, `requested_to` and `environment`;
- `raw_sha256` (one per page, in order) and `normalized_sha256`, which names the manifest record holding the bars;
- `bar_count`, `first_bar_at`, `last_bar_at`, `resumed_pages`, `unfinished_pages`, and `manifest_recorded` (false when
  the manifest already held this content).

A run with the same content as an earlier one is recorded too: the manifest keeps one record per content, the run log
one per run. The log is append-only, owner-only JSONL like the manifest; a record with any other field, or whose raw
pages or bars do not fit its requested range, fails closed.

A run reads its run log before it fetches anything, so a broken log fails the run first, and a run whose clock is behind
the latest recorded run is refused there. The manifest, the page checkpoints and the run log each refuse, without
writing, a record stamped before their latest one (BACKLOG 102-36): a clock that moved back during a run, or two runs of
the same instrument at once of which the later-stamped recorded first. A refused or failed run writes no run record,
but what it wrote before (raw pages, checkpoints, and its manifest record if it got that far) stays; a later run resumes
from the checkpoints. Run one collection of an instrument at a time.

`tradingview-mcp-export-fx-history` exports, with the collections, the runs whose content they are (see
[FX history export](FX_HISTORY_EXPORT.md)). Daily runs pass 1,000,000 bars in an instrument's manifest in about two
years (about 520 runs of about 1,000 bars a year); `--all --split` then exports the whole record in parts.

## The daily run

```bash
tradingview-mcp-collect-fx-daily --instrument EUR_USD --instrument USD_JPY --confirm-external-fetch
npm run collect:fx-daily -- --instrument EUR_USD --instrument USD_JPY --lookback-weekdays 10
```

It reads `OANDA_FX_HISTORY_ACCOUNT_ID` and `OANDA_FX_HISTORY_ACCESS_TOKEN` from the environment, as the collector does,
and collects each named instrument in turn over one range:

- **from** the start of the session of the weekday `--lookback-weekdays` weekdays (1 to 20, default 10) before the
  current trading day. A trading day runs from 17:00 New York time the day before to 17:00 (daylight saving followed),
  so a run on Sunday evening New York time is in Monday's, and with 1 covers Friday's session whole. Ten weekdays
  reach back over the year-end holidays; holidays are not skipped, only weekends.
- **to** the open of the last candle that closed at least a minute ago (OANDA's ranges include their end, so that
  candle is returned), so every page is final when read (BACKLOG 102-12) even when the run starts on a 15-minute
  boundary. A session counts as covered whole from its start to its last candle, which opens 15 minutes before its end;
  the sessions listed are the lookback weekdays before the trading day that the last candle's end falls in.

An instrument that fails does not stop the others. The command prints the range, the sessions covered and one result per
instrument, and exits 1 if any instrument failed. With 10 weekdays one run reads about 1,000 candles per instrument, in
one page of roughly 130 KB that the raw archive keeps.

## The schedule and its check

The [daily collection example](launchd/com.tradingview-mcp.fx-history-daily-collection.plist.example) runs Monday to
Friday at 08:30 and 13:00 JST: both fall on Sunday to Thursday nights between 17:15 and 08:00 New York time, in winter
and summer.

Keep the OANDA token out of the plist. `launchctl setenv` would hand it to every process launchd starts for you and is
lost at reboot. The example runs a small owner-only wrapper script that reads the two values from the login Keychain and
runs the CLI with the plist's arguments:

```bash
#!/bin/sh
# ~/bin/tradingview-mcp-fx-daily (chmod 700). Store the values once with:
#   security add-generic-password -s tradingview-mcp-oanda -a account-id -w
#   security add-generic-password -s tradingview-mcp-oanda -a access-token -w
OANDA_FX_HISTORY_ACCOUNT_ID=$(security find-generic-password -s tradingview-mcp-oanda -a account-id -w) || exit 1
OANDA_FX_HISTORY_ACCESS_TOKEN=$(security find-generic-password -s tradingview-mcp-oanda -a access-token -w) || exit 1
export OANDA_FX_HISTORY_ACCOUNT_ID OANDA_FX_HISTORY_ACCESS_TOKEN
exec /ABSOLUTE/PATH/TO/node /ABSOLUTE/PATH/TO/node_modules/bushido-tradingview-mcp/build/fxHistoryDailyCli.js "$@"
```

`tradingview-mcp-health --scope fx-history --instrument EUR_USD ...` checks each named instrument's run log against the
latest deadline at or before the check: 08:00 New York time on a Monday to Friday. It reads the log as a forward study
does, by the last daily run before the deadline (manual runs do not count): that run must have finished after 17:15
New York time the day before, requested the session of the weekday before the deadline's day whole (from its start to
its last candle), and left no page unfinished. No daily run at all is `fx_history_collection_missing`; otherwise a miss
is `fx_history_collection_stale`. The run log orders daily and manual runs alike and refuses a run that starts before
the latest one finished, so the latest run of either trigger, stamped more than a minute after the check read the run
log by a clock that ran ahead and was then set back, holds off every later run until the clock reaches it: the
instrument's `latest_recorded_run_at` and `latest_recorded_trigger` name that run, `latest_in_future` is true, and the
issue is `fx_history_clock_ahead`, with the run's `trigger` and its age in hours, negative and rounded away from zero
to 0.01 hour (BACKLOG 102-36 review). It is reported in place of a missing or stale daily run, since a manual run
stamped ahead may stand before any daily run at all (until 0.1.43 only a daily run was looked at, and a manual one
showed only as a miss at the next deadline; BACKLOG 103-11). Setting the clock right does not clear it: a run stamped
ahead also stamped its page checkpoints and its manifest record, which refuse later ones the same way. Once the clock
is right, `tradingview-mcp-repair-first-seen --store fx-history --instrument EUR_USD` prints, for the instrument's run
log, manifest and page checkpoints, which tail of records is stamped more than a minute ahead, changing nothing; with
`--apply --force` it moves those tails, runs first, to owner-only sidecars `<log>.ahead-<time>.jsonl` and rewrites
each log without its tail, so the next run records. `--force` is needed because exports already written cite the moved
sequences (`collections[].sequence`, `runs[].sequence` and the totals), and the next records take those sequences
again. It refuses when a kept run would name content only a moved manifest record holds, or a kept record lose a
checkpoint. `--scope all` does not include this check, which needs its instruments named. The [health example](launchd/com.tradingview-mcp.collection-health-fx-history.plist.example) runs at 22:30 JST
on Monday to Friday, after each deadline, and notifies.
