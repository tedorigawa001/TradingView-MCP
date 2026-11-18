# Committed native-bar maintenance: stage 1, v3 lifecycle and inventory

Status: pure supplied-record verification, with synthetic tests only. Production STOP remains in place. No production store, connection diagnostic, capacity ledger or protected unallocated 765 bytes is changed. The runtime refusal-before-IO and refusal-before-plan-consumption remains unchanged.

## Scope and versions

`inspectCommittedMaintenance` accepts an ordinary dense Array of attached, non-resizable ordinary ArrayBuffers containing canonical UTF-8 JSON. It imports only crypto, util, Zod and the unchanged pure v1 artifact/evidence helpers. It performs no IO, clock sampling, process inspection, lock acquisition, notification, execution or history read.

The input envelope and result are **v3**. Existing v2 intent, manifest, attempt, event and completion logs retain their immutable bytes and schemas. Input-v1 and input-v2 envelopes are explicitly refused as `unsupported_input_version`; their implicit inventory meanings are not silently reinterpreted. Actual `native-bar-receipt-v1`, v1 capture, `native-bar-maintenance-v1` and its `{id,intent_hash}` completion shape remain unchanged. These supplied copies do not authenticate a filesystem publication.

All results retain `diagnostic_only: true`, `execution_available: false`, `recovery_execution_available: false`, `production_qualified: false`, `host_approval_authenticated: false`, `native_bytes_verified: false`, `history_read_available: false`, and `original_acknowledgement: not_proven`. A consistent claim is not an authenticated human approval, verified native object or durable publication.

## Stable original evidence and deletion

Manifest-v2 refers to each target by recording ID and receipt/payload SHA-256, never a position in a later input array. It fixes sequence, day, recorded/latest-observed times, capture cutoff, original receipt fields and both object proofs. Canonical original receipt fields must reproduce the stored receipt hash and size. A supplied payload must match its hash, byte size, cutoff and latest observation. When its bytes have been deleted, the payload summary remains a **claim**; this module cannot independently re-parse or authenticate those absent original bytes.

The intent binding stores a canonical original baseline: receipt fields ordered by sequence, plus prior v1 maintenance IDs/hashes. `baseline_generation` hashes that complete baseline object. Duplicate identities/sequences, invalid day/policy/order, mismatched surviving receipts, missing prior maintenance or a baseline that already selects retired targets refuse. Baseline reconstruction does not use only the currently surviving receipts.

The verifier retains each baseline receipt's predecessor timestamp during that ordered traversal. Every selected target's stored `capture_as_of` and every available baseline payload must be at least that predecessor's `recorded_at`; an earlier cutoff refuses as `baseline_observation_order`. This applies after a predecessor or target has been purged, and to retained baseline payloads as well as selected targets. Equal timestamps are allowed. Predecessors come from the frozen baseline, not manifest iteration order. This check establishes a known temporal constraint, not the absent payload's full authenticity.

Remaining active source records must match the baseline while the transaction is unfinished; unexplained source or maintenance additions hold it as `current_baseline_changed`, while mismatched immutable prior-maintenance references refuse as `baseline_maintenance_binding`. After a complete transaction, later observations may be added without rewriting its original baseline. They must still obey the frozen policy and sequence. Prune retains the original baseline time floor except for individual receipts isolated by completed v1 clock maintenance, including clock isolation recorded after that prune. Recompute the maximum from the remaining original receipts; the prune's own targets still contribute, and an unrelated or unfinished clock operation or a later prune alone cannot discard their time floor. A completed clock recovery instead derives the recording time floor from original receipts that were not isolated and were not retired by completed v1 maintenance, including maintenance completed after the frozen transaction. These later prune/clock references must match the known original receipt and meet their own eligibility condition before exclusion is allowed. Corrected-clock observations may precede the retired stamps; their sequence must still exceed the original maximum. Remaining ahead records continue to block ordinary recording. Receipts removed by later recorded maintenance need not reappear. The immutable snapshot is supplied evidence, not an independently authenticated store inventory.

A v1 prune or clock reference naming a frozen baseline receipt or a supplied original receipt copy is checked against its canonical receipt SHA-256, payload SHA-256, sequence and partition day before it can relax the floor or support adoption. Its optional `recorded_at`, when present, must equal the known receipt time. Prune requires that time to be strictly earlier than the v1 intent's `created_at - 90 days`; equality and a one-day-old prune refuse. Clock requires it strictly beyond `created_at + 60 seconds`. A valid payload cannot observe after its receipt, so the known receipt supplies the eligibility maximum even when optional legacy times are absent. A supplied `last_observed_at` must lie between the known predecessor receipt time (when one exists) and this receipt's recording time. The claimed pair byte size must leave at least one payload byte and cannot exceed the fixed receipt size plus the existing single-record ceiling. Missing optional times are not filled into the immutable v1 record: an old prune with unknown boundary stays unknown. An unfinished legacy operation still blocks adoption and is never granted execution by these checks.

When the matching payload evidence is supplied, its exact canonical byte size and actual latest observation are checked against the v1 summary, and an observation after its receipt refuses. Without that payload, a plausible summary remains an unverified bounded claim: exact byte size/latest observation are not proved or manufactured. Optional v1 timestamps remain optional in either case. These checks also reject a known contradiction in a pending legacy claim rather than hiding it behind a quality hold. A mismatch rejects as `legacy_prune_baseline_binding` or `legacy_clock_baseline_binding` before floor relaxation or whole adoption. A copy-time contradiction detected inside `legacyView` stops before the legacy-effect diagnostic snapshot exists (`effects_status: not_evaluated`, `effects: null`). A cross-scope sequence collision detected by the later `checkStoreSequences` pass is rejected as `store_sequence_alias`, with `effects_status: partial` and the non-null preserved legacy snapshot in `effects`; whole adoption remains blocked and those partial diagnostics cannot be used as adopted history. If a contradiction is detected later from the frozen baseline or declared-only checks, any preserved legacy effects remain partial diagnostics with `remaining_effects_unknown: true`, never a partially adoptable history. Targets with neither a selected-baseline entry nor a supplied original receipt remain unverified legacy claims, subject to the declared-value checks below. This check does not authenticate native v1 records, approvals, inventory or a running reader.

For those original-less references, `last_observed_at > recorded_at` refuses as `legacy_claim_observation_order` when both fields are present. Let S be the maximum of the available declared timestamps and any latest observation established from a matching payload below. Prune requires S strictly earlier than `created_at - 90 days`; clock isolation requires S strictly later than `created_at + 60 seconds`. Equality refuses as `legacy_claim_eligibility`, as do a one-day-old prune and a non-ahead clock claim. With both fields omitted and no matching payload evidence, no timestamp or eligibility proof is manufactured: the old legacy claim remains unverified. A prune's unknown recording boundary stays unknown even when a residual payload supplies observation evidence. These checks apply with and without a new transaction and to incomplete legacy operations; a quality hold cannot hide their contradiction. Strong original/baseline binding remains required whenever that evidence exists.

If a legacy reference supplies `recorded_at`, its `day` must not be later than that UTC timestamp's date; otherwise it refuses as `legacy_claim_day_binding`. Earlier partition days and equal dates are permitted. With `recorded_at` omitted, neither `last_observed_at` nor payload observation time is substituted to impose a guessed receipt-day limit. Strong original/baseline binding remains unchanged when those originals exist.

A residual payload whose raw hash matches an original-less reference is still evidence to inspect, even though its receipt is unavailable. Scan all four series for the maximum actual `observed_at`. A supplied `recorded_at` must not precede that observation; a supplied `last_observed_at` must equal it. Contradictions refuse as `legacy_claim_payload_binding`. Include the actual observation alongside the available declared timestamps in S for the strict prune/clock eligibility check, even when both declarations are omitted. This verifies supplied values, not native authenticity or the absent receipt's exact bytes; no optional field is populated. Cache the observed value only as internal evidence for the same legacy batch's later-member lower-bound check.

Sequence ownership is **store-wide across clock epochs**. The v1 writer allocates the maximum sequence across all maintenance pairs and active receipts plus one (`nativeBarHistory.ts`, unchanged since 75f4667); correcting the clock does not recycle a number. One invocation-wide `sequence -> recording_id` registry covers all supplied legacy references, every receipt copy including those outside active inventory, and the entire frozen baseline. Different IDs claiming the same sequence refuse as `store_sequence_alias`; the same ID/sequence can recur as multiple representations of one original. Existing duplicate-receipt, target-overlap, hash-binding and baseline checks remain stronger independent constraints. The existing per-maintenance duplicate guard can still refuse earlier as `legacy_sequence_alias`. The registry and all its source/reference/baseline visits consume the same unchanged shared budget. This corrects the prior mistaken claim that sequence uniqueness should reset with clock epochs; only the **time-order bound** below resets per maintenance record.

Known receipt evidence within **one legacy maintenance record** is checked in validated receipt-sequence order, independently of input-buffer or legacy-reference order. Recording time cannot regress; a supplied later payload's `capture_as_of` and optional legacy `last_observed_at` cannot precede the earlier known receipt's recording time. The comparison carries across unknown members without inventing their timestamps. Supplied archived originals and frozen-baseline originals are combined when both occur in that same legacy batch. Contradictions refuse as `legacy_batch_observation_order`. Each legacy record starts a fresh comparison: separate maintenance records may describe different clock epochs, so archived copies are not subjected to one global active-store chronology. Missing original evidence still limits what can be proved; a missing payload does not acquire a fabricated cutoff or authenticated body. Sorting comparisons and all additional visits consume the unchanged shared work budget.

The final per-record ordering check also includes original-less declared members, using the original's sequence/time when available and the reference's declared sequence/time otherwise. If a receipt time is omitted but an observation time is declared or supplied by a matching residual payload, that observation constrains only the **lower bound** on the omitted receipt time for later-member comparisons; it is never written into `recorded_at`, a prune boundary or the immutable v1 bytes. A member with neither declared timestamps nor payload observation evidence adds no new bound and does not erase an existing one. Missing-member gaps, mixed supplied/frozen/declared evidence, reversed reference arrays and equal timestamps have explicit controls. This bound resets at each legacy maintenance record, never at a page or an unknown member.

Body requirements are checked **per receipt and payload after complete bounded replay**:

| Replayed file state | Missing-body rule |
| --- | --- |
| Source, staged or verified holding | Missing required evidence holds adoption. Supplied bytes may represent the observed holding object; no path is read here. |
| `unlink_pending` without a verified terminal | Absence is `unlink_outcome_unknown`, never inferred success. |
| `quarantine_move_pending` without a verified terminal | Absence of required body evidence or inventory is `quarantine_outcome_unknown`, never inferred isolation. |
| `purged_verified` | The body may be absent even while another file/pair remains unfinished. Original metadata, event binding and proof claims must remain consistent. |
| All targets terminal, no whole completion | No repeat deletion; adoption remains blocked until the separate complete scope is recorded consistently. |
| Whole prune or clock isolation complete | Deleted/quarantined body evidence need not be resupplied to the ordinary reader. Neither terminal may appear in active source/holding inventory. |

A fresh recovery attempt binds the exact intent, event prefix and remaining action set. Already terminal files receive no new destructive action. Surviving unresolved moves use explicit reconciliation; reconciliation does not create permission for a fresh destructive step. Absence after a prior attempt's pending unlink cannot establish its success or original acknowledgement. Conflict is terminal; durability uncertainty remains sticky across recovery and prevents ordinary completion.

## Active inventory and saved evidence are separate

The v3 header declares `policy_hash` and `inventory`, a complete claimed inventory of the participating **source and holding areas only**. Each entry fixes recording ID, receipt/payload role, source/holding location and byte hash. Duplicate role/location claims, unbound entries and unowned holding entries refuse. Inventory completeness and actual locations remain unauthenticated supplied claims until a qualified native collector exists.

Receipt/payload buffers are evidence copies. They may be saved original bytes or bytes observed in holding/quarantine; their presence alone does not put an object in active inventory. Quarantined objects are outside the active inventory's scope. A positive quarantine terminal event retains its immutable hash/identity/location evidence; an ordinary read does not reopen its original files or quarantine bodies. A claimed terminal purge/isolation with an entry still in active inventory refuses as `terminal_inventory_conflict`. Proof-only bytes without a live entry never become active observations. Every receipt copy must be explained by its pair's inventory membership, an exact frozen-baseline receipt hash (including selected targets), or an exact old-maintenance receipt reference; otherwise it refuses as `unreferenced_receipt`. A payload reference from the frozen baseline can explain its copy even if the receipt body is missing. The existing `unreferenced_payload` check remains. Missing pair membership still holds adoption; one inventory entry does not prove that both files are active. Legitimate archived clock/prune copies remain admissible evidence, without imposing active-store chronological ordering across distinct clock epochs on those copies.

Every supplied receipt, including retired evidence, must match the header policy before exclusion. The intent policy must also match it. Completed legacy targets are excluded from active history and cannot reappear in active inventory. An ordinary active receipt requires its payload evidence and matching source membership; source payloads without an active receipt hold adoption. This fixes the same policy-before-exclusion ordering used by v1. The header policy itself is not authenticated against a real policy file here.

For an inventory ID whose receipt body is absent, a single intent's fixed baseline can resolve the receipt's canonical hash and payload hash. This is identity resolution only, followed by the existing complete baseline generation, policy, sequence and surviving-body validation before adoption. Inventory entries must still match their exact expected role hash; unknown IDs and wrong hashes refuse as `inventory_binding`. An inventory claim cannot supply its own expected hash. Keeping the original inventory while losing either non-target body or both therefore reaches `baseline_source_missing` and an unconfirmed completion instead of failing merely because the reference resolver lacked the receipt body. The frozen metadata does not replace required current bodies or establish their presence.

Inventory locations must match source, verified holding, pending unlink and pending quarantine states. Both pending operations require a holding location when an entry is supplied; claiming source refuses as `inventory_state_binding`. Missing evidence/membership in a pending operation uses its operation-specific unknown-outcome reason. Neither saved bytes nor a pending event proves that the move or unlink completed.

## Eligibility, proofs and transitions

For each pair, `S = max(recorded_at, last_observed_at)` and `T0` is the original approval claim. Prune originally requires `S < T0 - 90 days`; staging and unlink also use the minimum of original approval, current attempt approval and event time. Pending eligibility uses the minimum of original approval and evaluation time. A rollback cannot widen eligibility. Clock isolation requires `S > T0 + 60 seconds`, retaining the original T0 and exact scope after correction. `approval_time_only` reports that the original ahead condition no longer holds at the supplied evaluation UTC; it is not permission to act.

| Kind | Normal per-file states |
| --- | --- |
| Prune | source -> move_pending -> held_verified -> unlink_pending -> purged_verified |
| Clock isolation | source -> move_pending -> held_verified -> quarantine_move_pending -> quarantined_verified |

Both files of a pair must reach holding before its first unlink/isolation action. All pairs and both terminals must match the whole completion. One-sided completion, wrong kind, skipped holding, duplicate targets, broken sequence/hash links and post-completion records refuse. Completion has its own monotonic counter and wall timestamp.

The binding fixes root/required area/day parents, device/owner/group, private directory 0700 and file 0600 modes, original single-link files, distinct device/inode identities, ACL classification/hash, flags, byte sizes, birthtime and mtime, policy and backend profile/protocol. Evidence preserves these fields; link count/location and nondecreasing ctime must match the claimed transition and observation bracket. `none`/`deny_only` ACL classifications and all native properties remain unverified supplied claims.

Original approval references are checked before any attempt exists. IDs cannot alias across the defined source/metadata/approval roles; the first attempt must reference its original approval exactly. Recovery requires a new attempt ID and approval reference/hash. Reusing a clock ID in its clock role is allowed only with a nonregressing counter; reusing it as another identifier is not.

## Independent effects and whole adoption

`effects` contains established conditional completion effects, independent of `adoption`. "Established" here means that the supplied component passed its local checks, never that native publication or bytes were authenticated:

* `prune.present` retains the existence of removed history.
* `prune.boundary_state` is `none`, `known` or `unknown`. Any old prune lacking timestamp evidence keeps it unknown even after a newer known prune completes.
* `prune.greatest_known_recorded_at` retains the greatest known timestamp separately; it does not make an unknown overall boundary known.
* `clock.isolated_ids` and `retired_ids` retain completed clock isolation and all completed removals alongside prune information.

Old and new effects aggregate. Overlapping historical target claims refuse rather than silently double-counting. Every legacy-maintained ID is excluded from a new target set. Pending maintenance does not become a completed effect.

A new completion record with transaction-local holds is reported only in `unconfirmed_completions`, with its maintenance ID, kind, `evidence_status: unresolved`, blockers and claimed effects. Its prune boundary and retired IDs do not enter established `effects`. One unresolved file conservatively classifies the whole completion's effect set as unconfirmed. Examples include a new attempt claiming an old unresolved unlink succeeded, or a completion after the supplied evaluation UTC. Per-file replay states still describe supplied claims, not independently established native outcomes.

Old established effects remain intact when a new completion is unconfirmed. Conversely, an unrelated legacy hold blocks whole adoption without reclassifying a locally consistent new completion as unconfirmed. A structurally invalid completion produces rejection, not an unconfirmed completion accepted as valid history. All diagnostic arrays and nested effects remain frozen.

Unexplained loss of a non-target frozen-baseline receipt, payload body, receipt source membership or payload source membership is transaction-local `baseline_source_missing`, unless recorded legacy maintenance already accounts for that ID. Each variant leaves the completed transaction in `unconfirmed_completions` and withholds its effects. A surviving payload copy can be explained by the frozen receipt's payload hash even if the receipt body is absent. This is distinct from an unrelated legacy hold outside that baseline. A top-level `source_evidence_missing` may additionally describe the store-wide quality issue; the shared transaction-local blocker and completion classification are the same for receipt-only, payload-only and combined losses.

For a non-target frozen-baseline pair not covered by recorded legacy retirement, the current source receipt, source payload inventory and both bodies must remain available. Loss of either body or either inventory membership adds the same transaction-local `baseline_source_missing` blocker, so a claimed whole completion remains unconfirmed and contributes no established effects. Receipt-only, payload-only and combined body losses have the same completion classification. The top-level reason may also retain an earlier store-wide `source_evidence_missing`; callers must inspect the transaction-local blockers rather than infer completion certainty from that one summary string. Independent legacy holds outside this relationship retain the separation described above.

`adoption.state` is `blocked` or `conditional`, with explicit blockers. Any incomplete, held, conflicted, invalid or over-limit component blocks **the entire scope**, including partial adoption of an otherwise valid old history. Conditional only means the supplied claims permit a future qualified reader's interpretation; the actual `history_read_available` and all execution flags remain false.

`status: consistent` denotes structurally consistent claims (an unfinished transaction may still be blocked); `held` denotes unresolved quality/evidence after structural checks; `rejected` denotes invalidity or a resource stop. Structural/reference/chain/transition violations take priority over an earlier quality hold. All JSON/schema validation precedes replay. A future event or missing evidence does not terminate replay early and hide a later contradiction. A resource or abnormal stop terminates the whole invocation immediately.

`effects_status: evaluated` means all supplied effects were examined; it does not establish the unconfirmed entries. `remaining_effects_unknown` is true when an unconfirmed completion remains. `partial` preserves only the bounded frozen diagnostic copy of already checked legacy effects when new transaction verification fails, also with `remaining_effects_unknown: true`. Failure before that copy exists yields null effects and `not_evaluated`, never "no maintenance." On rejection, an empty `unconfirmed_completions` array is not proof that no other effects exist: evaluation is incomplete as indicated by those fields. No failed result exposes a partially adoptable history.

The compatibility summary `read_effect` is blocked when adoption is blocked; otherwise it is unchanged, prune-only, clock-only, or `combined_conditionally`. Consumers must use the versioned independent effects/adoption contract. Compatibility `prune_boundary` derives only from established effects, never an unconfirmed completion, and is non-null only when that established prune boundary is known. Unconfirmed claims cannot supply a retention floor or ordinary first-seen projection. No ordinary projection is run here; unknown original history must remain unknown in a future reader.

## Evaluation snapshot and clocks

The v3 header has a directory of exact evidence hashes, a declared store policy, explicit active inventory and an independent `evaluation` tuple:

* evaluation ID and supplied UTC `at`;
* `journal_hash` of the ordered `{role,hash}` entries for all non-source records (including completion when present);
* `inventory_hash` of canonical `{policy_hash,entries}` with inventory entries sorted by their canonical JSON;
* `evidence_hash` of supplied receipt/payload `{role,hash}` entries sorted by hash then role;
* exact selected intent hash and latest attempt hash, or null;
* nullable `{clock_id,monotonic_ns}` evaluation sample, separate from the attempt's stored `observed_ns`.

The journal hash excludes the header/evaluation and source bodies, so deleting permitted bodies neither rewrites a historical journal nor creates a circular hash. Active-inventory or saved-evidence changes require a new matching evaluation tuple. The two hashes are independent; quarantined evidence is not treated as an active object. The tuple must bind the exact supplied journal, inventory and active attempt; its evaluation ID cannot alias a record/approval/clock identity.

A clock ID names one claimed monotonic source/epoch. The module tracks its last counter across attempts. Attempt issuance cannot precede the previous counter in that domain. Issued/observed/event/completion counters must be internally ordered, and wall/event times must fit their attempt window. Wall and monotonic lifetimes are positive and at most ten minutes; reaching a deadline is expired.

For an unfinished attempt, a missing/different evaluation clock holds as `evaluation_clock_unverified`. A matching evaluation sample before the last recorded tick holds as regression; at/after the deadline holds as expired. The recorded attempt observation is not substituted for this evaluation sample. A historically complete transaction is not invalidated solely by current expiration or inability to compare an unrelated current clock.

This establishes supplied-tuple consistency only. No real clock is sampled, no source/epoch is authenticated, and the freshness of an actual current evaluation is **unverified**. A stale caller-supplied tuple is not magically made fresh by hashing it. Production clock supply and restart qualification require a separately reviewed path.

## Shared resource ceilings and open 1,024-pair decision

| Resource | Current inclusive refusal ceiling |
| --- | ---: |
| Input, including header and all evidence | 16 MiB |
| One canonical record, including header | 1 MiB |
| Encoded result | 8 MiB |
| Buffers including header | 30,000 |
| Selected pairs / active source receipts | 1,024 / 1,024 |
| Per-record lexical depth / nodes | 64 / 262,144 |
| Shared work per invocation | 4,194,304 |

These are **joint refusal ceilings, not guaranteed successful batch or store sizes**. The whole input consumes the shared work budget even without a transaction. The active-store ceiling is named separately from selected-pair count; both remain 1,024 in the current prototype, without increasing a numeric allowance. In particular a flat directory cannot reach 30,000 valid entries within the header limit. The current v3 full-log synthetic fixtures at 272 and 273 pairs stop at work_limit; 1,023/1,024/1,025 pairs stop at record_bytes_limit. Their header byte sizes are respectively 285,773 / 286,823 / 1,074,775 / 1,075,835 / 1,077,003. These fixture-specific observations do not define a universal maximum or claim 1,024-pair compatibility. The earlier v2 measurements used a different envelope and are not current v3 measurements.

The user selected the v1-scale compatibility goal, previously called alternative B. The alternative of keeping only the prototype's current capacity was not selected as the release goal. This design selection does **not** approve implementation, new numeric ceilings or activation. Approval stages A and B below describe implementation/verification permissions, not those earlier compatibility alternatives.

No expanded paging/replay profile, automatic splitting, ceiling increase, new reservation or deletion credit is enabled. Stage A now has internal small-scale page preparation under existing limits; its scope and remaining obligations are recorded in [the stage A record](NATIVE_BAR_COMMITTED_PAGING_STAGE_A.md). The required expanded design includes directory, active-inventory and baseline pages; paging the directory alone is insufficient. v1 permits up to 4,096 committed captures, a 256 MiB receipt/payload query, 16 MiB old maintenance metadata and 30,000 filesystem entries. Normal reads, in-progress recovery, post-prune reads and post-isolation recording must all be acceptance profiles. Profile, new numbers, margin and capacity source require separate approval. Page/attempt/recovery budgets must never reset if an expanded profile is later approved.

All input lengths are checked before all copies. Proxies, sparse/index-accessor arrays, subclasses, Buffer/views, shared/resizable/detached ArrayBuffers and unsupported intrinsics refuse without caller methods. Strict UTF-8, depth/node preflight, JSON grammar, canonical spelling and raw hashes precede schema/semantic work. Repeated buffers consume bytes each time. Output size/work is checked before append. A latched budget failure cannot resume.

The one shared budget charges scans, copies, hashes/generation in 64-byte blocks, explicit record/reference/transition visits, sort comparisons and canonical fields. Bounded opaque schema/legacy helper work and worst-case string escaping are conservatively prepaid, without refunds. Variable target scans use sets/maps rather than repeated full comparisons. Fixed diagnostic reserve and a pre-frozen, pre-sized legacy-effect copy keep a later stop bounded. Work units are algorithmic accounting, not OS CPU/heap/time guarantees.

### Capacity expansion and paging: updated implementation/verification plan, not enabled

Plan baseline updated after the store-wide sequence/guard-coverage correction and the diagnostic-phase clarification (2026-11-17 JST): source SHA-256 `c1d6d13a68b9b53845b4c08bd8e189d7806f27d37cd1f67887863ea0dce5694a`, test `43fe41d26e6ad2a631603d9d85d025101572e2e6758e64ffae91255d33d8e118`. The previously recorded baseline results are 452 passing selected pure tests and fourteen targeted detected mutations; this document-only update does not rerun them. Earlier artifacts and their campaigns remain historical evidence below; the former same-sequence/different-epoch positive fixture was incorrect and is superseded by this correction. Those are regression evidence, **not capacity evidence**. This update changes the plan only; no implementation, reservation, limit, native operation or activation is authorized by it. Existing uncommitted work, STOP and protected unallocated 765 bytes remain intact. The diagnostic record and capacity ledger are outside this change.

#### Compatibility target and byte accounting

Stage A's preparation-only checkpoint and its source fingerprints are recorded in [NATIVE_BAR_COMMITTED_PAGING_STAGE_A.md](NATIVE_BAR_COMMITTED_PAGING_STAGE_A.md). The hashes and 452-test/14-mutation results above identify the pre-extraction review baseline; that record distinguishes its checkpoint's small-test results, arithmetic construction sketches and remaining unproved resource/monitoring obligations. The proposed expanded profile below remains inactive.

The subsequently approved small-scale connection is recorded in [NATIVE_BAR_COMMITTED_PAGED_CONNECTION_STAGE_A.md](NATIVE_BAR_COMMITTED_PAGED_CONNECTION_STAGE_A.md). It preserves v3 while adding an internal v4 diagnostic path with one existing-limit budget, correctly staged semantics and forced outer adoption stop. Its current results/fingerprints supersede the preparation-only checkpoint for connection work; no expanded profile or stage B activation follows from it.

Acceptance targets **the whole v1 store**: up to 4,096 active captures within a combined 256 MiB receipt/payload read, and one logical transaction selecting up to 1,024 pairs from that populated store. The count and byte limits must both hold: 4,096 separate 1 MiB payloads do not fit. Splitting one intended operation into separately approved/completed transactions is not 1,024-pair compatibility. Normal reads without a transaction are a required profile.

All numbers below are proposed inclusive ceilings for a separately approved expanded pure candidate, not current constants or reserved recording space. MiB means 1,048,576 bytes; lengths are raw UTF-8 frame bytes, with every supplied buffer occurrence counted, including duplicates and pages.

| Resource | Proposed ceiling | Accounting contract |
| --- | ---: | --- |
| Active source receipts / selected pairs | 4,096 / 1,024 | Store size and one transaction scope are separate. |
| Receipt/payload evidence, live and saved combined | 256 MiB | Non-target and archived proof bodies share this bucket; deletion gives no credit. |
| Legacy intent/completion bytes combined | 24 MiB | Intents also have a separate 16 MiB sublimit; completions 8 MiB. Existing v1 30,000 filesystem entries remain a distinct claimed-store constraint, not a frame count. |
| New intent/manifest/attempt/event/completion frames | 32 MiB | All attempts and recovery records for the logical transaction share it. Manifest frames belong here, not also in page framing. |
| Root, directory, inventory and baseline pages | 16 MiB | Includes all framing and duplicated receipt fields carried in baseline pages. |
| **All supplied frames** | **328 MiB = 343,932,928 bytes** | 256 + 24 + 32 + 16; category-disjoint sum, no deductions. |
| One frame / encoded result | 1 MiB / 8 MiB | A page must satisfy both its item cap and the unchanged individual byte cap. |
| Frames including root and pages | 65,536 | Input-only representation bound; not permission for that many real store files. |
| Directory / inventory / baseline page entries | 512 each | An original logical receipt or entry is never split across frames. |
| Manifest page pairs | 64 | Sixteen pages for 1,024 pairs; one original approval and one whole completion. |
| Attempts / events per logical transaction | 256 / 32,768 | Also constrained by bytes, nodes, frames and work; no budget reset on recovery. |
| Lexical depth / per-frame nodes | 64 / 262,144 | Existing local bounds retained. |
| All lexical nodes / metadata subset | 33,554,432 / 8,388,608 | Metadata is every non-receipt/non-payload frame; the subset is also included in the total. |
| Shared work | 1,073,741,824 | Provisional; acceptance needs an audited bound of at most 805,306,368 units, leaving at least 25% unused. |

328 MiB is the envelope refusal ceiling, not a claim that every bucket maximum can coexist in schema-valid input. Framing, entry limits and completion shapes may make some combinations unreachable. Stage A must document representability and publish the largest jointly feasible positive profiles; an artificial padding input that fails schema validation cannot establish a maximum-size success. The 4,096/256 MiB and populated-store/1,024-pair positive requirements cannot be replaced by successful smaller tests. If those are unrepresentable under the proposed page/node/work constraints, stop and return for design review.

First validate the dense ordinary ArrayBuffer input shape, each length, frame count and aggregate 328 MiB bound **before copying any frame**. Then decode bounded root/directory pages and precharge the declared categories by their actual frame lengths before copying large evidence. A declaration is not trusted: each directory role, raw hash and strict decoded schema must agree; no reclassification or refund is allowed after a mismatch. Cross-bucket reassignment cannot evade a quota. All copying, parsing, encoding and hashing uses the same latched invocation budget. Source bytes still belong to the caller and remain included in the memory envelope.

#### Representation and generation contract

Use a separate explicitly versioned paged candidate entry, with proposed input/result v4 schemas. The existing input/result v3 entry and its constants retain their exact contract. New paged intents require a distinct schema (proposed intent-v3); immutable v1 evidence/maintenance and v2 intent/journal bytes are never rewritten or relabelled. A v2 intent remains subject to its original representation limits even inside a future container; only a genuinely new paged definition can bind a paged baseline. Any reuse of an existing event schema must preserve its exact semantics and intent/attempt hash binding; otherwise give it a distinct schema. No synthetic approval or completion is created per page.

The directory enumerates logical evidence and journal frames only; it does not recursively enumerate its own framing pages. The root separately lists all framing pages by kind, ordinal, count and exact raw SHA-256. Directory/inventory/baseline collections have typed, deterministic order and explicit total counts. Missing, duplicated, reordered, conflicting-role, unreferenced and wrong-collection pages refuse. Inventory has at most one entry per recording-ID/role, independent of source/holding location. A baseline receipt is reconstructed in validated sequence order across page boundaries.

Separate two meanings of generation to avoid circular hashes:

1. **Collection commitment:** hash the canonical logical rows, excluding page framing, page hashes and the commitment field itself. For a legacy-v2 baseline, the canonical logical object remains exactly `{receipts,maintenance}`, preserving its existing `baseline_generation` for unchanged content. A new collection domain/version is explicit when its logical schema changes. Each page carries its collection commitment, kind, ordinal, total pages and entry count.
2. **Whole verification snapshot generation:** hash a canonical root snapshot object containing policy, collection commitments, ordered exact page references, ordered evidence/journal commitments, and evaluation ID/UTC/clock tuple. The outer root stores that snapshot and its hash; the hashed object contains no reference to its own hash. Baseline pages contain no descendant intent/journal hashes. This makes the dependency graph acyclic.

A root/page mismatch or changed evaluation tuple refuses. Byte-identical pages with the same collection commitment can be reused as immutable content; that is not proof that two different whole snapshots are the same. Binding one page does not authenticate another page, a real collector, native inventory or a running build. Compatibility digests must be streamed in the original canonical order, never replaced with a hash of page hashes under an old field name.

#### Preserve the newly reviewed semantic checks

Factor common semantics from `src/nativeBarCommittedTransactions.ts` into an internal pure kernel only as needed; proposed additions are a paged-input module, bounded summary/index helpers and synthetic paging tests. Keep the existing wrapper/result authority flags and all prior uncommitted fixes. No runtime/MCP, native store, policy file, diagnostic record, capacity ledger or backend integration belongs to this work.

* Validate **all** page schemas, raw hashes and collection bindings before deciding adoption. A missing body or future event may add quality holds, but must not hide a later structural contradiction. An abnormal/resource failure ends the whole invocation.
* Retain receipt fields/hash/byte size, payload hash/byte size/`capture_as_of`/latest observation, original baseline predecessor, provenance, role/location and replay state in bounded indexes. Validate every bar and provenance field before replacing decoded payloads with summaries. Dropping a decoded body is a memory optimization, never a claim that its bytes were absent from the supplied evidence. Duplicate payload/receipt identities remain detectable after eviction.
* Preserve same-legacy-transaction ordering using validated receipt sequence across every page. Recording time, available payload cutoff and optional legacy observation summary cannot regress below the previous known receipt time. An unknown middle member does not reset that predecessor. Combine supplied and frozen-baseline originals before the final check, and reset only at the legacy transaction boundary; page boundaries and different clock epochs are not interchangeable.
* Preserve a single sequence-to-recording-ID registry across legacy references, supplied receipt copies and the complete frozen baseline, with and without a new transaction. Different IDs sharing a sequence refuse across pages, old maintenance records and clock epochs. Repeated representations of the same ID/sequence do not themselves constitute a collision, but still require all identity/hash/policy and overlap checks. Only the per-legacy-transaction temporal predecessor resets; sequence ownership never does. Reject a declared future `day` when `recorded_at` is supplied; do not derive an omitted timestamp from the partition day, payload or another epoch.
* Resolve missing-receipt inventory references from the fixed baseline's exact canonical receipt/payload hashes, then still validate baseline generation, policy, sequence and surviving copies. Memoization is allowed only for immutable content within this invocation and exact generation. It must not skip the raw-copy/baseline comparison, provenance checks or validation merely because an ID was cached.
* Preserve `baseline_source_missing` and unconfirmed completion when a required non-target body or source membership is missing. Verified terminal target bodies remain optional as before. Pending unlink/quarantine retains operation-specific unknown-outcome classification; effects and whole adoption remain separate. Never infer success, weaken v1 prune eligibility/binding, clear uncertainty or change the recording floor solely to fit a page.

Preserve the current diagnostic phase boundary when factoring or streaming: finish the `legacyView` supplied-copy reference/time-order checks across the relevant pages **before** freezing and exposing its bounded legacy-effect snapshot. A copy-time contradiction detected there returns `rejected`, `effects_status: not_evaluated` and `effects: null`. After that snapshot, transaction/baseline validation and the later `checkStoreSequences` pass may reject while preserving it. A collision detected by that later pass returns `store_sequence_alias`, `effects_status: partial`, non-null preserved `effects` and `remaining_effects_unknown: true`. Both paths block adoption/read effects; partial diagnostics are never adoptable history. Stronger existing guards may reject earlier, so not every sequence-related failure is promised the later classification. Do not publish page-local effects, take a fresh snapshot per page, or move all checks to one phase and erase this observable distinction. A bounded implementation may retain summaries or revisit supplied immutable frames under the same budget; its pass order and retained evidence must establish both phases without depending on frame arrival order.

The charge table must cover the **current** extra work: inventory requests and baseline-reference serialization/hash, later full baseline validation, raw legacy-batch sorting, combined frozen/supplied sorting, known-predecessor comparisons, source summaries, provenance, v1 prune/clock binding, declared-only and residual-payload timestamp/eligibility validation, four-series maximum-observation scans, per-record sequence-set visits/lower-bound ordering, store-wide sequence-owner registration across legacy/copy/baseline representations, future-day checks, and final unconfirmed/effect projection. Include every byte pass, schema/JSON visit, canonical escape, map/set construction, sort comparison, replay visit and output reserve. Count both passes if the implementation actually performs both; a claimed cache saving needs tested exact-content equivalence. Bound total batch-sort comparisons from accepted membership counts; do not reset at pages, attempts, recovery, or a later maintenance record. An audit bound above 805,306,368 units stops stage A's sufficiency claim; do not silently increase 1,073,741,824.

The resource audit must include the global sequence registry, raw-copy and combined-reference passes, per-transaction predecessor state, and the frozen diagnostic snapshot coexisting with later baseline/replay indexes. Charge repeated representations and actual revisits even when their ID is shared. These structures must fit within the summary/index, staging and total allowances below; the clarification does not add memory or work capacity. Stage A must provide bounds on their entries/encoded bytes and demonstrate how an early failure avoids exposing a snapshot and a later failure serializes the reserved snapshot within the result cap. If that accounting cannot establish the proposed margins, stop for a revised design rather than increasing the profile.

#### Resource estimate and measurement plan

The following is a conservative allocation target **above the warmed verifier baseline**, not measured consumption or allocated recording capacity:

| Simultaneously live contribution | Planning allowance |
| --- | ---: |
| Caller-supplied raw input | 328 MiB |
| One-frame copy, hashing and transfer scratch | 8 MiB |
| Current-frame decoded JSON/schema clones | 96 MiB |
| Receipt/payload summaries, baseline and provenance/replay indexes | 128 MiB |
| Canonical/page/output staging, including the 8 MiB result | 64 MiB |
| GC/allocator retention allowance | 128 MiB |
| Uncommitted measurement margin | 272 MiB |
| **Incremental RSS envelope** | **1,024 MiB** |

Stage A must check that each structure has a byte/node/count bound; the table is not evidence that V8 will meet it. In stage B use a fixed documented Node version, architecture, OS, flags, dependency versions and fixture/module hashes. Each test case listed in the approved manifest uses a **fresh verifier process**; the manifest can approve a bounded group of cases together. Freeze its warm-up procedure in the approved harness definition: load the specified modules and initialize their runtime/schema machinery, without constructing, receiving or parsing that case's evidence. After the ready handshake, the supervisor obtains the verifier's current RSS once as R0, **before fixture generation or any input transfer/allocation for that case**; require R0 no greater than 256 MiB. Record its acquisition time, process identity and warm-up definition/hash. Do not reuse a previous case's process, warm it repeatedly until a favorable reading appears, force GC solely to qualify, or reset R0 after allocation or transfer. An invalid/missing R0 stops the stage; a replacement run is not automatic.

Incremental peak RSS is `max(0, peakRSS - R0)`. Track the peak from R0 acquisition through the case's confirmed termination, including any wait for the producer; it **includes input buffers**, copies, decoded objects, indexes, output and retained garbage. Do not subtract 328 MiB from it. Record heap-used/heap-total/external/ArrayBuffer metrics separately; ArrayBuffer bytes are already included in external memory and must not be summed twice. Fixture generation belongs to its separately measured producer, never to the verifier's R0 baseline.

Use a separate synthetic fixture generator and an independently supervised verifier process, with bounded ownership transfer where supported. Record producer/supervisor memory as well as candidate memory; shared/overlapping inputs are not free. Do not assume cross-process IPC is zero-copy: every generator/transport clone counts while live. Where ownership transfer is unavailable, use bounded stream framing and include its measured copies in the same envelope. Limits proposed for a B invocation: incremental candidate RSS at most 1 GiB, total candidate RSS at most 2 GiB, concurrent test-process-tree RSS at most 2 GiB, and elapsed verification time at most 60 seconds. Record fixture-generation time/memory separately. No forced-GC-only measurement is sufficient.

Use one **independent supervisor's monotonic nanosecond clock** for both endpoints and the deadline. Stage A must name the exact clock API and its supported precision/behavior in the fixed harness environment before B approval. UTC/wall time and verifier-supplied timestamps cannot determine elapsed time, and counters from different clock domains are not subtracted. Record `t0` immediately before permitting the first input byte/ownership transfer to the verifier; the 60-second deadline is `t0 + 60,000,000,000 ns`. Generation of the fixture before t0 is measured separately; input delivery, copying/preflight, decoding/schema/hash checks, replay, output encoding/transport and supervisor result validation all remain inside the interval. A change in UTC does not reset the deadline.

Record `t1` only after the supervisor has received and validated the complete bounded result and confirmed exit/reaping of the verifier and every other case-owned producer/worker, with their transport closed and no pending case I/O. A result received before the deadline is provisional until these conditions hold. A normal or expected verifier-refusal case passes its timing check only when `t1 - t0 <= 60,000,000,000 ns`. If those conditions have not been observed by the deadline, terminate the owned synthetic processes, record timeout/cleanup outcome and stop the stage; a late result or late exit does not restore success. Missing/regressing monotonic readings, unsupported clock behavior or failure to confirm termination also stop the stage. Supervisor startup and prescribed warm-up are recorded separately from this interval; no case data may be allocated in that excluded verifier warm-up.

A supervisor must operate while synchronous parsing is busy; a timer inside the verifier cannot enforce that deadline. Record OS peak RSS plus independent samples at no more than 10 ms intervals, with runtime memory samples at bounded page/phase boundaries. For process-tree acceptance, conservatively sum each participating process's OS peak; this may overcount noncoincident peaks but cannot rely only on a sampled concurrent sum. Untracked children or unavailable per-process peaks invalidate the run. Sampling/termination may detect an overshoot after it happens: **any** observed peak/elapsed-limit violation invalidates the run, even if a result was produced. Monitoring gaps, unmeasurable peak memory or inability to stop the synthetic worker invalidate capacity evidence. Test the supervisor first on bounded synthetic stall/allocation controls. Do not use a production process, deny an overshoot, retry automatically or raise the envelope to obtain a pass.

#### A/B approval separation and stopping rules

This plan update itself grants neither stage. The user subsequently approved **stage A only**, implemented as bounded internal preparation and small synthetic tests; see [the stage A record](NATIVE_BAR_COMMITTED_PAGING_STAGE_A.md). Stage B remains unapproved. The earlier choice of the v1-scale design goal alone is not stage approval, and stage A does not certify the conditional maximum-case/work estimates or activate expanded verification.

| Stage | Separate approval would permit | Boundary that stays closed |
| --- | --- | --- |
| **A: inactive paging/core preparation** | Pure common-kernel/page validation implementation and small synthetic regression/guard tests using the existing 16 MiB/1,024-active/4,194,304-work ceilings. Produce the schema/dependency graph, charge bound, representable maximum fixtures and harness design. | Existing v3 entry/constants remain unchanged. No expanded profile can be selected by an option/environment variable, public import or test helper. No 328 MiB or expanded-work run in A. |
| **B: expanded pure capacity verification** | After A review, explicitly approve the exact proposed profile, schemas, fixture set, resource bound and supervisor. Enable that profile **only in the separate synthetic pure candidate** and execute the maximum/negative matrix below. | B does not switch the existing v3/default/MCP/backend path, grant native authority, release STOP or enable real store operations. |

A max-condition fixture specification or serialized-size construction proof can be prepared in A without constructing/validating expanded live input. Actual expanded allocation/decoding/replay and resource measurement wait for B. If the resource audit or representation constraints require different numbers, submit that concrete revised profile before B; neither stage authorizes silent ceiling growth. Any later normal-entry migration, release/runtime integration or production activation requires a separate concrete review and approval outside A/B. No backtest, real chart, model, notification, DOT or native maintenance is included in either stage.

Distinguish **termination of one verifier invocation** from **stopping the entire approved A or B stage**. Before running a case, the approved test manifest fixes its input/mutant identity, expected status/reason, adoption/effects/authority assertions and cleanup outcome. A failure cannot be relabelled as an expected negative after it occurs.

| Observed outcome | Case and stage disposition |
| --- | --- |
| Planned invalid-input/counter-boundary case returns its exact expected rejection, with the required blocked adoption and diagnostics | End that invocation; its latched failure cannot resume. If all assertions, actual time/memory limits and cleanup checks pass, record the negative case as successful and continue to the next distinct preapproved case. This is never a maximum-capacity positive success. |
| Planned missing-evidence case returns its exact expected hold/unconfirmed-completion/effect classification | End the case. After the same resource/cleanup checks, continue to the next preapproved case; the hold creates no adoption or capacity evidence. |
| Planned targeted mutant fails the specified assertion after its relocated control passed | Record that condition as detected and continue as prescribed. Syntax/import errors, an unrelated failure or an unexplained survivor do not count as detections. |
| Planned supervisor stall/allocation control triggers its expected stop | Use preapproved **lower synthetic thresholds**, within the actual A/B resource envelope. Verify bounded termination and monitoring evidence before continuing. This does not authorize exceeding a real stage limit. |
| Positive control is rejected/held, a negative case has a wrong/missing assertion, a mutation outcome is unexplained, or any other unplanned mismatch occurs | Stop the entire stage; do not run the next case or automatically repeat this one. Preserve the failure and bounded diagnostics for review. |

Unexpected version/digest/role/count/schema mismatch, baseline/evaluation or approved-artifact drift, incomplete structural validation, unsupported representation, loss of compatibility, invalid R0/clock, monitoring failure, failed cleanup or **actual** time/RSS envelope violation stops the entire stage, including during a negative/mutation/control case. An expected `work_limit` or byte/count refusal from a deliberately bounded verifier test is distinct from exhausting the real supervisor's memory/time envelope. The next distinct case already listed in the approved manifest may have its own fresh process and invocation budget; pages, attempts and recovery within the same logical case may not reset it. Preserve the original failure; no alternate executor, permission change, retrospective expectation change or automatic retry. Resuming a stopped stage requires review and explicit approval of the revised scope. Neither stopping nor continuing within this manifest expands the A/B permissions above.

Before a B approval, stage A must resolve and present: the exact versioned grammar/hash dependency graph; a construction proof for the two required maximum positive profiles; the audited work/space table; the fixed measurement environment and enforceable supervisor design; and destinations/caps for any persisted synthetic fixtures or result records. The 328 MiB value is a processing-input envelope, not a disk reservation or permission to charge the research ledger. If persisted artifacts need space, identify a separately approved source before writing them; the protected 765 bytes cannot be used. Real native input authenticity and actual filesystem-entry/OS properties remain outside pure capacity proof.

#### Acceptance and regression matrix

Every positive control must be structurally valid, eligible, and return the expected consistent/conditional result with all native/execution/approval flags false. Every negative or held case checks its exact reason/classification/effects, not only that adoption is blocked. Publish actual frame/category/node/item/work counts, fixture hashes, latency and memory for each B profile.

| Required profile | Positive acceptance and paired control |
| --- | --- |
| Normal read, no transaction | **4,096 active captures and exactly 256 MiB combined raw receipt/payload bytes**, schema-valid full bar arrays and long provenance; no target filtering. Keep the same count with one extra evidence byte for the byte-limit refusal; separately use 4,097 small captures for the count refusal. |
| One complete maximum operation | 1,024 eligible pairs selected from an initial source/frozen baseline of 4,096 captures at the 256 MiB evidence boundary, sixteen manifest pages, one approval/attempt/whole completion. Include all 3,072 non-target pairs. At completion the truthful active inventory contains 3,072 retained pairs; target bodies are absent or saved proof copies outside active inventory. Retained proof copies still share the 256 MiB bucket. Require successful effects and no unconfirmed completion; compare the same logical small fixture with the current v3 verifier. |
| Partial deletion and completed prune | Delete bodies from the **synthetic supplied evidence** at each receipt/payload interruption point, preserving fixed metadata and truthful inventory. Pending outcomes hold; verified terminal bodies may be absent; exact-scope resume does not repeat deletion. Full completion and post-prune reads succeed where evidence is sufficient, with unchanged truncated/unknown origin. |
| Clock correction and later v1 retirement | Corrected-clock continuation with and without retained quarantine proof copies, a remaining ahead record that blocks it, later eligible v1 prune/clock references bound to baseline, and ineligible/hash-forged controls. Preserve both old and new effects. |
| Same legacy transaction across pages | Put predecessor and successor on adjacent and nonadjacent pages; include unknown middle members and mixed raw/frozen evidence. Test bad recorded time, cutoff and observation summary independently, including missing later payload/optional summary. Separate-epoch old transactions with distinct globally owned sequences succeed in both record orders; page boundaries never reset an in-transaction check. Supplied receipt time remains the predecessor bound when optional v1 times are omitted. Check future-day rejection, earlier/equal-day controls and genuinely omitted receipt times without filling them. |
| Store-wide sequence ownership and provenance | Test legacy/legacy, legacy/live-copy and legacy/frozen-baseline different-ID collisions across adjacent/nonadjacent pages and both legacy-record orders, using fixtures that reach the intended guard. Repeat with and without a new transaction where applicable. Same-ID/same-sequence raw/legacy/baseline representations pass all remaining bindings; same-ID repetition does not excuse hash drift or forbidden target overlap. An unexplained receipt copy is rejected both with a completed transaction and without a transaction, including after its decoded body is evicted. |
| Diagnostic phase compatibility | On the same small logical fixture, compare v3 and the candidate: a supplied-copy time-order contradiction found inside the legacy-view phase rejects as `legacy_batch_observation_order` before the snapshot (`effects: null`, `not_evaluated`). A cross-scope collision reaching the later store-sequence pass rejects as `store_sequence_alias` with non-null preserved legacy effects, `partial` and remaining uncertainty. Move witnesses across page boundaries without changing the logical evidence; assert exact phase/reason, blocked adoption/read effects and false authority flags. Do not require partial effects if a stronger existing guard legitimately rejects earlier. |
| Fixed inventory after body loss | Retain the original inventory and remove required receipt/payload/both bodies of non-target baseline pairs for both operation kinds. Resolve identities, then require `held`, `baseline_source_missing`, an unconfirmed completion and withheld new effects. Wrong hash/unknown ID/baseline policy or generation still refuses. |
| Large archived/legacy/journal mix | Maximum schema-feasible legacy intent/completion population, saved evidence, new logs and many recovery attempts within **all** buckets simultaneously; a documented feasible total, not an assumed exact 328 MiB success. No deletion credit or page/attempt budget reset. |
| Page, version and aggregate boundaries | Missing/repeated/reordered/mixed-commitment/unreferenced pages, tuple drift, alias/provenance conflicts, duplicate raw buffers, schema/category substitution, and original-v2/new-paged separation. Exercise each representable inclusive bound and its one-byte/item/node/frame/page/event/attempt/work excess independently, resealing unrelated hashes. |

For a numerical envelope not reachable by valid grammar, document the representability reason and use a bounded preflight/limiter negative test, explicitly labelled **not** a successful capacity profile. A full 328 MiB unparsed buffer test alone proves neither schema-valid capacity nor 1,024-pair compatibility. A result that is rejected/held for a different ceiling is not evidence for the intended boundary; use a feasible paired fixture or an isolated counter test and report its limited scope.

Keep the 452-test regression baseline, literal v1 golden bytes/hashes/projections and the fourteen current targeted mutations; rerun them after factoring code. Add page-boundary and cached-baseline mutants that disable ordering reset, predecessor carry, raw/frozen union, store-wide sequence registration, supplied-receipt fallback, pre-diagnostic copy validation, exact role hashes, missing-body classification, category accounting, aggregate counters, root/page commitments and whole-adoption gating. Specifically remove each legacy/copy/baseline registry population and each transaction/no-transaction invocation, reset ownership at a page/epoch boundary, and incorrectly reject repeated same-ID representations. For the early copy-order mutant, require the assertion to detect that a later rejection returns partial effects instead of null; rejection alone is insufficient. For the later sequence mutant, require the intended collision's exact rejection/diagnostics and prevent conditional adoption. Include omitted-time fallback, future-day and transaction-receipt-origin mutants with positive controls. A passing relocated control precedes each targeted mutation group; only assertion failures count as detections. Record exact source/test/mutant hashes and surviving/equivalent cases. The current fourteen detections do not prove future paged-code coverage or the earlier exhaustive campaigns. Use small in-budget equivalents in A; expanded page/store cases and measured maximum profiles wait for B. PID-reuse and all native qualification remain unverified.

### Uncertain-operation resolution: proposal, not enabled

`unlink_pending`, `durability_unknown` and conflict cannot be cleared by a new attempt asserting success. That safety rule remains implemented. It is not yet an operational escape from an uncertain store: native reconciliation and a separately versioned resolution record are still missing, so P3's store-recovery limitation remains open.

A proposed resolution fixes a new resolution ID, original intent hash, exact journal tail, current policy/root/object/clock bindings, inventory and evidence generation, and every affected file's intended outcome. A fresh human approval binds this exact plan and its expiry. Old error events and `original_acknowledgement: not_proven` remain immutable. A changed prefix, policy, object, inventory or plan invalidates the approval. Resolving one exact scope must not excuse a different unfinished operation.

| Proposed resolution outcome | Positive evidence / interpretation |
| --- | --- |
| Verified unchanged or restored | Exact original bytes and identity in an allowed source location, qualified access/link/parent checks and no conflicting holding/quarantine object. An actual restore is a separately approved exact native operation, never inferred from absence elsewhere. |
| Verified current quarantine | Exact bytes/identity at the approved quarantine location, source/holding absence checked through pinned descriptors, and a fresh durability witness. This proves a new current state, not the old operation's acknowledgement. |
| Explicit unknown-loss closure | Absence cannot prove unlink success. Only an explicitly approved history-gap record could permit a qualified future reader to retain unknown origin and unknown lost observations; it must not become `purged_verified` or an all-period first-seen claim. |
| Conflicting or unqualified objects | Preserve all objects and hold. No automatic overwrite, deletion, permission change, alternate root or retry to obtain a clean state. |

The resolution grammar, native evidence producer, approval authentication, locking, durable publication and reader integration require separate design/implementation approval. No resolution role is accepted by the current pure parser, no uncertainty is cleared, and execution remains unavailable. Validation must cover crash points before/after each publication, stale prefixes, substituted/reused identities, wrong scope, both locations present, unknown links, clock rollback, missing approval, cancellation with unfinished I/O, release failure, and loss of response after a new durability witness. Old diagnostics must remain visible after any later qualified resolution. PID-reuse/native qualification remains unverified.

## Tests, scope and remaining blockers

The unit suite uses invented in-memory records only. Passing controls precede isolated field changes; dependent hashes are resealed where needed so an unrelated stale reference does not satisfy a guard test. Reasons, blocked adoption and authority flags are checked in addition to rejection. Regressions cover post-delete and partly deleted recovery, multiple pairs, duplicate completion targets, later observations, combined/unknown/blocked effects, per-field access and identity, alias namespaces, actual evaluation tuples, chain/completion/time/eligibility, ctime, both approval_time_only outcomes and resource refusal boundaries.

Literal v1 golden receipt/payload/maintenance bytes, hashes and earliest-retained/unknown-origin projections are unchanged. Their source helper fingerprints remain c90d8add... (evidence) and 0a00489e... (artifacts). Golden expectations are not generated by the new implementation. Existing pure maintenance/transaction tests are run separately. The prior revision's representative non-equivalent guard mutations were checked against temporary copies of its exact compiled module and test artifact: **16 tested, 16 detected by assertion failures, zero survived**. This historical result and its fingerprints are preserved below; the current correction run follows the table. The unmodified relocated control passed first; syntax/import failures were not counted as detections. Each mutant changed one named guard and ran the non-bulk suite. Temporary artifacts were removed. This is not a rerun or verification of the previously reported 89-mutation campaign, and is not an exhaustive mutation-coverage claim.

Prior-revision verification fingerprints: compiled module `863a2b023c518e5341a83fe1ddd7bf6282ba8f23e5324076d879e62c2a4a2a2f`; original test `992a4676f7a116a8e7b82961031565d6f4d3b8a1e26e278e213bdf6fd00b0650`; relocated test `0025565675d5a210f683525faf3a642606f5c184a67c1c29508278c7e6c6fda7`.

| Disabled guard | Executed mutant SHA-256 prefix | Detected |
| --- | --- | --- |
| Owner UID | 2a1058fb9347 | yes |
| Object alias | 301276bc3116 | yes |
| Intent approval alias | 97ea553886c6 | yes |
| Same-clock regression | 6f3a53470312 | yes |
| Duplicate completion target | 4d82aea5abfb | yes |
| Completion last hash | 3dfc4bed7ba9 | yes |
| Event sequence | 81b3f0f51e68 | yes |
| Event previous hash | 121bca4b355a | yes |
| Ctime regression | 46487fa78e73 | yes |
| Unlink age recheck | dc34e03f3173 | yes |
| Retired target | bb47f0da1d45 | yes |
| Evaluation binding | 7f7a37e88b48 | yes |
| Missing-body state | d30fb18ac335 | yes |
| Whole adoption gate | f728d69723ff | yes |
| Pending sequence reuse | c97ee125f347 | yes |
| Original receipt summary hash | 06dbf5dd4e97 | yes |

Prior v2 correction verification (2026-11-16 JST): build succeeded; **311 selected pure tests passed** (111 committed-contract tests plus 200 existing maintenance/transaction tests). Regressions first reproduced both reported defects. They now cover absent/present bodies, retained data following a purged predecessor, equal cutoff timestamps, reversed manifest order, unresolved unlink completion, future completion claims, unrelated legacy holds, frozen diagnostics and structural-error precedence.

The prior v2 representative campaign disabled 20 guards one at a time: **20 detected by assertions, zero survived**, after an unmodified control passed. It rechecked the preceding 16 guard types and added the retained-baseline cutoff, deleted-target cutoff, unresolved-completion classification and unrelated-hold scope cases. The 89-case campaign remains unverified; 20/20 is not an exhaustive coverage claim. Temporary test copies were removed and the workspace module/test bytes were unchanged by mutation testing.

Prior v2 fingerprints: source `de090fc8a40530670e5feb9a62b80eaf3e0e06a58e336cf2b0ad6abb8e2936c9`; compiled module `7a55ae5a0b5ebbf2ac0167a3691252fc7f9dfccbbbc135feccc7dd9b9bd3d91a`; test `72be09a9646479a436f5845a90789f944b841c5d130d626516cac0faf5523c1f`; relocated test `8e076cc5ec2793c35951ae0960bcec21316903020488a13bd3d05ab91f487e4c`.

| Prior v2 disabled guard | Executed mutant SHA-256 prefix | Detected |
| --- | --- | --- |
| Owner UID | 6b1506b9c48d | yes |
| Object alias | 37ba779020a1 | yes |
| Intent approval alias | 49820967dd82 | yes |
| Same-clock regression | 4533b26775ee | yes |
| Duplicate completion target | 99a28dfce6b4 | yes |
| Completion last hash | da38418ee7f7 | yes |
| Event sequence | 9ceb5d6bd0aa | yes |
| Event previous hash | c2c7cf8743f3 | yes |
| Ctime regression | 594b35897ce8 | yes |
| Unlink age recheck | ae0e590c78ac | yes |
| Retired target | 741a1a2a24b3 | yes |
| Evaluation binding | fd39361b0445 | yes |
| Missing-body state | df4cab85c949 | yes |
| Whole adoption gate | cb09c0c5da16 | yes |
| Pending sequence reuse | eb4d38183ca0 | yes |
| Receipt summary hash | 0633e233f4e2 | yes |
| Retained baseline cutoff | 902e5a7f1ab8 | yes |
| Deleted target cutoff | 1205033a5f14 | yes |
| Unresolved completion classification | de6dd960f927 | yes |
| Unrelated hold scope | 2422f3a3c49e | yes |

Earlier v3 lifecycle correction verification (2026-11-16 JST): build succeeded; **345 selected pure tests passed**, zero failures/skips (145 committed-contract tests plus 200 existing maintenance/transaction tests). Corrected-clock continuation succeeds both after removing quarantined bodies and while retaining their proof copies; an unisolated ahead record still prevents continuation. Live terminal inventory, retired-receipt policy drift, inventory/hash drift and unsupported v2 envelopes have dedicated controls and refusal assertions. No ordinary/native history read or recording operation was executed. This run preceded the completed-prune/later-v1-clock regression described below.

The reviewer confirmed that the original mutation diffs/fixtures were not saved. The **24 named surviving conditions were reconstructed** as guardC01-C24 with valid controls, resealed dependent hashes and specific reason/effect/adoption assertions. They are not a claim to reproduce the exact original 25 or 89 mutants. Disabling each corresponding guard in a temporary compiled copy made its own test fail by assertion: **24 detected, zero survived**. An unmodified relocated control passed first; import/syntax failures were not counted. Temporary copies were removed. A separate six-case lifecycle campaign also detected every removed lifecycle guard after a passing control.

Earlier v3 verification fingerprints: source `483a3a939e4b93903127f3e519fde25d0b134cc76b5309304a76ae1826a47ae4`; compiled module `123b8ccf7fa1fa8b3789f98e01a78eb365878c1e7c6ca42486ed6ad17ba9aaef`; test `5b8f5e3ce8b262adb391353ca8183f9ce9afcdec21f5e0cf2ee9b6f688689ec6`. The C01-C24 relocated test hash was `f642a359584104711387dd95b58c11eb9bc8e6578529446bc224c2ae4885e9bb`. The lifecycle run used its own temporary absolute import paths; its mutant hashes therefore are not directly comparable with C01-C24 or earlier campaigns.

| Earlier v3 disabled guard | Executed mutant SHA-256 prefix | Detected |
| --- | --- | --- |
| C01 complete target set | cebad56f82f9 | yes |
| C02 old completion hash | 4d3ea94a6e2b | yes |
| C03 receipt requires payload | a1be1e96ea3c | yes |
| C04 payload requires receipt/reference | e35c6615bd3b | yes |
| C05 observation cannot follow recording | c45bebbfab02 | yes |
| C06 non-target baseline presence | fe381ec7638a | yes |
| C07 original deleted receipt timestamp/hash | 1554737c6457 | yes |
| C08 legacy target overlap | 738151305410 | yes |
| C09 unlink pending transition | e63e7a96c4f6 | yes |
| C10 manifest hash | 70eff290def3 | yes |
| C11 event intent hash | 7efecabe5358 | yes |
| C12 event attempt hash | bc91fed0e1bc | yes |
| C13 first approval plan | a37bc53db080 | yes |
| C14 first approval timestamp | 37e54e11be5e | yes |
| C15 ten-minute wall lifetime | e84ee324c350 | yes |
| C16 ten-minute monotonic lifetime | 64ee5fcfa7d2 | yes |
| C17 pair count | bbdb1f6ba386 | yes |
| C18 exact manifest set | 9ef4b21f3f76 | yes |
| C19 holding presence | 423ac91a82c8 | yes |
| C20 ctime observation bracket | f1db924181a0 | yes |
| C21 prior maintenance hash | c26dc5b7d332 | yes |
| C22 unfinished baseline additions | 40673e6b2b31 | yes |
| C23 unknown prune boundary remains unknown | 6c7523420972 | yes |
| C24 events after completion | 57301461fe40 | yes |
| L01 absent quarantine proof | 8f586e3af869 | yes |
| L02 corrected-clock retained floor | ab5f6d080cda | yes |
| L03 proof/active-history separation | c9a204700056 | yes |
| L04 new terminal live-inventory conflict | 7ae741be72c0 | yes |
| L05 old terminal live-inventory conflict | 2404b846d83d | yes |
| L06 retired receipt policy | da5458dc8ef9 | yes |

Prior prune/inventory-correction whole-store profiles without a transaction confirm the outstanding resource problem. Each capture in the first profile has four series with forty bars; the second additionally has two 65,536-character provenance strings per series. These are schema-valid examples, not universal maxima. All stopped results block adoption. Charges below include receipt-origin visits; that prior revision's fingerprints are recorded below; these profiles were not rerun for the batch-order follow-up.

| Ordinary-read synthetic profile | Captures | Supplied bytes | Result | Charged work |
| --- | ---: | ---: | --- | ---: |
| Forty bars per series | 1 | 27,914 | consistent | 44,227 |
| Forty bars per series | 97 | 2,655,034 | consistent | 4,177,968 |
| Forty bars per series | 98 | 2,682,401 | work_limit | 4,194,304 |
| Forty bars per series | 99 | 2,709,768 | work_limit | 4,194,304 |
| Forty bars per series | 128 | 3,503,440 | work_limit | 4,194,304 |
| Forty bars plus long provenance | 1 | 552,186 | consistent | 199,882 |
| Forty bars plus long provenance | 8 | 4,413,631 | consistent | 1,590,794 |
| Forty bars plus long provenance | 32 | 17,652,918 | input_bytes_limit | 319 |

P2-A and the active-inventory/policy P3 cases are addressed within this supplied-evidence contract, including the follow-up combination below. P2-C has the reconstructed 24 targeted mutation checks; exhaustive mutation coverage remains unverified. P2-B remains open pending approved paging/resource implementation and whole-store acceptance profiles. The uncertain-operation P3 case remains open pending the proposed qualified resolution protocol; no sticky failure is silently cleared. Typographic curly quotation marks were replaced with ASCII quotation marks.

Follow-up completed-prune/later-v1-clock correction (2026-11-16 JST): a new regression first failed with `post_completion_order` for a May 2 observation after a completed prune and subsequent v1 isolation of a June 1 baseline capture. The equivalent all-v1 history passed. The recording floor now excludes those individually completed v1 clock-isolation targets even when the selected completed transaction is a prune. It does not rewrite the original baseline, discard prune targets from the floor, reset sequence or weaken policy. New set construction and traversal consume the same existing shared budget.

The prior recording-floor follow-up build succeeded and **352 selected pure tests passed**, zero failures/skips (152 committed-contract tests plus 200 existing maintenance/transaction tests). Seven additional tests cover the all-v1 comparison with and without saved original proof bodies, blocked incomplete clock isolation, later prune alone, the remaining original prune floor, a still-active ahead capture, sequence reuse and policy drift. The passing comparison preserves combined effects, prune boundary, unknown original acknowledgement and all false authority flags. Input/result v3 and immutable v2/v1 record formats are unchanged. Prior recording-floor fingerprints: source `e7e95a811f26bc084148b28f0ac8cd2277be7403d80e7c18229ba87dbc04a6f1`; compiled module `bb3c6d37d27f65da5ee7c6d2eeb2530bcb0f0fd0bc880a365967a41e1411801e`; test `dd116a218c7402ec2c6d868a9306ea573578960c742b99f118ed4ac8fa425134`. Earlier 24+6 mutation results above are historical and were not rerun for those follow-up artifacts. Numeric ceilings, capacity implementation and qualified uncertain-operation resolution remain unchanged and incomplete.

Follow-up v1-clock/baseline binding correction (2026-11-16 JST): a new receipt-hash regression first failed because a resealed contradictory v1 clock record remained `consistent/conditional`. It now refuses with and without saved proof copies. A separate saved-payload summary regression likewise failed before exact size/observation checks were added. Fifteen additional tests cover each reported hash/attribute mismatch, present-payload summaries and receipt-time ordering, absent-payload bounds, omitted optional timestamps, pending contradictions, the strict clock-ahead boundary, and explicit preservation of unverified absent-body claims. Positive recording-floor/v1-format controls continue to pass; no actual native v1 reader or recorder was invoked.

The prior clock-binding build succeeded and **367 selected pure tests passed**, zero failures/skips (167 committed-contract tests plus 200 existing maintenance/transaction tests). Shared meter charges include the additional receipt byte-size scan and legacy-reference/payload visits. Limits, schema versions, native flags, PID-reuse qualification and protected 765 bytes were unchanged. Prior clock-binding fingerprints: source `99213a0a83c9fdcade1d5f248395176868eb972539f432d7c315a141086626eb`; compiled module `08b9963634c7c7759ed784787afa4e351be126f3e7120ffb1637eec11e0d66e0`; test `44d9cf52bd2b9d028062c5a9dadd84ae8007faee2754d1a97cdfd8aad1cfea48`.

For these exact binding-correction artifacts, thirteen individual guard conditions were disabled one at a time in temporary compiled copies. An unmodified relocated control passed; each mutant then failed its corresponding regression by assertion: **13 detected, zero survived**. Import/syntax failures were not counted, and temporary copies were removed. The earlier 24+6 campaigns were not rerun; neither this targeted run nor those historical runs establish the original 25/89 campaigns or exhaustive mutation coverage.

| Binding-correction disabled guard | Executed mutant SHA-256 prefix | Detected |
| --- | --- | --- |
| B01 fixed receipt hash | c93fcf277d09 | yes |
| B02 fixed payload hash | 2d04562a9fe7 | yes |
| B03 fixed sequence | 70214421f575 | yes |
| B04 fixed partition day | 7bc3beaf6644 | yes |
| B05 fixed recording time | 5c1497f481b7 | yes |
| B06 observation upper bound | 7a3c3f8fea77 | yes |
| B07 observation predecessor bound | 2aeeb5871c9b | yes |
| B08 payload-size lower bound | f944c4893b58 | yes |
| B09 payload-size upper bound | 6b116f68d478 | yes |
| B10 known clock eligibility | 442a247052ec | yes |
| B11 exact saved payload byte size | ac2f79a72985 | yes |
| B12 exact saved latest observation | df020660f8d1 | yes |
| B13 saved observation cannot follow receipt | 67f1d0bae95b | yes |

Prune/inventory/provenance correction (2026-11-16 JST): regressions first reproduced acceptance of forged later v1 prune references, asymmetric pending inventory, unexplained receipt copies and the payload-only loss/completion discrepancy. Prune now shares the known-receipt hash/attribute/size/observation checks with clock isolation and enforces strict original 90-day eligibility. A correctly bound completed prune still permits corrected-clock continuation after a clock transaction; a pending or ineligible prune does not. Forged later boundaries refuse alongside prune transactions as well. Supplied original receipt copies are checked before the legacy diagnostic snapshot; frozen-baseline-only contradictions refuse after that snapshot with non-adoptable partial diagnostics.

The prior prune/inventory correction build succeeded and **391 selected pure tests passed**, zero failures/skips (191 committed-contract tests plus 200 existing maintenance/transaction tests). Twenty-four additional tests cover the reported P2 and P3 conditions. guardV301-V310 explicitly exercise the ten reported v3 coverage gaps, including the valid later-prune positive case. Dependent record/evaluation hashes are resealed; failures check specific reasons, adoption, effects or unconfirmed-completion classification rather than merely `blocked`. The old retired-target fixture was corrected to use coherent receipt references and eligible time so the intended retired-target guard remains independently exercised. Unrelated legacy holds still do not downgrade a valid new completion. Two redundant policy checks were removed; the header/intent binding and policy-before-exclusion checks remain independently tested.

Prior prune/inventory correction fingerprints: source `be33bd8d4f888811d5afd1e24bdccc9316e7d82db896b6f898714b630e61af30`; compiled module `f9ec98230f09b66b90b6e63551906856031466acc643ea8ceb16e7fb5c1ae6fb`; test `519aeec29323a38c8f68a66de246fcf88c218180f056c1ae8a2d463c440492e7`.

For those prior artifacts, a memory-only mutation run used the exact compiled/test inputs. Twenty-one unmodified selected controls passed, then **23 individual conditions were disabled and all 23 were detected by assertion failures**, zero survived. V301-V310 reconstruct the ten reported gaps; P01-P08 and Q/O/C add prune binding, pending quarantine, receipt provenance and baseline-loss scope checks. This is not an exact replay of the user's original mutation artifacts or an exhaustive campaign. Only dependency import specifiers were relocated for execution; no workspace module/test was overwritten. The following fingerprints identify the compiled mutants **before import relocation**, and are not directly comparable with the executed-module prefixes in historical tables.

| Disabled condition | Compiled mutant SHA-256 prefix | Detected |
| --- | --- | --- |
| V301 bodyless intent/header policy | 8fd45e57282f | yes |
| V302 active receipt needs payload inventory | 752cfc2838a4 | yes |
| V303 source payload needs active receipt | 87c4352c9b28 | yes |
| V304 non-target baseline receipt membership | a11cf0bddba5 | yes |
| V305 whole inventory-state guard | 3252bb16b74f | yes |
| V306 source location | 7b96bba99505 | yes |
| V307 verified-holding location | c8a9bae4ba9f | yes |
| V308 pending-unlink location | 835d4bf1b703 | yes |
| V309 target evidence needs inventory | edc0b3cb7ce0 | yes |
| V310 valid completed prune removes clock floor | e6be265195f2 | yes |
| P01 receipt hash | 56ce17190bfb | yes |
| P02 payload hash | 3ebc08c6bdad | yes |
| P03 sequence | 0f809e873f85 | yes |
| P04 partition day | 0d2ba1c9e37b | yes |
| P05 recording time | f37eeb2f63bc | yes |
| P06 strict 90-day eligibility | a95ea0c92e61 | yes |
| P07 exact saved byte size | ee1476b189e1 | yes |
| P08 exact saved observation | 1285efc18bbe | yes |
| Q01 pending-quarantine location | 7cbe931d5c2d | yes |
| Q02 quarantine unknown-outcome reason | 3eadcac27ae1 | yes |
| O01 unexplained receipt rejection | a60b223d629a | yes |
| C01 non-target baseline payload body | 5360dcb5ff22 | yes |
| C02 non-target baseline payload inventory | 003e20b7c51f | yes |

Legacy-batch/inventory-reference follow-up (2026-11-16 JST): the archived-cutoff regression first failed with `consistent` instead of rejection. A separate absent-payload summary regression also reproduced acceptance of an observation before its known predecessor. Both now refuse within the same legacy batch. Fixed-inventory body-loss tests keep the pre-loss inventory and rebuild only the evidence/evaluation tuple; receipt-only, payload-only and combined loss all hold adoption, report one unconfirmed completion with `baseline_source_missing`, and withhold its new effects. Wrong inventory hashes/IDs still refuse; invalid baseline generation/policy cannot be blessed by identity resolution.

The prior batch/inventory follow-up build succeeded and **409 selected pure tests passed**, zero failures/skips (209 committed-contract tests plus 200 existing maintenance/transaction tests). Eighteen added tests include prune/clock controls, reversed input/reference order, absent payloads, an unknown middle member, combined frozen/supplied evidence, and valid distinct-clock-epoch archives. The receipt-chronology regression omits the optional legacy observation summary so its guard is exercised independently of the summary lower-bound guard. v1 helper bytes, schema versions, limits and authority flags are unchanged. Native v1 integration and PID-reuse qualification remain unverified.

Follow-up fingerprints: source `1e7f0fc1b53ebba350a929e406146a0e6d24b545a9bc2ed34fb4623ef8fd4bfd`; compiled module `5915b18fa42a2a3b2968e8645400e56380d969da37350105a1fbdbbdbbd5878a`; test `165e59be3487735a9add12d81658b0871c168b4a86ba5551bc0707c985c4b17f`.

A memory-only campaign against those prior batch/inventory artifacts first passed the 18 unmodified selected controls, then disabled ten conditions individually: **10 detected by assertion failures, zero survived**. A surviving preliminary receipt-chronology mutant revealed that its fixture also triggered the observation-summary guard; the optional summary was removed from that fixture and the complete ten-case campaign was rerun on the fingerprints above. Dependency specifiers alone were relocated; workspace modules/tests were not overwritten. The prefixes below identify compiled mutants before import relocation. Earlier 23/24/89-case results were not rerun or promoted to exhaustive coverage.

| Follow-up disabled condition | Compiled mutant SHA-256 prefix | Detected |
| --- | --- | --- |
| N01 receipt chronology | 0cfff0b62cc1 | yes |
| N02 payload cutoff | 5b77a7f51589 | yes |
| N03 sequence sort | 800196a91513 | yes |
| N04 raw legacy-batch check | 256182526fbf | yes |
| N05 combined frozen/supplied originals | 72ec3a9a40a2 | yes |
| N06 frozen inventory resolver | a8ad73506bc3 | yes |
| N07 exact inventory hash | 4fa600f28606 | yes |
| N08 separate clock-epoch batch boundary | e9e6dbc13c98 | yes |
| N09 known predecessor across unknown member | 5d35f712e0b1 | yes |
| N10 summary observation lower bound | ded82a5cac0b | yes |

Transaction receipt provenance / original-less v1 claim correction (2026-11-16 JST): added an explicit completed-transaction receipt-copy regression. Its valid completion control passes, an unexplained copy outside inventory/baseline/legacy scope refuses as `unreferenced_receipt`, and removing only the transaction-path origin call makes that assertion fail. Prior tests had covered only the no-transaction origin path. The origin guard itself remains enabled. Removed the redundant target-payload reference insertion: every target is already bound to a baseline receipt whose payload hash was registered; baseline and legacy/present-receipt references remain.

Original-less v1 references now undergo declared-value consistency and strict eligibility checks with and without a new transaction. Regressions first reproduced acceptance of a one-day-old prune, an observation after its receipt, a backward declared sequence time, and an observation-only predecessor followed by an earlier claim. The shared final per-maintenance pass combines original, frozen and declared members, without crossing maintenance/clock-epoch boundaries. A declared observation can carry a lower bound across an omitted receipt time, but no field or prune boundary is filled. Missing both times adds no bound, does not clear an existing bound, and remains an unverified legacy claim. Known-original hash/attribute/eligibility checks are preserved. A declared contradiction after the legacy diagnostic snapshot rejects with partial diagnostics and blocked whole adoption; that copy is not a retention boundary or partially adoptable history.

The prior original-less-claim correction build succeeded and **431 selected pure tests passed**, zero failures/skips (231 committed-contract tests plus 200 existing maintenance/transaction tests). Twenty-two added tests cover receipt provenance with a transaction, claim consistency/eligibility, strict 90-day and 60-second boundaries at -1/0/+1 ms with both/receipt-only/observation-only fields, missing times, equal/reversed order, missing-middle carry, supplied/frozen/declaration mixtures, incomplete-legacy error precedence and separate epochs in both record orders. Tests keep raw v1 claim bytes unchanged and native authority/acknowledgement unproved. The shared `attachLegacy` fixture previously gave clock isolation an August receipt predating its December approval; it now uses a genuinely ahead January claim and a matching partition day. The four affected effects/hold/diagnostic tests pass their original behavioral assertions. No production data or native v1 reader was used.

Prior original-less-claim correction fingerprints: source `1e1d2b09a7490f9547f106235a13120b71e3beb7c339d1a827cec28fb28c44fe`; compiled module `a9fc3e552147e54cd2078c03aa97e16daac025efed503a2337a8a5c86a87479b`; test `ae73f79514342aed4eb3a53f3d125b7fe867c4d6535e2279c25e983fd4dd79eb`.

For those prior original-less-claim artifacts, a memory-only targeted campaign first passed 69 unmodified selected controls, then disabled twenty conditions individually: **20 detected by assertion failures, zero survived**. The prefixes below identify compiled mutants before dependency-import relocation. Preliminary malformed mutation/harness definitions were corrected and were not counted as detections; the complete twenty-case run then passed its controls and detected every mutant. No workspace source, build or test was overwritten by mutation execution. This is targeted regression evidence, not an exhaustive rerun of previous campaigns or capacity/native qualification.

| Current disabled condition | Compiled mutant SHA-256 prefix | Detected |
| --- | --- | --- |
| R01 transaction receipt origin | dc3383067ad5 | yes |
| L01 no-transaction legacy validation path | 95666e845e0a | yes |
| L02 transaction legacy validation path | 8c8e770779e4 | yes |
| L03 original-less claim validation call | 4b3d6a56b48a | yes |
| L04 own observation order | 59cac3ec2bfa | yes |
| L05 strict prune boundary | 43cd8e90d8d8 | yes |
| L06 strict clock boundary | e30b2b7f629b | yes |
| L07 declared receipt eligibility timestamp | 5804266558dd | yes |
| L08 declared observation eligibility timestamp | 6c7e630b5453 | yes |
| L09 batch receipt-time order | 4f4646c7b9ad | yes |
| L10 batch sequence sort | b2b805234011 | yes |
| L11 bound carry across omitted middle | 7ddbe78d9d12 | yes |
| L12 observation-only lower bound | 97ae13b87701 | yes |
| L13 no fabricated missing time | 10a5d44ee98b | yes |
| L14 declared-only batch membership | c9ac7e6ec99a | yes |
| L15 frozen-original lookup | 1a2df231b905 | yes |
| L16 per-maintenance clock-epoch boundary | e127a6822011 | yes |
| L17 later observation lower bound | 0e0ff28dbfb4 | yes |
| V01 baseline inventory resolver | 0ac9e3a74f27 | yes |
| V02 exact inventory hash | e7345c2ca650 | yes |

The capacity plan's regression baseline and work-accounting list reflect this correction; its proposed capacity numbers, A/B approval separation, supervisor/clock/R0 requirements and stop rules are unchanged and inactive. PID-reuse/native qualification remains unverified. The protected 765 bytes and diagnostic/capacity ledgers are untouched.

Residual-payload/sequence correction (2026-11-16 JST): regressions first reproduced acceptance of a residual payload observed after a declared receipt, a recent payload when both declaration times were omitted, a later claim preceding an earlier residual observation, and duplicate declared sequences accepted in one array order. Original-less validation now reads the matching payload's actual maximum observation, validates available declaration fields, applies eligibility to all available timestamp evidence and passes an internal observation bound to the same-batch order check. A per-maintenance sequence set refuses duplicates before sorting. No receipt/observation field, prune boundary or original acknowledgement is manufactured. That revision scoped both the sequence set and time bound per maintenance/clock epoch. Its sequence-scope interpretation was incorrect under v1 and is superseded by the store-wide registry below; the local time-order scope remains correct.

The prior residual-payload correction build succeeded and **443 selected pure tests passed**, zero failures/skips (243 committed-contract tests plus 200 existing maintenance/transaction tests). Twelve added tests cover both transaction paths; actual-vs-declared time contradictions; exact latest-observation summaries; the fourth series carrying the maximum; strict 90-day/60-second observation boundaries at -1/0/+1 ms with declaration fields omitted; optional fields preserved; actual-observation predecessor bounds; pending-legacy error precedence; equal/different-time duplicate sequences in both reference orders and both operation kinds; mixed original/declaration duplicates; and separate legacy epochs with the same declared sequence and reverse legacy-record ordering. New-transaction journal order is preserved by that last fixture. The shared old-maintenance fixture formerly reused a present January payload hash while claiming an August observation; it now uses distinct absent-evidence hashes so the original coexistence/hash-binding assertions remain independently exercised. Two affected controls now pass without weakening their assertions.

Prior residual-payload/sequence fingerprints: source `23f4f67762395e395b4f297d8039dc723a0b90eb5fd76052274eb3a7195c8c55`; compiled module `d318ef50bc9bbdda1ee5f41470396101e8634716169a5fd882b9bbb996734bde`; test `6d59602aae4ba6982e587d511bc825a7fece35db75388aacaba9cd83a2fb4fbc`.

A memory-only campaign on those prior residual-payload artifacts first passed 81 unmodified selected controls, then disabled thirty conditions individually: **30 detected by assertion failures, zero survived**. This rechecks original-less, provenance, inventory and clock-boundary behavior as well as the new residual-payload/sequence conditions. The following fingerprints identify compiled mutants before dependency-import relocation. No source/build/test file was overwritten by mutation execution. These are targeted conditions, not exhaustive mutation, capacity or native qualification evidence.

| Prior residual-payload/sequence disabled condition | Compiled mutant SHA-256 prefix | Detected |
| --- | --- | --- |
| P01 matching payload lookup | 19d902d1e9cf | yes |
| P02 maximum over all series | 6f0bfc6ad67b | yes |
| P03 payload observation after declared receipt | d96251886570 | yes |
| P04 exact declared observation summary | dc24879075db | yes |
| P05 payload contribution to eligibility | ff100691de88 | yes |
| P06 observation-bound return | 450ad170c6ba | yes |
| P07 payload lower-bound carry | 46fd83c59353 | yes |
| P08 strict prune boundary | b22e86aee7a1 | yes |
| P09 strict clock boundary | 24a7d2895d29 | yes |
| S01 duplicate-sequence refusal | 7e41113c7ef8 | yes |
| S02 sequence-set membership | ac6d5125396d | yes |
| S03 sequence-set per-record scope | 121070aa6101 | yes |
| S04 no-transaction sequence check | cea1068f8cab | yes |
| R01 transaction receipt provenance | e48d41f7c6c0 | yes |
| L01 no-transaction legacy validation | 66ac5b3ed464 | yes |
| L02 transaction legacy validation | c051f8debff4 | yes |
| L03 original-less validation call | 1ddaf7dd3c64 | yes |
| L04 declared observation order | bfa5a8bb0b18 | yes |
| L05 declared receipt eligibility | 5df8eb50b9dc | yes |
| L06 declared observation eligibility | cdf167bb6539 | yes |
| L07 batch receipt order | f8b2d94c38d3 | yes |
| L08 sequence sort | 41de96b3508b | yes |
| L09 missing-middle bound carry | 51efa6fd6eef | yes |
| L10 declared-observation lower bound | 9f15da8a3a53 | yes |
| L11 no fabricated omitted time | 3aaa7338cccf | yes |
| L12 declared-only membership | a9a270371dbd | yes |
| L13 frozen-original lookup | 8b93ccbe683d | yes |
| L14 per-record time-bound reset | 98a5fe7954d9 | yes |
| V01 baseline inventory resolver | bab34976fad1 | yes |
| V02 exact inventory hash | a491abc6ff2c | yes |

The capacity plan's baseline/accounting list is refreshed for this correction only. Its proposed ceilings, A/B permission separation, timing/R0/supervisor contract and stop conditions are unchanged and inactive. The protected 765 bytes and diagnostic/capacity ledgers are untouched; PID-reuse and native qualification remain unverified.

Store-wide sequence / guard-coverage correction (2026-11-17 JST): three regressions first reproduced acceptance of different IDs sharing one sequence across legacy/legacy, legacy/live-receipt and legacy/frozen-baseline scopes. A shared registry now binds all three evidence populations for both transaction paths. Same-ID/same-sequence representation repeats are accepted subject to existing stronger checks. Sequence numbers remain globally unique even after clock correction; only temporal ordering resets per old maintenance record. The old positive test that reused a sequence across epochs was wrong: it now uses distinct sequences while retaining the backward timestamp and both legacy-record orders. No v1 writer, artifact schema or immutable record bytes are rewritten.

The two reported guard gaps now have dedicated behavior tests. A supplied receipt with omitted legacy timestamps must provide its actual recorded-time predecessor bound; removing the raw-copy fallback changes the later contradictory declaration from rejection to conditional. The supplied-copy time-order check inside `legacyView` must stop before the diagnostic snapshot (`effects: null`, `effects_status: not_evaluated`); removing that early order check still rejects later but returns partial diagnostics, which the new test detects. A cross-scope sequence collision that reaches the later `checkStoreSequences` pass is rejected as `store_sequence_alias` with `effects_status: partial` and non-null preserved `effects`, while whole adoption stays blocked. The early-stop guarantee in this paragraph applies to the `legacyView` copy-time check, not to that later sequence pass. These tests preserve the guards themselves, not just overall rejection. A future declared partition day also refuses when `recorded_at` is present, while earlier/equal dates and genuinely omitted receipt times have positive controls. The two extra blank-line groups were removed.

Build succeeded and **452 selected pure tests passed**, zero failures/skips (252 committed-contract tests plus 200 existing maintenance/transaction tests). Nine new tests cover the three cross-population collisions in both legacy-record orders, the two guard properties, repeated representations of the same original, future-day rejection, day boundaries/omission and receipt copies outside active inventory. Existing synthetic fixtures with legacy attachments now assign distinct earlier legacy sequences and a later selected-receipt sequence, resealing receipt hashes, byte sizes, manifest and frozen generation consistently. This repairs their previously hidden sequence collisions without weakening assertions. The literal v1 golden controls are unchanged.

Current store-wide correction fingerprints: source `c1d6d13a68b9b53845b4c08bd8e189d7806f27d37cd1f67887863ea0dce5694a`; compiled module `1a21b5d4b64d0e5c4542cab7712072011c4bd856a29de8b676c8783cc1917392`; test `43fe41d26e6ad2a631603d9d85d025101572e2e6758e64ffae91255d33d8e118`.

A memory-only campaign on these artifacts first passed ten selected controls, then disabled fourteen conditions individually: **14 detected by assertion failures, zero survived**. In particular T01 and T02 reproduce the two previously untested guards; the prior 30-case campaign did not cover these properties and was not rerun or promoted to exhaustive coverage. Fingerprints below identify compiled mutants before dependency-import relocation. No workspace source, build or test file was overwritten by mutation execution.

| Current store-wide disabled condition | Compiled mutant SHA-256 prefix | Detected |
| --- | --- | --- |
| G01 no-transaction registry invocation | a5af804d4c4e | yes |
| G02 transaction registry invocation | 0417f6c860c9 | yes |
| G03 legacy-reference registration | 004c1eb301ea | yes |
| G04 receipt-copy registration | c7a9dbf290c5 | yes |
| G05 frozen-baseline registration | 0dd83b247f84 | yes |
| G06 different-ID conflict | be465d650c15 | yes |
| G07 same-ID representation repeat allowed | e697e03eb495 | yes |
| G08 registry persists across legacy records | 1b178c0ccf48 | yes |
| T01 supplied receipt fallback | 0d6ae359f60f | yes |
| T02 pre-diagnostic copy order | 55841af7c201 | yes |
| D01 future declared day | 0bfa35c94867 | yes |
| D02 equal day allowed | cb551b7c7b44 | yes |
| D03 no day inference from observation | 1d07ad7b2b92 | yes |
| O01 per-record time-order reset | 655d2ce32611 | yes |

The capacity plan baseline/accounting list reflects this pure correction only. Proposed capacity numbers, A/B approval separation, supervisor/clock/R0 requirements and stage-stop rules are unchanged and inactive. Existing STOP, unrelated uncommitted work, protected 765 bytes and diagnostic/capacity ledgers are preserved. PID-reuse/native qualification remains unverified.

Numeric resource ceilings and all authority flags remain unchanged. No capacity expansion, paging implementation or qualified uncertainty-resolution mechanism is enabled. PID-reuse/native qualification is still unverified, and no native v1 reader/recorder, chart, DOT, external model or backtest was run.

Changes are confined to the pure verifier, its unit test and this document, plus ordinary generated build/test artifacts. There is no runtime/MCP/backend integration, production data operation, chart operation, DOT start, external model execution, notification, backtest or commit.

Descriptor-pinned native operations, actual approval authentication, exclusivity, durable publication, cancellation/cleanup, real clock/epoch supply, running-build qualification and native restart reconciliation remain production blockers. The earlier PID-reuse/native baseline remains 261 tests: 259 passed, one skipped and one failed because process/boot identity commands were denied. PID/boot proof is still unverified; those tests are not rerun, weakened or reclassified here.
