# declare_forward_period: design memo (rev 3.2, design review approved; not implemented)

Backlog #101, item 5.

Review history:
- rev 1: BLOCK. HIGH F1–F3, MEDIUM F4–F8, LOW F9–F15, plus NITs.
- rev 2: BLOCK, narrow. HIGH G1, MEDIUM G2–G6, LOW G7–G11, plus NITs. F1–F15 were resolved, except
  where G-findings reopen them.
- rev 3: APPROVE WITH FINDINGS. MEDIUM H1–H2 (lock rules, to be written in before coding) and LOW
  H3–H9, plus NITs. No further review round needed.
- rev 3.1 (diff check): APPROVE. LOW I1 and NITs I2–I5, folded in as rev 3.2.

Rev 2 folded in F1–F15, and rev 3 folded in G1–G11, with the user's decisions of 2026-09-30 (section
"Decisions"). Rev 3.1 folds in H1–H9 and the NITs, and rev 3.2 folds in I1–I5.

## Problem

The period usage ledger ([RESEARCH_PERIOD_USAGE.md](RESEARCH_PERIOD_USAGE.md)) records accesses
after they happen. Nothing records, before a period starts, that a study intends to use it only for
its one pre-registered evaluation. Two things follow:
- When the period arrives, nobody can show that the intent was recorded before anyone looked.
- Other studies cannot see that their accesses overlap someone's declared forward period.

#100 hit this directly. Its performance experiment was designed on explored history only, because
"2026-07 and later had already been referenced by other studies" (BACKLOG #100).

`declare_forward_period` records that research R intends to use [from, to) on some series only for
the evaluation whose protocol hash it names. The record is made by the local server clock, at least
24 hours before the period's start timestamp. It is evidence of recorded intent, **not** proof that
the data stayed unused, and every response says so. At most one declaration record is active per
series and time.

**The deferred mechanism.** BACKLOG #101 deferred "承認・claim・監督の仕組みの MCP 化", giving as the
reason "研究ごとの個別性が高く、汎用化すると穴が出やすい。研究テンプレートで扱う". Those workflows
(approvals, attempt claims, supervisors) differ per study, and a generic version leaks. This tool does
something narrower:
- It records one fixed, generic fact: series, period, research ID and protocol hash, with fixed
  semantics.
- It grants nothing and gates no execution. No tool refuses to run, no access record is refused, and
  the preflight already never allows execution. The one thing a declaration refuses is another
  declaration that overlaps it. Otherwise it changes only what the check and the preflight report.
- Its holes are listed in every response.

Per-study approval and supervision stay in the study templates.

## Scope (v1)

- **In:**
  - declaring a future period for one research ID on 1–20 series;
  - shortening a declaration, or withdrawing it before it starts;
  - reporting declarations, and the accesses that overlap them, in the check, the preflight, record
    responses and the observing tools' summaries.
- **Not in v1:**
  - refusing any access or usage record;
  - reserving the data source, or intercepting charts or backtests;
  - linking related series or aliases;
  - verifying the protocol's content.

## Storage (D1)

A separate append-only journal:
- **Location:** `TRADINGVIEW_MCP_FORWARD_PERIOD_JOURNAL_PATH`, default
  `~/.tradingview-mcp/forward-period-declarations.jsonl`.
- **Format:** the owner-only first-seen log, with 32 MiB file and 16 KiB record limits.
- **Paths:** processes configured with different values use different journals, as with the other
  stores, so the MCP process and any CLI must share the value.

Two line kinds, each one append, so neither is ever partial.

A `declaration` line holds:
- `schema_version`, `namespace` (`forward_period_declarations`), `kind`, `sequence`,
  `recorded_at`, `first_seen_at`, `observation_date`;
- `ledger_sequence_at_write`: the period usage ledger's record count when this line was written
  (G4);
- `declaration_id`, `research_id`;
- `series_ids`, sorted and unique, so their order never matters;
- `from`, `to`, `protocol_sha256`;
- `hypothesis`: `{kind, id, definition_hash, journal_sequence, population}` or null.

A `shortening` line holds:
- the same header fields and `ledger_sequence_at_write`;
- `declaration_id`, `research_id`, `new_end` and `reason`.

A shortening is identified by (`declaration_id`, `new_end`).

**Locks.** Every path that touches both files takes the ledger lock first, then the declarations
lock. That covers:
- writing a declaration or shortening line;
- reading declarations for a record response;
- the check and the preflight, which need a consistent snapshot and the H7 anchor comparison
  (I4).

No path takes them in the other order. The research
journal, when needed (D4), is read under its own lock and released first.
- **Short waits (H1):** every acquisition of the declarations lock, nested under the ledger lock or
  on its own, is bounded by a short wait of about 2 s. The bound covers both the in-process queue and
  the file lock. When it expires, or the journal cannot be read:
  - declare, shorten, the check and the preflight fail closed with
    `forward_period_journal_unavailable`;
  - record paths append the access anyway and return `unavailable` (below).

  So a stale declarations lock or a torn line never holds the ledger lock for the ledger's own
  30 s wait, and never makes an access record fail.
- **Same path refused:** the declarations store refuses to construct when its path resolves to the
  ledger's or the research journal's path. A nested `serialize` on the same queue key would wait on
  itself forever (G5).
- **Ledger replacement (H7):** if any line's `ledger_sequence_at_write` exceeds the ledger's current
  record count, the ledger was reset or replaced, for example to erase accesses inside a declared
  period.
  - Declare, shorten, the check and the preflight fail closed with
    `forward_period_ledger_regressed`.
  - Record paths return `unavailable` with that reason.
- **A missing journal file** (ENOENT) means there are no declarations.
- **Why separate (F5):** declarations can never be counted as accesses, the ledger's schema is
  unchanged, capacity is separate, and older versions ignore the file.

Declaration IDs live in this journal, not in the ledger's access-ID namespace.

## Declaring

`declare_forward_period` takes, strictly:

| Field | Content |
|---|---|
| `declaration_id` | 1–100 characters, research-ID character set, unique in the journal |
| `research_id` | The declaring study (caller-supplied, not authenticated) |
| `series_ids` | 1–20 unique exact series IDs, stored sorted. `ledger-source:` and `forecast-set-source:` are allowed: they are digests of a stable `source_id`. `proxy-set-source:` is rejected: a content-addressed set cannot gain future data. |
| `from`, `to` | Canonical UTC `[from, to)`. `from` ≥ recorded time + 24 h (D8). The length `to` − `from` is from 24 h to 366 days (D2, G9). Declare the whole span the evaluation will read after `from`, including outcome horizons (G3). |
| `protocol_sha256` | `sha256:<64 hex>` of the frozen evaluation protocol, caller-asserted |
| `hypothesis` | Optional `{kind: "strategy" \| "event", id}`, ID up to 80 characters (D4) |
| `confirm` | `true` |

The steps, in this order. The first failure gives the error (G11):
1. **Look up `declaration_id`** under the declarations lock alone.
   - If it exists with identical content (series compared sorted), the call is an idempotent retry.
     This holds even when the lead has passed or the declaration has since been shortened, and it
     never reads the research journal.
   - Step 1 releases the declarations lock in every case. On a hit, the response is then built
     under ledger → declarations, as in step 3 (H2), because its `related_declarations` counts come
     from the ledger.
   - If the content differs, the error is `forward_period_declaration_id_conflict`.
2. **Read the hypothesis**, if one is given, from the research journal, under its own lock, then
   release that lock.
   - It must exist (`forward_period_hypothesis_not_registered`).
   - Its definition hash, journal sequence and population are stored.
   - A population of `in_sample` or `stress` is not refused, but flagged
     `hypothesis_population_is_not_forward` in the line and in every report.
3. **Take the ledger lock, then the declarations lock.** Take one `now`, which sets both the lead
   check and `recorded_at`. Look up the ID again, since another call may have written it in the
   meantime. Then check, in this order:
   - the lead (`forward_period_lead_too_short`);
   - the length (`forward_period_too_short` or `forward_period_too_long`);
   - exclusivity: no active declaration may overlap [from, to) on any of the series
     (`forward_period_already_declared`, naming up to 5 conflicting series and their IDs). A part
     that is no longer declared does not count;
   - recorded usage: no access in the ledger may overlap [from, to) on any of the series
     (`forward_period_has_recorded_usage`).
4. **Append** the line with `ledger_sequence_at_write`.

The response carries:
- the declaration, its `recorded_at` and `lead_seconds`;
- `related_declarations`, as defined under Reporting;
- the limitations below.

It never says the period is unused, reserved or approved.

### Shortening (D3, F1, G1)

`shorten_forward_period` takes `declaration_id`, `research_id` (must match the declaration),
`new_end`, a `reason` (1–200 characters) and `confirm`. From `new_end` on, the period is no longer
declared.
- `new_end` must be ≥ recorded time + 24 h, and < the current end. It must also be either exactly
  `from` or at least `from` + 24 h, so shortening never goes below the 24 h minimum length (H6). So
  only a part at least 24 h away can stop being declared.
- `new_end` = `from` withdraws the declaration entirely. That is possible only while `from` is at
  least 24 h away.
- The retry, lookup and lock rules are the same as for declaring. An identical retry is idempotent
  at any time.
- The steps and errors, in order:
  - the idempotent lookup on (`declaration_id`, `new_end`). The same key with a different `reason`
    or `research_id` is `forward_period_shortening_conflict` (I3);
  - `forward_period_declaration_not_found`;
  - `forward_period_research_id_mismatch`;
  - at lock acquisition, `forward_period_journal_unavailable` or `forward_period_ledger_regressed`.
    The same errors apply at the same point in the declare steps;
  - then, under both locks:
    - `forward_period_shortening_invalid`, when `new_end` is not below the current end, is below
      `from`, or falls within the first 24 h after `from`;
    - `forward_period_lead_too_short`.
- The declaration's `effective_to` is the smallest `new_end`. Every line stays in the journal and in
  every report.
- A withdrawn period can be declared again only under a new `declaration_id`.

**Shortening late costs rule 4d (G1).** A shortening recorded later than `from` − 24 h, that is
within the last 24 h before the start or after it, sets `shortened_after_start: true` on the
declaration, together with its time and lead. The case it guards against:
1. R declares a period.
2. R watches the data, unrecorded.
3. R cuts the period off where the result looks good.

Because of the flag, the preflight gives rule 4c instead of 4d for such a declaration (below). The
part that is no longer declared may be declared by other studies, with their own 24 h lead, so the
F1 remedy keeps working. The declaring study loses rule 4d.

With the length cap, a mistaken declaration blocks other declarations for at most 366 days. Under
the H6 rule, the part from `from` + 24 h onward can stop being declared as long as it is at least
24 h away, and the whole declaration can be withdrawn until `from` − 24 h (I5).

## Reporting (F6, F7, F9, F12, F13, G2, G3, G6, G9)

For a query on one series, a declaration on that series is **listed** when its original [from, to)
overlaps the query. Withdrawn declarations and parts no longer declared therefore stay visible
(G2). A declaration is **active** for the query when [from, `effective_to`) is non-empty and
overlaps it. Only active declarations drive the preflight rules.

The response field is `forward_period_declarations`:
- `total`, `active`, `withdrawn` and `tail_only`. `tail_only` counts declarations that are not
  withdrawn and whose overlap with the query lies only in [`effective_to`, `to`). Then `total` =
  `active` + `withdrawn` + `tail_only` (I2);
- `listed`: up to 20 entries, active first, then by `from`, then by `declaration_id`; then
  `truncated`;
- each entry holds:
  - `declaration_id`, `research_id` and `series_ids`;
  - `from`, `to`, `effective_to`, `protocol_sha256`, `hypothesis` (with
    `hypothesis_population_is_not_forward`), `recorded_at` and `lead_seconds`;
  - `shortenings`: at most 5, with a total;
  - `shortened_after_start`;
  - `state`: `pending`, `running`, `ended` or `withdrawn`. The check and the preflight use the server
    clock; record responses use the record's `recorded_at` (I5);
- each entry also counts the accesses in the ledger that overlap [from, `effective_to`) on this
  series. These are computed for listed entries only, and the rules use overlap tests alone (G9).
  Accesses are indexed once per call by (research_id, series_id). The counts are:
  - `other_research`;
  - `declaring_research`, split by:
    - recorded phase: `before_start`, `during` or `after_end`, from its `recorded_at`;
    - purpose: `exploration` or `validation`;
    - source: `user_reported` or `tool_observed`;
    - `distinct_tool_requests`, the distinct `request_sha256` values among its tool records.
      The observing tools always record `exploration`, so the number of distinct analyses and their
      phase are what separate an evaluation from a peek;
  - `declaring_access_covers_declared_period`: whether some access by the declaring research,
    recorded at or after `effective_to`, has an interval containing [from, `effective_to`) (G3);
  - `declaring_accesses_extending_outside_declared_period`: a count. The observing tools record
    their own envelopes: the ledger summary's trade envelope, the forecast window envelope, or the
    bars read, which with `from_previous_endpoint` start at the previous day's endpoint. So this
    count is descriptive, not a fault;
  - `ended_without_declaring_research_access`: `true` when the state is `ended` and the declaring
    research recorded nothing;
  - `related_declarations`: other declarations, in any state, with the same `research_id` or the
    same `protocol_sha256`, on any series and at any time. It has a `total` and counts of those
    `ended_without_declaring_research_access` and `shortened_after_start`. This reveals a protocol
    split across months or aliases, where only one part was evaluated (G6).

These are counts, not verdicts. Where they appear:
- **`check_research_period_usage`** and the full assessments of the record tools and
  `summarize_backtest_ledger`: `forward_period_declarations` as above.
- **Batch responses:** the static fields of each declaration appear once, in a top-level map keyed
  by `declaration_id` (G9). The static fields are `declaration_id`, `research_id`, `series_ids`,
  `from`, `to`, `protocol_sha256`, `hypothesis`, `recorded_at` and `lead_seconds`.

  Each result refers to them by ID, and carries everything else as of its own record (H4, I1),
  because results replay as of different records:
  - `effective_to`, `state`, `shortened_after_start` and `shortenings`;
  - every ledger-derived count and flag;
  - `related_declarations`.

  When a result is `unavailable`, its references are unavailable too.
- **`summary_only`:** the counts and the listed `declaration_id`s, without the entries.
- **The observing tools' summarized `prior_overlap`** (`summarizePriorOverlap`): each `per_series`
  row gains `active_forward_period_declarations: {declared_by_this_research,
  declared_by_other_research}`. When either is non-zero, the limitation
  `access_overlaps_a_declared_forward_period` is added (D6).
- **Every record response** (manual, batch and observing tools) gains
  `overlapped_forward_period_declarations: {total, truncated, listed: [{declaration_id, research_id,
  relation}]}`, at most 20 entries, computed including the record just written. `relation` is
  `other_research`, `declaring_research_exploration` or `declaring_research_validation`.

**Replay (G4).** A record response with sequence s is computed as of its access record, not at the
current time:
- it uses only the declaration and shortening lines whose `ledger_sequence_at_write` is below s;
- it computes `state` at the record's `recorded_at`;
- ledger-derived counts inside the entries use records with sequence ≤ s, the record itself
  included; the existing `prior_overlap` keeps its "< s" meaning.

An identical retry therefore returns the same content, as the ledger promises ("Retries preserve the
original timestamp and period assessment"). The one exception: if the original response was
`unavailable`, a retry returns the as-of content, which may now be available. The check and the
preflight describe the current state.

**When the declarations journal cannot be read (G5).**
- **Record paths:** they read it with the short wait. On any failure, whether a torn line, a stale
  lock, a schema error or a regressed ledger, the access is **still appended**. Every
  declaration-derived field is then `{status: "unavailable", reason}` with no counts, never zero,
  since a zero would read as "no declarations" (H3). That covers:
  - `overlapped_forward_period_declarations`;
  - `forward_period_declarations` in the full assessment;
  - the `summarizePriorOverlap` column.

  The limitation `forward_period_declarations_unavailable` is added. A record is never refused
  because of a declaration or because of the declarations journal.
- **The check and the preflight:** they fail closed with an error, because they cannot give an
  accurate answer.

The field name `forward_period_declarations` avoids the existing `prior_usage_declaration` and
`declarations_do_not_authorize_candidate_eligibility`, which mean something else.

### Preflight (D5, D7, F3, F9, G1, G7, G8)

`preflight_research_oos` gains an optional `research_id` and the contract string
`recorded_usage_oos_preflight_v2`. The rules run over every declaration active for the query, not
only the listed ones. The first match wins:
1. **Any recorded access overlaps the query:** `blocked`, as today.
2. **An active declaration overlaps and no `research_id` was given:** `blocked`, reason
   `evaluation_period_has_a_forward_period_declaration`. The required action is to pass the
   declaring study's `research_id` if the evaluation is that study's.
3. **An active declaration by another research overlaps:** `blocked`,
   `evaluation_period_declared_for_another_research`.
4. **Active declarations by this research overlap:**
   - a) If the query is not exactly [from, `effective_to`) of one declaration (a subset, a
     superset, or a span across two declarations): `blocked`,
     `evaluation_period_differs_from_declared_forward_period`.
   - b) If it is exact but the checking time < `effective_to`: `blocked`,
     `declared_forward_period_not_yet_ended`.
   - c) If it is exact and the declaration has `shortened_after_start`: `blocked`,
     `declared_forward_period_shortened_after_start`.
   - d) If it is exact, ended and not shortened after the start: `review_required`,
     `declared_intent_without_recorded_usage_is_not_unused_evidence`. Required actions:
     - confirm the evaluation matches `protocol_sha256`;
     - record the evaluation under this research ID (an observing tool given the `research_id`
       records its own envelope, which may extend outside the declared period);
     - review access outside the ledger and on related series, and the declaration's
       `related_declarations`;
     - report the result whatever it is.

     When the hypothesis population is not forward, the response carries
     `hypothesis_population_is_not_forward` and requires reporting the evaluation under that
     population, not as a forward one (H9).
5. **Otherwise:** as today (`review_required`). If a `research_id` was given, add
   `no_active_forward_period_declaration_for_research_id: true`.

Withdrawn declarations and parts no longer declared never change the status.
- **Rule 4 order:** 4a–c are checked before 4d, so 4d is reached only for an exact, ended,
  unshortened declaration.
- **Irreversibility:** once a declaration has ended, `effective_to` cannot change, because
  `new_end` must be at least 24 h in the future. So a 4d answer cannot be undone later.
- **Other studies on an ended period:** rule 3 keeps other studies' preflights blocked on an ended
  declared period for good, even when the declaring study never recorded an evaluation. This is
  deliberate: the declaring study may have watched the data unrecorded, and the period was
  declared for it (G8).
- **The unauthenticated `research_id`:** anyone can pass R and reach 4d for R's declaration. The
  4d answer describes R's declaration, not who asked, and the limitation
  `research_id_is_caller_supplied_not_authenticated` says so (G8).

The preflight checks one series. The response includes each declaration's `series_ids`, and the
docs say to run the preflight for every series of the evaluation. `execution_allowed`,
`candidateEligible` and `unused_proven` stay `false` in every case. `check_research_period_usage`
keeps rejecting `research_id`, so its reports are relation-free.

The v2 limitation list replaces `no_automatic_approval_path_in_v1` with
`no_automatic_approval_path`. The declaration limitations below are added only when a declaration
is listed.

## Limitations

These are always returned by `declare_forward_period` and `shorten_forward_period`, and in the check
and the preflight whenever a declaration is listed:
- `forward_declaration_is_intent_not_proof_of_unused_data`
- `declared_before_period_start_by_local_clock_only`
- `period_timestamps_are_data_labels_not_availability_times` (an FX daily bar labelled D opens the
  evening before; a revised history may predate its labels)
- `local_journal_is_private_state_not_tamper_evidence`
- `access_outside_the_ledger_is_not_detected`
- `related_series_and_aliases_are_not_linked`
- `does_not_reserve_the_data_or_block_viewing`
- `protocol_hash_is_caller_asserted`
- `research_id_is_caller_supplied_not_authenticated`
- `declaration_does_not_bind_data_source_or_version`

**Gaming paths the design discloses but cannot close:**
- peeking at a related series before declaring;
- watching live charts during the period;
- using a fresh research ID for an exploratory run;
- declaring many series to discourage others;
- splitting one protocol into several declarations and evaluating only one. `related_declarations`
  shows this, but only for exact protocol hashes. A trivially varied protocol file under a fresh
  research ID evades it (H8);
- passing another study's unauthenticated `research_id` to shorten its running declaration, which
  sets that study's `shortened_after_start`. This is sabotage rather than gaming, but the same
  limitation covers it (H8).

Shortening after the start is closed as a path to 4d (G1), but not as a way to stop early. That
stays visible through `shortened_after_start`.

## Changes to released tools

1. **Record tools and assessments:** `record_research_period_usage`,
   `record_research_period_usage_batch`, `check_research_period_usage` and the observing tools
   gain the additive fields above. Record paths also read the declarations journal, with the
   unavailable fallback.
2. **`preflight_research_oos`:** the optional `research_id`, rules 2–4, `_v2`, and the limitation
   rename. It is read-only.
3. **Ledger and tools:** the ledger schema is unchanged. The tool count goes to 111.

**Downgrade notes:** a version before 0.1.16 never reads the declarations journal:
- it keeps recording accesses normally;
- its preflight and check show no declarations;
- an upgrade recomputes every count, so nothing is lost.

## Tests (planned)

- **Golden fixture:** freeze a 0.1.15-format ledger (records from all three observing tools plus
  manual ones) before any change, and require it to read.
- **Clock:** the stores take an injectable clock, which also drives the ledger's `accessed_at`
  refine (including the module-level schema the manual record tool uses) and its clock-backwards
  check. It is used to test exactly:
  - the 24 h lead against 24 h − 1 ms;
  - the 24 h minimum and 366-day maximum length;
  - shortening at and just past the boundary;
  - `shortened_after_start` at `from` − 24 h against `from` − 24 h + 1 ms;
  - the four states.
- **Declaring:**
  - exclusivity across several series and research IDs, and a part no longer declared being
    declarable by other studies;
  - recorded-usage overlap;
  - the prefix rules;
  - hypothesis checks for both kinds, a missing one, and an `in_sample` flag;
  - retries: idempotent after the lead passed and after a shortening; a content conflict; a retry
    with fewer or more series, or with series in another order (identical);
  - error precedence: the ID conflict before the hypothesis error, and the hypothesis error before
    the lead.
- **Shortening:**
  - a partial shortening and a full withdrawal;
  - `new_end` in the first 24 h after `from` (H6);
  - a mismatched `research_id`, and the error order;
  - a retry after the boundary;
  - several shortenings: the smallest wins, and at most 5 are listed.
- **Accounting:**
  - declarations never appear in any ledger count;
  - listing by the original period against activity by the effective one, including withdrawn and
    tail cases;
  - the phase, purpose, source and distinct-request counts;
  - the redefined coverage flag and the outside count, with an observing tool's envelope;
  - `ended_without_declaring_research_access`;
  - `related_declarations`;
  - `overlapped_forward_period_declarations` including the new record;
  - the `summarizePriorOverlap` columns and limitation;
  - the batch top-level map;
  - `summary_only` sizes.
- **Replay:** an identical retry after a later declaration, a shortening, or the passing of a state
  boundary returns identical content.
- **Unavailable journal:**
  - a torn declarations line or a stale lock still appends the access and returns `unavailable` in
    every declaration field;
  - the check, preflight, declare and shorten fail closed within the short wait;
  - a stale declarations lock plus a concurrent check in another process still lets a record append
    (H1);
  - a ledger shorter than a line's anchor is detected (H7);
  - the same-path configuration is refused at construction;
  - a missing journal file means no declarations.
- **Preflight:**
  - every rule, including a missing and a different `research_id`;
  - two adjacent declarations of one research;
  - withdrawn declarations only;
  - more than 20 declarations, with the rules still using all of them;
  - 4a–d boundaries, including 4c and the 4d population flag (H9);
  - the three flags stay `false`;
  - every new reason string pinned.
- **Lock order:** concurrent declare, shorten and record calls do not deadlock.
- **Mutation run over:**
  - the lead and length comparisons;
  - the overlap and exclusivity tests;
  - the lookup order;
  - the shortening rules and the `shortened_after_start` boundary;
  - listing against activity;
  - the phase split;
  - the replay anchor;
  - the unavailable fallback;
  - the preflight rule order and 4a–d.

## Deliverables

- the code and tests above;
- a contract doc, docs/FORWARD_PERIOD.md;
- updates to docs/RESEARCH_PERIOD_USAGE.md (the preflight v2, the new fields, the declarations);
- README (111 tools);
- BACKLOG #101 item 5.

## Decisions (user, 2026-09-30)

1. **D1, storage:** a separate journal (F5).
2. **D2, `to`:** required, with a length from 24 h to 366 days (F1, G9).
3. **D3, shortening:** `shorten_forward_period` stops declaring a tail that starts at least 24 h away
   and at or after `from` + 24 h, or withdraws the whole declaration until `from` − 24 h (F1, G10,
   H6).
4. **D4, binding:** `protocol_sha256` is required. An optional `hypothesis` of either kind is
   checked against the research journal, and its population is flagged when it is not forward
   (F10, G11).
5. **D5, preflight:** the optional `research_id` with rules 2–4 (F3, F9, G7).
6. **D6, observing tools:** per-series declaration counts go into `summarizePriorOverlap` (F7).
7. **D7, preflight contract:** `recorded_usage_oos_preflight_v2`.
8. **D8, lead time:** at least 24 hours, for declaring and for shortening (F4).
9. **G1:** after a shortening recorded later than `from` − 24 h, the part no longer declared may
   still be declared by other studies, but the declaring study loses rule 4d
   (`shortened_after_start`).
10. **G4:** record responses replay as of their access record through `ledger_sequence_at_write`.
11. **G5:** record paths append even when the declarations journal cannot be read, returning
    `unavailable`. The check and preflight fail closed, and a same-path configuration is refused.
