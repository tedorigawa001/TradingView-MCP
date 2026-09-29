# compute_realized_covariance: implementation plan (rev 2.1, review approved)

Implements docs/REALIZED_COVARIANCE_DESIGN.md rev 2.3. Rev 2.3 is rev 2.2 (commit b3a7c4e) plus
two clarifications from this plan's review: the Q1 identical-series definition and the
conditional limitation. The design governs: where this plan and the design differ, the design wins
and this plan is corrected. Section 7 fixes the implementation constants the design leaves open,
before any code; the contract doc will carry them too.

Review history:
- rev 1: APPROVE WITH FINDINGS, 7 MEDIUM and 9 LOW (Q1–Q16). All are plan-text fixes.
- rev 2 (diff check): APPROVE WITH FINDINGS, 1 MEDIUM (R1, design text) and 6 LOW (R2–R7).
  Commit approved once R1 is fixed.

Rev 2 folded in Q1–Q16, with the user's decisions of 2026-09-29 (section 6). Rev 2.1 folds in
R1–R7. R1 amends the design (rev 2.3).

## 1. Files

| File | New or changed | Content |
|---|---|---|
| `src/forecastSet.ts` | changed | The window rule is relaxed for `proxy-set:` sources (D11). **`RESERVED_SERIES_PREFIXES` stays unchanged** (Q2). A new `ENTRY_RESERVED_SERIES_PREFIXES` (adding `proxy-set-source:`) and the `proxy-set:` source check are enforced only in `normalizeInlineForecastSet` and a new `assertPlainForecastSetInput`, never in `normalizeForecastSet` (G3). |
| `src/forecastSetCli.ts` | changed | Plain mode calls the entry check. The new `--proxy-set` join mode has its own input schema; it verifies the proxy set and refuses identical-close series (H1). `importForecastSet` takes injected dependencies: store, proxy sets, journal and zone resolver (Q9). |
| `src/barSeries.ts`, `src/barSeriesCli.ts` | new | Strict schema, `BarSeriesStore` (`TRADINGVIEW_MCP_BAR_SERIES_DIR`), and the CLI `tradingview-mcp-import-bar-series` with shebang, strict UTF-8 and an injected store |
| `src/zonedTime.ts` | new | Wall time to UTC, as pinned in section 7. The resolver is an object `{tzdata, offsetAt, formatAt}`, so tests can inject another tzdata (Q4, H6). |
| `src/realizedCovarianceRules.ts` | new | Rules schema and canonicalization, `rules_sha256`, the zone-name checks, labels, e(D)/s(D), produced days and P(D), and call validation: grid, gap/fold, slot minimum, window backstop, date cap, `duplicate_series`, and the validation errors of Q12 |
| `src/realizedCovariance.ts` | new | The pure computation: the coverage check, slots, endpoints, P₀, steps, r_D, RC, daily_outer, the drop order, the invariant, the PSD backstop, the diagnostics (section 7), `identical_close_pairs` (Q1) and the limitations list |
| `src/proxySet.ts`, `src/proxySetCli.ts` | new | Proxy-set schema, `ProxySetStore` (`TRADINGVIEW_MCP_PROXY_SET_DIR`), and the light verification in the section 7 order (Q4). The CLI `tradingview-mcp-export-proxy-set` has exclusive create and injected dependencies. |
| `src/realizedCovarianceJournal.ts` | new | Namespace `realized_covariance_computation` on `AppendOnlyFirstSeenLog`, the conflict check over the H2 field list, lookup by proxy-set ID, and the search counts |
| `src/researchPeriodUsage.ts` | changed | Third `OBSERVING_TOOL_SCOPES` entry and its `assess()` limitations |
| `src/forecastLossComparison.ts`, `src/forecastLossJournal.ts` | unchanged | The contract string stays `forecast_loss_comparison_v1` |
| `src/server.ts` | changed | Registers `compute_realized_covariance`. `compare_forecast_losses` gains proxy-set verification, the variant counts (section 7) and an updated description string. ServerDeps gains the Pick types in section 7 (Q9). |
| `package.json`, `package-lock.json` | changed | `bin` entries and the npm scripts `import:bar-series` (step 2) and `export:proxy-set` (step 5). Each is hand-edited into the lock's root `bin` **in the same step** (Q8). |
| `test/unit/*` | new and changed | One file per new module, plus server and forecast-set additions. `makeDeps` gets a throwing stub for every method of every new dependency (Q9). |
| `test/fixtures/forecast-set/format-0.1.14/` | new | Golden stored sets (bytes plus `artifact_id`) produced by the 0.1.14 build **before** step 1 edits anything (Q2) |
| `test/fixtures/realized-covariance/` | new | Reference generator and values (section 3) |
| `scripts/benchmark-realized-covariance.mjs` | new | Performance check, outside the unit suite, in `mkdtemp` directories only (Q9) |
| `docs/REALIZED_COVARIANCE.md` | new | The contract, with #100's rules as the worked example and the must-say checklist of step 8 |
| `docs/FORECAST_LOSS_COMPARISON.md`, `docs/RESEARCH_PERIOD_USAGE.md`, `README.md`, `docs/BACKLOG.md` | changed | Window rule, verification and new fields; the third scope; tool count 109; #101 status |

No test uses a default path. Every new store, the journal and the resolver are injected, and
`makeDeps` throws if one is not. A journal read at a default path would create
`~/.tradingview-mcp` and a lock file, because `serialize()` goes through `acquireFileLock()` and
`mkdir` (Q9).

## 2. Order of work

Each step is its own commit, and the full unit suite passes after each step. **There is no release
or tag between steps 1 and 7** (Q15). The relaxed window rule lands in step 1, but only the step 7
join can reach it, and the verification that justifies it lands in step 7 too.

1. **Forecast-set changes.**
   - Before editing, produce golden stored sets with the 0.1.14 build and commit them, in the
     style of `test/fixtures/period-usage/format-0.1.13.jsonl`. The goldens cover:
     - a plain set;
     - a set whose window starts on its own date;
     - a set with a `proxy-set:` source, with `source_id` = `proxy-set:<64 hex>` and
       `source_sha256` = `sha256:<same hex>`, so step 7 cleanly returns `proxy_set_not_found`;
     - a set with a `proxy-set-source:x` series.
   - **Producing the goldens (R2):**
     - `build/` is not committed, so first confirm `git diff --quiet 6f87dfe -- src/ package.json
       package-lock.json` and run `npm run build` on the unedited tree. That is exactly the 0.1.14
       build.
     - Store each golden byte-exact: the stored body and its `artifact_id` as JSON strings in one
       manifest file. The hashed bytes then survive Windows autocrlf checkouts and have no
       trailing newline.
     - The test writes each body into a mkdtemp store as `<hex>.json` with mode 0600 in an 0700
       directory, as the `format-0.1.13` test does. `get()` enforces owner-only permissions.
   - The relaxed window rule for `proxy-set:` sources: D − 8 ≤ UTC date(from) ≤ D.
   - The entry checks (Q2).
   - Tests:
     - the bound for both kinds of set (G2);
     - every golden still loads to identical bytes and `artifact_id`;
     - the plain CLI and the inline path reject a `proxy-set:` source and a `proxy-set-source:`
       series.
2. **Bar series.**
   - The schema:
     - the interval divides 1440;
     - open times are on the grid, strictly increasing and within the section 7 range;
     - each close is a number or null;
     - the entry-reserved series prefixes are rejected.
   - The store, and the CLI with its bin entry, lock edit and `import:bar-series` script.
3. **Zoned time and rules.**
   - `zonedTime`, pinned as in section 7. The fixtures are the instants derived by hand in
     section 3, cross-checked with zoneinfo (P7):
     - NY 2026-03-08 02:30 (gap) and 2026-11-01 01:30 (fold);
     - Cairo 2026-04-24 00:00 (gap) and 01:00 (unique), and 2026-10-29 23:30 (fold);
     - Havana 00:30 in March and in November;
     - Lord Howe 2026-10-04 02:00 (gap) and 2026-04-05 01:30 (30-minute fold);
     - Kiritimati 1994-12-31 and Apia 2011-12-30 (skipped days);
     - São Paulo 2018 midnight;
     - `hourCycle: "h23"` at 00:00 (Q3).
   - Rules canonicalization; `day_weekdays` duplicates rejected.
   - The zone-name tests pin only two cases (Q13): `america/new_york` is rejected, and
     `US/Eastern` is accepted with its own hash.
   - Labels, e and s: the NY 16:45, 00:00, Tokyo 07:00 and Cairo/Havana 01:00 cases (G1).
   - Validation:
     - grid, gap/fold, slot minimum, date cap and `duplicate_series`;
     - the Q12 errors;
     - the window backstop, unit-tested in isolation (G5).
4. **Computation.** `realizedCovariance.ts`, checked against section 3 and hand-built fixtures:
   - the #100-shaped week;
   - `within_day` against `from_previous_endpoint`;
   - `log` against `log_percent`, with the pinned bits as JS regression goldens;
   - widening, P₀ and r_D;
   - the drop order and the holiday cascade;
   - DST days (Q14):
     - Africa/Cairo Fridays: 92 slots on 2026-04-24, 100 on 2026-10-30;
     - Lord Howe Sundays: 98 on 2026-04-05, 94 on 2026-10-04;
   - near-parity r_D = 0;
   - `range_outside_series_coverage`, including a `within_day` series that starts exactly at
     s(first), which must be accepted;
   - the diagnostics (section 7);
   - `identical_close_pairs`, with the Q1 counterexamples: one bar deleted, and weekend or Friday
     16:45 bars stripped;
   - the limitations list, with `first_interval_spans_non_slot_bars` returned only with
     `from_previous_endpoint`;
   - the metamorphic tests.
5. **Proxy set, export and journal.**
   - The store; the verification in the section 7 order, including tzdata drift through an injected
     resolver (Q4, H6); a tzdata change that resolves the same boundaries leaves the ID unchanged
     (Q6).
   - The export CLI with its bin entry, lock edit and `export:proxy-set` script (Q8).
   - The journal:
     - the conflict check over the H2 fields;
     - the same set under another `research_id` or tzdata passes it (H6);
     - lookup by ID;
     - the search counts.
6. **The MCP tool.**
   - The period-usage scope.
   - `compute_realized_covariance` end to end:
     - the write order, and failure injection between writes (G6);
     - retries and conflicts;
     - untracked calls, which are still journaled;
     - the envelope for both `first_interval` modes;
     - the limitations;
     - the response-size bound at the section 7 worst case (Q11).
   - The tool-count test goes to 109.
7. **The join and the compare verification.**
   - The `--proxy-set` join:
     - contiguous ranges and explicit nulls;
     - the Q12 join errors;
     - refusal of identical series;
     - a Tokyo 07:00 set joins under the relaxed rule (Q6).
   - `compare_forecast_losses`:
     - verification before any record;
     - a hex mismatch between `source_id` and `source_sha256` gives `proxy_set_mismatch` (R2);
     - `proxy_set_mismatch` on each tamper case;
     - `proxy_set_not_found` for the golden stored 0.1.14 set with a `proxy-set:` source (Q6);
     - the variant counts, tracked and untracked, placed as in section 7 (Q10). They are absent
       for other sources, so the existing key-order and untracked tests stay green;
     - the updated description string.
8. **Docs, benchmark and release notes.**
   - The contract doc, the three changed docs, README (109) and BACKLOG.
   - **Must-say checklist (Q6):**
     - the zone-name case-check leak (H3);
     - the holiday cascade, about 7% against the comparison's 5% drop rule;
     - the same paths for the CLIs and the MCP process (H5);
     - an untracked computation followed by an export leaves no period record (G6);
     - stored `proxy-set:` sets fail closed;
     - tzdata drift (H4);
     - `Math.log` bits across engines;
     - the effective join limit (Q5);
     - scaled and inverted copies are not caught (Q1).
   - Release-note text with the G9 downgrade notes.
   - `scripts/benchmark-realized-covariance.mjs` (section 4).

After step 8:
- a mutation run over the design's full target list;
- a subagent code review, then fixes and re-review;
- a release (0.1.15), which is the user's to publish.

## 3. Reference values

The design fixes the formulas, so the references check the arithmetic, the slot logic and the
calendar, not a choice of estimator.

**(a) Calendar instants are independent of Intl (Q7a, P7).**
- The DST, gap, fold, skipped-day and label instants are derived by hand from the published zone
  rules and written as literal UTC values. The plan review's node results (Q3) agree with every
  one.
- The generator also cross-checks them with Python's standard-library `zoneinfo` in the same
  scratchpad venv. That is independent of ICU.
- The sealed study interpreter is never used, not even for a version check.

**(b) The arithmetic comes from an independent numpy generator,
`test/fixtures/realized-covariance/generate_reference.py` (P1).** It never imports playbook code.
It uses fixed-seed synthetic M15 series and covers:
- missing slots in one series;
- a weekend gap, a Friday 16:45 bar and a holiday;
- `within_day` and `from_previous_endpoint`;
- `log` and `log_percent`;
- m < interval (a UTC 00:00 boundary);
- Tokyo 07:00, as fixed UTC instants, with s(D) on UTC date D − 2;
- Tue–Fri production, so Monday's bars are non-slot bars;
- n up to 8, and one permutation;
- P(first) before `from_date`;
- `too_many_missing_slots`;
- an identical pair.

It writes the bars, the expected slot lists, windows, drop causes, RC and daily_outer to
`reference.json`.

**(c) Tolerances (Q7c).**
- Slots, counts, drop causes and windows are compared exactly.
- RC and daily_outer are compared to relative 1e-12. numpy's summation order and `log` can differ
  from V8 by an ulp.

**(d) Regression goldens.** The pinned formula bits, `rules_sha256` and `proxy_set_id` are JS
regression goldens, not cross-language references. Python's JSON number formatting differs from
JavaScript's.

**(e) Environment (R7).**
- `reference.json` records:
  - the numpy version, the Python version and the seed;
  - the tzdata version that `zoneinfo` used: macOS `/usr/share/zoneinfo/+VERSION`, or the
    `tzdata` package version.
- The existing scratchpad `refenv` is reused. Only if it is missing is it recreated from the host
  `python3`, with `python3 -m venv <scratch>/refenv && <scratch>/refenv/bin/pip install numpy`.
  That downloads from PyPI, so it needs the user's approval at the time.

**Hand-computed cases** for n = 1 and n = 2 over two days stay, small enough to check on paper.

## 4. Tests

- Every test in the design's Tests section, mapped to steps 1–7 as above.
- **Mutation:** every target listed in the design, run after step 8 with a harness that mutates
  `build/` in an isolated copy and runs `node --test` directly.
- **Benchmark (P4, Q5, Q3):**
  - compute: 8 series × 5,000 Mon–Fri days of M15, about 3.8 million closes, reporting import and
    compute times separately;
  - join: n = 8 over a sub-range of at most 4,000 dates, since a full 5,000-date join exceeds the
    24 MiB forecast-set limit;
  - verification (R5): 500 ms for the re-derivation of 5,000 dates alone (77 ms was measured for
    7,000 boundaries in review), and 1 s for the whole light check at n = 8 and 5,000 dates. The
    whole check reads and hashes the proxy set (up to about 14 MB) and looks the ID up in a journal
    of up to 32 MiB. D12's rationale compares against about 2 s of recomputation from bars.
- Estimated size: about 1,500–2,000 source lines and 2,000–2,500 test lines (Q16).

## 5. Risks

- **Released tools:**
  - The forecast-set change is guarded by the 0.1.14 goldens in step 1.
  - The compare tool uses the new dependencies only for `proxy-set:` sources.
- **Zoned time:**
  - The core risk is Intl at transitions. The algorithm is pinned (section 7), the resolver is
    injectable, and the instants are hand-derived with a zoneinfo cross-check.
  - The review found no two transitions within 78 h in any of 417 zones from 1970 to 2036, which
    makes the ±36 h two-point sampling exact over that range.
  - The existing `newYorkCivilTimeToIso` (src/cot.ts) assumes no transition and is not reused.
- **Size (Q5):**
  - A full 8-series, 5,000-date joined set is 26.9–28.6 MiB, over the 24 MiB forecast-set limit.
    The effective join limit for n = 8 is about 4,000 dates, and the contract doc says so.
  - Raising the limit was not chosen, because it is a released-tool change (P6).
- **Test pollution:** there are no default paths in tests. The journal read side effect (Q9) is
  why `makeDeps` must stub every new dependency explicitly. `makeDeps` already leaves
  `backtestLedgers` at a default path.
- **CI matrix (Q13):** Node 22 and 24 on three OSes. Tests never pin tzdata strings, alias
  resolution, or the lowercase-alias leak.

## 6. Decisions (user, 2026-09-29)

1. **P1, reference values:** an independent numpy generator in the scratchpad venv. No playbook
   code runs, and the sealed interpreter is never used.
2. **P2, order:** the released-tool forecast-set change goes first, in step 1, with 0.1.14 goldens.
3. **P3, release:** 0.1.15 after the code review, with 109 tools. No release between steps 1
   and 7.
4. **P4, benchmark:** compute at 8 × 5,000 days; the join at no more than 4,000 dates.
5. **P5, identical series (Q1):** bitwise equality at every point used by a kept day. The design is
   amended to rev 2.3.
6. **P6, join size (Q5):** document the effective join limit (about 4,000 dates at n = 8). The
   24 MiB forecast-set limit is not raised.
7. **P7, calendar references (Q7a):** hand-derived instants, cross-checked with Python `zoneinfo`
   in the scratchpad venv.

## 7. Implementation constants fixed before coding

| Constant | Value |
|---|---|
| `algorithm_version` | `realized_covariance_v1` |
| Request-hash contract | `realized_covariance_v1`; keys `contract`, `bar_series`, `rules_sha256`, `from_date`, `to_date` in that order |
| Bar series | At most 600,000 bars and 32 MiB normalized. `interval_minutes` is an integer dividing 1440. `open_time` is integer seconds with 0 ≤ t ≤ 4,102,444,800 (2100-01-01). `evidence_tier` uses the forecast-set enum. |
| Proxy set | At most 5,000 dates and 32 MiB normalized |
| Rules bounds (Q11) | `day_end_local` is `HH:MM` from 00:00 to 23:59. `day_weekdays` has 1–7 entries from ISO 1–7; duplicates are rejected and the list is sorted. `max_missing_slots` is an integer from 0 to 1,440. |
| Journal | `TRADINGVIEW_MCP_REALIZED_COVARIANCE_JOURNAL_PATH`, default `~/.tradingview-mcp/realized-covariance-journal.jsonl`; 32 MiB file, 16 KiB record |
| Wall time to UTC (Q3) | See below |
| Label threshold | m ≥ `interval_minutes` gives label x, else x − 1 (m in minutes after local midnight) |
| Invariant | \|Σ steps − r_D\| ≤ 1e-12 · max(1, max\|y\|), per series |
| PSD backstop | `allFinite`, `symmetricWithin(1e-12)` and `positiveSemidefinite` from the compare tool's checks |
| Verification order (Q4) | See below |
| `identical_close_pairs` (Q1, R4) | Pairs i < j whose closes are bitwise equal at every point used by a kept day (each P₀ and P₁…P_m). With no kept day the list is empty. |
| Diagnostics (Q11) | See below |
| `tzdata` | `process.versions.tz`, or `unknown` when absent. Injected resolvers carry their own string. |
| Search, this tool | `search: {calls, distinct_rules, distinct_bar_series_versions}` |
| Search, compare tool (Q10) | For `proxy-set:` sources only, `proxy_rule_variants` and `proxy_bar_series_versions` go inside `search`, tracked or untracked (untracked: next to `status` and `limitations`). They count journal records sharing a series ID whose envelope overlaps `forecastSetEnvelope(set)`. They are absent for other sources. |
| ServerDeps (Q9) | `barSeries: Pick<BarSeriesStore, "get">`; `proxySets: Pick<ProxySetStore, "get" \| "register">`; `realizedCovarianceJournal: Pick<RealizedCovarianceJournalStore, "record" \| "findByProxySetId" \| "search">`; optional `zoneResolver` |
| Error names | The design's 15 (rev 2.4, which added `invalid_date_range` and `join_run_has_no_kept_day` from the code review); plus `no_produced_days`, `interval_mismatch`, `time_zone_case_variant`, `unknown_time_zone` (Q12); plus `join_range_not_contiguous` and `join_length_mismatch` for the join; plus `bar_series_not_found` (step 6) |
| Date bounds (code review C1) | `from_date` and `to_date` from 1970-01-01 to 2099-12-31, the bar-series time range; outside it, `invalid_date_range` (design rev 2.4) |
| Access IDs | Base = `usage_access_id` (1–100 characters, research-ID character set) or `rc-access:<uuid>`; index 0 is the `proxy-set-source:` record, then the bar series in axis order |
| npm scripts | `import:bar-series`, `export:proxy-set` |
| Response size (R6) | Under 64 KiB at the worst case (tested): 8 series, full diagnostics for every weekday, and a saturated `period_usage_prior_overlap` summary (100 research IDs of 120 characters) |
| Prior overlap | With `research_id`, `search` carries `period_usage_prior_overlap` from `summarizePriorOverlap`, as the compare tool does |

**Wall time to UTC (Q3).**
1. W is the local wall time read as a UTC instant, `Date.UTC(y, m−1, d, hh, mm)`.
2. The zone's offsets are sampled only at W − 36 h and W + 36 h.
3. Each distinct offset o gives a candidate W − o.
4. A candidate survives if formatting it in the zone gives back year, month, day, hour, minute and
   second exactly.
5. No survivors means a gap. More than one survivor means a fold. Exactly one means unique.

The formatter is cached per zone and uses `hourCycle: "h23"`; `hour12: false` renders midnight as
"24:00" on this runtime.

**Verification order (Q4, as in design rev 2.3).** The first failing check gives the error:
1. `proxy_set_not_found`.
2. `rules_sha256`, then `dates`, give `proxy_set_rules_mismatch`. Neither can change with tzdata.
3. `proxy_set_not_journaled` if no journal record names this ID with the same `rules_sha256`
   (R3).
4. Re-derive windows and `expected_slots` together. If they differ, or re-derivation throws:
   - if no journal record for this ID has the current tzdata, the error is
     `proxy_set_windows_changed_under_current_tzdata`, carrying the journal's versions and the
     current one. `unknown` never counts as equal;
   - otherwise it is `proxy_set_rules_mismatch`.

**Diagnostics (Q11).**
- **Missing slots (R6):** a fixed-size summary over all produced days: `{days, zero_missing_days,
  min, p50, p90, max}`, with the nearest-rank quantiles. A histogram was not used, because with
  1-minute bars it can reach about 1,100 buckets.
- **Non-slot bars:** per series, bars whose open lies inside some produced day's realized window
  (kept or dropped) and is not one of that day's expected slots.
- **Invalid closes:** per series, bars in the read span whose close is null or not positive.
- **Modal times:** per series and ISO weekday of the local date, the most frequent local `HH:MM`
  of the first and of the last valid-close bar of each local date. Ties go to the earlier time.
