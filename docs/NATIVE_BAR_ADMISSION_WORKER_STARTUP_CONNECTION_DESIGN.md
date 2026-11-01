# B4-C2 Worker Startup Connection

Status: **C2a independently reviewed/corrected; C2b independently reviewed/corrected and memory-tested with its entry closed; C2c/d remain pending**, 2026-11-01 JST. The [C2b review correction](#c2b-independent-review-and-corrections) supersedes the initial [implementation checkpoint](#c2b-implementation-and-memory-verification) below. Review and a conditional commit are approved; all invocation remains unapproved/unperformed. The [C2a commit review correction](#c2a-commit-review-correction) supersedes the envelope/handoff rules and counts of the [review checkpoint](#c2a-independent-review-and-corrections), which superseded the initial [implementation checkpoint](#c2a-implementation-and-memory-verification) and next-approval recommendation below. C2b source baseline: `69e13f1`; original design baseline: `0ca489a`, including the [latest C1 status-stream correction](NATIVE_BAR_ADMISSION_WORKER_PREPARATION_DESIGN.md#b4-c1-commit-review-correction). This refines [B4-C2](NATIVE_BAR_ADMISSION_WORKER_PREPARATION_DESIGN.md#proposed-slices), not operational 4-C. The [transport](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md), [parent connection](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md) and [qualification](NATIVE_BAR_ADMISSION_COHORT_QUALIFICATION_DESIGN.md) contracts remain controlling.

No real port, clock or timer, build, subprocess, native load/read, fixture operation, signing, real-data operation, MCP registration or production activation is permitted. Dot remains PAUSED. Judgment, observation bands, confirmation counts, notification/mail and retention conditions are unchanged. Later connection-code approval does not authorize invocation.

## Scope And Non-Goals

C2 connects one original worker invocation from inherited streams and a compact LAUNCH to READY, or to a bounded pre-GO failure disposition. It does not prove actual qualification, fixture absence, owner enrollment, native release, saved evidence or cohort acceptance from supplied facts.

| In C2 after separate approval | Remains outside C2 |
|---|---|
| Shared strict v2 decoding/validation, original stream identity and bounded counters | A second parent B2 admission owner or a new wire version |
| Sealed distinct facade; unreachable local clock/timer/lifetime/startup/status connections | Opening a CLI/MCP/runtime entry or operational policy |
| Fixed build-record, exact role/module pins and eager selected-mode imports, subject to the reader gate below | Build execution, dependency discovery, signing, old artifact qualification |
| Original addon facade/cache ownership; import-only helper readiness | Bootstrap/public-key construction/baseline (C3); GO/owner/query/release (B4-D) |
| At most one early PREPARE envelope for the C3 boundary | Calling absent C3, buffering GO or inventing BASELINED |
| Fake-only private-declaration composition through READY/failure | Actual worker launch, inherited-FD traffic, observer/fixture/evidence authorities (4-B5), full 24-case acceptance (4-B6) |

## Implementation Boundaries

Each row needs its own implementation approval and review. No row opens execution.

| Slice | Proposed files and work | Completion evidence |
|---|---|---|
| **C2a, recommended first** | New `test/helpers/unsignedWorkerStartupContracts.mjs` and two memory/boundary tests; narrowly extract stateless strict wire validators from `unsignedControllerContracts.mjs` only where needed | Same parent accept/refuse behavior; strict startup/READY handoff, work and exact capacity arithmetic; no worker file or connection code |
| **C2b** | Add sealed `native/native_bar_fs/test_unsigned_cohort_worker.mjs`; private inherited-stream, local clock/timer, lifetime and status/failure plumbing | Extract the actual private declarations with fake primitives; no real module, FD, clock, timer or port acquisition |
| **C2c** | Private fixed record/pin/module/addon-cache connections and corresponding fake tests | The bounded record-reader and initialization-effect gates below must be resolved first; unavailable components refuse before loading |
| **C2d** | Single-startup memory composition and parent compatibility/source-boundary tests | Independently predicted traces compared with actual extracted declarations through READY or failure, including all C1 corrections; no operational PASS |

C2a must not expand into connection code while extracting validators. Enumerate every changed export/import and preserve parent protocol semantics. C2b/c do not reuse the empty legacy worker registry or unseal `unsignedCohortRuntime.mjs`. C2d is narrower than C4, which also owns PREPARE/bootstrap/BASELINED composition.

## C2a Pure Contract

Proposed public surface: `planUnsignedWorkerStartup`, `validateUnsignedWorkerStartupEnvelope`, and `describeUnsignedWorkerStartupCapacity`. Inputs are strict bounded supplied data/bytes only. Return normalized consistency/refusal results and false authority flags, with `native_status: NOT_RUN`. They do not return a runtime handle, approval, executable callback or qualified READY grant. C1 remains the preparation reference model, not a worker runtime backend.

Proposed schema/scope: `native-bar-worker-startup-plan-v1` / `unsigned_worker_startup_memory_only`. Use the existing strict label/hash/unsigned-integer parsers and reject unknown fields; no general object/backend or arbitrary manifest path is accepted.

| Contract group | Required content and meaning |
|---|---|
| Startup subject | Complete supplied initial binding; expected closed-set/module/record digests; selected normal/ubsan mode; supplied original local domain/origin/end; no translated parent timestamps |
| Components | Fixed record-reader, closed-set, module-initialization, metadata/host-profile, native-profile and work-plan results, each unavailable/matched-supplied/refused; missing is never matched |
| Wire check | Bounded canonical line, expected direction/kind/next ordinal/shared spent count and exact expected binding; return a normalized checked envelope or refusal, without spending runtime authority |
| Work projection | Existing per-mode 12-start records and per-start record/module/pin/metadata/wire costs, other invocation totals, fixed page/buffer profile and unknown-cost blockers |
| Handoff projection | Original READY payload/binding digest/domain, known return/callback disposition, sticky stream facts and pending-PREPARE classification; supplied consistency only, not a runtime handle |
| Result | Bounded blocker list and cost/capacity arithmetic with false authority flags; distinguish supplied-plan completeness from unavailable runtime producers |

Initial binding validation enumerates the existing protocol/stage, run/case/mode, source commit/patch/tree, plan/template, exchange/nonce, signature profile, null setup and ten artifact digests (`js_set`, addon, observer, controller, worker, runtime closure, Node binary, build record, reader source, reader JS). Their existing `_sha256` names and constraints stay exact. Any internally recomputable plan digest must use the existing acceptance-request contract; unavailable template/configuration preimages remain opaque. Sharing a parser does not add a permissive `binding: unknown` acceptance path to the worker.

Shared validators cover the exact v2 outer envelope, strict complete initial binding, fixed mode/artifact hashes, direction, ordinal, LAUNCH empty payload/null setup and existing READY/FAILED shapes. Keep canonical encoding, Unicode/LF handling and limits unchanged. The worker keeps bounded next ordinals and a shared-direction frame total, not a copy of the parent write/teardown ledger. Decoder receive count alone is insufficient for that total.

Compact LAUNCH omits fixture IDs and the template preimage. C2 must not invent IDs to instantiate the parent allocator, recompute a fictitious recipe/template, or mark those preimages verified. Retain their supplied digests as opaque correlation until C3 validates the actual PREPARE configuration. Shape validation is not source provenance, ownership or operational approval.

The capacity description must charge every new bounded field, counter, pending envelope, module/cache observation and read-page lifetime. Unavailable producer/work data stays unavailable; the planner never fills expected counters or known catalog values. Parsing/hashing work is reserved before processing and debited work survives a later refusal. The C1 model can be used by tests as an independent comparison, never as a caller-provided runtime backend.

## Facade And Private Originals

The new facade has no static effectful imports. Its only proposed exported entry, `runUnsignedCohortWorker()`, unconditionally refuses, and module evaluation invokes that refuser without first consulting argv/environment. Thus direct execution and import are both closed. A separate private root starts with an unconditional operational-policy refusal before any capability import/acquisition. Environment flags, mode, nonce, saved JSON or a model token cannot unlock either seal. Removing a seal requires a separately approved code change.

The unreachable root owns one private original session: selected mode, immutable launch binding, original command/status streams, decoder, ordinal counters, stop latch, local clock origin, outstanding action references, one lifetime pair and acquired module/cache references. Original objects are not reconstructed from hashes, PIDs or serializable fields. No public backend, path, FD, module namespace, clock, timer, port or retry factory is accepted. Tests extract the actual declarations and supply fakes only outside the sealed entry.

Allowed future effect callsites must be inventoried narrowly: inherited-FD stream wrappers, bounded fixed-file metadata/content operations, selected-mode module loading, hashing, local monotonic/wall sampling, referenced timers and `MessageChannel` only. No child process, network listener, `Worker`, IPC, alternate transport, key creation/signing, native maintenance API or fixture mutation callsite belongs to the worker startup. A domain label producer must be explicitly included in the inventory; do not obtain it through an unreviewed random/clock helper.

## Startup Sequence

1. Spend the original startup attempt, capture the independent worker clock origin and fixed local preparation deadline once, and acquire only the original inherited streams/lifetime pair. Record partial acquisition before the next action. If an earlier acquisition throws or its result is unknown, unwind or retain exactly the originals already acquired; no replacement.
2. Attach original status error/close listeners before the first write or asynchronous startup continuation. Command FD3 is read-only to the worker; status FD4 is write-only. Detect readable reverse traffic on FD4. Never write FD3, use IPC, reopen a stream or add a signal/destroy fallback.
3. Decode and strictly validate the original LAUNCH, direction/ordinal/shared budget and complete null-setup binding. Only then may failure reporting use that binding. Bytes before LAUNCH do not authorize attributed status.
4. Under original deadlines and precharged work, validate fixed record bytes, exact role-tagged runtime/source/module sets, selected mode and original addon identity. Missing record-reader, host/profile, closure or work qualification stops before loading. No saved record or aggregate digest substitutes for a live original producer.
5. Acquire/load the fixed addon at most once, preserve its original module/export/function identities, install the fixed admission facade, and eagerly load the selected compiled reader/registry/contracts and both owner helper modules. Recheck cache identity, local time, stop and lifetime after every synchronous return/await.
6. Require the original addon info to identify `synthetic_only` and admission-read protocol 6. No native enrollment/read operation is called. Only after all startup outcomes and work are known may the original READY write be reserved and started.
7. Keep READY delivery as separate start/boolean return/callback facts. Hand off original preparation state only after both outcomes are known, within the original deadline; a write return alone is not delivery or operational acceptance.

Every continuation captures the same original session/action/generation. The first stop reason persists. Check stop and original deadlines before every next effect; a late or foreign completion cannot restart startup. Uncertain acquisition/write/timer disposition stays explicitly uncertain and keeps the original lifetime anchor as needed.

## Fixed Record And Import Gates

**Unresolved producer gate, not permission to raise limits:** the current build record is one canonical JSON document plus LF, up to 4 MiB, and can include a 2 MiB manifest. The worker has no reviewed bounded parser for that record. A whole-file buffer plus `JSON.parse`, canonical re-encoding, row copies and simultaneous pipe buffers cannot be assumed to fit the existing retained/transient envelopes. The current dependencies provide no established streaming JSON parser for this use. Qualification page contracts alone do not make the on-disk record paged.

C2a may specify supplied page/byte/work budgets and missing-reader refusals, but C2c's actual reader remains unavailable until a separate design chooses a standard bounded parser and proves canonical/hash/duplicate-key/UTF-8/depth/node accounting, or proposes an explicitly approved record-format change. Neither a new dependency, an ad-hoc JSON tokenizer, a smaller accepted record ceiling, a larger memory ceiling nor a LAUNCH change is silently authorized here. Hash the exact original bytes against LAUNCH; projected summaries or a fake parsed object do not close this gate.

Fixed paths derive only from the existing isolated normal/ubsan build layout and approved original invocation, never from arbitrary wire paths. Require no-follow/identity/size/ownership/metadata checks and unchanged original descriptor/path identities across read/hash. Worker-local ACL/signature verification must have a reviewed producer within the no-subprocess startup geometry; parent claims alone must not be renamed independently verified worker facts. If that cannot be supplied, refuse rather than spawn an ACL/signature helper or infer host safety.

The precise module inventory must include transitive imports, package metadata/runtime dependencies and initialization effects. Examples requiring explicit treatment are the reader's top-level finalizer creation and the owner helpers' mode selection, compiled imports and cached clock references. No legacy build fallback, computed discovery, cache-busting URL, resolver fallback or lazy GO import is allowed. A fresh future closed build must include the new worker source; the old 436 artifacts do not qualify it.

Both owner modules are imported before READY, but enrollment functions are never called. The private usable view exposes only the C0-only fixed-owner enrollment function and the unsigned-owner function for the future GO path; the legacy unrestricted fixed-owner export is not routed into dispatch. Tests use fake namespaces and inspect the fixed source closure, not actual owner helper/compiled imports or test signatures.

### Addon Cache Ownership

Capture the exact resolved addon path, `require.cache` Module object, original exports and the eight fixed admission functions/receivers. Refuse conflicting prior cache state. Forward each original call once with its original receiver, arguments, return or exception. Observation failure latches failure without repeating a call or replacing its outcome. No generic `nativeBarFs` maintenance facade is admitted.

The reader loads the addon lazily when beginning a future read, so the facade must remain installed after READY and through that later original session. Do not restore at READY or create a second facade on PREPARE/GO. Restoration is once-only after the original disposition is known, and only if the exact cache entry still contains this facade. A foreign replacement is not overwritten; uncertain installation/restoration retains the original references and is not reported released.

## Clock Timer And Lifetime Rules

Worker and parent monotonic domains are independent. The wire carries no parent-domain origin; the worker cannot subtract parent points or claim to have checked that origin. The parent retains its existing domain-inequality check. READY carries the one original worker-domain label, never a replacement on retry.

Preparation remains 120000 ms, helper/status reservation at most 10000 ms, and case-fit 900000 ms; none is renewed by READY, PREPARE, a stop, backpressure or a delayed callback. Use the existing full-millisecond floor and the minimum original local/phase end. Equality with the deadline is late regardless of callback/timer order. Sample/check after synchronous returns as well as awaits; null, foreign or backward time cannot complete FAILED or recover authority. Missing wall/trace time stays unavailable, never filled from a later clock.

For local nanosecond point `t`, let `r = floor((min(original_phase_end, original_local_end) - t) / 1000000)`. Refuse if `r < 1`; otherwise the operation deadline is `t + min(10000, r) * 1000000`. Store that deadline before dispatch and retain it for callback/return/timer comparisons. No asynchronous continuation recomputes a fresh allowance.

Proposed startup timer geometry is one phase slot and one current helper/status-operation slot, borrowing the same reservation for metadata/hash work, with no third helper timer. C2a must verify this against existing contracts and count registrations/segments/clear attempts; if a required action cannot fit, stop for design review. Timer callbacks are generation-bound, referenced and checked against the same original deadline; early wake-up may rearm only its remaining interval. Unknown clear result is not a known cancellation. No native-reader timer changes are included.

Use the existing one private entangled pair with two ports and fixed listeners; no Worker or message traffic. Original default-unreferenced ports must be explicitly referenced and checked before actions. Never unref, transfer, postMessage, replace listeners or use a once-message shortcut. One pair close request and two independent close notifications are different facts. Unknown startup or outstanding callback/return keeps the anchor after a deadline; a Promise or timer is not a substitute. Terminal failure sets the fixed nonzero exitCode distinct from UBSan 86; it never forces `process.exit` or a signal fallback.

## Status Failure And C3 Boundary

- Route original stream error/close to sticky stream-level facts, including `action: null` before any status action exists. A generic stop with the same text does not set stream flags. A stream closes once across action-level and stream-level observations.
- Error affects only the currently started write still awaiting its callback or known boolean return, even if the event names an older action. Keep completed/withheld decisions unchanged. Disposal of in-flight status work waits for both callback completion and a known boolean return, including `false`; unknown return retains it.
- Keep one pending status line. `write(false)` is backpressure, not permission to resend. A callback before return, synchronous throw, pipe error, close and late callback must preserve original outcome uncertainty and the first stop reason independently.
- READY keeps exactly the existing payload: addon protocol, synthetic mode, pins digest and original worker clock domain. FAILED is attempted at most once only with a valid original binding/ordinal, known healthy status stream, known time, lifetime and reserved work. Otherwise withhold it and retain/settle originals as warranted; do not claim parent receipt.
- Parent may send PREPARE after observing READY bytes but before READY's callback/return is known. Keep at most one bounded original envelope, without duplicating raw and parsed large configuration. Check the existing outer binding/setup shape/nonce/configuration-byte bounds, but do not activate its native/bootstrap authority before READY completion and C3's full validation.
- Setup-bearing failure attribution requires the exact accepted binding/state, not stale LAUNCH null setup. If C2 cannot establish the parent-compatible binding for FAILED, withhold the packet; do not invent C3 acceptance to make a failure message fit.
- Process decoder batches sequentially with bounded accounting. Do not silently discard an invalid suffix or queue unbounded asynchronous per-frame work. A second pending PREPARE or out-of-scope GO refuses. Until C3 exists its consumer is sealed, not a fake successful bootstrap/BASELINED implementation.

## Capacity And Work Acceptance

Existing ceilings are unchanged: 65536 bytes per complete wire frame including LF, 32 frames shared in both directions, 60000 configuration bytes, 2375680 retained-buffer bytes and 4259840 transient-buffer bytes. Existing C1 maxima (READY 2214 / FAILED 3287 encoded bytes, diagnostic 9713 / 16384, model-only parent/preparation wrapper 64513 / 65536) are baselines, not free space or proofs for C2's extra state.

Calculate actual schema maxima, overlapping decode/configuration/record/hash buffers, phase-specific lifetimes and bounded snapshots; identify excluded V8/native/module heap explicitly rather than naming buffer arithmetic total process memory. Do not retain a full record/manifest in diagnostic views. No complete records through the generic supplied-data parser and no bound widening to accommodate them. C2 composition must recompute wrapper size; it cannot assume the C1 wrapper has room for another view.

Charge startup/import/cache observations and fixed qualification work for all 24 starts (12 per mode) before authority or hashing/loading. Existing total hash/helper ceilings remain 2147483648 bytes / 131072 operations; the exact new cost mapping is a C2a deliverable, not an invented successful current estimate. Missing initialization, record-parser, metadata or host-profile cost means unavailable. Failure statuses consume the same shared frame/work budget, not a separate emergency allowance.

## Memory Acceptance Matrix

All tests are main-thread supplied/fake-only. Do not run existing effectful suites merely to get a total. Boundary setup must deny operational primitives before importing a target, and source extraction must fail if the private declaration/dependency inventory changes. Negative mutations require a successful control; setup failure is not a detected behavioral regression.

| Family | Required observations |
|---|---|
| Seals | Direct/import entry refuses before argv/env/capability access; no flag/token opens it; private policy refuses first |
| Binding | Missing/extra fields, wrong source/mode/hash, setup on LAUNCH, foreign nonce/session and opaque template preimage handling |
| Frames | Fragmented UTF-8/LF and byte boundaries, canonical shape, direction/ordinal/shared 32 count, invalid suffix and reverse FD4 traffic |
| Pins | Missing/extra/aliased/wrong-role modules or files refuse; aggregate digest does not replace membership; missing reader/host producer blocks |
| Work | Reserve before every parser/hash/import action; bound/exhaustion stops before action; refusal does not refund consumed work |
| Imports | Exact selected-mode eager closure and preserved receiver/result/throw; no actual import, owner enrollment, key creation or signature |
| Cache | Foreign prior/replaced Module/exports, once-only install/restore, facade retained beyond READY, uncertain disposition not released |
| Stream terminal | Pre-first-write close/error, null-action facts, mixed-action close dedupe, old action naming error during another pending write |
| Write outcome | Callback before/after return, false backpressure, throw/nonboolean/unknown/late return, completed/withheld stability |
| Time | Deadline equality and first expired reservation, stop across every await/return, invalid/foreign/backward time, no grace/reset |
| Timer | Two-slot geometry, failed registration, early wake-up, stale segment, one clear attempt and unknown clear retaining originals |
| Lifetime | Partial acquisition, lost references, unknown startup, one pair close/two notifications, no Promise-only settlement |
| PREPARE | Overtaking READY callback/return, exactly one bounded pending input, no hash before budget, no absent C3 call or guessed failure binding |
| Failure | Healthy/closed/error status, absent LAUNCH/time/work, uncertain startup/write and fixed exitCode; no forced exit/retry |
| Capacity | Exact encoded maxima and overlapping buffer/work schedules, oversized metadata/data and model-wrapper overflow refuse |
| Compatibility | Original parent reference accepts valid fake READY and rejects changed wire; actual declarations match independent C1 predictions without making C1 a runtime backend |

## Next Approval And Remaining Gates

Recommended next approval: **C2a pure contracts, shared-validator extraction and memory tests only**. Expected deliverables are the exact schema/export inventory, explicit missing-component outcomes, maximum encoded metadata/buffer/work arithmetic and parent parity tests. No facade/runtime code, effectful module import or operational action is included in that first approval.

Before C2c implementation, settle the record-parser/storage envelope, exact initialization-effect closure, worker metadata/ACL/profile producer and original mode/addon cache restoration plan. Before any operational execution, separately close original build/launch/clock/port/fixture/evidence authorities and host/profile/total-duration qualification; none is supplied by this document or a successful memory test. C3/C4, B4-D/E, 4-B5/B6 and operational 4-C/4-D/4-E remain separate work.

## C2a Implementation And Memory Verification

2026-11-01 JST, supplied-data work only. The subsequent approval covers C2a implementation and memory tests, not C2b connection code or invocation. New files are `test/helpers/unsignedWorkerStartupContracts.mjs`, `test/helpers/unsignedControllerWireContracts.mjs` and the startup memory/boundary tests. Existing controller contracts now import four unchanged schemas and the unchanged outer-frame parser from the shared wire module. Parent allocation-derived binding equality, lifecycle admission, error codes, payload/phase checks, late intake, budgets and public exports remain unchanged. Full strict wire-binding validation is new for C2a only; it is not inserted into parent admission.

The shared module has six pure exports: artifact/setup/READY/FAILED schemas, `readUnsignedControllerFrame` and `validateUnsignedWireBinding`. Startup has only the three proposed pure functions. There is no worker facade, stream loop, runtime backend or persistent ledger. The isolated TypeScript test parser exposes additional syntax predicates/read-only SyntaxKind metadata so the affected controller boundary test no longer imports the compiler with a real clock/system. Cross-realm AST result arrays are normalized before equality checks; the checks themselves remain enabled.

Implemented contract details:

- Supplied startup subject uses a strict initial binding, expected hashes/mode, independent local origin/end, six component states, bounded manifest profile, per-mode 12-start costs and an optional bounded handoff projection. The acceptance-plan digest/case are checked using the existing pure acceptance request. Fixture IDs/template preimages remain absent and deferred, never guessed. A complete supplied projection still has false authority and unavailable runtime producers.
- Unknown hash/helper costs stay null with explicit blockers. Known lower bounds still reject an exhausted invocation. Fixed conservative subject hashing reserves 262144 bytes per start; wire validation reserves 524288 bytes per shared frame, including refused frames, for all 24 starts and 32 frames each. Subject work is checked before binding/plan hashing. These reservations cover the pure checks, not missing producer/initialization work, CPU timing or measured runtime I/O.
- Envelope validation checks canonical LF/Unicode/bytes, exact supplied binding, direction, next ordinal/shared spent count, empty LAUNCH, exact READY/FAILED shapes and pre-GO failure phase. The parent still learns a valid READY clock label; C2a separately compares it with its supplied original local label. Expected counters/binding are caller-supplied model context, not an independent lifecycle or grant.
- PREPARE validates only the base/setup shape, nonce and 60000-byte configuration limit. It returns a pending-C3 summary, not the full configuration or a bootstrap/ownership result. No arbitrary configuration is passed to C3 or the native reader. FAILED after setup must use that exact supplied setup binding and prepare phase.
- READY handoff requires completed callback and known boolean return, including false backpressure; sticky stream close/error prevents handoff without relabelling known outcomes. This is a stateless projection; original event ordering, stream identity/close dedupe and lifetime ownership remain C1/C2b/d work.
- Capacity describes maximal diagnostic fields and per-payload variants separately from buffer reservations. The single-record parser is unavailable, full-record retention is false and parent-wrapper calculation is explicitly not yet done. Do not add this view to the C1 comparison wrapper without a new capacity calculation.

| Measurement | C2a supplied reservation |
|---|---|
| Diagnostic plan/envelope maximum | 4371 / 16384 bytes |
| READY / FAILED frame ceilings, including LF | 1912 / 3287 bytes; READY has null setup |
| Retained buffers | 393216 / 2375680 bytes |
| Transient buffers | 4259840 / 4259840 bytes |
| Shared frames / configuration | 32 / 60000 bytes, unchanged |
| Supplied example invocation hash/helper totals | 412386280 bytes / 196 commands; not runtime measurements |
| Lifetime/timer projection | One pair/two ports, one phase slot and one operation slot; none acquired |

Fresh verification used Node 24.18.0 with `--test --test-isolation=none`, one file per invocation, so the test runner did not launch child test processes. Target modules load only after effect tripwires; compiler parsing uses a context without Node system/real clock. No operational test suite was run.

| Memory/source file | Passed tests |
|---|---:|
| New worker startup | 69 |
| New startup boundary | 4 |
| Existing controller | 209 |
| Updated controller boundary, including shared wire | 14 |
| Existing C1 preparation / boundary | 158 / 5 |
| Existing transport/lifetime model | 250 |
| Existing single-parent composition | 70 |
| Total, eight files | 779 |

The new tests cover all 24 case/mode bindings, extra/missing/mismatched fields, exact hash/helper/frame byte boundaries, unknown costs, pre-hash reservations, no refund on decode failure, C3 deferral, handoff uncertainty, maximal diagnostics and effect interception. Six behavioral mutations and fifteen static boundary mutations are detected with successful controls; setup failures are not counted as behavioral detections. Full unit, real streams/timers, fragmentation-to-dispatch, native/module imports and operational qualification were not tested. C2b/c/d and the fixed-record/initialization/host producer gates remain pending. No commit/push or Dot/configuration changes are made by this checkpoint.

## C2a Independent Review And Corrections

2026-11-01 JST. Two independent read-only source reviews covered (1) startup contract, handoff/work accounting and capacity, and (2) test coverage, mutation controls, effect guards and isolated parser changes. Neither reviewer ran target code or tests. The first found no actionable contract defect. The second found three P2 coverage gaps, corrected in the two new tests only:

1. **Self-derived guard inventory.** Probing only entries collected by `block()` stopped checking a constructor if its own denial-list entry was removed. Add an independent required-sink inventory, including original network constructors/listener prototypes, clocks, timers, workers, signing, native load and mutation sinks. Verify every required entry before any probe. Four source-only mutations remove the Server/Socket guard or its independent inventory entry; the boundary guard rejects all four without importing the mutated harness or touching a real sink.
2. **Masked handoff decision gate.** Previous pending/uncertain examples had other blockers. Add otherwise-complete supplied handoffs changing only decision to pending or uncertain; the supplied plan remains complete but handoff remains incomplete. A removed-decision behavioral mutant is now detected independently of callback/return, cost and stream flags.
3. **Missing setup-bearing FAILED branch.** Add an exact supplied setup binding with prepare-phase FAILED as a positive control. Refuse launch phase, stale null setup, mismatched setup hash and stale expected binding separately. A launch-only phase mutant fails the positive assertion; setup failures are not counted as successful mutation detection.

The test reviewer re-read the corrections and found all three closed, no masking in the new controls and no remaining actionable findings. No contract/helper logic, public surface, wire payload, budget, capacity, producer seal or operational policy changed during correction. Separate textual comparison against `0ca489a` confirms all five shared schemas and the renamed outer-frame parser retain the original definition text.

The implementing session reran all eight selected files with Node 24.18.0, one file per `--test --test-isolation=none` invocation: **783 pass, 0 fail, 0 skips**. Startup is now **72**, startup boundary **5**; controller/controller boundary/C1/C1 boundary/transport/parent composition remain 209/14/158/5/250/70. New coverage detects **8 behavioral / 19 static mutations** with successful controls. Diagnostic/frame/buffer measurements remain 4371, 1912/3287 and 393216/4259840 bytes respectively; the previous 779 and 69/4 counts are historical implementation evidence.

Dot remains PAUSED with its full configuration hash unchanged. No real ports/clocks/timers, build, test-runner child processes, native load/read, fixture/signing/data operations, MCP registration, production activation or push was performed. Full-unit and operational qualification remain unrun. C2b/c/d and later producer gates are not unlocked by this review.

## C2a Commit Review Correction

2026-11-01 JST, memory-only. The commit review of `fba58d5` compared the code with this design and reran it in archive copies. The 25 related files (1430 tests) passed in every condition: Node 24 three times, linux/win32 spoofs, Node 20.19.6 and 26.12.1, isolation=none and CRLF. The full unit suite passed 4955 of 4957 tests on Node 24 and Node 20 (0 fail, 0 cancelled, 2 existing skips). The shared definitions matched `0ca489a` text and the capacity table above. The review found no contract defect for valid startup paths, but did find the following:

- **Untested gates (P2).** Removing any one of these checks left all 72 startup tests passing:
  - plan completeness inside the handoff projection, which was masked because every incomplete-plan example also had an incomplete handoff;
  - PREPARE base-binding equality;
  - the initial null-setup checks for LAUNCH, READY and the startup subject.
  The independent review of this correction found more masked checks: the next-ordinal check and LAUNCH's ordinal 1 (each hid the other), the withheld write and callback checks, manifest bytes above record bytes, and the preparation-end overflow (hidden by the local-end check). The handoff READY pins, LAUNCH's spent count, the expected kind and direction, schema strictness for the envelope, its expected context, the handoff and the PREPARE payload, and the attribution of one unknown cost to its own modeled total were also untested (P3).
- **Frame-count context (P2, from the helper review; existed before this correction).** Only LAUNCH checked its counters. READY, FAILED and PREPARE were accepted with counts no startup can reach, including worker status before a spent LAUNCH, against Startup Sequence step 3.
- **Frame limit checked after decode (P3).** With 32 frames spent, a malformed line was refused with a decode code, and a 33rd wire charge was debited although the plan reserves only 32 per start.
- **Withheld READY with a pending PREPARE (P3).** The projection accepted and echoed it, although PREPARE follows observed READY bytes, which a never-started READY cannot have produced.
- **Boundary inventory gaps (P2 after review).** The text-based export inventory missed `export{...}`, `export*from"..."` and `export/**/function`, and side-effect imports escaped the import inventory, for both the startup and shared wire modules.

Corrections, in the startup helper and its two tests only:

- `validateUnsignedWorkerStartupEnvelope` refuses `frame_capacity` first, before the wire-reservation check and any decode. That refusal carries no `startup_work` debit, so a start never takes more than its 32 reserved wire charges. Refusals inside the frame budget keep their debit as before. This follows the parent's `appendLate()` order. The parent's normal `accept()` is unchanged: it still decodes first, so a malformed 33rd line is refused there with a decode code. Both refuse.
- Envelopes need counts a startup can reach:
  - READY is worker ordinal 1 with at least 1 spent frame;
  - PREPARE is parent ordinal 2 with at least 2;
  - FAILED is worker ordinal 1 or 2 with spent frames at least its ordinal;
  - a setup-bearing FAILED is ordinal 2 with at least 3.
  These are lower bounds. Caller-supplied counters remain model context, not an independent lifecycle.
- A withheld READY with a non-null `pending_prepare` refuses `handoff_outcome`.
- Every gate above now has a test that changes one condition from a passing control. Each gate also has a behavioral mutation trial, and looped cases get one trial per case. The frame-limit test compiles the three wrong placements (after the decode as in `fba58d5`, after the reservation, and charged inside the try) as negative controls.
- The boundary guard builds both inventories from syntax, as the controller `guard()` does. Imports must be named imports, exports must be export-modified declarations, and export statements or re-exports are refused. The frame-limit order is pinned inside the envelope function.

These rules replace the earlier checkpoints' statements that every refused frame carries the wire debit, that review left no actionable contract defect and that no helper logic changed, together with their test and mutation counts. Public exports, schemas, wire payloads, budgets, capacities (diagnostic 4371 / 16384, READY/FAILED 1912 / 3287, retained 393216, transient 4259840) and parent behavior are unchanged.

Not adopted:
- The handoff decision `pending` covers both C1's planned and started READY. A supplied projection can therefore pair a planned READY with a pending PREPARE that C1 would refuse. Distinguishing the two needs a started fact in the schema, which belongs with the original event ordering in C2d. Such a handoff stays incomplete.
- The `pending_prepare.bytes` minimum stays 1. That value grants nothing.
- The counts stay lower bounds. A null-setup FAILED with 3 spent frames is accepted, although the parent would require prepare phase once PREPARE is counted. Whether a counted frame was a PREPARE is frame history, which belongs to the C2d composition. That composition must not offer such a FAILED.
- Running several effect-denying files in one isolation=none process blocks module resolution of the next file. This already happens with the controller and C1 harnesses. CI uses the default process isolation.

Verification:
- Startup 85 tests and startup boundary 5.
- 41 distinct behavioral mutations (49 trial runs) and 28 static mutations are detected with successful controls.
- Of the new behavioral tests, 4 fail on `fba58d5`: the frame counts, the withheld PREPARE, the frame-limit order and the trial list. The single-condition coverage tests pass there and detect their mutants instead.
- 29 further independent mutants, run outside the test file, are each detected by a dedicated test.
- The 25 related files (1443 tests) pass in all nine conditions. The full unit suite passes 4968 of 4970 tests on Node 24 and Node 20 (0 fail, 0 cancelled, 2 existing skips).
- Two read-only reviewers covered helper semantics and tests/mutations; their findings were adopted as described.
- The helper re-review also found a C1 issue that predates this correction. After a READY is withheld by a stop, the C1 preparation model numbers the FAILED write as worker ordinal 2 (`statuses.length + 1` still counts the withheld READY), while the parent expects ordinal 1. This correction does not change C1; the fix needs its own approval.

Dot remains PAUSED. No real port, clock, timer, native, fixture, signing, data, MCP registration, production activation or push operation was performed. C2b/c/d remain pending.

## C2b Implementation And Memory Verification

2026-11-01 JST, on `69e13f1`. The later approval permits connection source plus memory tests only. New `native/native_bar_fs/test_unsigned_cohort_worker.mjs` has no static imports and exports only the zero-argument `runUnsignedCohortWorker`, which always throws. Module evaluation calls that same refuser unconditionally. The private composition root begins with an unconditional operational-policy refusal before clock/capability access. No argv/env flag, data packet or model result opens either entry.

### Private Connections

- One invocation is spent once, even after retirement. Private session/retained/proof maps keep original objects, not serialized capabilities. No caller factory/backend exists. The C1 model is not imported as a runtime backend and the parent B2 owner is not duplicated.
- After the closed policy, source captures the three fixed builtin namespaces synchronously (worker_threads/net/timers), then acquires the lifetime pair before awaiting the four fixed pure helper imports. Every import continuation rechecks original time, references and stop. API choices were checked against the [Node 24.18 process API](https://nodejs.org/download/release/v24.18.0/docs/api/process.html#processgetbuiltinmoduleid) and [Socket constructor API](https://nodejs.org/download/release/v24.18.0/docs/api/net.html#new-netsocketoptions); documentation is not host or FD qualification.
- Private FD wrappers use only inherited FD3 commands and FD4 status. FD4 also watches readable reverse traffic and refuses it; there is no connect/listen, IPC, reopen or destroy fallback. Stream slots are frozen after acquisition, write/end methods are original captures, and handlers require the original stream. Error/close handlers precede any write. A stop during listener installation prevents the next installation.
- Original MessageChannel ports are observed unreferenced before listeners/ref. Fixed message/messageerror/close listeners and one explicit ref per port are used. Before actions, both original ports must still be referenced and their method identities unchanged. Partial/unknown acquisition retains known originals without retry; retained scope metadata alone never proves a live anchor.
- One local monotonic origin fixes the 120000 ms preparation window within the existing 900000 ms case-fit end. The private wall-stamp connection brackets the supplied read separately from post-format validation and emits UTC/JST with adjustment uncertainty; tests use synthetic primitives only. Wall/monotonic failures never recover dispatch authority.
- One phase and one operation timer slot use referenced original handles, immutable deadlines and segment identity. Early wake-up clears its original handle once and rearms only the remaining interval. Unknown registration/clear retains the original slot and prevents replacement. Current operation use is status writes; borrowed C2c read/module work remains unavailable rather than adding a third timer. Timer-only/Promise-only liveness is not accepted.
- Incoming complete lines reuse the existing decoder/shared validators. Shared frame exhaustion refuses before further decode/hash reservation, work is reserved before interpretation, and stopped traffic is discarded with a saturating byte count/unknown flag. A valid prefix does not hide a bad suffix. Selected mode never changes to fit a packet.
- C2c work reservation, startup qualification/disposition and C3 consumption remain explicit unavailable functions. The source has no proof issuer and no native/build-record/compiled-owner import. Tests alone insert fake original proofs in the extracted private map; they do not expose an operational injection interface.
- READY planning retains one original status record. Ordinal/frame count are consumed immediately before the original write call, not at planning. Withheld READY therefore leaves ordinal 1 for FAILED; the separately noted C1 model bug is not modified. Callback and known boolean return, including backpressure false, are both required. Unknown returns keep original work/anchor; error affects only the in-flight write, never a completed one. Deadline equality is late in either callback/timer order.
- At most one early PREPARE is kept as a bounded raw line plus digest/byte summary; it cannot reach C3 before READY is actually started and completed. C3 remains closed. Because C2b cannot prove full setup/configuration acceptance, PREPARE-related stop withholds FAILED rather than inventing a setup-bearing phase/binding.
- Stop preserves the first reason and sets only fixed exitCode 1, never force-exit/signal/kill. FAILED is at most one bounded attempt with known original time/work/references/status binding. An uncertain predecessor withholds another protocol write. Original stream end is attempted once after known write disposition, and EOF/close events are awaited. Unknown startup disposition, write return, timer clear, stream end or pair close stays retained; no grace timer/retry claims cleanup. Pair close is one request followed by two independent close facts before retirement.

The unavailable policy/producer functions remain closed even though the plumbing exists. This is not live startup qualification, saved evidence, original native release or proof of real process lifetime.

### Memory Evidence And Limits

New `nativeBarAdmissionUnsignedWorkerConnection.test.mjs` extracts the actual private declarations with an isolated syntax parser. It supplies only invented pipes, MessageChannel ports, clocks, referenced timer handles, work ledgers and startup/disposition proofs; it never imports/runs the worker facade against real primitives. The entire module body, exported refuser and private policy are additionally checked to refuse before process/capability getters. All target dependencies load after effect guards, including direct Socket/Server constructor and listener-prototype paths. `nativeBarAdmissionUnsignedWorkerConnectionBoundary.test.mjs` pins the entry, capability/import inventory and unavailable producers under LF/CRLF.

The two older C1/C2a boundary tests no longer require the approved worker file to be absent. They now verify its unchanged unconditional refusal and evaluation seal. Their contract/model code and all shared wire rules are untouched. The known C1 withheld-READY numbering issue still needs separate approval; no C1 repair is claimed here.

| Verification, Node 24.18.0, separate isolation=none invocations | Passed tests |
|---|---:|
| New private worker connections / boundary | 58 / 4 |
| Existing C2a startup / boundary | 85 / 5 |
| Existing C1 preparation / boundary | 158 / 5 |
| Existing controller / boundary | 209 / 14 |
| Existing transport/lifetime / parent composition | 250 / 70 |
| Total, ten files | 858 |

Seven behavior-changing mutants are detected after successful unmodified controls: unknown-return lifetime, premature ordinal consumption, stale timer segment, one-port close, missing pre-decode work reservation, missing dispatch frame check and missing completion-reference checkpoint. The completion test first reproduced a READY qualified after a fake write dropped a lifetime reference; completion now rechecks original references/timers/deadlines before qualification while still retiring physically known callback/boolean outcomes. Ten source-boundary mutations detect opened entries/producers/effects or weakened lifetime gates. No mutation setup failure is counted as behavioral evidence.

An independent maximum covers every connection view field (3260 encoded bytes); combined C2a plan/envelope plus that connection reservation is 7645 / 16384 bytes. The private diagnostic encoder enforces 16384. These are encoded metadata reservations, not V8 heap/native memory/process-liveness measurements. Raw command/configuration/stream/port/timer objects are absent from diagnostics. Existing retained/transient and native-work ceilings, wire payloads, shared 32 frames and status reservations are unchanged. Parent-wrapper capacity is still not calculated, and C2d/full preparation composition is not completed by one positive parent READY check.

No real clock/timer/port, test-runner child, native read/load, build, fixture/signature/data operation, MCP registration, production activation, commit or push was performed. Dot stays PAUSED with its full configuration hash unchanged; judgment/notification conditions are unchanged. Real module qualification, helper-lane production, host/profile/FD readbacks, C2c record parsing, C3/C4 and later GO/release/acceptance remain separate gates. Independent C2b review is still pending.

## C2b Independent Review And Corrections

2026-11-01 JST, user-requested review of the eight uncommitted C2b files on `69e13f1`. Two read-only reviewers separately covered the private connections and the fake-only tests/source guards. Their review and delta reviews were static only; the implementing session ran the tests. Both final delta reviews report no remaining actionable findings. This supersedes the preceding initial checkpoint's review status and test/mutation counts, not its operational seals.

Four P2 connection findings were reproduced before correction:

1. An early phase-timer callback at 1 ms could reuse that point after its synchronous clear returned at 50001 ms, registering 119999 ms instead of the original deadline's remaining 69999 ms. Each registration now samples after work reservation, including after clear. A clear returning at the original 120000 ms deadline cannot register another timer.
2. A fake FD3 constructor returning at the deadline still allowed FD4 construction. The original FD3 is now retained before a fresh checkpoint; no FD4 is acquired after that checkpoint refuses.
3. A stop during the early timer clear left its inactive, known-cleared slot stranded and retained the lifetime pair. After clearing the installing flag, deferred cancellation now finalizes the original slot and resumes stop progression, without repeating the physical clear or inventing a new handle. The regression observes one clear, one handle and one pair close request followed by both close facts.
4. FD3 itself could be acquired after the preceding checkpoint expired or a lifetime reference was lost. A checkpoint now precedes acquisition flags and construction. Expiry/reference-loss regressions acquire no stream; a previously stopped session remains refused.

Five P2 test-boundary/coverage findings were corrected:

- Low-level `fs.read/readSync/readv/readvSync` and descriptor-backed `createReadStream` are denied before helper imports. An independent required-sink inventory precedes every probe; a pre-guard readSync sentinel proves no real descriptor read is probed. The allowlisted UTF-8 source loader normalizes its buffer request through the path-checked UTF-8 read, without reopening low-level reads.
- The unavailable qualifier's entire four-statement AST body is pinned, rather than only its terminal throw; a direct call verifies the precise rejection. An early return mutant is rejected.
- Each of the four fixed awaited imports must be a direct awaited assignment immediately followed by the original checkpoint. Four independent deletion mutants detect a missing continuation check; the extracted-declaration harness does not claim to run those imports.
- Six registered but invalid proof records (owner, binding identity, consumed bit, selected mode, addon protocol and native mode) refuse READY and retain unknown startup/lifetime. Each has a predicate-removal behavioral control; an unregistered foreign object is a separate case.
- Fake FD3/FD4 constructors validate the complete fixed option objects before any write. Wrong-FD and wrong-direction mutants are detected even when no status write occurs.

Verification uses Node 24.18.0, one file per `--test --test-isolation=none` invocation: connection **71**, connection boundary **4**, startup **85/5**, preparation **158/5**, controller **209/14**, transport **250**, parent composition **70**; **871 passed**, no failures/cancellations/skips. The connection suite detects **21 behavioral mutants**, each after a successful control and unique syntax-checked source substitution. Boundary tests detect **21 static mutations** (15 worker-source and 6 low-level guard/inventory deletions). A mutant's setup/anchor error is not accepted as coverage.

The independent connection maximum remains **3260 bytes**, combined startup/connection diagnostics **7645 / 16384**. There are no schema, shared helper/model, parent wire, frame/work/native/buffer-limit or judgment/notification changes. The C1 withheld-READY ordinal defect is still separate and unmodified. C2c record parser, startup/disposition/work producers, C2d/full preparation and host/operational qualification remain unavailable. No full unit/effectful suite, real port/clock/timer, child process, build, native read, fixture operation, signing, real-data operation, MCP registration, production activation or push is performed. Dot remains PAUSED and its full configuration SHA-256 is unchanged.
