# Committed native-bar maintenance: stage 1, revised contracts

Status: pure supplied-record verification, with synthetic tests only. Production STOP remains in place. No production store, connection diagnostic, capacity ledger or protected unallocated 765 bytes is changed. The runtime refusal-before-IO and refusal-before-plan-consumption remains unchanged.

## Scope and versions

`inspectCommittedMaintenance` accepts an ordinary dense Array of attached, non-resizable ordinary ArrayBuffers containing canonical UTF-8 JSON. It imports only crypto, util, Zod and the unchanged pure v1 artifact/evidence helpers. It performs no IO, clock sampling, process inspection, lock acquisition, notification, execution or history read.

The stage-1 envelope, intent, manifest, attempt, event, completion and result are now **v2**. The old stage-1 input-v1 is explicitly refused as `unsupported_input_version`; old stage-1 records are not silently given new meanings. Actual `native-bar-receipt-v1`, v1 capture, `native-bar-maintenance-v1` and its `{id,intent_hash}` completion shape remain unchanged. These supplied copies do not authenticate a filesystem publication.

All results retain `diagnostic_only: true`, `execution_available: false`, `recovery_execution_available: false`, `production_qualified: false`, `host_approval_authenticated: false`, `native_bytes_verified: false`, `history_read_available: false`, and `original_acknowledgement: not_proven`. A consistent claim is not an authenticated human approval, verified native object or durable publication.

## Stable original evidence and deletion

Manifest-v2 refers to each target by recording ID and receipt/payload SHA-256, never a position in a later input array. It fixes sequence, day, recorded/latest-observed times, capture cutoff, original receipt fields and both object proofs. Canonical original receipt fields must reproduce the stored receipt hash and size. A supplied payload must match its hash, byte size, cutoff and latest observation. When its bytes have been deleted, the payload summary remains a **claim**; this module cannot independently re-parse or authenticate those absent original bytes.

The intent binding stores a canonical original baseline: receipt fields ordered by sequence, plus prior v1 maintenance IDs/hashes. `baseline_generation` hashes that complete baseline object. Duplicate identities/sequences, invalid day/policy/order, mismatched surviving receipts, missing prior maintenance or a baseline that already selects retired targets refuse. Baseline reconstruction does not use only the currently surviving receipts.

The verifier retains each baseline receipt's predecessor timestamp during that ordered traversal. Every selected target's stored `capture_as_of` and every available baseline payload must be at least that predecessor's `recorded_at`; an earlier cutoff refuses as `baseline_observation_order`. This applies after a predecessor or target has been purged, and to retained baseline payloads as well as selected targets. Equal timestamps are allowed. Predecessors come from the frozen baseline, not manifest iteration order. This check establishes a known temporal constraint, not the absent payload's full authenticity.

Remaining source records must match the baseline while the transaction is unfinished; additions or changed prior maintenance hold it as `current_baseline_changed`. After a complete transaction, later observations may be added without rewriting its original baseline. They must still obey the frozen policy, sequence and time boundary. Receipts removed by later recorded maintenance need not reappear. The immutable snapshot is supplied evidence, not an independently authenticated store inventory.

Body requirements are checked **per receipt and payload after complete bounded replay**:

| Replayed file state | Missing-body rule |
| --- | --- |
| Source, staged or verified holding | Missing required evidence holds adoption. Supplied bytes may represent the observed holding object; no path is read here. |
| `unlink_pending` without a verified terminal | Absence is `unlink_outcome_unknown`, never inferred success. |
| `purged_verified` | The body may be absent even while another file/pair remains unfinished. Original metadata, event binding and proof claims must remain consistent. |
| All targets terminal, no whole completion | No repeat deletion; adoption remains blocked until the separate complete scope is recorded consistently. |
| Whole prune complete | Deleted bodies are not requested again. |

A fresh recovery attempt binds the exact intent, event prefix and remaining action set. Already terminal files receive no new destructive action. Surviving unresolved moves use explicit reconciliation; reconciliation does not create permission for a fresh destructive step. Absence after a prior attempt's pending unlink cannot establish its success or original acknowledgement. Conflict is terminal; durability uncertainty remains sticky across recovery and prevents ordinary completion.

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

`adoption.state` is `blocked` or `conditional`, with explicit blockers. Any incomplete, held, conflicted, invalid or over-limit component blocks **the entire scope**, including partial adoption of an otherwise valid old history. Conditional only means the supplied claims permit a future qualified reader's interpretation; the actual `history_read_available` and all execution flags remain false.

`status: consistent` denotes structurally consistent claims (an unfinished transaction may still be blocked); `held` denotes unresolved quality/evidence after structural checks; `rejected` denotes invalidity or a resource stop. Structural/reference/chain/transition violations take priority over an earlier quality hold. All JSON/schema validation precedes replay. A future event or missing evidence does not terminate replay early and hide a later contradiction. A resource or abnormal stop terminates the whole invocation immediately.

`effects_status: evaluated` means all supplied effects were examined; it does not establish the unconfirmed entries. `remaining_effects_unknown` is true when an unconfirmed completion remains. `partial` preserves only the bounded frozen diagnostic copy of already checked legacy effects when new transaction verification fails, also with `remaining_effects_unknown: true`. Failure before that copy exists yields null effects and `not_evaluated`, never “no maintenance.” On rejection, an empty `unconfirmed_completions` array is not proof that no other effects exist: evaluation is incomplete as indicated by those fields. No failed result exposes a partially adoptable history.

The compatibility summary `read_effect` is blocked when adoption is blocked; otherwise it is unchanged, prune-only, clock-only, or `combined_conditionally`. Consumers must use the versioned independent effects/adoption contract. Compatibility `prune_boundary` derives only from established effects, never an unconfirmed completion, and is non-null only when that established prune boundary is known. Unconfirmed claims cannot supply a retention floor or ordinary first-seen projection. No ordinary projection is run here; unknown original history must remain unknown in a future reader.

## Evaluation snapshot and clocks

The v2 header has a directory of exact body hashes and an independent `evaluation` tuple:

* evaluation ID and supplied UTC `at`;
* `journal_hash` of the ordered `{role,hash}` entries for all non-source records (including completion when present);
* `inventory_hash` of present receipt/payload `{role,hash}` entries sorted by hash then role;
* exact selected intent hash and latest attempt hash, or null;
* nullable `{clock_id,monotonic_ns}` evaluation sample, separate from the attempt's stored `observed_ns`.

The journal hash excludes the header/evaluation and source bodies, so deleting permitted bodies neither rewrites a historical journal nor creates a circular hash. Inventory changes require a new matching evaluation tuple. The tuple must bind the exact supplied journal, inventory and active attempt; its evaluation ID cannot alias a record/approval/clock identity.

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
| Target/input receipt pairs | 1,024 |
| Per-record lexical depth / nodes | 64 / 262,144 |
| Shared work per invocation | 4,194,304 |

These are **joint refusal ceilings, not guaranteed successful batch sizes**. In particular a flat directory cannot reach 30,000 valid entries within the header limit. The revised full-log synthetic fixtures at 272 and 273 pairs stop at work_limit; 1,023/1,024/1,025 pairs stop at record_bytes_limit. Their header byte sizes are respectively 285,594 / 286,644 / 1,074,596 / 1,075,656 / 1,076,824. These fixture-specific observations do not define a universal maximum or claim 1,024-pair compatibility.

The choice remains OPEN:

* A: retain current ceilings and explicitly do not guarantee v1-scale 1,024-pair completion.
* B (recommended but not selected): preserve one logical 1,024-pair intent/whole completion with bounded directory/manifest pages; establish normal, recovery and post-delete profiles and approve revised total byte/work ceilings from conservative estimates and tests.

No paging, automatic splitting, ceiling increase, new reservation or deletion credit is implemented. Profile, new numbers, margin and capacity source require separate approval. Page/attempt/recovery budgets must never reset if B is later selected.

All input lengths are checked before all copies. Proxies, sparse/index-accessor arrays, subclasses, Buffer/views, shared/resizable/detached ArrayBuffers and unsupported intrinsics refuse without caller methods. Strict UTF-8, depth/node preflight, JSON grammar, canonical spelling and raw hashes precede schema/semantic work. Repeated buffers consume bytes each time. Output size/work is checked before append. A latched budget failure cannot resume.

The one shared budget charges scans, copies, hashes/generation in 64-byte blocks, explicit record/reference/transition visits, sort comparisons and canonical fields. Bounded opaque schema/legacy helper work and worst-case string escaping are conservatively prepaid, without refunds. Variable target scans use sets/maps rather than repeated full comparisons. Fixed diagnostic reserve and a pre-frozen, pre-sized legacy-effect copy keep a later stop bounded. Work units are algorithmic accounting, not OS CPU/heap/time guarantees.

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

Current correction verification (2026-11-16 JST): build succeeded; **311 selected pure tests passed** (111 committed-contract tests plus 200 existing maintenance/transaction tests). Regressions first reproduced both reported defects. They now cover absent/present bodies, retained data following a purged predecessor, equal cutoff timestamps, reversed manifest order, unresolved unlink completion, future completion claims, unrelated legacy holds, frozen diagnostics and structural-error precedence.

The current representative campaign disabled 20 guards one at a time: **20 detected by assertions, zero survived**, after an unmodified control passed. It rechecked the preceding 16 guard types and added the retained-baseline cutoff, deleted-target cutoff, unresolved-completion classification and unrelated-hold scope cases. The 89-case campaign remains unverified; 20/20 is not an exhaustive coverage claim. Temporary test copies were removed and the workspace module/test bytes were unchanged by mutation testing.

Current fingerprints: source `de090fc8a40530670e5feb9a62b80eaf3e0e06a58e336cf2b0ad6abb8e2936c9`; compiled module `7a55ae5a0b5ebbf2ac0167a3691252fc7f9dfccbbbc135feccc7dd9b9bd3d91a`; test `72be09a9646479a436f5845a90789f944b841c5d130d626516cac0faf5523c1f`; relocated test `8e076cc5ec2793c35951ae0960bcec21316903020488a13bd3d05ab91f487e4c`.

| Current disabled guard | Executed mutant SHA-256 prefix | Detected |
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

Changes are confined to the pure verifier, its unit test and this document, plus ordinary generated build/test artifacts. There is no runtime/MCP/backend integration, production data operation, chart operation, DOT start, external model execution, notification, backtest or commit.

Descriptor-pinned native operations, actual approval authentication, exclusivity, durable publication, cancellation/cleanup, real clock/epoch supply, running-build qualification and native restart reconciliation remain production blockers. The earlier PID-reuse/native baseline remains 261 tests: 259 passed, one skipped and one failed because process/boot identity commands were denied. PID/boot proof is still unverified; those tests are not rerun, weakened or reclassified here.
