# B4 Pre-Connection Cancel And Late-Frame Design

Status: **design approved; B4-P1/P2/P3 independently reviewed/tested in pure memory models only**, 2026-10-31 JST, design baseline `88edb86`, P2 implementation baseline `a94a27d`, P3 verification/review baseline `c9524b4`. This refines the [worker/transport design](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md), [controller contract](NATIVE_BAR_ADMISSION_UNSIGNED_CONTROLLER_DESIGN.md) and [execution design](NATIVE_BAR_ADMISSION_UNSIGNED_EXECUTION_DESIGN.md). The [P1 record](#b4-p1-memory-implementation) covers its separate implementation approval and the [independent review](#b4-p1-independent-review) covers its local commit gate; a [follow-up](#b4-p1-follow-up) keeps the retention summary true until the drained CANCEL completes. The [P2 record](#b4-p2-memory-implementation) covers the separately approved late diagnostic model, with its [review corrections](#b4-p2-review-corrections) and [independent review](#b4-p2-independent-review). The [P3 verification record](#b4-p3-memory-verification) and [independent review](#b4-p3-independent-review) cover memory-only schedule replay, not runtime composition. All real worker/transport connections remain pending; approval of this design is not operational approval.

Dot stays PAUSED. Market/scenario/judgment/notification/mail, retention, confirmation counts, thresholds and bands are unchanged. No real ports/clocks/timers, build, operational child/worker, native read, fixture/signature/key/real-data operation, MCP registration or production activation is performed. Existing outputs are not adopted, moved or removed. There is no new tool, public runtime entry, wire field, receipt kind, cancellation attempt, timer or operating approval.

Later 2026-10-31 JST update: the separately approved [B4-B1 pure contracts/capacity implementation](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md#b4-b1-pure-contract-implementation) starts from reviewed design commit `8c9bba1`. It adds the narrow B2 stop-only clock-fault model entry and tests deadline-first checkpoint/callback projections against the unchanged transport model, with all P1/P2/P3 regressions retained. Nine individually run main-thread memory/source files pass 795 tests. The fixed terminal metadata ceiling is 7654 bytes and the combined coordinator reservation is 54741, within unchanged limits; no additional normal protocol/window ledger or actual receiver/worker connection is created. Independent implementation review is pending, and B4-B2 onward remain separate approvals. Earlier P1/P2/P3 results below retain their historical scope.

Later B4-B1 [independent review/corrections](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md#b4-b1-independent-review-and-corrections) fix retained pending uncertainty, expired callback disposition, absent-pipe end claims and two static-boundary guard gaps. Both scoped re-reviews have no new findings; nine main-thread files pass 803 tests, with unchanged schemas/capacity/limits/runtime seals and no real connection or operational action. Initial B4-B1 test counts above remain historical.

## Baseline Evidence And Root Causes

| Source | Behavior at `88edb86` | Consequence |
|---|---|---|
| `unsignedWorkerTransportContracts.mjs`: `planCommand`, `reserve` | Planning calls the v2 protocol's `acceptFrame` and retains the exact canonical line/token/deadline | An unstarted CANCEL already consumes its parent ordinal, one shared frame and the single cancellation opportunity |
| `unsignedControllerContracts.mjs`: `RELEASED`, `noteWrite` | A genuine RELEASED changes state to RELEASED; starting a CANCEL requires ACTIVE; FINALIZE cannot skip the earlier unstarted command | RELEASED can be accepted before the pending CANCEL starts, but neither that CANCEL nor FINALIZE can start afterward; a later refusal stops safely |
| `unsignedWorkerTransportContracts.mjs`: `receive`, `inspect` | The normal clock/stop checkpoint precedes decoding/admission | Already-stopped frames, and a complete frame arriving at a newly detected deadline, do not reach late recording |
| v2 protocol: `observeLateFrame` | A clock-free raw string hash/size append, at most four entries within 32 shared frames; no canonical/schema/binding/direction/ordinal validation and no worker ordinal advancement | Directly connecting it would call arbitrary bounded diagnostics valid late protocol traffic |
| B2 assembly: `late_frame`, `applyModelEvent` | The event is allowed after stop, but still needs a fresh valid parent point and invokes the raw appender | No safe path from a clock-faulted session to that timed API; stale or invented points are forbidden |

At baseline, the controller test named `original commands cannot skip an unstarted ordinal or start in a later lifecycle state` pinned the CANCEL/RELEASED limitation. P1 replaces it with the narrow drain case and explicit FINALIZE/cleanup/refusal coverage, not a generic state relaxation. The old arbitrary-string late tests are replaced by checked v2 frames in P2. Native protocol 6, the v1 decoder/worker entry and currently sealed runtime are unchanged.

## Approved Design Decisions

1. Preserve the existing committed CANCEL reservation. Permit only that ordinary, pre-release, still-unstarted CANCEL to drain once at its original ordinal after a normally accepted RELEASED. Its worker-side meaning after genuine original release is a no-op, not another native cancellation.
2. Treat post-stop arrivals as bounded, explicitly **non-authoritative diagnostics**. Check framing, canonical envelope, payload shape, binding, direction, ordinal and bounded diagnostic ordering; never promote them to an accepted release, result or evidence. Syntax consistency is not proof of lifecycle correctness or authenticated resource disposition.
3. Keep the original stop, query/settlement deadlines, command/decoder identities and counters. A late frame cannot reopen ordinary work, renew grace, initiate cleanup or change the outcome to PASS.
4. Give only the stopped original case a narrow clock-free late-diagnostic operation. Do not make B2's general timed API accept null/stale points. Runtime use remains separately sealed and requires B4-B onward.

These are transport-control design changes, not changes to market signal or notification conditions. The separately approved P1 implements the post-release CANCEL admission exception only in pure parent models. Its actual worker no-op consumer is still a B4-C/D requirement, not an existing worker behavior or an effect authorized by B4-B. P2's later approval covers only pure models and memory tests; P3 remains a separate approval boundary.

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

Do not increase the existing 65536-byte frame, 32-frame shared count, four late rows, five parent-command records/one pending command, 37 lifetime-work records, 16384-byte diagnostic or 65536-byte coordinator metadata ceilings. Keep 2375680 retained/4259840 transient encoded-buffer reservations unless a separately reviewed derivation proves the existing reservations cover every new view; never silently add another input batch, decoder or trace copy. The historical 8516-byte transport/lifetime diagnostic did not include late metadata; P2's recalculation is recorded below.

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

This matrix specifies requirements across P1/P2/P3, not a claim that all have run. P1/P2 results are recorded below; the old regression forbidding any CANCEL start in RELEASED is replaced only by the narrow exception plus explicit refusal coverage. No operational test or old fixture is reused.

## Proposed Implementation Boundaries

| Slice | Scope after separate approval | Still excluded |
|---|---|---|
| **B4-P1 (implemented in memory)** | Pure normal v2 CANCEL-drain exception, reservation/deadline model, B2 mirrors/capacity and memory/source tests. Worker no-op specified as invented outcomes and source contract; no worker connection yet | Real clocks/timers/ports, runtime/worker/native/signing/fixture effects; generic protocol relaxation |
| **B4-P2 (implemented in memory)** | Shared pure v2 late syntax/ordering validation, same-ledger bounded summaries, narrow clock-free stopped-case B2 operation, transport dispatch model and exact capacities; memory/source tests | Raw unchecked-v2 bypass, new log/receipt, saved evidence edits, runtime producer or timestamp recovery |
| **B4-P3 (memory verification independently reviewed)** | Memory composition of both races, frozen evidence and stop/deadline interleavings; reviewed before any separately approved B4-B work | Operational execution, full acceptance and B5 authority |

Then separately approve B4-B's unexecuted original-parent connection scope; the later [detailed parent proposal](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md) on `87846e9` separates its pure-contract first step from private identity/timer/launch/write/composition sub-slices. It uses one B2-owned ledger rather than connecting P3's two reference models, and proposes a stop-only clock-fault entry without relaxing general timed events. This is design only, not implementation approval. B4-C/D must implement and review the released-worker no-op before any runtime composition can use the drain exception. Until both sides agree, the runtime remains sealed; old and new peers are never mixed. B4-E, B5/B6, host/signature qualification, total operating duration and separately approved user-terminal operational units remain required afterward.

The initial design request changed documentation only. P1's later separately approved pure implementation is recorded below. Neither this design nor a pure-model test is permission to execute effects, record/delete data, enable production, resume Dot or change judgment/notification conditions.

## B4-P3 Memory Verification

2026-10-31 JST, after separate approval for memory-only composition tests on `c9524b4`. Changes are confined to the existing guarded transport test file and four design/backlog documents. No helper/model/runtime/native/product module, import/export, schema, command, receipt, capacity, package, automation or operational entry is changed. P2's independent review is not reused as P3 review; independent review, commit and push are not performed by this request.

The test-local, non-exported `p3Replay` replays one invented schedule independently through a transport-owned protocol model and a B2-owned protocol/evidence model. It compares the binding, shared wire counts/ordinals, normal trace/baseline/state, late rows and capture metadata after operations. These are separate model predictions, not two runtime ledgers connected or their allowances summed. The existing pure decoder supplies complete lines in selected scenarios; direct DTO cases test model admission, not the provenance of a real receiver. A separate lifetime model receives only explicitly supplied invented work/close facts. No real port or worker is simulated as having been observed.

| Added group | Cases | Verified composition |
|---|---:|---|
| Healthy reserved CANCEL | 1 | Normal RELEASED, the original drain/callback, same frame/hash/ordinal/reservation and settlement origin in both models |
| Stop cuts | 4 | Before release, after release, after write-start and after callback; late RELEASED/FAILED never substitutes for a normal release/callback or opens cleanup |
| Intake and shutdown ordering | 6 | Capacity, malformed and duplicate traffic, before/after shutdown planning; capacity only freezes while judged invalid traffic refuses; the one original CANCEL and deadline remain unchanged |
| Evidence freeze/readback | 6 | Before report creation, pending/confirmed report readback, pending index readback, retained case and closed index; original report/index bytes/hashes, FAIL row, 23 NOT_RUN rows, evidence counters and retained worker/fixture slots are unchanged by late input |
| Lifetime disposition | 6 | Late release, malformed input and exhausted capture with each close-event order; pending original query/release/status-write facts keep the lifetime pair retained until all explicit dispositions settle, then one close awaits both original end events |
| Receive clock failure | 3 | Unavailable, foreign-domain and rolled-back points before admission with a reserved CANCEL; transport captures once, B2 only uses its original untimed stopped-case entry, unknown first-stop time stays null and clock fault is not recovered |
| Original write deadline | 4 | Release at original CANCEL end minus 2 ms/minus 0.5 ms, exactly the end and one ns later; only a full remaining ms permits start and no reservation is renewed |
| Decoder failure/end | 4 | Partial EOF, an unreturned favorable prefix in a failed UTF-8 batch, EOF after late RELEASED and EOF after late FAILED; only open-intake faults refuse, terminal intake remains ended, and no decoder resynchronization or prefix replay occurs |
| Original callback after stop | 3 | Completed, uncertain and expired callback delivery after late release; original delivery disposition is not repaired, settlement is unchanged and no further cancellation is allocated |
| Original grace/total end | 2 | Late trace/release around shutdown planning after settlement/cohort expiry; diagnostics do not renew a deadline or authorize writes |
| Existing C1 violation | 2 | Late finalize failure before/after the original callback; the confirmed C1 evidence and primary stop remain, with no cleanup or success promotion |

The **41 added cases** all exercise existing public pure-model methods. B2 is a phase/readback model, not the owner of a per-write transport reservation. In deadline/callback cases the replay explicitly relays the original transport's detected stop or delivery disposition into B2 as a supplied fact; it never relays a write-start that transport refused. This does not implement or authenticate such a bridge at runtime. The only initially failing assertion confused an uncertain delivery outcome with an unavailable callback timestamp: the existing contract correctly retains a timely qualified timestamp even for an uncertain outcome. The test expectation was corrected, not the model or delivery rule.

Fresh verification on Node **24.18.0**: seven individually run main-thread memory/source files pass **669 tests**, zero failures/cancellations/skips: controller **209**, boundary **12**, transport/lifetime **217**, boundary **9**, assembly **122**, boundary **9**, qualification clock connection **91**. The existing denial guards precede helper imports and the final swallowed-effect test remains last. No default-isolated/full-unit/build/signature/native/operational suite is run, and the earlier P2 multi-version/platform results are not claimed as P3 results. Protected runtime/native/common-build/package/config content hashes (2568 files), 436 pre-existing artifact hashes/sizes/modes and Dot PAUSED/full-configuration hash match verification start.

Limits: these are selected finite schedule replays, not an exhaustive scheduler exploration, actual released-worker CANCEL no-op, original stream/callback authentication, cross-process clock qualification, V8/native memory measurement or operational acceptance. Saved-looking records exist only as memory strings; no receipt, fixture, signature or evidence output is created/moved/removed. No real ports/clocks/timers, operational child process, native read, signing/key/real-data operation, MCP registration or production activation is performed. Judgment/notification/mail/retention conditions stay unchanged. Independent P3 review was still pending at that implementation step and is recorded below; B4-B needs separate approval and B4-C/D worker semantics and the later B4-E/B5/B6/host/operational gates remain pending.

## B4-P3 Independent Review

2026-10-31 JST, separate approval to independently review and locally commit the five uncommitted P3 files on `c9524b4`. Two read-only reviewers examined distinct scopes in the working tree; neither changed files. Both reported no actionable findings, so no test/model correction was required by review.

- **State, ordering and test expectations:** reviewed the 277-line test addition against the existing public models and P1/P2/P3 design, including callback/deadline/stop/CANCEL ordering, accounting comparisons, explicit relays and evidence/lifetime assertions. Independently ran the permitted main-thread transport/lifetime file: **217 passed**, including all **41 new P3 cases**, zero failures/cancellations/skips.
- **Boundaries and documentation:** statically reviewed the changed test/documents, guard-before-import ordering, the final swallowed-effect check, unchanged capacity/authority/seals and the scope of the 41-case coverage claims. No tests or protected hash/automation checks were performed by this reviewer. No runtime-qualification claim was found.

The implementing session freshly ran the seven-file selection: **669 passed**, zero failures/cancellations/skips on Node **24.18.0**. Syntax, whitespace, added local document links and the read-only bare-command portability scan pass. Protected runtime/native/common-build/package/config content hashes (2568 files), 436 pre-existing artifact hashes/sizes/modes and Dot PAUSED/full-configuration hash match review start; those checks are implementing-session evidence, not independent reviewer measurements.

The requested local commit includes only the existing test file and four design/backlog documents. Git hooks, signing, automatic maintenance/build and push are not run. No model/runtime/native/product code, public authority or judgment/notification/mail/retention condition is changed. Review confirms finite supplied-data replay and explicit lifetime-disposition gating only, not actual runtime composition, original callback/stream provenance or released-worker no-op behavior. B4-B and later implementation/operational approvals remain separate.

## B4-P2 Memory Implementation

2026-10-31 JST, after separate approval to implement P2 and run memory-only synthetic tests, based on `a94a27d`. Its P1 CANCEL-retention correction is preserved. This request does not include independent review, commit or push.

- **Shared validation and accounting:** normal and late v2 worker frames reuse the same strict envelope and per-kind payload validators. The original protocol owns the only late array, shared frame count and worker ordinal. A successful late append advances those wire counters exactly once and retains only `{sha256, bytes}` per row; it never calls the normal reducer. Binding/direction/ordinal, original started commands, singleton seen-mask and bounded trace chunk/event/domain/monotonic ordering are checked before committing. The mask is seeded only from normally accepted messages, including an accepted FAILED committed before stopping, not from fields left by a failed reducer.
- **Non-authoritative view:** `describeLate()` returns `native-bar-late-frame-diagnostic-v1` with the original binding/stop, wire counters, bounded `late_capture` and at most four rows. `late_capture` explicitly has `diagnostic_only:true`, `semantic_verified:false`, `receive_at:null`; its capture state is open/ended/frozen/refused. Diagnostic domain/trace counters remain separate from normal baseline/domain/observation/trace/release/failure fields. A late RELEASED is checked only against the original baseline hash, the normal-plus-late trace counts and authenticated not exceeding dispatched requests. Its close errors, resources and observation/trace hashes are recorded unverified even when their inputs are retained, so a genuine failure report is captured rather than refused. Late RELEASED/FAILED ends capture, never releases resources or changes a result, C1, evidence or authority flag.
- **Fail-closed intake:** malformed/noncanonical/oversized/foreign/duplicate/out-of-order input, a fifth candidate or exhausted shared frame allowance freezes intake. Normal semantic rejection freezes it (`frozen`) without a retry through the late lane, judging no later traffic and leaving the original shutdown lane unchanged (see the [review corrections](#b4-p2-review-corrections)). Decoder failure, partial EOF and stream closure can be supplied through bounded fault operations; no favorable prefix from a failed decoder batch is reconstructed. Closed/exhausted intake refuses before parsing another line. Invalid late traffic also blocks starting an already planned shutdown CANCEL, but preserves started write callbacks and original close/exit facts; it cannot overwrite the first primary stop.
- **Transport dispatch model:** `receive` routes an already-stopped supplied frame without reading/validating a new parent point. If its normal clock/window checkpoint first detects unavailable/invalid time or a deadline before frame admission, the same complete frame is offered to late capture once. A normally admitted frame is not appended again. `refuseReceive` supplies decoder/partial/stream-end facts without a timestamp. This is a supplied-data model, not an actual stream listener or authentication of a decoder-returned frame.
- **Narrow B2 entry:** `observeLateFrame(originalToken, {line})` accepts only the original retained active stopped case with its worker slot live/retained, rejects extra `at` fields, and delegates once to that case's protocol. `describeLateFrames` is a read-only view of the same ledger; `endLateFrames` supplies a bounded terminal intake reason. The existing timed `late_frame` event delegates to the same appender and keeps its timed gates. Healthy/foreign/copied/retired case references cannot manufacture a stop, acquire another ledger or resurrect a clean case. Unknown first-stop time is null after an initial clock fault, not the last valid point relabeled as the stop instant.
- **Frozen evidence:** the stopped original retained case may expose later live diagnostics even after report/index readback. Existing report/index bytes and hashes, FAIL row, readback counters, deadlines and first stop remain unchanged. No new receipt/log is created, no diagnostics are backfilled into saved bytes and no evidence-save or notification claim is made.

Capacity is calculated rather than increasing a ceiling. B2's ordinary summary cannot include the full late detail without exhausting its existing 16384-byte envelope, so it adds only `late_count` and `late_capture` status; the separate detail view is derived from the same ledger, not retained as another transcript. Maximum canonical late metadata plus four rows is **759 bytes**, charged explicitly to coordinator metadata. Combined transport/lifetime metadata is **9274 bytes**; B2 ordinary diagnostic/coordinator reservations are **16161/47087 bytes**; the separate late diagnostic is independently capped at **16384 bytes**. All maxima include bounded reasons/domains/counters; these are canonical encoded-data reservations, not V8 heap/native measurements. The existing **2375680/4259840** retained/transient buffers, frame/row/command/work limits, native budgets, wire shapes, receipt kinds and module import/export inventories are unchanged.

The initial valid-late accounting, stopped transport receive and clock-free B2 regressions failed before their respective implementations. Added tests cover every worker kind, original-start gating, duplicate singleton/ordinal, trace constraints, normal-failure versus pre-admission-failure routing, raw text/canonical/LF/UTF-8/surrogate/size failures, fourth/fifth rows, shared timed/untimed accounting, no parsing after freeze/row exhaustion, ordinary callbacks/close/exit after intake fault, frozen report/index invariance, unchanged healthy/P1 flows and capacity derivation. A decoder-returned two-frame batch is tested both entirely stopped and crossing from normal TRACE_CHUNK to diagnostic-only RELEASED at pre-admission deadline detection. Existing decoder tests exercise 32/33 received-frame and exact 65536/+1-byte limits; the protocol's shared 32-frame guard (including parent reservations) is also source-pinned. No claim is made of a reachable successful 32-frame lifecycle or a real stream producer.

As initially implemented, before the review corrections below, seven individually run main-thread memory/source files passed **595 tests** with zero failures/cancellations/skips: controller **191**, boundary **12**, transport/lifetime **170**, boundary **9**, assembly **113**, boundary **9**, qualification clock connection **91**. New source mutation checks pin schema reuse, original accounting, normal-field non-promotion, close-only gates, dispatch order and the narrow B2 entry. These inspect source shapes, not execution of mutated implementations. Their own replacement targets are scoped to the late appender where the same text occurs in normal admission; missing-dispatch checks require a present nonnegative index before comparing order. Effect tripwires remain installed before helper imports, including final swallowed-effect checks. No whole-repository/default-isolated/build/signing/native/operational suite is run.

Only three pure helper modules, six memory/source test files and four design/backlog documents are changed. The protected runtime/native/common-build/package/config content hashes (2568 files), 436 pre-existing artifact hashes/sizes/modes and Dot PAUSED/full-configuration hash match implementation start. Actual original receiver/decoder ownership, child/callback provenance, runtime composition, worker no-op implementation and P3's broader interleaving review remain unimplemented/unqualified. Judgment/notification/mail/retention conditions are preserved; no real port/clock/timer, operational child process, native read, fixture/signature/key/real-data operation, MCP registration or production activation is performed.

## B4-P2 Review Corrections

2026-10-31 JST, review of the uncommitted P2 files against the code and this design, before commit. The user approved the recommended corrections. All findings were reproduced on a `git archive` copy with the uncommitted diff applied. P2/P3 findings:

- **Normal rejection closed the shutdown lane (P2):** every normal rejection marked late capture `refused`, the state that makes shutdown close-only. That included a rejected worker frame, a parent command whose planning the protocol refused, and a B2 frame-event refusal. For example, after an ACTIVE-state protocol rejection, the decision changed from `CANCEL_THEN_CLOSE` at `a94a27d` to `CLOSE_ONLY`. This design closes writes only for invalid late traffic; a normal rejection only freezes the remaining intake. The B4-A review had also explicitly kept the original CANCEL lane after a normal rejection with a qualified point, and P2 had rewritten that test to expect close-only.
  - Normal rejection now sets the separate state `frozen`. It ends intake but judges no later traffic, so later frames refuse `late_closed` without parsing. A later receive fault leaves it `frozen`, and the original shutdown lane keeps its unchanged known-delivery/window/once gates.
  - Invalid late traffic, a receive/decoder fault on open intake, and traffic after a terminal late frame still set `refused` and make writes ineligible.
  - Both states are terminal. The restored B4-A test again expects `CANCEL_THEN_CLOSE`.
- **Late trace ordering diverged from normal (P3):** the late lane refused a TRACE_CHUNK after an accepted OBSERVED, which the normal reducer accepts. A sequence valid under normal rules therefore refused capture and, through that, closed writes. No documented worker rule orders traces before OBSERVED, so the late check now follows the normal rule.

Verification:
- **Reproducing tests:** eight new or revised regressions failed before correction:
  - the restored B4-A expectation;
  - worker and parent normal rejections;
  - a transport-level rejection made before protocol admission (`receive_direction`);
  - a refused parent command followed by unexamined traffic and a decoder fault;
  - a B2 frame refusal;
  - the failed-reducer state;
  - late trace after OBSERVED.
- **Revert checks:** each of the five changed guards, reverted alone against the memory suites only, fails at least one test.
- **Source pins:** they cover the `frozen`/`refused` split and the normal-rejection mapping.
- **Unchanged:** capacity, schemas, exports and limits (`frozen` is shorter than the reserved `refused`).
- **Test counts:** at that point the six memory/source files and the qualification clock connection file passed **601 tests**: controller **194**, boundary **12**, transport/lifetime **172**, boundary **9**, assembly **114**, boundary **9**, clock connection **91**.

## B4-P2 Independent Review

2026-10-31 JST, independent review of the corrected uncommitted P2 files on `a94a27d`. Two read-only reviewers each worked on their own `git archive` copy with the uncommitted diff applied:
- one covered state, ordering and authority;
- the other covered capacity, boundaries, test quality and documentation.

Every finding below was re-run by the implementing session before correction.

State, ordering and authority (one P2 and four P3 findings were corrected):
- **Capacity exhaustion closed writes (P2):** a fifth late candidate or an exhausted shared frame allowance was refused before parsing but marked `refused`. A query stopped at a deadline that keeps streaming traces therefore lost an eligible shutdown CANCEL lane, which `a94a27d` kept. Capacity exhaustion judges no traffic, so it now sets `frozen` before refusing. Protocol, transport and B2 regressions, with the shutdown CANCEL planned before or after the overflow, failed before this change.
- **Late FAILED phase rule:** the late FAILED phase keyed on a started PREPARE, while the normal reducer keys on an accepted one. Both lanes now use the accepted PREPARE.
- **Timed B2 late event on a healthy case:** it stopped the case but left intake `open`, so the same bytes could be retried untimed. It now freezes intake as a normal rejection, after latching the stop.
- **Receive fault after a terminal frame:** an EOF or decoder fault reported after a terminal frame turned `ended` into `refused`, closing a still-eligible shutdown write. A receive fault now leaves `ended` unchanged; traffic after a terminal frame is still refused.
- **Stale timed point after a clock fault:** after a clock fault, the timed B2 `late_frame` accepted the last valid point. That predates P2, but this design forbids it, so the timed event now refuses (`late_requires_untimed`) and only the clock-free entry captures.
- **RELEASED verification scope (recorded, not changed):** a late RELEASED leaves close errors, resources and observation/trace hashes unverified even where their inputs are retained. The P2 record now states this scope; adding those checks would refuse genuine failure reports.

Capacity, boundaries, tests and docs:
- **Untested late-lane guards (P2):** most late-lane refusal guards survived single mutations:
  - traffic after a normal RELEASED;
  - READY pins;
  - BASELINED without a started PREPARE, and its domain;
  - FAILED with a query but no GO, and finalize without a query;
  - RELEASED baseline, trace count and authenticated count;
  - late-after-late trace order;
  - the ended state after a DONE stop;
  - the B2 parent-domain READY and worker-slot gates;
  - the transport malformed-receive closure;
  - the B2 frame-event freeze.

  Each now has a negative test asserting the specific refusal, `refused` capture with no new row or ordinal, and close-only shutdown where a CANCEL lane would otherwise exist. Malformed receive input is classified with receive faults (`refused`), not with normal semantic rejections. All 17 previously surviving mutants now fail a memory test.
- **Vacuous order pins (P3):** three static checks of the form `indexOf(a) < indexOf(b)` passed when the guarded text was deleted. They now require both indexes. B2 also gains JSON.parse-spy tests showing that closed or exhausted intake is refused before parsing.
- **Stale documentation (P3):** counts that still said 595 and backlog wording that called every normal rejection close-only are corrected.

Confirmed by the reviewers:
- **Capacity:** retained 759, late view ceiling 3285 ≤ 16384, transport `+759−1` = 9274 and B2 16161/47087. All limits are unchanged.
- **Pre-serialization:** lines are checked by length and well-formedness before decode on every late path.
- **Tripwires:** they still precede helper imports.
- **Late appender:** it never assigns normal state, and the `frozen`/`refused` split matches the corrections.
- **Untimed B2 entry:** it cannot manufacture a stop.

Verification of the corrections:
- **Reproducing tests:** the new second-round regressions all failed before their corrections.
- **Revert checks:** reverting any one of the five changes, against the memory suites only, fails a test. Removing a pinned pre-parse guard fails a boundary test.
- **Seven-file selection:** it now passes **628 tests** with zero failures/cancellations/skips: controller **209**, boundary **12**, transport/lifetime **176**, boundary **9**, assembly **122**, boundary **9**, qualification clock connection **91**. It was run on Node 20.19.6, 24.18.0 and 26.12.1, under linux/win32 platform spoofs and with CRLF checkouts.
- **Full unit suite:** it passes on a `git archive` copy.
- **Unchanged:** schemas, exports, wire fields, receipts and limits.

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

Residual limits at that P1 review: this proves supplied-data parent contracts and their guarded test boundary, not actual worker no-op behavior, original callback provenance, live stream/child qualification, V8/native memory bounds or native acceptance. P2/P3 and real B4-B/C/D consumers were then unimplemented; the stopped receive limitation was not silently corrected by that review. P2's later memory-only work is recorded above. No runtime authority, Dot restart, market/judgment/notification/mail/retention change or evidence-save claim is introduced by this review.

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
