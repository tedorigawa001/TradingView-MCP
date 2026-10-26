# B3 Joint Read Orchestration

Status: **B3-A implemented and memory-tested; later slices remain proposals**, 2026-10-26 JST. The user approved B3-A only after the constrained B-2c tests. This work builds on `cbce6d3` plus the existing uncommitted B-2c adapter/test changes. It does not commit, replace or discard that work. B-2c host/kernel qualification remains open. No new provider, key, signature-bearing disk fixture or runtime entry is created.

Current follow-up: B-2c is separately committed as `a9188fb`; B3-A review corrections are committed as `3b202f5`. Earlier slice/worktree statements below are historical. The next proposal is the [B3-B checkpoint-probe detailed design](NATIVE_BAR_ADMISSION_CHECKPOINT_PROBE_DESIGN.md): two-sided fixed-oracle enrollment, real local challenges/clocks/cancellation, a checkpoint-only capability boundary and separate approval for public-test-vector signing in memory. No B3-B implementation is authorized by this documentation update.

Subsequent implementation approval covers [B3-Ba's unsigned foundation only](NATIVE_BAR_ADMISSION_CHECKPOINT_PROBE_DESIGN.md#b3-ba-implemented-boundary). Registration, real host issuance/observations, rejection/cancellation/cleanup and mandatory accounting are implemented without a signed provider. No probe can yet authenticate C0/C1 or mint a successful joint/native view. B3-Bb/Bc signing and orchestration remain gated.

## Purpose

B-3 connects the [B-1 verifier](../src/nativeBarAdmissionVerification.ts) and [B-2 reader](../src/nativeBarAdmissionReader.ts) into one bounded read. Two fresh checkpoints surround the complete native read and its content rechecks. A successful chain of signatures alone is insufficient: the expected fixture, provider state, native bytes, mirrors, complete prefix, operation order and cleanup must also agree.

Keep the approved [E-B design](NATIVE_BAR_ADMISSION_READ_DESIGN.md) and [B-2 constraints](NATIVE_BAR_ADMISSION_FIXTURE_READ_DESIGN.md). Dot stays PAUSED. Trading/scenario/notification/retention rules, all current limits and the strictly-more-than-90-elapsed-day rule are unchanged. This reader cannot publish records, repair a tree, retire a writer, accept history or mint an execution/host-approval capability.

## Existing Boundaries

| Existing component | What it establishes | What B-3 must add |
|---|---|---|
| B-1 | Signature/domain/pin checks on captured memory, exact wrapper sizes, logical chain and supplied request brackets | Actual challenge issuance/consumption, actual order/timing and a live registered oracle |
| B-2a | Supplied registration, original process-local ticket and model budgets | Bind the intended fixture name and complete registration, not just its pins |
| B-2b | Paired native inventories, indexed captured bytes, read-set rehash and finite resource context | Bind those exact bytes to B-1, both checkpoints and one query |
| B-2c patch | Selected failure/expiry/FD tests; work stops after a release request even when close fails | Preserve unresolved native-clock/mount/kernel-close qualification; do not label B-2c complete |

B-1 accepts equal millisecond timestamps and zero-width supplied brackets. B-3 must prove actual operation order with its own recorded sequence and monotonic observations; it must not invent a one-millisecond delay or reinterpret equal rounded UTC values as evidence of wrong order.

## Fixed Registration

A trusted synthetic bootstrap binds one intended B-2 registration and one already registered oracle. A query accepts neither raw paths nor replacement keys/providers/clocks/challenges/native assertions.

Pin the B-2 registration digest, exact `fixture_name`, fixture/store/epoch/authority/key/enrollment identities, authority reference, public SPKI fingerprint and expected parent/root/marker bindings. B-2a's bootstrap does not pin the fixture basename; B-3 must add this binding. A different named tree under the same logical pins is not an interchangeable fixture.

The oracle is selected through a private process-local handle from a fixed test implementation, not an arbitrary requester callback, URL, environment override, JSON claim or signer function. Original ticket/registry/oracle membership is checked before contact or native opening. Copies, foreign/revoked handles and reports cannot reconstruct a live query.

Tentative future live interface:

```text
trusted synthetic bootstrap
  enrollJointReader(fixedFixtureBinding, fixedPublicKey, registeredOracleHandle)
    -> opaque joint-reader token
reader
  read(originalFixtureTicket, optionalLowerLimits, checkedCancellationSignal)
    -> bounded detached report
  close()
```

Names are provisional and are not MCP registrations. Neither construction nor enrollment loads a native addon, contacts an oracle, scans a path or signs anything. The first model-only slice below is a different API/token type; it cannot be promoted to this live interface.

## Oracle Contract

Use a test-harness-controlled oracle outside both record trees. It independently retains the enrolled fixture/store/epoch/high-water sequence/tip in memory. Its checkpoint request contains only the fixed identity/reference, query/request identity and fresh challenge. It does not accept a reader-provided tip, sequence, timestamp-to-sign or arbitrary signing body.

The fixed adapter supplies a cancellable bounded asynchronous request and returns the exact B-1 checkpoint bytes, at most 4 KiB including signature. A response is copied/captured once, bounded before decoding, authenticated by B-1 and bound to the exact outstanding request. No native tree lookup supplies missing oracle state. A lost/unknown state is unavailable even if an old signed checkpoint/file still verifies. A query cannot advance the oracle's ledger/high-water state, provision/restart its service, generate a key, append a checkpoint file or consume a maintenance approval.

Test-only signing, if subsequently approved, uses public RFC test material in memory in the fixed harness/oracle; the runtime reader imports no signer or private key. No new production service or trust/backup isolation is implied. A dishonest signer can sign a fresh lie, and rolling back both the trees and alleged oracle state together is not called detected.

## Query State And Requests

```text
registered
  -> query_started -> c0_outstanding -> c0_authenticated
  -> pair_open -> inventoried -> records_bound -> native_checked_before_c1
  -> c1_outstanding -> c1_authenticated -> native_checked_after_c1
  -> interpretation_complete -> releasing -> released -> report

any active phase -> failed_or_cancelled -> releasing -> released -> diagnostic
releasing -> release_unconfirmed -> release_retry_only
```

Each query has at most two requests, C0 then C1, with distinct challenges. Each request is registered before dispatch and consumed before its response can be used. Duplicate delivery, phase reuse, foreign query/provider, unknown request, cancellation and late completion cannot revive it. A timeout consumes that request, closes the query and does not silently generate another challenge or retry.

The live slice generates challenges using the fixed host CSPRNG only when a query requests one. It checks uniqueness against the other challenge, pinned role IDs and subsequently read record IDs; a collision refuses rather than resampling. Seen/consumed challenge state is retained within the existing metadata accounting. Exhaustion refuses new work; it cannot evict replay protection or reset the issuer automatically. No unbounded request/tombstone table is introduced.

One active query is allowed per registered fixture, matching B-2's active claim. Native global leases/FD limits remain authoritative. Model-only state does not reserve those resources or qualify actual requests.

## Joint Read Order

1. Check live registration/handles and lower limits. Start the outer wall/monotonic deadline and reserve bounded external protocol overhead. Call B-2 `beginRead` before C0, without opening roots, under only the remaining allowance.
2. Register a fresh C0 request; capture actual send/receive observations. Require B-1 authentication, the exact pins/challenge and checkpoint time within that bracket. Unknown clock relation or rollback refuses without tolerance or relabeling.
3. Open the registered pair under the same context. Obtain its two-pass joint inventory, including both roots/common controls. Unknown private names, unsafe entries and pending publication blockers are not excluded to choose a convenient prefix.
4. Read all witness candidates by native index, bounded by the checkpoint sequence and physical inventory. Verify each captured envelope/location with B-1. Require native whole-file SHA-256 equal to B-1 `encoded_sha256`. Validate an exact numerical `1..C0.sequence` chain, with no extras, gaps, duplicate/forked sequence, role alias or changed enrollment.
5. Read required producer mirrors by their data-root indices. Independently authenticate their exact bytes and require both their native hash/B-1 encoded hash equality and equality with the corresponding witness outer bytes/hash. A logical-record digest cannot substitute for either physical comparison.
6. Read all additionally required payload/receipt/metadata bytes before the native read window closes. Match unambiguous producer roles/digests/current locations; do not require historical empty stages to remain or invent receipts. Maintenance move/unlink/completion/spent mappings remain `transaction_mapping_pending` for E-D.
7. Verify the original native snapshot/read set (V0), then issue/authenticate distinct C1. C0/C1 must have identical fixed identities/enrollment/sequence/tip. A progressed tip is `changing`, not a request to append missing files or retry.
8. Reverify the same native snapshot/read set after C1 (V1). Do not open another context or obtain a new baseline. Validate actual C0/open/read/V0/C1/V1 order independently of B-1's supplied UTC checks, then run B-1's complete captured transcript/E-A projection and bounded interpretation.
9. Construct only a candidate result internally. Release the same context in `finally`. Expose no successful aggregate result until release succeeds; unconfirmed release leaves retry-only cleanup and a failure diagnostic. Report construction/crypto/provider/native work all remain inside the original deadline, without an OS hard-real-time or stalled-syscall interruption promise.

Every native read result is copied/captured before further asynchronous work. Mutable returned Buffers, editable reports and later checkpoint bytes cannot change the bytes already authenticated for this query. No new evidence reads are attempted after V0; B-2 permits only rechecking the original read set at V1.

## Whole Query Accounting

Keep 512 combined inventory entries, 1 GiB inventory, 16 MiB metadata, 256 MiB read work, 8 MiB response, eight native root leases, 512 native FDs and 48-FD headroom. Role limits remain wrapper-inclusive and unchanged. No capacity reservation or physical capacity qualification is inferred.

B-2's current modeled floor is not the complete B-3 program. It assumes one final native verification. B-3 requires:

- Six native joint inventory passes: initial two, V0 two and V1 two.
- Three native content captures per indexed evidence read plus both V0/V1 rehashes: at least five content reads per selected object, with their control/ACL/name/metadata work.
- Both checkpoints, request/response copies and framing, challenge/consumption state, fixed registration/key material, cancellation/provider overhead, B-1 decoding/verification/transcript/E-A material and the complete final report.

Derive these costs from a finite schedule, not a low caller total. Precharge bounded external overhead before native work and pass only the lower remaining allowance to B-2. Retained raw/decoded witness data, mirror buffers and read-set frames must be accounted for together; 512 entries do not promise that 512 maximum-size envelopes fit. Count repeated work again and refuse a plan that does not fit. Do not enlarge limits, drop recovery/temporary headroom or borrow the smaller read-only program to approve E-C writes.

## Results And Stop Rules

Keep distinct results for unavailable fixture/provider/backend, authentication/integrity blockers, `changing`, `publication_incomplete`, `transaction_mapping_pending`, cancellation/timeout, accounting exhaustion and `release_unconfirmed`. No old checkpoint, partial prefix, fallback reader, repair, cleanup or transparent retry is allowed.

Only actual checks may establish fixture-signature/checkpoint-pair/logical-prefix/native-byte/native-snapshot facts. B3-A model observations establish none of them. B-2c's open host/kernel qualification stays explicit; the initial B-3 implementation must not declare a fully qualified aggregate `view_verified:true` while that gate is unresolved. Later acceptance of an experimental scope versus full host qualification requires an explicit decision, not a changed Boolean after a passing synthetic fixture.

Admission, approval, execution, recovery execution, committed history, original intake, elapsed-age and physical-capacity flags stay false. Acknowledgement and historical storage visibility stay `not_proven`. No result is an execution capability or a market/notification signal, and no report includes raw signatures, OHLC payloads, private host paths, key material or account data.

## Implementation Slices

| Slice | Proposed next work | Still excluded |
|---|---|---|
| B3-A (implemented) | Pure bounded registration/request/event/result/budget contracts; model-only single-use request state; in-memory synthetic tests | Ambient clock/RNG, native load/read, provider contact, signer/service/key creation, fixture creation, signature persistence |
| B3-B | Fixed process-local oracle registration, actual challenges, monotonic/wall deadline, cancellation and memory-only public-test-key checkpoint tests | Native signed-fixture persistence, real authority trust, network service installation |
| B3-C | Connect the native/B-1/registered-oracle pipeline, exact captured-byte binding and interpretation | Positive signed-on-disk cases until separate approval for newly invented signed fixtures; no real records |
| B3-D | Full negative/compatibility/accounting acceptance and independent review, with explicit B-2c host qualification decisions | History acceptance, execution/handoff, MCP/production enablement and Dot integration |

The implemented slice is **B3-A only**. Its events/challenges/times are supplied test-model data and its tokens are distinct from live-query/native/oracle capabilities. Public model transitions cannot feed a later live query as authenticated observations. The current E-A/B-1/B-2 contracts are preserved; only exact new pure-module dependencies are added to source-boundary allowlists. No current runtime/startup/MCP module imports it.

## Acceptance Plan

The first model-only slice tests strict detached input/size/depth validation, exact fixture binding, copied/foreign/revoked token refusal, one active model, single consumption/duplicate/late/reordered/foreign responses, cancellation/terminal-state refusal and bounded replay-state retention. Model ordering must handle equal rounded UTC values without claiming actual chronology. Budget tests cover exact boundaries and one over, six versus four inventory passes, both rehashes/checkpoints/mirrors, retained transcript copies, whole response and all false qualification flags. No filesystem fixture or ambient-clock test is needed for B3-A.

Later live tests must cover independent oracle loss, old/freshly signed wrong state, epoch/provider/fixture changes, duplicate/late responses, cancelled/stalled oracle, collision without resampling, zero-width timestamps with actual operation order, C1 tip movement, post-C1 filesystem drift, native/B-1/mirror byte disagreement, incomplete publications, pending transaction mappings, second-root/external-budget exhaustion and release failure. Restarts may retain the honest independent test oracle but cannot restore its lost state from the trees. Newly signed disk fixtures, native host-fault setups and their preparation/teardown each retain their own approval boundary.

## B3-A Implemented Boundary

`src/nativeBarAdmissionQueryProtocol.ts` exports `createSyntheticAdmissionQueryProtocolModel`, `calculateSyntheticAdmissionQueryProtocolBudget` and strict model-result/budget-result schemas. This is a supplied-memory state machine, not the tentative live reader above. It imports only named validation/hash/limit/budget helpers; no native capability bridge, ambient clock, random source, signer, provider or storage API is called. A fixed invented registration is checked against the existing B-2 validator and its complete digest, including `fixture_name` and all object/marker pins.

The factory accepts the strict `native-bar-admission-query-model-registration-v1` envelope with `scope: synthetic_model_only`. Its envelope is capped at 128 KiB; the embedded B-2 registration retains its own 64 KiB ceiling. Structured inputs are bounded before schema/hash work and refuse accessors, sparse/exotic arrays, cycles, symbols, excessive depth/nodes and unknown fields. General events are capped at 64 KiB; a received checkpoint-claim event is capped at 4 KiB. No signature is accepted or prepared.

The model API is `begin`, `issue`, `receive`, `advance`, `bindRecords`, `finish`, `cancel`, `release`, `describe`, `close`. `begin` returns an original opaque model-query handle; `issue` returns an original opaque request handle. Their private WeakMap membership is distinct from every B-2/native/oracle registry. Each model instance has one active query; this is not a native/shared fixture lock. Separate model instances do not qualify shared live-resource exclusion.

The supplied-event path is:

```text
query_started -> c0_outstanding -> c0_model_received
 -> pair_open -> inventoried -> records_bound -> native_checked_before_c1
 -> c1_outstanding -> c1_model_received -> native_checked_after_c1
 -> interpretation_complete -> releasing -> released
```

Phase names containing `native_checked` are only supplied model labels. They perform no native operation. `receive` consumes the current outstanding request before parsing or using a response, including malformed, foreign, duplicate or late responses. A bad owned-query event moves it to release-only failure without changing the foreign request's owner. C0/C1 fixed identities, distinct challenges, supplied timestamp brackets and identical sequence/tip are compared; no signature, logical prefix or authority state is authenticated. `bindRecords` compares the supplied prefix label and checks supplied role-ID collisions, not actual records or payloads.

UTC and monotonic-nanosecond observations are supplied explicitly. Both are nondecreasing within a query, equality is allowed, and either elapsed value reaching the existing exclusive 600-second deadline refuses work. The private event ordinal establishes modeled order without inventing timestamp separation. `finish` and supplied release are included in that same deadline. Cleanup remains possible after expiry/rollback, but it cannot restore consistency. Premature or malformed release also invalidates the active model. An unconfirmed release retains the active slot and permits only cleanup; later confirmation never erases the failure. `close` permanently revokes the model, not an OS resource.

The replay-state account starts at canonical registration-envelope bytes plus 64 KiB and charges 4 KiB per new query/challenge/discovered role ID. Its optional `retained_state_limit_bytes` may only lower 16 MiB. Seen IDs are not evicted or reset to admit another query. Repeated record role IDs across queries are allowed, but cannot become query/challenge identities. Exhaustion refuses new work. This byte account is a conservative model, not a claim about JavaScript heap size or physical capacity.

`describe` is detached and contains only model state, digest/query ID, ordinal, last supplied observation, consumed valid checkpoint-claim count and retained-state account. All actual native/signature/checkpoint/prefix/authority/view/time/challenge/capacity/admission/execution/history qualifications remain literal false; acknowledgement and storage visibility remain `not_proven`. Even `model_order_consistent: true` means only the full supplied protocol and confirmed supplied cleanup agreed. Edited/serialized reports cannot reconstruct a handle or feed authenticated facts to later slices.

### Budget Schedule

The strict budget input includes the fixed registration envelope, the existing B-2 counters/lower limits, and additional retained protocol/decoded transcript/verifier/provider byte-work counters. These extra counters only add costs. The schedule is fixed at six native inventory passes, three content captures plus two rehashes per selected object, and two checkpoint requests with 4 KiB responses. Unknown caller-supplied schedule controls are rejected.

Let `F` be the unchanged B-2 budget floor, `B` selected content bytes including mirrors, `N` selected object count, `E` combined inventory entries, `K` marker-plus-policy bytes and `A` ancestor count. Mandatory external framing is `H = 10 * 4096` bytes (two request frames plus eight response/copy/decoded frames); scratch is `S = 65536`. A current-query ledger allowance is `D = 65536 + (512 + 9) * 4096 + registration-envelope bytes`, conservatively reserving the maximum model role-ID list and fixed identity/request framing. Additional retained state from earlier queries must still be supplied in `retained_protocol_bytes`.

- Metadata: `F.metadata + 2*B + H + S + D + max(retained_protocol_bytes, 3*R) + max(decoded_transcript_bytes, B)`, where `R = 16384 + E*5120` is one retained native report frame (initial, V0 and V1 reports).
- Read work: `F.read + B + N*65536 + 2*E*4608 + K*(3+N) + 3*(A+4)*12288 + 3*B + H + S + max(verifier_work_bytes, 2*B + N*4096) + provider_work_bytes`. B-1 verifies every envelope twice (record checks, then transcript re-verification), so its work has a schedule floor rather than a caller total. This adds V1's content/inventory/control checks and bounded verifier work to the old floor.
- Response: `F.response + 65536 + H`; combined entries and inventory bytes retain the old floor.

All arithmetic is bounded-input BigInt, including very large supplied counts without count-sized loops. `used`, `remaining` and `native_allowance` are decimal counters. `native_allowance` subtracts only the outer, non-native cost from the unchanged/lowered limit: framing `H`, scratch `S`, B-1 decoding `3*B`, verifier/provider work, retained copies `2*B`, the ledger `D` and retained protocol/transcript bytes. It never subtracts the extra V1 native passes (`B + N*65536 + 2*E*4608 + K*(3+N) + 3*(A+4)*12288`), because the native reader performs them inside that allowance. Hence `model_fits` implies that the B-2 floor plus the V1 native passes fits the allowance. These are pure plans, not reserved native allowances or enforcement. Eight roots, 512 FDs, 48-FD headroom and the existing shared-target ceiling remain unchanged. Capacity/native-budget flags stay false even when `model_fits` is true.

### Synthetic Verification

At `bfa9cd0` the new slice had **79 tests** (75 model/budget tests plus four source-boundary tests); with E-A and B-2a pure regressions and the B-1/B-2b source/entry boundaries, **305 tests passed**. The review corrections below change these counts, zero failures/cancellations/skips. Verification uses isolated `build/b3a-validation/` output; the common build is not regenerated. Type checking (`tsc --noEmit`) and `git diff --check` pass.

The premature-release bug was reproduced before its fix: a rejected early release left the query in `query_started` and could resume normal work. It now retains a failure and only accepts cleanup. Other cases cover exact fixture digest, detached/copy/foreign handles, single consumption, delayed C0 during C1, checkpoint/prefix changes, role/challenge replay, cancellation/release uncertainty, equal clocks, independent exclusive deadlines/rollback, strict malformed/oversized input, all five exact budget limits and one over, global resource bounds and exact additional-cost arithmetic. Source checks and their mutation tests refuse import widening, clocks/RNG/signers/capability bridges and every incoming runtime dependency.

No native test runner or native fixture is used in this slice. The signing runtime suite is not rerun; B-1 source boundaries and existing public-key-only B-2a memory regressions are included. No key is generated, no checkpoint is signed, and no filesystem fixture is created, moved or deleted. Separate independent review and all B3-B/C/D integration/host checks remain pending.

### B3-A Review Corrections

The committer's review of `bfa9cd0` found one should-fix budget defect and one parity note:

1. *Double-subtracted native allowance.* `native_allowance` subtracted every additional cost from the limit, including the V1 native rechecks that the native reader must still perform within that allowance.
   - At an exact-fit limit (`model_fits:true`, 40 objects of 16 KiB), the allowance was 14,687,348 bytes: exactly the four-pass B-2 floor. The native work the same plan counts was 18,780,670 bytes, so the native read would have failed with `admission_read_limit` despite the fitting plan.
   - The allowance now subtracts only outer work, as stated above. `used` is unchanged.
   - A regression checks that at an exact-fit limit the allowance covers the B-2 floor plus the V1 native passes. The exact-formula test now separates native from outer cost.
2. *Sequence floor.* Checkpoint-claim and prefix sequences accepted `"0"`, while B-1 checkpoints start at 1. They now start at 1.

Both regressions, and the corrected formula test, fail on `bfa9cd0`. The E-A/B-1/B-2/B3-A unit suites pass 372 cases, and the full unit suite passes 2,642 with two existing skips. No native code, runtime entry point or MCP wiring changed. The uncommitted B-2c files are not part of this correction.

### B3-A Independent Review Corrections

A separate read-only review of the model at `96756f9` found no must-fix issue, one should-fix issue and eight low-priority items:

1. *Finish-to-release window (should-fix).* An out-of-order event after `finish` was refused but not recorded, so the query still ended `model_order_consistent: true`. Examples: a duplicate or stale response, a foreign handle, a rewinding `advance`, `issue`, `bindRecords` or a second `finish`. Any non-cleanup event in `releasing`/`release_unconfirmed` now records `b3a_release_only`.
2. *Per-entry inventory floor (inherited from B-2a).* The floor charged 3,072 bytes per entry per pass. A directory costs at least about 4.1 KiB natively: the stat, its own ACL and its scan's start/end ACL checks. On a data root with 400 empty directories, a fitting plan fell short: model 5,519,796 against native 6,893,876. B-2a and B3-A now charge 4,608 bytes per entry per pass. Deny-only ACL text beyond that is supplied as `acl` work. The native cross-check includes this directory-heavy fixture.
3. *Response floor (inherited).* The native reader reserves four times the role cap of each read, so 16 KiB covers a witness and 1 MiB a payload. B-2a content reads now carry an optional role `cap_bytes`, defaulting to 1 MiB and refusing larger objects. The response floor uses the largest planned cap.
4. *Literal dynamic imports.* B3-A's boundary test now records literal dynamic imports by name and self-tests it.
5. *Ambient clocks.* All four pure boundary tests (E-A, B-1, B-2a, B3-A) now also ban `Intl`, `Event`, `EventTarget`, `AbortSignal` and `setImmediate`. The reviewer showed that `Intl.DateTimeFormat` and `Event.timeStamp` read the clock.
6. *B-1 verification and retention floors.* B-1 verification and E-A replay work, the JS-side retention of the three native reports and the decoded transcript copy no longer depend on caller totals that accept "0". Their schedule floors are given above.
7. *Stale counts.* The counts above are labeled as the pre-correction state.
8. *Error codes.* Raised or invalid budget limits now refuse with `b3a_limits` or `b3a_invalid_input`, not B-2a codes. `cancel` after `close()` reports `b3a_model_closed`.

**Smaller behavior fixes.**
- Cleanup keeps `release_unconfirmed` rather than moving back to `releasing`.
- A rolled-back cleanup observation is counted but no longer lowers the comparison point.
- The input-guard comment states that a Proxy can still answer Zod's reads differently, so callers are trusted in-process test code, as for every admission contract.

**For later slices.** A hand-built object can satisfy the exported result schema. Later slices must accept only the original model/live handles, never a result object in place of a handle.

Verification, from a git-archive copy of `a9188fb` plus this patch, with source/test hashes fixed:
- The new or corrected regressions fail on the unfixed build: finish-to-release, cleanup state, `b3a` codes and floors, exact-fit allowance, the exact formula, the role-cap response floor, and the directory-heavy native cross-check.
- The E-A/B-1/B-2/B3-A unit suites pass 376 cases.
- The isolated B-2 run passes 376 cases in both the normal and the UBSan build, with zero UBSan runtime errors.
- The full unit suite passes 2,646 cases, with two existing skips.

No native C++ source changed. B-2c has since been committed as `a9188fb` and verified separately: 375 normal and 375 UBSan cases. No fixture was left behind, and the pre-existing ones were untouched. No push, real-data operation, MCP registration or production enablement is included.

## Current Worktree

The B-2c patch remains uncommitted: its release-request guard, 25 acceptance cases and recorded 375-case normal/UBSan results are preserved. B3-A does not qualify its unexecuted OS/kernel cases or combine that patch into a commit. B3-A code/tests and exact dependency allowlists are added, while no keys/services/fixtures are created and no job configuration or trading/notification/retention condition is changed. Dot remains PAUSED. After implementation, the user approved a local B3-A-only commit; fresh compilation, the same 305 memory/boundary tests and type/diff checks are required before committing. The B-2c files and its separate backlog paragraph remain outside that commit. No push, MCP registration, production enablement or common-build deployment is performed. Independent review remains pending.
