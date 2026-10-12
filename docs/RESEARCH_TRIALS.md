# Research Trials (`record_research_trials`, `check_research_trials`)

BACKLOG 103-4. A local, append-only record of how many configurations each study tried on which data. It gives the
deflated Sharpe ratio, the Reality Check and other multiple-testing corrections a written basis for their trial count.
It stores counts, never results: no metric, return, threshold or file path.

The record has the same shape as [research period usage](RESEARCH_PERIOD_USAGE.md): a stable `series_id` per data
series, a content hash for the data version, a canonical UTC interval `[from, to)`, and an append-only journal whose
records keep the order and the moment they were saved.

## What one record says

One record is one trial set: the configurations one study evaluated, as one block, on one data version over one
interval. "Configuration" is the unit the study counts in (for example method × parameters × symbol × bar resolution);
state it in the note. Count every configuration evaluated, the discarded ones included. Re-running the same
configurations later is a new record that names the earlier one in `reuses`.

## Record

`record_research_trials` takes `records`, 1 to 20 trial sets, and `confirm: true`. Each trial set:

| Field | Meaning |
|---|---|
| `trial_set_id` | A unique identifier for this trial set. Reuse it only for a retry |
| `research_id` | The study's identifier |
| `series_ids` | 1 to 20 distinct stable series identifiers the configurations were evaluated on |
| `data_version` | The SHA-256 content hash of the data, as in research period usage |
| `from`, `to` | The evaluated interval, canonical UTC, `from` before `to`, `to` exclusive |
| `tried_at` | When the configurations were evaluated, canonical UTC, not after the moment of recording |
| `configuration_count` | The number of configurations, an integer from 1 to 1,000,000 |
| `count_basis` | `enumerated` (each configuration was listed), `inferred` (computed from a stated design, such as 6 symbols × 3 thresholds) or `lower_bound` (some trials are known to be uncounted) |
| `outcome_seen` | `pnl` (returns or profit were evaluated), `forecast_only` (only forecast losses or scores were evaluated) or `none` (no outcome label was used) |
| `configuration_list_sha256` | Optional: the SHA-256 of the frozen list of configurations. Default: null |
| `reuses` | Optional: up to 20 `{ trial_set_id, configuration_count }`, the configurations of earlier trial sets this one evaluated again. Default: none |
| `note` | Optional: up to 500 characters. Default: empty |

Rules, all checked before anything is written:
- Every field is checked, and an unknown field is refused rather than ignored, also inside `reuses`.
- `trial_set_id` is unique within a call. A trial set already in the journal with the identical input is a retry: it
  is returned with `idempotent: true` and not written again. The same `trial_set_id` with any other input is refused.
- Each `reuses` entry names a trial set recorded earlier, in the journal or earlier in the same call, not the record
  itself, and each at most once. Its count is at most that trial set's `configuration_count`, and the counts of all
  entries add up to at most this record's `configuration_count`.
- `tried_at` is checked against the journal's own clock.
- A call that fails any rule writes nothing. If an I/O failure stops the append after complete lines, an identical
  retry completes it; a torn partial line fails closed until the file is repaired.

Each result is the stored record (with `sequence`, `recorded_at`, `first_seen_at` and `observation_date`), its
`idempotent` flag, and `prior_trials`: the counts of the check below over the trial sets recorded before it, for the
record's own series and interval. A retry reports the same `prior_trials` as the first write.

## Check

`check_research_trials` is read-only. It takes `series_ids` (1 to 20 distinct identifiers), `from` and `to`, and
`summary_only` (default false). A trial set matches when it shares at least one series identifier with the query and
its interval overlaps `[from, to)`. Adjacent intervals do not overlap. Every research ID and every data version counts.

| Field | Meaning |
|---|---|
| `status` | `recorded_trials` or `no_recorded_trials` |
| `matching_sets` | The number of matching trial sets |
| `configurations_reported` | The sum of their `configuration_count` |
| `configurations_reused_within` | The sum of the `reuses` counts whose trial set also matches |
| `configurations_net` | `configurations_reported` − `configurations_reused_within` |
| `by_count_basis` | `configurations_reported` split by `count_basis` |
| `by_outcome_seen` | `configurations_reported` split by `outcome_seen` |
| `distinct_data_versions` | The number of data versions among the matches |
| `research_ids` | Per research ID, sorted: the trial sets and configurations reported; at most 100, with `research_ids_truncated` |
| `matches` | The matching records in journal order, at most 100, with `truncated`. `summary_only` replaces them with `matches_omitted` |
| `total_is_lower_bound` | Always true: studies that were never recorded are missing |
| `limitations` | What the counts do not cover |

## What the counts are not

- Counts are reported by the caller. The tool authenticates nothing and never reads the data.
- Studies that were never recorded are missing, so every total is a lower bound, and no record is not evidence that
  no search was made.
- Configurations are not independent trials. A deflated Sharpe ratio or a multiple-testing correction should use an
  effective number (for example from the correlation of the configurations' returns), and the study's design decides
  which count to use. No tool takes these counts automatically.
- The overlap key is the caller's series identifiers and interval. Different identifiers for related series, aliases
  or derived data are not linked.
- `reuses` is declared by the caller; undeclared re-evaluations are counted twice.

## Storage

The journal is `~/.tradingview-mcp/research-trials.jsonl`, or the path in `TRADINGVIEW_MCP_RESEARCH_TRIALS_PATH`. It is
an owner-only, append-only JSONL file with the same file safety, locking and size limits (32 MiB, 16 KiB a record) as
the other first-seen journals. Records keep a contiguous `sequence`, and `recorded_at` equals `first_seen_at`; a clock
that moves backwards is refused.
