# B4-B Private Parent Connection Design

Status: **design approved; B4-B1 pure contracts implemented/tested and independently reviewed under separate approvals; private connections and execution remain unapproved**, 2026-10-31 JST. Design baseline: `87846e9`; implementation baseline: reviewed design commit `8c9bba1`, with independently reviewed [P1/P2/P3 contracts and memory verification](NATIVE_BAR_ADMISSION_CANCEL_LATE_FRAME_DESIGN.md). This refines [B4-B in the worker/transport design](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md#proposed-implementation-slices), not B4-C/D worker implementation, B4-E composition or B5/B6 fixture/evidence/cohort execution. The earlier controller signing slice `4-B1` is unrelated to `B4-B1` below. The [design review corrections](#design-review-corrections) add the one-checkpoint ordering rule and three clarifications; the [implementation record](#b4-b1-pure-contract-implementation), [independent review](#b4-b1-independent-review-and-corrections) and [commit review corrections](#b4-b1-commit-review-corrections) cover the later pure slice, not an executed connection.

The initial request changed documentation only. The later B4-B1 approval covers pure contracts/capacity and memory tests only; the subsequent review/commit approval is recorded below. Dot remains PAUSED and judgment/notification/mail/retention rules, bands, confirmation counts and delivery conditions remain unchanged. No real ports/clocks/timers, build, operational subprocess, native read, fixture operation, signature/key or real-data operation, MCP registration, production activation or push is performed. Approval to add unreachable connection code later must not be interpreted as permission to call it.

## Source Gaps And Decisions

| Current evidence | Design consequence |
|---|---|
| `unsignedCohortRuntime.mjs` exports only inspect and unconditional execution refusal; private `prepareOriginalQualification` refuses policy before any clock/import | Keep both public exports and the first refusal exactly sealed; no new exported session factory or flag to reach the private root |
| Qualified build/namespace WeakMaps and the original clock are scoped inside that private root | Create parent/session ownership inside the same lexical scope, never by reconstructing saved DTOs or accepting caller references |
| B2 creates its own protocol, phase window and evidence model per case | Use that single original B2-owned protocol/window for runtime admission; no second protocol/window machine in the transport sidecar |
| Standalone transport creates another protocol/window; P3 compares separate supplied-data predictions | Keep it as a reference model for tests, not a runtime session to instantiate alongside B2 or an execution authority |
| B2 general events require a qualified parent point; its untimed late operation requires an already-stopped original case | B4-B1 adds the narrow pure stop-only clock-fault entry; do not manufacture a malformed timed event to obtain a stop or treat this model entry as a runtime capability |
| Builder metadata/compiler timers do not know case phases | Add a distinct private phase-bound supervision path; do not extend the old qualification timer with caller-supplied deadlines |
| B5 actual receipt/readback/setup/teardown producers, B6 original allocation and B4-C/D worker are absent | Retain explicit refusal at each missing producer. Memory receipts, old worker sources and the 436 existing artifacts do not substitute |

## Included And Excluded

Proposed B4-B deliverables, only after their separate implementation approvals:

- Private original cohort/case/worker-slot ownership and one launch attempt; fixed original child and its four pipe objects.
- One B2-owned frame/ordinal/cancellation ledger; a bounded transport sidecar for the original pending command, callback/backpressure/close facts, fixed deadlines and private generation identities.
- Original status decoder/ordered dispatch, stopped diagnostic handling, stdout/stderr/reverse-command-byte failure handling and bounded terminal facts.
- Phase-bound referenced supervision, one shared original helper slot, original command callback supervision and one command-pipe close attempt.
- Source-extracted VM tests with invented references/children/streams/clocks/timers only; public import/refusal tests with real effects denied before imports.

Excluded even from B4-B connection implementation: worker MessageChannel allocation/worker body (B4-C/D), native bootstrap/query/owner/signing, source/host/signature qualification policy changes, fresh build execution, fixture/evidence/index writers and observers (B5), 24-case operational driver (B6), operational entry opening, CLI/package/MCP registration, job changes and live acceptance. No public injectable backend, caller function/stream/clock, arbitrary path/argv/env/FD/PID, resend, signal or replacement worker is introduced.

## Placement And Reachability

Put effect-capable parent functions inside the existing private `prepareOriginalQualification` lexical scope in `test/helpers/unsignedCohortRuntime.mjs`. Its two public entries remain unchanged: inspection is inert and execution throws `cc4b2_execution_not_approved` before looking at arguments or importing/sampling anything. The private operational-policy, host-closure and native-profile refusers remain unconditional. No top-level call, environment switch, test export or package/build/MCP path reaches the private functions.

Illustrative private responsibilities, not public APIs or an implementation commitment:

| Responsibility | Original inputs, never caller alternatives |
|---|---|
| Cohort owner | Original retained qualification scope, build/namespace references, clock/end and privately produced allocation/readback references |
| Session reservation | That cohort owner plus its exact active case; reserves the sole worker slot and launch attempt before awaits |
| Fixed launch | Qualified fixed Node/new-worker roles from that invocation's fresh manifest and selected mode |
| Command preparation | Internal command kind and retained producer proofs; derives the payload rather than accepting arbitrary bytes/booleans |
| Receive | Original retained FD4 stream, original decoder and bound session/generation captured by its fixed handlers |
| Callback/close handler | Exact original child/pipe/write reference; reported labels/PIDs/hashes alone cannot identify it |
| Case helper | Original case/phase and fixed allowlisted operation through the shared helper slot |

Retain the original references before any asynchronous qualification. Every continuation rechecks the same scope/case/slot/generation, stop/clock state, source/evidence proofs, budget and applicable phase. A failed/partial attempt consumes its attempt; no concurrent continuation can launch another child. Missing original allocation/case receipt means no real session can yet be created, even if a model allocation validates.

Tests extract the actual private declarations into a test-local VM with explicit invented dependencies, as existing B3 tests do. Extraction/import replacement stays in the test file. The imported runtime cannot accept a memory reference, serialized record, approval flag or test dependency to bypass its refusers. Source guards pin the complete private dependency/effect callsite inventory and refuse additions outside it.

File scope by slice (B4-B1 files now exist under the separate approval; later connection work remains proposed):

| File | Slice scope |
|---|---|
| `test/helpers/unsignedParentConnectionContracts.mjs` | B4-B1 pure bounded reservation/checkpoint/callback/terminal/work-plan/counter DTO calculations; no effect imports or runtime capabilities |
| `test/helpers/unsignedCohortAssemblyModel.mjs` | B4-B1 narrow stop-only clock-fault operation; no exported protocol accessor or general untimed event API; existing view capacities unchanged |
| `test/helpers/unsignedWorkerTransportContracts.mjs` | No B4-B1 change; standalone reference behavior and limits preserved, compared in memory without connecting another ledger |
| `test/helpers/unsignedCohortRuntime.mjs` | Later private parent connection declarations nested under the existing unreachable qualification scope; top-level import/export boundary and public refusal unchanged |
| `test/unit/nativeBarAdmissionUnsignedParentConnection.test.mjs` | B4-B1 pure contracts with all real-effect tripwires installed before imports; source-extracted connection tests remain later work |
| `test/unit/nativeBarAdmissionUnsignedParentConnectionBoundary.test.mjs` | Exact AST/dependency/effect/entry seals, source mutation checks and absence from product/package/build/runtime paths |
| Existing controller/assembly/transport/qualification tests | Focused compatibility and invariance coverage, not a full or operational test run |

No new worker source is added by B4-B; B4-C owns that absent dependency. New runtime dependencies are resolved only inside the still-unreachable private scope, never as an effectful top-level import.

## Single Admission Owner

The runtime must not call `createUnsignedWorkerTransportModel` beside B2. B2 alone creates/adopts its original protocol/window/evidence objects. Parent frame planning, normal worker frames and diagnostic late frames all consume that one protocol's shared frame count and directional ordinals once.

The private sidecar owns only transport facts absent from B2: one pending write, at most five original command records, byte/hash/deadline/generation identity, original callback/backpressure outcomes and bounded terminal handles. It neither allocates ordinals nor keeps another late array, baseline, trace reducer, evidence state or cancellation allowance. Diagnostic views reference the original owner's state; copying a snapshot cannot grant authority.

### One Timed Checkpoint Before B2

B2 accepts only monotonic parent points and does not own per-command reservations. Every timed input to B2 therefore passes through one private parent checkpoint. That includes B4-B planning, write-start, receive, callback and close facts, and later B5/B6 receipts, readbacks, observers and helpers. No producer calls B2 directly with its own point.

The checkpoint first evaluates the sidecar's pending command reservation against the new point. If the point has reached that deadline, it relays the stop to B2 at the deadline instant, before forwarding the input (which then follows normal stopped or late routing).

Without this order, either of two errors occurs once B2 has already seen a later point from another producer:
- relaying the known deadline would be refused as a clock rollback, latching a false clock fault;
- relaying the detection instant would anchor settlement late and so extend grace.

Both were reproduced against the current B2 model; the P3 replays only avoid them by relaying first. A point arriving without qualification still uses the stop-only clock-fault entry below.

Common pure calculations should be factored from the reviewed standalone transport algorithms where required (bounded frame preflight, fixed reservation/deadline and effective delivery disposition). Proposed B4-B1 must pin exact pure imports/exports and prove old model behavior unchanged before runtime use. Do not expose an executable injected reducer/backend, add an attach-to-existing-model runtime factory or duplicate a weaker validator. Any incompatible factoring requirement returns to design review instead of silently widening an API.

### Bounded Private State Inventory

This is the proposed field/slot contract for B4-B1 to finalize and measure, not another receipt schema. Reuse existing bounded labels (48), reason codes (96), hashes (64 hex), unsigned decimal points (30 digits), exit/signal schemas and canonical DTO safety. Never retain an Error object, stack, arbitrary message/path, callable or a serialized handle in the diagnostic DTO.

| Owner/slots | Proposed bounded facts |
|---|---|
| One session | Opaque original cohort/case/build/namespace refs privately; allocation binding by shared original reference; launch reserved/attempted/returned flags; first reason/time and clock-invalid latch |
| At most five command slots | Existing kind/ordinal/generation/hash/byte/deadline, started/return/backpressure flags, observed callback enum/point, effective protocol disposition and uncertainty latch in the same slot; raw line released when its existing lifecycle allows, not another saved copy |
| One child | Original object privately; first error code, separate exit and close tuples with unavailable values preserved; no PID-based lookup or replacement |
| Four original pipe slots | Original stream privately; fixed end/error/close/finish availability flags as applicable, bounded first error code and close-attempt disposition; no accumulating event list |
| One command-end decision | Not requested/withheld/attempted and returned/unknown disposition; an unavailable original pipe cannot become a claimed successful close |
| Two timer slots | Original handle privately; owner/phase/operation identity, fixed deadline, generation/segment, referenced/active/cancel-attempt/clear-unknown facts; an unknown slot cannot be reused |
| Receive/output views | References to the sole decoder/protocol late metadata and existing two output-prefix buffers; overflow/completeness flags and saturated counts, not another line array or transcript |

There are at most five command generations per case, and at most five ordered phase selections (including reporting). Other timer/helper segment counters use checked safe-integer representations and refuse before overflow; they do not grant more helper commands, timer retries, time or frames. Refused-input counters saturate at their represented existing bound plus one and mark unknown completeness rather than claiming a whole-stream total. Exact maximal encodings, null-versus-value alternatives and retained/transient overlap must pass B4-B1's capacity gate before any effect-capable code is accepted.

### Command Planning And Write Start

1. Acquire the private planning-owner slot/generation before awaits. Qualify original refs, current B2 phase, fixed work/buffer reservations and actual producer proofs; no bytes or frame are committed yet. Preliminary helpers use the one phase-bound operation slot and must be known closed before committing a command reservation.
2. Construct the fixed payload internally and preflight full canonical UTF-8/LF size before serialization. Compute a fixed deadline from the planning point, current phase end and original cohort end; refuse sub-ms remainder before committing.
3. Submit that exact parent frame to B2 once, then retain its exact line/hash/ordinal and original reservation. The synchronous commit/record sequence has no await. An exception after protocol commitment retains an unsent committed fact and stops; never roll back a counter, reuse the ordinal or retry.
4. Immediately before the original pipe's `write`, recheck original refs/generation, timer reference, phase and the same deadline with at least 1 ms usable remainder. Record write-start in B2 immediately before the call. GO's parent query window begins there, not at its plan or callback.
5. Invoke `write` once with the exact retained bytes. Its false return is backpressure only. Its own captured callback, synchronous throw/error and deadline determine the original disposition; neither `drain` nor an inbound frame can resend/complete it.

Preserve the reviewed model's full-millisecond rounding, not merely its upper bound. With `unit = 1000000 ns`, `plan` the original planning point and `limit = min(original applicable phase end, original cohort end)`:

```text
window_ms = min(10000, floor((limit - plan) / unit))
require window_ms >= 1
deadline_ns = plan + window_ms * unit
```

The command deadline is at most min(plan + 10000 ms, phase end, cohort end), but may be earlier by the unused fractional millisecond. Do not round it up to that upper bound or recompute it as write-start + 10000 ms. This fixes older prose to the already-reviewed model/P1/P3 rule, not a change to a limit. After normal RELEASED, only the original ordinary pre-release CANCEL may drain under P1, with its original bytes/token/generation/ordinal/deadline; a new CANCEL cannot be planned. Await its known callback before cleanup/FINALIZE. After stop, an eligible original shutdown reservation uses the existing once-only lane, not that ordinary drain exception.

### Producer Gates

| Command | Required private producer in addition to timing/ownership |
|---|---|
| LAUNCH | Original case allocation and actual `case_allocated` receipt readback, fixed fresh worker closure, startup/host/profile qualification |
| PREPARE | Original B5-created/sealed setup, registration/envelope and actual receipt readbacks; exact configuration/launch binding |
| GO | Original baseline and go-intent readbacks plus the separately required actual pre-GO bound-object proofs |
| CANCEL (ordinary, ACTIVE) | Original submitted GO with known delivery, unspent original cancellation and its own command reservation within the current phase/cohort bounds. The private decision that requests ordinary cancellation is not defined here and refuses until a reviewed producer exists. After normal RELEASED only the P1 drain of an already planned CANCEL applies |
| CANCEL (shutdown, after stop) | Existing once-only shutdown lane: original possibly running submitted GO, known delivery/binding, qualified remaining settlement time, live worker/qualified pipe, unspent cancellation and late capture not `refused`; P2 restrictions preserved |
| FINALIZE | Genuine normal release, any original CANCEL known complete, actual B5 cleanup/absence/teardown proofs and readbacks |

Until those private producers exist, their gates refuse. Synthetic receipt strings and B2 booleans are model input, not actual readback evidence. B4-B does not add a shortcut to make a complete memory lifecycle into an executable one.

The first contract slice should pin explicit bounded blocker categories for missing original allocation, actual case receipt, qualified new-worker closure, sealed setup, GO ownership/readback proofs, the ordinary cancellation decision, teardown proofs and complete runtime work plan. Tests assert each unavailable producer refuses before dispatch without replacing it with a DTO flag, saved artifact hash or another case's proof. Final code spellings belong to that reviewed pure contract; none is a new notification or delivery condition.

## Original Receive And Stop Routing

One fixed FD4 handler uses the original fatal UTF-8/LF decoder; returned complete frames are processed synchronously in source order. No await per frame, concurrent dispatch, second decoder, unbounded raw queue, favorable-prefix reconstruction after a failed batch, or parser reset is permitted.

| Detection point | Required action on the one original owner |
|---|---|
| Healthy, qualified point within original write/phase/cohort bounds | B2 normal admission once; result is never appended again as late |
| Already stopped | B2 original stopped-case late entry, no parent point lookup or fabricated stamp |
| Clock/deadline detected before normal admission | Record the actual first stop/known deadline first, then offer that same complete frame to the late entry once |
| Normal semantic/admission rejection | Keep the primary rejection; freeze further intake (`frozen`), no fallback retry of the rejected bytes; original qualified shutdown rules remain |
| Late row/shared frame capacity exhausted | Freeze before decoding/adding another candidate; do not judge the unparsed traffic or close an otherwise eligible shutdown lane |
| Invalid judged late traffic | Refuse capture (`refused`) and make further writes ineligible; original started callbacks/close/exit facts remain recordable |
| Decoder/UTF-8/size/partial EOF fault on open intake | Refuse capture; no prefix replay or resynchronization |
| EOF/receive fault after a terminal late frame | Keep `ended`; EOF alone does not turn it into invalid traffic. Actual extra frames after it still refuse |

Keep the P2 shared schemas, binding/direction/ordinal/started-command/seen-mask/trace checks and maximum four diagnostic rows. Late facts remain `diagnostic_only:true`, `semantic_verified:false`, `receive_at:null`; normal release/failure/C1/trace/baseline/evidence fields are not assigned from them. Normal-RELEASED state permits only the reviewed finalize-phase FAILED diagnostic. Frozen report/index bytes/readbacks/verdicts stay unchanged.

After capture stops, the handler does no more decoding/canonicalization/hashing or growing capture work. It retains fixed error/end/close listeners and bounded completeness/overflow state; it does not destroy/replace a stream or remove terminal listeners as a parser reset. No guarantee that peer EOF/close will subsequently arrive is made. Node-internal buffering/CPU scheduling is not included in the canonical byte reservation or claimed to be interruptible.

### Stop-Only Clock-Fault Entry

B4-B1 adds the narrow pure-model operation `noteClockFailure(originalCaseToken, {reason})`. Its strict reasons are `clock_unavailable`, `clock_malformed`, `clock_domain` and `clock_rollback`; no point, executable callback or extra field is accepted. It checks the original model-case reference and validates before latching. Its only effects are to latch stopped/clock-invalid, preserve any earlier primary stop and known first-stop time, set an initially unknown stop time to null, and initialize the existing diagnostic-only stop state. It cannot advance phase/ordinals/evidence, repair a clock, start a timer or grant a write. Wrong/retired case references and invalid payloads refuse without poisoning another active case.

This is a **pure stop-only API, not runtime authority or a relaxation of general timed B2 events**. A future runtime consumer may call it only from its own original clock failure after private reference checks; no such connection is added by B4-B1. Before a case exists the future original cohort owner simply stops with no invented case-attributed frame. Do not trigger a malformed `at:null` event merely to force the model to stop. Known deadlines with a qualified original domain remain distinct from unavailable-time faults and retain their original triggering instant.

## Callback And Terminal Disposition

Every handler is installed once and closes over the actual original child/pipe/write/generation. A stale/foreign callback or repeated terminal event cannot clear a newer slot, alter a counter or consume another command. Reentrant/synchronous callback outcomes must be recordable without inventing a write return; known return/backpressure and known callback are distinct once-only facts.

Retain observed callback outcome/time separately from effective delivery disposition. A known timely callback may retain a qualified point even when delivery is uncertain. A callback observed after its original deadline can say it returned, but effective delivery remains uncertain; it cannot repair a prior uncertain disposition. Do not blindly relay the raw callback enum into B2. Only the single original effective disposition allowed by the existing protocol is forwarded, once; the first stop and cleanup gates remain unchanged.

If no qualified point exists, terminal facts are retained with null/unavailable time in the existing fixed sidecar command/child/pipe slots, not in a new general event list or persistent log. Do not call timed B2 events using the last valid point or backfill later after a claimed clock recovery. The case remains stopped and retained. The original untimed late-frame API is not repurposed for terminal callbacks. Partial terminal-projection support may remain explicitly unavailable in B4-B; it never justifies losing the actual original fact or promoting a clean result.

The session has one original command-end decision, as in the controller contract and v2 model. On the normal path it follows FINALIZE's known write completion. At a stop it follows any permitted once-only CANCEL attempt, or the decision to withhold that write. If the original pipe exists, call its end operation at most once; an absent/unavailable pipe records a withheld decision, never a fabricated call. `end` attempt, write callback, `finish`, `error` and `close` are separate observations; none fabricates the others. No second end/destroy/signal/reopen follows an unknown outcome. Fixed listeners remain for later original facts. Child `exit` is not child/pipe `close`, query release, or clean slot retirement; B5/B6 original teardown/finalization/readback gates remain necessary.

## Fixed Launch And Shared Helpers

Future effect-capable code resolves only the original manifest's fixed reviewed Node and new worker source for the allocated mode. Keep the reviewed no-shell/no-exec/no-fork/no-sync-fallback launch, referenced detached child and `stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"]`; FD3 is command and FD4 status. Attach original child/pipe/error/end/close/output handlers before the first await or LAUNCH. Partial return/stdio failure retains every returned original reference and consumes the attempt. Never substitute the old sealed worker or discover a new path on failure.

The fixed reviewed environment and UBSan settings stay unchanged. Environment, PID, mode labels and packets convey no human approval or original-object identity. Unexpected stdout/stderr stops even below the existing two 8192-byte prefix limits; reverse-direction FD3 input stops with bounded byte/completeness facts only. FD4 is never a parent write channel; no IPC endpoint is added. Worker-private lifetime ports remain B4-C/D, not a parent substitute.

Before the first launch/write, referenced preparation/phase supervision must already be qualified. Case pin/ACL helpers route through a new case-phase-aware path that shares the original B3 helper slot/counters; builder-only qualification helper behavior is unchanged. Reserve ownership before awaits, recheck at actual dispatch and after every synchronous OS return, and stop before a next action on a late return.

There is no helper concurrent with a started command awaiting its callback. Before command commitment a helper uses the phase-owned operation timer and is known closed before that slot changes owner. If a committed but unstarted command needs another asynchronous pre-write qualification, that helper is a sub-operation of the **same original command reservation**: keep its original timer/deadline, one helper slot and remaining time; do not arm a third timer or grant a fresh 10000 ms. A write cannot start until that helper's original disposition is known closed and proofs are rechecked; the original command deadline may simply expire meanwhile. This preserves P1's possible release-before-start race without a slot deadlock, a helper/write overlap or a renewed reservation. B4-B3/B5 must test that exact routing, including helper failure and a release/stop during its await. Existing B5 observer/writer routing will require a separate later proof.

## Timer And Capacity Contract

Use the original B3 parent origin/domain/end for every session, never reset on READY, new mode, case or command. Separate one phase timer from one active-operation timer. Both are distinct from B3-C's builder-only qualification timer slot (`qualificationTimer`). That slot must be empty before the first case phase timer arms and stays unused for case work; no case operation borrows it. The operation timer is bound to the original command reservation or fixed phase-owned case-helper reservation, with the existing capped full-ms remainder and original phase/cohort bounds. A pre-write helper under a committed command uses that same reservation/timer as described above. Case reporting remains bounded by the original cohort end; this design adds no reporting duration or total-duration value.

Both timers inherit B3-C's reviewed generation/reference/segment/cancel behavior: stop before attempting clear, keep non-deadline reasons distinct, stale generation inert, early firing uses only the remaining original duration, failed/unknown clear retains its original handle, and no replacement timer is installed into an occupied/unknown slot. A newly detected original settlement trigger may select its one existing grace deadline, never renew it. Clock failure disables new timed work. Timer checks cannot interrupt a synchronous OS call or prove peer release.

| Reservation | Fixed geometry or proof obligation before effect-capable connection acceptance |
|---|---|
| Session/launch | One retained active session and one launch attempt; up to 24 fixed catalog allocations under B6 later, not a new B4-B loop |
| Commands | One pending command, at most five original records; 32 total frames shared with normal/late worker frames, no second cancellation/ordinal ledger |
| Input/output | Existing 65536-byte frame/pending-command/pending-decoder bounds, `32 * 65536` input/decoded batch, 128 trace events and two 8192-byte output prefixes |
| Late view | Existing four rows and 759 retained canonical bytes, late-view ceiling 3285 within 16384; not copied into a second retained transcript |
| Canonical metadata | Existing 16384 diagnostic and 65536 coordinator limits; current 9274 transport/lifetime and 16161/47087 B2 figures are model reservations, not a measured new runtime ledger |
| Encoded buffers | Preserve 2375680 retained and 4259840 transient reservations; prove shared references versus transient copies before implementing an extra buffer |
| Timer/helper/terminal slots | One phase timer, one active-operation timer and one shared helper; fixed child/pipe flags, at most five callback slots, bounded first/secondary error fields; no growing event history |
| Qualification work | Existing B3 manifest/hash/helper budgets, including 2147483648 hash-work bytes and 131072 helper commands; runtime checks must consume a complete reserved plan, not invent another full-manifest pass per message |

B4-B1 must derive maximal serialized metadata for new private state and reconcile overlapping model views, command copies and error/terminal fields. Existing slack is not an unexplained allowance. Define safe bounded generation/segment/counter representations and saturating refused-input/duplicate-event diagnostics; repeated peer errors cannot allocate records, rehash data or create work allowances. Do not claim these bounds measure JS object/UTF-16/Node-internal buffer peaks.

The per-invocation plan must include the real fixed startup module/pin work and repeated case/mode costs, relevant metadata helpers, bounded wire/trace hashes and callback supervision. Charge work before dispatch and preserve consumed work even on refusal. The new B4-C worker/source closure and later host/operational profile are absent, so some concrete work totals remain unavailable: keep those gates blocked, rather than estimating them from old artifacts or increasing `runtime_gates`, budgets or duration. Old 436 outputs cannot qualify the new worker. Any new metadata/buffer/work ceiling or operating policy needs a separate design/approval decision.

## Proposed Sub-Slices And Acceptance

Each row needs separate user approval. Adding effect-capable code never authorizes its execution.

| Slice | Deliverable | Permitted verification after its own approval |
|---|---|---|
| **B4-B1 (pure implementation tested and independently reviewed)** | Pure single-owner/reservation/timed-checkpoint/stop-only fault/terminal DTO and capacity contracts; standalone reference algorithms unchanged | Memory-only valid/invalid/limit tests, including fractional-ms rounding, deadline-first checkpoint ordering and exact/one-over capacity, unchanged P1/P2/P3 regressions and source/effect guards. No effect-capable connection body or new public runtime entry |
| **B4-B2** | Unreachable private cohort/case/session refs and one-owner admission/receive/terminal projection; exact missing-producer refusers | Source-extracted VM references/decoder/facts; no launch/timer/stream call execution outside invented VM dependencies |
| **B4-B3** | Unexecuted private phase/operation/helper supervision and original helper-slot routing | Fake clocks/timers/late synchronous returns, clear/reference failure and concurrency; no real clock, timer or helper |
| **B4-B4** | Unexecuted fixed launch and original child/stdio handler binding after supervision | Fake partial spawn/stdio/reentrancy/foreign generation/output/reverse-byte/close events; no real child or port |
| **B4-B5** | Unexecuted exact ordinary write/callback/backpressure/stop-CANCEL/end connection; P1 drain and producer gates | Fake streams/timers/known producer references, no resend or forged readback, P2 frozen/refused/ended routing and null-time terminal facts |
| **B4-B6** | Composition and independent boundary review of the single-owner private parent path | Replay P3 schedules through extracted actual connection code, compare decisions to reference models, kill key guard mutations and recheck seal/capacity/work plans |

Required acceptance families include: wrong/copied/retired original refs; slot races across awaits; stopped/clock-invalid pre-dispatch; original planning deadline and sub-ms remainder; another producer's B2 input arriving after an unobserved command deadline (stop relayed at the deadline instant first); same callback with either deadline callback ordering; normal release overtaking planned CANCEL (also during a pre-write helper under the same reservation); normal rejection versus capacity freeze versus invalid-late refusal; one decoder batch crossing normal/late admission; stopped receive without sampling time; closed intake before parsing; missing actual B5/B6 producers; original pending callback after close/error; unknown timer clear; no helper/write overlap or third timer; bounded repeated terminal events; frozen report/index invariance; no original slot retirement from exit alone; exact source imports/exports/effect callsites and refusal before any public effect.

B4-B exit requires a true single-coordinator memory connection test, not merely P3's two-model comparison or a new DTO claiming ownership. Missing future worker/host/work-plan producers must remain visible blockers. The initial design itself approved no sub-slice. The later B4-B1 approval covers its pure contracts and memory tests only, not independent review/commit, private B4-B2 onward connections, execution or B4-C/D/E/B5/B6 work.

## B4-B1 Pure Contract Implementation

2026-10-31 JST, after approval of the reviewed design and specifically B4-B1 implementation/memory tests, starting from `8c9bba1`. No effect-capable connection, private runtime issuer or attach-to-model backend is added. The only existing model behavior change is B2's explicit stop-only clock-fault method. The runtime, standalone transport algorithms, protocol/window/evidence algorithms, package/build/product/native files and settings are unchanged.

`unsignedParentConnectionContracts.mjs` exports eight pure interfaces, with authority/qualification/execution/save flags false:

| Interface | Contract |
|---|---|
| `planUnsignedParentReservation` | Exact full-ms capped original planning reservation, strict uint/domain fields and immutable result; no round-up or renewal |
| `validateUnsignedParentClockFailure` | The four strict stop-only reasons shared with B2; no caller timestamp or executable option |
| `planUnsignedParentCheckpoint` | Plans a known earliest command/phase/cohort stop before forwarding a later point; refuses an already-late B2 relay, reports unknown-time faults with null, never calls B2 or issues a point |
| `assessUnsignedParentCallback` | Original kind/reservation/observed outcome/point versus effective disposition; stopped/shutdown lanes kept distinct, prior uncertainty never repaired, unqualified facts not forwarded as timed B2 events |
| `validateUnsignedParentTerminalFacts` | Strict bounded command/child/four-pipe/two-timer/helper/error/counter DTO and coherence checks; no actual handles, callbacks, raw transcript or persistent log |
| `describeUnsignedParentConnectionCapacity` | Maximal shape-only encoded metadata and unchanged buffers/work caps; unknown work remains a blocker |
| `describeUnsignedParentConnectionProfile` | One declared B2 admission owner, fixed slot geometry and missing actual producers including the ordinary cancellation decision; caller approval booleans cannot satisfy it |
| `summarizeUnsignedParentDiscard` | Safe-integer supplied increments, bounded/saturating sentinel counts, no record growth; `complete_supplied_count` is not an observed whole-stream guarantee |

B2's `noteClockFailure` tests preserve normal phase/baseline/ordinal/evidence fields, earlier primary stop/time and retained closed-case report/index hashes; healthy bad payloads, getters and foreign/copied/retired references cannot poison another case. General timed events still require a point; only existing untimed late capture can subsequently retain bounded diagnostics. The checkpoint/B2 test submits the known write deadline first and only then a later original command-close point, avoiding the false rollback or extended grace described in design review. This is a memory-script ordering proof, not an implemented funnel for every producer.

The fixed terminal view upper bound is **7654 bytes**. Conservatively adding the unchanged B2 coordinator reservation floor **47087** gives **54741 bytes**, below **65536**. The sidecar diagnostic is separate from the existing B2 summary (16161 bytes), not concatenated into its almost-full 16384-byte envelope. Exact combined-capacity fit and one-byte-over rejection are tested. The maximum sample takes independent leaf maxima, deliberately including incompatible state combinations; it is `maximum_shape_only`, not a valid lifecycle, and the normal validator refuses it. Do not retain that illustrative maximum sample beside a live sidecar in a future runtime: retain the derived numeric reservation and the one actual state, without a second transcript/view copy.

Existing **2375680/4259840** retained/transient encoded-buffer reservations, five command/four pipe/two case-timer/one helper geometry, frame/late/receipt/time/native limits and B3 **2147483648 hash bytes / 131072 helper commands** are not increased. A complete work DTO means only complete supplied invocation totals for all 24 cases, never actual startup closure/work qualification. Missing components remain named blockers; even partial known overspend refuses. Actual worker/host/work-plan and B5/B6 producer qualification remain unavailable, with no operating duration or execution approval invented.

Tests were added in failing/passing increments: absent reservation module, stop entry, checkpoint, callback, terminal DTO, capacity/profile and discard interfaces first refused their tracers. Subsequent coherence/context regressions failed before checks for known completion, fixed command-timer deadline, primary clock stop, CANCEL-only shutdown, stopped shutdown context and already-stopped prior uncertainty were added. One negative-test setup attempted to mutate a frozen reservation; its preparation was corrected to create a changed copy, without changing immutability. No independent review or behavioral mutation campaign is claimed.

On Node **24.18.0**, nine individually run main-thread memory/source files pass **795 tests**, zero failures/cancellations/skips: controller **209/12**, assembly **139/9**, transport/lifetime **247/9**, qualification clock connection **91**, new parent contracts/boundary **72/7**. Coverage includes 84 finite independent rounding combinations, 30 comparisons with the unchanged original transport reservation/callback model, fixed-state malformed/foreign/overflow/coherence cases, exact/one-over metadata/work bounds, unknown work, constructor/effect tripwires and static source mutations. Static mutations pin source boundaries, not execution of mutated implementations. No default-isolated/full-unit/build/signature/native/operational suite is run.

Final verification reruns all nine selected files with `--test-isolation=none`, checks syntax for all seven code/test files and whitespace in the diff, and resolves 190 local Markdown document/heading references across the five changed documents. The 2568 protected source/package/native/build files match the starting content hash, all 436 existing isolated artifacts match their recorded bytes/hash/mode, and Dot remains PAUSED with its full configuration hash unchanged. No generated artifact, operational setting or stored data is changed. These checks do not qualify a worker, prove a real callback's origin or exercise a private runtime connection.

Scope is one new pure helper, two new unit files, the B2 model, focused existing tests and five design/backlog documents. At initial implementation, independent review and commit/push were unperformed; the later review/commit gate is below. Real ports/clocks/timers, operational subprocesses, native read, fixture/signature/key/real-data actions, MCP registration and production activation remain unperformed. Dot stays PAUSED and judgment/notification/mail/retention conditions stay unchanged. The next connection slice remains separately approved B4-B2, not an effect enabled by passing these models.

## B4-B1 Independent Review And Corrections

2026-10-31 JST, separate review/commit approval for the twelve uncommitted B4-B1 files on `8c9bba1`. Two read-only reviewers examined disjoint scopes: state/reservation/callback/terminal relationships, and capacity/work/counters/source-effect boundaries. The first review found three P2 terminal-coherence issues; the second found two P2 static-boundary test gaps, with no further capacity/work findings:

1. A started write marked uncertain by its original deadline can still await its original callback. The terminal validator wrongly refused that retained pending generation. It now accepts the unseen-callback uncertainty only with an existing primary stop; a completed or callback-seen command cannot remain pending.
2. An observed callback at or after its original deadline could retain the effective decision `started`. The terminal validator now requires `uncertain` for that known expired observation. D/D+1 assessor-to-terminal tests cover both a newly detected stop and an earlier primary stop; they do not invent a timely callback point.
3. An absent command pipe could claim an attempted/returned end call. An attempted end now requires pipe presence for null, returned and unknown outcomes; an unavailable pipe can retain the withheld decision. No actual pipe or end call is used.
4. Binding-pattern extraction could bypass the source guard's constructor ban. The static guard now rejects constructor identifiers, literal binding/property extraction and computed binding patterns, including assignment variants.
5. A literal computed authority name bypassed the false-only property check. The guard now resolves literal computed assignment names, rejects dynamic computed assignments and checks the same authority set. All fourteen computed true flags are tested, with a computed false positive control.

Each issue first reproduced as a failing memory or static-source mutation test, then passed after its narrow correction. Mutated source is parsed only, never executed. Both original reviewers rechecked their own corrections and reported no new findings in their scopes; the state reviewer performed static re-review, while the boundary reviewer additionally reran its 9-test file. No reviewer edited files or invoked operational code. This is not proof for all possible JavaScript rewrites, real callback provenance or a runtime connection.

The parent reran nine individually selected main-thread files on Node **24.18.0**: **803 tests** passed, zero failures/cancellations/skips, with counts **209/12/139/9/247/9/91/78/9**. The earlier 795-test record above describes initial implementation. Terminal DTO schemas, imports/exports, 7654/54741 metadata ceilings, existing buffer/work/time limits, original transport and public runtime seals are unchanged by these corrections. Syntax/diff/document-reference checks and the protected-source/artifact/Dot integrity comparison are repeated for the local commit gate. Only the twelve B4-B1 files are staged; hooks, signing and automatic maintenance are disabled for the local commit. No push, build, operational process, port/clock/timer, native/fixture/signature/real-data action, MCP registration, production activation, Dot restart or judgment/notification change is included.

## B4-B1 Commit Review Corrections

2026-10-31 JST, review of local commit `cda94a7` against the code, then a separate fix/commit approval. The commit itself verified cleanly in an archive copy: `build:package`; the nine selected files three times on Node 24.18.0, under linux/win32 platform spoofs, on Node 20.19.6 and 26.12.1, with CRLF sources and per-file `--test-isolation=none` (803 tests each time); and the full unit suite (4392 tests, 4390 pass, zero failures, two existing skips). Boundary probes then reproduced three P2 gaps and one P3 omission:

1. Terminal facts accepted a started or planned command without its callback that was not the pending generation, including beside a later command. Only one command is reserved at a time and only its original callback releases it, so the unmarked in-flight write also bypassed the helper/write overlap refusal. The validator now requires every callback-unseen command to be the pending generation, and the pending generation to be the latest record.
2. Correction 1 above required a stop only for a pending uncertain command. A callback-settled or non-pending `uncertain` command, and a callback-seen command left `started` (a timely healthy completion not applied, or a clock-unavailable callback), were accepted with no first stop. The assessor stops the session in each of those outcomes, so the validator now requires the first stop for both decisions; the pending-only condition is subsumed.
3. The false-only authority guard inspected object-literal properties only, and outputs were checked for authority flags in one export. Property, element and compound assignment, shorthand properties and `Object.defineProperty` with a true value passed.
4. P3: after a write is already uncertain from its deadline, the unchanged reference transport stores a later callback sample as `callback_at`, while the parent contract keeps that sample only as `observation_point` with `callback_at` null. The 30 comparisons omitted this lane. Two transport-file tests now pin the intentional difference; the transport model is unchanged.

### Independent Review Of The Corrections

Two read-only reviewers examined disjoint scopes: terminal coherence, and the source guard with authority flags. The coherence reviewer mapped 202 snapshots from more than 30 reference-transport lifecycles, plus parent-only states, to terminal facts; the corrected validator refused none, and both new rules were confirmed against `reserve`/`completeWrite` and the assessor. It reported three P3 notes:

- A phase-owned helper was accepted beside a committed pending command, although the design closes it before the reservation commits. The validator now refuses it.
- Nothing is planned after a stop except the one shutdown write, but a later record after the shutdown write was accepted. The shutdown write must now be the latest record. Time-ordering combinations, such as a non-shutdown completion timestamped after an earlier stop, stay outside this timestamp-free validator, which continues to report `semantic_verified: false`.
- With under 1 ms of phase left, the original window stops at the observation, while the pure checkpoint stops only at the bound itself. In that lane the parent would plan a completion and relay that B2 refuses (B2 still stops conservatively). The instant to relay is an **open B4-B2 checkpoint decision**; a transport-file test pins the current difference, and this pure slice adopts neither behavior.

The guard reviewer demonstrated mutated helpers that passed both the first corrected guard and its representative-output test: a literal-element `Object["defineProperty"]`, an inherited `__proto__` getter, `Object.create` descriptors from parsed JSON, and assignments placed in callback/checkpoint lanes the representative list did not return. Its re-review of a first redesign (a raw source-text rule) then passed both files with Unicode-escaped names, computed class fields and methods, regular-expression named groups, and conditions on callback kinds the file never exercised. A third round found function-valued fields hidden from the walk, run-time keys from regular-expression groups, `replace` callbacks and zod enum maps in input combinations no test reaches, and one redundant condition. The guard now has two layers:

- Static: on decoded AST names, so escapes count, an identifier or string literal naming an authority field may only be the key of a property assignment (direct or literal-computed) whose initializer is literal `false`. No assignment, compound/logical operator, destructuring target, increment or `defineProperty` string can then name one. Every computed property name, including on methods, must be a literal. Classes, getters and setters are refused. String-literal element, binding and property names are checked against the forbidden identifiers. `__proto__`, `JSON`, `create`, `fromEntries`, `groupBy`, `groups`, `RegExp`, `match`, `matchAll`, `replace`, `replaceAll`, `Enum` and `Values` join `defineProperty`/`defineProperties` as forbidden; regular-expression literals may not declare named groups, and `.enum` is allowed only as the `z.enum(...)` callee. The helper uses none of the refused forms.
- Memory: every result that any test in the parent file receives is recorded. A final test walks them all for function values, a non-plain prototype, accessors, any authority name present by `in` with a non-`false` value, and nested own keys, including non-enumerable ones. It also asserts that all eight exports, all four checkpoint routes, all six callback clock-failure values, all five callback kinds with both CANCEL lanes, and all three capacity work statuses were exercised.

Each new terminal sub-case and guard form was first accepted by the unfixed code on its own, then refused after its narrow change. Revert/mutation checks were all killed: eleven validator reverts and injected authority values by the memory suite, and twenty-five guard-clause or forbidden-entry reverts by the boundary file. Every reviewer bypass in a lane the tests exercise now fails both files; those placed in unexercised input combinations fail the static layer. Double mutations show that the function, prototype, `in` and accessor clauses of the walk, and the callback-kind coverage, each catch a mutant the others miss. Removing the recorder fails the coverage assertions. Mutated sources were parsed or run only in scratch copies. The coherence reviewer's re-review of the final validator found nothing actionable. The guard reviewer's third-round items were closed and verified against its own mutants without a fourth round.

The static layer is best-effort: JavaScript can construct property names at run time in ways no finite list of refused names and node kinds can exclude. Its residual is a deliberate key construction through an API not listed above, placed in an input combination that no test in the file exercises. The behavioral layer covers every combination the tests exercise. Both layers are regression tripwires for this test-only helper, not proof that arbitrary edits are safe.

Nine individually run main-thread files now pass **812 tests** on Node 24.18.0, counts **209/12/139/9/250/9/91/83/10**. Terminal schemas, exports, the 7654/54741 metadata ceilings, buffer/work/time limits, the transport model and public runtime seals are unchanged. No push, build outside scratch copies, operational process, port/clock/timer, native/fixture/signature/real-data action, MCP registration, production activation, Dot restart or judgment/notification change is included. B4-B2 onward remain separately approved, and B4-B2 must settle the sub-millisecond checkpoint decision before wiring the checkpoint.

## Design Review Corrections

2026-10-31 JST, review of this proposal against the code at `87846e9`. It is documentation only: no code, test or limit changes.

The proposal's code facts were checked and hold:
- **Runtime:** public inspect/refusal only; policy refused before the clock; WeakMaps in the private scope; builder-only timer kinds; unconditional policy, host and native-profile refusers.
- **Budgets:** 2147483648 hash-work bytes and 131072 helper commands.
- **Capacity figures:** 759, 3285, 9274, 16161/47087, 2375680 and 4259840 bytes.
- **Rules:** the full-millisecond deadline formula, the frozen/refused/ended routing, and the spawn/stdio and FD roles.

One P2 and three P3 corrections were made:
- **One timed checkpoint (P2):** the proposal kept the command reservation in the sidecar and told B2 about a stop afterwards. It did not require the sidecar's deadline to be evaluated before B2 sees any other producer's later point. Against the current B2 model, an observer event at D+500 followed by the deadline stop at D latched a false `clock_order` clock fault, with no settlement. Relaying at the detection instant D+900 instead anchored settlement at D+900, extending grace. Relaying at D before any later B2 point recorded it correctly, as the P3 replays do. The [one timed checkpoint](#one-timed-checkpoint-before-b2) now routes every timed B2 input, including later B5/B6 producers, through a deadline-first check. B4-B1 and the acceptance families test that ordering.
- **Ordinary versus shutdown CANCEL (P3):** the producer table mixed the shutdown lane's settlement condition into ordinary ACTIVE cancellation and named no producer for the ordinary decision. The two lanes are now separate rows. The ordinary decision is an explicit blocker until a reviewed producer exists.
- **Command end on the normal path (P3):** the text described only a stop consuming the command-end decision. It now matches the controller contract and model: one decision per session, after FINALIZE's known completion or at a stop.
- **Timer inventory (P3):** the phase and active-operation timers are now stated to be distinct from B3-C's builder-only qualification timer slot. That slot stays empty and unused for case work.

The full unit suite was rerun on a `git archive` copy with these documents applied. No sub-slice, implementation or execution is approved by this correction.
