# Research Trials (`record_research_trials`, `check_research_trials`)

BACKLOG 103-4. A local, append-only record of how many configurations each study tried on which data. It gives the
deflated Sharpe ratio, the Reality Check and other multiple-testing corrections a written basis for their trial count.
It is meant for counts, never results: it has no field for a metric, return, threshold or file path. The one free-text
field, `note`, cannot be checked; keep results and paths out of it.

The record has the same shape as [research period usage](RESEARCH_PERIOD_USAGE.md): a stable `series_id` per data
series, a content hash for the data version, a canonical UTC interval `[from, to)`, and an append-only journal whose
records keep the order and the moment they were saved.

## What one record says

One record is one trial set: the configurations one study evaluated, as one block, on one data version over one
interval. "Configuration" is the unit the study counts in (for example method × parameters × symbol × bar resolution);
the study's own documents should define it. Count every configuration evaluated, the discarded ones included.

Evaluating configurations again (for example the next fold of a walk-forward, or a later data version) is a new record
that names, in `reuses`, the trial sets where those configurations were first evaluated. Record trial sets in the
order they were tried: a re-evaluation recorded before its origin cannot name it, the journal cannot be corrected,
and its configurations are counted twice. A record's configurations
are its reused ones plus the ones it evaluated first: `configuration_count` minus the sum of its `reuses`. Naming the
origin, not the latest re-evaluation, gives every configuration one origin, which the check's net count rests on.

## Record

`record_research_trials` takes `records`, 1 to 20 trial sets, and `confirm: true`. Each trial set:

| Field | Meaning |
|---|---|
| `trial_set_id` | A unique identifier for this trial set. Reuse it only for a retry |
| `research_id` | The study's identifier |
| `series_ids` | 1 to 20 distinct stable series identifiers the configurations were evaluated on |
| `data_version` | The SHA-256 content hash of the data, as in research period usage |
| `from`, `to` | The evaluated interval, canonical UTC, `from` before `to`, `to` exclusive |
| `tried_at` | When the configurations were evaluated, canonical UTC, after `from` and not after the moment of recording |
| `configuration_count` | The number of configurations, an integer from 1 to 1,000,000 |
| `count_basis` | `enumerated` (each configuration was listed), `inferred` (computed from a stated design, such as 6 symbols × 3 thresholds) or `lower_bound` (some trials are known to be uncounted) |
| `outcome_seen` | `pnl` (returns or profit were evaluated), `forecast_only` (only forecast losses or scores were evaluated) or `none` (no outcome label was used) |
| `configuration_list_sha256` | Optional: the SHA-256 of the frozen list of configurations. Default: null |
| `reuses` | Optional: up to 20 `{ trial_set_id, configuration_count }`, the configurations this trial set evaluated again and the trial sets where they were first evaluated. Default: none |
| `note` | Optional: up to 500 characters of free text, for example the unit counted. Default: empty |

Rules, all checked before anything is written:
- Every field is checked, and an unknown field is refused rather than ignored, at the top level, in a trial set and
  inside `reuses`.
- `series_ids` and `reuses` are sets: they are stored sorted (`reuses` by `trial_set_id`).
- `trial_set_id` is unique within a call. A trial set already in the journal with the identical input (after the
  defaults and the sorting) is a retry: it is returned with `idempotent: true` and not written again. The same
  `trial_set_id` with any other input is refused.
- Each `reuses` entry names, at most once, a trial set recorded earlier, in the journal or earlier in the same call,
  not the record itself. That trial set shares at least one series identifier with this one and was tried no later.
  The count is at most the configurations that trial set evaluated first, and the counts of all entries add up to at
  most this record's `configuration_count`.
- `tried_at` is checked against the journal's own clock.
- A call that fails any rule writes nothing. If an I/O failure stops the append after complete lines, an identical
  retry syncs the journal again and completes it; a torn partial line fails closed until the file is repaired.

Each result is the stored record (with `sequence`, `recorded_at`, `first_seen_at` and `observation_date`), its
`idempotent` flag, and `prior_trials`: the check below, in its `summary_only` form, over the trial sets recorded before
it, for the record's own series and interval. A retry reports the same `prior_trials` as the first write.

## Check

`check_research_trials` is read-only. It takes `series_ids` (1 to 20 distinct identifiers), `from` and `to`, and
`summary_only` (default false); an unknown field is refused. A trial set matches when it shares at least one series
identifier with the query and its interval overlaps `[from, to)`; adjacent intervals do not overlap. A matching trial
set counts in full, even when it also covers series the query does not name. Every research ID and every data version
counts.

| Field | Meaning |
|---|---|
| `scope`, `series_ids`, `from`, `to` | `recorded_trial_reports`, and the query |
| `status` | `recorded_trials` or `no_recorded_trials` |
| `matching_sets` | The number of matching trial sets |
| `configurations_reported` | The sum of their `configuration_count` |
| `configurations_new_within` | The sum of the configurations each match evaluated first |
| `configurations_reused_from_outside` | For each trial set outside the matches that a match reuses, the largest such reuse, summed |
| `configurations_net` | `configurations_new_within` + `configurations_reused_from_outside` |
| `by_count_basis` | `configurations_reported` split by `count_basis` |
| `by_outcome_seen` | `configurations_reported` split by `outcome_seen` |
| `distinct_data_versions` | The number of data versions among the matches |
| `research_ids` | Per research ID, sorted: the trial sets and configurations reported; at most 100, with `research_ids_truncated` |
| `matches` | The matching records in journal order, at most 100, with `truncated`. `summary_only` replaces them with `matches_omitted` |
| `total_is_lower_bound` | Always true: studies that were never recorded are missing |
| `limitations` | What the counts do not cover |

`configurations_net` counts each configuration once when the reuses are declared: the matches' own first evaluations,
and, for a trial set outside the matches, the largest number any match took from it. Matches reusing one trial set may
have taken different configurations, so the net is a lower bound of the distinct configurations. It never exceeds
`configurations_reported`, and it never falls when the query widens.

## Reading the journal

Every read checks the whole journal and fails closed when a record breaks a rule: JSONL framing (a final newline, no
blank line), the record size, the schema, a contiguous `sequence`, a first-seen clock that never moves backwards,
`recorded_at` equal to `first_seen_at`, `tried_at` not after `recorded_at`, a duplicate `trial_set_id`, or a `reuses`
entry that breaks the rules above against the records before it. A journal whose last record was saved after the
store's clock reading is refused. An empty regular file, as a first append that failed after creating it leaves, is
an empty journal; a symbolic link, a FIFO or any other kind of file is refused without being waited on.

## What the counts are not

- Counts are reported by the caller. The tool authenticates nothing and never reads the data.
- Studies that were never recorded are missing, so every total is a lower bound, and no record is not evidence that
  no search was made.
- Configurations are not independent trials. A deflated Sharpe ratio or a multiple-testing correction should use an
  effective number (for example from the correlation of the configurations' returns), and the study's design decides
  which count to use. No tool takes these counts automatically.
- The overlap key is the caller's series identifiers and interval. Different identifiers for related series, aliases
  or derived data are not linked.
- `reuses` is declared by the caller; undeclared re-evaluations, and re-evaluations recorded before their origin, are
  counted twice.
- `note` is free text the tool cannot check.

## Storage

The journal is `~/.tradingview-mcp/research-trials.jsonl`, or the path in `TRADINGVIEW_MCP_RESEARCH_TRIALS_PATH`. It is
an owner-only, append-only JSONL file with the same file safety, locking and size limits (32 MiB, 16 KiB a record) as
the other first-seen journals.
