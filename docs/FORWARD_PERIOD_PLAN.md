# declare_forward_period: implementation plan (rev 2.2, review approved)

Implements docs/FORWARD_PERIOD_DESIGN.md rev 3.4. Rev 3.4 is rev 3.2 (commit 995c502) plus the P-Q1
clock-seam note and the R2 additions: the back-off, the journal clock check, and a second replay
exception. The design governs: where this plan and the design differ, the design wins and this
plan is corrected. Section 6 fixes the constants the design leaves open, before any code.

Review history:
- rev 1: APPROVE WITH FINDINGS. MEDIUM P-Q1 to P-Q4, LOW P-Q5 to P-Q14, and NITs.
- rev 2 (diff check): APPROVE WITH FINDINGS. LOW R1–R2 and NITs R3–R6; no further round needed.

Rev 2 folds in P-Q1 to P-Q14, with the user's decisions P1–P3 (section 5). Rev 2.1 folds in
R1–R6. Rev 2.2 records the design's rev 3.5 after the code review (C1): every line also carries
`ledger_anchor`, and H7 checks it.

## 1. Files

| File | New or changed | Content |
|---|---|---|
| `src/firstSeenStore.ts` | changed | `acquireFileLock(budgetMs = this.lockWaitMs)` and `serializeWithin(budgetMs, operation)`, detailed in step 1 (P-Q14). Every existing call keeps its 30 s default. |
| `src/forwardPeriod.ts` | new | Line schemas and validation; `ForwardPeriodJournal`; the pure functions (step 2) |
| `src/researchPeriodUsage.ts` | changed | Store options `{forwardPeriodPath, researchJournalPath, now}`, the record parse without the future-`accessed_at` refine (P-Q1, R6), the same-path refusal, the H7 check, declare and shorten, `assess()` and record-path fields, preflight v2, the `summary_only` form, the back-off |
| `src/strategyResearchJournal.ts` | changed | `findHypothesis(kind, id)` returns `{definition_hash, sequence, population}` or null, read under its own lock (step 3, P-Q9) |
| `src/forecastLossJournal.ts` | changed | `summarizePriorOverlap`: the `active_forward_period_declarations` column and the limitation (P-Q5) |
| `src/server.ts` | changed | The two tools; the preflight's `research_id`; the manual and batch record inputs without the future-`accessed_at` refine (P-Q1, R6; landed in step 1); `overlapped_forward_period_declarations` in the observing tools' `records` mappings (P-Q2); the batch map; the ServerDeps Pick additions; path wiring; 111 tools |
| `scripts/benchmark-forward-period.mjs` | new | Performance check, outside the unit suite, in mkdtemp directories only (P-Q13) |
| `test/fixtures/period-usage/format-0.1.15.jsonl` | new | A golden 0.1.15 ledger, produced before any change |
| `test/unit/*` | new and changed | `forwardPeriod.test.mjs`, plus additions to the period-usage, first-seen-store, research-journal, forecast-loss-journal and server tests. `makeDeps` stubs every new method so that it throws. |
| `docs/FORWARD_PERIOD.md`, `docs/RESEARCH_PERIOD_USAGE.md`, `README.md`, `docs/BACKLOG.md` | new or changed | Step 6 |
| `package.json`, `package-lock.json` | changed at release | The version bump only; there is no new bin or script |

**Paths (P1, P-Q3, P-Q11).** The store never resolves a home default unless the ledger path is
omitted (R5):
- **When the ledger path is omitted** (`createServer`'s default only): the ledger is
  `~/.tradingview-mcp/research-period-usage.jsonl`; the declarations journal is
  `TRADINGVIEW_MCP_FORWARD_PERIOD_JOURNAL_PATH` or `~/.tradingview-mcp/forward-period-declarations.jsonl`.
  `createServer` also passes `researchJournalPath: resolveStrategyResearchJournalPath()`, which is a
  string resolution with no file access.
- **With an explicit ledger path:** the declarations journal defaults to the ledger's own name with
  `.jsonl` replaced by `.forward-period-declarations.jsonl`, in the same directory. A ledger path
  without `.jsonl` gets the suffix appended (R5). Several ledgers
  in one directory, as some tests use, therefore never share a journal. `researchJournalPath` is
  absent unless passed.
- **Same-path refusal:** at construction, the declarations path is compared with the ledger path and
  with `researchJournalPath` if given. Each is resolved as the realpath of its nearest existing
  ancestor plus the remaining components, so `/var` and `/private/var` compare equal on macOS.

`makeDeps` always supplies `researchPeriodUsage`, so the default branch never runs in tests. No CLI
constructs the store.

## 2. Order of work

Each step is its own commit, and the full unit suite passes after each step. There is no release
until after the code review.

### Step 1. Groundwork, with no behaviour change

- **Golden ledger:** produce the 0.1.15 golden with the current build, before editing anything. It
  holds records from `summarize_backtest_ledger`, `compare_forecast_losses` and
  `compute_realized_covariance` (through `recordToolAccess` and `recordToolAccessBatch`), plus
  manual and batch records. A test requires it to read, check and extend.
- **`serializeWithin(budgetMs, operation)`** (P-Q14):
  - One budget covers both waits. The queue wait races a timer, which is cleared on settle and
    `unref`ed. The file lock gets the remaining budget through `acquireFileLock(remaining)`.
  - On timeout the call rejects with `HISTORY_LOCK_TIMEOUT`, and its operation never runs.
  - The queue tail becomes `Promise.all([predecessorSettled, thisSettled])`, so a caller that timed
    out never lets later callers skip ahead of a predecessor that is still running.
  - Mutual exclusion still rests on the O_EXCL file lock.
  - `acquireFileLock`'s default stays `this.lockWaitMs`, which `TV_MCP_HISTORY_LOCK_WAIT_MS`
    governs, for existing direct callers such as realYieldHistory.ts:91. There is no per-instance
    option.
  - **Tests:** a held file lock times out within the budget; an in-process queue behind a long
    operation times out within the budget, and the next caller still waits for that operation;
    `serialize` is unchanged.
- **The clock seam** (P-Q1):
  - `ResearchPeriodUsageStore` takes `now()`. One reading per call drives `recorded_at`,
    tool-record `accessed_at`, the future-`accessed_at` check, the clock-backwards checks and the
    preflight's `checked_at`.
  - The store and the server's manual and batch inputs parse without the future-`accessed_at`
    refine (R6). The batch schema keeps `from < to`, the 1–20 bounds and the unique-`access_id`
    refine. The store checks `accessed_at ≤ now()` itself.
  - The server input change lands here in step 1, not in step 5. So step 1 has one visible change:
    a future `accessed_at` in a batch becomes a tool error from the store, instead of an input
    validation error. A test pins the new error text.
  - The exported `researchPeriodUsageRecordSchema` keeps its real-clock refine, so the test at
    researchPeriodUsage.test.mjs:258 still holds.

### Step 2. The declarations journal and the pure logic (`src/forwardPeriod.ts`)

- **Line schemas:** `series_ids` must be unique (duplicates are rejected, not removed) and are
  stored sorted. Both kinds are validated.
- **`ForwardPeriodJournal`**, with the repo's two journal guards (P-Q4):
  - a strict framing check: the file ends in `\n` and has no blank lines;
  - a clock check before each append: refuse when `now` is earlier than the last line's
    `recorded_at` (`forward_period_clock_moved_backwards`). This is the second line of defence
    behind the read-time check (R3).

  Every lock acquisition goes through `serializeWithin(2,000 ms)`, the step-1 lookups included.
  ENOENT reads as empty.
- **Schema checks against store checks (P-Q7).**
  - The input schemas check only format: identifiers, `from < to`, `to` ≤ 2100-01-01, series count
    and uniqueness, reason length.
  - The lead, the length, the `new_end` rules, exclusivity, usage and the hypothesis are checked in
    the store, in the design's order. That order lets an ID conflict or a hypothesis error come
    before the lead, and lets an idempotent retry succeed after the lead has passed.
- **Pure functions, tested with fixed clocks:**
  - `effective_to`, `state`, `shortened_after_start` and `late_shortening`, including the
    `from` − 24 h boundary;
  - **the as-of view (P-Q8):** declaration and shortening lines with anchor < s; `state` at the
    record's `recorded_at`; ledger-derived entry counts over records with sequence ≤ s, the record
    included. `prior_overlap` keeps < s;
  - listing by [from, to) against activity by [from, `effective_to`), and the
    `active`/`withdrawn`/`tail_only` partition;
  - the access counts:
    - by relation, phase, purpose and source;
    - `distinct_tool_requests`;
    - both coverage fields;
    - `ended_without_declaring_research_access`;
  - `related_declarations`;
  - the sort order and the caps.

### Step 3. Declaring, shortening and hypotheses in the store

- **`StrategyResearchJournal.findHypothesis`** for both kinds, read under its own lock (P-Q9).
- **The store:** options, the same-path refusal and the H7 check.
- **`declareForwardPeriod(input, {findHypothesis})`**, in the design's step order:
  1. look up under the declarations lock, then release it;
  2. read the hypothesis;
  3. take ledger → declarations with one `now`: look up again, then the lead, the length,
     exclusivity and recorded usage;
  4. append with `ledger_sequence_at_write`.

  A hit builds its response under ledger → declarations.
- **`shortenForwardPeriod`**, in the design's error order, including
  `forward_period_shortening_conflict`. The journal errors come at lock acquisition.
- **Tests:**
  - every error, in order;
  - every boundary, with the injected clock;
  - retries after the lead has passed and after shortenings;
  - series order;
  - the hypothesis kinds, a missing hypothesis, and the `in_sample` flag;
  - the same-path refusal, including through a symlinked directory;
  - lock order under concurrent calls.

### Step 4. Reporting

- **Check and preflight (P-Q6):** both take ledger → declarations through `serializeWithin`, run the
  H7 comparison, and fail closed with `forward_period_journal_unavailable`,
  `forward_period_ledger_regressed` or `forward_period_clock_moved_backwards`.
- **The read-time clock check (R3)** runs under both locks on every path, after the ledger's own
  clock check, at lock acquisition. It sits beside the other two journal errors, so declare never
  evaluates the lead against a backward clock, and a hit built under both locks fails the same way.
  - `assess()` gains `forward_period_declarations` in its current state.
  - The check adds the ten declaration limitations when a declaration is listed, as the preflight
    does.
- **Record paths:** under ledger → declarations with the short bound, before any append, and wrapped
  so no error escapes. They compute:
  - `overlapped_forward_period_declarations` as of the new record, including it;
  - the as-of `forward_period_declarations` inside `prior_overlap`.

  Every field carries `status: "available"` or `status: "unavailable"` with a reason. On
  `unavailable`, the limitation `forward_period_declarations_unavailable` goes into
  `prior_overlap.limitations`, and the access is still appended.
- **Back-off (R1):**
  - **Effect:** record paths skip the declarations read for 30 s and return `unavailable` at once,
    with the reason `lock_timeout_backoff` and `retry_after_ms`.
  - **Scope:** the state is keyed by the resolved declarations path, the same key as the queue.
    Tests in separate mkdtemp directories never share it, and two stores on one ledger agree.
  - **Clock:** a monotonic clock (`performance.now`), injectable for tests, so the 30 s expiry is
    tested without sleeping.
  - **Triggers:** any declarations-lock timeout on that path, from a record path, check, preflight,
    declare or shorten. Only lock timeouts count: an unreadable journal, a regressed ledger or a
    backward clock never starts it.
  - The check and the preflight always try, and fail closed.

  So a stale lock cannot turn a queue of record calls into a ledger-lock timeout in another
  process.
- Identical retries replay.
- `summarizeAssessment` gives the `summary_only` form.
- `preflightOos` v2, with the rules, the reasons, the required actions, the limitation rename and
  the conditional limitations.
- **Tests:**
  - accounting;
  - replay;
  - unavailable in every mode (a torn line, a stale lock, a regressed ledger, a backward clock,
    ENOENT), and the back-off;
  - every preflight rule, including more than 20 declarations and the three flags staying `false`.
  - **The H1 scenario itself:** another process holds a stale declarations lock while a check in
    this process holds the ledger lock, and a record in a third process still appends.

### Step 5. Summaries and the MCP tools

- **`summarizePriorOverlap`** (P-Q5): its input type gains the record's `research_id`. The per-series
  column `active_forward_period_declarations` is taken from the record's exact
  `overlapped_forward_period_declarations.by_relation`, never from `listed`:
  - `unavailable` becomes the same status;
  - an absent field omits the column, so the hand-built fixtures in forecastLossJournal.test.mjs
    stay valid;
  - the limitation `access_overlaps_a_declared_forward_period` is added when a count is non-zero.
- **Server:**
  - the two tools, with `confirm: true` and strict inputs;
  - the preflight's `research_id`;
  - `overlapped_forward_period_declarations` added to the `records` mappings of
    `compare_forecast_losses` and `compute_realized_covariance` (P-Q2);
  - the batch map `forward_period_declarations_by_id`, holding the static fields only and omitted
    under `summary_only`;
  - the ServerDeps Pick additions (`declareForwardPeriod`, `shortenForwardPeriod`,
    `findHypothesis`);
  - the path wiring;
  - `makeDeps` stubs;
  - the tool count goes to 111.
- **Server tests, end to end:**
  - declare;
  - an access by another study through each observing tool, with its `records` field and
    `per_series` column;
  - check, and the preflight for both studies;
  - shortening;
  - the batch map and `summary_only`.

### Step 6. Docs and benchmark

- **`docs/FORWARD_PERIOD.md`**, with its must-say list:
  - intent, not proof;
  - the local clock and data labels;
  - the unauthenticated `research_id`;
  - the gaming paths;
  - one preflight per series;
  - declaring through outcome horizons;
  - the observing tools record their own envelopes;
  - rule 3 permanence;
  - the paths shared by processes and the new environment variable;
  - recovery from a stale declarations lock and from a regressed ledger;
  - the 2 s cost per ledger operation while a lock is stale, and the back-off.
- **`docs/RESEARCH_PERIOD_USAGE.md`:**
  - preflight v2;
  - the preflight now takes `research_id`, unlike the check;
  - the new fields;
  - the declarations.
- **README:**
  - 111 tools;
  - the environment variable;
  - the `TV_MCP_HISTORY_LOCK_WAIT_MS` section gains the 2 s exception for the declarations journal.
- **BACKLOG** and the release-note text, including the downgrade note.
- **`scripts/benchmark-forward-period.mjs`** (P-Q13), run with 10,000 ledger records and 200
  declarations. On the development machine it must meet:
  - the check and the preflight under 200 ms;
  - declare under 300 ms;
  - a record path's added cost under 100 ms.

After step 6: a mutation run over the design's list and section 3's additions, a subagent code review
with fixes and re-review, and then release 0.1.16, which is the user's to publish.

## 3. Tests

- Every test listed in the design, mapped to steps 1–5 as above.
- **Clock:** every boundary is tested with the injected clock, never with sleeps:
  - the 24 h lead (`≥`);
  - the inclusive length bounds;
  - `from` − 24 h for `shortened_after_start` (`>`);
  - `new_end` in the first 24 h after `from`;
  - the state transitions.

  Tests that need a stale lock use the real 2 s bound, and there are few of them.
- **Released-tool compatibility (P-Q10).** Each item has a test:

  | Change | Test |
  |---|---|
  | `preflight_research_oos`: contract v2, the renamed limitation, the new rules, `research_id`, `checked_at` from the seam | step 4 preflight tests; researchPeriodUsage.test.mjs :33/:38 updated |
  | `check_research_period_usage`: new fail-closed modes, `forward_period_declarations`, conditional limitations | step 4 check tests |
  | Record tools: `overlapped_forward_period_declarations`, `prior_overlap.forward_period_declarations`, up to 2 s added latency, a lock file beside the journal | step 4 record-path tests; the existing `deepEqual` retry tests become replay checks |
  | The batch tool: the top-level `forward_period_declarations_by_id` map; `summary_only` forms | step 5 server tests |
  | `summarize_backtest_ledger`: `period_usage.record` carries the new fields | step 5 server test |
  | `compare_forecast_losses` and `compute_realized_covariance`: the `records` field and the `per_series` column | step 5 server tests |
  | The tool list: 109 → 111 | server.test.mjs tool-count test |
  | The 0.1.13 and 0.1.15 ledgers still read | step 1 golden tests |
- **Mutation (after step 6):**
  - the design's list;
  - the H7 `>` comparison;
  - the queue timer and the queue tail;
  - the `tail_only` partition;
  - the same-path refusal;
  - both journal guards;
  - the as-of boundaries (anchor < s, sequence ≤ s, `prior_overlap` < s);
  - the back-off.

  The run uses a copy of `build/`, with `node --test` directly.

## 4. Risks

- **Released tools change** (the table above). The preflight's status rules change only when
  declarations exist. Its contract string and one limitation name change always, but it is
  read-only, so nothing stored carries them.
- **Lock waits:** `serializeWithin` is new behaviour in a shared component. Only the declarations
  journal uses it, and every existing call keeps 30 s.
- **Record paths gain a second file:** the fallback and the back-off guarantee the access is still
  appended, and are tested in every mode.
- **Test pollution:** the store resolves no home default unless constructed with no arguments. The
  sibling name follows the ledger's name. `makeDeps` stubs the new methods so that they throw.
- **Windows:** POSIX-mode assertions are guarded with `posixModeEnforced()`.
- **Performance:** counts are computed for listed entries only, over accesses indexed once per call
  by (research_id, series_id). The benchmark (step 6) has thresholds.
- **Estimated size:** about 1,200–1,600 source lines and 1,500–1,900 test lines.

## 5. Decisions (user, 2026-09-30)

1. **P1, test isolation:** the declarations journal defaults to a sibling named after an explicit
   ledger path (P-Q11).
2. **P2, order:** steps 1–6 as above, with the research-journal lookup in step 3 (P-Q9).
3. **P3, release:** 0.1.16 after the code review, with 111 tools.

## 6. Implementation constants fixed before coding

| Constant | Value |
|---|---|
| Journal | Namespace `forward_period_declarations`, `schema_version` `"1.0"`, kinds `declaration` and `shortening`; 32 MiB file, 16 KiB record. The paths are as in section 1. |
| Short bound | 2,000 ms per declarations-lock acquisition, covering the queue and the file lock |
| Back-off | 30 s of skipped declarations reads on record paths after any declarations-lock timeout on that path. It is keyed by the resolved path and measured by an injectable monotonic clock (R1). |
| Lead | ≥ 86,400,000 ms (24 h), for declaring and for `new_end` |
| Length | 86,400,000 ms ≤ `to` − `from` ≤ 31,622,400,000 ms (366 days), both inclusive. `to` ≤ 2100-01-01T00:00:00.000Z is this plan's own addition, matching the bar-series range. `new_end` is `from` or ≥ `from` + 24 h. |
| `lead_seconds` | `floor((from − recorded_at) / 1000)` |
| `shortened_after_start` | Any shortening with `recorded_at` > `from` − 24 h. `late_shortening` is `{recorded_at, lead_seconds}` of the earliest such shortening, or null. |
| States | `withdrawn`: `effective_to` = `from`. Otherwise `pending` (now < `from`), `running` (now < `effective_to`) or `ended`. |
| `shortenings` listed | The 5 most recent by sequence, whose `new_end` values are the smallest, so the one that sets `effective_to` is always included; plus a total |
| Identifiers | `declaration_id` `^[A-Za-z0-9_.:-]{1,100}$`; `research_id` and series IDs: the ledger's identifier (1–120); `series_ids` 1–20, unique (duplicates rejected), stored sorted, `proxy-set-source:` rejected; `protocol_sha256` `^sha256:[a-f0-9]{64}$`; `hypothesis` `{kind: "strategy" \| "event", id: ^[\w.:-]{1,80}$}`; `reason` 1–200 characters |
| Caps | `listed` 20; `shortenings` 5 plus a total; `overlapped_forward_period_declarations.listed` 20 plus a total and `by_relation`; the exclusivity error names 5 |
| Field status | Every declaration-derived field carries `status: "available"` or `{status: "unavailable", reason}`. The reasons are `lock_timeout`, `lock_timeout_backoff` (with `retry_after_ms`), `journal_unreadable`, `ledger_regressed` and `clock_moved_backwards`. Each maps to the fail-closed error of the same condition: `forward_period_journal_unavailable` for the first three, then `forward_period_ledger_regressed` and `forward_period_clock_moved_backwards` (R4). |
| `summary_only` form | `forward_period_declarations: {status, total, active, withdrawn, tail_only, listed_declaration_ids, truncated}`. The batch map is omitted. |
| Batch map | `forward_period_declarations_by_id`, holding the static fields only (design I1) |
| Tools | `declare_forward_period`, `shorten_forward_period`; 111 in total |
| Errors | The design's thirteen: `forward_period_declaration_id_conflict`, `forward_period_hypothesis_not_registered`, `forward_period_lead_too_short`, `forward_period_too_short`, `forward_period_too_long`, `forward_period_already_declared`, `forward_period_has_recorded_usage`, `forward_period_journal_unavailable`, `forward_period_ledger_regressed`, `forward_period_declaration_not_found`, `forward_period_research_id_mismatch`, `forward_period_shortening_invalid`, `forward_period_shortening_conflict`; plus `forward_period_clock_moved_backwards` (P-Q4) |
| Preflight | Contract `recorded_usage_oos_preflight_v2`, with the reasons and required actions in the table below |
| Limitations | The design's ten go in the declare and shorten responses always, and in the check's and preflight's `limitations` when a declaration is listed. `forward_period_declarations_unavailable` goes in `prior_overlap.limitations`. `access_overlaps_a_declared_forward_period` goes in `summarizePriorOverlap`'s limitations. `hypothesis_population_is_not_forward` is a flag on the entry and in 4d. |
| Response fields | `forward_period_declarations`, `overlapped_forward_period_declarations` (`{status, total, by_relation, truncated, listed}`), `active_forward_period_declarations`, `related_declarations`, `tail_only`, `late_shortening`, `ledger_sequence_at_write`, `ledger_anchor` (rev 2.2), `forward_period_declarations_by_id` |

**Preflight reasons and required actions**

| Rule | Status | Reason | Required actions |
|---|---|---|---|
| 1 | `blocked` | `evaluation_period_has_recorded_usage` | unchanged |
| 2 | `blocked` | `evaluation_period_has_a_forward_period_declaration` | `pass_the_declaring_research_id_if_this_is_its_declared_evaluation`, `otherwise_do_not_label_this_period_unused_oos` |
| 3 | `blocked` | `evaluation_period_declared_for_another_research` | `do_not_label_this_period_unused_oos`, `choose_a_separate_undeclared_period_or_report_as_exploratory` |
| 4a | `blocked` | `evaluation_period_differs_from_declared_forward_period` | `evaluate_exactly_the_declared_period_or_report_as_exploratory` |
| 4b | `blocked` | `declared_forward_period_not_yet_ended` | `wait_until_the_declared_period_ends` |
| 4c | `blocked` | `declared_forward_period_shortened_after_start` | `report_as_exploratory_the_declaration_was_shortened_after_start` |
| 4d | `review_required` | `declared_intent_without_recorded_usage_is_not_unused_evidence` | `confirm_the_evaluation_matches_protocol_sha256`, `record_the_evaluation_under_this_research_id`, `review_untracked_external_and_related_series_access`, `review_related_declarations`, `report_the_result_whatever_it_is`; with H9, also `report_under_the_registered_hypothesis_population_not_as_forward` |
| 5 | `review_required` | `absence_of_usage_records_is_not_unused_evidence` | unchanged; with `research_id`, the flag `no_active_forward_period_declaration_for_research_id` |

Every rule keeps `execution_allowed`, `candidateEligible` and `unused_proven` `false`.
`no_automatic_approval_path_in_v1` becomes `no_automatic_approval_path`.
