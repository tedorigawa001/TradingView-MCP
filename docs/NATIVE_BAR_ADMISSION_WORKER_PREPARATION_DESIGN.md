# B4-C Worker Preparation Connection

C2a commit review update, 2026-11-01 JST: the [commit review correction](NATIVE_BAR_ADMISSION_WORKER_STARTUP_CONNECTION_DESIGN.md#c2a-commit-review-correction) refuses an exhausted shared frame before any reservation or decode, requires reachable READY/FAILED/PREPARE frame counts, refuses a withheld READY with a pending PREPARE, isolates every startup gate with single-condition tests and mutations, and builds the boundary inventories from syntax. Budgets, capacities, schemas and parent behavior are unchanged. Dot remains PAUSED and no operational action was performed.

C2a independent review update, 2026-11-01 JST: [two read-only reviews and test-only corrections](NATIVE_BAR_ADMISSION_WORKER_STARTUP_CONNECTION_DESIGN.md#c2a-independent-review-and-corrections) leave no remaining actionable findings. Three P2 coverage gaps (self-derived guard inventory, masked handoff decision, absent setup-bearing FAILED branch) are closed with independent sink checks and positive/negative mutation controls. Contract/helper logic and all existing limits/seals are unchanged; the implementing session reruns eight files / 783 tests (new 72/5), detecting 8 behavioral/19 static mutations. Shared definitions textually match `0ca489a`. Dot PAUSED with full configuration hash unchanged; no operational actions or C2b/c/d activation. Earlier implementation counts and pending-review statements below are historical.

C2a implementation update, 2026-11-01 JST: the separately approved [pure startup/shared-wire/capacity slice](NATIVE_BAR_ADMISSION_WORKER_STARTUP_CONNECTION_DESIGN.md#c2a-implementation-and-memory-verification) adds no worker or runtime connection. Existing parent wire schemas/parser are shared without changing admission rules; the new strict binding, supplied work/handoff and capacity checks are memory-only. Eight selected files pass 779 tests (new 69/4), diagnostic reservation 4371 bytes, retained/transient 393216/4259840 within unchanged envelopes. Record reader/runtime producers and parent-wrapper capacity remain unavailable, C2b/c/d pending; independent review/commit not performed. Dot PAUSED, judgment/notification conditions unchanged and no operational action.

C2 design update, 2026-11-01 JST: the [startup/READY connection detail](NATIVE_BAR_ADMISSION_WORKER_STARTUP_CONNECTION_DESIGN.md) uses `0ca489a` and splits C2 into C2a pure/shared-wire contracts, C2b sealed stream/clock/lifetime/status plumbing, C2c fixed record/pin/import/cache connections and C2d memory composition. The 4 MiB canonical record has no reviewed bounded worker parser within the unchanged buffer envelopes; that producer and initialization/host qualification remain explicit gates before C2c. Recommended next approval is C2a only. This update implements no connection, performs no operational action and leaves Dot PAUSED and judgment/notification conditions unchanged.

Status: **B4-C1 implemented, memory-tested and independently reviewed after corrections; all C2/C3/C4 connections remain pending**, 2026-11-01 JST. The [C1 independent review/corrections](#b4-c1-independent-review-and-corrections) supersede the initial [implementation checkpoint](#b4-c1-implementation-and-memory-verification) below, and the [commit review correction](#b4-c1-commit-review-correction) supersedes their status-stream rules and test counts. Design source baseline: `2f2a9ab`, including the B4-B5 stopped-write correction in `2c2a484` and reviewed B4-B6 `230cc63`. This refines [B4-C](NATIVE_BAR_ADMISSION_WORKER_TRANSPORT_DESIGN.md#proposed-implementation-slices), not the separately gated operational **4-C**. The [parent connection](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md) and its [latest correction](NATIVE_BAR_ADMISSION_PARENT_CONNECTION_DESIGN.md#b4-b5-and-b4-b6-commit-review-correction) remain controlling.

The original request authorized documents only; the later approval covers C1 pure contracts and memory tests, not connection code. No real port/clock/timer, build, operational subprocess, native load/read, fixture operation, signing/key operation, signature-file output, real-data operation, MCP registration, production activation or Dot restart is performed. Dot remains PAUSED; judgment/scenario/notification/mail/retention rules, observation bands, confirmation counts and delivery conditions do not change. Design or model acceptance never issues operational authority.

## Baseline And Missing Connections

| Source | Current reusable contract | B4-C limitation |
|---|---|---|
| `unsignedControllerContracts.mjs`, `unsignedControllerData.mjs` | Strict v2 directions/bindings/ordinals, required READY domain, configuration/baseline schemas and unchanged limits | Parent admission is not a worker dispatch loop; do not instantiate a second parent admission owner inside the actual worker |
| `unsignedWorkerConfiguration.mjs` | Strict registration/envelope/recipe hashes, nonce-related setup input, ancestor and object constraints | Valid supplied data does not prove a live fixture, original bootstrap or human approval |
| `unsignedWorkerTransportContracts.mjs` | Bounded frame encoder, pure transport/lifetime models, default-unreferenced ports and one entangled close | Reference models are test oracles, not runtime factories or authority |
| `unsignedCohortQualificationContracts.mjs` / `unsignedCohortRuntime.mjs` | Paged closed-set/work contracts and sealed original-build/parent connections | Worker source, complete worker closure, actual work plan and host/profile producers are still unavailable |
| `unsignedInertAdapters.mjs`, `test_unsigned_worker.mjs` | Earlier facade/bootstrap algorithms and sealed legacy entry | Do not activate the empty legacy registry, reuse lazy GO imports, unrestricted owner selection or its unreferenced timers |
| `nativeBarAdmissionJointReader.ts`, fixed-owner helpers | Original bootstrap/reader and separately reviewed C0-only owner boundary | No compiled import, bootstrap, owner, query or signature may be invoked in B4-C1 |

The distinct new `native/native_bar_fs/test_unsigned_cohort_worker.mjs` is referenced by the private parent launch contract but does not yet exist. Its eventual source must be part of a future fresh closed build; the 436 old artifacts do not qualify it. B4-C does not replace B5 setup/readbacks or B6 original allocation, open parent launch/command issuers, change native protocol 6, or change the v1 worker.

## Proposed Slices

Each row is a separate implementation and review boundary, not execution permission. These names are proposed here; no B4-C code is implemented by this design.

| Slice | Deliverable after approval | Validation scope |
|---|---|---|
| **B4-C1 (recommended first)** | Pure preparation subject/fact contracts, one-attempt preparation model, bounded status/lifetime references and exact capacity/work planning | Main-thread supplied-data tests, isolated parser/source guards and independent reference schedules; no executable worker connection |
| **B4-C2** | Distinct sealed worker facade and unreachable startup/LAUNCH/pin/import/clock/lifetime/status-write connections through READY | Extracted private declarations with fake modules, pipes, clocks, timers and ports only; no real import/load or effectful producer |
| **B4-C3** | Unreachable strict PREPARE/configuration/public-material/bootstrap/baseline connections and pre-GO failure disposition | Invented original bootstrap/addon results and asynchronous stop cuts only; no key, native bootstrap, fixture or signing invocation |
| **B4-C4** | Single-worker preparation composition, parent compatibility and source-boundary verification | Compare the actual extracted connections with independent reference predictions through BASELINED or failure; no full GO/session/cohort acceptance |

B4-D owns original GO/owner/query/cancel/release/finalize behavior, including the post-RELEASED ordinary CANCEL no-op. B4-E owns later parent/worker session composition. B4-C2/C3 must implement enough pre-GO EOF/error/stop handling to retain or dispose of their own acquired resources safely, not leave preparation failures to an absent GO path. The observer/fixture/evidence/index/teardown authorities remain **4-B5**, and complete 24-case acceptance remains **4-B6**.

## Original Worker Ownership

The future private root owns one invocation, the original inherited command/status streams, one local monotonic domain/origin, one preparation stop latch, one fixed mode/launch binding, one decoder, one pending status write, one bootstrap attempt and one lifetime pair. It has no caller backend, arbitrary path/FD/argv, replacement session, retry or serializable capability. A digest, environment value, nonce, PID or public packet conveys correlation, not human approval or cross-process original-object identity. Controlled local launch/non-malicious same-UID remains the explicit assumption.

The parent retains the sole B2 admission owner and authoritative shared frame budget. Worker-local command validation must reuse the strict v2 shapes/directions/sequence rules, with one bounded pair of next-ordinal counters (one per direction) and local checks against the same 32-frame total, not a second parent write or teardown ledger or an extra frame allowance. Shared extraction of existing wire validators, if required, must be separately enumerated and boundary-reviewed in C2; do not loosen schemas, add a wire variant or copy a competing protocol implementation. C1 accepts normalized **supplied preparation facts**, not arbitrary wire frames, and makes no decoder-acceptance claim.

Every asynchronous continuation captures its original session/action reference. Recheck identity, generation, stop, local time, lifetime references and unchanged binding after each await and before the next original action. Spend the one attempt before dispatch, not after a successful return. A late return is retained as its own original resource fact; it never repairs the stop or grants progression. Copied/foreign/retired model references cannot identify an original action, and model references are never accepted by the runtime.

## Startup And Preparation Order

| Checkpoint | Required original facts in the later connection | Failure/uncertainty |
|---|---|---|
| Invocation | Entry remains sealed until separately reviewed unseal; fixed channels, local clock/latches and referenced preparation supervision precede effectful startup | No environment/argument unlock; unavailable clock prevents timed progression |
| LAUNCH | Complete canonical parent frame, original channels, exact mode/source/patch/nonce/artifact binding and null setup | Before valid LAUNCH, no attributed FAILED; partial/invalid input consumes no replacement session |
| Closure/pins | Fixed record bytes/digest, role-tagged exact runtime/module/artifact set, host/profile and complete precharged startup work | Missing component stops; neither matching aggregate digests nor old artifacts substitute |
| Eager imports | Fixed selected addon/compiled contracts/registry/reader and both fixed owner-profile helpers resolved before READY; source-bound facade installed at the reviewed native-load/cache boundary | Import/cache/receiver mismatch stops; no first helper resolution at GO or fallback loader |
| Addon/lifetime | Actual synthetic-only/protocol-6 info; one original default-unreferenced pair, fixed listeners, explicit ref results and hasRef checks | No alternate anchor, retry/ref recovery, Worker or postMessage |
| READY | Once-only original status write with `pins_sha256 = digest(original launch binding)` and this worker's own bounded domain | Fixture setup/bootstrap/owner/query are still absent; callback is not parent receipt |
| PREPARE | Strict existing configuration, one null-to-sealed setup binding, original launch nonce and recipe/registration/envelope hashes | No changed launch field, arbitrary setup, unvalidated mutation or re-preparation |
| Bootstrap | Original validated public verification material and exactly one original joint bootstrap; no owner/reader/query enrollment | Failure retains any returned original handle and attempts its disposition once |
| BASELINED | Actual addon info plus original bootstrap describe result, strict resource strings, same READY domain and canonical baseline hash | Never fill zeros, expected catalog values, missing counters or a replacement domain |
| Handoff | Preparation and original BASELINED write disposition known, unchanged local session and bootstrap | A handoff is internal preparation state only; GO still requires B4-D and actual B5/B6 proofs |

Module membership/path/resolution/pins are fixed by the existing closed-set design, not supplied import URLs. The eventual exact import/export list, effect callsites, facade cache installation/restoration and failure unwinding must be recorded before C2/C3 implementation approval. Hidden module initialization costs or effects are included in that review. Eager loading owner helpers must not enroll an owner or materialize a private key. Public verification material is not permission to sign; C1 does not call even `createPublicKey`.

U4 applies only the existing prescribed supplied data-inode change and its consequent registration hash. First validate the original PREPARE configuration against the supervisor's original setup hashes; derive the U4 bootstrap binding separately afterward, as the existing `deriveUnsignedCaseBinding` algorithm does. Never replace those original setup/configuration hashes with the derived hash to make validation fit. Do not alter the supervisor's correct ownership/setup facts or expand this into a caller mutation option. Reuse the strict configuration and C-A validation; C1 represents U4 metadata in memory only. No fixture may exist at READY in the intended lifecycle; this fact must come from the later original B5 ordering, never worker filesystem scanning or a model boolean promoted to proof.

## B4-C1 Pure Contract

Proposed source scope: one new `test/helpers/unsignedWorkerPreparationContracts.mjs`, `test/unit/nativeBarAdmissionUnsignedWorkerPreparation.test.mjs`, `test/unit/nativeBarAdmissionUnsignedWorkerPreparationBoundary.test.mjs`, and the design/backlog references. No worker facade, runtime connection, runtime caller, package/CLI/MCP registration, native/src/build/config change or legacy worker edit belongs to C1. If shared validators need changes, stop and enumerate a separate scope rather than silently broadening C1.

Proposed exports (names fixed for the later boundary inventory):

| Pure export | Purpose |
|---|---|
| `planUnsignedWorkerPreparation` | Validate a strict bounded supplied startup subject and work projection; report missing components and pre-effect capacity status |
| `createUnsignedWorkerPreparationModel` | Apply normalized preparation facts with model-local original references, one-attempt latches, supplied local points and bounded snapshots |
| `describeUnsignedWorkerPreparationCapacity` | Produce worst-case encoded metadata/buffer/work arithmetic for the precise C1 schemas, without changing any ceiling |

Use a new model-only schema/scope `native-bar-worker-preparation-model-v1` / `unsigned_worker_preparation_memory_only`. Preserve the existing false authority flags (`execution_available`, `runtime_qualified`, `ownership_verified`, `native_release_verified`, `timestamps_verified`, `history_verified`, `evidence_saved`, `approval_authenticated`, `signing_available`, `cleanup_execution_available`) and `native_status: NOT_RUN`. A consistent model handoff is never named PASS, READY-for-execution or qualified-runtime.

The helper's permitted dependency closure is `zod`, existing data/configuration/qualification/transport pure helpers and their already-reviewed recipe/schema dependencies; pin actual imports and exports in its boundary test. Hashing/encoding supplied bytes is allowed, signing/verification/key creation is not. Do not import the runtime, inert adapters, worker facade, compiled build output, native addon or either oracle enrollment helper. The existing lifetime model is the only stateful reused helper; an independent parent protocol may be created by the test reference only, never supplied as the preparation model's backend.

### Supplied Subject And Facts

- Subject: fixed case/mode, expected launch-binding digest/nonce and expected closed-set/build-record/module-set digests, bounded parent-domain label for inequality only, independent supplied worker-domain/origin and original local end, plus supplied qualification/work-component summaries. Use existing label/hash/uint/strict parsing constraints. There are no parent monotonic points to subtract or translate.
- Component facts distinguish `unavailable`, `matched_supplied` and `refused`; missing never defaults to matched. Even all-matched supplied facts mean only model consistency. Exact source/patch provenance, host/profile, runtime closure and original producer qualification stay unavailable in imported runtime.
- A launch fact carries its normalized kind/direction/ordinal, binding digest and null-setup outcome. It tests consistency with the expected subject, not wire authentication. In C2 those facts must be derived from the exact validated original frame. No caller `approved`, executable function, stream, module, arbitrary manifest path or backend is accepted.
- Preparation facts carry the original session/action token, same launch nonce, strict existing configuration and sealed setup digests. Reuse `validateUnsignedWorkerConfiguration` for supplied fixture/configuration metadata only; do not accept its result as ownership. Full manifest rows use the existing qualification pages, never a larger generic parser or the command pipe.
- Addon info, lifetime/reference observations, bootstrap acquisition/describe results, resource counters, status planning/start/callback/close and stops are invented typed facts. Null stays unavailable; values for a different original action are rejected. Do not retain raw native objects, complete manifests, captured data or an unbounded event history in snapshots.
- Local state is bounded flags, counters, digests and original model tokens. Status READY/BASELINED/FAILED use existing payload schemas/encoder when constructing test candidates; C1 does not send them or spend a second parent's ordinal. Frame expectations are checked separately against the unchanged parent protocol in tests.

The returned model has only `record(fact)` and `describe()`; no run/send/import/clock callback. `record` takes a strict discriminated union, and only begin/reserve facts may return an out-of-band model action token alongside a frozen view. Tokens are excluded from serialized views and are not reconstructed from their fields. Required fact families are:

| Family | Minimum bounded fields and checks |
|---|---|
| Launch/startup | Normalized LAUNCH identity/ordinal/digest/null setup, supplied local point; fixed component name and unavailable/matched/refused result, original startup action token |
| Status | Fixed READY/BASELINED/FAILED kind, plan point and frozen payload digest/byte count; original action token for start, boolean-or-unknown return, callback outcome and independent close fact |
| PREPARE | Normalized original command identity/ordinal, unchanged launch digest/nonce, one sealed setup and strict supplied fixture/configuration metadata |
| Bootstrap | Reserve, acquisition returned/refused/unknown, original model bootstrap token if returned, addon/describe resource values and immutable baseline digest; disposal attempted/outcome recorded separately |
| Lifetime | Fixed existing allocate/listener/ref/begin-work/settle-work/close/notification facts, routed to the original reused lifetime model with its model tokens |
| Stop/terminal | Bounded first reason, qualified local point or explicit clock fault/null time; independent original late callback/close/acquisition facts, at most eight secondary codes |

Unknown tags/fields, wrong-direction input and fact-kind/action mismatches refuse; no permissive generic metadata bag or unbounded message queue. C1 does not add fields to READY, BASELINED, FAILED, the native protocol or persisted reports. Exact model-only field inventories and their maximal canonical instance must be committed together in C1, rather than deferring their capacity to C2.

### Model Transitions And Stop Disposition

These are worker preparation checkpoints, not replacement v2 wire states. Suggested tags: `NEW`, `LAUNCH_ACCEPTED`, `STARTUP_PENDING`, `READY_PENDING`, `READY_COMPLETE`, `PREPARE_ACCEPTED`, `BOOTSTRAP_PENDING`, `BASELINED_PENDING`, `PREPARED`, `STOPPED`. Each once-only action has separate reserved/started/returned/known-outcome facts; a phase tag alone never proves its callback or resource closed.

1. Spend launch/startup once and require the exact expected normalized subject. Before READY, all required supplied closure/addon/lifetime components must match. A missing/failed check latches the first stop and blocks every new forward action.
2. READY planning freezes its payload/hash/domain. A supplied write-start and known callback settle that original status action only. PREPARE may arrive after READY write-start but before its callback, as responses can overtake callbacks; validate and retain at most that one PREPARE, without starting bootstrap until READY completion is known. There is no unbounded command backlog, resend or second READY.
3. Spend PREPARE once before any asynchronous bootstrap work; validate configuration/nonce/setup exactly once. Reject duplicate or conflicting input even while the first action is pending. Reserve the bootstrap attempt before acquisition; retain an original returned handle even if a stop happened during its await.
4. BASELINED is constructed only from the supplied actual-result fields of that original bootstrap/addon in the same domain. Require READY completion, no pending status write and known bootstrap acquisition before its once-only write. `PREPARED` requires its known callback; it issues no GO capability. C1 refuses/records GO as outside its scope rather than authorizing it; C2/C3 may reserve at most the original early GO for B4-D, with a separately specified bounded handoff, not dispatch it.
5. EOF, input/status error, missing/foreign/rollback clock, expired original window, lost lifetime reference, invalid component or unknown write outcome irreversibly stop preparation. Malformed inputs cannot be retried into a new session; the first stop remains primary, with at most eight secondary codes.
6. Validated-LAUNCH failure may reserve at most one attributed FAILED candidate only if the original status stream/binding/time/budget remain known and no write is pending/uncertain. Unknown delivery never permits concatenation of a new frame. Before valid LAUNCH or after clock failure, withhold attributed output. This does not promise the parent accepts a worker's late failure as ordinary progress.
7. A pre-GO stop records one original bootstrap-close attempt if acquired, never an owner/query close that did not exist. Late acquisition must enter that original disposition, not leak a handle by ignoring the callback. Returned/throw/unknown and confirmed original completion are distinct. No retry, clock recovery, new grace, success evidence, parent cleanup or slot-retirement authority follows.
8. Reuse the existing lifetime model for supplied pair/reference/work/close facts, not a second port model. Ports remain retained while bootstrap or status disposition is pending/unknown. When every tracked original action is confirmed, only the original one-call/two-close-event rule may confirm the model anchor disposition. A missing event stays unknown; model close proves no OS lifetime.

Bootstrap acquisition success is **not** settlement of its lifetime work record. That record remains pending while the acquired bootstrap is live, including at `PREPARED`; only its confirmed original terminal disposition may settle it. Handoff retains the original pair/bootstrap/action references for B4-D, and does not close the anchor just because preparation and status callbacks completed. A creation refused before any resource existed may confirm only that attempt's known no-resource disposition. Unknown acquisition cannot be relabeled as no-resource.

## Clock And Status Reservations

Worker-local preparation starts once at supplied invocation origin, with the unchanged 120000-ms limit and its original local end. LAUNCH, READY and PREPARE do not reset it. The parent preparation started earlier at allocation and is enforced independently; local elapsed time never extends or reconstructs the parent's remaining time. Actual total-duration/host/work qualification remains blocked.

For a status/helper action planned at local point `t`, reserve `D = t + min(10000, floor((min(original_phase_end, original_local_end) - t) / 1000000)) * 1000000` nanoseconds. Refuse if the full-ms remainder is below one; actual start/callback must use that same reservation. It is not callback time plus a new allowance. All points are nondecreasing in the original worker domain; an equality-to-deadline result is late, regardless of whether the timer or callback is processed first. A later valid point cannot repair a clock fault.

C1 has no scheduling callback. It consumes supplied observation points, including explicit unavailable-time faults and untimed original completion facts. Test early/late timer notifications as supplied facts only; generation/segment and arm/ref/clear failure rules must be specified for C2's real-connection code without invoking it. No new interval, retry, timer renewal, parent-point conversion or synchronous-call interrupt guarantee is introduced. Phase/settlement/teardown timing remains governed by the existing worker/transport design; a repeated stop cannot restart settlement.

## Capacity And Work Gate

C1 must return measured worst-case values from actual proposed schemas, not guessed numbers in this design. Its implementation cannot be accepted with a placeholder capacity result. A limit conflict blocks the slice; unused capacity in a separate process or diagnostic is not a permission to enlarge the envelope.

| Account | Required calculation and unchanged cap |
|---|---|
| Wire | Canonical UTF-8 including LF: READY/BASELINED/FAILED complete-frame maxima within 65536, configuration within 60000, shared bidirectional total 32. C1's maximum three attempted status kinds are a subset, not three additional frames |
| Metadata | Exact maximum preparation snapshot plus reused lifetime view and wrapper, with longest allowed strings, nulls, false booleans, pending/unknown outcomes and eight close codes; fit the existing 16384 diagnostic and 65536 coordinator constraints. Avoid summing both model oracle and actual runtime snapshots as live state |
| Buffers | At most one pending 65536-byte status line and one bounded PREPARE payload; decoder pending 65536 and input batch at most `32 * 65536`. Charge configuration duplication, encode/copy peaks and build-record streaming explicitly; preserve existing 2375680 retained / 4259840 transient transport ceilings for that geometry |
| Manifest/record | Reuse B3's 4096 rows, 64 pages, 128 rows/page, 65536 page bytes, 2097152 manifest bytes, 4194304 complete record bytes and 67108864 per-file bytes; no command-sized full record and no uncharged retained record copy |
| Lifetime/resources | One pair/two ports, fixed listeners, one close call/two notifications and existing 37 work records (32 status plus bootstrap/owner/reader/query/release roles); no per-message anchor or extra query/owner |
| Work | Account record verification, exact startup module/addon/pin reads and digest/encoding work before each action, including failure paths and repeated starts across all 24 cases; one physical shared row still incurs every actual read cost |
| Global budgets | Same invocation-wide 2147483648 hash bytes and 131072 helper commands; native 268435456-byte and observer budgets remain separate, not borrowed for startup |

Planning distinguishes complete supplied totals from unknown actual qualification. Feed worker-startup cost into the existing parent invocation-total component once; do not allocate a fresh budget per worker or double-charge it as a different global allowance. For an absent worker closure/import-cost/native-profile producer, report an explicit unavailable component and leave runtime blocked. C1 can test invented complete, partial, exact-bound and over-bound plans; none qualifies this host or adopts saved outputs.

The baseline transport figure already includes buffers conservatively, but is not proof that a new manifest parser's heap fits. C1 must itemize whether each new object is an alias, retained copy, streaming chunk or transient copy and test its enforced size. If C2 requires an additional concrete buffer/metadata ceiling not derivable from existing geometry, request that decision before connection code, never fill the gap by estimation.

## B4-C1 Acceptance Matrix

| ID | Required reproducible memory/source case | Acceptance assertion |
|---|---|---|
| C1-01 | Ordinary preparation in both modes with invented nonzero addon/bootstrap counters | One launch/READY/PREPARE/bootstrap/BASELINED; consistent supplied handoff, all authority flags false |
| C1-02 | Missing/wrong case, mode, digest, nonce, setup-null condition, component or domain; malformed/extra field | Refuse before forward action, keep first stop; no default qualification |
| C1-03 | Unavailable/foreign/copied/retired original session, action, pair or bootstrap token | No new action or mutation of another original action's outcome |
| C1-04 | PREPARE before READY start; after start before callback; duplicate during pending/after completion | Premature refused, one overtaking input bounded, bootstrap waits for known original callback, duplicate stops |
| C1-05 | Wrong recipe/registration/envelope hashes, configuration bound, changed launch field and U4-only prescribed change | Existing strict validators agree; no new mutation or ownership authority |
| C1-06 | Missing/string-invalid/null/mismatched or nonzero counters; changed READY/BASELINED domain | Preserve supplied actual-result values; no zero/expected-value fill or domain substitution |
| C1-07 | Stop/EOF/error before and after each reserved/start/return checkpoint, including late bootstrap acquisition | No resumed work; late original handle enters one-attempt disposition, pending/unknown retained |
| C1-08 | READY/BASELINED/FAILED write false-return, duplicate callback, throw, error, partial/unknown outcome | One original status operation; callback not receipt; no resend, second pending write or uncertain-write concatenation |
| C1-09 | Local origin/preparation expiry, exact deadline, sub-ms remainder, callback/timer order, rollback/foreign/missing time | Original reservation/stop remain fixed; no cross-domain arithmetic, refreshed grace or recovered clock |
| C1-10 | Pair default-unreferenced, missing listener/explicit ref, lost ref, one missing close event, unknown close | Reuse lifetime refusal and one-call/two-event semantics; no replacement or natural-exit claim |
| C1-11 | Bootstrap refusal before/after acquisition, close throw/unknown, secondary overflow; invalid LAUNCH versus valid-LAUNCH failure | No nonexistent owner/query release, bounded errors, attributed FAILED only when eligible |
| C1-12 | Early GO/FINALIZE/CANCEL, legacy helper/worker path, alternate owner/signer/backend and new factory exposure | Outside C1; no effect or grant; full GO/cancel/finalize belongs to B4-D |
| C1-13 | Longest valid serializations and adjacent boundary values, escaped text/LF, max page/row/byte/work counts | Exact canonical accounting, equality only where existing rule permits, reject cap+1 without raising caps |
| C1-14 | 24-case repeated startup, same row in multiple roles, partial/missing work component and consumed failed attempt | Repeated actual modeled costs charged, global ceiling fixed, unknown operational plan remains blocked |
| C1-15 | Independent parent-protocol replay of READY/configuration/BASELINED candidates and rejected permutations | Existing strict v2 contract agrees; no parent ledger or prediction oracle supplied to the worker connection |
| C1-16 | Import/export/effect inventories and focused controlled mutations | Every intended guard removal fails its named assertion, not preparation/parser/import failure |

Tests must install real-effect denial before helper imports (including cached builtin aliases), leave a final swallowed-effect assertion, and use the B4-B6 isolated trusted-compiler parser instead of importing Node TypeScript before guards. No fresh VM is a grant to expose `process`, real clocks/timers/ports or a general backend. Construct all fixture-like metadata in memory; no fixture directory, native addon or compiled oracle import is needed. Run each selected file in the main-thread no-isolation mode, not a default runner that creates test children. No npm/pretest/build, operational whole-suite or signature suite belongs to C1.

Mutation preparation must establish one unique LF-normalized anchor, a real source change and valid syntax outside expected rejection assertions. Check the named behavioral/source failure, and retain a positive control; a missing anchor or setup error is a failed probe, not a killed mutant. Use independent known constants/schedules for the reference, not the model's own snapshot as its prediction. Test claims cover only the enumerated schedules, not exhaustive worker behavior.

### Exit Conditions

All C1-01 through C1-16 groups must have executed passing tests, exact reported capacity maxima and pinned exports/imports/authority flags. Critical stop, once-only, callback, domain, capacity and refusal guards need named effective mutations. Recheck existing controller/configuration/transport/lifetime/qualification/parent memory boundaries in an explicitly listed effect-free test selection. Review the diff against actual source, record test counts and limits without reusing historical success as current evidence, and obtain independent review before a later requested commit. Missing work/host/native/B5/B6 prerequisites must remain visible in imported runtime.

C1 completion permits **only** a later separately approved C2 implementation request. It does not authorize a worker entry, real scheduler/port proof, original cleanup, operational signature qualification, a build, the 24-case run or MCP/product integration. Full preparation compatibility is C4, full query/shutdown is B4-D, and operational qualification remains the separately gated 4-C/4-D/4-E sequence.

## This Design Turn

Changes made by this request are this document plus cross-references in the worker/transport design and BACKLOG. No model, runtime, test, build or job code is changed by this request. The pre-existing unrelated `test/unit/forwardPeriodReporting.test.mjs` edit and concurrent BACKLOG additions are outside scope and remain untouched. New-design/worker-document links and the added BACKLOG paragraph's link are checked read-only, along with whitespace, source-baseline correspondence and Dot's PAUSED/full-configuration hash. No tests with operational effects are run and no implementation success is claimed.

## B4-C1 Implementation And Memory Verification

2026-11-01 JST, separate C1-only approval on the above design. Implementation started from `2f2a9ab` plus this uncommitted design. An unrelated forward-period test/BACKLOG correction was committed concurrently as `a6bb530`; its changes were preserved and not included as C1 work. This record covers one new pure helper, two new unit tests and the three design/backlog documents, not a worker facade or runtime connection.

The measurements, test counts and pending-review statements in this section describe the initial implementation checkpoint. The independent-review section below records the corrected state; do not use the initial 9599/64399-byte or 122/4-test figures as the final result.

### Implemented Surface

`unsignedWorkerPreparationContracts.mjs` exports only the three planned functions. The model exposes only `record` and `describe`, uses 22 strict normalized fact variants, keeps original model tokens out of serialized snapshots and caps status records at the three fixed kinds, secondary codes at eight, one bootstrap attempt and the original lifetime pair/work records. It imports only the enumerated pure helpers. No runtime/source/native/package/schema/automation entry is changed or opened.

- The subject contains the supplied allocation, expected launch/closed-set/module digests, original worker-local origin/end, parent-domain label for inequality, six component statuses, bounded manifest summary and 24-case work summary. Its data is captured independently of caller mutations. Matching supplied facts are not actual source/host qualification.
- Startup costs include twelve starts in each mode, per-start build-record/module/pin/metadata reads and the per-start wire-hash reservation, plus the explicitly supplied other invocation costs. Exact equality to the existing 2147483648-byte/131072-command ceilings is tested. Unavailable components keep a named blocker; a refused pre-dispatch startup consumes its modeled reservation and records known no-dispatch, not an impossible outstanding callback.
- `record` bounds canonical fact encoding through the existing encoder. PREPARE reuses the strict configuration validator and correct original setup hashes before deriving U4's one supplied data-inode change and hash. Only normalized consistency is checked; no arbitrary frame is authenticated and no fixture is read.
- Status snapshots contain payload/digest and the existing full-frame ceiling, not a fabricated actual frame hash, write or parent receipt. C2 must derive the actual wire bytes and original channel observations. Static capacity calls reuse the existing disposable protocol calculation inside the transport-capacity helper; the preparation model retains no parent admission ledger and never routes its facts through one.
- READY write-start may precede a single retained PREPARE. Bootstrap waits for the known READY callback **and** boolean write return. A callback followed by a late/unknown synchronous return does not qualify the action. Every supplied timed input checks the original pending status deadline first, including an unrelated preparation input; a status-pipe close is sticky across all actions.
- The outer preparation stop latch and the lifetime model's own reference-failure latch are distinct. Only the narrowly allowed once-only FAILED candidate can begin after an ordinary outer stop, with fresh healthy original references and available original time/budget. A lifetime fault, invalid clock, closed status pipe or unknown previous write withholds it. No lifetime rule is relaxed, no new grace or ref recovery is added.
- Bootstrap acquisition is not lifetime settlement. `PREPARED` retains its original bootstrap work and pair for B4-D. An acquired bootstrap returned after a stop remains available only for one original close attempt; unknown acquisition/close or a missing port notification stays retained. Untimed original completion facts cannot restore progression, release proof, cleanup or runtime authority.

### Measured Schema Reservations

These are maximal canonical **schema reservations**, including mutually exclusive worst fields, not a reachable-state example, V8 heap measurement or OS qualification. Every status maximum includes the longer callback outcome and boolean encodings rather than substituting null. The reused full lifetime view reserves all 37 work roles even though C1 itself uses only bootstrap and status writes.

| Measurement | Result / unchanged bound |
|---|---|
| Preparation plus lifetime diagnostic | **9599 / 16384** bytes |
| Separate parent/preparation model-only comparison wrapper | **64399 / 65536** bytes, including the existing 54767-byte parent reservation; no actual coordinator field or merge added |
| READY / BASELINED / FAILED complete-frame ceilings | **2214 / 2270 / 3287**, each within 65536 including LF |
| Retained encoded-buffer reservation | **513216 / 2375680** bytes |
| Transient encoded-buffer reservation | **4259840 / 4259840** bytes |
| Lifetime pair / ports / work records | **1 / 2 / 37**, unchanged |

Retained buffers itemize three status-payload reservations, one bounded preparation input and its validation copy, decoder pending, one manifest page and the existing hash buffer. Transient buffers retain the bounded-input/validation/canonical-fact geometry. No full build-record copy is retained by C1. The manifest/record reader and real imported closure costs remain unavailable, not established by these supplied summaries; any additional concrete buffer requirement at C2 blocks pending a new decision.

### Executed Verification

Node 24.18.0, each file separately with `--test-isolation=none`, no npm/pretest/build or operational full-suite run:

- New memory tests: **122**, covering C1-01 through C1-16 families, all 24 catalog rows in memory, original references, strict configuration and U4, stop cuts/late acquisition, both write callback/return orderings, missing counters/domain, fixed deadlines and pipe/ref loss, failed/unknown closes, work limits, captured immutable input and independent parent-protocol candidate acceptance/rejection.
- New boundary tests: **4**, checking pure dependencies/three exports, seals/effect inventory, pre-import denial/isolated parser and absence of product/worker registration. The missing new worker source remains a deliberate blocker.
- Controlled behavioral mutations: **12** detected, with unmodified declarations as the positive control. Unique LF-normalized anchors, syntax and compilation are checked outside the expected behavioral assertion; setup failures do not count as kills. Mutations run only trusted pure declarations in memory with their exact imported pure dependencies, not a public injectable backend.
- Static boundary mutations: **11** detected, including effect/export/authority/capacity/refusal changes. LF and CRLF source guards both pass. New memory tests deny effects before helper imports and end with a swallowed-effect assertion; TypeScript AST parsing uses only the B4-B6 isolated compiler realm, not Node TypeScript initialization.
- The full explicit related selection is **23 files / 1314 passing tests**, zero failures/cancellations/skips: controller 209/12, assembly 144/9, transport 250/9, qualification clock 91, parent contracts 83/10, qualification connections 53/10, parent runtime 63/6, supervision 46/3, launch 45/3, writes 66/3, parent composition 70/3, preparation 122/4. These are scoped memory/source tests, not real worker/native acceptance. Historical older suites' parser-initialization limitations remain as recorded in the parent commit review; this slice does not silently repair those unrelated files.

Pending: independent C1 review and any requested commit; C2 exact import/native-cache/worker-source connection review; C3 original bootstrap integration; C4 actual private-declaration composition; B4-D/E and 4-B5/B6; real scheduler/port/host/work-profile and operational acceptance. No signing, fixture, saved evidence, native release or original cleanup success is inferred. Dot remains PAUSED with its full configuration unchanged, and judgment/notification/mail/retention conditions and numerical limits are unchanged.

Final read-only checks pass: syntax of all three added JavaScript files, 52 scoped document links/anchors, ASCII/newline/whitespace checks for the four new files and `bdo proxy git -c core.fsmonitor=false diff --check`. The 262 tracked source/helper/package files in the protected check have identical content hashes across final verification; the new C1 files are explicitly outside that existing-file set. Dot's full configuration hash remains `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1`, with status PAUSED. No existing source/model/native/package or operational setting is edited by C1.

## B4-C1 Independent Review And Corrections

2026-11-01 JST, user-requested independent review of the six uncommitted C1 design/implementation/test files on `a6bb530`. Two read-only reviewers separately covered state/original-reference/disposition semantics and capacity/work/effect/test boundaries. Their reviews and final delta reviews were static only; the implementing session executed all tests. Six P2 findings and one P3 coverage gap were addressed without opening a worker or changing judgment/notification conditions.

1. **Callback before original return:** the original code settled status lifetime work on its completed callback alone. A stop between callback and write return then allowed the pair to close with the return still pending. Settlement now waits for both observations, a completed callback and a known boolean return. Late known disposition may settle its original work but does not resume preparation.
2. **Pre-start pipe error:** stopping an unstarted write correctly changed its disposition to withheld, but lost the stream-failure gate and allowed a subsequent FAILED. A bounded sticky `status_error` code now independently refuses every later status plan/start. Error is not recorded as a fabricated close; original `status_closed` and callback facts remain separate.
3. **FAILED with invalid return time:** after a completed FAILED callback, an unavailable/foreign/rollback return point could still produce a completed decision because FAILED is the narrow stopped-path exception. An invalid-time return now leaves delivery uncertain while preserving its observed boolean return, original stop and terminal facts. No clock recovery or invented timestamp is added.
4. **PREPARE precharge order:** recipe/configuration hashing happened before its modeled debit, and failed validation skipped the debit. The encoded recipe length is fixed once in initial pure planning (only six alphanumeric locator characters vary). Each PREPARE now reserves its configuration/recipe validation allowance before constructing/hashing the per-fact recipe or invoking the validator. Insufficient allowance refuses before either call; a bad registration keeps the consumed reservation. This remains modeled accounting, not complete actual runtime-closure qualification.
5. **Direct listener denial:** blocking network factories did not deny direct `net.Server`/`dgram.Socket` construction or their original `listen`/`bind` prototypes. All four paths are now blocked before helper imports. Independent explicit inventory assertions precede sentinel-backed probes. Missing-guard reproductions fail the inventory or inspect source only; no stock listener/constructor is invoked or real port opened.
6. **Unknown startup disposition:** the pair gate retained a pending startup but not an unknown result, which had no lifetime work row of its own. Any attempted startup without a returned/refused known disposition now retains the original anchor, including unknown. The known refusal contrast still permits the one original pair close once its other tracked work is confirmed.

The P3 coverage gap concerned the already-correct boolean-return condition: all three status kinds now have callback-first and return-first unknown-return assertions that isolate pending status lifetime work and refuse pair disposal. BASELINED's bootstrap is independently closed in these schedules so it cannot mask a missing status-retention guard.

### Reproduction And Final Verification

Nine added failing cases reproduced the six P2 findings before correction: five for the first three state defects (including three clock-fault variants), two for PREPARE accounting, one safe independent listener inventory, and one unknown-startup schedule. The known refusal contrast and six unknown-return schedules are controls/coverage additions, not newly invented defects. Every scoped final static re-review reports no remaining actionable findings, including the added targeted mutation probes and source guards. That is not an OS/native or execution qualification.

Fresh main-thread tests on Node 24.18.0, one file at a time with `--test-isolation=none`: **23 files / 1337 tests**, all passing, zero failures/cancellations/skips. The unchanged related files contribute 1188 tests; the new preparation memory suite has **144** and its boundary suite **5**. There are **18** detected controlled behavioral mutations with an unmodified positive control and **20** detected static boundary mutations (16 helper, four listener-guard removals). Anchor uniqueness, actual change, syntax/compilation and dependency setup remain outside expected behavioral rejection. These are scoped assertions, not exhaustive state-space or runtime-safety proof.

The sticky error code adds **114** maximal encoded bytes: the corrected diagnostic reservation is **9713 / 16384**, and the model-only parent/preparation comparison wrapper is **64513 / 65536**. READY/BASELINED/FAILED frame ceilings remain **2214/2270/3287**, retained/transient buffer reservations **513216/4259840** within unchanged **2375680/4259840** envelopes, one pair/two ports/37 work rows, and hash/helper ceilings **2147483648/131072**. Only the new model's diagnostic includes the code; no native, wire, persisted report or product schema is changed. No existing producer/runtime/model/source, package or job configuration is edited.

The requested local commit is confined to these six files and does not include push. C2/C3/C4, B4-D/E, 4-B5/B6, actual port/clock/timer lifetime, bootstrap/native/signature/fixture/evidence/cleanup/host/work qualification, MCP registration and production activation remain separately gated. Dot stays PAUSED with its full configuration hash unchanged; all judgment/scenario/notification/mail/retention rules and numerical limits stay unchanged.

Final review verification: all three new JavaScript syntax checks, 55 scoped document links/anchors, four new-file ASCII/newline/whitespace checks and the diff whitespace check pass. The protected 262 existing tracked files and Dot's PAUSED/full-configuration hash match the review-start checkpoint. Only the six named C1 files are eligible for this commit; no unrelated change, hook, signature or automatic maintenance is included.

## B4-C1 Commit Review Correction

2026-11-01 JST, the committer's review of `bc38f13`. Every result above was reproduced:
- The 23 selected files pass 1337 tests under nine conditions: Node 24 three times, linux and win32 platform spoofs, Node 20.19.6 and 26.12.1, `--test-isolation=none`, and CRLF.
- The full unit suite runs 4864 tests on Node 24 and on Node 20.19.6: 4862 pass, 0 fail, 2 existing skips.
- The maximal capacity view covers every field of actual PREPARED, FAILED and bootstrap-closed views, and no field there is longer than its reservation.

The review found one P2 and one P3 in the status-stream facts:

- **P2, stream failure before the first status write.**
  - `status_close` and `status_error` required an existing status action token, and none exists before the first status write is planned.
  - A status stream close or error in that window could therefore only be recorded as a generic `stop`, which left `status_closed` / `status_error` unset.
  - A FAILED write was then planned, started and completed on a stream known to be closed. That contradicts rule 6 and the sticky-close rule above.
- **P3, relabelled known decisions.**
  - `status_error` marked whatever write it named `uncertain`.
  - A completed READY (callback completed, return true) became uncertain.
  - So did a never-started READY that a stop had withheld, which kept `started: false`.

The correction is made in the helper and its two tests only:

- **Stream-level facts.**
  - `status_close` and `status_error` accept `action: null` as a stream-level fact. It still requires the original session, and it sets the same sticky flag and stop.
  - A named action must still be an original status write.
  - A stream closes once: any second close, stream-level or op-level, is refused, so a second, op-level close cannot attribute an earlier stream-level close to a write.
- **What an error changes.**
  - An error makes only a started write still awaiting its callback or return uncertain, whichever action it names.
  - A write with both outcomes known keeps its decision, and `stop()` still withholds an unstarted one.
  - That in-flight write still settles its lifetime work once its callback completes and its return is known, but it stays uncertain.
- **Not adopted.** A generic `stop` may still use the reason `status_closed` without setting the flag. Reserving the model's own stop codes would need an enumerated list and is left for a later decision. The C2 connection must use the stream-level fact.

Verification, in scratch copies from `git archive`:

- **Failing first.** Eleven new behavioral tests were added. Nine fail on `bc38f13`. The other two are controls: the original session and action identity checks, and an error naming its own in-flight READY, which was already handled.
- **Mutations.**
  - Three new behavioral mutation probes and three new static pins and mutations are detected.
  - So are separate scratch mutants: one removes the stream-level close dedupe, one skips the action identity check, and one marks only FAILED uncertain. The last is caught by the in-flight READY tests.
- **Totals.** The preparation memory suite now has **158** tests and its boundary suite **5**, with 21 behavioral and 23 static mutations.
  - The 23 selected files pass **1351** tests under all nine conditions above.
  - The full unit suite runs **4878** tests on Node 24 and Node 20.19.6: 4876 pass, 0 fail, 2 existing skips.
- **Review.** Two read-only reviewers covered the helper semantics and the tests, mutations and pins. Neither found a P1. Their P3 on symmetric close dedupe and the comment wording, and the test reviewer's two P2 coverage gaps (mixed-order closes, an error during an in-flight READY write), are adopted.

No view field, capacity figure, schema reservation, wire payload, native/product schema, runtime, source, build, package or job configuration changes. The diagnostic reservation stays **9713 / 16384** and the comparison wrapper **64513 / 65536**. Dot stays PAUSED, with judgment, notification and retention rules unchanged. Push is not included.
