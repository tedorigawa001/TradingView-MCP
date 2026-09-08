# Saved Backtest Ledgers

`summarize_backtest_ledger` reads a registered immutable local artifact. It does
not contact TradingView or alter a chart. Research strategies and data remain
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
These fields expose selection size, not selection-bias correction. The tool does
not track the number of slices tried, and a content hash does not establish that
filters were specified before inspecting outcomes.
`status: complete` only means no selected records have missing outcomes; it does
not prove source coverage or profitability. `low_sample` warns below 30 trades,
not an independent-sample or significance threshold. No candidate is approved.
Bps sums across trades/symbols are not a funded portfolio return.

## Storage Boundary

MCP accepts only hash-shaped IDs, not file paths or executable transformations.
Import is an explicit local command, not an MCP write tool. Final files are
published with an exclusive hardlink after file sync, so partial writes are not
visible as artifacts. Existing IDs are verified and never overwritten. Reads
verify the content hash, regular-file identity and size; symlinks are refused.
POSIX requires owner-only permissions; Windows users must protect the directory
with ACLs. A mutable ancestor or malicious process under the same user remains
outside the protection boundary. Hash integrity is not source authentication.
