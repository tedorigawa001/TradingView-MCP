# B3 C Native Joint Reader Connection

Status: **C-A independently reviewed/corrected; C-B implemented, locally and independently reviewed and corrected with memory-only tests; native acceptance remains gated**, 2026-10-28 JST. C-B starts from `41a11b8`, preserving the C-A independent-review corrections. The original design baseline was `cf75726`. This refines the [joint read order](NATIVE_BAR_ADMISSION_JOINT_READ_DESIGN.md) and [checkpoint probe boundary](NATIVE_BAR_ADMISSION_CHECKPOINT_PROBE_DESIGN.md), without promoting a probe to a native capability. Implementation/test boundaries are recorded separately below; C-C native acceptance remains unapproved.

B3-C connects the existing native paired reader, actual checkpoint transport and B-1 verifier under one original query. It does not publish evidence, accept history, grant execution, qualify the remaining B-2c host/kernel gaps or enable MCP/production/Dot operation. Dot stays PAUSED. Market/scenario/notification/mail rules, strictly-more-than-90-elapsed-day eligibility, elapsed-time-unknown holds and every existing resource ceiling remain unchanged.

## Current Interfaces And Gaps

| Component | Current interface | Connection requirement |
|---|---|---|
| B-2 registration | `createSyntheticAdmissionReadBootstrap`, `registerFixture`, opaque ticket; `describe` returns the full registration digest | Keep the original ticket/registry private and pin the complete registration, including fixture basename, not just bootstrap pins/anchor |
| B-2 native adapter | `beginRead(ticket, lowerLimits?, ttlMs?)`, context `openPair`, pair `inventory`, snapshot `readEvidence(role,index)`, repeated `verify`, `close` | Use the same context and snapshot for both V0/V1; begin before C0 and open roots only after C0 |
| B3 oracle registry | Original reader/owner grants, bounded shared account, namespace and ID tombstones, fixed-helper owner mailbox | Add a separately branded joint enrollment; do not consume caller probe grants or accept arbitrary oracle/native objects |
| B3-Bc probe | C0/C1 handles and narrow detached result; retains only checkpoint summaries after authentication | Cannot supply raw checkpoint envelopes to B-1's complete transcript and cannot establish V0/V1 ordering |
| B-1 | `verifyRecord`, `verifyCheckpoint`, `verifyTranscript` over owned bytes | Bind native file SHA-256 to the exact encoded bytes and preserve raw checkpoints/witnesses privately until complete transcript verification |
| B3-A calculator | Pure six-inventory/five-content-pass schedule, outer/native allowance separation | Turn a fixed worst-case work envelope into a preflight reservation; supplied counters are not observed native facts |

The native inventory has one global index space. Entries carry `index`, `root_role`, `path`, proof, classification, readability and role byte cap. Native byte results carry `facts.sha256` and the original entry proof. V0 changes the native state to `native_checked`: further content reads are refused, while V1 can reverify the same snapshot/read set. B3-C must preserve this boundary rather than reopen a context.

## Separate Capability Chain

Proposed disconnected factory/session API:

```text
createSyntheticAdmissionJointBootstrap(fullBinding, publicKey, workEnvelope)
  -> { jointReaderEnrollment, ownerEnrollment, describe(), close() }
enrollSyntheticAdmissionJointReader(original jointReaderEnrollment)
  -> session
session.beginJointRead({ ttl_ms?, lower_limits? }) -> original jointQuery
session.run(original jointQuery) -> Promise<detached bounded result or diagnostic>
session.cancel(original jointQuery) -> diagnostic
session.release(original jointQuery) -> cleanup diagnostic
session.describe(original jointQuery) -> diagnostic
session.close() -> cleanup result
```

These names are proposals, not MCP tools. Factory/enrollment perform no path I/O, addon load, signature preparation or oracle request. `beginJointRead` explicitly starts the original outer clock window, precharges work, claims the oracle/native registration and begins the native context without opening fixture roots. An unsuccessful begin must either release everything or preserve an opaque cleanup-only query with `release_unconfirmed`; a hidden failed claim cannot become unreachable.

The trusted joint factory validates/detaches the complete existing B-2 registration and its digest. It internally constructs the fixed B-2 bootstrap/registry and registers that exact fixture once. It also issues a distinct joint-kind oracle reader grant with the same complete binding. Original B-2 tickets, oracle reader grants, verifier and transport remain private. Only the fixed memory helper receives the original owner grant; runtime modules still import no signer/private key.

The oracle registry must distinguish probe-kind and joint-kind reader enrollment in private state. Existing `claimSyntheticCheckpointProbe` stays probe-only. A new narrowly allowlisted internal joint claim may share bounded ID/dispatch/capture primitives, but accepts only an original joint-kind enrollment. No `kind`, `native_verified` or replacement provider argument is accepted from query callers. Reusing or wrapping an already completed probe is explicitly forbidden.

Registration failure rolls back resources but does not erase consumed grants, namespace reservations or replay tombstones. Aliases across probe/joint enrollments remain subject to the shared namespace/account. Same-process source-boundary controls are not isolation from arbitrary hostile code already running with native-addon privileges.

## Immutable Work Envelope

Before C0, inventory sizes and selected content are unknown. A zero-content preflight followed by unbounded reads is invalid. Reserving every global maximum simultaneously may not fit the unchanged 16-MiB metadata limit; it must not be made to fit by reducing floors.

The proposed joint bootstrap therefore requires an explicit, immutable **work envelope**, not claimed actual workload or a signal threshold. No new numerical default is selected in this design. It contains finite upper bounds for combined/per-root inventory entries, inventory bytes and retained native metadata; maximum witness/mirror/payload/receipt/maintenance objects; selected raw-byte total; and bounded decode/interpretation material. All values are canonical bounded integers under current ceilings; required nonempty work/minimum control framing cannot be zero. The same input produces the same normalized envelope digest.

The pure planner derives counts/copies/passes from these bounds and existing role caps. Caller-provided zero crypto/provider work cannot remove mandatory costs. A small aggregate byte bound is an enforceable admission cap, never evidence that required records are small. The complete plan must fit before context construction; impossible envelopes refuse without native load or checkpoint dispatch. They are not silently narrowed, split or retried.

Enforcement is two-sided:

1. Native entry/inventory/read/response/metadata limits are no greater than the computed native allowance and the applicable envelope bound. Combined limits include roots, ancestors, policy, markers, private/ordinary entries and control overhead, not only records.
2. Immediately after native inventory, validate actual complete counters and every retained report against the envelope before selecting content. Do not drop unknown/extra entries to fit it.
3. Check selected object counts and summed pinned sizes against the envelope before each capture. After capture check actual bytes, role cap and identity/hash again. Unknown required work or any exceeded bound fails, never truncates a prefix.
4. Bound decoded values, role-ID collection and interpretation/report copies before allocation. A bound whose implementation cannot be derived conservatively remains unavailable rather than being filled with observed work after success.

Use the existing B3-A budget function with this upper-bound schedule. Preserve six native inventory passes (initial two, V0 two, V1 two), three content captures plus both rehashes, repeated signature/decoding/transcript work, request/provider work, retained original byte copies and final report. Preserve 512 combined entries, 1 GiB inventory, 16 MiB metadata, 256 MiB read work, 8 MiB response, eight roots, 512 FDs and 48-FD headroom. Existing native mutation-target pressure still counts; B3-C creates none.

Subtract only outer work to obtain `native_allowance`; V1 native work stays inside it and is not subtracted twice. Current registry retained state and prior consumed IDs are included in the process-wide account. Future record-role IDs use existing bounded reserved slots and cannot evict old IDs. Native global reservation remains authoritative even when a pure plan fits. No free-space reservation, allocation/durability proof or executable E-C write capacity follows; the existing 551-versus-512 two-target write refusal remains unchanged.

## Original Query Order

```text
enrolled -> outer_started -> precharged -> native_context_started
 -> c0_outstanding -> c0_authenticated -> pair_open -> inventoried
 -> witness_bound -> mirrors_bound -> interpretation_inputs_captured
 -> v0_verified -> c1_outstanding -> c1_authenticated -> v1_verified
 -> transcript_verified -> interpreted -> releasing -> released -> report

any active failure -> cancelling_and_releasing
 -> released_failure | release_unconfirmed -> explicit cleanup only
```

Only private operations advance these states. No public `advance`, supplied time, B3-A event, parsed report or probe handle can prove a native phase. Query input has no path, raw response, key, provider, backend, clock, signal callback or `released` assertion. Cancellation remains an original-handle command; an external signal adapter is not added here.

### Start And C0

Capture outer wall/monotonic observations before options validation/precharge and require the original enrollment/owner generation. Use the fixed host UUID source for one query ID and distinct C0/C1 challenges with no fallback/resampling. Shared namespace/role/previous-ID collisions refuse.

Begin B-2 with the unchanged/lowered native allowance and only the remaining time, rounded down to integer milliseconds. A remainder below one millisecond refuses. Check actual clocks before and after addon loading/native begin and C0; a late initialized context is released without opening roots. Native begin reserves the real two root slots; no success claim follows from the pure plan alone.

Consume the original C0 slot, intrinsically capture at most 4 KiB, verify with B-1 under the actual local send/receive UTC bracket, and recheck deadline/generation after verification. Preserve the owned raw C0 bytes and bracket privately for the complete transcript. A probe summary cannot substitute for them.

### Inventory And Witness Prefix

Open the pair once and inventory once using the original context. Capture/strictly validate the report before any asynchronous boundary. Require complete, safe, qualified native inventory, expected schema/binding and immutable index/role mapping. Ordinary side entries stay counted and preserved. Unknown private entries, unsafe access, aliases and pending publication blockers do not disappear from the view.

Before count-sized loops, compare positive `C0.sequence` as BigInt with the envelope witness bound and native witness inventory count. Require the entire exact numerical `1..sequence` namespace: no leading-zero names, gaps, duplicates, extras, other epochs or convenient longest prefix. Sort numerically only after bounded size validation.

Read by original native index/role only. Copy returned bytes with intrinsic typed-array/ordinary-ArrayBuffer checks and conservative role bounds, not `slice`, `toJSON`, an editable path or caller proof. Validate `facts.entry`, size and `facts.sha256`; verify the exact owned bytes with B-1 at the actual witness location. Require:

```text
native witness file SHA-256 == B-1 encoded_sha256 of captured outer bytes
```

Keep `record_hash`/chain tip separate: they hash logical E-A records, not whole physical outer files. After authentication, recursively collect the actual bounded record role IDs, reject aliases with query/C0 IDs and register them against C1 issuance. Do not claim unknown role IDs were checked before they were observed.

### Producer And Content Binding

Derive required producer mirrors from authenticated B-1 `placements`; never infer completion from a filename. Each required data mirror must be unique, readable and independently verified with B-1 at its data-root location. Require its native SHA-256 equals its own B-1 encoded hash and the corresponding witness whole-file hash; also compare the owned outer bytes exactly. An unrelated or unbound producer mirror blocks interpretation.

Build payload/receipt/metadata obligations only from the authenticated record roles and their declarations. For each obligation, match the exact native role/index, immutable proof and encoding-specific digest. In particular a receipt body/model digest is not automatically a whole receipt-file hash. Do not normalize/re-encode JSON to make an incorrect physical file match. Missing required publications, unfinished stages, active/unwitnessed coordination and ambiguous locations produce separate blockers.

Historical `artifact_created` records do not require a now-empty historical stage to persist. Do not recreate receipts, infer deletion from absence, treat signed `dead` as current liveness or relax proof identity/ctime to explain a move. Maintenance move/unlink/completion/spent mappings remain `transaction_mapping_pending` for E-D. If a legal current-location rule is not implemented, withhold the relevant interpretation rather than manufacture a complete result.

Capture every required extra content byte before V0. Retain only bounded owned data needed for verification/interpretation; no raw OHLC, record bodies or private path dump is returned. This reader performs no writes, locks, repair, atime restoration or cleanup of fixture entries.

### V0 C1 V1 And Transcript

Call the original snapshot's `verify()` as V0 and capture its returned generation/counters/proofs. Then close the evidence-read phase; no new indexed reads or new inventory/context can be used. Issue C1 only from this private successful V0 transition.

Authenticate C1 under its fresh original request bracket, bound pins/epoch and original owner generation. Require the same positive sequence and logical tip as C0. A changed state is `changing`, not permission to fetch additional records or retry. Preserve owned raw C1 bytes. Invoke V1 on the **same** snapshot/read set and require matching stable native joint generation; native content rehashes must succeed. Outer observations establish actual C0/read/V0/C1/V1 order even when UTC milliseconds are equal.

Pass the complete owned witness byte prefix and both original checkpoint byte/bracket pairs to B-1 `verifyTranscript`, using an actual current observation for `evaluated_at`. No producer mirror is inserted as an extra witness record. Do not expose an API accepting fabricated B-1 results or caller-supplied `signature_checks`. Compare B-1's replay tip/sequence with the authenticated prefix and construct only bounded role-specific interpretation. Nested E-A outputs remain supplied-model/false-authority facts.

## Release And Final Publication

Retain the original B-2 context, oracle operation and joint lease for cleanup. In every exit, attempt native snapshot/context release and oracle cancellation/settlement independently, even if one fails. A cleanup exception never hides the primary failure. No new request, native read or renewed deadline is permitted while releasing.

Locally queued, never-delivered checkpoint work may settle by removing its original packet, as in B3-Bc. Already-delivered work needs its genuine original settlement. Native close confirmation comes from the original B-2 resource, not a caller Boolean or GC callback. Repeated explicit cleanup is idempotent, does not append history and may release a retained claim only after all required resources are confirmed closed/retired. If native release remains unknown, keep the joint registration claimed even if the oracle settles, and conversely.

Construct a result candidate privately. Verify both request slots retired, original owner still known, current fixed bounds respected, timers/copies disposed and native/joint lease release confirmed. Final publication takes a fresh outer observation after report assembly and cleanup, inside the original exclusive deadline. No asynchronous gap may allow a result candidate to be returned without another original-state/time check. Expiry/rollback/close during finalization withholds success even if both signatures verified. A detached final result describes that publication observation, not later consumer delivery.

The adapter cannot interrupt a synchronous native syscall or promise hard-real-time cancellation. Kernel close/EINTR, OS clock freeze/rollback, remount/ownership/cross-device and OS descriptor-exhaustion qualification remain the explicit B-2c/B3-D gates, not inferred from JavaScript fault substitutions.

## Result Scope

Use a new strict `native-bar-synthetic-joint-read-result-v1` with an experimental fixture-only scope, original registration/envelope digest, bounded counts/digests, actual observation summary and separate primary failure/cleanup/blockers. Never return native handles, private paths, signature/key bytes, complete ledgers or an execution-capable plan. `describe` remains diagnostic-only and cannot recreate capabilities.

Only completed actual checks may establish fixture signature, checkpoint requests/pair, logical prefix, native captured-byte binding, V0/V1 snapshot and local challenge/timing facts. A partial failure keeps aggregate joint qualification false; narrowly recorded completed-check counts do not imply full success. `view_verified` stays false while B-2c host qualification is unresolved. Original intake, authority trust, admission/approval, history, execution/recovery, elapsed-age, physical capacity and E-D transaction replay stay false; original acknowledgement/storage visibility remain `not_proven`. Native budget enforcement, when actually observed, is distinct from a model that merely fits and from physical-capacity qualification.

Keep unavailable fixture/oracle/backend, authentication/hash mismatch, `changing`, `publication_incomplete`, `transaction_mapping_pending`, clock/deadline/cancel, work-envelope exhaustion and `release_unconfirmed` distinguishable. Map unexpected parser/provider/native exceptions to bounded coded errors without raw input/path/stack leakage. New experimental facts are never market or notification signals.

## Implementation And Approval Gates

| Slice | Proposed work | Tests permitted by that slice | Still excluded |
|---|---|---|---|
| C-A | Pure full-binding/work-envelope/result/byte-binding contracts, deterministic selection plan, worst-case accounting | Supplied invented bytes/hashes, exact/one-over limits, ordering descriptions, all qualification-false model reports and source boundaries | Native addon load/read, fixture creation, actual joint capabilities or successful native claims |
| C-B | Separately branded joint bootstrap/controller, private transport reuse, B-2/B-1 connection and original cleanup/deadline enforcement | Disconnected/memory refusal and lifecycle tests; no fabricated native-positive facts | Actual native fixture runs until setup/read/teardown scope is approved; signed-on-disk evidence |
| C-C | Explicit synthetic native integration acceptance for the approved pipeline | Separately approved new private marked invented fixtures; unsigned negative cases first; signed positive cases only after separate signature-persistence approval | Existing/real stores, production keys/services, history/execution, MCP/production/Dot enablement |

C-A was approved as the first implementation request. Its work envelope is mandatory and has no arbitrary new numeric defaults; implementing it does not approve C-B/C-C. Public RFC-vector **memory checkpoint** signing remains the already-approved B3-B helper boundary. Saving signed record envelopes, making signed native fixtures, their keys/authority setup and fixture teardown are not authorized by that earlier approval.

Later acceptance must cover original/foreign/copied probe/model/joint/native tokens; complete-binding mismatch; unknown or excessive work before allocation/dispatch; changed/missing/extra witness or mirror; native/B-1 physical hash disagreement; logical/physical digest confusion; role-ID collisions discovered after C0; V0-only or reopened-snapshot attempts; change after C1; lost owner/generation; cancellation in every phase; simultaneous response/timeout; partial-root/close failures and cleanup retry exclusion; both exact native/outer boundaries and no double-counting/refund; all positive/negative result fields; and absence of signer/startup/MCP consumers. B3-Bc's 457 scoped regressions remain required after any shared transport refactor.

## Design Verification

The initial design step changed only design/backlog links. Its interface observations came from the current B-1, B-2 adapter/native profile, B3 registry/probe and B3-A calculator. It performed no implementation, fixture, signature, native build/read/test, MCP operation, job change, commit or push. Implementation results are recorded separately below; existing passing tests are not evidence that a joint native view has been obtained.

## C-A Implemented Boundary

The separately approved pure module is [nativeBarAdmissionJointReadContracts.ts](../src/nativeBarAdmissionJointReadContracts.ts). It exposes validators, comparisons and deterministic model calculations only. It creates no ticket, enrollment, live query, provider, clock or native context. The new result schema is `native-bar-joint-read-model-result-v1`, not the proposed live result schema above. Every native/signature/checkpoint/prefix/view/authority/history/approval/execution/timing/capacity qualification is literally false; acknowledgement and as-of visibility remain `not_proven`, and cleanup is `not_performed`. Supplied phase names cannot prove that those operations happened.

| API | Supplied model contract |
|---|---|
| `validateSyntheticAdmissionJointBinding` / `checkSyntheticAdmissionJointBindingMatch` | Validate/detach the complete B-2 registration and its digest; compare the entire registration, including basename, root facts, volume and key fingerprint |
| `validateSyntheticAdmissionJointWorkEnvelope` / `planSyntheticAdmissionJointWork` | Require all per-root entry/inventory/metadata caps, five object-role counts, selected/decoded/interpretation byte caps; account existing shared resources and only unchanged/lowered limits |
| `selectSyntheticAdmissionJointWitnesses` | Bound BigInt sequence before count-sized work; require the complete supplied numerical `1..N` witness list, unique original global indices, safe classification and total byte caps; no longest-prefix fallback |
| `matchSyntheticAdmissionJointRecordBytes` / `matchSyntheticAdmissionJointContentBytes` | Intrinsically copy bounded ordinary typed bytes, hash the exact physical encoding and compare both supplied native/encoded hashes; require exact producer mirror location/bytes when declared; keep logical digests separate |
| `checkSyntheticAdmissionJointWorkUsage` | Compare supplied per-root/object/byte counters against every original supplied cap; report blockers rather than silently narrow work |
| `nativeBarAdmissionJointModelResultSchema` / `validateSyntheticAdmissionJointModelResult` | Strict bounded all-false model reports, exact phase-prefix order, unique indices/blockers and consistent failure/status/cleanup fields |

All numeric envelope fields are required canonical decimal strings. Binding-specific minima preserve policy, markers and ancestor/control framing. Returned validated configuration is detached but editable supplied data, not an immutable live enrollment. C-B must privately capture the original binding/envelope and their digests; it must never accept a later caller-edited envelope, model result or `supplied_*` match as native evidence. Counter comparison is an upper-bound check only, not proof of complete inventory, cross-counter consistency or operation order. Complete-inventory authentication and B-1 decoding/signature/transcript checks remain unimplemented here. Input guards reject ordinary accessors, cycles, sparse arrays and exotic bytes, but do not isolate hostile in-process Proxy traps.

### Conservative Work Schedule

Let `N` be the total object-slot bound, `B` the sum of each slot's full existing namespace role cap, `E` the combined inventory-entry bound and `A` the registered ancestor count. Role caps are witness 16 KiB, producer mirror 8 KiB, payload 1 MiB, receipt 16 KiB and maintenance metadata 64 KiB. These are raw namespace caps, not permission to exceed a smaller B-1 inner-envelope limit. B-1's actual encoding-specific caps must still be enforced by C-B.

- Every object slot charges its full role cap even when the aggregate selected-byte admission cap is smaller. Mandatory decoded material is at least `6*B + 4096*N`; interpretation framing is at least `65536 + 4096*N`. Smaller declared caps block the model instead of reducing these charges. Only actual serialized configuration length varies with shorter decimal strings.
- Additional ACL call bound is `32*(A+6) + 6*(3*E+6*(A+6)) + 5*N*(2*(A+6)+2*16+8) + N*(A+6)`. This covers setup/guards/report, six inventories and five content passes at the existing maximum relative depth 16. Each call reserves `131072` bytes because native ACL text is bounded at 65536 and charged twice. Existing B-2/B3-A floors stay in addition, deliberately conservative. This can refuse larger envelopes without raising any existing ceiling; it is a supplied schedule, not physical memory/CPU or host qualification.
- Protocol framing retains three report envelopes, existing shared state and bounded control/interpretation work. Verification/provider work cannot be supplied as zero. The existing calculators retain six inventory passes and three captures plus V0/V1 content work.
- `native_allowance` keeps B3-A's outer/native separation. `native_limits` additionally clamps each dimension to the planned native work bound, so a small envelope cannot obtain the entire global allowance. `outer_read_bytes` identifies only outer copies/verification/provider work; V1 remains inside native work and is not subtracted twice.

### C-A Verification Scope

New memory-only functional and exact-import/source-boundary tests cover full-binding mismatches, required envelope fields, exact/one-over work limits, shared pressure, mandatory floors, numerical prefix completeness, raw/logical hash confusion, mirror binding, role caps, unsafe byte views, result qualifications and counter limits. Incoming E-A/B-2/B3-A boundary allowances are extended only for this module's pure dependency graph; its own guard checks every imported name and prohibits capability factories, clocks, RNG, signers and runtime consumers.

The approved verification set is these 77 new cases plus the existing 457 scoped B3-Bc-and-earlier memory/boundary cases. Native/host tests, broad filesystem suites, fixture setup, new signature preparation and shared-build deployment are excluded. Existing memory checkpoint-helper regressions retain their already-approved in-memory public-vector behavior. No real-data operation, native addon load/read, fixture creation, signed-file persistence, MCP registration, production activation, job setting or trading/notification/retention condition changes are included. Review and commit remain separate steps.

Observed implementation verification (2026-10-27 JST): isolated TypeScript compilation, all 534 scoped tests (zero failures/skips), no-emit typecheck and tracked diff whitespace check passed. The first combined run refused the new pure consumer at the E-A incoming boundary; the exact module dependency allowance was added, without widening runtime access. Tracked-source hashes show no existing runtime change; common-build and native-addon hashes are unchanged. Dot configuration hash is unchanged and status is PAUSED. The earlier design/backlog changes remain preserved in the same uncommitted worktree. No commit or push was performed.

## C-A Review And Commit Verification

2026-10-27 JST: local review found no actionable defect within the approved pure-contract scope. Review covered full registration identity/detachment, mandatory work bounds and unchanged ceilings, ACL/capture/inventory accounting against the existing native source (static inspection only), outer/native allowance separation with V1 charged once, exact physical-byte versus logical-digest comparison, complete numerical witness selection, strict model-result false qualifications and exact import/consumer guards. No implementation or test changes were required during this review. This was a local review, not a separate independent review or host/native acceptance.

Both isolated TypeScript output directories were freshly compiled from the reviewed source. The explicit 16-suite memory/boundary regression set passed all 534 cases with zero failures/skips; no-emit typecheck and tracked/new-file whitespace checks passed. Common-build, native-addon and Dot configuration hashes stayed unchanged, and Dot remained PAUSED. The user authorized a local commit of these C-A source/tests and the related detailed-design/backlog files. No push, native addon load/read, fixture creation, signature-file persistence, real-data operation, MCP registration, production activation or trading/notification/retention-condition change is included. C-B/C-C and unresolved B-2c host/kernel qualification remain separate gates.

## C-A Independent Review And Corrections

2026-10-27 JST. Two read-only independent reviewers examined `cf75726..bc4a5f2`. One checked the worst-case accounting against B-2a, B3-A and a static reading of the native reader. The other checked contracts, input guards, tests and source boundaries. Neither found an undercount, a false success, a raw (non-`b3ca_`) exception or a caller-getter call. The parent reproduced each finding below in a scratch copy before correcting it.

### Corrections

The user authorized these corrections and their commit.

- **Native response bound.** The interpretation report is outer work. The native floor now uses the default 64 KiB supplied response, so `native_limits.response_bytes` no longer grows with `interpretation_bytes`. Before, an envelope with 8,282,112 interpretation bytes obtained the whole native response allowance while the model still fit. The combined plan still charges the interpretation report.
- **Plans that do not fit.** They return `native_limits: null` instead of clamped values, some of which could be zero.
- **Usage counters.** `checkSyntheticAdmissionJointWorkUsage` accepts any canonical decimal counter and reports a blocker for every entry, byte or object count above the envelope, including values above the global ceilings. Before, a counter above a schema maximum was refused as malformed input while the byte counters were reported.
- **Model results.** They also refuse a `released` phase together with `release_unconfirmed`, selected indices before `inventoried`, and `bytes_bound` without a selected witness (so a complete consistent model needs at least one). Legitimate blocked reports around release and selection stay representable.
- **Joint source-boundary test.**
  - Literal dynamic-import specifiers are recorded, and any spelling of the module name in another `src/` file counts as a consumer, which also covers `createRequire`.
  - `WeakSet`, the event and performance-entry clocks and the whole `Math` namespace are banned; the module uses none of them.
  - `.constructor` and literal element access of a banned name are reported, and default exports are refused.
  - A computed key held in a variable remains outside this static scan, as in the sibling tests.
- **Coverage.** New tests pin the B-2 registration-validator refusal, the witness entry-count and metadata-byte bounds, a producer mirror's own hash mismatch, nine more byte-view kinds, and scope-literal and status consistency.

### Verification

| Check | Result |
|---|---|
| Correction cases on the original source | The eight correction cases fail, including the updated partial-model case; the coverage cases pass |
| All C-A cases on the corrected source | 99 pass (95 functional, 4 boundary); 95 pass from the isolated output as well |
| Nine boundary mutations | Each passes the original boundary test and fails the corrected one: dynamic-import and `createRequire` consumers, `CustomEvent` and `PerformanceMark` clocks, `Math` alias and element `random`, `WeakSet`, `Function` via `constructor`, and a default export |
| 17-file B3 memory/boundary set | 621 pass |
| Full unit suite | 2,891 of 2,893 pass, 0 failures; the 2 skips are the existing root-only and Windows-only cases |
| TypeScript build and diff whitespace check | Pass |

### Actual Planning Range

The medium-severity finding is not corrected here; its range is documented instead. The ACL schedule charges 131072 bytes for every call, as if each carried the 64 KiB native ACL-text maximum. Its call count is also about twice the reviewer's static upper bound for the native reader: 1,091 against 548 calls for one witness at three ancestors. This fails closed and is not a safety defect, but it bounds what the current model can plan:

| Temp anchor | Ancestors | Largest fitting envelope | One witness: read work (ACL share) | One publication (witness, mirror, payload, receipt) |
|---|---|---|---|---|
| `/private/tmp` | 3 | 3 witnesses, or 1 witness with 1 mirror | 144.6 MB (98.9%) | 295.4 MB, over the 268.4 MB read ceiling; refused |
| per-user `/private/var/folders/…/T` | 7 | 2 witnesses, or 1 witness with 1 mirror | 196.0 MB (98.9%) | 364.1 MB; refused |

Inputs: minimal entries (policy and the needed parent directories), 64 KiB common-inventory headroom, and decode and interpretation bounds at their mandatory minima. No C-C positive publication case can obtain a fitting plan under this schedule.

The schedule stays unchanged and the decision moves to the C-B design. Options, in order of preference:
1. Add an explicit ACL-text bound to the envelope and enforce it in the native reader. This needs a native change and its own approval.
2. Tighten the call count to the exact native schedule. This is pure and would admit roughly one publication.
3. Accept this range.

### Notes For C-B

- **Common inventory headroom.** The `common.inventory_bytes` minimum covers the markers only. Native inventory also adds the `st_size` of every ancestor, fixture-parent and root directory, which can change with unrelated activity in a shared temp anchor. An envelope at that minimum fits the model but can never pass natively, and usage checks need headroom.
- **Combined entries.** Envelope validation accepts per-root bounds whose combined entries exceed 512; only the plan refuses them (`entries_limit`). C-B must require `model_fits` before any native begin.
- **Unplanned reads.** Coordination files and `policy.json` are readable natively but have no object slot. Reading them in C-B would be unplanned work.
- **Failure codes.** `primary_failure` accepts any `b3ca_[a-z_]+` token up to 96 characters, like the sibling schemas. C-B should map it to its actual codes.

Only this module, its tests and documentation change. Existing ceilings, B-2a/B3-A calculators, native sources and the common build are unchanged. No native addon load or read, fixture creation, signature persistence, real-data operation, MCP registration, production activation, Dot change or push is included.

## C-B Implemented Boundary

The user approved C-B implementation and memory tests, then explicitly clarified that **executable native connection code may be added, but native execution remains prohibited in this step**. The connection patch was held by the safety check until that clarification. No native read or fixture operation was performed to obtain approval or verify this code.

The disconnected entry is [nativeBarAdmissionJointReader.ts](../src/nativeBarAdmissionJointReader.ts):

```text
createSyntheticAdmissionJointBootstrap(fullBinding, publicKey, workEnvelope)
  -> { jointReaderEnrollment, ownerEnrollment, describe(), close() }
enrollSyntheticAdmissionJointReader(original jointReaderEnrollment)
  -> { beginJointRead({ttl_ms?, lower_limits?}), run(original query),
       cancel(original query), release(original query), describe(original query), close() }
```

Construction detaches the complete binding/envelope, requires an initially fitting plan, privately registers the exact fixture in B-2 and creates separate joint-kind oracle grants. Probe/joint grants have distinct private membership maps, sharing bounded namespace reservations, retained ID tombstones and accounting. The original fixed-owner mailbox and checkpoint wire format remain unchanged; the wire scope is not proof of joint authorization. No provider/backend/path/response/clock callback or signer is injected. Registration and enrollment load no addon or path.

`beginJointRead` samples real clocks before options/preflight, replans against current shared retained/workspace state, reserves the plan, generates an original host UUID and begins B-2 with C-A's native limits and the remaining floored original TTL before any C0. Non-fitting/null-limit plans refuse. The pure model does not measure other native users: B-2's actual global admission remains authoritative, and physical capacity stays unqualified. A throwing begin returns an original diagnostic/cleanup query, closes that native registration instead of replacing/retrying it, and retains any unconfirmed cleanup callback/lease for explicit retry.

The private run connects C0, one pair/inventory, bounded numerical witness selection, B-1 record/location checks, physical hashes, required producer mirrors/current final publication content, V0, C1, V1 on the same snapshot, full B-1 transcript and release/publication. Native schema/entry/index/role/context/counter/generation facts are checked; reconstructed data/witness/common counters must match native totals and the envelope. Signed enrollment root proofs must match registration. Observed role IDs transfer reserved slots into retained tombstones before C1, rejecting query/challenge/foreign-role aliases. Original lease owner-generation checks remain usable after release.

Current final content locations, hashes and proofs come only from authenticated declarations and `publication_observed`; receipt body hashes never substitute for full file hashes. Historical stages need not remain present. Extra/unbound content or mirrors refuse. Pending publication, coordination/reserves and unlinked producers block interpretation. Maintenance moves/unlinks/recovery/metadata remain `transaction_mapping_pending` for E-D, not inferred from absent files or relaxed proof fields. Signed ancestry digests are not promoted into independently host-qualified ancestry facts. Controls/coordination are not added as unplanned selected reads.

Failure/cancellation independently attempts native snapshot/context cleanup and original operation cancellation/retirement. A running asynchronous continuation or unsettled original operation retains the lease until actually unwound/settled. Cleanup exceptions preserve the primary failure and withhold success even if a later close recovers. Repeated cleanup cannot restart reads or replace deadlines/providers/IDs. Timers are unreferenced and cleared; synchronous native syscalls cannot be interrupted by JavaScript. Strict bounded diagnostics keep every qualification false. The separate strict success schema requires every original phase, confirmed cleanup and a final owner/lease/clock check with no subsequent await. **No such native success result was obtained here.** View, authority/intake/admission/approval, history, execution/recovery, elapsed-clock, physical-capacity and transaction replay remain false; acknowledgement/as-of visibility remain `not_proven`. No private path, handle, checkpoint/record body or signature is returned.

### C-B Planning And Test Limits

The corrected C-A ACL schedule, counters and ceilings are unchanged. The restrictive planning range above is deliberately preserved: full producer-publication workloads still refuse before native begin; small witness-only work can fit. Common-directory sizes still need explicit envelope headroom. Improving that range needs a separate design/approval decision, not an automatic relaxation to make a trial fit.

New memory tests cover grant kinds, copied/foreign grants, detachment/alias refusal, impossible-work refusal before namespace consumption, strict options/accessors, record-ID slot transfers/reuse, owner loss/advancement after lease release, joint-transport cancellation with/without immediate acknowledgement and fixed loader/RNG/clock/budget refusals. Disposable refusal workers replace the loader with an unconditional throw and guard `process.dlopen`, asserting zero addon loads. No fake successful native backend, snapshot or native-positive report is provided. Exact-import/export/source tests preserve one-context/snapshot ordering and disconnected startup/MCP/history/market boundaries; static order is not executed native evidence.

Existing B-1/B3 public-vector memory signing stays in the original helper/tests without key/signature persistence or a new signing service. Native begin success, successful reads, signed native fixtures, real V0/V1/counter/late-phase cancellation/close-failure acceptance and final native publication are not tested. C-C/B3-D, B-2c host/kernel gaps and independent review remain open. No broad filesystem/native suite, real-data operation, MCP registration, production activation, Dot resume, trading/notification/retention-condition change, commit or push is included.

Observed verification (2026-10-27 JST): isolated TypeScript compilation, no-emit typecheck, tracked/new-file whitespace checks and the explicit 19-suite memory/boundary set passed. The set contains the prior 621 cases plus 19 C-B functional/refusal/transport cases and 4 C-B source-boundary cases, all 644 passing with zero failures/skips. Initial failures identified the expected new dependency allowances and stale pre-review C-A isolated output; rebuilding the corrected source resolved the latter without reverting its changes. Common-build, native-addon and Dot configuration hashes are unchanged, Dot is PAUSED, and HEAD remains `41a11b8`. No native-positive qualification or deployment follows from these results. Review and commit remain pending.

## C-B Local Review And Corrections

2026-10-27 JST: local review covered complete binding and key/registration privacy, envelope/native/outer accounting, original grant/query/lease membership, C0/read/V0/C1/V1/transcript order, cancellation/settlement/release, publication timing and strict false-authority boundaries. Two medium correctness issues were reproduced and corrected before the user-authorized local commit:

1. A duplicate `run` rejected before acquiring execution ownership still unconditionally cleared `q.running` in its `finally`, potentially allowing cleanup to release the lease while the original continuation had not unwound. A per-invocation ownership flag now allows only the invocation that acquired the run to clear it. A regression extracts/transpiles just the current method's preflight refusal into an isolated memory context with supplied pending state and no native context, backend, authenticated response or positive result. It fails on the original source (`running` became false), passes after the fix and confirms no checkpoint request occurs. This checks that guard only, not a genuine native lifecycle race.
2. Observed record IDs blocked later query/challenge generation but could be re-enrolled as a new bootstrap's authority reference (or other registration ID). Retained observed-record-ID tombstones now reject that later probe or joint registration before charging state or consuming namespace. The regression uses only the unsigned in-memory transport and a recomputed valid registration digest; it fails before the fix and passes after it. Existing bootstrap core-role sharing rules, numerical ceilings and per-ID accounting remain unchanged.

Fresh isolated compilation of B-1/C-A/C-B, no-emit typecheck and tracked/new-file whitespace checks passed. All 645 cases in the explicit 19-suite memory/boundary set passed with zero failures/skips: prior 621 plus 19 C-B functional cases and 5 C-B source/isolated-guard cases. Common-build, native-addon and Dot configuration hashes stayed unchanged; Dot remained PAUSED. C-A pure/runtime/native sources outside the scoped oracle-registry connection are unchanged. Review was local, not a new independent review or native/host acceptance. Real native positive and late-phase acceptance, C-C/B3-D and B-2c host/kernel qualification remain open. No native addon load/read, fixture creation, signature-file persistence, real-data operation, MCP registration, production activation, trading/notification/retention-condition change or push is included.

## C-B Independent Review And Corrections

2026-10-28 JST. Two read-only independent reviewers examined `41a11b8..0205134`. They worked in `git archive` copies that contain no native addon, and every probe refused the loader first, so nothing native ran. One reviewer covered lifecycle, ownership and registry accounting. The other covered native facts, content binding, boundaries and tests.

They found no early release, no success after expiry, rollback, owner change or cleanup failure, no crossing between probe and joint grants, and no way around the record-ID tombstones. The parent reproduced or statically confirmed each finding below before correcting it.

### Corrections

The user authorized these corrections.

- **Fixture markers (high).** Native `acontrols`/`aread` report both fixture-root markers with `raw_byte_limit` "0" and `readable_evidence` false. The reader expected the B-2a name cap "4096", so every real inventory refused with `b3cb_native_entry` after C0. Fixture-root controls and structural directories must now carry "0" and false. Data and witness entries keep their classified cap and readability.
- **Failure codes (medium).** Bare addon codes (optionally with `:errno`) and `b2a_`/`b2b_` codes used to collapse into `invalid_input`. They now map to:
  - `native_unavailable`;
  - `deadline`;
  - `native_deadline_or_rollback`;
  - `native_changed`;
  - `native_busy`, for `admission_busy` and the shared root, session and FD slots;
  - `native_budget`, for the other `_limit` codes;
  - `native_refused`, for everything else.

  Owner-side `oracle_rejected`, `oracle_cancelled`, `response_bytes` and `request_binding` keep their own codes. `b3ca_witness_bound` reports `work_envelope`, and a classification error reports `native_entry`. A native begin refusal is coded the same way and still closes the registration.
- **Non-darwin refusal (medium).** Off darwin, B-2 refuses before it reaches the loader. The refusal worker now expects one loader attempt only on darwin. With the original expectation, runs with linux and win32 spoofed failed with `0 !== 1`; the CI matrix covers ubuntu, macOS and Windows.
- **Main-thread tripwire (medium).** Before importing, the C-B test file replaces `createRequire` (for `.node` targets) and `process.dlopen` with refusing traps. A final case asserts that no load was attempted.
- **Low.**
  - **Shared-cap refusal.** A `claim.acquire` refusal under a lower shared cap is now coded as `b3cb_state_budget`; it used to escape as raw `b3ba_state_budget`.
  - **Deadline timer.** The timer rounds the monotonic remainder up and adds 1 ms, so a millisecond-granularity timer cannot fire before the TTL. It used to floor the remainder: at a 7 ms TTL, 14 of 60 rounds reported `clock_relation_unavailable`. B-2 still gets the floored remainder, and the reviewed probe timer is unchanged.
  - **Record IDs.** `bindRecordIds` exempts only the registration's pins. An observed record ID equal to `authority_reference` is refused as `identity_reuse`. Records never carry that ID, and B-2 requires it to differ from every pin.
  - **Publication codes.** Pending stages, coordination or reserve entries, missing publications and unlinked producers now report `publication_pending`, `coordination_active`, `publication_missing` and `producer_unlinked` respectively.
  - **Byte capture.** Captures in C-B and C-A no longer list one own key per byte, which cost about 87 MiB of transient heap for a 1 MiB payload. As in B-1, bytes are read only through intrinsic getters and copied, so decorations are never consulted. The C-A decorated-view cases now expect a copy that never invokes the decoration.
- **Nits.**
  - The factory closes the oracle and B-2 registration if fixture registration refuses.
  - `failedBegin` is set immediately before the native begin.
  - Maintenance metadata refuses before any evidence is read.
  - The published result is validated and size-checked again after its final fields change.
  - A boundary rule confines clock reads to the captured `wallNow`/`tickNow` pair, sampled in one place, and to pure `Date.parse`.

### Verification

| Check | Result |
|---|---|
| New tests on the original source | 10 cases fail: the 7 C-B correction cases, the 2 C-A byte-view cases, and the order case with its new marker. With the original worker expectation, both spoofed-platform refusals fail too |
| Corrected source | C-B 35 cases (29 functional, 6 boundary) and C-A 99 cases pass on three runs; 78 isolated C-B and completion cases pass |
| Tripwire under an injected regression (non-strict options schema) | The original test file made two main-thread native `require` attempts. The corrected file intercepted them and its tripwire case failed |
| 19-file B3 memory/boundary set | 656 pass |
| Full unit suite | 2,926 of 2,928 pass, 0 failures; the 2 skips are existing |
| The 23 test files changed since `49c68b6`, with the platform spoofed | linux: 807 pass. win32: 806 pass; the 1 failure comes from `os.tmpdir()` finding no `TEMP` on darwin, and passes with `TEMP` set |
| Build and whitespace check | Pass |

The native-shaped tests extract the reader's own functions and run them with the built dependencies and supplied values. They create no native backend, snapshot, fixture or success result. Spoofing changes only platform gates, so the real ubuntu and Windows CI after the push remains the check for other OS differences. Nothing after a successful native begin has run, and C-C remains the acceptance for that path.

Unchanged by design: a registration's own pins stay exempt from tombstones, so a later registration may still take another registration's pin under a different role. This follows the core-role sharing rules in place since B3-Bb.

Only the reader, the registry, the C-A module, their tests and helper, and this documentation change. Native sources, ceilings and plan formulas are unchanged. No real-data operation, fixture creation, signature persistence, MCP registration, Dot change or push is included.
