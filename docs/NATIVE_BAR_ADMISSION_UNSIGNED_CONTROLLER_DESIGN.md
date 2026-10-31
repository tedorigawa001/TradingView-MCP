# C-C1b-4 Execution Connection Design

Status: **4-A and 4-B1 corrected after second independent reviews; 4-B2 composition, 4-B3-A contracts and unexecuted 4-B3-B/4-B3-C private connections implemented under separate approvals; host/profile qualification, 4-B4 through 4-B6 and 4-C through 4-E remain blocked**, 2026-10-29 JST. Design baseline: `2fd35f8`, including the C-C1b-3 independent-review corrections; 4-A starts from reviewed design commit `d3550a1` and its second corrections from `c29fc04` (committed as `f0d3040`); 4-B1 starts from `f0d3040` and its second corrections from `b53a50b`; 4-B2 starts from `b5eb7ea`; 4-B3-A starts from `63ff06b`; 4-B3-B starts from `c1ade36`; 4-B3-C starts from `712112c`. This specifies the missing controller and worker assembly for the [unsigned execution design](NATIVE_BAR_ADMISSION_UNSIGNED_EXECUTION_DESIGN.md) and [acceptance plan](NATIVE_BAR_ADMISSION_UNSIGNED_ACCEPTANCE_PLAN.md). The [4-A record](#4-a-pure-contract-implementation) and [4-B2 record](#4-b2-memory-composition-implementation) cover memory/source tests only; the [4-B1 record](#4-b1-c0-only-memory-signing) additionally covers approved published-vector signatures in memory. No build, OS signing, signature file, operational child process, native read, fixture, output relocation or cleanup was performed. Dot remains PAUSED; market/scenario/judgment/notification/mail and product retention rules stay unchanged.

The [4-B3 detailed qualification design](NATIVE_BAR_ADMISSION_COHORT_QUALIFICATION_DESIGN.md) refines fresh-build provenance, the fixed private evidence namespace, cohort-owned index binding and original clocks from reviewed 4-B2 commit `63ff06b`. Its separately approved [4-B3-A implementation](NATIVE_BAR_ADMISSION_COHORT_QUALIFICATION_DESIGN.md#4-b3-a-pure-contract-implementation), [4-B3-B private connections](NATIVE_BAR_ADMISSION_COHORT_QUALIFICATION_DESIGN.md#4-b3-b-private-unexecuted-connections) and [4-B3-C clocks/timers](NATIVE_BAR_ADMISSION_COHORT_QUALIFICATION_DESIGN.md#4-b3-c-private-clock-and-timer-connections) cover pure contracts and unexecuted connection code with memory tests. The [4-B3-B review corrections](NATIVE_BAR_ADMISSION_COHORT_QUALIFICATION_DESIGN.md#4-b3-b-independent-review-and-corrections) and [4-B3-C review correction](NATIVE_BAR_ADMISSION_COHORT_QUALIFICATION_DESIGN.md#4-b3-c-independent-review-and-correction) preserve the scope and limits. 4-B3-C remains unused with real clocks/timers; host/profile qualification and all invocation remain blocked, with no public seal opened.

## Scope And Current Gaps

Next-step design, 2026-10-31 JST: [B4-B private parent connection details](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md) on reviewed P3 commit `87846e9`, reviewed as `8c9bba1`, cover ownership, single admission ledger, fixed command reservations, stop-only clock faults, terminal facts, private phase/helper supervision and launch/write/close bindings. The later separately approved [B4-B1 pure implementation](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md#b4-b1-pure-contract-implementation) adds bounded reservation/checkpoint/callback/terminal/counter/work contracts and B2's narrow stop-only clock-fault model entry. Nine main-thread files pass 795 memory/source tests, with a 7654-byte terminal ceiling and 54741-byte combined coordinator reservation under unchanged limits. This neither implements private connections nor opens the public execution root; independent implementation review is pending. B4-B2 onward remain separately approved slices. B5 actual evidence/readback/setup and B6 original allocation producers, the new worker and host/work-plan qualification remain unavailable, not replaced with model inputs. Dot and all judgment/notification conditions remain unchanged.

The later [B4-B1 independent review](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md#b4-b1-independent-review-and-corrections) resolves three terminal-coherence and two static-boundary findings, with no new findings in either scoped re-review. The nine-file memory/source selection passes 803 tests. Schema/export/capacity/work/time limits and runtime seals remain unchanged; the initial implementation's 795 tests above remain historical. Review/commit approval does not include B4-B2 connections or operating approval.

The later [commit review of `cda94a7`](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md#b4-b1-commit-review-corrections) fixes four terminal-coherence gaps and the authority-guard gaps found by review, documents one reference-transport difference and leaves the sub-millisecond checkpoint instant as an open B4-B2 decision; the nine-file selection passes 812 tests with unchanged limits and seals.

Latest 2026-10-31 JST update: the separately approved [P3 memory verification](NATIVE_BAR_ADMISSION_CANCEL_LATE_FRAME_DESIGN.md#b4-p3-memory-verification) on `c9524b4` adds 41 composition cases; seven main-thread memory/source files pass 669 tests on Node 24.18.0. It replays independent transport/B2 model predictions for original CANCEL, stop/deadline and late-input interleavings, frozen evidence and retained lifetime facts, without joining their ledgers or granting runtime authority. Test and document changes only; capacities, models, operational seals and judgment/notification conditions remain unchanged. The separate [P3 independent review](NATIVE_BAR_ADMISSION_CANCEL_LATE_FRAME_DESIGN.md#b4-p3-independent-review) reported no actionable findings; actual worker no-op/runtime connections and B4-B implementation approval are still pending. The following P1/P2 updates describe their earlier scopes and results.

2026-10-31 JST update: the [pre-connection CANCEL/late-frame design](NATIVE_BAR_ADMISSION_CANCEL_LATE_FRAME_DESIGN.md) was approved and [P1 implemented/tested in pure models](NATIVE_BAR_ADMISSION_CANCEL_LATE_FRAME_DESIGN.md#b4-p1-memory-implementation). The original reserved ordinary CANCEL can start after normal RELEASED only under the narrow original write gates; cleanup/FINALIZE waits for its known completion. No new deadline/ordinal/wire/evidence state is added. The separately approved [P2 memory implementation](NATIVE_BAR_ADMISSION_CANCEL_LATE_FRAME_DESIGN.md#b4-p2-memory-implementation) now validates diagnostic-only late frames with shared normal schemas and one original protocol ledger; a narrow original stopped-case entry needs no clock point, while all general timed gates stay unchanged. Late traffic cannot promote release/evidence/PASS or revise frozen reports, and invalid late traffic or a receive fault refuses capture and blocks new shutdown writes, while a normal rejection or exhausted capacity only freezes intake and keeps the original shutdown lane. Explicit capacities fit unchanged envelopes. After the [review corrections](NATIVE_BAR_ADMISSION_CANCEL_LATE_FRAME_DESIGN.md#b4-p2-review-corrections) and [independent review](NATIVE_BAR_ADMISSION_CANCEL_LATE_FRAME_DESIGN.md#b4-p2-independent-review), seven main-thread memory/source files pass 628 tests. P3 composition and the actual worker no-op/runtime remain pending and separately gated.

2026-10-31 JST update: the separately approved [B4-A lifetime-model correction](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md#b4-a-lifetime-model-correction) now models default-unreferenced ports, explicit reference qualification and per-action rechecks, and one entangled close call with two independent notifications. It supersedes the historical model-gap description below in memory only; its [independent review](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md#b4-a-lifetime-correction-independent-review) also corrects lost original close facts and method-ambiguous source guards. No real lifetime anchor or B4-B/C/D connection is added or approved.

The [4-B4 worker/transport detailed design](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md), originally based on `930267a` and implemented/reviewed on 4-B3-C second-review `c1207aa`, separates pure contracts, private parent transport, sealed worker preparation, original query/shutdown and memory composition into B4-A through B4-E. The separately approved [B4-A implementation](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md#b4-a-pure-contract-implementation) and [review corrections](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md#b4-a-independent-review-and-corrections) cover pure transport/lifetime models and capacity tests, with the required READY domain only in the still-sealed v2 models. The retained-lifetime reference is modeled, not allocated. The later [design review corrections](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md#b4-design-review-corrections) carry the `c1207aa` timer rules into B4-B and correct the port-reference semantics, recording the current B4-A lifetime model's independent per-port close as a model gap. They assign the command-pipe phase timer, shutdown CANCEL/close-only lane and command close bookkeeping to B4-B, while the 4-B5 row keeps the observer, creation, evidence-write and removal timers and closes. The [second review corrections](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md#b4-a-second-review-corrections) fix the committed B4-A model's callback clock/deadline, shutdown-plan, settlement-anchor and receive-encoding defects and tighten its test boundary. No runtime, worker, native, signer or operational entry is changed/opened; B4-B onward and real clock/timer/port/worker operations remain unapproved.

The target remains twelve negative cases per mode, normal then UBSan, at most 24 exclusively new unsigned fixtures under `/private/tmp`, and one live fixture, one case worker and one observer at a time **within one supervisor**. Nothing scans for processes, so before any operational run the user confirms that no worker or observer from an earlier, lost run is still alive. Existing C-A/C-B/native protocol 6, case codes/causes, work limits, original release gates, the plan's continuation rule and non-recursive cleanup assumptions do not change. C-C2 positive acceptance, C1 signing, signed witness files, production data, MCP registration and production activation are excluded.

Current sources are not an executable cohort:

| Existing component | Reuse | Missing connection |
|---|---|---|
| `unsignedBuildPlan.mjs`, `build_unsigned.mjs` | Fixed isolated build, input/artifact hashes, ACL checks, retained-output record | The CLI ends without a live build capability, and the corrected wrapper has not been rebuilt. The runtime module closure (zod's runtime JS, the Node binary) is unpinned, and linker/SDK-settings hashes may be null |
| `unsignedInertAdapters.mjs` | Private observer, creation, writer, worker and removal components | `preparedRuns` has no setter. The qualification and clock/window callbacks (`remainingPhaseMs`, `actualParentStamp`, `workerClockDomain`) and the cohort driver are absent. Index writes are validated against the first case's run (`checkWriter` calls `checkpointEvidence(w.run)`). `protocol.finishTeardown` is never called, so FINALIZE would refuse. Child and pipe timers are unref'd, and the oracle helper is imported lazily at GO |
| `test_unsigned_worker.mjs` | Sealed worker entry | It always refuses; no command dispatcher or EOF/parent-loss path exists |
| `unsignedExecutionContracts.mjs` | Strict v1 protocol, original baselines, ordered receipts and readback | No launch/ready exchange, preparation-failure message, post-stop cancellation lane, evaluation-summary transport or teardown window. The v1 binding carries one representative `js_sha256` |
| `jointUnsignedAcceptanceContracts.mjs` | Fixed recipes, negative-case checks, live-list-based supplied ownership model | Native facts and source-constrained inferences must be projected without substituting expectations |
| Fixed memory/unsigned oracle helpers | Original grant consumption and fixed published test material | The fixed owner signs any phase as soon as a request arrives, and its boundary test pins exactly one key and one sign site. C-C1 needs a C0-only restriction before any signing, not merely a post-hoc request-count check |
| Native reader and NAPI surface (`native_bar_admission.inc`, `nativeBarAdmissionJointReader.ts`) | Original read path and bounded diagnostic | `admission_expected_binding` carries no mismatch location: ancestors, the fixture parent, data, witness and markers share it. The entries-to-usage mapping behind U3's cause is private reader code. The reader's deadline timer is unref'd |

The saved 436 artifacts and their build record remain the earlier build, not an execution of `2fd35f8`. They must not become a new run's ownership or approval evidence. Current native objects have no code signature and are not eligible for the proposed arm64 execution path. No existing seal is opened by accepting this document.

## Approval Decisions

Record the user's choices separately from runtime correlation metadata. A saved manifest, hash, environment variable, command flag or approval-looking JSON is not human approval or a reusable execution capability.

Selecting an operation is never a runtime flag, environment variable or interactive prompt. Each operational unit is a structurally separate entry whose policy (signature profile, build-only or build-to-cohort, termination policy, total time bound) is a reviewed code constant. An entry refuses unconditionally until its own reviewed unseal commit, made only after the user approves that unit. The build-only signature-profile entry imports nothing from the cohort runtime.

| Decision | Proposed scope | Without explicit approval |
|---|---|---|
| Run location | The user starts 4-C, 4-D and 4-E in their own terminal | The agent never launches an operational unit. Its shell timeouts kill the process tree, which would be an unapproved signal and a supervisor loss |
| Source implementation | Pure contracts first; later, reviewed private connection code behind sealed entries | No runtime caller or capability mint |
| Existing isolated root | User manually preserves/relocates the old `build/b3cc-validation/` out of the fixed location, or uses Finder Trash, before each operational invocation | Existing root blocks; agent performs no move, deletion, discovery or adoption |
| Fresh build | Exclusively recreate that fixed root with corrected, reviewed sources and private scratch, once per operational invocation | No compiler or output creation |
| OS ad-hoc signature | Linker's local ad-hoc signature on only the four Mach-O objects newly built by each approved invocation (4-C, 4-D and 4-E each build their own four); no signing identity, certificate, notarization or general signing service | No signature-capable build and no native execution |
| Fixture-free probe | 4-D: observer anchor-only run, worker launch with addon load/protocol check/READY, pipe EOF and exit, UBSan runtime load; no fixture, key or cleanup capability | No observer, worker or addon execution |
| Native cohort | Twelve cases/two modes, original read path, bounded independent observer, up to 24 new fixtures and private evidence files, within a stated cohort wall-clock bound | No fixture, addon load, observer or worker execution |
| Checkpoint signature | Fixed public RFC 8032 material, C0 in worker memory only, at most once in each fixed-owner case; U0 creates no private key | No private test key or C0 signing |
| Cleanup | Only the original run's exact recorded fixture entries, after the original release and fresh ownership checks | Retain fixtures; do not start a cohort that would knowingly block after its first retained fixture |
| Child termination | Optional TERM/grace/KILL of only this run's original worker or observer child object, separately approved and fixed as a code constant | No signal calls; retain the child reference and report user action needed |

OS code signing and checkpoint signing are different operations. Approval for one never enables the other. The current unsigned C-C1b-3 build-only entry stays unsigned unconditionally; no caller-controlled path or permissive fallback switches the signature policy. The recommended first implementation needs none of the operational approvals above.

4-E needs the complete bundle: fresh build, OS ad-hoc signature, the fixture-free probe checks repeated in the same invocation, native cohort, checkpoint signature, cleanup policy, termination policy (including "none") and the total time bound. If any one is missing, its entry stays sealed. It never runs a prefix of the cases, such as the two U0 cases followed by a stop at the first fixed-owner case.

## Fresh Build And Live Capabilities

Use the fixed layout, not a new arbitrary output-root option. The old root must be absent before a new build; moving it is a user-controlled prerequisite, not automatic retention management. Never scan Trash, archived roots or temporary directories for reusable outputs. Failure leaves the newly created root in place and blocks another attempt until a separately resolved disposition.

A later reviewed internal builder must run in the same supervisor process that owns the probe or cohort and return an opaque, non-serializable build reference only after compilation, qualification and build-record readback succeed. The existing standalone build-only CLI does not return that reference and cannot supply it on a subsequent invocation. Refactoring its internals for this one private consumer requires a new boundary review; importing `build-record.json` is not the alternative.

The reference captures:
- source commit, dirty-tree status and actual input hashes;
- the complete runtime module closure actually loaded by the supervisor, worker and helpers, including `node_modules` packages such as zod's runtime JS, not only declarations;
- the Node binary's realpath and hash, and Node/ABI/CPU;
- compiler/linker/header/SDK/runtime pins;
- the exact per-mode JS set and all artifact identities/hashes.

A nonclean source tree is identified by its actual complete source snapshot and status hash, not described as reproducible from HEAD alone. The complete effective build and runtime inputs must remain unchanged before/after each mode and at the final qualification. Missing tool identity is a blocker, not a null pin that passes; the new builder does not inherit the 2fd35f8 wrapper's nullable `linker_sha256`/`sdk_settings_sha256`.

Pin checks have a cost budget. Full content hashes run only at fixed points: build qualification, before each mode's first fixture and at final qualification. Other checkpoints compare cheap identity pins (device, inode, size, mode, change and modification times) of the pinned files. The worker imports every helper it can need eagerly at startup, before its pin check and before READY, so no working-tree module is first read after GO. A same-UID edit between a cheap check and its use remains inside the stated threat model.

ACL qualification uses the fixed local `/bin/ls -lde` listing as C-C1b-3 does, but asynchronously, with no shell or automatic timeout signal and a referenced timer limited by the remaining phase window. The [4-B3 refinement](NATIVE_BAR_ADMISSION_COHORT_QUALIFICATION_DESIGN.md#before-every-file-action) uses fixed-argv `spawn` and explicit stream bounds rather than the earlier `execFile` sketch, so capture overflow cannot trigger an implicit signal; it also specifies a separately reviewed fixed read-only flags listing. At most one helper tool process runs at a time, counted separately from the worker and observer. A listing that does not finish in its window stops the run without any signal; its process reference is retained and reported like any other live child. Directory-service name resolution can make a listing slow; that is a stop, never a retry.

If OS ad-hoc signatures are approved, use a separate explicit internal build profile. It may omit the unsigned profile's `-no_adhoc_codesign` only for the new native links. Qualification runs only these read-only tools on those exact new objects, with bounded output:
- `/usr/bin/codesign --display --verbose=4 <object>`
- `/usr/bin/codesign --display --entitlements - <object>`
- `/usr/bin/codesign --verify --strict --verbose=2 <object>`

It requires an ad-hoc, linker-signed signature, no Team identifier or signing identity, no entitlements, a successful strict verification and a code directory bound to the final bytes. Unavailable or ambiguous output blocks. The same read-only `--display` calls record the host Node binary's signature flags and entitlements. If Node enforces library validation (hardened runtime without `com.apple.security.cs.disable-library-validation`), an ad-hoc addon cannot load, and the unit stops before any fixture. That load behavior is reasoning until 4-D observes it. Do not invoke a general `codesign -s`/force-signing repair on existing artifacts. Hash and pin final bytes after linking/verification. The unsigned inspector continues to reject signatures; add a separately reviewed inspector for the approved native-execution profile rather than weakening its default.

Suggested private assembly is a new test-only runtime with dedicated entries and worker, leaving C-C1a and the current inert public entries unconditionally refusing. Reviewed private adapter internals can be moved/shared into that runtime only with capability-bound imports and new structural guards; do not publish raw creation/removal/backend/clock functions. Proposed filenames are:
- `test/helpers/unsignedCohortRuntime.mjs`
- `native/native_bar_fs/build_unsigned_adhoc.mjs` (4-C)
- `native/native_bar_fs/run_unsigned_probe.mjs` (4-D)
- `native/native_bar_fs/run_unsigned_cohort.mjs` (4-E)
- `native/native_bar_fs/test_unsigned_cohort_worker.mjs`

None exists as an execution entry because of this proposal.

The supervisor alone creates cohort/case references from its own fresh build reference, original writer FDs, child objects and creation list. No caller supplies a filesystem path, PID, FD, backend, signer, clock, existing receipt or fabricated qualifier callback. References are one-use, expire on controller loss and cannot be reconstituted from serialized state.

The worker cannot receive a WeakMap reference across a process boundary. Its dedicated entry establishes a separate narrow worker session from its original inherited command/status pipes, strict launch binding, fixed module locations and mode. It rechecks its loaded modules and artifacts against the pins carried in its launch binding; that is a consistency check against the parent's values, not an independent or cryptographic one. Parent EOF or a launch/binding/pin mismatch closes that session permanently. This relies on the existing controlled-local-launch, non-malicious-same-UID threat model; it is not cryptographic parent authentication. If stronger OS parent authentication is required, stop and design it separately. PID/PPID values are diagnostic only and never deletion/signal authority.

## Controller State And Ordering

The controller's stop latch is independent of all supplied-data models and never reset. Its successful case path, with the v1 receipt events in their schedule order, is:

```text
fresh build qualified -> private report namespace qualified -> cohort ready
 -> case memory allocation -> anchor observed -> original receipt opened -> case_allocated/readback
 -> original worker launched -> LAUNCH -> addon loaded, protocol 6 and pins checked -> READY (no fixture yet)
 -> create intent/readback -> exclusive fixture -> per-entry proof/result/readback
 -> complete setup inventory -> correct registration/envelope sealed -> setup_sealed/readback
 -> PREPARE -> BASELINED -> worker_prepared/readback -> original baseline baseline_bound/readback
 -> pre-GO bound-object proofs -> go_intent/readback -> one GO
 -> bounded trace and original observations -> accepted RELEASED -> post-RELEASED bound-object proofs
 -> run_outcome/readback -> release_checked/readback
 -> complete cleanup_precheck/readback (teardown window starts)
 -> each delete intent/readback -> fresh target-chain check -> one removal/result/readback
 -> root last -> original-anchor absence absence_checked/readback
 -> worker FINALIZE -> normal exit -> worker_finalized/readback
 -> negative assessment -> ready_to_report/readback -> candidate report/readback -> terminal receipt/readback
 -> case receipt/report FDs closed once -> final case index row/readback
 -> case cleanly settled -> next fixed case -> final shared-index close -> cohort runtime verdict
```

READY is recorded as a bounded field of the first `create_intent` event, so the reserved receipt count stays `4*n + 16`. A launch, addon-load, protocol or pin failure ends before any fixture exists.

A controller state is not automatically a new receipt event. The memory allocation is not the later `case_allocated` receipt or fixture creation. Never create the fixture before its root intent has been read back. Record a created object's existence immediately, even if its identity read then fails; keep unknown proof fields null. A returned root whose result could not be recorded keeps its only locator in the permitted stop summary if the evidence namespace is still safe. Do not search for an orphan.

Build/evidence/source qualification, original baseline capture and the C-A envelope checks are prerequisites, not negative-case passes. Before a query exists or its baseline is accepted, failure retains the fixture and stops the cohort. Do not invent zero counters or `never_started` for a worker that actually started, and do not use optional model rollback as a real cleanup authorization.

After a fully settled but wrong case result, removal may still be allowed by the independently satisfied original ownership/release gates. Provenance loss, unknown native state or any stop affecting ownership prevents further removal even if an earlier diagnostic looked settled. Projection gaps do not gate release or teardown: RELEASED carries settlement facts only, OBSERVED carries availability flags, and an unobtainable or overflowing projection makes the case FAIL or BLOCKED while teardown stays governed by the original release and ownership gates.

A case is **cleanly settled** when it has recorded absence, a normally finalized original worker, no live observer or helper, no retained fixture, successful report/index readback and confirmed original case FD closes. As the [acceptance plan](NATIVE_BAR_ADMISSION_UNSIGNED_ACCEPTANCE_PLAN.md) allows, a cleanly settled FAIL or BLOCKED case is followed by the remaining predeclared cases without rerunning it, and both modes' failures stay visible. A retained fixture, an unknown state, or release/ownership/integrity/provenance uncertainty stops the remaining cases and the second mode. Those rows stay NOT_RUN; they are not passed, retried or replaced. The cohort-owned shared index is the only intentionally open writer between cases. Release cohort slots only from these original completed actions, never because a map was reconstructed or a child disappeared.

## Qualification Callback Responsibilities

The currently named callbacks become fixed internal operations, not injectable options:

| Operation | Required current evidence |
|---|---|
| `liveBuildPinsStillMatch` | Original source/input/runtime-closure/toolchain and artifact identities (cheap pins) or hashes (fixed points); complete expected mode module set; approved signature profile; no old-root adoption |
| `evidenceAclStillQualified` | Original report-root/ancestor identity, safe current ownership/mode/flags/ACL (bounded asynchronous listing) and original writer FD/path/link/size binding before every write |
| `checkObserverExecutable`, `checkAddonExecutable`, `checkWorkerExecutable` | Exact fixed artifact/module from this live build/source set, same CPU/mode and current final bytes; no arbitrary pathname |
| `checkFullSetupInventory` | Exact original recipe and creation list, no unknown/missing/aliased nodes, owned entries' ancestry/ACL/flags/known content hashes and C++/JS recipe digest. Its digest covers owned entries and only the immutable ancestor fields (identity, owner, mode, flags, ACL), as the native joint generation does. Volatile size, link count and timestamps of `/private/tmp` and the other ancestors are excluded, so unrelated activity cannot fail the cleanup precheck that must equal it |
| `checkExactRemainingAndParents` | Before each removal, a fresh `entry` observation of the target's chain only, with the same immutable proofs; a file keeps its size/link/hash. The complete remaining set was verified by the cleanup precheck inventory and is not re-proved per removal |
| `checkOriginalAnchorAbsence` | Original anchor still qualified and exact returned basename absent after the recorded successful root removal |
| `originalCleanupObservation` | Original accepted baseline, accepted release/counters, live original worker, completed receipt readback, fresh independent tree/absence; no imported model booleans |
| `remainingPhaseMs`, `actualParentStamp`, `workerClockDomain` | The supervisor's own original monotonic/wall clock and the worker's declared clock domain only; no supplied, adjusted or cross-domain clock. Windows come from the v2 window contract, including the new teardown phase |

Independent observer values are never replaced with expected recipe values. Directory mutable size/link/allocation/timestamps may change after the controller's recorded child actions, but immutable ownership/identity/ACL/flags stay bound. The selected Node pathname removal retains the explicitly documented same-UID check/remove race assumption; no claim of descriptor-anchored deletion is added. A missing qualification, exception or unknown result permanently stops instead of being retried into success. Observer calls per case are at most `n + 6`: anchor, setup inventory, the pre-GO and post-RELEASED proofs, cleanup precheck, `n` target-chain checks and absence. That is 15 for the largest recipe, within the 64-invocation limit.

## Registration And Baseline

Construct the correct registration only from independently qualified setup facts. Preserve fixed recipe IDs, marker/profile hashes and the public-vector fingerprint. The synthetic enrollment commitment is a predeclared invented commitment bound to these IDs, not a claimed signed enrollment or historical authority state. It is frozen before PREPARE; the fixed owner starts at sequence `1` with that exact enrollment commitment as its tip. No witness/enrollment signature file is created.

Compute the work envelope once from the fixed case slots, original setup geometry and existing conservative planning rules, with the unchanged 65536-byte headroom per ancestor (196608 total). Missing witness rows still reserve their declared case slot; do not shrink the envelope to actual observations to avoid the intended refusal. Run the current configuration/C-A validators and work accounting before GO with the BASELINED retained state plus the source-pinned per-owner reservation: 65536 bytes for the fixed-memory owner and 0 for the U0 profiles. The owner claim adds that reservation inside GO, and the reader re-plans at begin. Insufficient headroom or a planner refusal before GO blocks; no larger envelope, alternate anchor or outcome-driven recalculation follows. A refusal at the original begin after GO has no query handle and therefore no RELEASED. It is a post-GO non-PASS that retains the fixture and stops, and is reported as such.

U4 changes only supplied `bindings.data.inode` and its consequent registration hash in the worker input. The supervisor keeps the correct registration/ownership list, and the worker reports the explicit delta separately. The native code alone cannot attribute the refusal: `aexpected` raises the same bare `admission_expected_binding` for an identity/ACL mismatch on any ancestor, the fixture parent, data, witness or a marker. Attribution therefore requires two things:
- independent observer proofs, immediately before GO and after RELEASED, that every bound object other than data still equals the sealed registration;
- the named source-order inference that open-pair compares the ancestors and the fixture parent before data.

Without both proofs U4 is BLOCKED, pending a separately proposed native error-location change; it never passes on the code and delta alone.

The worker loads its exact addon and checks synthetic-only/protocol 6 and its pins at startup, then sends READY before the fixture exists. PREPARE activates no owner or query: it supplies the sealed configuration and creates the original bootstrap. BASELINED contains actual addon managed-FD/root counters and bootstrap workspace/retained metadata. The supervisor records and reads that original baseline before one GO. Counts are not OS-wide FD counts; parent/worker/observer/helper descriptors are tracked separately. Original same-process clock observations are not subtracted across clock domains.

## Versioned Transport Proposal

Do not broaden the v1 decoder or make its STOPPED state resumable. Propose a distinct **execution/provenance/receipt/report v2 family for the new controller path**; existing v1 supplied-data interfaces keep their current semantics and no authority. Both peers must use the same version; there is no automatic downgrade. This is a test-harness protocol proposal, not a native protocol or trading-rule change.

All frames keep canonical single-line JSON, complete-frame 65536-byte cap including LF, 32 total frames across both directions, directional ordinals, full original case/exchange/provenance binding and strict unknown-field rejection. LAUNCH carries a small bounded launch binding: source/build-set/worker digests, signature-profile tag and a fresh correlation nonce, never a full build record. PREPARE retains the 60000-byte configuration subcap and the launch nonce. Measure the complete frame before sending; an oversized frame blocks before GO. No key, checkpoint/signature packet, raw native bytes or opaque handle crosses a pipe. The worker reads each command frame completely before any long synchronous work, so a large PREPARE cannot stall in the socket buffer while the worker hashes.

The v2 binding explicitly includes protocol version, run/case/mode, source commit and actual source/patch digests, unchanged case-plan/recipe digests, final mode JS-set/addon/observer digests, runtime-closure and Node-binary digests, controller/worker source digests, signature-profile tag and original exchange/launch labels, plus registration/envelope digests once sealed. Define each set digest over a sorted canonical manifest of exact relative names and final hashes, not an arbitrary representative JS file. Recheck those manifests against the original live build reference. The outer execution stage is C-C1b-4; the nested original C-C1a recipe request is still that plan input, not a renamed or newly authorized stage.

| Message | Proposed behavior |
|---|---|
| LAUNCH | New, parent to worker, exactly once and first; carries the launch binding |
| READY | New, worker to parent, exactly once after the worker loaded its addon and checked synthetic-only/protocol 6 and its pins against LAUNCH, before the fixture is created; carries only binding and check digests |
| PREPARE, BASELINED, GO | Existing ordering and baseline/readback requirements; configuration required for a real worker |
| TRACE_CHUNK | Existing 128 events, 1024 bytes/event, 16/chunk, eight chunks; original observed native API calls only |
| OBSERVED | New, at most once before RELEASED. Its canonical payload is at most 16384 bytes and holds bounded diagnostic/inventory/capture/cause projections with origin labels/hashes, per-role usage totals and availability flags, not the full native report. The full projection is saved only in the 256 KiB report; receipt events carry its digest and byte count |
| RELEASED | Existing original-release/counter/trace gates, plus binding to the accepted OBSERVED digest when OBSERVED was sent; settlement facts only, never withheld because a projection is incomplete; no null diagnostic/resource values accepted as release |
| FAILED | New terminal failure projection after a validated LAUNCH binding: bounded phase, primary code, up to eight close codes, actual diagnostic/resource subsets or null, and overflow/availability flags; never grants release, teardown or success |
| CANCEL | At most once for the original GO; ordinary ACTIVE cancellation or the separate shutdown dispatch described below; no new query/deadline |
| FINALIZE | Only after original release and confirmed teardown; no failure-finalization message that could imply removal |

Before LAUNCH has a validated binding, a malformed launch may yield only EOF/abnormal exit; do not invent an attributed FAILED packet. FAILED covers worker-side failures. A projection that cannot fit or cannot be obtained is reported through OBSERVED's availability flags, not FAILED. Do not forge RELEASED to carry an error. A FAILED worker closes original resources once and remains failure-terminal; EOF/exit cannot stand in for release.

GO counts as **submitted** once its write has started on the original command pipe. A completed write means only that the kernel socket buffer accepted the bytes, not that the worker read them: libuv stdio pipes are socket pairs, and this host's buffer is 8192 bytes. A GO whose write did not complete in its window is treated as possibly started. The parent closes that original stream once (EOF) and never resends.

Worst normal frame count is at most nine nontrace frames plus eight chunks, **17**, below 32. The nine are LAUNCH, READY, PREPARE, BASELINED, GO, the optional one CANCEL, OBSERVED, RELEASED and FINALIZE. FAILED is terminal and replaces a normal result path rather than opening additional attempts.

The v2 failure record enumerates the worst post-GO failure:
- stop reason;
- FAILED projection digest;
- CANCEL write outcome;
- worker exit or retained child;
- stdout/stderr digests;
- close outcomes.

`stop_summary` gets a bounded detail list for these. The later pure capacity contract must verify exact maximum serialized sizes, including the new binding/projections, this worst-case stop summary within its 16384-byte record and the four stop-summary slots, and every failure path. Inability to fit blocks implementation/GO instead of raising any ceiling.

## Observation Projection And Negative Evaluation

Preserve the original function arguments, receiver, returned objects and exceptions in the NAPI logging facade. Test-only observation may inspect bounded metadata and hash/count bytes, but cannot substitute a native result, callback, clock or backend. Instrumentation/projection failure invalidates acceptance, not the original operation's return/throw.

| Required fact | Origin and rule |
|---|---|
| Native begin/open/inventory/capture/verify/close | Original NAPI begin/end/throw trace; trace collection is bounded, not kernel syscall counting |
| C0 dispatch/authentication counts, state/cleanup | Original query diagnostic, allowlisted fields only; raw query diagnostic is hashed in worker memory, not dumped |
| Phase edges between authentication and native API calls | Direct trace/count facts plus named constraints from the pinned original reader source; identify source-constrained inference, never fabricated direct timestamps |
| U1 captured bytes | Hash and byte count from the exact original capture; supervisor compares with independently sealed witness proof and known recipe bytes, not the worker's claimed match boolean |
| Marker non-evidence encoding | Original inventory summaries: exact known markers/structural entries have cap `0` and unreadable-evidence flags; absent inventory stays not observed, not true |
| U3 maintenance-bound cause | Source-pinned re-derivation, because the entries-to-usage mapping is private reader code. The projection carries per-root-role entry and byte totals with a total count and digest over all native entries, not a sample of rows. Classification is bound to the hashes of `src/nativeBarAdmissionJointReader.ts` and its compiled JS and requires only `maintenance_metadata`; no copied expected blocker list |
| U4 cause/delta | Bare `admission_expected_binding` normalized by the existing rule, the actual correct/supplied registration comparison (only the data inode differs), and the pre-GO/post-RELEASED independent proofs that every other bound object is unchanged; labeled source-order inference |
| Original retirement/release | Source-pinned original diagnostic `released` plus cleanup confirmed and baseline/end counter match; exact transport/retirement timestamps remain null |
| Teardown | Supervisor's own removal results, current observer/anchor checks and the ownership model summary for this exact case/name; not a worker report or replayed receipt |

The current facade/diagnostic alone does not provide every inventory/usage/byte assertion. Add the bounded OBSERVED projection before native acceptance; do not set missing fields from the case catalog. If the exact cause or required fact cannot be obtained without changing the native/application API, mark the assertion/case BLOCKED and propose a separate interface change rather than instrument the runtime silently. For U3 that change would export the reader's usage builder; for U4 it would add a native mismatch location. Assertions known at design time to be unobtainable are settled as BLOCKED in 4-A, not discovered in 4-E.

Use the unchanged twelve-case catalog and C-C1a negative assessment after confirmed teardown. Keep its result `consistent_supplied_negative` and its false authority flags intact. A separate controller verdict may be PASS only from the conjunction of original operations, independent byte/ownership checks, exact expected negative code/causes, successful protocol, teardown, worker exit, evidence readback and close confirmations. Model consistency, successful compiler exit or a reproduced refusal alone is not native acceptance. Any expected-code/phase/cause mismatch remains FAIL even if safe cleanup completed.

## C0 Only Signing

The existing fixed-memory helper signs any request as soon as it arrives, including C1, so a request count checked after the run cannot prevent a C1 signature. Its boundary test also requires exactly one consumer of the owner mailbox and exactly one `createPrivateKey` and one `sign` call.

The proposal therefore adds, inside that same helper, a second fixed export `enrollFixedMemoryCheckpointOracleC0Only(originalOwnerGrant, inventedState)`:
- It shares the single key and sign sites and still consumes only its original owner grant and the fixed invented state.
- It sets a closure-fixed C0-only flag, and the delivery path rejects any non-C0 request or a second request **before** reaching `sign`.
- It takes no mode option. Existing exports, modes and callers are unchanged.
- The boundary test is revised to allow exactly these exports, still find one key and one sign site, and require the C0-only rejection to precede the sign call.

No caller-supplied keys, bodies, signer functions or transport callbacks are added. 4-B may exercise this profile with in-memory RFC 8032 signing of the published test vector, exactly as the existing B3-Bb unit tests do. Nothing is saved, transported or derived from the private key outside that helper.

Private test-key creation remains after GO only for the ten fixed-owner cases per mode. U0 uses only the existing unavailable/unsigned profile and never creates a private key. An unexpected C1 is recorded as a violation, rejected unsigned, and stops the cohort. No replacement owner, retry, `advance`, `setMode`, replay or deferred request is used to obtain a more favorable result. Fixed-owner signed count is at most one; the original diagnostic request count remains separately observed. Signature/checkpoint bytes stay in the original worker-owned path and are not saved or sent over the status pipe.

The parent's stop state cannot reach into the worker. Once GO bytes are written, the worker may start the query and sign C0. Worker-side signing is bounded by this C0-only profile and the worker's own latch, not by the parent's RETAIN.

## Stops And Shutdown

There are two lanes: normal progress and original-resource shutdown. RETAIN permanently disables the parent's own create, native-start, GO, ordinary progress and removal actions. It does not discard live child/FD/query references or suppress the opportunity to cancel the already-original query.

The current `sendOriginalWorkerCommand` refuses after `run.stopped`; do not make its general checkpoint pass during stop. Add a narrowly reviewed shutdown dispatcher whose only possible payload is one canonical CANCEL on the original command pipe. It is allowed only if all of the following hold:
- the original GO was submitted (as defined above);
- the case/binding is still known;
- the worker is live;
- cancellation has not been spent;
- a frame slot remains;
- the original settlement window permits it.

Consume cancellation before writing; no retry on uncertain pipe delivery. Its validation/ordinal/frame accounting must share the original dispatch ledger and 32-frame ceiling, including a prior ordinary CANCEL. It cannot clear STOPPED or authorize further model transitions; late worker results are bounded failure diagnostics only. If the required transport/binding state is unknown, do not guess an ordinal or open another channel.

Keep intent readback, write start and write completion (kernel-buffer acceptance) as distinct original ledger facts. An attempted/uncertain GO is not proof the worker started a query and must never be resent. Shutdown may conservatively target that same possibly-started session only through a still-qualified original pipe and its consumed send ordinal. No extra request, transport replacement or synthetic acknowledgement follows.

**Every stop ends the command channel.** After the optional single CANCEL, the parent closes its original command-pipe write end exactly once, before or after GO, so the worker's EOF path runs. This includes a broken or unqualified pipe, which cannot be reopened for CANCEL; any close uncertainty is retained. A healthy worker stopped before GO closes its bootstrap and exits; the parent never waits for a worker that has no further command to receive.

The worker handles command-pipe EOF/error and original-parent loss by latching failure and cancelling/closing only its own original session. Before GO, close the bootstrap without starting owner/query; after GO, cancel the original query once and independently attempt release/reader/owner/bootstrap closes. Cancel-before-query creation is remembered. Close attempts/primary failures are kept separately, and uncertain closes are never retried. After EOF the worker keeps a referenced handle, such as its own settlement timer, while the original query is pending, because the reader's deadline timer is unref'd and would not keep the worker alive. No worker owns fixture-writing/removal capability.

After its bounded shutdown attempt, a FAILED worker can flush that one failure packet and exit nonzero only when no tracked original operation remains outstanding. If settlement is still unknown, preserve the original live operation/child reference and report that disposition; do not use voluntary exit/GC as the missing release evidence. FAILED never unlocks FINALIZE or cleanup in the parent.

Retain the original 120000 ms preparation, at-most-600000 ms query, 60000 ms settlement grace, and at-most-10000 ms observer/command-write/helper windows, limited by the remaining phase.
- **Preparation** starts at case allocation, covers worker launch/READY and fixture creation, and is not refreshed.
- **Query** supervision starts when the original GO is submitted; the original query keeps its own unchanged deadline.
- **Settlement:** the deadline is set once at the first stop/cancel/normal-query-completion trigger. It bounds only settlement, that is, draining the original release and the worker's result frames, and is never renewed by late frames.
- **Teardown** gets its own new harness window of 120000 ms, starting at the cleanup precheck and never renewed. Each observer call inside it is limited to min(10000 ms, remaining). Its worst case is `n + 2` observer calls (precheck, target-chain checks, absence), 110 s for the largest recipe, against typical calls of milliseconds. Teardown that cannot finish in its window retains the remaining entries and stops.
- **Reporting** and index writes after teardown perform no fixture action and are bounded by the cohort time bound.

Supervisor and worker use referenced timers only. The reused adapters' `timer.unref()` calls are replaced, and no unref'd timer is the only completion mechanism.

These windows detect lateness but cannot interrupt a synchronous kernel call. Default termination policy is **none**, a reviewed code constant. Without additional approval, keep the original hung child object, stop all later work, report user action and do not claim the case finalized. If separately approved, bounded TERM then KILL applies only to that original worker or observer child object after original cancellation/grace, with the previously proposed 5000 ms waits; never a PID, process group, existing MCP, TradingView or Dot. Termination/exit is not release proof and cannot permit fixture cleanup.

**Process lifetime.** Operational units are started by the user in their own terminal, never by the agent. The supervisor installs no signal handlers. Worker and observer are spawned in their own process group (`detached: true`), still referenced and never signalled as a group. A terminal Ctrl-C or SIGHUP therefore reaches only the supervisor; its loss closes the command pipe, and the worker's EOF path cancels and closes its own session. If an original child is still live after the bounded shutdown, the supervisor first prints its bounded final result, including the child's PID and start time as diagnostics for the user. It then stays alive, holding the reference, until that child exits or the user ends the supervisor. It does not unref and exit, which would make an approved child-only TERM/KILL impossible. On supervisor loss there is no restart-based controller recovery or retained-fixture cleanup.

**Total time bound.** 4-E's approval states a cohort wall-clock bound. The per-case worst case is about 120 s preparation + 600 s query + 60 s settlement + 120 s teardown, roughly 900 s, so 24 cases could take about six hours plus the builds. The controller starts a case only if the remaining cohort bound covers that case's worst case; otherwise the remaining rows stay NOT_RUN.

**Sanitizer and crash side effects.** Worker and observer both run with `UBSAN_OPTIONS=halt_on_error=1:abort_on_error=0:exitcode=86:print_stacktrace=0`; exit code 86 is classified as a sanitizer report. On Apple platforms `abort_on_error` otherwise defaults to true. A SIGABRT then makes macOS write a crash report under `~/Library/Logs/DiagnosticReports`, which the system may submit depending on the user's analytics settings. Other native crashes can still do that. This is disclosed as an OS side effect outside the report namespace, not product data; the exact sanitizer exit behavior is confirmed only in 4-D.

**Retained fixtures under `/private/tmp`.** Per its man page, macOS's `tmp_cleaner` (macOS 14 and later) checks `/tmp` every day and removes content that has not been modified recently. The threshold is not documented there; strings in the tool suggest about three days. A retained fixture can therefore disappear without any harness action. A later disposition must not count missing entries as this run's removals, and retained fixtures need a prompt user disposition.

## Evidence And Resource Bounds

Proposed v2 receipts/reports/indexes retain the existing byte/event ceilings and non-circular order: confirmed receipt prefix -> one report/readback -> terminal receipt binding its report hash -> case-writer closes -> index row/readback. Separate runtime verdicts from nested unqualified model results. Do not put a final receipt/index hash back into its earlier report. No report is authenticated approval, historical authority or a resume token.

The report cannot prove that its own writer was closed later. Store a **candidate** case outcome and explicit `finalization: pending_case_writer_closes` in the report. Only the later index row may carry the final case verdict, after actual case receipt/report closes and with their bounded outcomes. A close failure makes that row FAIL, without rewriting the earlier candidate report or terminal receipt. An index-write/readback failure leaves the case unindexed/unknown and stops, never an announced PASS. Readers must not treat a candidate report as the final runtime verdict.

Similarly, an index cannot self-certify its own later close. Its saved finalization metadata remains `pending_index_close`; the bounded terminal CLI result and normal exit may report the cohort's runtime verdict only after its final fsync/readback and one confirmed index close. If close fails or the process disappears, final cohort completion is unconfirmed. Replaying the saved files may confirm their limited content/ordering, not reconstruct that missing final runtime fact. Do not add another file/receipt cycle or claim power-loss completion to hide this limit.

Keep `4*n + 16` reserved receipt events, 64 events/1 MiB maximum, 16384 bytes per event, 256 KiB per report and 128 KiB run index (4096 header + at most 24 rows of 5290 bytes). New controller facts (READY, FAILED/OBSERVED digests, bound-object proofs, shutdown/close errors) must fit existing lifecycle/failure events as bounded fields, not one new journal event per trace or callback. The v2 capacity tests must cover maximum source/error/projection lengths and all failure phases; if a projection cannot fit, refuse before its next side effect. Actual observer work remains separate from the unchanged native 256 MiB budget.

The current largest recipe has nine entries and reserves 52 events. Twelve would exactly reserve 64; thirteen or more must refuse even though the separate geometry limit permits sixteen owned objects. The proposal does not turn the geometric maximum into permission to overrun the receipt budget.

Only the new original report namespace receives case receipts/reports/index; no market/research/review-log writes, email, upload, auto-sweep or product history integration. A safe evidence namespace may record a stopped native case; a tainted/uncertain namespace cannot be repaired/replaced to save a success. Preserve a partial-file locator/hash/count and separate primary/save/close failure in the controller's bounded final diagnostic. If durable saving failed, report it as failed/unknown, not a complete index. No retained fixture is removed to make a report appear complete.

The original case receipt/report/fixture handles close once before their final index row; the report-root/cohort handles and shared index close only at cohort finalization. A failed close blocks the next case or final completion. Count harness pipe/child/helper/metadata allocations separately from native managed-FD/root/workspace counters. All 24 rows are planned; after an early stop, remaining rows are explicit NOT_RUN in bounded final metadata where safely savable, without constructing nonexistent case receipts or resetting the cohort. Header/24-row byte reservation must include any finalization fields; do not append a twenty-fifth summary row outside the existing index budget.

The shared index's qualification/ownership is cohort-scoped, not delegated to an expired first-case reference; the current `checkWriter`, which validates index writes against the first case's run, is replaced in the cohort runtime. Only the original cohort can append later rows or perform its final close; a stopped case cannot manufacture a new writer or bypass the cohort stop latch.

## Implementation Sequence

These subdivisions are proposed implementation units, not approvals or changes to the existing stage names:

| Unit | Deliverable | Permitted validation only after that unit is approved |
|---|---|---|
| **4-A** | Pure controller/v2 binding (LAUNCH/READY/OBSERVED/FAILED/shutdown CANCEL), progress/shutdown/teardown-window contracts, projection/report schemas, exact capacity arithmetic and the settlement of assertions known to be BLOCKED; models remain unqualified | Memory/source tests only; no child, native, key, fixture or filesystem output |
| **4-B** | Sealed original-capability builder/controller/worker assembly, fixed qualification and clock functions, bounded observation, referenced timers, the C0-only export and its revised boundary guard | Memory substitutions, structural boundary tests and in-memory public-vector signing as in the existing B3-Bb tests; no build/native/fixture execution |
| **4-C** | Separately approved fresh signature-policy build with read-only OS signature and host-Node inspection, opened by its own unseal commit | Only the approved build and inspection; nothing executes the new objects |
| **4-D** | Separately approved fixture-free real-OS probe in one invocation: fresh build and the 4-C checks, then an observer anchor-only run, worker launch/addon load/READY, pipe EOF and exit, and UBSan runtime load | Only those actions; no fixture, key or cleanup capability |
| **4-E** | Separately approved twelve-case/two-mode cohort with the complete approval bundle, repeating the 4-C/4-D checks in the same invocation | Exact approved native/fixture/C0-memory-signing/evidence/cleanup actions only |

Each later unit repeats the earlier units' checks inside its own invocation, so an earlier operational unit may be skipped once a later one is approved. None leaves a serializable handoff: each invocation makes its own fresh build and needs its own user-resolved output disposition. The pre-GO decision barrier is an automatic qualification gate inside one invocation. It passes only when every required check succeeded and every required approval is part of the opened entry; it is never an interactive prompt. Pausing/restarting a build-only run does not turn its saved record into a live grant. No undocumented rebuild or output-path fallback is proposed to avoid this prerequisite.

The user approved **4-A**, then separately **4-B1** (C0-only helper and published-key memory signature tests), then **4-B2 only** (memory composition and sealed facade). 4-B2 explicitly excludes signing, including the earlier public-test-key memory signature tests. The remaining builder/controller/worker connection additions, all operational steps, OS signatures, signature-file output, existing-root disposition and child termination are still unapproved.

## Remaining 4-B Slice Plan

2026-10-29 JST, design-only baseline `b5eb7ea`, including the second 4-B1 review corrections. The original request to specify these slices did not approve implementation or execution; the later 4-B2-only approval and implementation are recorded below. In particular, preserve the corrected C0 registry-liveness check, one-attempt latch, immediate key-reference release, refusal diagnostics and unchanged legacy profile. Do not reconstruct the first 4-B1 implementation from its older record.

### Sequence And Boundaries

| Slice | Implementation deliverable after separate approval | Explicitly not included |
|---|---|---|
| **4-B2 (next)** | Memory-only parent composition of the existing 4-A protocol, windows, evidence and cohort models; one irreversible stop latch; model-local reference and resource accounting; an unconditional sealed inspection/execution facade | Live build capability creation, OS qualification, real clocks/timers, I/O, signing or worker dispatch |
| **4-B3** | Private fresh-builder/live-build/evidence-namespace qualification connection code, complete input/runtime closure and Node/toolchain pins, fixed internal clock operations, cohort-owned shared-index identity | Invoking the builder, inspecting new OS signatures, minting a real grant during tests, adopting the saved 436 artifacts or reopening the existing build-only CLI |
| **4-B4** | Dedicated sealed worker dispatcher and original parent transport connection code: eager imports/pins, LAUNCH/READY/PREPARE/BASELINED, one GO, corrected C0-only owner selection, original EOF/cancel/close and bounded observations | Starting a child, loading an addon, starting a query against a fixture, real C0 signing in a worker or saving signature packets |
| **4-B5** | Private fixed observer/creation/evidence-write/removal connections and parent case driver; referenced timers, shutdown lane and one-time close bookkeeping; report/readback/case closes/index/cohort ordering | Running an observer, creating/removing fixtures, writing receipts/reports/index files, signalling children or enabling an entry |
| **4-B6** | Memory/source acceptance of the complete sealed assembly: all 24 fixed rows, U0 no-key path, continuation versus retention, bounded projections, pre-GO refusal and failure/close paths | Native acceptance, OS timing/lifetime qualification, unsealing 4-C/4-D/4-E or claiming memory substitutions prove real ownership/release |

These are subdivisions of the existing 4-B scope, not new execution stages. Each implementation needs its own approval and review. Connection-code approval never authorizes invocation. The 4-C/4-D/4-E approval bundles, fixed output root, existing-output disposition prerequisite and user-terminal-only operational launch stay unchanged. No package script, MCP entry, automation hook or operational CLI is added in 4-B2. Later sub-slices must specify their exact new private imports and sealed entries before implementation.

### 4-B2 Deliverables

Prefer two narrow test-only modules and two tests rather than another copy of the protocol:

- Proposed `test/helpers/unsignedCohortAssemblyModel.mjs`: owns the existing protocol/window/evidence/cohort instances and all model-local opaque references. It imports the existing pure helpers only; it neither imports a build CLI nor accepts an executable backend, callback, clock, signer, FD, PID or filesystem path.
- Proposed `test/helpers/unsignedCohortRuntime.mjs`: a sealed facade with only `inspectUnsignedCohortAssembly` and `executeUnsignedCohortAssembly`. Inspection returns bounded blockers and false authority flags; execution always refuses before inspecting any supplied argument or importing an effect-capable module. No factory, prepared-run setter, live-build issuer or resource registry is exported. Its eventual private composition root will need a separately reviewed change; 4-B2 does not hide such a root behind an environment switch.
- Proposed `test/unit/nativeBarAdmissionUnsignedAssembly.test.mjs` and `test/unit/nativeBarAdmissionUnsignedAssemblyBoundary.test.mjs`: memory composition and source boundaries. Default to standard pure dependencies; use an isolated JS tree only when explicitly selected, never probing for an available tree or rebuilding it.
- Update this design and `docs/BACKLOG.md` with observed results and limits. Existing 4-A/4-B1 helpers and v1 inert entry seals are unchanged unless a separately explained defect requires approval.

The model entry accepts the unchanged strict case-plan request and bounded invented allocation, event and timestamp data. It exposes one coordinator interface, detached descriptions and model-local correlation tokens, not its mutable child models. The proposed signatures are:

| Interface | Input and responsibility |
|---|---|
| `createUnsignedCohortAssemblyModel({ request, clock })` | `request` is the unchanged catalog request; `clock` has the existing `clock_domain`, `started_ns`, `cohort_limit_ms` fields. No supplied runtime-qualified or approved flag |
| `beginCase({ allocation, at })` | Strict 4-A allocation must match the next derived case/mode and original source/build-set binding; `at` is a model point in the fixed clock domain. Return a model-local case token only after all model preconditions pass |
| `applyModelEvent(caseToken, event)` | Explicit finite tags for frame, write progress, receipt/readback, model resource observation, report/readback, writer-close and index/readback facts. Reuse the corresponding existing strict schemas and bounded byte strings; do not expose child method names or generic dispatch |
| `finishCase(caseToken, { at })` | No caller-supplied verdict, cleanly-settled flag, remaining time or index digest. Derive those from this case's owned models and resource ledger |
| `stop({ reason, at })` | Bounded original primary reason and model clock point; first failure wins. Invalid stop data also latches failure rather than leaving an active coordinator |
| `finishNotRun()` / `closeIndex({ outcome, at })` | Use the existing remaining-row and one-time index-close contracts; index outcome is an invented close observation, not a real FD confirmation |
| `describe()` | Detached bounded model diagnostics with no authority; never exposes a mutable child model, map or resource token |

`applyModelEvent` is a strict discriminated union of those enumerated event families, not arbitrary method names, callbacks or a success boolean. At implementation time enumerate every tag and sub-schema beside its fixed mapping; reject unknown fields/tags before routing. A supplied GO frame must agree with the readbacks derived by the coordinator; its own true booleans are not proof. Frame and receipt bytes are checked by the original parsers, not parsed more permissively by the coordinator. Neither this entry nor its tokens can enter the sealed runtime. No model hook is added to that runtime to manufacture a real original capability for a test.

### 4-B2 Composition Rules

| Concern | Required composition rule |
|---|---|
| Case order | Derive normal-then-UBSan case order from `describeUnsignedAcceptanceRun`; at most one active case, no caller-selected skip, replacement or retry. Model allocation is not a created fixture |
| Whole-cohort time | Freeze one origin, clock domain, cohort limit and absolute end. Each case's existing window model uses that same origin/end, not a newly extended limit. Keep a cohort-wide last observation so a rollback between cases is refused. Derive remaining time from those values; do not accept a caller's `remaining_ms` as authority. A case needs the unchanged 900000 ms worst case |
| Protocol and write progress | Keep accepted intent, write start and write completion distinct. Enter the query window when the original modeled GO write starts, not when a GO frame is merely accepted. A partial/uncertain write cannot be repeated or converted to completion |
| Baseline and intent readback | Derive the modeled GO gates from the evidence model's confirmed baseline and go-intent readbacks and their exact digests. Do not add facade parameters that independently claim `baseline_readback: true` or `go_intent_readback: true`. Model readback is still not an actual FD readback |
| One stop latch | A child-model refusal, malformed event, cross-case token, capacity or clock failure permanently latches the coordinator and stops the cohort. Preserve the first primary failure and bounded subsequent shutdown/close facts. If one child model already advanced when another refuses, preserve that partial state; never roll it back, recreate the child model or retry into consistency |
| Shutdown | After stop, only the existing original shutdown-CANCEL eligibility, late diagnostic, one close/settlement, failure-only evidence finalization and NOT_RUN accounting paths remain. Evidence may record a stopped case only where its existing pending-readback/hard-stop rules permit; an unsafe evidence model is not reset or replaced. Reuse the existing directional ordinal/frame ledger and original settlement window; no new query, GO, fixture action, ordinary progress or model-reset path |
| Model-local references | Identity-only, owner-bound and one-use where required. A clone, JSON, report, old case token, wrong mode, ended assembly or another assembly's token refuses. These references correlate invented events; they are not live original build/FD/child capabilities. Do not add a setter to `unsignedInertAdapters.preparedRuns` to make a test pass |
| Resource slots | Track one modeled fixture, worker and observer, plus the original report/receipt close facts and cohort-scoped shared index. A requested close, model release, child exit or zero counter alone does not free a slot. Unknown close/settlement retains the slot and blocks the next case. Modeled resources never stand in for real resources |
| End of case | Derive `cleanly_settled` from the same case's modeled absence, original modeled release, worker-finalize/normal-exit, no retained child/helper/fixture, confirmed case-writer closes and index readback. Do not accept that conjunction as a new caller-supplied boolean. A clean FAIL/BLOCKED may continue; uncertainty or C1 violation stops all later cases |
| Final index | One cohort-owned index survives settled case turnover. The first case cannot own later rows or final close. Candidate report, later case verdict and final index-close status remain distinct; no replay/report/token can prove runtime completion |

The assembly uses the existing assessment and evidence contracts instead of introducing new case meanings. Missing direct observations remain BLOCKED as already specified. U3/U4 source-constrained inferences do not become directly observed facts. A model-consistent lifecycle never becomes a native PASS, approval, retained-history statement or release/deletion authority.

### Bounds And Model Diagnostics

Preserve all `LIMITS`, case recipes, signing limits and retention rules. In particular: 24 planned rows; 32 combined frames; 65536 bytes/frame; 128 trace events/eight chunks; configuration 60000 bytes; observation 16384 bytes; receipt `4*n + 16`, at most 64 records/1 MiB and 16384 bytes/record; report 262144 bytes; shared index 131072 bytes with a 4096-byte header and at most 24 rows of 5290 bytes. Use the corrected 4-A serialization planner, not the first review's older maximums. Fixed-owner headroom stays 65536 bytes, U0 zero; no key is created in 4-B2 validation.

Bound new coordinator metadata by the fixed case count, one active-case slot and existing event/error limits. Use references to the owned models rather than retaining a second raw transcript or cloning each report after every event. Account for any retained bounded summary/copy in the harness budget, separately from the native 256 MiB budget; the native envelope cannot finance the parent model. Before implementation, fix the diagnostic schema and show its maximum canonical bytes fit the existing relevant report/comparison subcaps. If the composition needs additional receipt fields or cannot fit, stop for a design decision; do not raise ceilings or insert new events silently.

Descriptions have a distinct memory-assembly scope and keep `execution_available`, `cleanup_execution_available`, `approval_authenticated`, `ownership_verified`, `native_release_verified`, `timestamps_verified`, `evidence_saved`, `history_verified`, `signing_available`, `runtime_qualified` and `runtime_completion_proven` false, with `native_status: NOT_RUN`. They may report model consistency, slot disposition and stop reasons only. They contain no handles, callbacks, private key/signature packets, actual private paths, PIDs or FDs. Copied/edited descriptions cannot mutate the coordinator or clear a seal.

### 4-B2 Acceptance And Exit Gate

After implementation approval, validation is memory/source only, on the main thread with no real timer, process, native, filesystem mutation or signature. Use the corrected 4-B1/4-A constructible tripwire pattern, including self-tests of recorders; it is a secondary guard, not a complete sandbox. Run affected files individually with `--test-isolation=none` if needed to avoid test-runner children; never run several process-wide tripwire files together. No npm/pretest/build, filesystem-fixture constructor invocation or full operational suite is implied. Pure recipe/registration metadata builders are not filesystem fixture constructors.

Required tests:
1. An invented consistent case and complete 24-row lifecycle pass the composed model, while every authority flag stays false and the sealed runtime refuses even their original tokens and reports.
2. Protocol/evidence/window digests and times are derived from the same model facts; forged baseline/readback/remaining-time/clean-settlement claims cannot bypass composition. Accepted-but-unwritten GO does not start the query window; started-but-unconfirmed GO is never resent.
3. Refusal and partial advancement at each cross-model boundary latch stop permanently. A later matching hash, replacement model, cloned token or fresh-looking receipt cannot resume it. Unknown closes retain slots and stop both modes.
4. STOPPED permits only the already-eligible original CANCEL/EOF/close/late-diagnostic accounting. Cancel-before-GO, second CANCEL, late grace renewal, FINALIZE after FAILED and arbitrary post-stop progress refuse.
5. A settled model FAIL/BLOCKED continues only with the full derived close/absence/index conjunction. One retained reference, C1 attempt, index failure or insufficient cohort remainder leaves subsequent rows NOT_RUN without constructing phantom case receipts.
6. Shared-index ownership survives case turnover; close uncertainty does not become completion. No case report claims its own later FD close or the index's eventual close.
7. Exact-limit/one-over tests cover new summary retention as well as existing frame/receipt/report/index bounds. Use targeted source/behavior mutants for each newly added gate; require a relevant test to fail, not only an unchanged total test count.
8. Fixed import/export boundaries, no unsafe import-time effects, no environment write or runtime fallback, no generic effect injection, no public live-reference issuer, and unconditional old/new entry seals are checked. An unsupported dependency/mode reports a blocker rather than building or selecting another path.

Exit from 4-B2 means reviewed memory composition plus sealed boundaries, not an executable cohort. 4-B3 requires a new explicit approval for private connection code; actual build, OS inspection, child/observer/native execution, C0 worker signing, fixture actions and evidence saving still require the corresponding later operational approval. Dot remains PAUSED and trading judgment/notification conditions are untouched throughout.

## Acceptance Tests Before Operational Approval

Pure/boundary tests must include a successful simulated path as well as failures, and demonstrate that each removed guard makes a test fail. They cover the following.

**Binding and capabilities**
- Same-version peers; strict complete binding/launch/mode; unknown/mixed/old versions refuse; no fallback to common build, old receipts or another stage's oracle route.
- Opaque capability identity, no DTO/clone/JSON/deserialized grant; parent and child grants are distinct, no PID authority; unsafe/changed build, runtime-closure or evidence pins permanently stop.
- Operational entries refuse unconditionally until unsealed and stay sealed without the complete approval bundle; no flag, environment variable or prompt selects a policy.

**Worker launch and signing**
- READY precedes fixture creation; an addon-load, protocol or pin failure leaves no fixture.
- PREPARE never signs; GO is spent once and requires actual baseline/intent readback; original counters/retained metadata stay separately interpreted; pre-GO planning includes the per-owner reservation.
- The C0-only export rejects C1 and a second request before `sign`, with in-memory public-vector signing; the revised guard still finds exactly one key and one sign site; U0 key/sign tripwires remain zero; missing diagnostic/projection/cause does not become a matching expectation.

**Case evidence**
- Full and missing/partial inventories, aliases/unknown files/allow ACLs, U1 capture mismatch, marker cap/readability mutation, U3 ancestor-only headroom refusal and U4 foreign deltas cannot pass.
- U4 passes only with pre-GO and post-RELEASED proofs of every non-data bound object; an ancestor, fixture-parent, witness or marker change yields FAIL/BLOCKED, never PASS. U3 classification uses per-role totals bound to the reader source hash; a truncated or sampled projection is BLOCKED.
- The precheck digest ignores volatile ancestor fields and catches every owned-entry or immutable-field change.

**Protocol, stops and timers**
- Reordered/duplicate/overlong frames/chunks, FAILED before a valid binding, FAILED substituted for release, oversized projections and unknown fields stop within unchanged ceilings; projection gaps yield FAIL/BLOCKED with teardown still governed by the original gates; the worst-case stop summary fits.
- Ordinary progress after STOPPED refuses; shutdown permits only one original CANCEL inside the original window/frame ledger; blocked/uncertain writes do not retry, reset or permit deletion.
- Every stop, before and after GO, closes the original command pipe once; a healthy worker stopped before GO exits through its EOF path.
- Parent/worker/observer/helper EOF/error/loss before and after GO and between every removal; original close and record failures stay separate; no unknown close is retried and no lost-parent recovery exists.
- Tests whose only pending work is a deadline timer pass on Node 20 and 22; no unref'd timer is the sole completion mechanism in the supervisor or worker; teardown has its own window.

**Continuation and finalization**
- A cleanly settled FAIL/BLOCKED continues to the next case; a retained fixture or any uncertainty stops the cohort and the other mode; the cohort time bound prevents starting a case that cannot finish within it.
- Root creation result cannot be saved, later-mode failures and report/index failures preserve known side effects/remaining rows; unsupported or stopped cases never become PASS or disappear from the cohort summary.
- Candidate report plus later case-close failure cannot become a final PASS; missing/failed final index close cannot be replayed as cohort completion; all finalization metadata fits the header/24-row reservation.

**Process and environment**
- Children are spawned in their own process group; the supervisor installs no signal handler; a retained live child keeps the supervisor alive after its final result.
- Worker and observer receive the fixed `UBSAN_OPTIONS`, and the sanitizer exit code is classified.
- No automatic signal or old-output move/delete, no arbitrary file/PID/backend/signer input, no recursive removal/repair, no application/MCP/automation import of the cohort runtime.

Real OS behavior is checked only in the separately approved 4-D probe and 4-E cohort: actual launch/EOF, APFS ACL/volume/name semantics, original native traces and counter retirement, code-signature and library-validation behavior, sanitizer exit behavior, report readback and the selected non-recursive teardown. Memory consistency and a successful compiler exit cannot substitute for them.

## Independent Review

2026-10-28 JST: two read-only reviewers checked the first draft against `2fd35f8`, one for code/contract consistency and one for safety and platform realism. A local review preceded them. Frame and receipt arithmetic, signing separation, deletion scope and the candidate-report/final-index honesty held. The draft was corrected as follows:
- **Process lifetime:** run location, own process group, no signal handlers, the retained-child end state and a total time bound were added.
- **Pre-GO stops:** every stop now closes the command pipe; pre-GO stops previously left no way to end a healthy worker.
- **Approval selection:** operational policy is fixed in reviewed constants behind per-unit unseal commits, with a complete 4-E bundle and no flags or prompts.
- **Case evidence:**
  - U4 attribution now needs bound-object proofs before and after the query, because the native code carries no mismatch location.
  - U3 is a source-pinned re-derivation from per-role totals.
  - Pre-GO planning includes the owner reservation.
  - The precheck digest excludes volatile ancestor fields.
  - The target-chain check replaces a full-set claim the `entry` observation cannot meet.
- **C0-only signing:** a fixed second export shares the helper's single key and sign site, with a stated guard revision and in-memory public-vector tests in 4-B.
- **Continuation:** the plan's rule is kept; a cleanly settled FAIL/BLOCKED continues.
- **Load order and probe:** worker launch and addon load (LAUNCH/READY) precede fixture creation, and a fixture-free 4-D probe stage was added.
- **Windows and timers:** settlement and teardown have separate windows, timers are referenced, and the worker holds a handle while the query is pending.
- **Pins and checks:** the runtime module closure, the Node binary and eager worker imports are pinned. Pin checks have a cost budget, and the ACL listing is asynchronous and bounded without signals.
- **Transport:**
  - "submitted" is defined, and delivery wording is limited to kernel-buffer acceptance.
  - OBSERVED is saved in the report, with only its digest in receipts.
  - The stop-summary worst case is enumerated.
  - The v1 events `worker_prepared` and `run_outcome` are placed in the ordering.
- **Disclosed OS side effects:** sanitizer options with a classified exit code, crash reports and macOS's `/tmp` cleaner.
- **Gaps and overclaims:** the missing clock callbacks, first-case index writer, uncalled `finishTeardown`, unref'd timers and single `js_sha256` were added to the gaps table. Overclaims about independent worker pin checks and per-supervisor process counts were corrected.

Claims about macOS library validation, sanitizer exit behavior, crash-report submission and the `/tmp` cleaner come from documentation and reasoning; none was checked by execution.

## 4-A Pure Contract Implementation

2026-10-28 JST, implementation based on `d3550a1`, prepared for the user-approved local commit after independent review. Only four new pure helper modules and two memory/source test modules were added; existing v1 contracts, worker/adapters, product/native/build sources and package scripts are unchanged. These models accept bounded supplied data; they do not sample clocks, inspect files, start children, create fixtures or mint a live capability. Descriptor copying rejects getters and executable values; it is not isolation against hostile Proxy reflection.

| Module under `test/helpers/` | Supplied-data contract |
|---|---|
| `unsignedControllerData.mjs` | Strict bounded data, canonical JSON/LF, SHA-256, immutable snapshots and always-false authority flags |
| `unsignedControllerContracts.mjs` | v2 launch/setup binding, protocol/write ledger, narrow shutdown lane, independent phase windows and geometric/event/time/owner reservations |
| `unsignedControllerObservation.mjs` | Bounded OBSERVED projections, explicit availability, byte comparisons and source-constrained cause checks; known direct assertions remain BLOCKED |
| `unsignedControllerEvidence.mjs` | Ordered/read-back receipt model, candidate report, terminal receipt, case closes, index row, limited replay, fixed cohort order and serialization bounds |

The launch binding has `setup: null`: it does not guess a future random basename or registration hash. PREPARE seals exactly one actual fixture name/recipe/registration/envelope after READY, validates the unchanged configuration contract, and changes only that binding component. The outer protocol is v2 while the nested fixed recipe request remains C-C1a/v1. Every later frame retains the full binding. Write intent, write start and completion stay separate; only write start marks GO submitted, and completion is not a worker acknowledgement.

Normal progress is permanently stopped on protocol failure. The shutdown-only planner may consume one original CANCEL and one original command close; it shares frame/ordinal accounting and cannot resume GO, teardown or FINALIZE. Unknown pipe/binding, no remaining settlement time, a pre-GO stop, spent cancellation, or an accepted RELEASED or FAILED (the query has already ended) gives CLOSE_ONLY. An accepted but unwritten ordinary CANCEL is that one cancellation: the shutdown lane may start the same frame and ordinal once. Late frames have four diagnostic slots, are hashed as received and never supply release authority. A genuine original RELEASED can still be modeled with no OBSERVED packet; missing projections do not manufacture facts or block that release. RELEASED refuses more authenticated than dispatched requests; a dispatched C1 is accepted for teardown but latched as a violation that stops the cohort. FAILED must match the lifecycle the worker was sent: phase by state, a created query only after a started GO write, and a `finalize` phase after RELEASED. FINALIZE requires the distinct modeled teardown completion. The command stream closes once, after a stop or on the normal FINALIZE path; an unconfirmed close is retained. A configuration refusal at PREPARE is recorded as `worker_configuration`.

Windows use supplied same-domain monotonic points only. Preparation/query/settlement/teardown are 120000/600000/60000/120000 ms, never refreshed; reporting uses the remaining declared cohort bound. A case starts only when the cohort bound still covers its 900000 ms worst case, so the cohort end can cut only reporting. Teardown needs a submitted query. A detected deadline keeps its stop latch while one original settlement grace can be inspected through `inspectShutdown`; ordinary progress and teardown remain stopped. Once a known deadline has passed, any refusal is recorded as that deadline at its own time; before it, a wrong-phase call is `window_order` and opens no grace. Clock-domain failure or rollback also poisons this narrow clock lane, shown as `clock_invalid`. Entering settlement after an expired query latches the deadline even when no earlier timer observation was supplied.

The projection distinguishes facts from inference. U1 compares original capture hash/count with both the independently supplied witness proof and fixed recipe bytes. A complete inventory must match the recipe's exact object counts and each role's lower bound of recipe files; an incomplete or sampled one is BLOCKED unless a row it does carry is wrong. U3 compares complete per-role totals and object counts with the sealed envelope, re-derives all exceeded dimensions using the pinned reader's pre-capture mapping, and requires only `maintenance_metadata`; a claimed blocker list alone is insufficient. A supplied configuration counts only after the unchanged configuration validator accepts it against the sealed registration/envelope digests. U4 additionally requires the supplied registration to be a valid registration that differs only in the data inode. Its non-data bound-object proofs are the supervisor's, not the worker's projection: their digests are committed in the `go_intent` (before GO) and `release_checked` (after RELEASED) receipts, and the report comparison carries the proof objects, which must match those digests and the sealed registration. An original diagnostic reporting an unconfirmed release is FAIL, as the plan requires. Usage, registration or proof data supplied for an unrelated case is a contradiction. Missing complete proofs yield BLOCKED; contradictory facts yield FAIL. Source-constrained inference never becomes a direct native error-location or C0 timestamp claim.

`direct_c0_transport_timestamps`, `direct_native_mismatch_location` and `direct_reader_usage_builder` are explicitly BLOCKED. All transport/retirement timestamps remain null. The new assertion result is not a replacement for `assessUnsignedNegativeModel`: 4-B must later combine that unchanged negative assessment, actual trace/phase facts, original ownership/release and runtime close checks. No 4-A MODEL_CONSISTENT value is a native PASS.

Receipt progress requires exact readback before its modeled effect. Root creation intent requires a READY digest; a created root with unknown proof can only be retained with its locator in a stop summary. As in v1, a refused append before the outcome is fixed writes nothing and becomes a recordable stop that the next stop summary must name, so a returned root whose result was refused still keeps its locator; a pending or unreadable write, a capacity refusal or a report-phase refusal ends the chain. A stopped candidate is one-shot, not replaceable. The baseline hash is computed from the recorded counters and worker clock domain, never accepted beside them. Stamps carry wall UTC/JST beside the monotonic point. Receipts retain only observation digest/count and trace digest/count; the report holds the projection, trace, bounded comparison metadata, the start and save stamps and the original baseline, outcome, release and teardown facts. Report and index rows carry a setup digest instead of the fixture name, and stop-summary locators stay only in the private receipts. A candidate outcome may be worse than its computed assertion result but never better; MODEL_CONSISTENT reports recompute that result against the binding instead of accepting an assertion hash alone, and a dispatched C1 forces FAIL. Report traces obey the protocol's single worker clock domain and order. Receipt links, prefix and terminal hashes cover exact canonical UTF-8 bytes including LF, not a JSON array of strings. Report and index self-close limitations remain explicit; replay requires the expected setup and never claims saved evidence, live approval, ownership, release or runtime completion.

Canonical maximum-field ceilings (all kinds checked, conservative combinations included):

| Value | Computed bytes | Unchanged cap |
|---|---:|---:|
| Worst receipt / six-detail stop summary | 7782 | 16384 |
| Largest complete frame / PREPARE | 62102 | 65536 |
| TRACE_CHUNK | 18450 | 65536 |
| OBSERVED complete frame | 18403 | 65536 |
| Largest schema-shaped report comparison | 14891 | 16384 |
| Candidate report, including comparison and assessment | 194365 | 262144 |
| Case index row | 3529 | 5290 |
| Reserved shared index, header plus 24 rows | 131056 | 131072 |

The report calculation enforces separate 16384-byte observation and comparison subcaps, a 4096-byte computed assessment subcap and 128 trace events at 1024 bytes; the comparison ceiling is computed from a maximal configuration, supplied registration and both proof sets. All seventeen receipt payload kinds and eleven frame kinds are included. Four stop summaries fit the reserved `4*n+16` event schedule; thirteen entries refuse. Eleven or twelve entries fit that receipt geometry, but their worst-case thirteen or fourteen observer calls would exceed teardown's fixed 120000 ms; only ten or fewer fit, and `teardown_worst_case_fits` is false otherwise, not an extended deadline. Current recipes have at most nine entries and eleven teardown calls. The v1 observer ACL/content budget is computed as well and leaves 1900544 bytes at twelve entries. Fixed-owner reservation remains 65536 bytes (U0: zero), separate from observer work and the unchanged native 256 MiB budget.

The cohort uses the unchanged plan's 24-case normal/UBSan order. Only a supplied cleanly-settled case with confirmed index readback can release a slot; clean FAIL/BLOCKED continues, retention/unknown state or a C1 violation permanently stops. A confirmed row keeps its own verdict (NOT_RUN included), index hash and bytes even when it stops the cohort. A later input cannot retry a retained case into clean settlement. Unstarted rows stay NOT_RUN, and an attempted case without a confirmed row remains FAIL/unindexed rather than being relabeled unstarted. Even a consistent replay or a supplied confirmed index close keeps runtime authority false.

Validation is direct main-thread Node execution, never npm/pretest/build. The new suite blocks child/worker launches, native loading, signing/key creation including WebCrypto, network, process signals, filesystem mutation and any read, listing or metadata access outside the helper and dependency roots before importing the models, and a test checks that these tripwires are live. They are process-wide, so the controller file runs in its own process (the default isolation). The source suite fixes exact imports/exports and detects executable/time/key/network/reflection mutations. No operational entry imports the new modules; both existing execution entries remain sealed. Final test counts and unchanged-state checks are recorded in the backlog. Independent review and subsequent corrections are recorded below, including the final re-review. Push, 4-B connection code, actual planner/owner wiring, C0-only helper changes, new build/probe/cohort and all real operations remain unperformed.

## 4-A Independent Review And Corrections

2026-10-28 JST: two read-only reviewers examined Contracts/Data and Observation/Evidence separately. Three P2 and two P3 findings were reproduced locally using only the supplied-data models. The original 492 passing tests did not cover these inputs. The user then approved corrections, not a commit or operational execution.

- **Malformed clocks (P2):** descriptor/schema rejection now poisons the clock and latches stop before rethrowing. A later valid point cannot resume progress or the narrow shutdown clock lane, including when the original stop reason was already a deadline. Existing deadlines and the first stop reason remain intact.
- **Write ordering and lifetime (P2):** a new original write start must be the earliest unstarted ordinal, match its command's lifecycle state, and precede original worker exit and command close. An unstarted CANCEL cannot be skipped by FINALIZE or started after release. Completion callbacks for writes already started need not arrive in start order and may still be recorded after stop; they do not acknowledge worker receipt.
- **Malformed write notifications (P2):** schema rejection now latches STOPPED before propagating the error. A replacement notification cannot turn the original model back into normal progress.
- **Late shutdown callbacks (P3):** a started original shutdown write may record one completed/uncertain result after command close or worker exit. New starts after either event, unstarted completions and duplicate results still refuse. The stop reason is preserved. Shutdown planning also checks the original ledger: unsent ordinal gaps, a known uncertain write or an observed worker exit force CLOSE_ONLY even if supplied qualification flags claim otherwise; no new ordinal or cancellation is spent.
- **Serialization ceiling (P3):** detail kinds may repeat under the unchanged schema. The old six-distinct-kind example was 4140 bytes but was not an upper bound. The calculation now validates each maximum-field detail variant, chooses the largest serialized variant for every slot, and reserves six such details and four such summaries. Its conservative record ceiling is 7701 bytes and report ceiling 191957 bytes. The schema, detail/error counts and all byte caps remain unchanged; duplicate details were not silently banned to make the old calculation pass.

Ten tests were added: eight exposed failures before their corresponding corrections, and two preserve valid delayed/in-order callback behavior. At this correction pass, the controller suite had 120 tests plus 10 source-boundary tests; the selected related suites totaled 502 passing tests, zero failures/skips. Direct main-thread execution performed no operational child launch, compiler/build, native load/read, signing/key creation, fixture I/O, move/delete or cleanup. Protected source/native/build/package/config hashes, the 436 existing artifact checks and Dot's PAUSED/config hash remained unchanged. No market/scenario/judgment/notification/retention condition was modified. Re-review and commit were pending at this point; the later result follows.

## 4-A Final Pre-Commit Review

2026-10-28 JST: the two read-only reviewers rechecked their respective Contracts/Data and Observation/Evidence scopes. Three additional P2 findings and one P3 timestamp-bookkeeping finding were reproduced and corrected before the user-approved commit:

- Protocol mutation methods now share exception capture, rather than protecting only `noteWrite`: malformed original failure/exit notifications also latch STOPPED. Existing normal-progress guards remain closed after stop; valid original shutdown/result bookkeeping still obeys its narrow per-method gates.
- Cohort mutation methods share exception capture too. A malformed or misbound case-completion notification retains the active original case as unknown, permanently stops the cohort and refuses a replacement completion or next case. Final metadata keeps that attempted case FAIL/unindexed and subsequent cases NOT_RUN; no slot is recovered from a repaired notification.
- The window model records the first supplied stop in `first_stop_ns`. A known expired phase deadline bounds that timestamp, as does the cohort deadline, including late settlement entry and reporting-transition failures. The original settlement deadline is first-trigger plus 60000 ms, not a delayed call plus 60000 ms; entering after expiry refuses without renewing it. An unqualified clock cannot make that timestamp usable as live timing proof.

Five further tests exposed the pre-correction failures and now pass. The final controller suite has 125 tests plus 10 source-boundary tests; the selected related suites total 507 passing tests, zero failures/skips. Both reviewers confirmed their fixes and reported no remaining actionable finding within their stated scopes. This is not validation of 4-B through 4-E or OS behavior.

The user authorized the local commit of exactly four pure helpers, two tests and these two repository documents. No push, build, signing, native read, worker/observer execution, fixture or product-data operation, MCP registration, production activation or Dot restart is included. The existing 436 artifacts, protected runtime/native/package/config files and Dot PAUSED/config hash were checked unchanged. Judgment and notification conditions remain unchanged.

## 4-A Second Independent Review And Corrections

2026-10-29 JST, on committed `c29fc04`. The verifying session's own review and two further read-only reviewers (Contracts/Data/windows and Observation/Evidence/cohort) found seven P2 and about twenty P3 issues. Every one was reproduced with in-memory probes. Removing protocol and window checks one at a time also showed that 46 of 50 such mutants left the 125-test suite green. The user approved the recommended corrections. The record above now describes the corrected models; earlier sections remain as history. In particular, the final pre-commit claim that a known expired deadline bounds `first_stop_ns` held only for deadline stops until this pass.

- **P2 corrections:**
  - A candidate outcome can no longer be better than its computed assertion result. A computed FAIL could previously be recorded as BLOCKED and indexed that way.
  - RELEASED refuses more authenticated than dispatched requests. A dispatched C1 now latches a violation, forces FAIL and stops the cohort, as "C0 Only Signing" requires.
  - U4 bound-object proofs moved from boolean claims in the worker's OBSERVED projection (which must precede RELEASED and so could not hold a post-RELEASED proof) to supervisor receipt digests plus proof objects in the report comparison.
  - U4 registrations are anchored: the configuration passes the unchanged validator against the sealed digests, and the supplied registration must be a valid registration differing only in the data inode. Replay requires the expected setup, restoring v1's anchor.
  - Receipt baseline hashes are computed from the recorded counters and clock domain, as in v1, not accepted beside unrelated counters.
  - A complete inventory must match the recipe's object counts and role lower bounds.
  - Most protocol and window refusals had no test that could fail. Targeted tests were added: frames refused only by the canonical or byte-cap check, write-start gates, once-only frames, PREPARE/GO/trace/RELEASED bindings, finalization and exit order, shutdown-lane preconditions and the window boundaries.
- **P3 corrections:**
  - **Shutdown lane:** no shutdown CANCEL after RELEASED or FAILED, and an accepted but unwritten ordinary CANCEL is reused once instead of forfeiting cancellation.
  - **FAILED:** bound to the lifecycle the worker was sent, with a `finalize` phase recorded after RELEASED.
  - **Command close:** one close is recorded on the normal FINALIZE path; an unconfirmed close is retained.
  - **Recorded facts:** configuration refusals are recorded as `worker_configuration`, and late frames are hashed as received.
  - **Windows:**
    - Stop reasons are classified by whether a deadline had already passed.
    - A case needs its whole 900000 ms worst case to start.
    - There is no teardown before GO.
    - `describe()` exposes `clock_invalid`.
  - **Assertions:**
    - Partial inventories are BLOCKED unless a carried row is wrong.
    - An unconfirmed original release is FAIL.
    - Unrelated usage/registration/proof data is a contradiction.
  - **Evidence:**
    - Pre-outcome append refusals are recordable as in v1, so a refused root result keeps its locator.
    - Report and index rows no longer carry the fixture name.
    - Report traces obey the protocol's clock and order.
    - Wall stamps, the save stamp and the report's baseline/outcome/release/teardown facts were restored.
  - **Cohort:** cohort rows keep a confirmed verdict, index hash and bytes, and accept NOT_RUN.
  - **Capacity:** the v1 observer budget is computed again.
  - **Tests and guards:** the source guard now catches timer, microtask, network and reflection routes, and the memory suite's tripwires now cover reads, listings and metadata outside the allowed roots, WebCrypto keys, network and process signals.
  - **Documentation:** the teardown entry ceiling (ten, not eleven) and the overclaims above were corrected.
- **Unchanged limits:** no byte, frame, time, receipt, report or index limit was changed, and the comparison subcap stays 16384 bytes. The largest schema-shaped comparison is computed at 14891 bytes. Recomputed ceilings are in the table above.

Validation used an addon-free `git archive` copy of `c29fc04` plus the uncommitted changes and `npm run build:package`. The controller suite now has 154 tests plus 10 source-boundary tests. Run against the old helpers, 112 of the then 153 controller tests failed, largely through the intended interface changes; more precisely, 84 targeted mutants, each reverting one correction or one previously untested check, were all detected. The unsigned/joint admission suites (782 tests) passed three times and under linux/win32 platform spoofs. CRLF sources, Node 20.19.6/24/26 and per-file `--test-isolation=none` all passed. The full unit suite passed 3574 of 3576 with only the two existing skips. No operational child, native load/read, compiler, signing, fixture, move/delete, product data, MCP registration or Dot change was involved. 4-B through 4-E still need separate approval.

## 4-B1 C0-Only Memory Signing

2026-10-29 JST, based on `f0d3040`. The user explicitly approved implementation of the C0-only entry and its memory/public-test-key signature tests. This is the first subdivision of 4-B, not approval for the rest of the sealed assembly, any build, worker/observer, native operation, fixture, signature file or operational unseal.

`test/helpers/fixedMemoryCheckpointOracle.mjs` now exports `enrollFixedMemoryCheckpointOracleC0Only(originalOwnerGrant, inventedState)`. Its fixed wrapper has exactly two arguments and no options, callback, key, packet, path or clock selector. It requires sequence `1`, the original enrollment tip and the existing published public-key fingerprint before creating the fixed RFC 8032 test key in memory. Both public wrappers use one private enrollment function, one original-owner mailbox consumer, one `createPrivateKey` site and one canonical checkpoint-domain `sign` site. The original export passes a fixed false profile and retains its controls, modes, report shape and behavior.

The new profile spends a monotonic attempt flag before examining the wall clock or signing. A non-C0 or repeated request is rejected before `sign` and closes the original owner. Cancellation of a delivered original C0 packet consumes that attempt without a signature; a signing exception closes the owner and cannot enable retry. No replay bytes are retained for this profile. Its frozen public object contains only `close`, `loseState` and `describe`: no `advance`, `setMode` or deferred completion. Descriptions report `profile: c0_only`, attempt-spent and successful-signature counts, but remain redacted, detached and non-authoritative. Attempt-spent is not proof that a signature succeeded; a signing failure may leave successful count zero. The original 65536-byte owner reservation is unchanged.

Validation as first implemented (counts and routing below were later changed; see the two correction sections that follow):
- Fifteen new memory tests exercise original bootstrap/reader/owner grants, real Ed25519 C0 authentication, C1-after-C0 and second-query refusal before another signature, cancellation, signing failure, strict initial state and arguments, hostile state getters, cloned/reported grants, state loss, redaction, reservation, U0 zero key/sign calls and legacy-control compatibility.
- The signer boundary suite now has nine tests (five added). It pins the two fixed wrappers and exports, sole key/sign/mailbox sites, guard/spent ordering and no runtime/worker/package use. Thirteen source mutations are rejected. Two extracted-function behavioral mutations independently show that removing the phase or spent check reaches a sign stub. The extracted C1-first check is a supplied-channel model only: the actual registry itself requires C0 first, while the real-grant test sends a valid original C1 after authenticated C0. These are not a second mailbox consumer or new injection APIs.
- The new memory suite installs child/worker, native-load, process-signal, filesystem-mutation, out-of-scope read/metadata, network, WebCrypto and private-key-export tripwires before helper imports. Actual private-key creation accepts only the published DER vector, and actual signatures accept only those memory keys and the original checkpoint domain. Signature/key bytes are not written or printed.
- The implementing checkout's stale common `build/` lacked the pure registry/probe JS; a fresh `npm run build` or `npm run build:package` emits it, as CI does. The first implementation therefore explicitly used the already-existing normal or UBSan JS set under `build/b3cc-validation/`, with no probing fallback, rebuild, native object load or live-build capability. The shared metadata helper and legacy signer test now honor that same strict C-C mode selector; absent C-C mode, prior routes are unchanged.
- The new 15 and legacy 28 memory tests pass separately against each JS set, and all nine boundary tests pass. The selected normal-side regression set totals 584 tests; the other JS mode adds 43 repeated cases. This is not an execution or qualification of the native UBSan addon. No npm/pretest/build or whole-repository test run was used.

Protected runtime/native/build/package/config files (2568), the 436 existing artifact hashes and Dot's PAUSED/config hash were checked unchanged. All judgment/notification/retention conditions remain unchanged. Remaining 4-B controller/builder/worker wiring, eager helper loading at real startup, actual GO sequencing and 4-C/4-D/4-E are not implemented or executed by this slice. Independent review, commit and push are not part of this implementation turn.

## 4-B1 Independent Review Corrections

2026-10-29 JST, against the uncommitted 4-B1 delta on `f0d3040`. Two read-only reviewers checked signer lifecycle/binding and test/routing/documentation separately. The lifecycle review found no actionable issue. The test review found two P2 issues, both corrected without changing the signing helper:

- **Standard test routing:** the new memory test defaulted an absent C-C selector to `normal`, changed the environment and required an ignored isolated build even in the standard unit-test glob. It now leaves the environment untouched, uses the common build (or the existing explicit B3-Bb/B3-Bc route) by default, and selects the exact C-C normal/UBSan tree only when explicitly requested. Imports and the read allowlist use the same base. A source-extracted, in-memory routing regression failed before correction and passes after it; no clean build or standard full-suite execution was performed, so that test is not an end-to-end CI qualification.
- **Concrete key export tripwire:** replacing `KeyObject.prototype.export` did not intercept the private-key subclass's own method. The fixed-key creation wrapper now patches each concrete private-key prototype before returning the key, with restoration at test end. A new self-check failed before correction and now verifies exact hook identity before invoking only that denying function on a plain fake object. It never calls real key export. The source guard also rejects literal bracket-access export calls; an added harmless source mutation was accepted before that correction and is now rejected. The fourteen source mutations are syntax/model tests, not execution of key export or other forbidden effects.

Fresh verification: the selected normal-side regression set has 586 passing tests (16 C0-only, 28 legacy and 10 signer-boundary tests included), no failures or skips. The other existing pure-JS mode repeats 44 memory tests successfully. Boundary tests run without selecting any compiled registry. Signatures use only the approved published test vector in memory; the denying-hook self-check consumes only its explicitly expected tripwire event. No native addon, build, operational child/worker, fixture operation, signature file, real data, MCP registration or production activation was used.

Runtime/native/build/package/config aggregate hashes (2568 files), all 436 existing build artifacts, and Dot's PAUSED status/config hash remain unchanged. Judgment and notification rules are unchanged. The user authorized a local commit after a clean final review; push and all remaining 4-B/4-C/4-D/4-E work are outside this request.

Final read-only re-review closed both P2 findings without further actionable issues. The lifecycle reviewer statically confirmed the concrete hook is installed before key return and the self-check cannot reach real export. The test reviewer directly confirmed the 16 memory and 10 boundary tests, then checked the correction records; the broader 586+44 runs and unchanged-state checks were performed by the implementing session, not independently repeated by that reviewer. This remains a 4-B1 memory/source qualification only.

## 4-B1 Second Independent Review And Corrections

2026-10-29 JST, against `b53a50b`. The verification session reviewed the commit and ran it in an addon-free `git archive` copy with `npm run build:package`. Two read-only reviewers then checked signer lifecycle/registry binding and tests/routing/tripwires/documentation separately. No P1 or P2 issue was found: at most one C0 signature, no C1 or post-cancel/close/loss/failure signature, and an unchanged legacy export were confirmed. The user approved correcting all P3 findings:

- **Registry liveness before signing:** the C0-only path checked only the helper's own flags, so a revoked registry entry could still be signed for when a reader left its request uncancelled. It now checks the original channel after spending the attempt and before the cancellation check, clock or `sign`; failure refuses unsigned and closes the owner. The real probe and joint reader already cancelled on revocation, so this is defence in depth. A test now reproduces the uncancelled case through the internal probe bridge; it produced 775 signed bytes before the correction and is refused without a signature after it.
- **Key lifetime:** the C0-only owner releases its private-key reference immediately after the single `sign` call, so "at most once" no longer rests only on the attempt latch. The legacy owner is unchanged.
- **Refusal reason and report:** closing the owner right after a refusal revokes the reader's query first, so the reader always records `b3ba_oracle_unavailable`; a second-query refusal was indistinguishable from owner loss. The owner report now keeps `c0_refusal` (`phase`, `repeat`, `unavailable`, `cancelled` or `delivery_failed`) and `signing_available`, and reports `mode: null` instead of the legacy `normal` mode name. Tests now expect the exact reader failure and the owner's reason. The report remains detached and non-authoritative.
- **Runtime tripwires:** recorders were arrow functions, so construction such as `new Worker()` failed as a non-constructor before recording. They are now constructible, and accessor exports are shadowed rather than assigned. Newly blocked are `ChildProcess`, `process.execve`/`binding`/`_linkedBinding`/`getBuiltinModule`/`loadEnvFile`, `Socket.prototype.connect`, HTTP/2, DNS lookup/resolve/reverse, inspector `open`/`Session`, fs stream constructors, `glob`, `statfs`, `watch`/`watchFile`, `mkdtempDisposable` and `openAsBlob`. A new test calls and constructs every installed recorder, requires specific targets to be present and checks out-of-scope reads. The 4-A controller memory suite had the same recorder form and receives the same correction. Tripwires remain a second line of defence and are not a complete sandbox. They are process-wide and are restored only after the file, so these files rely on the default per-file process isolation; running several files together with `--test-isolation=none` is unsupported.
- **Static helper guard:** key-export detection now covers any `export`/`exportJwk` reference, including `.call`, parenthesised and literal-key forms. The helper may use `process` only for the build-route environment reads before its first module load, may use non-numeric element access only as `process.env[key]` there, and may not name additional storage, scan, stream, binding, worker, reflection or WebCrypto identifiers.
- **Build routing:** the helper, shared fixture, legacy signer test and C0-only test are now evaluated together for the same standard, B3-Bb/B3-Bc and C-C routes and the same refusal of invalid or conflicting C-C modes; the legacy test now validates the mode itself. Environment use in these files must be read-only and inside the route statements, so a bracket-form or dotted write is rejected. Mutations that drop the fixture refusal, fall back silently to the common build, or write the selector are detected.
- **Legacy cancellation:** a legacy test now shows that refusing a cancelled delivered packet leaves the legacy owner usable for a later signed query, so the C0-only close cannot leak into the legacy profile.
- **Documentation:** the first-implementation record above now states that its counts were superseded and that only the stale local `build/` lacked the pure JS; the status line names the correct starting commits.

Validation used an addon-free `git archive` copy of `b53a50b` plus the uncommitted changes and `npm run build:package`. Against the `b53a50b` helper, 12 of the new or changed signer tests fail. Thirty-one targeted mutants of the helper corrections, tripwire recorders/targets, routing refusals and fallbacks are all detected. The C0-only memory suite has 18 tests, the signer boundary suite 11 and the legacy signer suite 28; the 4-A controller suite keeps 154 tests plus 10 boundary tests. Final suite and platform results are recorded in the backlog. No native addon, build in the repository, operational child/worker, fixture operation, signature file, real data, MCP registration or production activation was used. Push, the remaining 4-B assembly and 4-C/4-D/4-E still need separate approval.

## 4-B2 Memory Composition Implementation

2026-10-29 JST, based on `b5eb7ea`, after explicit approval of 4-B2 implementation and memory tests only. Signing was expressly excluded in this slice: neither the new tests nor the selected regressions invoke a signer or create a key. No older signing-test approval is reused.

Implemented files:
- `test/helpers/unsignedCohortAssemblyModel.mjs` exports only `createUnsignedCohortAssemblyModel`. It owns existing 4-A protocol/window/evidence/cohort instances behind one coordinator, with one current identity-only case token. It exposes no child model or live-resource issuer.
- `test/helpers/unsignedCohortRuntime.mjs` exports only `inspectUnsignedCohortAssembly` and an unconditional `executeUnsignedCohortAssembly` refusal. Execution has no parameters and does not inspect arguments; even original model tokens and hostile argument getters cannot enter it. No operational entry imports it.
- `test/unit/nativeBarAdmissionUnsignedAssembly.test.mjs` and `test/unit/nativeBarAdmissionUnsignedAssemblyBoundary.test.mjs` cover memory behavior and fixed source boundaries. Existing 4-A/4-B1 code, inert entries, build inputs and scripts are unchanged.

The model interface follows the proposed signatures. The strict event envelope is `{ kind, payload, at }`; tags and payload validators are fixed:

| Tags | Existing validator or additional fixed gate |
|---|---|
| `frame`, `write` | Exact v2 frame bytes / original `noteWrite`; PREPARE setup must match confirmed setup, GO must match the same confirmed baseline/intent; only GO write-start starts the query window |
| `receipt`, `receipt_readback` | Original evidence append/readback and the same parent timestamp; baseline/outcome/release must agree with the owned protocol model, root intent is bound to the original modeled READY frame hash |
| `resource` | Strict worker/observer/helper attach/close observations; slots are model-only, worker is attached once, observer calls are at most 64; no caller FD/PID/path/backend. Fixture presence/absence comes from receipt readbacks, not a generic close flag |
| `command_close`, `worker_exit` | Original protocol close/exit schemas, requiring the original modeled worker slot |
| `report`, `report_readback`, `case_closes`, `index_row`, `index_readback` | Original report/close/index contracts; no caller override of verdict, clean settlement, index digest or bytes |
| `shutdown_plan`, `shutdown_write`, `late_frame` | Original stopped-query CANCEL/close ledger and window; eligibility is derived from owned state, no supplied qualified booleans; late frame hashes/counts keep existing bounds |

Every mutating refusal latches the first failure and stops the cohort; later matching data cannot repair it. Partial child-model advancement stays visible instead of being rolled back. Case clocks share one origin/domain/end and a coordinator-wide last timestamp, so case turnover cannot refresh the cohort bound or hide a rollback. Original deadline stops anchor settlement grace to that deadline, not to late processing. Unknown closes retain slots and prevent later cases. Clean modeled FAIL/BLOCKED cases continue; a C1 violation preserves its final FAIL row after clean teardown and then stops all later cases, as 4-A requires.

`finishCase` derives its conjunction from the owned release/absence/worker-finalization/exit/command-close/case-writer/index states and all resource slots. The cohort model keeps shared-index ownership across turnover. After a retained run's index has closed, only late original resource-close, already-started write results, command-close, worker-exit and diagnostic facts remain recordable; creation, dispatch, evidence writes and case progress remain forbidden. This records disposition without reopening the index or asserting runtime completion. No real resources are created by any of these model events.

Initial capacity used the corrected 4-A planner and fixed maximal field sizes: **15909 / 16384 diagnostic bytes** and **46076 / 65536 coordinator JSON bytes**, superseded by the review-correction figures below. This includes the bounded diagnostic projection, seven necessary confirmed-receipt payload caches, fixed source/mode pins, at most 24 exchange/nonces and conservative fixed overhead. The coordinator retains no second full transcript, fixture recipe content or raw report/index copy. Child-model reservations remain separate. These are serialized-payload bounds, not a measurement or guarantee of V8 heap/peak process memory, and do not spend or change the native 256 MiB envelope, per-owner reservation, frame/evidence limits or product retention policy.

Initial validation evidence (counts superseded by the review corrections below):
- 71 new memory tests and seven source-boundary tests pass, including one consistent supplied scenario, all 24 ordered cases, clean FAIL/BLOCKED continuation, no authority promotion, stopped evidence, reference/clock/pin/readback mismatches, exact whole-case-time and late-frame byte bounds, retained closes and index finalization.
- Thirteen targeted behavioral mutations are detected. The test extracts only the approved pure module statements into an in-memory compiled function, passes the existing pure contract dependencies, first confirms the unchanged extraction against every probe, then removes one guard at a time. No mutated file is written and no effect-capable mutant is executed. Separately, 24 effect/import/export/clock/reflection source mutations and three seal mutations are rejected by syntax guards.
- The new suite installs the corrected constructible effect recorders before helper imports and self-tests every recorder as a call and constructor, plus forbidden content/metadata/realpath reads. Keys/signing, native loads, children/workers, network and filesystem mutation are blocked. Tripwires are secondary protection, not a security sandbox; each process-wide test file is run alone.
- The selected regression set totals **621 passing tests, zero failures/skips**, using main-thread, individual `node --test --test-isolation=none` invocations. It includes only pure/memory/source suites, including the source-only signer boundary; actual signer memory suites, build/npm/pretest, native/joint-reader execution and the whole repository suite are not run.

Protected runtime/native/build/package/config content hashes (2568 files), the 436 existing artifact hashes/sizes/modes and Dot's PAUSED/config hash are unchanged. Only two new helpers, two new tests and the two repository documents are changed. Judgment/notification conditions remain unchanged. Independent review, commit and push are not performed in this implementation turn. 4-B3 through 4-B6 and all 4-C/4-D/4-E operations still require separate approval.

## 4-B2 Independent Review Corrections

2026-10-29 JST, review of the uncommitted 4-B2 implementation on `b5eb7ea`. Two read-only reviewers separately checked cross-model lifecycle coupling and tests/capacity/seals. They reported six P2 issues and two P3 timing inconsistencies. The implementing session reproduced them in memory/source-only tests and corrected only the new coordinator/test files, not any existing 4-A/4-B1 or operational helper:

- **Shutdown write-start qualification (P2):** planning CANCEL did not qualify its later write-start. Write-start now rechecks the original shutdown window, permanent clock validity and any original write that became uncertain after planning. A failed recheck cannot start or retry that write. Completion/uncertain notifications for an already-started write remain recordable after a stop, close or worker exit.
- **Evidence after stop (P2):** the coordinator stop was not coupled to the evidence model, allowing a consistent candidate/report/index after stop. If no candidate had been fixed or emitted, new failure-only finalization now requires a confirmed summary of the primary stop and a FAIL candidate. If a candidate was already fixed or pending, new evidence construction freezes: existing emitted readbacks and close facts may be recorded, but no new report, terminal receipt or index row is made. No old bytes or outcome are rewritten to disguise the stop.
- **Malformed clocks (P2):** strict outer-envelope rejection happened before clock-invalid tracking. Timed input now validates its timestamp through the shared point function; unparseable envelopes also conservatively invalidate timed dispatch. A later valid stamp does not restore clock qualification. Every malformed-clock case uses close-only shutdown.
- **Late original write results (P2):** the stopped-event allowlist rejected an original GO uncertainty, hiding it from the ledger used for CANCEL. Only completion/uncertain results for an already-started original write are now forwarded to the unchanged 4-A ledger. A new start, duplicate result or invented ordinal still refuses. Late uncertainty affects both subsequent planning and an already-planned CANCEL's write-start.
- **Confirmed stopped-case index rows (P2):** immediately stopping the inner cohort made it impossible to record a confirmed failure index row, which later appeared unindexed. The outer coordinator stop remains immediate and irreversible; the private cohort's stop is deferred only while the original active row can be accounted for. `finishCase`, or a flush before `finishNotRun`, records the confirmed original row once and then stops the cohort. It never starts another case. Unknown resource slots stay retained; recorded row digests/verdicts are not reconstructed or changed.
- **Literal constructor reflection (P2):** the new source guard missed a Function-constructor route via `Object.getOwnPropertyDescriptor` and a literal `"constructor"` argument. The existing 4-A refusal of that call/new argument form is now mirrored. Both helper guards include the regression source mutation. No effect-capable mutant was executed.
- **First-stop time (P3):** an explicit stop handled after the original deadline recorded the processing time outside but the deadline inside the window. Deadline classification and first-stop trigger now agree on the original earliest known bound; late processing cannot extend settlement grace.
- **Final index-close time (P3):** a close observation after cohort expiry now records the actual close outcome but latches the expired cohort deadline. It cannot look like an on-time completed cohort.

Adjacent callback/finalization checks exposed and closed further gaps within those same boundaries. Original pending absence/worker-finalized readbacks now record known facts without entering normal teardown/report progression after stop. A pending index readback prevents `finishNotRun` from prematurely declaring its row unindexed; the original callback must resolve first. After NOT_RUN finalization, no new receipt/report/index construction is allowed, although prior emitted readbacks and original close/write callbacks remain recordable. Thus a later-created index cannot contradict the finalized unindexed row. Unknown or failed evidence is retained, not repaired, reset or replaced.

The first twelve added lifecycle repro tests failed on the reviewed snapshot and pass after correction. Two pending-receipt controls and the pending-index/NOT_RUN construction tests were also observed failing before their respective fixes; three additional positive controls cover the already-fixed boundaries. The original thirteen behavioral guard-removal tests still detect their mutants. Static tests now reject 26 effect/import/export/clock/reflection variants and three seal variants. Effect-capable mutants are syntax-only; pure behavior mutants stay in memory.

Current capacity mirrors the three added diagnostic booleans (`evidence_frozen`, `stop_recorded`, `row_recorded`): **15976 / 16384 diagnostic bytes** and **46143 / 65536 coordinator canonical-JSON bytes**. No limit was raised, and these remain payload bounds rather than heap measurements. The selected regression set passes **640 tests**, including **90 memory + seven boundary tests**, with no failures/skips. All files are run individually on the main thread; signing/key creation, build/npm/pretest, child/worker, native/fixture/real-data operations, MCP registration and production activation remain unperformed. The protected 2568 content hashes, old 436 artifact hashes/sizes/modes and Dot PAUSED/config hash stay unchanged. Final independent rechecks and the requested local commit are recorded after verification; push and 4-B3 onward are outside this request.

Final read-only rechecks: both reviewers report no remaining actionable findings in their assigned scopes. Each independently ran the 90 memory and seven boundary tests successfully; the lifecycle reviewer included pending-index and post-NOT_RUN behavior, and the test/capacity reviewer checked the final correction records and unchanged ceilings. The broader 640-test run and protected-state hashes were verified by the implementing session, not independently repeated. The user-authorized local commit contains only the two new helpers, two new tests and these two repository documents. No push or operational unseal is included.
