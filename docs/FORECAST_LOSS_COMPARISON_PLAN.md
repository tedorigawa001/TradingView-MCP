# compare_forecast_losses: implementation plan (rev 2.1, review approved)

Implements docs/FORECAST_LOSS_COMPARISON_DESIGN.md rev 4.1 (commit 13f5607). The design governs:
where this plan and the design differ, the design wins and this plan is corrected.

Review history:
- rev 1: APPROVE WITH FINDINGS, 5 MEDIUM and 6 LOW;
- rev 2: APPROVE WITH FINDINGS, 1 MEDIUM and 5 LOW (Q1–Q6).

Rev 2.1 folds them all in. Section 7 lists the implementation constants the design leaves open, so
they are fixed before any code; the contract doc will carry them too. No design rule changes.

## 1. Files

| File | New or changed | Content |
|---|---|---|
| `src/seededRandom.ts` | new | `createRandom(seed: number)`, moved unchanged from the three identical copies |
| `src/featureOutcomeRelationships.ts`, `src/leadLagRelationships.ts`, `src/syntheticNullSeries.ts` | changed | Import `createRandom`. No behaviour change. The other generator copies in the repository (`mulberry32` in `strategyWalkForwardFalsificationAudit.ts`, and the string-seeded variants in `carryPanelBootstrap.ts`, `carryPanelPrimaryTest.ts`, `strategyStress.ts`, `volumeProfileReactionStudy.ts`, `sessionAuctionStudy.ts`) differ and stay untouched (#8). |
| `src/researchPeriodUsage.ts` | changed | Stored schema: one `tool_observed` variant with `tool_name` and `scope` enums, and a refine binding each tool to its scope. `recordToolAccess(input)` is unchanged and still bound to the ledger internally. New `recordToolAccessBatch(tool, inputs)`, where `tool` is a typed argument set by server code and mapped to its scope inside the store; the input schema stays strict, so callers cannot supply `tool_name` or `scope` (#3). Tool-specific limitations in `assess()`. |
| `src/forecastSet.ts` | new | Strict schema, validation, normalization (n = 1 → scalars), canonical hash, `ForecastSetStore` (content-addressed, like `BacktestLedgerStore`), label cap (section 7) |
| `src/forecastSetCli.ts` | new | Import CLI `tradingview-mcp-import-forecast-set` (`--input <abs> --confirm-local-import`), starting with `#!/usr/bin/env node` (#4) |
| `src/numerics.ts` | new | Cholesky, the inverse and log det from the factor, and the Frobenius inner product. **PSD check (#1):** Cholesky(P + τI) with τ = 1e-12·max\|P\| succeeds (equivalent to λ_min > −τ); the all-zero matrix is valid. **Φ (#2):** an accurate erfc by Cody's rational approximations (relative error around 1e-15). Spearman: average ranks for ties, then Pearson on the ranks; undefined when either rank vector is constant (#9). |
| `src/forecastLossComparison.ts` | new | The pure computation: validity, losses, drops, DM/HAC, the favoured side, blocks, D′, trims, k*, the secondary and distinctness, bootstrap, the outcome table, and limitations. No I/O. p_B is computed as Φ(−DM), never 1 − p_A (#2). |
| `src/forecastLossJournal.ts` | new | Namespace `forecast_loss_comparison_exploration` on `AppendOnlyFirstSeenLog`; `TRADINGVIEW_MCP_FORECAST_LOSS_JOURNAL_PATH`; the two `search` scopes |
| `src/server.ts` | changed | Registers `compare_forecast_losses`. `ServerDeps` gains `forecastSets?: Pick<ForecastSetStore, "get">` and `forecastLossJournal?: Pick<ForecastLossJournalStore, "record">`, and `researchPeriodUsage` adds `"recordToolAccessBatch"` (#5). `usage_access_id` has its own schema with a 100-character maximum (#11). Order: period batch, then journal, then response. |
| `package.json`, `package-lock.json` | changed | The `bin` entry, hand-edited into the lock's `packages[''].bin` without `npm install` (#4), and an `import:forecast-set` npm script |
| `test/unit/server.test.mjs` | changed | `makeDeps` gets throwing defaults for both new stores and for `recordToolAccessBatch` (#5). The tool-count test becomes 108 and adds the name, in step 6 (#4). |
| `scripts/benchmark-forecast-loss.mjs` | new | The performance check, outside the unit suite (#10) |
| `docs/FORECAST_LOSS_COMPARISON.md` | new | The public contract, including the section 7 constants |
| `docs/RESEARCH_PERIOD_USAGE.md`, `README.md`, `docs/BACKLOG.md` | changed | Automatic tracking now covers two tools; tool count 107 → 108; #101 status |

Paths follow the existing pattern: `TRADINGVIEW_MCP_FORECAST_SET_DIR` defaults to
`~/.tradingview-mcp/forecast-sets`, and the journal defaults to
`~/.tradingview-mcp/forecast-loss-journal.jsonl`. No test uses a default path: every new store is
injected, and `makeDeps` throws if one is not.

Nothing reuses `symmetricEigenvalues` (absolute thresholds, not scale-invariant, #1), either
`normalCdf` copy (Abramowitz–Stegun, error up to 7.5e-8, #2), or `neweyWestConfidenceInterval`
(it clamps S).

## 2. Order of work

Each step is its own commit, and the full unit suite passes after each step.

1. **Seeded generator extraction.**
   - Before moving anything, a golden test pins the first 20 outputs for seeds 0, 1, 0xffffffff
     and both existing `EMPIRICAL_NULL_SEED` values (20260729, 20260731) (#8).
   - The copies and the seed constants are module-private, so the "before" values are captured by
     a one-off script that evaluates the verbatim function body. The values are committed as
     literals, with no temporary exports (Q4).
   - The existing empirical-null and synthetic-null output tests are a second guard.
   - The same test must pass after the move, and the existing lead-lag and feature-outcome tests
     must pass untouched.
2. **Period-usage store extension.**
   - Existing records still parse, tested against stored ledger lines copied from the current
     format in a fixture.
   - The existing test that `recordToolAccess` rejects `tool_name` and `scope` in its input passes
     unchanged (#3).
   - Stored records with the forecast tool and the ledger scope, and the reverse, are rejected.
   - `recordToolAccessBatch`: atomic, conflict- and capacity-checked, reusing `recordBound`.
   - `assess()` limitations per tool.
   - Mutation target: removing the binding refine.
3. **Forecast set.**
   - The schema rules: dates, windows (L4), n ≤ 8, unique series IDs, reserved prefixes,
     horizon 1, 5,000 dates, 24 MiB, and the label cap.
   - n = 1 canonicalization, and one hash function shared by both paths.
   - The store (exclusive create, fsync, link, read-back hash check).
   - The CLI with its shebang, the package.json and lock `bin` entries, and the npm script. The
     existing bin/lock/shebang test in `researchReproduction.test.mjs` stays green (#4).
4. **Computation.** `forecastLossComparison.ts` plus `numerics.ts`, tested with every design test
   except those that need the journal:
   - reference fixtures from section 3;
   - the PSD scale sweep: rank-one and slightly indefinite matrices at c = 1e-12 … 1e12 (#1).
     The fixtures stay at least 10·τ from the boundary, for example λ_min = −1e-9·max|P| for
     "slightly indefinite" (Q3);
   - Φ against scipy (#2);
   - Spearman with ties;
   - the HAC function directly at T = 2–5 with hand-computed values, so the lag cap
     min(T − 1, …) is reachable and its mutant killable (#7).
5. **Journal and `search`.** The record fields (M2); the per-research_id scope; the overlap-set
   scope (series ∩ and envelope overlap); `prior_overlap` aggregation with truncation (P3).
6. **Tool.** End to end through the MCP client:
   - the write order;
   - a failure in either write returns no statistics;
   - the untracked cap;
   - the inline path (scalar, ≤ 2,000 dates);
   - the `usage_access_id` derivation, its 100-character limit, and retries;
   - an artifact-ID mismatch;
   - `not_evaluable` is still recorded;
   - a response size bound (#6, Q2): the JSON for 5,000 dates with the maximum labels and a
     saturated research-ID union stays under 64 KiB;
   - the tool-count test updated to 108 in this step (#4).
7. **Docs.** The contract doc, the period-usage doc, README and backlog.

After step 7:
- a mutation run over the design's full target list;
- a subagent code review;
- fixes and re-review;
- then a release (0.1.14), which is the user's to publish.

## 3. Reference values

- **Environment:** an isolated Python venv in the session scratchpad, so nothing touches the
  system Python:
  `python3 -m venv <scratchpad>/refenv && <scratchpad>/refenv/bin/pip install numpy scipy statsmodels`.
  This downloads packages from PyPI; the user approved it on 2026-09-28.
- **Generator script:** `test/fixtures/forecast-loss/generate_reference.py` is committed. It uses
  fixed synthetic series only:
  - an AR(1) d with T = 250;
  - heavy-tailed d with T = 1,000;
  - T = 101, and T = 100 (the evaluability boundary) (#7).
- **What it computes:**
  - L, S and DM via OLS of d on a constant, with `cov_type="HAC"`,
    `cov_kwds={"maxlags": L, "use_correction": False}` and `use_t=False` passed explicitly;
  - p_A and p_B as scipy `norm.cdf(DM)` and `norm.sf(DM)`.
- **Output:** `test/fixtures/forecast-loss/hac-reference.json` holds the d arrays themselves
  (`json.dumps` round-trips doubles exactly; TypeScript never regenerates the series), the values,
  and the numpy, scipy and statsmodels versions (#7).
- **Tolerance:**
  - L is compared as an exact integer;
  - S and DM to a relative 1e-10;
  - p_A and p_B to a relative 1e-12 (#2).
- **The DM range (Q6):** the reference DMs stay within |DM| ≤ 30. At extreme DM, p can underflow
  to a subnormal or 0; that is documented, and such a p is compared absolutely.

  The tests never run Python.

## 4. Tests

- Every test listed in the design's Tests section, mapped to steps 4–6, plus the additions in
  steps 1–6 above.
- Every mutation target listed in the design, run after step 7 with a harness that mutates
  `build/` and runs `node --test` directly, never `npm test`.
- The performance check (5,000 dates of 8x8 matrices with the bootstrap) is the separate script
  `scripts/benchmark-forecast-loss.mjs`, not a unit test, so the suite does not become
  timing-dependent (#10). The expected compute is under 1 s; parsing a 24 MiB artifact is likely
  the dominant cost, and the benchmark reports it separately.

## 5. Risks

- **The shared period-usage store:** the union refactor touches records written by
  `summarize_backtest_ledger`. The backward-compatibility fixture and the unchanged spoofing test
  in step 2 guard against it. The existing tests (about 1,040–1,090, counted
  differently by runner and by grep) must pass unchanged, except the tool-count test, which is
  updated in step 6.
- **Generator extraction:** it could shift random sequences. The step 1 golden values, captured
  before the move, guard against it.
- **Numerics:**
  - Cholesky on nearly singular forecasts: validity fails closed, so the day is null, never
    NaN-propagated.
  - The PSD check is a Cholesky with a relative shift. Its worst-case backward error at n = 8 is
    about c·n²·ε·max|P| ≈ 1e-14·max|P|, i.e. up to τ/100; typical errors are far smaller (Q3).
- **Tests writing to the home directory:** prevented by the throwing `makeDeps` defaults (#5).
- **Size:** the estimate is about 1,500–1,900 lines of source and 1,300–1,600 lines of tests.

## 6. Decisions (user, 2026-09-28)

1. **Names:** the tool is `compare_forecast_losses`, and the CLI is
   `tradingview-mcp-import-forecast-set`.
2. **Reference environment:** approved. numpy, scipy and statsmodels are installed into an
   isolated scratchpad venv from PyPI, when step 4 needs them.
3. **Release:** 0.1.14, with the version bump after the code review.
4. **Bootstrap seed:** 20260928 (#8).
5. **Label cap:** at most 50 distinct labels, each 1–64 characters (#6).

## 7. Implementation constants fixed before coding

These are left open by the design and fixed here. The contract doc will carry them.

| Constant | Value |
|---|---|
| Bootstrap seed | 20260928; the generator is `createRandom` from `src/seededRandom.ts` |
| Bootstrap draws R | 2,000 (design) |
| PSD test | Cholesky(P + τI) succeeds, τ = 1e-12·max\|P\|; the all-zero matrix is valid |
| Φ | Cody's erfc; p_B = Φ(−DM) |
| Spearman | Average ranks for ties, then Pearson on the ranks; a constant rank vector means undefined, so `not_distinct` |
| Labels | At most 50 distinct values, each 1–64 characters |
| `usage_access_id` | 1–100 characters, same character set as research IDs |
| Response size | Under 64 KiB for 5,000 dates with the maximum labels and a saturated research-ID union (tested). The returned union is capped at 100 sorted IDs, with the total count and `overlapping_research_ids_truncated` (Q2). |
| Stationary bootstrap (Q1) | One `createRandom(20260928)` stream across the R draws, in order. For each draw, the first index is floor(u·T). For each later position, draw u: if u < 1/20, the next index is floor(u′·T) with a fresh draw u′; otherwise it is (previous + 1) mod T. mc_se = sqrt(p(1 − p)/R). |
| PSD boundary (Q3) | The design's λ_min ≥ −τ is implemented as λ_min > −τ (Cholesky success). The two differ only on a measure-zero boundary, so a ≥/> mutant there is equivalent. |
| Sign-change share (Q5) | sign(0) = 0; a day counts as a change when the signs under the two proxies differ. |
| Scaled-copy λ (Q5) | The median of the ratios; for an even count, the mean of the two middle values. |
| Component hashes (Q5) | sha256 of `JSON.stringify` of the normalized component, a cross-version contract, since the hashes persist in the journal. `request_sha256` hashes `{"artifact":…,"contract":…,"loss":…}` with the keys in that order. |
| `recordToolAccessBatch` (Q5) | 1–20 inputs with unique access IDs, like `researchPeriodUsageBatchSchema`. The `tool` argument is checked at runtime against an enum, since TypeScript types are erased. |
