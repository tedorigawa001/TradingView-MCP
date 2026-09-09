# Saved Backtest Ledgers

`summarize_backtest_ledger` reads a registered immutable local artifact. It does
not contact TradingView or alter a chart. An optional `research_id` enables local
slice exploration logging; without it the tool remains read-only. Research strategies and data remain
local; this repository publishes only the generic import and aggregation code.

## Import

After building a checkout:

```sh
npm run import:backtest-ledger -- --input /absolute/path/normalized.json --confirm-local-import
```

The installed npm package also exposes `tradingview-mcp-import-ledger` with the
same arguments. The command returns `artifact_id` and record count. Repeat imports
of the same normalized content return the same ID without replacing evidence.

Default storage: `~/.tradingview-mcp/backtest-ledgers`. To choose another private
directory, set `TRADINGVIEW_MCP_BACKTEST_LEDGER_DIRECTORY` identically for the CLI
and MCP process. Changing the server environment requires a restart.

## Input Contract

```json
{
  "schema_version": "1.0",
  "source_id": "example-run",
  "source_sha256": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "evidence_tier": "synthetic_test",
  "return_unit": "direction_adjusted_gross_bps",
  "trades": [
    {
      "trade_id": "trade-1",
      "symbol": "EURUSD",
      "direction": "long",
      "entry_at": "2024-01-01T00:00:00.000Z",
      "exit_at": "2024-01-01T04:00:00.000Z",
      "gross_return_bps": 10
    }
  ]
}
```

Replace the illustrative source hash with the hash of your source artifact.
`evidence_tier` is `historical_exploration`, `prospective`, or `synthetic_test`.
It is importer-supplied metadata, not authenticated by this tool. Version 1 does
not import private Python formats or Strategy Tester cash PnL automatically.
Use an explicit producer-side normalization; never rename net PnL to gross.

`gross_return_bps` must already include trade direction, but exclude all costs.
Positive means favorable to the trade, including shorts. One bp is 0.01%, not
one pip. Set it to `null` for a missing outcome with a known intended exit time;
null is not a flat trade. Live open trades without that exit contract are not
supported. Limits: 100,000 records, 100 symbols, 32 MiB per artifact, absolute
gross return at most 1,000,000bps. Trade IDs must be globally unique in a ledger.

## Summarize

Call with the returned `artifact_id` and an explicit `round_trip_cost_bps`.
Optional fields: `include_symbols`, `exclude_symbols`, `direction` (`long` or
`short`), `from`, `to`, and `group_by` (`none`, `symbol`, `year`, `month`).
Symbols match exactly, including any venue prefix. Unknown symbols and overlapping
include/exclude lists are rejected rather than silently ignored.

Dates are canonical UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`), filtered by **exit** time:
`from` inclusive, `to` exclusive. Year/month groups use the same UTC exit time.
At most 500 groups are returned; narrow the date range if that limit is exceeded.

For each closed outcome, `net = gross_return_bps - round_trip_cost_bps`.
`gross_profit_bps` is the sum of positive **net** outcomes, `gross_loss_bps` the
absolute sum of negative net outcomes (the conventional PF numerator/denominator
after costs). PF is their ratio, never an average of symbol-level PFs. If there
are no losses, PF is null with `profit_factor_status: no_losses`, not Infinity.
No closed outcomes likewise yields null means, PF and win rate. Win rate is a
fraction from 0 to 1; zero net outcomes are not wins.

The tool returns overall/group counts, missing counts, positive/negative sums,
net sum, mean, PF, cost/filter metadata and source identity, but no trade rows.
Missing outcomes are excluded from return denominators, not replaced with zero.
`ledger_records` counts all records in the original artifact, before any filters,
including missing outcomes. `selected_fraction` is `overall.records / ledger_records`
(0 to 1, not a percentage); it is 1 without filters and 0 for an empty selection.
Grouping does not change this denominator. For example, a 34-record slice of a
200-record ledger reports 200 and 0.17, even if `low_sample` is false.
These fields expose selection size, not selection-bias correction. A content hash
does not establish that filters were specified before inspecting outcomes.
`status: complete` only means no selected records have missing outcomes; it does
not prove source coverage or profitability. `low_sample` warns below 30 trades,
not an independent-sample or significance threshold. No candidate is approved.
Bps sums across trades/symbols are not a funded portfolio return.

## Same-Ledger Control Comparison

Every summary also returns `comparison` with contract
`same_ledger_filter_partition_v1`: `baseline` is the entire artifact, `selected`
equals the existing `overall`, and `excluded` is the exact complement. All three
use the same flat round-trip cost and return definitions. **Date filters select
records; they do not narrow the baseline.** `group_by` affects only the existing
selected-group breakdown. Counts and profit/loss sums partition the baseline;
PFs are recomputed from sums, never averaged across subsets.

Each subset's `mean_net_bps` uses its own known outcomes. In contrast,
`common_opportunities` uses all baseline records with non-null outcomes as a
shared denominator N. It compares taking every known opportunity with taking
only the selected ones and leaving excluded opportunities untraded, without
replacement or reinvestment. No missing outcome enters N or either policy:

- `baseline_mean_net_bps`: baseline net sum / N.
- `selected_policy_mean_net_bps`: selected net sum / N.
- `delta_mean_net_bps`: negative excluded net sum / N.
- `delta_mean_gross_bps`: negative excluded gross sum / N.
- `avoided_cost_mean_bps`: excluded known trades times round-trip cost / N.

The net delta equals gross delta plus avoided cost, up to floating-point rounding.
With no known outcomes all these means are null. An empty selection with N > 0
has zero policy return from not trading; this does not impute missing returns.
`comparison.status` is partial if **any baseline** outcome is missing, even when
the selected summary is complete. This is a complete-case descriptive comparison,
not evidence that missingness is harmless, a causal filter effect, an executable
portfolio or a significance test. It does not change `candidateEligible`.

## Slice Exploration Journal

Supply `research_id` to explicitly request local recording before summary metrics
are returned. Use the same ID throughout one research question. It is an exploration
namespace, not a registered hypothesis or proof of preregistration. Omit it for
read-only use; the response then explicitly reports `exploration.status: untracked`.
Recording failure returns a tool error without metrics, not an untracked success.

For example, add `"research_id": "my-slice-study"` to the existing summary
arguments. `exploration` then returns `call_count`, `distinct_conditions`, the
current `condition_hash`, global log `sequence`, scoped `recording_started_at`,
current `group_keys` and cumulative `grouped_cell_count`. The latter counts
repeated presentations too; it is not a count of unique groups or independent
tests. All counts describe this local stream as of the recorded call.
New records also identify the fixed `comparison_contract` presented. Older
records without that field do not claim that baseline/complement metrics were
shown. This fixed presentation addition does not create a new filter condition;
the grouped-cell counter continues to count only explicit `group_by` output.

Counts are scoped to the research ID and immutable artifact ID. Total calls and
distinct normalized conditions are separate: repeated calls increment only the
former. Symbol sets are deduplicated and sorted. Direction, UTC date bounds,
grouping and flat round-trip costs remain part of condition identity. Returned
group keys are recorded as presented comparisons, not independent statistical
trials. Empty selections are recorded too. Invalid requests that expose no
summary are not counted. A call recorded before a disconnected response may be
counted even if the caller did not receive it; retries are additional calls.

This is a separate exploration stream alongside the existing research journals,
not a change to frozen hypothesis records. Earlier calls, calls without an ID,
other IDs/artifacts and tool-external exploration are outside the reported counts.
Neither counts nor group totals are an automatic multiple-testing correction.
`candidateEligible` stays false regardless of PF or recorded sample size.

Storage defaults to `~/.tradingview-mcp/backtest-slice-journal.jsonl`, configurable
through `TRADINGVIEW_MCP_BACKTEST_SLICE_JOURNAL_PATH` in the server environment,
never through an MCP path argument. The local append-only log uses the existing
first-seen storage lock and durability checks, with 32 MiB file / 64 KiB record
limits. Reaching a limit fails closed; do not silently rotate or reset the log
and present the resulting counts as a complete search history.

## Storage Boundary

MCP accepts only hash-shaped IDs, not file paths or executable transformations.
Import is an explicit local command, not an MCP write tool. Final files are
published with an exclusive hardlink after file sync, so partial writes are not
visible as artifacts. Existing IDs are verified and never overwritten. Reads
verify the content hash, regular-file identity and size; symlinks are refused.
POSIX requires owner-only permissions; Windows users must protect the directory
with ACLs. A mutable ancestor or malicious process under the same user remains
outside the protection boundary. Hash integrity is not source authentication.
