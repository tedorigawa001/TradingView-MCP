# compute_realized_covariance: design memo (rev 2.3, design review approved; not implemented)

Backlog #101, item 4.

Review history:
- rev 1: BLOCK, 17 findings: HIGH F1 and F2, MEDIUM F3–F10, LOW F11–F17.
- rev 2: APPROVE WITH FINDINGS, MEDIUM G1–G4 and LOW G5–G10, with a diff check of the edits
  enough.
- rev 2.1 (diff check): APPROVE WITH FINDINGS, MEDIUM H1 and LOW H2–H6, commit approved after
  the H1 and H2 text edits.

Rev 2 folded in F1–F17, rev 2.1 folded in G1–G10, and rev 2.2 folded in H1–H6, with the user's
decisions of 2026-09-29 (section "Decisions"). Rev 2.3 makes three clarifications from the plan
review and its diff check (Q1, Q4, Q6, R1): the identical-series definition, the verification
error rules, and the conditional limitation. Nothing is implemented.

## Problem

`compare_forecast_losses` (item 2) takes its proxies as given. How they were built decides what it
measures, and today that construction lives in per-study scripts.

In the FX covariance study (#100), realized covariance came from `playbook/hmm-fx-covariance-v1/`
(`days.py`, `returns.py`). Each rule was a research choice fixed in the study's protocol:
- the day boundary: America/New_York 16:45;
- the endpoint: the close of the bar opening 16:30;
- which bars belong to no day: Friday 16:45 to Sunday 16:30;
- the common-slot rule across pairs;
- missing bars widen an interval;
- at least 90 of 96 slots are common;
- Monday's first interval starts at Friday's endpoint.

One erratum changed the boundary, the endpoint and the weekly target.

The next study would rewrite these rules. A different boundary, gap rule or weekend treatment
changes the proxy, and with it the ranking of forecasts, without appearing anywhere in the result.

The tool makes the construction a recorded function of stated rules:
- the same bars and rules give the same proxies, identified by hash;
- a different rule gives a different proxy-set ID;
- every computation is journaled, so trying rules until a forecast wins stays visible (F8).

## Scope (v1)

- **Input:** 1–8 fixed-interval close series. Each is a content-addressed local artifact
  registered by a new import CLI (D2). There is no chart path, because chart history is not
  reproducible.
- **Output:** a content-addressed **proxy set** holding, per day:
  - the realized covariance;
  - the daily-return outer product (the second proxy);
  - slot counts;
  - the realized window;
  - the drop cause.

  The MCP response is a bounded summary. A CLI exports the proxy set, and the forecast-set import
  CLI joins it with forecasts (D3).
- **Not in v1:**
  - forecasting;
  - range-based estimators, which need open, high and low;
  - noise or jump corrections;
  - non-grid intervals;
  - holiday lists (F15);
  - filling missing bars.

## Bar series artifact

Imported with:

```
tradingview-mcp-import-bar-series --input <abs.json> --confirm-local-import
```

The input is strict JSON (F16):

| Field | Content |
|---|---|
| `schema_version`, `source_id`, `source_sha256`, `evidence_tier` | As in the other stores |
| `series_id` | Stable ID, for example `fxdata-m15:EURUSD`. The prefixes `ledger-source:`, `forecast-set-source:` and `proxy-set-source:` are reserved (F9). |
| `interval_minutes` | An integer that divides 1440 (F1) |
| `open_time` | Unix seconds of each bar's **open**, strictly increasing, each a multiple of `interval_minutes`·60 |
| `close` | A number or null per bar; JSON cannot carry non-finite numbers |

Rules:
- Duplicate or non-increasing times are rejected at import.
- A close that is null or not positive counts as missing when computing.
- Limits: 600,000 bars and 32 MiB normalized, sized for M15. That covers about 6,250 days of
  24-hour M15, but only about 1.1 years of 24-hour M1.
- The store follows the forecast-set store:
  - owner-only, exclusive create;
  - the hash is checked on the stored bytes at every read;
  - directory `TRADINGVIEW_MCP_BAR_SERIES_DIR`, default `~/.tradingview-mcp/bar-series`.
- Timestamps are assumed to be open times. The tool cannot detect close-time labels. The weekly
  diagnostics help (F14), and a limitation says so.

## Rules

`rules` is a strict object. It has no defaults and no preset (D4).
- It is canonicalized: fixed key order, and `day_weekdays` sorted and unique.
- `rules_sha256` is the SHA-256 of `JSON.stringify` of that canonical form.
- **`time_zone` (G7, H3):**
  - It is stored verbatim, never canonicalized through Intl. On the review runtime,
    `resolvedOptions()` turns `Asia/Kolkata` into `Asia/Calcutta`, so the result depends on the
    ICU version.
  - A name that Intl accepts but that differs from Intl's resolved name only by letter case
    (`america/new_york`) is rejected, so case cannot create spurious variants.
  - Aliases such as `US/Eastern` are accepted and give their own `rules_sha256`. That over-counts
    variants, which is conservative.
  - The case check leaks for lowercase aliases. `us/eastern`, `asia/kolkata` and `europe/kyiv`
    are accepted verbatim, because their resolved names differ by more than case. Which spellings
    are rejected can change with the ICU version. The docs say so; the only effect is
    over-counting.
  - The case check runs only when a call validates its rules. Verifying a stored proxy set (D12)
    does not re-run it, so an ICU upgrade cannot fail a set that was valid when computed.

| Field | Meaning | #100 |
|---|---|---|
| `interval_minutes` | Must equal every series' interval | 15 |
| `time_zone` | IANA zone name, stored verbatim (G7) | America/New_York |
| `day_end_local` | Local wall time `HH:MM` that ends each day window | 16:45 |
| `day_weekdays` | ISO weekdays 1–7 (Monday = 1) of the day label (below) that produce days | [1, 2, 3, 4, 5] |
| `max_missing_slots` | Integer ≥ 0: largest number of expected slots that may be missing on a kept day (D10) | 6 (96 − 90) |
| `first_interval` | `from_previous_endpoint` or `within_day` | from_previous_endpoint |
| `return_unit` | `log` or `log_percent` (D7) | log_percent |

### Boundaries, day windows and labels (G1)

- **Boundaries.** For each calendar date x, b(x) is the UTC instant of `day_end_local` on local
  date x in `time_zone`.
- **Labels by rule arithmetic.** Let m be `day_end_local` in minutes after midnight.
  - If m ≥ `interval_minutes`, the day window ending at b(x) is labelled x. This is #100's case:
    16:45 ends the day labelled x.
  - Otherwise it is labelled x − 1. With 00:00, the window ending at b(x+1) is labelled x, so day
    x is [x 00:00, x+1 00:00).
  - This is one-to-one by construction. The earlier instant-based rule labelled a date twice where
    DST starts at midnight, for example Africa/Cairo or America/Havana with a 01:00 boundary.
  - On such a day, the label and the local date of the last slot's open can differ. The label is
    a name; the window is what counts.
- **Window ends and starts.** For each label D:
  - e(D) = b(D) if m ≥ interval, else b(D+1);
  - s(D) = e(D − 1).

  All later rules use e and s only. Tokyo 07:00, for example, gives s(D) = D−1 07:00 JST, which
  is D−2 22:00Z, and e(D) = D 07:00 JST.
- **Produced days** are the labels D in [`from_date`, `to_date`] whose ISO weekday is in
  `day_weekdays`. P(D) is the previous produced label before D. It may lie before `from_date`
  (D9).

### Rule validation at call time

Each of these rejects the whole call. None is decided per day.
- **`boundary_not_on_grid` (F1).** A boundary used by the call (below) is not a multiple of
  `interval_minutes`·60 in UTC. Examples:
  - Asia/Kolkata 17:00 is 11:30Z, off a 60-minute grid;
  - America/New_York 16:00 with 120-minute bars is on the grid in summer (20:00Z) but not in
    winter (21:00Z).
- **`boundary_in_dst_gap_or_fold` (F3).** For some boundary used by the call, the local
  `day_end_local` does not exist (a gap) or exists twice (a fold). For example, America/New_York 02:30 falls in the gap on
  its spring-forward date. This is a property of the rule and recurs every year, so the rule is
  rejected.
- **`too_few_slots_for_rule` (F11).** For some produced day, expected slots − `max_missing_slots`
  is less than 2 (`from_previous_endpoint`) or 3 (`within_day`). For example,
  `interval_minutes` = 1440 would make RC equal the daily outer product.
- **`window_too_long` (D5, G5).** A realized window (below) would start before UTC date D − 8.
  - A review brute force over every UTC offset from −12 to +14 and every 15-minute boundary, with
    weekly production, found a maximum lag of exactly 8 days. So valid rules cannot trigger this.
  - It stays as a backstop, and is unit-tested in isolation.
- **`too_many_dates` (G8).** More than 5,000 produced days.
- **`range_outside_series_coverage` (F7, G8).** The span the call must read has to lie inside
  every series' coverage, from its first bar's open to its last bar's close. The error reports
  each series' first and last bar. The span is:
  - with `from_previous_endpoint`, from e(P(first)) − interval, the open of the first endpoint bar
    read, to e(last);
  - with `within_day`, from s(first) to e(last).
- **`duplicate_series` (F11).** The same artifact ID or `series_id` appears twice. Two series
  with identical closes over the range are allowed, but reported as a diagnostic.

"Boundaries used by the call" are e(P(first produced day)) (only with `from_previous_endpoint`),
and s(D) and e(D) for every produced D (G1).

### Slots, endpoints and missing slots

- **Expected slots of day D (F1).** The grid times t with s(D) ≤ t < e(D), in D's own day
  window. On a DST day this is 92 or 100 M15 slots. A 30-minute DST zone such as Lord Howe gives
  94 or 98. The count is exact from the grid; no hours are assumed.
- **Common slot.** Every series has a valid close for that bar (the intersection, as in #100).
- **Endpoint of D.** The close of D's last expected slot, whose open is e(D) − interval. Its price
  instant is e(D).
- **Missing slots.** Expected slots minus common slots. On a kept day this is at most
  `max_missing_slots` (D10).
  - It needs no rounding on DST days.
  - It reproduces #100, where a Monday's absent Sunday 16:45 slot counts as one missing slot.

### Returns (F6, F12)

The formulas are pinned by `algorithm_version: "realized_covariance_v1"`:
- Per bar, L = s · Math.log(close), with s = 100 for `log_percent` and 1 for `log`. #100 used
  100·log(close).
- The start point P₀:
  - `from_previous_endpoint`: the endpoint of P(D), always read, even before `from_date` (D9);
  - `within_day`: the first common slot of D.
- The points P₁…P_m are the common slots of D after P₀, in time order. The last one must be D's
  endpoint.
- yₖ = L(Pₖ) − L(P₀), and step k = yₖ − yₖ₋₁. A missing slot in any series widens that step for
  every series. There is no fill.
- r_D = L(endpoint of D) − L(P₀), the endpoint difference, as in #100.
- RC_ij = Σₖ stepₖ,i · stepₖ,j, summed in time order. It is computed for i ≤ j and mirrored.
- daily_outer_ij = r_D,i · r_D,j, also for i ≤ j and mirrored.
- The invariant, asserted: |Σₖ stepₖ − r_D| ≤ 1e-12 · max(1, maxₖ |yₖ|) per series. It is scaled
  and never exactly zero, so near-parity series whose r_D is exactly 0 pass.
- `Math.log` bits can differ across JavaScript engines. A limitation says so.

### Kept and dropped days

Each produced day is dropped for at most one cause, checked in this order:
1. `no_endpoint`: some series lacks D's endpoint.
2. `no_previous_endpoint` (`from_previous_endpoint` only): some series lacks the previous produced
   day's endpoint.
3. `too_many_missing_slots`: more than `max_missing_slots` expected slots are missing.
4. `numerically_not_psd` (F13): RC or daily_outer fails the consumer's own checks,
   `symmetricWithin(1e-12)` and `positiveSemidefinite`. This is not expected (0 of 5,000
   near-collinear 8×8 simulations in review), so it acts as a backstop.

Holidays (F15):
- With `from_previous_endpoint`, a weekday with no bars drops itself (`no_endpoint`) and the next
  day (`no_previous_endpoint`), as in #100. About nine holidays a year then drop about 7% of
  days, which exceeds `compare_forecast_losses`' 5% limit. The docs say so, and note that
  `within_day` avoids the cascade.
- No holiday list is accepted: it would be a free choice that could remove hard days.

### Realized windows (D5: option A)

The window reported for day D is what was realized:
- `from_previous_endpoint`: [e(P(D)), e(D)), from the previous produced day's endpoint instant to
  D's. Monday's window starts at Friday's endpoint. Consecutive produced days get contiguous,
  non-overlapping windows.
- `within_day`: D's own day window [s(D), e(D)).

The forecast-set window rule (D11, G2):
- **For sets whose `source_id` starts with `proxy-set:`**, it is relaxed to D − 8 ≤ UTC date(from)
  ≤ D, inclusive at both ends. A `from` after its date is rejected.
  - This makes east-of-UTC boundaries joinable: Tokyo 07:00 starts on UTC date D − 2.
  - It also makes weekly production joinable.
  - These sets are verified against their proxy set anyway.
- **Every other set** keeps the released rule: UTC date(from) ∈ {D − 1, D}. That includes windows
  that start on their own date, which 0.1.14 accepts; a NY 21:00 `within_day` window starts at
  D 01:00Z.
- Windows must still be strictly increasing and non-overlapping.
- The relaxation lives in `normalizeForecastSet`, keyed on the stored `source_id`. It only
  relaxes, so every stored 0.1.14 set still normalizes to the same bytes and hash.

Dropped days still get their windows, because every boundary is valid by rule validation.

Bars inside a window but outside D's common slots are not slots:
- weekend quotes before Monday;
- the #100-style Friday 16:45 bar;
- Monday's bars when `day_weekdays` is Tue–Fri.

The widened first step spans them. Diagnostics count them per series (F14), so an unexpected
weekend feed is visible.

## Proxy set artifact

The proxy set is content-addressed. Its store directory is `TRADINGVIEW_MCP_PROXY_SET_DIR`, default
`~/.tradingview-mcp/proxy-sets` (F16), and it holds at most 5,000 dates. It contains, in this key
order:
- `schema_version`, `algorithm_version`;
- `bar_series` (artifact IDs in axis order), `underlying_series_ids` (the bar series' `series_id`s)
  and `evidence_tiers`;
- `rules` (canonical) and `rules_sha256`;
- `from_date` and `to_date` as requested, and `dates` (every produced label in that range, kept or
  dropped);
- `windows` (realized, as above);
- `rc` and `daily_outer`: a scalar for n = 1, an n×n matrix, or null when dropped;
- `common_slots`, `expected_slots` and `drop_cause` per date;
- `identical_close_pairs` (H1).

The tzdata version is **not** in the proxy set (F17):
- the windows already store the resolved UTC boundaries;
- a Node upgrade that resolves the same boundaries gives the same ID;
- tzdata is recorded in the computation journal and the response.

The runtime used in review reports tzdata 2026b. #100 pinned IANA 2026c.

### Export and join (D3, F2)

Export:

```
tradingview-mcp-export-proxy-set --artifact <id> --output <abs.json> --confirm-local-write
```

It writes the stored proxy set, creating the file exclusively and never overwriting.

The join:

```
tradingview-mcp-import-forecast-set --proxy-set <id> --input <forecasts.json> --confirm-local-import
```

- `forecasts.json` holds:
  - `schema_version`, `evidence_tier` and optional `labels`, all from the caller;
  - `from_date` and `to_date`, a **contiguous** sub-range of the proxy set's dates;
  - `a` and `b` with an explicit value or null for **every** date in that range.
- The CLI builds the forecast set:
  - `source_id: "proxy-set:<hex>"` and `source_sha256` = the proxy set ID;
  - dates, windows, n, `underlying_series_ids`, `primary` (rc) and `secondary` (daily_outer) from
    the proxy set range, with dropped days as null proxies.
- **Reservations (G3).** Only this path may register a `proxy-set:` source.
  - The check lives at the entry points: the plain CLI (`importForecastSet`) and
    `normalizeInlineForecastSet`. It is not in `normalizeForecastSet`, which `get()` re-runs on
    every read and which the join itself uses.
  - The series prefix `proxy-set-source:` is reserved the same way: at the forecast-set entry
    points and in the bar import, not in normalization.
  - A stored 0.1.14 set that already used either prefix therefore still reads. A set with a
    `proxy-set:` source but no matching proxy set fails closed in the comparison
    (`proxy_set_not_found`, below). The docs say so.
- **Evidence tier (G8).** The joined set's `evidence_tier` is the caller's. The proxy set keeps the
  bar tiers for inspection. `compare_forecast_losses` does not use the tier.
- **Identical series (G8, H1).** Two series with identical closes over the range give exactly
  singular proxies on every day.
  - The rev 1 review claimed the copy rules reject the join. That was wrong. The per-day ratio
    between RC and the daily outer product varies (8.7e-6 to 7.53 in a 300-day check), so neither
    the single-λ input rule nor the near-copy share fires.
  - Forecasts fitted to such proxies pass Cholesky only through rounding, giving
    rounding-dominated log-determinants.
  - The proxy set therefore stores `identical_close_pairs` (plan review Q1): index pairs i < j
    whose closes are bitwise equal at every point used by a kept day, that is every P₀ and
    P₁…P_m.
    - Non-slot bars never enter the steps. So a copy with one bar deleted, or with the weekend or
      Friday 16:45 bars stripped, still gives exactly singular RC, and this definition still
      catches it.
    - Scaled or inverted copies (c·A, 1/A) give near-singular proxies and are not caught. The docs
      say so.
  - The join CLI refuses a proxy set whose list is non-empty (`proxy_set_has_identical_series`).
    The tool still computes and reports it, since the proxies themselves are well defined.

### Verifying a proxy set (G4, D12)

Every read of a proxy set, by the join CLI and by `compare_forecast_losses`, runs a light check
that needs no bars:
- `rules_sha256` equals the hash of the canonical `rules`;
- `dates`, `windows` and `expected_slots` equal what `rules`, `from_date` and `to_date` give under
  the current time-zone data. This catches removed dates and moved windows;
- the computation journal holds a record naming this `proxy_set_id` with the same `rules_sha256`
  (`proxy_set_not_journaled` otherwise).

Failures are errors with no statistics. The first failing check gives the error (Q4, R1):
1. `proxy_set_not_found`.
2. `proxy_set_rules_mismatch` if `rules_sha256` or `dates` differ. Neither can change with tzdata.
3. `proxy_set_not_journaled` if no journal record names this ID with the same `rules_sha256`.
4. Windows and `expected_slots` are re-derived under the current tzdata. They may differ, or
   re-derivation may throw (for example because a boundary now falls in a gap):
   - if no journal record for this ID carries the current tzdata version, the error is
     `proxy_set_windows_changed_under_current_tzdata` (H4). A version of `unknown` never counts
     as equal. The error carries the journal's versions and the current one, so drift is
     distinguishable from tampering;
   - otherwise it is `proxy_set_rules_mismatch`.

A moved boundary usually changes a day's expected slots too (for example 92 against 96), which is
why slot counts belong to step 4 and not to step 2.

**Limits of the check:**
- Values edited directly in the owner-only store, with a matching hash and a forged journal line,
  are not detected. As with the other stores, a process under the same user is outside the
  protection boundary. That is a deliberate circumvention of the tool, unlike editing a forecast
  file before import, which is the normal workflow and is covered below.
- A later tzdata change that moves a historical boundary makes the re-derived windows differ. The
  check then fails closed with `proxy_set_windows_changed_under_current_tzdata`, and the docs say
  so. Recomputing gives a new ID with the same `rules_sha256`, so the variant counts do not
  change.

### Verification in compare_forecast_losses (F2)

When a set's `source_id` starts with `proxy-set:`, the tool first verifies the proxy set as above,
loading it by `source_sha256` (the hex must match). It then requires:
- the set's dates to be a contiguous run of the proxy set's dates;
- n, `underlying_series_ids`, windows, primary and secondary to equal the proxy set's over that
  run.

A mismatch is an error with no statistics (`proxy_set_mismatch`). All of this runs **before** any
record is written (G6). Deleting the dates where A loses badly and re-importing with the same
`source_id` therefore fails, instead of escaping the 5% drop rule and the own-null imputation.

## MCP tool

`compute_realized_covariance` takes:
- `series` (1–8 bar-series artifact IDs, in axis order);
- `rules`;
- `from_date` and `to_date`, inclusive labels;
- optional `research_id` and `usage_access_id`.

The arguments are strict; unknown keys are an error.

The order of operations, as in the other recording tools:
1. validate and compute (the proxy-set ID is known here);
2. write period usage, if `research_id` is given;
3. append to the computation journal (always);
4. register the proxy set (idempotent);
5. respond.

Any failure returns an error with no summary. A failure after a record leaves over-recording,
never under-recording.

The response is bounded:
- `proxy_set_id`, `rules_sha256`, `algorithm_version` and `tzdata`;
- days produced, kept, and dropped by cause;
- the missing-slot distribution and kept days by weekday;
- **diagnostics (F14):**
  - per series, the modal first and last bar local time per weekday;
  - bars inside windows that are not slots, and invalid-close counts;
  - the series coverage, and pairs of series with identical closes;
- **search (F8, G8):** among journal records that share a series ID with this call and whose
  envelope overlaps it, this call included:
  - calls;
  - distinct `rules_sha256`;
  - `distinct_bar_series_versions`, the distinct ordered tuples of bar artifact IDs. Re-importing
    the same `series_id` with different cleaning is then visible;
- `period_usage` (tracked or untracked);
- limitations.

It never returns per-day arrays.

### Records (D6, F8, F9)

**Computation journal (always written).**
- Namespace `realized_covariance_computation`, path
  `TRADINGVIEW_MCP_REALIZED_COVARIANCE_JOURNAL_PATH` (default
  `~/.tradingview-mcp/realized-covariance-journal.jsonl`), on the append-only first-seen log.
- One record per call, holding:
  - `algorithm_version`, the canonical `rules` and `rules_sha256`;
  - the bar-series IDs, `underlying_series_ids`, `from_date` and `to_date`;
  - `proxy_set_id`, `research_id` or null, and `tzdata`;
  - days kept and dropped, and the envelope.
- Without a `research_id` the call is still journaled, because the store write happens anyway.
- The join CLI and `compare_forecast_losses` read this journal (D12). So its path, like the store
  directories, must be set the same way for the CLIs and the MCP process (H5).
- The overlap key for search is the same as the forecast-loss journal's: a shared series ID and an
  overlapping envelope.
- One `proxy_set_id` recorded with different content fails closed, as in the forecast-loss
  journal (G6, H2).
  - The compared fields are `algorithm_version`, `rules_sha256`, the bar-series IDs,
    `underlying_series_ids`, `from_date`, `to_date`, the envelope and the kept and dropped counts.
  - `research_id` and `tzdata` are excluded. The same computation under another research ID, or
    recomputed after a Node upgrade that resolves the same boundaries, is a legitimate new record.
- If the journal write fails after the period write, the error names the period records that were
  written, as `compare_forecast_losses` does (G6).
- `check_research_period_usage` and `preflight_research_oos` do not read this journal. An
  untracked computation followed by an export therefore leaves no period record. The docs say so
  (G6).

**Period usage (with `research_id`).**
- Written through `recordToolAccessBatch("compute_realized_covariance", …)` with a new
  `OBSERVING_TOOL_SCOPES` entry, `realized_covariance_bar_window_only`.
- Records:
  - index 0: `proxy-set-source:<hex of the proxy-set ID>`, with `data_version` = the proxy-set ID;
  - then one record per bar series in axis order, with `series_id` = the bar series' `series_id`
    and `data_version` = that bar artifact's ID. That is the data actually read. Rule variants are
    visible through the journal's search, not through `data_version`.
- The envelope, for every record, is the coverage span above: from e(P(first)) − interval with
  `from_previous_endpoint`, or from s(first) with `within_day`, to e(last). It covers dropped days
  too, and does not over-record for `within_day` (G8).
- `request_sha256` is the SHA-256 of `{"contract":"realized_covariance_v1","bar_series":[…],
  "rules_sha256":…,"from_date":…,"to_date":…}` in that key order. A retry with other rules or
  another range conflicts.
- Access IDs are `<base>:<index>`. The base is `usage_access_id` (1–100 characters) or
  `rc-access:<uuid>`. `purpose` is `exploration`.
- `assess()` adds these limitations when this tool's records are present:
  - `tool_observed_usage_is_realized_covariance_bar_window_only`;
  - `series_id_and_data_version_are_importer_supplied_metadata`;
  - `proxy_rules_are_caller_research_choices`.
- `proxy-set-source:` joins the reserved series prefixes in forecast sets and bar series.
  RESEARCH_PERIOD_USAGE.md is updated.
- A joined forecast set's source record in `compare_forecast_losses` is
  `forecast-set-source:` + sha256("proxy-set:<hex>"), computable from the proxy-set ID.

**`compare_forecast_losses`, for proxy-set sources (F8, G6, G8).** Its search adds
`proxy_rule_variants` and `proxy_bar_series_versions`: distinct `rules_sha256` and distinct bar
tuples in the computation journal, over the same series and overlapping envelopes.
- These are read-only counts, so they are reported even when the call is untracked (without a
  `research_id`), next to `search.status: untracked`.
- Rule shopping is then visible where the comparison is read.

### Limitations (always returned, except the one marked conditional)

- `realized_covariance_is_a_noisy_proxy_not_the_true_covariance`
- `rules_are_caller_asserted_research_choices`
- `missing_bars_widen_intervals_no_fill`
- `first_interval_spans_non_slot_bars` (conditional: returned only with `from_previous_endpoint`)
- `bar_timestamps_assumed_open_time`
- `holidays_cascade_with_from_previous_endpoint`
- `tzdata_version_reported_not_pinned`
- `cross_engine_math_log_bits_not_guaranteed`
- `bar_source_integrity_not_source_authentication`
- `not_a_trading_or_risk_management_result`

## Changes to released tools (0.1.15)

1. **Forecast-set window rule:** relaxed for `proxy-set:` sources only, to D − 8 ≤ UTC
   date(from) ≤ D. Every stored set normalizes unchanged (D11, G2).
2. **Reserved prefixes:** the source prefix `proxy-set:` and the series prefix `proxy-set-source:`
   are checked at the entry points, never in `normalizeForecastSet` (G3).
3. **Forecast-set CLI:** a `--proxy-set` mode with its own input schema (`from_date`, `to_date`,
   `a`, `b`, `evidence_tier`, `labels`) (G9).
4. **compare_forecast_losses:**
   - verifies proxy-set sources before any record (`proxy_set_not_found`,
     `proxy_set_rules_mismatch`, `proxy_set_not_journaled`,
     `proxy_set_windows_changed_under_current_tzdata`, `proxy_set_mismatch`);
   - adds `proxy_rule_variants` and `proxy_bar_series_versions` to its search;
   - ServerDeps gains the proxy-set store and read access to the computation journal;
   - its description string and docs/FORECAST_LOSS_COMPARISON.md are updated for the window rule,
     the verification and the new fields.
   - **The contract string stays `forecast_loss_comparison_v1`.** It is a strict literal in stored
     forecast-loss journal records; bumping it would make them unreadable (G9).
5. **Period usage:** the third observing scope.
6. **package.json:** `bin` entries and npm scripts for `tradingview-mcp-import-bar-series` and
   `tradingview-mcp-export-proxy-set`, hand-edited into the lock's root `bin`, as for 0.1.14 (G9).

**Downgrade notes, for the release notes (G9):**
- 0.1.14 rejects the new `tool_name` value in period-usage records. After the first realized
  covariance record, every period-usage read or write under 0.1.14 fails closed, including the
  ledger and forecast-loss tools.
- 0.1.14 cannot read joined sets whose windows start before D − 1.
- Those two fail closed. 0.1.14 does compare joined sets whose windows follow the old rule, but
  without verifying them against their proxy set (H5).

## Tests (planned; synthetic fixtures only)

- **A #100-shaped worked example:**
  - M15, America/New_York 16:45, Mon–Fri, `max_missing_slots` 6, `from_previous_endpoint`,
    `log_percent`;
  - bars from Friday 16:45 to Sunday 16:30 are not slots;
  - an absorbed Friday 16:45 bar shows as diagnostic count 1;
  - Monday's window starts at Friday's endpoint;
  - the first day is kept by reading the previous endpoint (D9), where #100 dropped it;
  - hand-computed RC and daily_outer for n = 1 and n = 2.
- **Rule validation:**
  - Kolkata off-grid, and the NY 16:00 / 120-minute seasonal off-grid;
  - the NY 02:30 gap and 01:30 fold;
  - interval 1440;
  - more than 5,000 dates;
  - a range outside coverage, including a `within_day` series that starts exactly at s(first),
    which must be accepted;
  - duplicate series;
  - the `window_too_long` backstop, unit-tested in isolation (G5).
- **DST days:**
  - Africa/Cairo or Asia/Jerusalem Friday windows of 92 and 100 slots, with a produced Friday;
  - Lord Howe 94 and 98, with Sunday in `day_weekdays`, since its transitions fall on Sunday
    02:00.
- **Labels (G1):**
  - 00:00 labels [x, x+1) as x, with the endpoint and window from e and s;
  - Cairo and Havana 01:00 give no duplicate labels;
  - Tokyo 07:00 windows start on UTC date D − 2 and join under the relaxed rule.
- **Forecast-set window bound (G2):**
  - for a `proxy-set:` source: D − 9 rejected; D − 8, D − 1 and D accepted; D + 1 rejected;
  - for a plain set: D − 2 rejected, and D − 1 and D accepted;
  - a stored 0.1.14 set, including one whose window starts on its own date, still loads after the
    upgrade.
- **Zone names (G7):** `america/new_york` is rejected; `US/Eastern` is accepted with its own
  `rules_sha256`.
- **Returns:**
  - a missing slot widens a step for all series;
  - the scaled sum invariant, including near-parity r_D = 0;
  - `within_day` versus `from_previous_endpoint`;
  - `log` versus `log_percent`, and the pinned formula bits.
- **Drop causes:** each cause in order; the holiday cascade; the first day reading the previous
  endpoint before `from_date`.
- **Metamorphic:**
  - a permutation of the series permutes the axes;
  - multiplying prices by c changes log returns only within a tolerance;
  - identical series give singular but PSD RC, reported in diagnostics.
- **Join and verification:**
  - a contiguous range with explicit nulls joins;
  - a deleted date, an edited proxy value, a changed window, or a `proxy-set:` source on the plain
    import all fail;
  - `compare_forecast_losses` returns `proxy_set_mismatch` on a tampered set;
  - a proxy set placed directly in the store with no journal record is rejected
    (`proxy_set_not_journaled`), and one with a removed date is rejected
    (`proxy_set_rules_mismatch`) (G4);
  - a tzdata version change that resolves the same boundaries leaves the proxy-set ID unchanged;
  - tzdata drift that moves a boundary fails closed with
    `proxy_set_windows_changed_under_current_tzdata`, using an injected zone resolver (H6);
  - a proxy set with identical-close series is computed and reported, but the join refuses it
    (`proxy_set_has_identical_series`) (H1).
- **Records:**
  - the write order, and failure injection between the three writes, with the journal-failure
    error naming the period records (G6);
  - the journal is written without `research_id`;
  - the same proxy set recomputed under another `research_id`, or under a different tzdata version
    that resolves the same boundaries, passes the journal conflict check (H2, H6);
  - `rules_sha256` variants and bar-series versions are counted in both searches, across research
    IDs and for untracked calls;
  - retry conflicts;
  - the period envelope includes the previous endpoint bar, and for `within_day` starts at
    s(first).
- **Mutation run:**
  - the grid check, gap and fold, labels, window start and the 8-day rule;
  - the endpoint, the step widening, P₀ and r_D;
  - the drop order and `max_missing_slots`;
  - the unit scale;
  - join contiguity and the compare verification;
  - the record order.

## Decisions (user, 2026-09-29)

1. **D1, names:**
   - the tool `compute_realized_covariance`;
   - the CLIs `tradingview-mcp-import-bar-series` and `tradingview-mcp-export-proxy-set`;
   - the join is `--proxy-set` on `tradingview-mcp-import-forecast-set`.
2. **D2, input:** local imported bar artifacts only.
3. **D3, output:** a proxy-set artifact joined into forecast sets by the CLI. `compare_forecast_losses`
   verifies the link (F2).
4. **D4, rules:** all fields are required, with no defaults and no preset. The rules are strict and
   canonical. #100 is a worked example in the docs.
5. **D5, windows (option A):** windows show the realized span. The forecast-set rule is relaxed to
   8 calendar days before the date.
6. **D6, records:** period usage per bar series plus the proxy-set source record. An append-only
   computation journal on every call, with rule-variant counts here and in
   `compare_forecast_losses` (F8).
7. **D7, units:** `return_unit` is required, and the formulas are pinned.
8. **D8, second proxy:** the daily-return outer product is always included.
9. **D9, first day:** the previous produced day's endpoint is read even before `from_date`, and
   recorded in the envelope. #100 dropped this day instead.
10. **D10, slot threshold:** `max_missing_slots` replaces `min_common_slots`.
11. **D11, the relaxed window rule (G2):** it applies only to `proxy-set:` sources, as
    D − 8 ≤ UTC date(from) ≤ D. Plain sets keep the released rule.
12. **D12, verifying proxy sets (G4):** a light check on every read. It re-derives dates, windows
    and expected slots from the rules, checks `rules_sha256`, and requires a journal record. Values
    edited directly in the owner-only store are outside the protection boundary, as for the other
    stores. Recomputing from bars was not chosen: it would tie the comparison tool to the bar store
    and cost up to about 2 s.
