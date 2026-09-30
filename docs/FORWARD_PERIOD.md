# Forward Period Declarations

`declare_forward_period` records that one research ID intends to use a future period [from, to) on
some series only for the one evaluation whose frozen protocol hash it names. The server's local
clock stamps the record, which must be made at least 24 hours before `from`. Other studies then see
the declaration, and the accesses that overlap it, in the period usage check, the OOS preflight and
every usage record response.

A declaration is **evidence of recorded intent, not proof that the data stayed unused**. It reserves
nothing, approves nothing and gates no execution: no tool refuses to run and no access record is
refused. The one thing a declaration refuses is another declaration that overlaps it. Every response
lists what it cannot show (see [What a declaration cannot show](#what-a-declaration-cannot-show)).
The design and its review history are in [FORWARD_PERIOD_DESIGN.md](FORWARD_PERIOD_DESIGN.md); the
period usage ledger it builds on is in [RESEARCH_PERIOD_USAGE.md](RESEARCH_PERIOD_USAGE.md).

## Workflow

1. Freeze the evaluation protocol and take its SHA-256. Optionally register the hypothesis with
   `register_strategy_hypothesis` or `register_event_study_hypothesis`.
2. At least 24 h before the period starts, call `declare_forward_period` with every series the
   evaluation will read and the whole span it will read after `from`, outcome horizons included
   (see [Choosing the period](#choosing-the-period)).
3. Stay out of the period while it runs. Other studies' recorded accesses show up as counts on the
   declaration.
4. After the period ends, call `preflight_research_oos` with your `research_id` and exactly
   [from, `effective_to`), **once for every series**. Do this before evaluating: the evaluation's
   own usage record overlaps the period, and any recorded overlap blocks the preflight (rule 1).
5. If the answer is `review_required` with
   `declared_intent_without_recorded_usage_is_not_unused_evidence`, do the review it lists,
   evaluate, record the evaluation under the same `research_id`, and report the result whatever it
   is.

## Paths

The declarations live in their own append-only journal, never in the period usage ledger, so a
declaration is never counted as an access.

| Variable | Default | Used by |
|---|---|---|
| `TRADINGVIEW_MCP_FORWARD_PERIOD_JOURNAL_PATH` | `~/.tradingview-mcp/forward-period-declarations.jsonl` | every period usage path: the check, the preflight, record tools, observing tools, declare and shorten |
| `TRADINGVIEW_MCP_STRATEGY_RESEARCH_JOURNAL_PATH` | `~/.tradingview-mcp/strategy-research-journal.jsonl` | the `hypothesis` lookup when declaring |

The period usage ledger itself is always `~/.tradingview-mcp/research-period-usage.jsonl`.

**Every MCP server process must use the same journal value**, for example when both a desktop
client and a CLI agent run the server. Leave it unset everywhere, or set it identically everywhere,
as an absolute path: a relative value, or one starting with `~`, is resolved against each process's
working directory. Processes with different values share one ledger but not the declarations:
- one process's check and preflight do not see the other's declarations;
- exclusivity is enforced only within each journal.

A journal belongs to one ledger. Share it only between processes that also share the ledger, that
is, run under the same home directory. A process with another ledger reads the journal's anchors
against the wrong records and reports `forward_period_ledger_regressed`.

No CLI reads or writes the declarations journal. The server refuses to start when the journal
path resolves to the ledger's or the research journal's path, symlinked directories included. On
macOS and Windows the comparison ignores case, since their default file systems do.

The journal is owner-only, capped at 32 MiB per file and 16 KiB per line, and fsynced like the
ledger. Its lock is the file `<journal>.lock`.

## Declaring

`declare_forward_period` takes a strict input:

| Field | Content |
|---|---|
| `declaration_id` | 1–100 characters from `A-Z a-z 0-9 _ . : -`, unique in the journal. Declaration IDs have their own namespace, separate from access IDs. |
| `research_id` | The declaring study, 1–120 characters of the same set. It is caller-supplied and not authenticated. |
| `series_ids` | 1–20 unique exact series IDs, stored sorted. `ledger-source:` and `forecast-set-source:` IDs are allowed: they digest a stable `source_id`. `proxy-set-source:` is rejected, because a content-addressed proxy set never gains future data. |
| `from`, `to` | Canonical UTC timestamps (`2027-01-04T00:00:00.000Z`), start inclusive, end exclusive. `to` is at most `2100-01-01T00:00:00.000Z`. |
| `protocol_sha256` | `sha256:<64 lowercase hex>` of the frozen evaluation protocol, as the caller states it |
| `hypothesis` | Optional `{kind: "strategy" \| "event", id}`, the ID up to 80 characters |
| `confirm` | `true` |

The checks run in this order, and the first failure is the error:
1. **An existing `declaration_id`.** The same content (series compared sorted, the hypothesis by
   kind and ID) is an idempotent retry, even after the lead has passed or the declaration was
   shortened, and returns `idempotent: true`. Different content is
   `forward_period_declaration_id_conflict`.
2. **The hypothesis**, if given, must be registered in the research journal
   (`forward_period_hypothesis_not_registered`). Its definition hash, journal sequence and
   population are stored with the declaration.
   - A population of `in_sample` or `stress` is accepted but flagged
     `hypothesis_population_is_not_forward` on the declaration, wherever it is reported.
3. **Journal state:** `forward_period_journal_unavailable`, `forward_period_ledger_regressed` or
   `forward_period_clock_moved_backwards` (see [Failures and recovery](#failures-and-recovery)).
4. **The lead:** `from` must be at least 24 h after the server's clock
   (`forward_period_lead_too_short`).
5. **The length:** `to` − `from` must be at least 24 h (`forward_period_too_short`) and at most 366
   days (`forward_period_too_long`), both bounds inclusive.
6. **Exclusivity:** no active declaration may overlap [from, to) on any of the series
   (`forward_period_already_declared`, naming up to five series and declaration IDs). A part that is
   no longer declared (see [Shortening](#shortening)) does not count.
7. **Recorded usage:** no access in the ledger may overlap [from, to) on any of the series
   (`forward_period_has_recorded_usage`), whoever recorded it.

Step 1 reads the journal under the declarations lock alone, so `forward_period_journal_unavailable`
can also come first. Steps 3–7 run under the ledger lock and then the declarations lock, with one
clock reading that also becomes `recorded_at`. An idempotent retry is answered under both locks too,
so it can fail with the step 3 errors.

The response holds:
- `idempotent`;
- `declaration`: the stored fields, `recorded_at`, `lead_seconds` (whole seconds from
  `recorded_at` to `from`), `effective_to`, the number of `shortenings`, `shortened_after_start`,
  `late_shortening` and `state`;
- `related_declarations` (see [Reporting](#reporting));
- the ten limitations.

It never says the period is unused, reserved or approved.

### Choosing the period

- **Declare through the outcome horizons.** `to` must cover everything the evaluation reads after
  `from`. A protocol that opens trades until 30 June and holds each up to five days reads into July,
  so its `to` is at least 6 July. The preflight later needs exactly the declared period.
- **Lookbacks are not declared.** History before `from` (indicator warm-up, estimation windows)
  may already have been explored, and a declaration says nothing about it.
- **Timestamps are data labels.** `from` and `to` are the labels of the data, not the times it
  became observable. An FX daily bar labelled D opens the evening before, and a revised history can
  carry labels older than its publication. The lead is measured against the label.
- **Every series.** A declaration covers only the exact series IDs it names. Related markets,
  aliases and derived series are not linked.

## Shortening

`shorten_forward_period` takes `declaration_id`, `research_id`, `new_end`, a `reason` of 1–200
characters and `confirm: true`. From `new_end` on, the period is no longer declared. The earliest
`new_end` sets `effective_to`, and every line stays in the journal and in every report.

- `new_end` must be at least 24 h after the server's clock, below the current `effective_to`, and
  either exactly `from` or at least 24 h after `from`. So only a part that starts at least 24 h
  away can stop being declared, and a declaration never gets shorter than 24 h.
- `new_end` = `from` withdraws the declaration. That is possible until 24 h before `from`. A
  withdrawn period can be declared again only under a new `declaration_id`.
- A shortening is identified by (`declaration_id`, `new_end`). An identical retry is idempotent at
  any time.

The errors, in order:
1. `forward_period_shortening_conflict`: the same (`declaration_id`, `new_end`) exists with another
   `reason` or `research_id`. As for declaring, `forward_period_journal_unavailable` can come
   before it;
2. `forward_period_declaration_not_found`;
3. `forward_period_research_id_mismatch`;
4. the journal errors, as for declaring;
5. `forward_period_shortening_invalid`: `new_end` is not below the current end, is below `from`, or
   falls within the first 24 h after `from`;
6. `forward_period_lead_too_short`.

The response holds `shortening` (`declaration_id`, `new_end`, `recorded_at`, `reason`) and the same
fields as a declare response, with `idempotent` true for a retry.

**A late shortening costs the review answer.** A shortening recorded later than `from` − 24 h,
that is within the last 24 h before the start or after it, sets `shortened_after_start: true`.
`late_shortening` then gives the time and lead of the earliest such shortening. The flag closes one
path: declare, watch the data unrecorded, then cut the period off where the result looks good. For
such a declaration the preflight answers rule 4c, never 4d. The part no longer declared can still be
declared by other studies, with their own 24 h lead.

A mistaken declaration blocks other declarations for at most 366 days. Its tail from `from` + 24 h
on can stop being declared once it is at least 24 h away.

## Reporting

For a query on one series, a declaration on that series is **listed** when its original
[from, to) overlaps the query, so withdrawn declarations and parts no longer declared stay visible.
It is **active** when [from, `effective_to`) is non-empty and overlaps the query. Only active
declarations drive the preflight.

`forward_period_declarations` holds:
- `status: "available"`;
- `total`, `active`, `withdrawn` and `tail_only`, where `tail_only` counts declarations that are not
  withdrawn and overlap the query only in [`effective_to`, `to`). `total` = `active` + `withdrawn` +
  `tail_only`;
- `listed`: up to 20 entries, active ones first, then by `from`, then by `declaration_id`; and
  `truncated`.

Each entry holds:
- the stored fields: `declaration_id`, `research_id`, `series_ids`, `from`, `to`,
  `protocol_sha256`, `hypothesis` (with `hypothesis_population_is_not_forward`), `recorded_at` and
  `lead_seconds`;
- `effective_to`; `shortenings`, with a `total` and up to five listed, the most recent first (the
  one that set `effective_to` is always listed); `shortened_after_start` and `late_shortening`;
- `state`: `pending` before `from`, `running` until `effective_to`, then `ended`; or `withdrawn`;
- `accesses`: the ledger records on this series that overlap [from, `effective_to`):
  - `other_research`;
  - `declaring_research`, counted by the phase in which each was recorded (`before_start`, `during`,
    `after_end`), by purpose (`exploration`, `validation`), by source (`user_reported`,
    `tool_observed`), and `distinct_tool_requests`, the distinct request hashes among its tool
    records;
- `declaring_access_covers_declared_period`: some access by the declaring research, recorded at or
  after `effective_to`, covers all of [from, `effective_to`);
- `declaring_accesses_extending_outside_declared_period`: a count, descriptive rather than a fault
  (see [Observing tools](#observing-tools));
- `ended_without_declaring_research_access`: the period has ended and the declaring research
  recorded nothing in it on this series;
- `related_declarations`: the other declarations, in any state, on any series, with the same
  `research_id` or the same `protocol_sha256`. It gives a `total` and how many of them
  `ended_without_declaring_research_access` or were `shortened_after_start`. This shows a protocol
  split across months or aliases where only one part was evaluated.

These are counts, not verdicts. They appear in:
- **`check_research_period_usage`**, as of the server's clock;
- **`preflight_research_oos`**, in `usage`;
- **the full record responses** of `record_research_period_usage`,
  `record_research_period_usage_batch` and `summarize_backtest_ledger` (its `period_usage.record`):
  `prior_overlap.forward_period_declarations`, as of the record;
- **every usage record response**, those three and each of the `records` of
  `compare_forecast_losses` and `compute_realized_covariance`:
  `overlapped_forward_period_declarations: {status, total, by_relation, truncated, listed}`, the
  declarations active on the record's own interval, the new record included. Each listed entry has
  a `relation`: `other_research`, `declaring_research_exploration` or
  `declaring_research_validation`;
- **the `prior_overlap` summaries of `compare_forecast_losses` and `compute_realized_covariance`**
  (in their `search`): each `per_series` row gains
  `active_forward_period_declarations: {declared_by_this_research, declared_by_other_research}`,
  and the limitation `access_overlaps_a_declared_forward_period` is added when either is non-zero.
  These two tools carry no `forward_period_declarations` entries.

Whenever a declaration is listed, the ten limitations are added to that assessment's
`limitations`, and to the preflight's own.

**Record responses replay.** A record response describes the state as of its own record:
- only declaration and shortening lines written before it count;
- `state` is taken at its `recorded_at`;
- counts use the ledger up to and including it.

So an identical retry returns the same content, as the ledger promises. There are two exceptions.
A response that was `unavailable` can come back available on retry. A retry whose own read fails
is `unavailable`.

**Batches.** `record_research_period_usage_batch` puts the stored fields of each declaration once in
a top-level `forward_period_declarations_by_id`. Each result's entries keep everything else as of
that result, because results replay as of different records. With `summary_only`, the map is
omitted, and each `forward_period_declarations` becomes the counts plus `listed_declaration_ids`
and `truncated`.

## Preflight

`preflight_research_oos` takes an optional `research_id`, which `check_research_period_usage` does
not (the check rejects it, since its reports are the same for everyone). The contract is
`recorded_usage_oos_preflight_v2`. The rules run over every declaration active for the query, not
only the listed ones, and the first match wins:

| Rule | When | Status | Reason |
|---|---|---|---|
| 1 | a recorded access overlaps the query | `blocked` | `evaluation_period_has_recorded_usage` |
| 2 | an active declaration overlaps and no `research_id` was given | `blocked` | `evaluation_period_has_a_forward_period_declaration` |
| 3 | an active declaration by another research overlaps | `blocked` | `evaluation_period_declared_for_another_research` |
| 4a | the query is not exactly [from, `effective_to`) of one declaration | `blocked` | `evaluation_period_differs_from_declared_forward_period` |
| 4b | exact, but the period has not ended | `blocked` | `declared_forward_period_not_yet_ended` |
| 4c | exact, ended, and shortened after the start | `blocked` | `declared_forward_period_shortened_after_start` |
| 4d | exact, ended, and not shortened after the start | `review_required` | `declared_intent_without_recorded_usage_is_not_unused_evidence` |
| 5 | otherwise | `review_required` | `absence_of_usage_records_is_not_unused_evidence` |

4d is the best answer a declaration can give, and it still only asks for review. Its required
actions are:
- `confirm_the_evaluation_matches_protocol_sha256`;
- `record_the_evaluation_under_this_research_id`;
- `review_untracked_external_and_related_series_access`;
- `review_related_declarations`;
- `report_the_result_whatever_it_is`;
- when the hypothesis population is `in_sample` or `stress`,
  `report_under_the_registered_hypothesis_population_not_as_forward`. The response then also
  carries `hypothesis_population_is_not_forward: true` at the top level, which `summary_only` keeps.

Rule 5 with a `research_id` adds `no_active_forward_period_declaration_for_research_id: true`.
Withdrawn declarations and parts no longer declared never change the status.
`execution_allowed`, `candidateEligible` and `unused_proven` stay `false` in every case, and the
limitation `no_automatic_approval_path` replaces v1's `no_automatic_approval_path_in_v1`.

- **One series per call.** The preflight checks one series. A declaration's `series_ids` are in the
  response. Run the preflight for every series the evaluation reads.
- **4d cannot be undone.** Once a period has ended, `effective_to` cannot change, because `new_end`
  must be at least 24 h in the future.
- **Rule 3 is permanent.** Other studies' preflights stay blocked on an ended declared period for
  good, even when the declaring study never recorded an evaluation. The declaring study may have
  watched the data unrecorded, and the period was declared for it.
- **`research_id` is not authenticated.** Anyone can pass R and reach 4d for R's declaration. The
  answer describes R's declaration, not who asked.

## Observing tools

`summarize_backtest_ledger`, `compare_forecast_losses` and `compute_realized_covariance` record the
span they actually read, not the declared period:
- the ledger summary records the ledger's trade envelope, from the earliest entry to the latest exit
  plus one millisecond;
- the forecast-loss comparison records the evaluation window envelope;
- realized covariance records the bars read, which with `from_previous_endpoint` start at the
  previous day's endpoint bar.

So a declaring study's evaluation through these tools often extends outside the declared period,
and `declaring_accesses_extending_outside_declared_period` counts it. The observing tools always
record `exploration`. What separates an evaluation from a peek is therefore the number of distinct
analyses (`distinct_tool_requests`) and the phase in which each was recorded.

## What a declaration cannot show

`declare_forward_period` and `shorten_forward_period` always return these limitations. The check
and the preflight return them whenever a declaration is listed:

| Limitation | Meaning |
|---|---|
| `forward_declaration_is_intent_not_proof_of_unused_data` | A declaration records intent; the data may still have been seen |
| `declared_before_period_start_by_local_clock_only` | The lead is measured by this machine's clock. Nothing is timestamped by a third party, and the journal detects only a clock earlier than its last line. |
| `period_timestamps_are_data_labels_not_availability_times` | See [Choosing the period](#choosing-the-period) |
| `local_journal_is_private_state_not_tamper_evidence` | The same user can edit, replace or delete the files |
| `access_outside_the_ledger_is_not_detected` | Charts, other tools and unrecorded runs leave no record |
| `related_series_and_aliases_are_not_linked` | Only exact series IDs are compared |
| `does_not_reserve_the_data_or_block_viewing` | Nothing stops anyone from reading the period |
| `protocol_hash_is_caller_asserted` | The protocol's content is not checked |
| `research_id_is_caller_supplied_not_authenticated` | Anyone can act under any research ID |
| `declaration_does_not_bind_data_source_or_version` | The data source and version are not part of the declaration |

**Gaming paths the design discloses but cannot close:**
- peeking at a related series before declaring;
- watching live charts during the period;
- running an exploratory study under a fresh research ID;
- declaring many series to discourage others;
- splitting one protocol into several declarations and evaluating only one.
  `related_declarations` shows this only for exact protocol hashes, so a trivially varied protocol
  under a fresh research ID evades it;
- shortening another study's running declaration by passing its research ID, which sets that
  study's `shortened_after_start`. This is sabotage rather than gaming, and the same limitation
  covers it.

Shortening after the start is closed as a path to 4d, but not as a way to stop early. That stays
visible through `shortened_after_start`.

## Failures and recovery

Record paths never fail because of declarations. When the journal cannot be read, the access is
still appended, and every declaration-derived field becomes `{status: "unavailable", reason}`, with
no counts, because a zero would read as "no declarations". That covers:
- `overlapped_forward_period_declarations`;
- `prior_overlap.forward_period_declarations`;
- the `per_series` column.

The limitation `forward_period_declarations_unavailable` is added. Declare, shorten, the check and
the preflight fail closed instead, with the error in the table.

| Reason on record paths | Error elsewhere | Cause |
|---|---|---|
| `lock_timeout` | `forward_period_journal_unavailable` | The declarations lock was not acquired within 2 s |
| `lock_timeout_backoff`, with `retry_after_ms` | (the check and the preflight always try) | A lock timeout on this journal within the last 30 s |
| `journal_unreadable` | `forward_period_journal_unavailable` | A torn or invalid line, or an I/O error |
| `ledger_regressed` | `forward_period_ledger_regressed` | The ledger no longer holds the record a declarations line was anchored to |
| `clock_moved_backwards` | `forward_period_clock_moved_backwards` | The clock is earlier than the last declarations line |

**A stale declarations lock.** A crash can leave `<journal>.lock` behind. It holds a random token
and the owner's process ID, and it is never reclaimed automatically. Every acquisition of the
declarations lock waits at most **2 s**, queue included. `TV_MCP_HISTORY_LOCK_WAIT_MS` does not
change that wait, although it still governs the ledger's lock. While the lock is stale:
- each check or preflight waits 2 s and fails. It holds the ledger lock during that wait, so other
  ledger operations, in this and other processes, queue behind it;
- declare and shorten fail after 2 s at their first read, before taking the ledger lock;
- a record path waits 2 s, holding the ledger lock, and returns `lock_timeout`. Any lock timeout on
  the journal starts a 30 s back-off: record paths on that journal skip the read and return
  `lock_timeout_backoff` at once. This keeps a stale lock from adding 2 s to every queued ledger
  operation and pushing another process past the ledger's own wait.

To recover, confirm that no TradingView-MCP process is running, or that the process ID in the lock
file is not one of them, then delete the lock file.

**A torn line.** Reads require complete JSONL lines. Repair the file only after confirming that no
writer is active, as for the ledger. An empty journal file, which a crash or a full disk during the
first write can leave, holds no declarations, as a missing one does.

**A regressed ledger.** Each declarations line records how many ledger records existed when it was
written, and the access ID and time of the last of them. A ledger that is shorter than that count,
or holds another record at that position, was reset, truncated, replaced or restored from an older
copy, which could erase accesses inside a declared period. Record paths keep appending meanwhile,
but regrowing past the count never clears the error: the record at that position stays wrong.
- Restore the ledger that holds the anchored records. The error then clears.
- Do not move or delete the declarations journal to clear it: that erases the declarations too, and
  is the kind of reset this check exists to catch.
- If the ledger cannot be restored, the check, the preflight, declare and shorten stay unavailable.
  Moving both files aside together is then the only way to resume. Keep them, and treat every
  period they covered as used.

The check covers the ledger up to each declarations line. Accesses recorded after the last line
can still be erased undetected, like any deletion from the ledger
(`local_journal_is_private_state_not_tamper_evidence`).

**A backward clock.** Correct the system clock. The error clears once the clock passes the last
line's `recorded_at`. The ledger's own clock check runs first.

## Performance

`node scripts/benchmark-forward-period.mjs` (after `npm run build`) uses 10,000 ledger records and
200 declarations (50 series, four each). On the development machine:
- the check and the preflight on a series with four declarations took about 65 ms each;
- declaring took about 73 ms;
- a record response took about 5 ms longer than on a ledger with no declarations file, counting the
  lock round trip.

The plan's targets are 200 ms for the check and the preflight, 300 ms for declaring, and 100 ms of
added cost on a record. The times depend on the machine and its load; a run beside other test
processes took about 100–120 ms for the check, the preflight and declaring. The benchmark is
outside the unit suite, so tests never depend on timing.

## Downgrading

A version before 0.1.16 never reads the declarations journal:
- it keeps recording accesses normally;
- its check and preflight show no declarations, and its preflight is contract v1;
- after an upgrade every count is recomputed from both files, so nothing is lost.

Accesses recorded under an older version are still in the ledger, so they still count against
declarations after the upgrade.
