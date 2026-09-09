# Research Period Usage

These tools maintain a local, append-only record of reported data access. They
help identify previously inspected periods; they never certify an unused OOS
period or approve a statistical candidate.

## Identity and Time

Use the same stable `series_id` for the same data series across research projects
and revisions. `data_version` is a SHA-256 content hash, not a new series identity.
Overlap checks include all research IDs and all versions of that series. Different
series IDs are not automatically reconciled; aliases, derived features and related
markets can carry information not captured by this exact identity check.

The interval is canonical UTC `[from, to)`: start inclusive, end exclusive.
Adjacent intervals do not overlap. Record the entire inspected interval,
including relevant lookbacks and outcome horizons, not only favorable trades or
the subset later selected. `accessed_at` is the reported actual access time;
the journal separately records when the report was saved. Late reporting cannot
create evidence that a declaration existed before an experiment.

## Record

`record_research_period_usage` requires:

- `access_id`: a unique identifier for one access report; reuse only for retries.
- `research_id`: an exploration namespace, not proof of a registered hypothesis.
- `series_id`, `data_version`, `from`, `to`, `accessed_at`.
- `purpose`: `exploration` or `validation`.
- `confirm: true`: explicitly authorizes the local write.

Both exploration and validation reveal information and count as prior use.
Identical retries do not create new accesses; reusing an access ID with changed
content fails. A genuine repeated inspection needs a new access ID. Historical
manual or external use can be reported with its actual access time. All reports
are user supplied, not independently observed browsing telemetry.

The returned `prior_overlap` refers to reports saved before this record, not
proof of what was known at its reported historical access time. Late reports
cannot retroactively establish that knowledge. Use the check tool for the
current full journal view.

## Check

`check_research_period_usage` accepts `series_id`, `data_version`, `from`, `to`
and optional `prior_usage_declaration` (`unknown` or `declared_unused`). The
declaration is a caller assertion, not proof or a way to override overlaps.
No recorded overlap is not equivalent to unused: earlier, omitted, external,
other-series and untracked accesses may exist. `unused_proven` remains false.

The check does not itself record an access, reserve the period, freeze a protocol
or enforce a backtest gate. A later check can differ after additional reports.
Initial integration is explicit reporting only; existing research tools do not
automatically record all data they expose. Check and report use as part of the
research workflow, but do not claim full coverage from this journal alone.

## Storage and Failure

Only bounded structured metadata is accepted, not raw market data, arbitrary
paths or executable expressions. Local storage uses the existing durable
append-only engine with file locking, validation and fsync. Corrupt records and
storage errors fail closed rather than returning an empty history. The journal
does not replace frozen hypothesis contracts or first-seen market evidence.
Identical retries re-sync the existing record and, where supported, its directory before success;
readable bytes alone do not confirm a previously failed durable write. A crash
can leave the shared lock behind. Recovery requires checking that no writer is
active; this version does not automatically reclaim stale locks.

The journal is private local state. It does not detect same-user tampering,
unreported access or deletion of the complete log. Do not reset or rename the
log to claim that an explored period is unused.

Default storage is `~/.tradingview-mcp/research-period-usage.jsonl`, capped at
32 MiB per file and 16 KiB per record. Matches are capped at 100 per response,
with the total overlapping-record count and an explicit truncation flag. Counts
are access reports, not unique dates or independent statistical observations.
