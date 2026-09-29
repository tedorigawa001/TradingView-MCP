# Realized Covariance

`compute_realized_covariance` builds daily realized-covariance proxies from imported bar series
under rules you state. It stores them as a content-addressed **proxy set**, which the forecast-set
import CLI joins with your forecasts for [`compare_forecast_losses`](FORECAST_LOSS_COMPARISON.md).
The rules are research choices: a different day boundary, gap rule or weekend treatment gives
different proxies, and with them possibly a different ranking of forecasts. The tool makes that
construction a recorded function of the rules. The same bars and rules give the same proxy-set
ID, and every computation is journaled, so trying rules until a forecast wins stays visible.

A realized covariance is a noisy proxy, not the true covariance. Nothing here is a trading or
risk-management result. The tool reads no chart, places no orders and takes no file paths. The
design and its review history are in [REALIZED_COVARIANCE_DESIGN.md](REALIZED_COVARIANCE_DESIGN.md).

## Workflow

1. Import each bar series with `tradingview-mcp-import-bar-series`.
2. Call `compute_realized_covariance` with the bar artifact IDs, the rules and a date range. It
   returns a `proxy_set_id` and a bounded summary.
3. Optionally export the proxy set with `tradingview-mcp-export-proxy-set` to fit your forecasts.
4. Join your forecasts to it with `tradingview-mcp-import-forecast-set --proxy-set`.
5. Compare with `compare_forecast_losses`, which verifies the joined set against its proxy set.

**The CLIs and the MCP process must use the same paths.** The join and the comparison read the
proxy-set store and the computation journal. Set every variable below identically for the CLIs
and the MCP server, or leave them all at their defaults:

| Variable | Default | Used by |
|---|---|---|
| `TRADINGVIEW_MCP_BAR_SERIES_DIR` | `~/.tradingview-mcp/bar-series` | bar import, the tool |
| `TRADINGVIEW_MCP_PROXY_SET_DIR` | `~/.tradingview-mcp/proxy-sets` | the tool, export, join, comparison |
| `TRADINGVIEW_MCP_REALIZED_COVARIANCE_JOURNAL_PATH` | `~/.tradingview-mcp/realized-covariance-journal.jsonl` | the tool, join, comparison |
| `TRADINGVIEW_MCP_FORECAST_SET_DIR` | `~/.tradingview-mcp/forecast-sets` | join, comparison |

A proxy set computed under one journal path and joined under another fails as
`proxy_set_not_journaled`.

## Bar series

After building a checkout:

```sh
npm run import:bar-series -- --input /absolute/path/bars.json --confirm-local-import
```

The installed package exposes the same command as `tradingview-mcp-import-bar-series`. It returns
the `artifact_id`, the `series_id`, the bar count and the interval. The input must be valid UTF-8,
and its schema is strict:

| Field | Content |
|---|---|
| `schema_version` | `"1.0"` |
| `source_id`, `source_sha256`, `evidence_tier` | Where the bars came from; the tier is `historical_exploration`, `prospective` or `synthetic_test` |
| `series_id` | A stable ID, for example `fxdata-m15:EURUSD`. The prefixes `ledger-source:`, `forecast-set-source:` and `proxy-set-source:` are reserved. |
| `interval_minutes` | An integer that divides 1440 |
| `open_time` | Unix seconds of each bar's **open**, strictly increasing, each a multiple of `interval_minutes`·60, from 0 to 4,102,444,800 (2100-01-01) |
| `close` | A number or null per bar |

- A close that is null or not positive counts as missing when computing.
- At most 600,000 bars and 32 MiB normalized. That covers about 6,250 days of 24-hour M15, but
  only about 1.1 years of 24-hour M1.
- Timestamps are assumed to be open times. The tool cannot detect close-time labels; the modal
  bar times in the diagnostics help you spot them.
- The store follows the other stores: owner-only, exclusive create, sync before publishing by hard
  link, and a hash check of the stored bytes on every read. Hash integrity is not source
  authentication.

## Rules

`rules` is a strict object with no defaults and no preset. The #100 FX covariance study is the
worked example:

| Field | Meaning | #100 |
|---|---|---|
| `interval_minutes` | Must equal every series' interval, and divide 1440 | 15 |
| `time_zone` | IANA zone name, stored verbatim (below) | `America/New_York` |
| `day_end_local` | Local wall time `HH:MM` that ends each day window | `16:45` |
| `day_weekdays` | ISO weekdays 1–7 (Monday = 1) of the day labels that produce days; sorted, no repeats | `[1, 2, 3, 4, 5]` |
| `max_missing_slots` | 0–1,440: the most expected slots that may be missing on a kept day | `6` (at least 90 of 96) |
| `first_interval` | `from_previous_endpoint` or `within_day` | `from_previous_endpoint` |
| `return_unit` | `log` or `log_percent` | `log_percent` |

The rules are canonicalized: a fixed key order and sorted weekdays; repeated weekdays are an
error. `rules_sha256` is the SHA-256 of `JSON.stringify` of the canonical form, and the response
returns both.

**Zone names.**
- `time_zone` is stored as given, never canonicalized through Intl, because Intl's resolved name
  depends on the ICU version (it turns `Asia/Kolkata` into `Asia/Calcutta` on some runtimes).
- A name that differs from Intl's resolved name only by letter case, such as `america/new_york`,
  is rejected (`time_zone_case_variant`), so case cannot create spurious rule variants.
- Aliases such as `US/Eastern` are accepted and get their own `rules_sha256`. That over-counts
  rule variants, which is the conservative direction.
- **The case check leaks for lowercase aliases.** `us/eastern`, `asia/kolkata` and `europe/kyiv`
  are accepted verbatim, because their resolved names differ by more than case. Which spellings
  are rejected can change with the ICU version. The only effect is over-counting variants.
- The check runs only when the tool validates a call. Verifying a stored proxy set does not re-run
  it, so an ICU upgrade cannot fail a set that was valid when computed.

### Days and windows

- **Boundaries.** b(x) is the UTC instant of `day_end_local` on local date x in `time_zone`.
- **Labels.** Let m be `day_end_local` in minutes after midnight.
  - If m ≥ `interval_minutes`, the day ending at b(x) is labelled x. #100's 16:45 ends the day
    labelled x.
  - Otherwise it is labelled x − 1: with `00:00`, day x is [x 00:00, x+1 00:00).
  - Each label is used once, even where DST starts at midnight (Africa/Cairo or America/Havana
    with a 01:00 boundary). There, the label and the local date of the last slot can differ; the
    label is a name, and the window is what counts.
- **Window ends and starts.** e(D) = b(D) when m ≥ `interval_minutes`, else b(D + 1); s(D) = e(D − 1).
  Tokyo 07:00, for example, gives s(D) = D−2 22:00Z and e(D) = D−1 22:00Z.
- **Produced days** are the labels D in [`from_date`, `to_date`] whose ISO weekday is in
  `day_weekdays`, at most 5,000. Both dates must lie from 1970-01-01 to 2099-12-31. P(D) is the
  previous produced label, which may lie before `from_date`.

### Call validation

Each of these rejects the whole call with an error `<code>: <detail>`:

| Code | When |
|---|---|
| `invalid_rules` | `day_weekdays` repeats a weekday. Other schema violations are argument errors. |
| `interval_mismatch` | `interval_minutes` does not divide 1440, or differs from a series' interval |
| `unknown_time_zone`, `time_zone_case_variant` | The zone is unknown, or a case variant (above) |
| `invalid_date_range` | A date is not a calendar date from 1970-01-01 to 2099-12-31 (the bar-series time range), or `from_date` is after `to_date` |
| `no_produced_days` | No date in the range has a weekday in `day_weekdays` |
| `too_many_dates` | More than 5,000 produced days |
| `boundary_not_on_grid` | A boundary the call uses is not on the bar grid in UTC. Asia/Kolkata 17:00 is 11:30Z, off a 60-minute grid; America/New_York 16:00 with 120-minute bars is on the grid in summer but not in winter. |
| `boundary_in_dst_gap_or_fold` | A boundary falls in a DST gap or fold, such as New York 02:30 on its spring-forward date. It recurs every year, so the rule is rejected. |
| `too_few_slots_for_rule` | On some produced day, expected slots − `max_missing_slots` is below 2 (`from_previous_endpoint`) or 3 (`within_day`). With 1440-minute bars, RC would equal the daily outer product. |
| `window_too_long` | A realized window would start before UTC date D − 8. Valid rules cannot reach it; it is a backstop. |
| `duplicate_series` | An artifact ID or a `series_id` appears twice |
| `range_outside_series_coverage` | The span the call reads (below) is not inside every series' first bar open to last bar close. The error lists each series' first and last bar. |
| `bar_series_not_found` | A bar-series artifact is not in the store |

"Boundaries the call uses" are e(P(first produced day)), only with `from_previous_endpoint`, and
s(D) and e(D) for every produced D.

## The computation

**Slots.** D's expected slots are the grid times t with s(D) ≤ t < e(D). On a DST day that is 92 or
100 M15 slots; a 30-minute DST zone such as Lord Howe gives 94 or 98. A slot is common when every
series has a valid close for that bar. D's endpoint is the close of its last expected slot, the bar
opening at e(D) − interval. Missing slots are expected minus common slots.

**Returns.** The formulas are pinned by `algorithm_version: "realized_covariance_v1"`:
- per bar, L = s·`Math.log`(close), with s = 100 for `log_percent` and 1 for `log`;
- the start point P₀ is the endpoint of P(D) with `from_previous_endpoint`, read even before
  `from_date`, or D's first common slot with `within_day`;
- P₁…P_m are D's common slots after P₀, in time order, ending at D's endpoint;
- yₖ = L(Pₖ) − L(P₀), and stepₖ = yₖ − yₖ₋₁. A missing slot in any series widens that step for every
  series. Nothing is filled;
- r_D = L(endpoint of D) − L(P₀);
- RC_ij = Σₖ stepₖ,i·stepₖ,j, summed in time order, computed for i ≤ j and mirrored;
- daily_outer_ij = r_D,i·r_D,j, the second proxy, also mirrored;
- asserted invariant: |Σₖ stepₖ − r_D| ≤ 1e-12·max(1, maxₖ |yₖ|) per series.

**`Math.log` bits can differ across JavaScript engines.** The same bars and rules give the same
proxy-set ID on one engine, but an engine whose `log` differs in the last bit gives other values
and so another ID.

**Kept and dropped days.** Each produced day is kept or dropped for the first cause that applies:
1. `no_endpoint`: some series lacks D's endpoint;
2. `no_previous_endpoint` (`from_previous_endpoint` only): some series lacks P(D)'s endpoint;
3. `too_many_missing_slots`: more than `max_missing_slots` expected slots are missing;
4. `numerically_not_psd`: RC or daily_outer is not finite, not symmetric within 1e-12, or not
   positive semi-definite under the comparison's own checks. This is a backstop and is not
   expected.

**Holidays cascade with `from_previous_endpoint`.** A weekday with no bars drops itself
(`no_endpoint`) and the next produced day (`no_previous_endpoint`), as in #100. About nine holidays
a year then drop about 7% of days, **more than `compare_forecast_losses` allows (5%)**, so a
multi-year set joined as is will be `not_evaluable`. `within_day` avoids the cascade. No holiday list
is accepted, because it would be a free choice that could remove hard days.

**Realized windows.** The window reported for D is the span its return covers:
- `from_previous_endpoint`: [e(P(D)), e(D)). Monday's window starts at Friday's endpoint, and
  consecutive produced days get contiguous windows;
- `within_day`: [s(D), e(D)).

Dropped days get their windows too. Bars inside a window but before s(D) are not slots: weekend
quotes before Monday, a #100-style Friday 16:45 bar, or Monday's bars when `day_weekdays` is
Tue–Fri. The widened first step spans them, and the diagnostics count them.

### The #100 example

With the rules in the table, a week of M15 bars from Sunday 17:00 to Friday 16:30 New York time:
- Monday's window starts at Friday's 16:45 endpoint (21:45Z in winter). A Friday 16:45 bar, and any
  weekend quote before Sunday 16:45, lies in that window but is not a slot; the first step spans
  it, and `non_slot_bars` counts it.
- Monday's first expected slot, Sunday 16:45, has no bar, so Monday has at least one missing slot,
  as in #100.
- The first day of the range reads the previous produced day's endpoint, even before
  `from_date`, so it is kept where #100 dropped it.

## Response

Fields appear in this order:
1. `proxy_set_id`, `algorithm_version`, `rules_sha256`, the canonical `rules`, and `tzdata` (the
   runtime's `process.versions.tz`, or `unknown`);
2. `from_date`, `to_date`, and `envelope`, the span the call read: from e(P(first)) − interval
   with `from_previous_endpoint`, or from s(first) with `within_day`, to e(last);
3. `produced_days`, `kept_days`, `dropped` by cause, and `kept_by_weekday` (by ISO weekday of the
   label);
4. `missing_slots` over all produced days: `{days, zero_missing_days, min, p50, p90, max}`, with
   nearest-rank quantiles;
5. `diagnostics`:
   - `series`, in axis order: `series_id`, the series' `first_bar` and `last_bar`, `non_slot_bars`
     (bars inside some produced day's realized window, kept or dropped, that are not one of its
     expected slots), `invalid_closes` (null or not positive, in the read span), and
     `modal_local_times`: per ISO weekday of the local date, the most frequent local `HH:MM` of the
     first and of the last valid bar of each date, ties to the earlier time;
   - `identical_close_pairs` (below);
6. `search`, `period_usage` (see [Records](#records));
7. `limitations`.

Per-day values are never returned; they are in the proxy set. Memory follows the bars inside the
span the call reads, not the series' whole extent. With 8 series, modal times for every
weekday, all 28 series pairs identical and a saturated prior-overlap summary, the response is about
33 KB.

**Identical series.** `identical_close_pairs` lists index pairs i < j whose closes are bitwise equal
at every point used by a kept day (each P₀ and P₁…P_m). It is empty when no day is kept. Such a pair
gives exactly singular proxies on every day. The tool still computes and reports them, but the
join refuses the set. A copy with one bar deleted, or with the weekend bars stripped, is still
caught, because non-slot bars never enter the steps. **Scaled or inverted copies (c·A, 1/A) give
near-singular proxies and are not caught.**

`limitations`:
- `realized_covariance_is_a_noisy_proxy_not_the_true_covariance`
- `rules_are_caller_asserted_research_choices`
- `missing_bars_widen_intervals_no_fill`
- `bar_timestamps_assumed_open_time`
- `holidays_cascade_with_from_previous_endpoint`
- `tzdata_version_reported_not_pinned`
- `cross_engine_math_log_bits_not_guaranteed`
- `bar_source_integrity_not_source_authentication`
- `not_a_trading_or_risk_management_result`
- `first_interval_spans_non_slot_bars`, with `from_previous_endpoint` only

## Records

Every call writes, in this order, before responding:
1. period usage, only with `research_id`;
2. one computation-journal record, always;
3. the proxy set, idempotently.

Any failure returns an error and no summary. A failure after a write names what was written: the
period records as `<base>:0-<last>`, then the journal record by its sequence. Retrying the same call
completes a failed store write. A recorded write is an attempted exposure, not proof that anyone
saw the result.

### Computation journal

One line per call, with or without `research_id`, in the namespace
`realized_covariance_computation`, on the same append-only, owner-only first-seen log as the other
journals (32 MiB file, 16 KiB record). A record holds the algorithm version, the canonical rules and
their hash, the bar artifact IDs and `underlying_series_ids`, `from_date` and `to_date`, the
`proxy_set_id`, `research_id` or null, `tzdata`, the kept and dropped counts, and the envelope.

A `proxy_set_id` may be recorded again under another `research_id` or `tzdata`. Any other
difference for the same ID fails closed without appending, as does a torn line or a record that
breaks the schema.

`search` counts records that share a series ID with this call and whose envelope overlaps its
envelope (half-open), this call included:
- `calls`;
- `distinct_rules`: distinct `rules_sha256`;
- `distinct_bar_series_versions`: distinct ordered tuples of bar artifact IDs, so a re-import of the
  same `series_id` with different cleaning shows up;
- `period_usage_prior_overlap`, with `research_id`: the period records' prior overlap in summary
  form, as in [the comparison](FORECAST_LOSS_COMPARISON.md#search);
- `limitations`: `local_recorded_calls_only`,
  `overlap_key_is_importer_supplied_series_ids_and_read_spans`, `retries_increment_call_counts`.

### Period usage

With `research_id`, one `tool_observed` batch goes to the
[period usage journal](RESEARCH_PERIOD_USAGE.md#automatic-realized-covariance-tracking) with the scope
`realized_covariance_bar_window_only`:
- index 0 is `proxy-set-source:<hex of the proxy-set ID>`, with the proxy-set ID as `data_version`;
- then one record per bar series in axis order, with its `series_id` and its bar artifact ID as
  `data_version`: the data actually read;
- every record spans the envelope, dropped days included;
- access IDs are `<base>:<index>`; the base is `usage_access_id` (1–100 characters) or a
  generated `rc-access:<uuid>`;
- `request_sha256` is the SHA-256 of `{"contract":"realized_covariance_v1","bar_series":[…],
  "rules_sha256":…,"from_date":…,"to_date":…}` in that key order. A retry is idempotent; reusing
  the base with other rules, another range or another axis order conflicts.

`period_usage` returns `access_id_base`, each record's `access_id`, `series_id` and `idempotent`,
and the limitations `bar_window_read_not_later_forecast_use`, `series_ids_are_importer_supplied`,
`different_source_ids_and_external_access_are_not_reconciled` and
`recorded_attempt_is_not_proof_of_result_delivery`.

**An untracked computation followed by an export leaves no period record.** Without `research_id`,
the call is still journaled and its proxy set stored, but `check_research_period_usage` and
`preflight_research_oos` do not read the computation journal. `period_usage` then says
`untracked` with `research_id_required_for_automatic_period_usage` and
`period_usage_checks_do_not_read_the_computation_journal`. Pass `research_id` whenever the proxies
may inform a later evaluation.

## Proxy sets

The proxy set holds at most 5,000 dates and 32 MiB, in this key order: `schema_version`,
`algorithm_version`, `bar_series`, `underlying_series_ids`, `evidence_tiers`, `rules`,
`rules_sha256`, `from_date`, `to_date`, `dates` (every produced label, kept or dropped), `windows`,
`rc` and `daily_outer` (a scalar for n = 1, an n×n matrix, or null when dropped), `common_slots`,
`expected_slots`, `drop_cause` and `identical_close_pairs`.

The tzdata version is not part of the content. The windows already hold the resolved UTC
boundaries, so a runtime upgrade that resolves the same boundaries gives the same ID; tzdata is
recorded in the journal and the response.

Export a stored set to a new file:

```sh
npm run export:proxy-set -- --artifact sha256:<hex> --output /absolute/path/proxy.json --confirm-local-write
```

The installed command is `tradingview-mcp-export-proxy-set`. The output path must be absolute, and
an existing file is never overwritten.

### Verification

Every read by the join and by `compare_forecast_losses` runs a light check that needs no bars. The
first failing check gives the error:
1. `proxy_set_not_found`: the set is not in the store.
2. `proxy_set_rules_mismatch`: `rules_sha256` does not match the rules, or the dates are not what
   the rules and range give. Neither can change with tzdata.
3. `proxy_set_not_journaled`: no journal record names this ID with the same `rules_sha256`.
4. Windows and expected slots re-derived under the current tzdata differ, or cannot be derived:
   - `proxy_set_windows_changed_under_current_tzdata` when no journal record for this ID carries the
     current tzdata (`unknown` never counts as a match). The error names both versions;
   - otherwise `proxy_set_rules_mismatch`.

**tzdata drift fails closed.** A runtime upgrade whose tzdata moves a historical boundary makes the
re-derived windows differ, and every read fails with
`proxy_set_windows_changed_under_current_tzdata`. Recompute under the new runtime: that gives a new
ID with the same `rules_sha256`, so the variant counts do not change.

The check does not detect values edited directly in the owner-only store together with a forged
journal line. As with the other stores, a process running as the same user is outside the
protection boundary.

### Joining forecasts

```sh
npm run import:forecast-set -- --proxy-set sha256:<hex> --input /absolute/path/forecasts.json --confirm-local-import
```

This mode of `tradingview-mcp-import-forecast-set` is the only way to write a set whose
`source_id` starts with `proxy-set:`. Its input is strict:

| Field | Content |
|---|---|
| `schema_version` | `"1.0"` |
| `evidence_tier` | Yours; the proxy set keeps the bar tiers for inspection |
| `from_date`, `to_date` | Dates of the proxy set, in order |
| `a`, `b` | A value or an explicit null for every proxy-set date in that run |
| `labels` | Optional, one per date |

The join verifies the proxy set, then builds a forecast set with `source_id` `proxy-set:<hex>`,
`source_sha256` the proxy-set ID, and dates, windows, n, series, `primary` (rc) and `secondary`
(daily_outer) from the run. Dropped days stay as null proxies. Errors:
- `proxy_set_has_identical_series`: the set has identical-close pairs;
- `join_range_not_contiguous`: `from_date` or `to_date` is not a date of the proxy set, or they are
  out of order;
- `join_length_mismatch`: `a`, `b` or `labels` does not have one entry per date of the run;
- `join_run_has_no_kept_day`: every date of the run was dropped, so it has no proxy;
- any verification error above, and the forecast-set schema errors.

**The effective join limit is about 4,000 dates at n = 8.** A joined set must fit the 24 MiB
forecast-set limit, and 8×8 matrices for 5,000 dates take about 26 MiB. Join a sub-range, or fewer
series.

Joined windows follow the realized span, so their `from` may fall up to 8 UTC days before the date
(Monday starts at Friday's endpoint; Tokyo 07:00 starts on D − 2). The forecast-set window rule
admits that only for `proxy-set:` sources; see
[the set schema](FORECAST_LOSS_COMPARISON.md#set-schema).

### In compare_forecast_losses

For a `proxy-set:` source, before any record or statistic, the comparison:
- requires the hex of `source_id` to name `source_sha256`;
- verifies the proxy set as above;
- requires the set's dates to be a contiguous run of the proxy set's dates, with equal n, series,
  windows, primary and secondary.

Any difference is `proxy_set_mismatch`, with no statistics and no record. Deleting the dates where A
loses badly and re-importing under the same source therefore fails, instead of escaping the 5%
drop rule. Its `search` then adds `proxy_rule_variants` and `proxy_bar_series_versions`, counted
over the computation journal as above, tracked or untracked.

**Stored `proxy-set:` sets fail closed.** A set stored by 0.1.14 or earlier with a `proxy-set:`
source (then an ordinary string) reads as before, but its comparison fails: with
`proxy_set_mismatch` when the text after `proxy-set:` is not the hex of `source_sha256`, otherwise
with `proxy_set_not_found` unless a matching proxy set exists.

## Performance

`node scripts/benchmark-realized-covariance.mjs` (after `npm run build`) uses 8 series of about
479,000 M15 bars each (3.8 million closes, 5,000 Mon–Fri days). On the development machine:
- importing the 8 series took about 2.0 s, and reading them back with the hash check 0.9 s;
- the computation took about 1.0 s, and normalizing and storing the 13.3 MiB proxy set 0.4 s;
- journaling after 21,000 records (30 MiB) took about 0.35 s;
- re-deriving 5,000 days took about 70 ms, and the whole verification, including that journal,
  about 0.48 s;
- joining 4,000 dates took about 0.49 s, and registering the 21.0 MiB set 0.54 s.

The benchmark is outside the unit suite, so tests never depend on timing.

## Downgrading

- 0.1.14 rejects the new `tool_name` in period-usage records. After the first realized-covariance
  record, every period-usage read or write under 0.1.14 fails closed, including the ledger and
  forecast-loss tools.
- 0.1.14 cannot read joined sets whose windows start before D − 1.
- Those two fail closed. 0.1.14 does compare joined sets whose windows follow the old rule, but
  without verifying them against their proxy set.
