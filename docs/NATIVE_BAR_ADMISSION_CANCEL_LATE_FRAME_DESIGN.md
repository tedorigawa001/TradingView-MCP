# B4 Pre-Connection Cancel And Late-Frame Design

Status: **design approved; B4-P1 independently reviewed/tested in pure memory models only**, 2026-10-31 JST, source baseline `88edb86`. This refines the [worker/transport design](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md), [controller contract](NATIVE_BAR_ADMISSION_UNSIGNED_CONTROLLER_DESIGN.md) and [execution design](NATIVE_BAR_ADMISSION_UNSIGNED_EXECUTION_DESIGN.md). The [P1 record](#b4-p1-memory-implementation) covers the later separate implementation approval and the [independent review](#b4-p1-independent-review) covers its local commit gate; a [follow-up](#b4-p1-follow-up) keeps the retention summary true until the drained CANCEL completes. P2/P3 and all real worker/transport connections remain unimplemented; approval of this design is not operational approval.

Dot stays PAUSED. Market/scenario/judgment/notification/mail, retention, confirmation counts, thresholds and bands are unchanged. No real ports/clocks/timers, build, operational child/worker, native read, fixture/signature/key/real-data operation, MCP registration or production activation is performed. Existing outputs are not adopted, moved or removed. There is no new tool, public runtime entry, wire field, receipt kind, cancellation attempt, timer or operating approval.

## Baseline Evidence And Root Causes

| Source | Behavior at `88edb86` | Consequence |
|---|---|---|
| `unsignedWorkerTransportContracts.mjs`: `planCommand`, `reserve` | Planning calls the v2 protocol's `acceptFrame` and retains the exact canonical line/token/deadline | An unstarted CANCEL already consumes its parent ordinal, one shared frame and the single cancellation opportunity |
| `unsignedControllerContracts.mjs`: `RELEASED`, `noteWrite` | A genuine RELEASED changes state to RELEASED; starting a CANCEL requires ACTIVE; FINALIZE cannot skip the earlier unstarted command | RELEASED can be accepted before the pending CANCEL starts, but neither that CANCEL nor FINALIZE can start afterward; a later refusal stops safely |
| `unsignedWorkerTransportContracts.mjs`: `receive`, `inspect` | The normal clock/stop checkpoint precedes decoding/admission | Already-stopped frames, and a complete frame arriving at a newly detected deadline, do not reach late recording |
| v2 protocol: `observeLateFrame` | A clock-free raw string hash/size append, at most four entries within 32 shared frames; no canonical/schema/binding/direction/ordinal validation and no worker ordinal advancement | Directly connecting it would call arbitrary bounded diagnostics valid late protocol traffic |
| B2 assembly: `late_frame`, `applyModelEvent` | The event is allowed after stop, but still needs a fresh valid parent point and invokes the raw appender | No safe path from a clock-faulted session to that timed API; stale or invented points are forbidden |

At baseline, the controller test named `original commands cannot skip an unstarted ordinal or start in a later lifecycle state` pinned the CANCEL/RELEASED limitation. P1 replaces it with the narrow drain case and explicit FINALIZE/cleanup/refusal coverage, not a generic state relaxation. Existing late tests still deliberately hash arbitrary diagnostic strings: P2 is not implemented. Native protocol 6, the v1 decoder/worker entry and currently sealed runtime are unchanged.

## Approved Design Decisions

1. Preserve the existing committed CANCEL reservation. Permit only that ordinary, pre-release, still-unstarted CANCEL to drain once at its original ordinal after a normally accepted RELEASED. Its worker-side meaning after genuine original release is a no-op, not another native cancellation.
2. Treat post-stop arrivals as bounded, explicitly **non-authoritative diagnostics**. Check framing, canonical envelope, payload shape, binding, direction, ordinal and bounded diagnostic ordering; never promote them to an accepted release, result or evidence. Syntax consistency is not proof of lifecycle correctness or authenticated resource disposition.
3. Keep the original stop, query/settlement deadlines, command/decoder identities and counters. A late frame cannot reopen ordinary work, renew grace, initiate cleanup or change the outcome to PASS.
4. Give only the stopped original case a narrow clock-free late-diagnostic operation. Do not make B2's general timed API accept null/stale points. Runtime use remains separately sealed and requires B4-B onward.

These are transport-control design changes, not changes to market signal or notification conditions. The separately approved P1 implements the post-release CANCEL admission exception only in pure parent models. Its actual worker no-op consumer is still a B4-C/D requirement, not an existing worker behavior or an effect authorized by B4-B. Implementation of P2/P3 remains a separate approval boundary.

## Reserved Cancel Overtaken By Release

### Preserve The Wire Reservation

In the usual sequence, LAUNCH/PREPARE/GO have parent ordinals 1/2/3. Planning CANCEL commits ordinal 4 even before its stream write. After genuine RELEASED arrives, silently dropping CANCEL and sending FINALIZE at ordinal 5 leaves a hole at the worker. Replacing the committed ordinal-4 bytes with FINALIZE, decrementing counters, clearing `cancel_spent`, renumbering, marking an unsent frame completed, or pretending CANCEL was submitted is forbidden.

The recommended exception drains the **same** CANCEL line, hash, local token, ordinal, generation, command slot and original deadline. It adds no frame or retry. A new CANCEL cannot be planned in RELEASED; an already retired/started/uncertain/shutdown CANCEL cannot use this exception. No earlier normal command's state rule is relaxed.

### Parent Admission And Ordering

All conditions must hold together at actual write-start, after the original asynchronous checks:

- No stop or clock fault; original child/stream/session/generation are still qualified and live; no original close/exit has begun.
- The sole pending command is the ordinary CANCEL admitted in ACTIVE before this release, with `started:false` and decision `planned`. No shutdown dispatcher or copied token is substituted.
- A genuine RELEASED has already passed the **normal** existing v2 validation, including original baseline, trace/observation binding, query/native settled facts, release/retirement flags, close errors and resource checks. A captured late RELEASED never qualifies.
- The exact committed CANCEL is still the first unstarted parent ordinal. Its original write reservation is unexpired with at least the existing 1 ms usable remainder; the current original settlement/entry window also permits the operation. The effective bound is the earlier of those bounds, never a new 10000-ms allowance.

Write-start is recorded immediately before the original write as usual. Backpressure, callback completion and uncertain delivery retain their existing meanings. Wait for the same write's known completion before allowing B5 cleanup work or FINALIZE; a release must not fabricate its callback. A throw, timeout or unknown write result still stops with close-only shutdown, no resend and no cleanup permission from this exception.

Release starts settlement once from its normal qualified receive point, as today. Draining CANCEL neither restarts query time nor grants more settlement/teardown time. B5's release checks, independent ownership proofs, receipt readbacks and teardown gates are still required; the no-op itself proves none of them. An unrelated first stop or a known C1 violation is not cleared by release or draining.

### Worker Semantics And The Trust Limit

The new sealed B4-C/D worker must, after its own genuine original release is verified and the original RELEASED write has started, accept the one next, correctly bound ordinary CANCEL command as a no-op while awaiting FINALIZE. It consumes the original parent ordinal and the existing once-only CANCEL allowance. It does not invoke the query's cancellation method, recreate a query/owner, repeat any native release, emit an acknowledgement/new RELEASED/trace/projection, or change the case verdict. FINALIZE still requires its own subsequent ordinal and original parent teardown.

The wire has no planning timestamp or special no-op field. The worker therefore cannot authenticate that the parent planned CANCEL before release: that restriction is enforced by the privately owned parent ledger. The worker enforces only its original-channel/binding/ordinal/once/released gates and no-op behavior. Do not claim cross-process proof of the planning instant. If that trust boundary is insufficient, stop and propose a separately versioned protocol; do not silently add a field or an acknowledgement here.

| Event order | Required outcome |
|---|---|
| CANCEL starts before RELEASED, callback later | Existing started write settles once; release is not its callback |
| RELEASED accepted before CANCEL starts, all narrow gates hold | Drain exactly the original CANCEL as the released-worker no-op, await its callback, then retain existing B5/FINALIZE gates |
| RELEASED accepted but original reservation is expired/sub-ms, or qualification is lost | Original deadline/stop wins; retain unsent command fact and close only |
| Stop occurs before RELEASED admission | RELEASED is diagnostic-only; it never opens the ordinary drain or cleanup path |
| A newly planned CANCEL after RELEASED, duplicate CANCEL or unknown prior delivery | Refuse; no allocation, ordinal rollback or alternate pipe |
| Invalid/foreign/duplicate RELEASED | Existing normal refusal/stop, never drain based on it |

### Alternatives Not Selected

- **Keep intentional stop:** safest unchanged fallback if this exception is not approved. Name the race in diagnostics; do not report clean completion. It sacrifices liveness, not safety.
- **Withdraw and reuse/skip the ordinal:** not compatible with the committed-frame identity and single allocator. A future plan-versus-wire ledger redesign would be a larger separately approved change, not a small workaround.
- **New no-op/ack message:** changes the wire/schema/ceilings and is unnecessary for the proposed original CANCEL drain. Not included.

## Stopped Receive Lane

### One Original Receiver And One Accounting Owner

The future B4-B receiver retains the original session, status stream and decoder. Complete frames are processed synchronously in original stream order, without concurrent per-frame awaits or an unbounded queue. Dispatch normal versus late traffic at that boundary; do not expose an alternate runtime socket/backend/caller-supplied frame producer.

- Already stopped at receive: route a clean complete frame directly to the late-diagnostic operation, without a normal clock/window checkpoint.
- Not stopped, but the actual parent point is unavailable/invalid or the original deadline is detected **before normal frame admission**: latch the real first stop/deadline, then offer that same complete frame to the late lane once, with no timestamp. No stale point is copied into B2.
- Normal semantic/protocol rejection: preserve that rejection and freeze the remaining late intake, not just that offending frame. Do not retry the same bytes through a looser late route. A successfully admitted frame is never appended again as late.
- Decoder/UTF-8/size/partial-EOF failure: freeze capture; never reset/resynchronize the decoder, rescan an incomplete batch for favorable frames, or reconstruct a frame it did not return.

There is one authoritative protocol/coordinator frame ledger. The transport does not independently append the same frame and then ask B2 to append it again. Standalone pure models may use their own isolated protocol instance for tests; runtime composition must use the original coordinator-owned instance. Model snapshots may be compared, not added as a second allowance.

### Diagnostic Validation, Not Release Validation

Factor the existing v2 envelope and per-kind payload schemas into shared pure validation so normal and late paths do not acquire divergent schema copies. The late operation must itself enforce these checks; leaving the raw v2 appender as a public bypass behind only a transport check is insufficient. Existing generic v1 raw diagnostics are not redefined.

Required before appending a summary:

1. A complete original decoder-returned frame: fatal UTF-8, well-formed string, exact canonical JSON plus LF, at most 65536 encoded bytes including LF, safe bounded DTO. Use the existing pre-serialization/preflight protections; no oversized canonical allocation.
2. Exact original stopped case/session token and committed binding; direction `worker`; an existing worker-message kind only. No parent CANCEL/FINALIZE, new PREPARE binding or fallback to a previous binding. Binding uncertainty refuses capture rather than guessing what the worker received.
3. The next worker wire ordinal in the **same** original directional ledger. Duplicate/gap/reordered ordinals freeze capture; no second ordinal allocator. Append advances only this wire observation ordinal and the shared frame count, not a lifecycle state.
4. The existing strict payload shape and numerical bounds for READY/BASELINED/TRACE_CHUNK/OBSERVED/RELEASED/FAILED. Prove an appropriate original parent command was started: LAUNCH for READY/FAILED, PREPARE for BASELINED, submitted GO for trace/observation/release. No inferred query from a zero resource count.
5. A fixed diagnostic seen-mask initialized only from successfully admitted normal singleton facts rejects repeated READY/BASELINED/OBSERVED/RELEASED/FAILED. Do not derive accepted facts from non-null fields left by a failed normal reducer. Use bounded diagnostic trace chunk/event/order/domain checks against normal accepted facts plus captured late facts; do not retain new raw trace/projection payloads. A terminal late RELEASED/FAILED ends further capture. A normally accepted RELEASED permits only the existing correctly shaped finalize-phase FAILED diagnostic, not another result sequence.

The diagnostic ordering metadata is not another executable lifecycle reducer. It cannot set the normal `release`, `failure`, `baseline`, `observation`, worker clock-domain or trace-evidence fields. A bounded diagnostic-only domain/last trace point/count may be retained to check syntax/order without changing the original accepted fields. Cross-frame result hashes requiring unretained late payloads remain **unverified**; do not invent them, weaken the normal validator or call the packet a genuine release. No native/lifecycle correctness or OS clock authentication is established by these checks.

Each recorded late row retains only its exact received-byte SHA-256 and encoded size. The enclosing diagnostic identifies the original case and explicitly labels these rows `diagnostic_only`, with unavailable receive timestamp. Proposed bounded metadata consists of the seen-mask, diagnostic-only domain/trace counters/last point and capture-disposition code. No raw line, signature, key, account data, new full transcript or per-frame event log is retained. Actual final field names/encoding and maximum size must be fixed and tested in the pure slice, not estimated into permission here.

### Caps, Capture Failure And Shutdown

The existing maximum is **four late summaries** and **32 total frames across both directions**, including the already committed but unsent CANCEL. No decrement or replacement of a prior summary. Before accepting a candidate, reserve the row and shared frame capacity. A fifth late candidate, exhausted shared budget, invalid shape/binding/ordinal, or partial/overflow data freezes late capture with one bounded reason; preserve the first primary stop and all original work/close facts.

Do not hash/copy an unbounded stream after overflow or label a captured prefix hash as the whole-stream hash. Stop decode/capture without destroying/replacing the original streams or dropping their close/error/EOF disposition listeners. Do not add signals, repeated closes, new timers, cancellation attempts or a fresh settlement grace. Original pending work retains the reviewed lifetime anchor rules.

Valid late diagnostics never create or upgrade cancellation permission. If the original stopped shutdown lane was already eligible, its unchanged known-delivery/binding/window/once checks still control it; a late RELEASED is not promoted to normal release. Invalid late traffic makes further writes ineligible (close-only), but keeps terminal close/exit/write outcomes recordable. Any resulting CANCEL seen by an already-released worker is only the no-op described above. No late frame authorizes FINALIZE, cleanup, another case or PASS.

### Clock Faults And Frozen Evidence

Propose a narrow pure B2 operation accepting only the original active, already-stopped case token plus the bounded late line, with **no `at` field**. It invokes the same coordinator-owned validator/append ledger once. It may run when the parent clock is invalid, or after case evidence has frozen, solely to retain bounded live diagnostics. A healthy case, a foreign/retired case token or an ended intake refuses it. All general B2 events and all new writes retain their current timed gates.

Here, retired means that the case is no longer the original retained active case. Writing/finalizing its index alone does not retire a case whose original resources remain retained. Conversely, the last diagnostics cannot resurrect a case cleared after genuine normal completion or be attributed to the next case.

Do not call `applyModelEvent(...late_frame...)` with the last valid point or an invented current point. Timed and untimed entry paths must delegate to one append operation and must not double-count. Earlier FAIL/STOPPED, first stop time, deadlines, accepted release/trace fields, evidence/readback counts and final verdict stay unchanged. There is no clock recovery.

No new receipt/log or success evidence is introduced. Frozen/saved reports and index bytes are immutable: later live diagnostics are not backfilled or used to revise a delivered/saved result. If existing bounded stop evidence can include diagnostics before its ordinary freeze, it must preserve their diagnostic-only/unverified meaning and use existing record limits. Otherwise they remain unavailable in that frozen artifact; do not claim they were saved or send a new notification merely to expose them.

## Capacity And Invariants

Do not increase the existing 65536-byte frame, 32-frame shared count, four late rows, five parent-command records/one pending command, 37 lifetime-work records, 16384-byte diagnostic or 65536-byte coordinator metadata ceilings. Keep 2375680 retained/4259840 transient encoded-buffer reservations unless a separately reviewed derivation proves the existing reservations cover every new view; never silently add another input batch, decoder or trace copy. The 8516-byte current transport/lifetime diagnostic does not yet include the proposed late metadata and is not the future capacity claim.

The implementation must derive maximal sizes for all late metadata, maximal rows, stop/freeze reasons and combined B2/transport/lifetime snapshots. Check exact limits/one-over cases, normal-versus-late shared frame accounting, rejected/partially decoded data, callbacks and frozen-evidence views. If a reservation cannot fit, block rather than raising a limit or omitting a required fact. No additional native/observer/helper work allowance or timer/cleanup authority comes from this design.

## Memory Acceptance Matrix

| Group | Required invented-data cases |
|---|---|
| Reserved CANCEL | Release before start; start before release/callback; release at/after original deadline; sub-ms remainder; foreign/repeated release; new CANCEL after release; stop/clock fault/uncertain write before start; exact original ordinal/token/hash; no duplicate frame or reset of cancellation |
| Released worker | Single next CANCEL is a no-op only after original release and RELEASED write-start; no cancellation/native/owner/query call, ack, repeated release or trace; duplicate ordinal/CANCEL and parent-channel/binding mismatch refuse; FINALIZE stays separately gated |
| Healthy completion | Known drain callback precedes B5 cleanup/FINALIZE; no fabricated callback, no changed query/settlement origin; no-op cannot erase C1/failure or authorize teardown |
| Late dispatch | Already stopped; deadline/clock stop before admission with same frame captured once; normal semantic refusal never retried as late; same batch healthy-to-stopped transition; exact stream order, no awaits, no decoder reset |
| Late validation | All worker kinds with exact schemas; wrong direction/binding/ordinal, duplicate singleton, absent original started command, trace count/domain/order errors; result-content verification unavailable explicitly labeled; no normal field promotion |
| Bounded failure | Fourth/fifth late frame, total frame 32/33 with reserved CANCEL counted, exact 65536/+1 bytes, split UTF-8/LF, lone surrogate, partial EOF, decoder batch failure, no raw/prefix replay or new buffers |
| Terminal authority | Late RELEASED/FAILED never changes shutdown eligibility upward, release/cleanup/result/PASS; malformed late traffic closes writes but preserves original close/exit/callback facts; lifetime references remain required |
| Time and evidence | Null/unavailable time uses only the narrow stopped-case path; foreign/retired token and healthy use refuse; no stale point, recovery, grace or receipt; frozen report/index bytes and prior delivery state unchanged |
| Boundaries | All effect tripwires precede imports; pure schema reuse/once-only accounting/source guards; no runtime issuer/native/v1/tool/automation/package changes; exact capacity and behavioral/source mutations |

This matrix specifies requirements across P1/P2/P3, not a claim that all have run. P1 results are recorded below; its old regression forbidding any CANCEL start in RELEASED is replaced only by the narrow exception plus explicit refusal coverage. Existing raw-v2-late tests remain unchanged until P2. No operational test or old fixture is reused.

## Proposed Implementation Boundaries

| Slice | Scope after separate approval | Still excluded |
|---|---|---|
| **B4-P1 (implemented in memory)** | Pure normal v2 CANCEL-drain exception, reservation/deadline model, B2 mirrors/capacity and memory/source tests. Worker no-op specified as invented outcomes and source contract; no worker connection yet | Real clocks/timers/ports, runtime/worker/native/signing/fixture effects; generic protocol relaxation |
| **B4-P2** | Shared pure v2 late syntax/ordering validation, same-ledger bounded summaries, narrow clock-free stopped-case B2 operation, transport dispatch model and exact capacities; memory/source tests | Raw unchecked-v2 bypass, new log/receipt, saved evidence edits, runtime producer or timestamp recovery |
| **B4-P3** | Memory composition of both races, frozen evidence and stop/deadline interleavings; independent review before B4-B | Operational execution, full acceptance and B5 authority |

Then separately approve B4-B's unexecuted original-parent connection scope. B4-C/D must implement and review the released-worker no-op before any runtime composition can use the drain exception. Until both sides agree, the runtime remains sealed; old and new peers are never mixed. B4-E, B5/B6, host/signature qualification, total operating duration and separately approved user-terminal operational units remain required afterward.

The initial design request changed documentation only. P1's later separately approved pure implementation is recorded below. Neither this design nor a pure-model test is permission to execute effects, record/delete data, enable production, resume Dot or change judgment/notification conditions.

## B4-P1 Memory Implementation

2026-10-31 JST, after the user approved this design and specifically P1 implementation/memory tests. The existing four uncommitted design/backlog files from the design turn are retained and updated, not mistaken for unrelated changes. No independent review, commit or push is performed by this implementation request.

- **Protocol admission:** `noteWrite` derives the exception from the original ordinary CANCEL write, state RELEASED, the existing validated release, and all earlier command outcomes completed. Existing stopped/close/exit, first-unstarted-ordinal and planned-outcome gates remain mandatory. Fresh CANCEL planning in RELEASED is still refused. No argument can request an arbitrary state exception or substitute a line/token/backend.
- **Cleanup/finalization:** the protocol refuses `finishTeardown` and FINALIZE while an original CANCEL outcome is not completed. The transport refuses teardown start/confirmation while its original CANCEL is pending. B2 derives the same condition from its protocol snapshot, blocks new observer/helper attachment and cleanup/delete/absence receipts before completion, and preserves close/terminal fact handling. It creates no second deadline or callback ledger.
- **Original timing/accounting:** transport start/callback checks use the same reservation, with the same 1 ms usable-remainder rule and original deadline. A valid release starts settlement once; it does not extend the reservation or count as write completion. Started-before-release and started-after-release CANCELs each settle only their own callback. Timeout/uncertain delivery stops and remains close-only. Parent frame/ordinal/cancellation counters, command hash/generation/token, query/settlement origin, first stop and C1 state are never reset.
- **Worker requirement, not execution:** the pure parent model preserves the accepted release/baseline/trace/result fields while recording only the original write's state change. A source comment and boundary test pin that the actual worker entry is still sealed. The released worker's one-CANCEL no-op, its actual RELEASED write-start and absence of native calls/acks must still be implemented and reviewed in B4-C/D before runtime use. A parent-model result is not observation of a real or simulated effectful worker.
- **Model boundary:** B2 remains a supplied-fact phase/readback model, not an authenticated stream writer or per-write timer. The transport owns the original per-command deadline contract. These models do not issue a runtime capability; original composition, live pipe/child/source qualification and actual callback provenance remain future B4-B/P3 work. No P2 late-frame/timestamp bypass is included.

Pure-helper imports/exports and diagnostic fields, wire fields/kinds, receipts, commands, persistent records, reservations and timers are unchanged. The controller test additionally imports the existing pure `flags` helper for authority assertions. Maximal capacity is recalculated through the unchanged existing functions and pinned by tests: combined transport/lifetime diagnostic **8516**, B2 diagnostic/coordinator **16049/46216**, retained/transient encoded buffers **2375680/4259840** bytes. All limits, including 16384/65536 metadata ceilings, five commands, 32 shared frames and 37 lifetime work records, stay unchanged. These are encoded-data reservations, not V8 heap/native lifetime proofs.

Tests were added in small failing/passing steps. The first normal post-release drain failed before the protocol exception. Two transport cleanup-start cases and four B2 cleanup/resource-start cases failed before their gates. Revised controller coverage no longer calls teardown confirmed before CANCEL completion; it explicitly refuses that shortcut and FINALIZE skipping. Additional tests cover exact original frame/hash/ordinal/deadline, last full millisecond and sub-ms/expired boundaries, release arriving after the original deadline, malformed/foreign/duplicate release, missing/foreign/rolled-back time, unrelated stop, uncertain/late callback, backpressure, no replacement/restart/fresh CANCEL, earlier incomplete GO, C1 retention and complete B2 receipt/cleanup/finalization flow with BLOCKED/FAIL outcomes only.

Seven individually run main-thread memory/source suites pass **529 tests**, zero failures/cancellations/skips: transport/lifetime **154**, boundary **8**, controller **159**, boundary **11**, assembly **98**, boundary **8**, qualification clock connection **91**. Denying effect guards remain installed before imports; the transport suite's final swallowed-effect check is clean. New source guards refuse eight protocol, three B2 and one transport mutation, in addition to existing boundary tests. No build/pretest/npm, signing, whole-repository/operational or native test is run. Actual clocks/timers/ports and worker behavior remain untested and unauthorized.

Runtime/native/common-build/package/config hashes and the 436 existing artifact hashes/sizes/modes match implementation start; Dot remains PAUSED with its full configuration hash unchanged. Only three pure helper modules, six test files and the four design/backlog documents are changed. Market/judgment/notification/mail/retention conditions remain unchanged. At the end of that implementation turn, P2/P3, independent review and any later commit were separate next steps.

## B4-P1 Independent Review

2026-10-31 JST, separate approval to independently review and locally commit the 13 uncommitted P1/design files on `88edb86`. Two read-only reviewers reported no actionable findings within their separate scopes; no implementation changes were required by review.

- **State/ordering scope:** reviewed the ordinary original CANCEL exception, original token/write reservation, stop/uncertain outcome handling, callback-before-cleanup/FINALIZE gates, B2 resource/receipt mirrors and C1 retention. The reviewer individually ran transport **154**, controller **159** and assembly **98** tests: **411 passed**, zero failures/cancellations/skips.
- **Capacity/boundary/test/document scope:** reviewed all 13 files and individually ran the complete seven-file **529-test** selection above, all passing. Existing **8516/16049/46216** diagnostic/coordinator and **2375680/4259840** encoded-buffer reservations and all frame/record/operation ceilings remain unchanged. The new source mutations enforce source shape; they are not behavioral execution of mutated implementations.

The implementing session also freshly ran all seven main-thread memory/source files with **529 passed**, zero failures/cancellations/skips. Changed module/test syntax, whitespace, document links and a read-only reproduction of the repository's bare-command portability scan pass. No whole-repository, default-isolated, build, signing, native or operational suite was run. Reviewers did not independently reproduce the earlier failing-before-fix history or the protected-artifact/config hash comparison; those are implementing-session evidence, not independent findings.

The implementing session's protected runtime/native/common-build/package/config content hashes (2568 files), 436 pre-existing artifact hashes/sizes/modes and Dot PAUSED/full-configuration hash match review start. The requested local commit includes only three pure helpers, six test files and four design/backlog documents, including the previously uncommitted design. It does not run hooks/builds or create a Git signature. Push, operational qualification and all prohibited effects remain unperformed.

Residual limits: this proves supplied-data parent contracts and their guarded test boundary, not actual worker no-op behavior, original callback provenance, live stream/child qualification, V8/native memory bounds or native acceptance. P2/P3 and real B4-B/C/D consumers remain unimplemented; the current stopped receive limitation is not silently corrected. No runtime authority, Dot restart, market/judgment/notification/mail/retention change or evidence-save claim is introduced by this review.

## B4-P1 Follow-Up

2026-10-31 JST, review of the committed `8be3a6d` against the code. Its verification passed and no P1/P2 finding remained, so no further independent review was run. One P3 is corrected.

The v2 protocol's diagnostic `retain` summary was false in every unstopped RELEASED state. That included the drain window, while an original CANCEL was still planned or awaiting its callback and cleanup and FINALIZE were refused. No current gate reads `retain`. Still, a later consumer treating it as releasable would have bypassed the wait. `retain` now also stays true while any original CANCEL outcome is not completed. It becomes false only after the known completion, and an uncertain outcome stops with retention. `retain` remains a diagnostic summary, not cleanup permission. B5 must still use the existing release, CANCEL, teardown and readback gates.

Verification:
- **Regressions:** three failed before correction: the revised admission test, which now expects only the CANCEL write and `retain` to change, plus completed and uncertain retention cases.
- **Source pin:** a pin and its mutation fix the condition.
- **Behavioral mutations:** run against memory suites only, these killed eight of the eleven P1 gate reverts. The other three are equivalent:
  - a shutdown CANCEL exists only after a stop;
  - RELEASED always has a release value;
  - cleanup receipts after `cleanup_precheck` cannot see a pending CANCEL again.
- **Unchanged:** capacity, exports, wire fields and limits.
