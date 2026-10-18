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
   kept under a key of the environment (from the record's source URL host), the instrument and the exact range. Every
   collector version checkpoints a page that was final when read. A page with no forming candle that ended more than
   15 minutes and six hours before the record was made (a collection reads its pages within six hours) was final, so
   each such page must have a checkpoint under the record's key for its own page range and raw hash, or the record is
   refused. `range_checkpointed` says whether every page has one. A page that could still have been forming when read
   (it had a forming candle, or ended just before the collection, as a daily run's single page does) may have none:
   such a collection exports with `range_checkpointed: false`, and its range is checked only by its page count and
   its bars falling in their pages.

Any difference refuses the whole export, naming the manifest read. The manifest, its checkpoints and its run log are read together: by default all three are the
instrument's own files, and a directory at `TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH` is refused as the collector refuses
it. Errors name the manifest read, and a raw page that cannot be read is named by collection and page.

Identical reruns of a collection are not recorded again in the manifest (it keeps one record per normalized hash), so
the export lists each distinct content once, at the time it was first recorded. The run log (BACKLOG 103-5,
[daily FX history collection](FX_HISTORY_DAILY.md)) records every run; the export carries those runs (below). The run log
is read before the manifest, so every run read has its content recorded (a collection records its content before its
run). A run whose content the manifest does not hold, or whose bar count differs from that content's, refuses the export.
After the manifest the page checkpoints are read, once and whole, then the manifest and the run log again: when each
second read holds as many records as the first, neither log changed meanwhile, so the manifest, the run log (and the
totals below) and the checkpoints describe one moment, the one the checkpoints were read at; a checkpoint a later run
writes is not read. Otherwise all are read again, up to five times in all, and the export fails if collections kept
recording throughout. The totals count only the manifest and the run log: a later run of an identical range can add a
checkpoint that turns a collection's `range_checkpointed` true while they stay the same. The manifest holds each
content once; one that holds a content twice refuses the export. Every collection's source URL must name an OANDA host,
checked before any raw page is read.

## Usage

```bash
tradingview-mcp-export-fx-history --instrument USD_JPY --list
tradingview-mcp-export-fx-history --instrument USD_JPY --sequence 3 --sequence 4 --output usdjpy.json
tradingview-mcp-export-fx-history --instrument EUR_USD --all --output eurusd.json
tradingview-mcp-export-fx-history --instrument EUR_USD --all --split --output eurusd.json   # eurusd.part01.json, ...
tradingview-mcp-export-fx-history --instrument EUR_USD --sequence 2 --format bar-series --series-id oanda:EUR_USD:M15 \
  --evidence-tier historical_exploration --output eurusd-series.json
```

`npm run export:fx-history -- ...` runs the same CLI from a built checkout. `--instrument` is required and selects the
instrument's own manifest (`TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH` as for the collector). `--list` prints the manifest
path and the records without their bars: sequence, requested range, retrieval time, environment, pages, bar count,
first and last bar, normalized hash. Every argument, `--output` included (an existing directory, not a directory
itself), is checked before any raw page is read.

### The output directory

BACKLOG 103-11. The resolved directory of the output (of every part with `--split`) must be one no other user can swap
files in. On macOS and Linux an export refuses, before any raw page is read and writing nothing, a directory the group
or others can write to unless it has the sticky bit (as `/tmp` has), and a directory owned by neither you nor root. In
such a directory another user could rename the hidden staging directory the export writes in and put a symbolic link
in its place: the export would then create its files in, link files from, and remove files in the directory the link
names. Choose a directory only you can write to (`chmod go-w`), or one with the sticky bit. Within an accepted
directory the export still keeps each staging directory's identity from when it made it, checks it before it stages a
file there and before each link, checks the staged file before it is linked, and removes only the files it created, so
a staging directory swapped all the same is refused, not followed. The check is of the output's own directory: keep it
under directories only you (or root) can write to. Windows has neither owner nor mode here, so there the check is not
made, and the directory's access control list decides who can change it.

Choose collections with one or more `--sequence`, or `--all`; they are written in manifest order. At most 1,000,000
bars go into one export, checked before any raw response is read. A whole export over that goes into parts with
`--split` ([below](#whole-exports-in-parts---split)).

The output is published as a new immutable file: the same bytes already there is reported as `identical`, other bytes
are refused and left as they were. The command prints the output path, `created` or `identical`, the SHA-256 of the
file, the totals `manifest_records` and `run_records` with the number of `runs` exported, and each collection's
sequence, bar count, normalized hash and `range_checkpointed`.

## Formats

`--format collections` (the default) writes one JSON document:

```json
{ "schema_version": "1.1", "series": "fx_historical_m15_export", "source_id": "oanda_v20", "evidence_tier": "official_revised_history",
  "instrument": "EUR_USD", "canonical_symbol": "OANDA:EURUSD", "granularity": "M15", "price": "M", "manifest_records": 1, "run_records": 1,
  "collections": [{ "sequence": 1, "requested_from": "...", "requested_to": "...", "retrieved_at": "...",
    "source_url_template": "https://api-fxpractice.oanda.com/v3/accounts/{account}/instruments/EUR_USD/candles", "raw_sha256": ["sha256:..."],
    "normalized_sha256": "sha256:...", "bar_count": 4, "first_bar_at": "...", "last_bar_at": "...",
    "duplicate_timestamps_removed": 1, "non_contiguous_weekday_intervals": 0, "environment": "practice", "range_checkpointed": false,
    "bars": [{ "time": "2026-01-01T00:00:00.000Z", "open": 1.1, "high": 1.1004, "low": 1.0998, "close": 1.1002, "volume": 17 }] }],
  "runs": [{ "sequence": 1, "trigger": "manual", "environment": "practice", "requested_from": "...", "requested_to": "...", "started_at": "...",
    "retrieved_at": "...", "raw_sha256": ["sha256:..."], "normalized_sha256": "sha256:...", "bar_count": 4, "resumed_pages": 0,
    "unfinished_pages": 1, "manifest_recorded": true }] }
```

`manifest_records` and `run_records` are how many records the manifest and the run log held when the export read them,
at one moment (BACKLOG 103-9). An export is whole exactly when `collections` holds `manifest_records` entries and `runs`
holds `run_records`: a reader that needs every collection and run (a point-in-time reading does) checks both, which also
catches a cut-off tail that numbering alone cannot.

`schema_version` is `1.1` since 0.1.43, which added the two totals, and `part` in each part of a whole export split into
parts ([below](#whole-exports-in-parts---split)); a `1.0` export, written by 0.1.42, has neither total and cannot show
whether it is whole.

`runs` holds the instrument's recorded runs whose content is one of the exported collections, in run-log order. A run's
bars are the collection with its `normalized_sha256`; its own range, `trigger` (`daily` for the daily schedule, `manual`
otherwise) and finishing time are what a point-in-time reading uses. An instrument without a run log exports no runs.

The bars are exactly the collector's normalized bars (OANDA midpoint candles, the time of each candle's open in UTC with
milliseconds): their JSON array hashes to `normalized_sha256`. Nothing in the document depends on when the export ran,
so the same manifest, run log and page checkpoints give the same bytes. A record added to the manifest or the run log
changes them: a whole export (`--all`) gains the new collection or run, as it always did (a later run of the same
content adds a run), and since 1.1 a partial export (`--sequence`) changes too, even when its own collections and runs
do not, because its totals count the whole logs. A checkpoint alone can change them too: a later run of an identical
range can turn a collection's `range_checkpointed` true without changing the totals. The output is never overwritten,
so export again to a new name.

`--format bar-series` writes one collection, named by one `--sequence`, as the input of
`tradingview-mcp-import-bar-series`: `open_time` in Unix seconds, `close`, `interval_minutes` 15, `source_id` `oanda_v20`
and the collection's normalized hash as `source_sha256`. It holds at most 600,000 bars, the bar-series limit, checked
before any raw page is read. `--series-id` (1-120 of `A-Z a-z 0-9 _ . : -`, no reserved prefix) and `--evidence-tier`
are the caller's claim and are required; the file is checked to be importable before it is written. OANDA's history is
revised, not first-seen: `historical_exploration` fits a collection of the past, and `prospective` only a collection
made by the daily schedule during a declared forward period. A daily collection also holds its lookback weekdays, which
can predate the forward period; the bar series holds them all, so drop those bars before using it as prospective data. Joining several collections into one series is left to the
caller, since overlapping collections can differ.

## Whole exports in parts (`--split`)

BACKLOG 103-10. The daily collection with its default ten-weekday lookback, run twice a night, records a collection of
about 1,000 bars at every run (about 520 runs and 508,000 bars a year), so an instrument's manifest passes 1,000,000
bars in about two years, and a reader that
needs the whole record (every collection and every run, as a point-in-time reading does) can no longer have it in one
export. `--split`, which goes only with `--all` and `--format collections`, writes a whole export in as many parts as it
needs:

- the manifest, the run log and the page checkpoints are read once, at one moment, as for any export; the parts are
  planned from them before any raw page is read, and the whole may hold at most 20,000,000 bars, also checked before
  any raw page is read. Every part is built from this one reading (the raw archive is addressed by hash), so the parts
  describe one moment;
- each part holds at most 1,000,000 bars. The collections go whole, in manifest order, into consecutive parts: a part
  closes when the next collection would take it over 1,000,000 bars. A single collection over 1,000,000 bars is
  refused;
- each run goes into the part holding the collection that is its content, in run-log order within the part;
- the parts are `<output without .json>.part01.json`, `.part02.json`, ... (two digits, more when there are more than 99
  parts), beside `--output`, which itself is not written. A whole export of one part is still `part01`.

Each part is a complete export document with the header of the whole export, the same `manifest_records` and
`run_records` in every part, then `part`, which part of how many it is:

```json
{ "schema_version": "1.1", "series": "fx_historical_m15_export", "source_id": "oanda_v20", "evidence_tier": "official_revised_history",
  "instrument": "EUR_USD", "canonical_symbol": "OANDA:EURUSD", "granularity": "M15", "price": "M", "manifest_records": 1040, "run_records": 1052,
  "part": { "index": 1, "of": 2 }, "collections": [...], "runs": [...] }
```

The parts are written all together or not at all. A directory or a symbolic link at a part's path refuses the export
before any raw page is read. An export holds a lock beside the output, named after `part01` exactly,
`.<output name without .json>.part01.json.publish-lock`, from before it builds its first part until it ends, so the file
system's own sameness of names (case, Unicode normalisation) applies to the lock as to the parts. An output name too
long for that lock (and its takeover marker, below) within a file name's 255 bytes is refused: choose a shorter
`--output`. A second export to the same output while one runs is refused, writing nothing. The lock is written whole (a temporary file synced, then linked into place). A lock whose
process is gone, one naming no process that is a minute old, or one a day old is taken over, by one export at a time:
the export holds a takeover marker, `<lock>.takeover`, while it reads the lock again, moves it to a tombstone, checks
the tombstone is still that stale lock, removes it and places its own; an export that finds the marker held reads the
lock again instead. Only an export that stalls for more than 30 seconds in the middle of a takeover (its marker then
counts as stale) can move a newer export's lock aside for a moment; the lock checks then stop one of them, and nothing is
removed, so `part01` still means the whole set. Before the link phase, before it links `part01`, and before it removes
anything, an export checks that the lock is still its own, and stops if it was taken over. Where the directory denies
it the lock (made read-only, say), an export only confirms that every part is already there and identical, and writes
nothing; a part missing refuses it. On Windows, where a denied directory and a lock being deleted both report EPERM, a
re-run in a read-only directory retries for about two seconds and then fails, writing nothing, instead of confirming.

Then each part is built in turn, once, and only one part's bars are held at once: a part whose file already exists is
compared with it, and any other is written and synced to a staging file in a hidden directory beside the output,
`.publish-<output name without .json>-<tag>-<process id>-XXXXXX`, the tag a short hash of `part01`'s exact name, so
that the staging directories an export looks at are those of the exports its lock covers. A part that fails to build (a
raw page missing or not matching its hash, a page no checkpoint binds), or a file with other bytes at a part's path,
removes the files it staged, then the staging directory, and writes nothing, and says so; every file with other bytes
is named. A staging directory that is no longer the one the export made, or a staged file that is no longer the one it
wrote, stops the export the same way ([above](#the-output-directory)). Only when every
part is staged or found identical are the staged parts linked into place, `part01` last: the other parts are linked and
the directory synced, the parts found identical are checked to be so still, and then `part01` is linked and synced. Each
part is `created`, or `identical` when its file already held it. With the lock, `part01` there means that its whole set
was written, also when exports to one output run at once.

A step of linking that fails (a file with other bytes appearing at a part's path, a directory denied or full, a failed
sync) removes again what this run linked: `part01` first, with its directory synced, then the other parts in the
reverse of their order, each only while it is still the file this run staged. When `part01` cannot be removed, the
removal stops and the set stays published, whole; when its directory cannot be synced after its removal, the removal
stops there too and the other parts stay. When a `part01` is there that this run did not link, or the lock is no longer
this run's, nothing is removed. The error says which parts were removed, which were already gone, which another file
had replaced (left alone), and which stayed and why; parts found identical were not written by this run.

An export stopped by SIGINT, SIGTERM or SIGHUP first removes its staging files (so that a link still in flight fails),
then, in the same way, what it linked, then its lock, and ends by the signal; in a process that keeps its own listener
for the signal, the export ends instead with an error that it was interrupted. One killed outright (SIGKILL) leaves its
lock and its staging directory, and, if it was killed while taking a lock over, a takeover marker, a temporary lock
(`.<uuid>.publish-lock-new`) or a tombstone (`.<uuid>.publish-lock-stale`). The next export to the same output takes
the lock over, and the next takeover the marker; a temporary lock or tombstone of this user that is a day old is
removed. A lock, marker, temporary lock or tombstone is judged by its owner and size before it is read (BACKLOG
103-11): another user's, one larger than a lock (128 bytes) or one that cannot be opened is never read; such a file is
left alone, and at the export's own lock or marker path it refuses the export, writing nothing. The next export also
removes a staging directory of its own set when its process is gone or (except on Windows) it is older than a day,
but only one that is this user's (owned by the user, mode 0700) and holds nothing but numbered files: it renames it first, checks the renamed entry is still that directory, and removes its numbered files,
then the directory. Anything else, a directory of a running export, of another output, of another owner or mode, or
holding other files, is left alone. Windows reports neither owner nor mode here, so there a staging directory is
removed only once its process is known to be gone. A crash or power loss while the parts are being linked, or a removal
cut short, can leave some of `part02` onwards without `part01`. A later export to that name then finds a different file
there and refuses; the error calls such a part, one whose set is not all there, the debris of an interrupted export, to
be deleted.

The command prints the totals, the number of runs, each part's index, path, result, SHA-256, number of collections and
runs, and bars, and each collection's sequence, bar count, normalized hash, `range_checkpointed` and part.

A reader recombines the parts of one export so:

1. It starts from `<stem>.part01.json`, which is linked last, so it is there only when the whole set was written. It
   reads `part01`'s `part.of` files, `part01` to the last, and requires every one to have the same `part.of` and each
   `part.index` from 1 to `part.of` exactly once. Parts without a `part01` are not an export.
2. It requires every part to have the same header: `schema_version`, `series`, `source_id`, `evidence_tier`,
   `instrument`, `canonical_symbol`, `granularity`, `price`, `manifest_records` and `run_records`. Parts with other
   totals come from exports of other moments and are not mixed.
3. It joins the parts' `collections` in part order, which is manifest order, and their `runs`, sorted by `sequence`,
   which is run-log order, and requires the collections to be numbered 1 to `manifest_records` and the runs 1 to
   `run_records`, each exactly once. A run's content is a collection of its own part.

The result is the whole export: what `--all` without `--split` writes when it fits in 1,000,000 bars.
