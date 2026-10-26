# B-2 Paired Native Reader And Fixture Registration

Status: **B-2a/B-2b implemented; constrained B-2c acceptance tests run, host qualification pending**, 2026-10-26 JST, based on `cbce6d3` and the [E-B design](NATIVE_BAR_ADMISSION_READ_DESIGN.md). The user approved the B-2c tests within the existing newly invented unsigned-fixture boundary. Native validation builds stay isolated from the normal MCP build. Actual OS clock/mount changes, kernel-failure qualification, authority/service, real-data, MCP and production integration remain gated. Dot remains PAUSED; market confirmation, scenario, notification and retention conditions remain unchanged. Earlier implementation sections below retain their historical slice scope.

## Scope And Baseline

B-2 supplies a fixture-only, descriptor-native reader for the two existing v6 roots, plus a process-local registration of independently supplied test expectations. It does not supply B-3's authority requests, fresh challenges, signed joint view or latest-state qualification. Native byte/identity facts and cryptographic/current-state facts stay separate.

The current code explains why a separate entry is needed:

- [The optional adapter](../src/nativeBarFs.ts) exposes independent v2/v5 root readers, not one paired deadline/resource context.
- [The native opener](../native/native_bar_fs/native_bar_fs.cc) accepts a marked temporary fixture ending in `/store`; it cannot open the witness sibling. V5 checks its own exact policy.
- [The current inventory](../native/native_bar_fs/native_bar_read.inc) has per-root limits, v2/v5 namespace rules and shared legacy handle tags. V5 adds ACL digests, allocation and ancestor checks, but final inventory verification does not rehash the full previously read content set.
- [B-1](../src/nativeBarAdmissionVerification.ts) verifies supplied memory only. Preserve `6f285f9`'s weak-key refusal, any-realm shared-memory/detached-view refusal, captured-byte hashing, coded decoder errors and strengthened source-boundary tests. Preserve the C0 prefix chronology check. Do not restore older code while implementing B-2.

Reuse descriptor/ACL/hash primitives where their assumptions match. Do not widen the old root opener, reinterpret a v5 snapshot as v6, add a policy override or expose legacy mutation handles through the new reader.

## Approved Design Decisions

| Area | Proposed decision |
|---|---|
| Entry | Optional `admission_read_protocol:6`; a dedicated paired opener and distinct pair/snapshot native tags |
| Registration | Explicit trusted synthetic bootstrap; memory only, no disk enrollment or automatic discovery |
| Physical scope | Existing `store` and `admission-witness` siblings under the same private marked temporary fixture |
| Ownership | Same process/registry; one live registration and at most one active read context, opened or not, per registry |
| Query | Start a read context without opening trees, then explicitly open the pair; one initial paired snapshot, indexed reads, final joint verification and release-only close |
| Budgets | One immutable deadline and shared counters from context start, before C0 in future B-3 and before the first native open; never two full per-root allowances |
| Completion | Only current native-scope/read-set facts; no signed/current ledger, accepted history, approval or execution |
| Tests | Approved for B-2b: newly created, invented unsigned fixtures only; no persisted signatures or keys |

B-2a/B-2b and the constrained B-2c tests below are approved. Wider host-level B-2c qualification, B-3 and subsequent E slices keep separate gates; passing these tests is not production enablement.

## Registration Contract

Provisional TypeScript interface, not an MCP API:

```text
createSyntheticAdmissionReadRegistry(trustedBootstrap)
  registerFixture(expectedRegistration, fixedPublicKey) -> opaque fixture ticket
  beginRead(ticket, optionalLowerLimits) -> read context, roots not opened
read context
  openPair() -> paired read lease, once only
  close()
registry
  closeFixture(ticket)
  close()
```

Construction and registration validate bounded ordinary data and the fixed B-1 public-key/pin contract in memory only. They do not load the addon, read paths, contact an authority, generate a challenge, scan for a fixture, or construct missing expectations. Keep registry/ticket membership in private process-local state. Never return an embedded path, key, provider or callback as a reusable authority.

`expectedRegistration` must contain:

- Exact version/synthetic scope, distinct lower-case fixture/store/epoch/authority/key IDs, logical enrollment hash, exact E-A policy hash and fixed public SPKI fingerprint.
- A canonical test-temporary anchor and fixture basename supplied by the trusted harness; derive the two root paths from fixed literal `store` and `admission-witness` components. No independent arbitrary root paths, file descriptors, URL, glob, environment override or caller-selected loader.
- Independently prepared expected fixture-parent, root and ancestor identity/access bindings: lossless device/inode/owner/group/mode/flags/birthtime and full ACL hash. Include the expected volume/case properties and the two marker byte hashes. These expectations are not collected from a caller's displayed inventory or automatically filled by the reader.
- A fixed fixture-authority identity/reference reserved for later B-3 registration, not an executable provider or requester-supplied verifier. B-2 neither invokes that reference nor declares its state available.

**Independent expectation source.** Node's `fs` cannot observe BSD flags or complete ACL hashes. So the trusted harness must not fill these expectations by calling the reader under test, or code that shares its observation path; that would make the binding check self-confirming. B-2b fixture preparation should collect them with a separately built, test-only helper, as `recoveryReserveFixture.cc` already is. The helper should use different system interfaces from the reader: for example `getattrlist` and `acl_get_link_np`, rather than the reader's descriptor `fstat`/`acl_get_fd` path. The helper's source and build belong to B-2b's explicit setup approval. B-2a's memory-only contracts accept supplied expectations and cannot judge where they came from.

Capture detached immutable expected values. Apply existing bounded strict/canonical/lossless ID conventions; reject accessors, cycles, unknown fields and role aliasing before any open. Cap the complete serialized expected registration at 64 KiB, each absolute anchor path at 4,096 UTF-8 bytes and each expected ancestor chain at 16 components; a longer host layout refuses rather than following an alias. Registration metadata, key bytes and tickets are included in memory/accounting limits; registration does not create another allowance. Initial implementation permits one registration per registry; changing it requires closing it, not mutating an active pin. Duplicate fixture/root identity registration in the same registry is refused.

Tickets must reject copies, JSON lookalikes, tickets from another registry/process, closed registrations and a registry that has lost its trusted bootstrap. No public serialized report can recreate a ticket. `closeFixture` revokes the ticket and closes its active pair. Registry close revokes all its tickets and releases resources. There is no restore-from-disk, auto-registration, key rotation or registry restart path.

The trusted bootstrap itself is an in-process test dependency, not an authenticated human or an OS sandbox. Code already able to replace this process, its bootstrap or raw addon is outside that boundary. The native allowlist and read-only tags still apply independently; trusted registration must not mean that any supplied production pathname becomes acceptable.

## Physical Fixture And Control Files

Retain the previously proposed shape:

```text
<captured canonical test temp>/native-bar-fs-synthetic-<six alphanumeric chars>/
  .native-bar-fs-synthetic
  .native-bar-admission-synthetic
  store/
    policy.json
    producer/<producer-id>/<sequence>.json
    captures/...  receipts/...  maintenance/...  ...declared E-A locations...
  admission-witness/
    <sequence>.json
```

The old marker remains exactly `synthetic-fixture-v1\n`. Propose one strict canonical E marker, bounded at 4 KiB including all fields: `schema:native-bar-admission-fixture-marker-v1`, fixture/store/epoch IDs, `policy_hash`, `data_root:store` and `witness_root:admission-witness`. The marker hash/expected fields come from the trusted bootstrap; finding the marker on disk cannot enroll a fixture. `store/policy.json` must be the exact current `NATIVE_BAR_ADMISSION_PROFILE` bytes. There is no duplicate policy requirement inside the witness root and no policy/key rewrite.

Both roots and markers must already exist. Open from `/` through exact no-follow components; allow only the captured qualified test-temporary anchor and six-character fixture layout. Do not canonicalize an arbitrary request path by following links, reinterpret another alias or fall back to `/tmp` when the pinned anchor fails. Capture the test anchor once through trusted setup; changing `TMPDIR` between reads must not change registration or native selection. The implementation must reconcile that captured anchor with the native synthetic allowlist, not accept a request's claimed temporary directory.

Roots must be distinct, non-nested, same-owner directories on the same qualified local APFS device with enforced ownership and verified case behavior. Reject cross-device children. Pin their common fixture parent and both markers for every read. Count all common-parent entries; this initial dedicated fixture permits only the two roots/two markers at that level. Put future test helpers outside that parent. Unknown parent entries refuse registration binding, rather than silently disappearing from scope.

Use full stable identity/access bindings for system ancestors without treating unrelated activity in the OS temporary directory as fixture mutation. For the private fixture parent, roots and in-scope directories, compare complete metadata/allocation/ACL snapshots during the query. Preserve the existing deny-only/no-ACL policy; an explicit or inherited allow entry or unverifiable ACL cannot qualify. Do not repair ownership, permissions, flags or ACLs. Read-only mounts may be read if their required capabilities qualify; no mutation probe is allowed.

## Dedicated Native Capabilities

Provisional native surface:

```text
info().admission_read_protocol == 6
beginAdmissionRead(fixedExpectedBinding, lowerLimits) -> native context, no path IO
openAdmissionReadPair(context) -> native pair, once only
admissionInventory(pair) -> native joint snapshot plus detached report
readAdmissionEvidence(pair, snapshot, rootRole, entryIndex) -> bytes plus native proof
verifyAdmissionInventory(pair, snapshot) -> detached final native report
closeAdmissionInventory(pair, snapshot)
closeAdmissionReadPair(pair)
closeAdmissionReadContext(context)
```

Names may change during implementation; the capability boundaries may not. The adapter stores the pair and its fixed expected binding privately; normal reads never accept new paths/pins/proofs. A root role is exactly `data` or `witness`, and an index is a finite safe integer in that role's immutable snapshot. Modified JS reports cannot change native entry selection or proofs. No caller path, FD, inode or serialized proof is a read selector.

Context, pair and joint-snapshot tags must be distinct from each other and from legacy session/target/snapshot/coordination/quarantine/recovery handles, including across all new exports. The native snapshot is owned by that exact live pair/process. The pair exposes no individual legacy root handles. Test the full cross-use matrix in both directions; a TypeScript type or `read_only` flag alone is insufficient.

The same optional addon location is used, but B-2 requires its explicit protocol capability. Missing/old addon, wrong platform/profile or unsupported volume refuses without a Node-filesystem/legacy-reader fallback, download or compile. Import/construction performs no native load/open. Runtime code is disconnected from startup, MCP, history, charts and notifications. If later approved, narrow source-boundary allowlists only for the specific new internal reader dependency; retain E-A/B-1's pure behavior and all false authority flags.

## Query Lifecycle And Binding Checks

State proposal:

```text
registered -> context_started -> opening -> pair_open -> snapshot_ready -> verifying -> native_checked
native_checked -> verifying -> native_checked  # recheck original snapshot only
any active state -> failed -> closed
any active state -> closed
```

Registration and context start are not successful root opens. A read failure invalidates that context/pair; only release/close remains possible. Native-checked is not a signed joint view and does not accept new evidence reads. Repeating final verification is permitted only against the original snapshot/read set, with additional read work charged; it cannot take a new baseline. One joint snapshot per pair is proposed; closing it does not reopen scanning or reset any counters. A new query is explicit and creates a new context under the same fixed registration, not a retry inside the failed query.

At explicit `beginRead`, the optional addon is loaded/capability-checked and creates the common native wall/steady-clock deadline and budget without fixture-path IO. Addon loading itself uses the fixed binary path and is not a claim of zero OS IO; fail the adapter's already-started deadline if loading overruns it, and narrow the native deadline to that remaining allowance. Reserve both root-lease slots together or refuse; a roots-not-yet-open context still consumes those reserved slots until close. `openPair` later opens both roots under that same context, once only. Complete opening work, marker/policy reads, partial-root failure and response construction belong to the original budget/deadline. No root gets a later deadline. Existing native resource counters include the two root leases, their shared ancestry, open files and temporary traversal descriptors; shared FDs are counted once as physical handles, never hidden by calling the pair one root. Adapter and native accounting must not count the same reserved lease again when its FD opens.

Initial inventory collects data and witness as one bounded unit, then collects both again and compares them along with markers, policy and all pinned bindings before exposing the snapshot. Directory traversal is exact-name, no-follow and bounded. A changed/missing second root cannot leave a usable first-root snapshot. Snapshot output is detached; root role, sorted exact paths and complete native proofs determine a joint generation digest, not lexical ledger interpretation.

For an indexed evidence read, recheck both root/marker/ancestor bindings and the selected parent chain, then open the exact single-link regular object nonblocking. Validate owner/mode/ACL/flags, size and original native identity before allocation. Read bounded bytes, hash those exact captured bytes natively, and repeat identity/access/name checks after reading and after constructing the result. Never substitute a B-1 logical-record hash for the native whole-file SHA-256. Keep the immutable proof/hash for each successfully read object inside the pair, not in caller JSON. Before any joint claim, B-3 must require two hash equalities. Each witness record's native whole-file SHA-256 must equal B-1's `encoded_sha256` for the same captured bytes. Each producer mirror's native hash must equal its witness record's.

Final verification is stronger than the existing v5 metadata-only endpoint: compare fresh inventories of both roots, reread/re-hash both markers, the policy and the exact successful read set, then compare both inventories/bindings again. A second read of one object is charged again, but the retained read set contains only one immutable expectation for it; conflicting rereads fail. Content/ACL/allocation/name drift anywhere in scope blocks success. This remains a bounded sequence of observations, not an atomic filesystem snapshot or a guarantee that bytes cannot change after return.

Check wall-clock rollback against the last observed wall time, not only the opening time, and the original exclusive ten-minute bound around each bounded operation and result construction. Native steady-clock and wall deadline checks cannot be renewed by snapshot close or JS work. Later B-3 must call `beginRead` before C0, then `openPair` after C0, and retain the same context through C1 and its post-response final recheck. It cannot open a new context after the authority response to refresh its time budget. B-3 also owns real challenge/order/authority checks, including zero-width supplied C0/C1 times that B-1 alone cannot qualify.

All explicit exits close snapshots/descriptors in `finally`/native RAII, including partial opening, limits, malformed arguments, reentrancy, callback exceptions and final-check failure. Close after expiry remains release-only and idempotent. Prefer no runtime callbacks; any later race-injection hook is synthetic-test-only, synchronous/void, non-reentrant and has surrounding guards. GC may release resources but never provides affirmative close verification. Do not silently report successful release if a close error is observable; return a bounded `release_unconfirmed` diagnostic. No writer lock, fsync, atime restoration, cleanup, retirement or data mutation occurs on close.

## Namespace And Read Classification

Use a separate role-aware v6 classifier, not v5's rule that any ordinary root file is readable evidence. Classification is structural only; it is not canonical JSON, signature, lineage, ledger completeness or transaction validation.

| Location | B-2 treatment |
|---|---|
| Witness `<canonical-positive-decimal>.json` | Witness candidate; lossless 1-30 digit grammar; bounded raw read, not an authenticated ledger member |
| Data `producer/<lower-case UUID>/<canonical sequence>.json` | Producer mirror candidate; exact component/role grammar; no invented mirror for enrollment/maintenance |
| Policy and the two fixture markers | Exact pinned control bytes, freshly checked and charged |
| Capture/receipt final and declared stage-shaped files | Bounded raw candidates, not committed pairs or abandoned eligibility |
| E-A maintenance/layout/coordination locations | Bounded raw candidates; current transaction placement/absence remains unresolved for E-D |
| E-A `.ea-...` and producer temporary patterns | Preserved pending candidates, counted; never parsed/adopted as completed records or cleaned up |
| Reserve/holding/quarantine payload slots | Count size/allocation and structural role; large reserve contents are not evidence to read or hash |
| Ordinary safe side files outside private namespaces, including `.DS_Store` in receipt/capture directories | Preserve/count; not JSON evidence and not an integrity failure merely because contents are not JSON |
| Unknown/malformed/folded evidence names in witness, producer or private transaction namespaces | Preserve/count with namespace blocker; do not skip them to choose a shorter valid prefix |
| Link, FIFO/socket, unsafe file, oversized candidate | Never readable; preserve metadata only, do not follow/open its content; required evidence remains unavailable |

**Witness-root temporaries.** E-A charges three failed-publication temporaries per witness record, and E-B mentions predeclared witness temporary slots. However, no witness-root temporary name production exists yet: E-A defines only the data-root `.ea-…` and `.producer-…` names. Until E-C defines and separately approves one, every witness-root entry other than `<canonical sequence>.json` is an unknown private entry that blocks a complete view, not a pending candidate. B-2a's classifier already implements this.

The implementation contract must enumerate exact E-A layout-derived productions (including directories and interrupted slots) and their maximum raw sizes, without borrowing all v2/v4/v5 filenames. Lexically plausible temporary names are not proof of reservation; exact membership belongs to B-3/E-D. A missing file is not a deletion event. Unknown ordinary directories may be traversed only within the same private-access/depth/budget checks, never as new evidence roots.

Detect Unicode-normalized/case-folded collisions and reserved-name aliases even on case-sensitive volumes. Preserve observed UTF-8 bytes and recheck exact component names. No path normalization/case repair, namespace exclusion or special exception for interrupted writes is permitted.

Before parsing the inner role, the native bound is at most 16 KiB for a witness envelope and 8 KiB for a producer mirror, derived from the maximum existing role in each namespace. B-1 must still enforce the actual inner role's wrapper-inclusive 4/8/16 KiB limit later. Capture/stage raw reads stay at most 1 MiB, receipts at most 16 KiB, other declared metadata at most 64 KiB. A receipt-shaped stage not yet bound to a producer remains pending rather than earning receipt validity from the generic stage bound. Control markers use the smaller 4 KiB bound above. No signed wrapper allowance or native size inflation is added.

## Shared Resource Accounting

Keep the current ceilings: 512 combined entries, 1 GiB inventory, 16 MiB metadata, 256 MiB cumulative read work, 8 MiB response, eight live root leases, 32 live mutation targets, 512 native FDs and the existing 48 additional-FD headroom rule. B-2 creates zero mutation targets, but other live addon resources remain included. Depth 16 and 512-byte relative paths also remain fixed. Lower test limits can only reduce a ceiling; reject unknown/increased limits before opening.

- Charge both trees and their common control/registration metadata before the next allocation/open. Count each distinct in-scope entry once per joint inventory, including root/control/parent overhead conservatively; do not reset 512 for the witness root. Repeated enumeration does not invent additional retained files, but its traversal/read work is charged again.
- Account for expected bindings, key bytes, markers/policy, all retained inventory/proof/hash data and both root reports under the shared metadata/response bounds. Validate conservative serialized response bounds before constructing large N-API/JS results. Final serialized reports include framing/labels/decimal counters, worst-case path escaping and raw Buffer representation if exposed.
- Content budget charges every attempted/read/rehashed byte, including short/error reads, marker/policy rechecks and repeated content reads. Charge bounded directory-name, ACL serialization and other native observation buffers conservatively as read work before retaining them. This is process-visible accounting, not measurement of physical device traffic or kernel cache IO.
- Enforce checked/lossless arithmetic and remaining-budget checks in native code, not by summing two already completed full-root reports in JS. Current inventory/retained memory and cumulative read work are distinct counters. No close/reopen of a snapshot, alias, hard link or shared volume earns duplicate budget credit.
- Process-wide counters include existing v2/v5/R-D activity. Reserve two lease slots and traversal/response headroom before work; unwind partial acquisition exactly. Future B-3 must conservatively precharge bounded C0/C1/provider/bootstrap overhead and pass only the lower remaining byte limits at `beginRead`, before C0 or any tree IO. Unused external headroom is not refunded during that query. Its tests must not treat two separately successful component budgets as a successful combined query.

The tighter whole-scope accounting may refuse a fixture below the apparent per-root maximum; that is deliberate. Do not raise limits, drop unknown entries, split a failed write plan or reuse read-only resource counts as E-A's write-capacity qualification. The E-A two-target 551-entry refusal, physical reserve rules and shared-volume accounting stay unchanged. No allocation/reservation, authority-storage scan or free-space promise is introduced.

## Results And Failures

Propose separate internal schemas `native-bar-native-admission-inventory-v6`, `native-bar-native-admission-bytes-v6` and `native-bar-native-admission-verification-v6`. They include exact protocol/synthetic scope, root roles, observation brackets, joint generation, native proofs and lossless cumulative counters. Diagnostic reports expose no private absolute path, key material, payload snippets or raw OS/parser text.

Individual reads may set `native_bytes_verified:true` for their exact bytes/proof. Only successful final joint verification with both namespaces qualified may set `native_snapshot_verified:true` for the bounded roots/read set. It is not verification of unread file contents or a current signed ledger. Pending-candidate counts remain explicit even when their structural namespace qualifies; they are not completed publications. B-2 leaves `view_verified`, `fixture_signature_verified`, `checkpoint_pair_verified`, `logical_prefix_verified`, `authority_state_verified`, `original_intake_verified`, `admission_verified`, `approval_authenticated`, `execution_available`, `recovery_execution_available`, `committed_history_available` and `elapsed_clock_qualified` false. Original acknowledgement and historical storage visibility remain `not_proven`; physical capacity is not qualified. A native result is never a B-1 input assertion or a serialized admission capability.

| Failure | Required behavior |
|---|---|
| Invalid/foreign/closed ticket, missing bootstrap | Refuse before native load/open; no auto-registration |
| Addon/platform/profile/volume/pinned anchor unavailable | Coded unavailable diagnostic; no fallback or initialization |
| Marker/policy/root/ancestor/access substitution | Invalidate and release the entire pair; no one-root success |
| Unknown private namespace or unreadable required evidence | Bounded inventory diagnostic, no complete verified view or adopted prefix |
| Metadata/content/namespace drift | `changing`; stop, no retry or repair |
| Limit/deadline/rollback/reentrancy | Stop before additional work; counters/deadline cannot be refreshed |
| Release not confirmed | `release_unconfirmed`; do not return successful final qualification |

## Synthetic Acceptance Plan

These are proposed future tests, not performed tests. Native B-2 cases require APFS. On unsupported CI platforms (Linux, Windows) they skip with an explicit reason, and a skip never counts as qualification. Fixtures require separate explicit setup/teardown approval. Use new private marked temporary trees containing invented **unsigned raw bytes**, plus sibling victim fixtures for no-follow tests. Runtime registration/open/read/verify/close creates nothing. No signing, private-key generation, persisted signature/key or original intake is required for B-2 tests; keep B-1's public-test-key signing tests in memory. Combining signed on-disk fixtures with B-3 needs a later explicit approval.

| Area | Required cases |
|---|---|
| Registration | Zero IO on import/construct/register; strict bounds/pins; weak/private/forged keys; cloned/foreign/revoked/process-mismatched ticket; expected-pin mutation; changed temporary anchor; duplicate registration |
| Paired open | Exact two roots/markers/policy; v1/v4/v5 and old addon refuse; second-root/marker failure unwinds first; same/nested/swapped/cross-device roots; arbitrary/aliased/production path refusal |
| Native isolation | Every new handle against every legacy mutation/coordination/recovery/read export and vice versa; forged/cross-pair/closed snapshots; modified detached reports do not change selection |
| Binding/access | Same-byte inode replacement, directory rename, both marker substitutions, policy change, explicit/inherited ACL grants, deny-only ACL hash drift, flags/allocation change, owner/mode/birthtime changes |
| Namespace | Numeric `1,10,2`, leading zeros/30-digit limits, folded Unicode/case names, misplaced mirrors, unknown private entry, ordinary Finder file, malformed/in-progress temporary, unsafe link/FIFO/socket/oversize preserved without opening contents |
| Joint resources | Combined exact limits/one over; first root exhausts remainder before second; markers/policy/ACL/escaped paths/registration overhead; repeated/partial/failed reads; two lease slots and existing FD pressure; no counter reset |
| Lifecycle | Guards before/after N-API response construction; deadline/rollback during first/second root and rehash; no reentrant/async test hook; failed pair cannot resume; explicit/expired/double close and GC release; observable close failure blocks success |
| Final verification | Initial two paired passes; drift in the other root while reading one; same selected index rehashed; unread ordinary-side churn; final read-set hash/marker/policy mismatch; no successful partial pair or post-failure result |
| Compatibility | Existing native/unit contracts remain unchanged; no B-1/E-A authority upgrade; no mutation syscalls or fallback imports; all fixture bytes/names/access unchanged except kernel-managed atime/cache effects |

Later native qualification should separately record normal tests, UBSan/static analysis and any unsupported-volume/error-injection gaps. Do not claim ASan, power-loss/remount behavior, malicious-same-UID isolation, production eligibility or complete filesystem immutability from a passing synthetic suite.

## Implementation Gates

| Step | Future separately approved work | Still excluded |
|---|---|---|
| B-2a | Approved and implemented: strict registration/binding/namespace/budget contracts, in-memory ticket lifecycle and synthetic unit tests | Addon load/open, fixture creation, signed evidence persistence |
| B-2b | Dedicated native paired reader/tags/shared counters, thin disconnected adapter and approved unsigned-fixture setup/teardown tests | Authority/signing/service provisioning, B-3 joint-view claims, real data, MCP/production |
| B-2c | Integration review of registered native reads/final rehash/resource failures and compatibility; isolated optional-backend validation | Actual checkpoint-provider orchestration, transaction/history/admission promotion |

The original design-only and B-2a steps made no native changes. The later B-2b approval permits native test fixture creation/removal only in its newly created invented fixtures; it must never touch a pre-existing operational store or an unrelated temporary file. Normal MCP binaries/builds and job settings are not rebuilt or restarted. No fixture/key/marker creation, native invocation, real-data operation, commit, push or deployment was included in B-2a.

## B-2a Implemented Boundary

[The isolated contract module](../src/nativeBarAdmissionReadContracts.ts) imports existing pure E-A/B-1/evidence contracts, zod, public hashing/key types and only `pid` from `node:process`. It has no filesystem/network/loader/signer, ambient clock, environment lookup, callback provider or native addon dependency. Reading the existing process ID is not a process-liveness or host-consent qualification. Source-boundary tests allow this specific internal E-A/B-1 dependency only; no runtime module, startup or MCP tool imports B-2a.

Implemented memory-only interfaces:

| Interface | Meaning and limitation |
|---|---|
| `validateSyntheticAdmissionReadRegistration(input)` | Bounded strict detached schema, role uniqueness, canonical ancestor paths, supplied identity/access consistency, exact policy and marker hash/size bindings; never an OS check |
| `createSyntheticAdmissionReadBootstrap(input, publicKey)` | B-1's fixed public Ed25519 key validation plus immutable expected pins/anchor/authority reference; returns an opaque token and memory-only `close` |
| `createSyntheticAdmissionReadRegistry(bootstrap.token)` | Requires the original live process-local bootstrap token; copied JSON/foreign/closed tokens refuse |
| Registry `registerFixture(input)` / `describe(ticket)` | One successfully issued registration per registry lifetime; detached pins, original-ticket membership, sanitized supplied-binding hash/ID report |
| Registry `closeFixture(ticket)` / `close()` | Revoke tickets/registry in memory only; bootstrap close revokes all its registries; repeated close is harmless |
| Registry `beginRead(ticket, lowerLimits?)` | Validates ticket/lower-limit syntax, then always throws `b2a_native_read_unavailable`; creates no context, lease, deadline or resource reservation |
| `classifySyntheticAdmissionReadEntry(input)` | Structural role/size/access-candidate classification of supplied data; never opens or authenticates a file |
| `checkSyntheticAdmissionReadNames(input)` | ASCII case-collision precheck only; non-ASCII/control names require native qualification, not an incomplete JS Unicode case-fold claim |
| `calculateSyntheticAdmissionReadBudget(input)` | Lossless, bounded calculation over supplied counters and derived fixed overhead; no native budget enforcement or capacity promise |

The bootstrap is a separate trusted test dependency with schema `native-bar-admission-read-bootstrap-v1`, synthetic scope, fixed temp anchor, B-1 pins and a distinct UUID authority reference. It accepts only a public `KeyObject`, not embedded encoded keys or a verifier callback. B-1's weak-key refusal is reused; no key is generated and no signature is made. No public bridge exposes the private registration to a native opener in this slice.

The strict `native-bar-admission-read-registration-v1` object contains those same pins/anchor/reference, the fixed six-character fixture basename, policy hash, supplied ancestor/private-directory/marker proofs and qualified-volume expectations. Private roots/parent use 0700 and marker files use 0600/single link; native equality remains unverified. Both marker digests use the intended physical bytes: the old marker is the raw 21-byte text, whereas the E marker is canonical JSON. A JSON hash of the old marker string is not its raw hash. Complete structured requests are capped at 64 KiB before schema work, with depth/value limits, accessor/cycle/sparse-array refusal and coded diagnostics that do not quote input paths.

Registration is deliberately single-issue per registry lifetime, including after `closeFixture`, to bound retained state and prevent accidental reuse/key replacement. A different registration needs a newly and explicitly created registry under the still-live trusted bootstrap; it is not an automatic retry. No active-read state is simulated while native support is absent. This is not protection against hostile code already controlling the same process/bootstrap.

The v6 structural grammar covers witness sequences, producer mirrors, fixed controls, capture/receipt finals, root producer stages, E-A maintenance/holding/quarantine slots, coordination and reserves. E-A's maximum 37 maintenance slots/three temporaries and 28 event slots are only structural outer bounds; actual layout membership remains unverified. Undeclared witness temporary names are blockers, not invented valid reservations. Pending producer/E-A temporaries and reserves are never raw-read candidates. Ordinary side files/directories are preserved candidates, never evidence; unknown private names block. ASCII aliases are blocked. For any non-ASCII/control name, B-2a refuses qualification or returns `needs_native_name_check`; B-2b still owes the complete native normalization/case-fold/exact-name checks.

`raw_read_candidate` and `directory_candidate` mean only that the supplied role/kind/size/access fields pass this structural filter. `access:supplied_safe` is not an ACL result. All native/read/view/signature/checkpoint/authority/intake/admission/approval/execution/history/elapsed/capacity qualifications remain false; original acknowledgement and storage visibility are `not_proven`.

Budget input separates data/witness/common inventory counters, additional retained metadata, **additional** counted read work, response bytes/returned Buffer bytes and existing roots/targets/FDs. Fixed common entry overhead is at least the ancestor count plus parent/two roots/two markers; data has at least the policy entry. Expected registration plus 44 public SPKI bytes and marker/policy metadata are charged even if counters say zero. The mandatory initial marker/policy reads are always added to extra/repeated/failed/readback work; they are not hidden by taking a maximum with that work. Counts use decimal strings and BigInt. The review-corrected response floor derives an inventory frame from the combined entry count: a 16 KiB joint header plus 2 KiB fixed proof/classification/Buffer-header allowance and six-times-512-byte worst-case escaped path per entry. Registration and `4 * returned_buffer_bytes` are additional; declared response bytes cannot reduce that floor. Metadata includes three such frames for baseline/recheck/read-set retention and one 64 KiB ACL-serialization scratch allowance, plus the separately supplied retained metadata and file/control/registration bytes. These are conservative accounting contracts, not new capacity ceilings or measured native RAM. Future B-2b must enforce the bounded report fields/paths before allocation and may not silently add fields outside those allowances. Existing resources are checked with two additional root slots and 48-FD headroom against unchanged ceilings. Lower limits only reduce ceilings.

`model_fits:true` describes these supplied numbers, not their truth. The function has no mutable counters to consume or reset and cannot mint a read context. Native counter enforcement, actual ACL/content/marker checks, resource reservation/release, full Unicode names, clock/deadline guards and paired final rehash remain B-2b/B-2c. C0/C1/provider sequencing remains B-3; B-2a has no actual clock or provider.

Initial verification (before the review corrections below, which bring these to 104 and 281): 99 memory-only synthetic cases plus three source-boundary cases pass (102 B-2a); the combined E-A/B-1/B-2a run passes 279 cases with zero failures/cancellations/skips. Isolated TypeScript compilation and no-emit typechecking are used, not a shared MCP build. Missing-module/function tracer tests failed before implementation; ordinary side-directory misclassification, mandatory-read undercount and known-ticket close after revocation were each reproduced before correction. Close on a known ticket remains release-only/idempotent even after registry/bootstrap revocation; a foreign/copied ticket still refuses, and all non-close operations remain revoked. This step does not run the general unit/Bookmap/native suites because they create disk fixtures or generated fixture artifacts; it claims no such regression or native qualification. No fixture, key, signature or marker is persisted. Independent review and other Node/runtime profiles are not qualified by this implementation step.

## B-2a Review Corrections

The pre-commit local review found two correctness gaps and reproduced each with a failing memory-only regression before changing the implementation:

1. Whole-path classification missed reserved ancestors when an ordinary side-file leaf caused the folded path to remain ordinary. `CAPTURES/notes.txt` and `RECEIPTS/2026-10-25/.DS_Store` were not blocked. Children underneath known file roles such as `policy.json/notes.txt` could also look ordinary. Classification now checks every parent prefix for reserved-name aliases and requires any recognized parent role to be a directory. Ordinary side files under correctly named capture/receipt directories and nested ordinary owner directories remain ordinary.
2. Response/retained-memory floors charged fixed registration/control and Buffer bytes but did not grow with the inventory entry count. A 500-entry in-memory report could exceed the returned response bound while the model still fit a smaller limit. The calculation now derives the complete inventory-frame and three retained-frame/scratch bounds described above, adding them regardless of understated supplied counters. The test covers ordinary and worst-case escaped long paths, wide lossless proof values, classification fields and lower response/metadata limits. Existing ceilings, read-only boundaries and all E-A/B-1 semantics remain unchanged.

After correction, B-2a passes 101 synthetic cases plus three source-boundary cases (104 total); the combined E-A/B-1/B-2a run passes 281 with zero failures/cancellations/skips. Isolated compilation and no-emit typechecking pass. Only the fixture-free suites are run: no general unit/Bookmap/native fixture setup, native invocation, real-data operation, MCP registration or production enablement is part of this review. This is a local review, not a separate independent review or native/runtime qualification. The nine scoped B-2a/design/boundary-test files are the requested local commit; no push/distribution is included. Dot stays PAUSED and market/notification/retention conditions are unchanged.

## B-2b Implemented Boundary

The disconnected [reader adapter](../src/nativeBarAdmissionReader.ts) loads only the fixed optional addon on explicit `beginRead`. Construction/registration remains B-2a memory-only. A narrow internal WeakMap bridge claims the original registry/ticket once, captures its fixed registration and installs a **release-only** revocation callback, not an authority/verifier/provider. B-2a's original `beginRead` still refuses native IO. Bootstrap, registry and ticket close revoke first and retry unconfirmed release; all registries are visited even when one cleanup fails. Weak callbacks and an explicit native-resource finalizer avoid keeping abandoned read contexts alive. GC only releases resources/claims; it never repairs, deletes or resumes a fixture.

The new `admission_read_protocol:6` native implementation uses distinct context, pair and joint-snapshot tags. Its actual exports are `beginAdmissionRead`, `openAdmissionReadPair`, `admissionInventory`, `readAdmissionEvidence`, `verifyAdmissionInventory`, `closeAdmissionInventory` and `closeAdmissionRead`. The last closes the entire original context; both high-level context/pair `close()` methods map to it, rather than accepting legacy root handles. Snapshot close is release-only/idempotent. Every read/verify failure invalidates that pair; a closed snapshot cannot mint another baseline. Raw native hooks exist only for synchronous synthetic fault injection and are not exposed by the adapter.

`beginRead(ticket, lowerLimits?, ttlMs=600000)` starts the adapter wall/steady deadline before addon loading. The native context receives only its remaining milliseconds, reserves both global root slots together and opens no fixture. Temporary anchors are restricted to literal canonical `/private/tmp` or the canonical OS per-user temporary directory obtained without a `TMPDIR` fallback. Both fixed siblings are opened once from `/` through no-follow exact components. OS ancestors use stable expected identity/access bindings; private parent/roots/in-scope directories use full metadata/allocation/ACL checks. The parent has exactly its two roots and two pinned markers. V6 policy/markers are reread and hashed, not inferred from old profiles. Read work, inventory, retained metadata, response framing and native FD/root counts stay shared, never reset per root or recheck. Unsupported platforms/volumes refuse without Node-fs or legacy-reader fallback.

The inventory is one sorted **joint index space**: each report entry contains a global `index` and `root_role`. `readEvidence(role,index)` requires both to match the immutable native snapshot. It accepts no caller path or proof; changing the detached report cannot change the selected file. Witness/mirror/control/payload/receipt/metadata caps remain 16/8/4/1024/16/64 KiB respectively. Unknown private names, ACL grants, links/nonregular files and oversized required evidence cannot qualify the final view. Ordinary safe side files, pending producer/E-A names and reserves are preserved/countable but never read as evidence or adopted as completed publications. Pending counts are explicit. Full native Unicode normalization/case-fold collision checks do not rely on B-2a's ASCII precheck.

Initial inventory compares two joint passes. Indexed reads check both roots, controls and the selected chain before/after bounded bytes, after the fault hook and after response construction. Final verification compares the original joint inventory before and after rehashing every successfully read object, rereads controls and never accepts a new baseline. Reverification adds work under the same deadline. A successful verify closes the evidence-read window. Output schemas distinguish inventory, exact bytes and final verification; only `native_bytes_verified`/`native_snapshot_verified` describe those current bounded facts. They never authenticate unsigned fixture contents. All signature/checkpoint/authority/intake/admission/approval/execution/history/elapsed/capacity flags remain false, and original acknowledgement/storage visibility remain `not_proven`. C0/C1, B-1 byte-hash equality and mirror/witness equality remain B-3's gate.

### Isolated Validation

`node native/native_bar_fs/test_admission.mjs` compiles TypeScript/addon/helper only into ignored `build/b2b-validation/`, then runs the dedicated B-2b tests and the fixture-free E-A/B-1/B-2a suites. `--ubsan` instruments that isolated addon, never the normal shared backend. The independent expectation helper uses path `getattrlist`/`acl_get_link_np`; it neither includes reader code nor calls its FD observation functions. The harness creates its own private marked temporary directory with `mkdtemp`, writes invented **unsigned** bytes, obtains independent expected bindings, and only removes that exact newly created tree. No keys/signatures, original intake, operation journal or real store is persisted. B-1's existing public-test-vector signatures remain memory-only.

Normal and UBSan runs each pass **44 native synthetic cases + 4 reader boundary cases + 281 existing pure cases = 329**, with zero failures/cancellations/skips on the tested local macOS APFS host. No-emit TypeScript checking and Clang static analysis pass. The initial missing-module tracer failed before implementation. Oversized required evidence incorrectly reaching final native qualification, abandoned adapter contexts retaining FDs, and an observation-end timestamp preceding response construction/postconstruction recheck were separately reproduced as failing tests before correction. The returned `observed_at` is now stamped after the final native filesystem observation without invoking an inherited setter, followed by the original deadline check. A too-short expiry test could expire during context construction; its controlled wait was moved after a longer finite start window. Case-alias fixture setup uses rename on case-insensitive APFS instead of attempting to create a second existing name. Every native case checks return to its starting FD/root counts.

B-2c still owes independent/integration review and the broader acceptance matrix: exhaustive cross-use of every old/new export in both directions, multi-volume/remount/ownership changes, genuine full resource pressure, broader inherited/deny-only ACL and allocation/flags races, clock rollback during every phase, old/missing-addon profiles and release-error injection. These are not inferred from the selected passing synthetic cases or static analysis. ASan, power-loss/remount behavior, hostile same-UID isolation, production eligibility and a signed/current ledger are not qualified. General native execution/worker/SIGKILL, Bookmap and broad fixture-creating suites are deliberately not run by this step. No commit, push, deployment, MCP registration, Dot restart or condition/retention change is included.

## B-2b Review Corrections

The subsequent user-approved pre-commit local review covers the 17 B-2b source, native, build, synthetic-test and documentation files plus the unchanged helpers they call. It found four correctness gaps, each reproduced by a failing synthetic regression before correction:

1. Native response construction used inherited-property assignment. An `Object.prototype.bytes` setter could change the newly copied Buffer before return while leaving `native_bytes_verified:true` and the original whole-file hash. New inventory/read wrappers now define own data properties with `napi_define_properties`; no snapshot/report/bytes/facts prototype setter runs. Captured native bytes and their hash agree at return. Buffers remain caller-mutable afterwards, and B-3 still owes its independent captured-byte hash comparisons; no authority is added.
2. `read_bytes` was captured before the final postconstruction filesystem guard. A second identical query limited to that reported usage failed with `admission_read_limit`. The final stamp now publishes the cumulative counter after every guard and rehash, alongside the observation-end time and the original deadline check. The native counter was already enforced internally; this fixes underreported diagnostics, not a limit increase or refund.
3. A single ancestor observation still compared volatile size/link-count/mtime/ctime around ACL inspection, despite later cross-pass comparison ignoring those fields. Concurrent creation/removal of unrelated **new empty invented fixtures** under the OS temp ancestor caused `admission_binding_changed`. Non-private ancestors now use the existing stable `recovery_anchor_equal` comparison. Device/inode/owner/group/mode/flags/birthtime and the pinned ACL digest remain checked; private parent/roots/in-scope objects retain full checks. Actual entry/read-work/resource ceilings still apply during concurrent activity. The bounded synthetic churn worker removes only paths returned by its own `mkdtemp`, and is stopped and joined before teardown.
4. Root-at-depth-zero enumeration allowed a leaf with 17 relative components even though B-2a's contract allows at most 16. Each next child now checks that component boundary before metadata observation; a 16-component path remains accepted and the 17th component refuses. The ceiling is unchanged.

After correction, normal and UBSan isolated runs each pass **49 native synthetic cases + 4 reader boundary cases + 281 existing pure cases = 334**, with zero failures/cancellations/skips on the tested macOS APFS host. TypeScript no-emit checking, Clang static analysis and diff whitespace checks pass. Source-boundary coverage now rejects inherited-property assignment in the new native module. Every native case returns its starting FD/root-lease counts. The old response-setter test now verifies non-invocation, and the observation-time test uses the explicit synthetic read hook rather than depending on prototype callbacks.

No further must-fix issue remains within this local review scope. This is not a separate independent review or completion of B-2c's wider integration/compatibility/error-injection matrix above. The general native recovery/worker/SIGKILL, Bookmap and broad fixture suites were not run; the only new worker is the narrowly owned empty-fixture churn regression. All fixture creation/removal is newly invented and unsigned. No real store, key/signature persistence, MCP registration, production enablement, Dot restart or market/notification/retention condition change is performed. Dot remains PAUSED with unchanged full/condition hashes. Normal shared JS/native build hashes match their review-start values. The 17 B-2b files are the authorized local commit scope; no push or distribution is included.

## B-2a Independent Review And B-2b Read-Budget Corrections

A separate read-only review of `9ecd7a5` (B-2a) found no must-fix issue, three should-fix issues, four low-priority issues and three informational notes. The committer's review of `ec717b6` (B-2b) then found two should-fix read-path issues, one confirmed by measurement. All twelve corrections below were reproduced against the committed builds first.

**B-2b read path.**

1. *Directory listings drained the read budget.* Every exact-name check listed the whole parent directory: the shared OS temp anchor, intermediate directories and the witness root. Each listed name was charged `sizeof(dirent)` (1,048 bytes on this host), and every indexed read repeated these guards about three times.
   - Measured on `ec717b6`, each 58-byte unsigned witness record cost about 2.1–2.4 MB of the 256 MiB read budget.
   - Reading and verifying 120 records failed with `admission_read_limit`, so E-A's 512-record ledger could never be read.
   - Now names are charged at the record length actually returned. Exact names are listed only when a control is first pinned. Later reads rely on the name-to-object binding and the full metadata (mtime/ctime, allocation, ACL) of the unchanged parent, root and snapshot directories, which any rename inside the private fixture changes.
   - The fixture parent's exact four-name namespace and every in-scope inventory listing remain.
   - Afterwards each record costs about 104 KB. 120 records are read and verified in 13.1 MB, and 480 in 51.7 MB (about 20% of the budget). A fixture whose combined inventory exceeds 512 entries is still refused by the unchanged entry ceiling, as designed.
2. *Shared temp entries blocked opening.* The opener and guards listed the shared OS ancestors with the 512-entry cap and the fold-collision rule, so unrelated temp entries could refuse the fixture.
   - The allowed per-user temp anchor holds 34,336 entries on this host and could never open. `/private/tmp` would fail past 511 entries, or on a case-sensitive volume holding an unrelated fold collision.
   - Shared ancestors are no longer listed. They keep pinned identity/access bindings and no-follow name-to-object checks, so unrelated temp activity is not fixture mutation, as designed.

**B-2a contracts and their native mirror.**

3. *Name check cap.* `checkSyntheticAdmissionReadNames` held a full 512-entry inventory to one record's 64 KiB and refused it. It now allows `entries × 1 KiB`.
4. *Read floor.* The floor counted the first marker/policy read only. It now derives the native protocol's mandatory work regardless of supplied counters: each distinct content read three times plus the final rehash, each pass with a 64 KiB guard allowance; four joint inventory passes at 3 KiB per entry; and control rereads at open, in each pass, at verification and around every content pass. Directory/ACL/metadata work beyond these is added as supplied.
5. *Boundary tests.* All four boundary tests (E-A, B-1, B-2a, reader) now require named imports only. A default or namespace import of `node:process` or `node:crypto` reached `env`, `dlopen`, `createSign` and `randomInt`. E-A/B-1/B-2a now allow `Date` only as the object of `Date.parse`, which catches `(Date).now()`, `new (Date)()` and `Reflect.construct(Date, [])`. B-2a gains B-1's crypto bans and a bypass self-test.
6. *Legacy private names.* `retention.json`, v5 `.stage` names under captures/receipts and R-D `.publication-<uuid>.tmp` are blocked as unknown private entries, in both B-2a and the native classifier, instead of passing as ordinary side files.
7. *Implied parent collisions.* Names colliding only through an implied parent folder (`A` and `a/x`) are refused.
8. *Budget input cap.* A budget request now has its own 256 KiB cap, so any registration that validates alone (up to 64 KiB) also fits a budget request.
9. *Stale counts.* The stale B-2a counts above are labeled as pre-correction values.

**Clarifications.**

10. The owner-PID check cannot fail within one process; it is defensive only, since tokens cannot cross processes.
11. A bootstrap pins anchor, pins and authority reference, not `fixture_name`. Separate registries may register differently named fixtures under the same pins, and B-3 must bind the intended fixture itself.
12. Evidence-shaped names misplaced in the data root (for example `1.json` or `admission-witness/1.json` under `store`) are ordinary side files: preserved and counted, never evidence. Separately, any unsafe file in scope (mode, owner, link count or ACL), including an ordinary side file such as a 0644 `.DS_Store`, makes `access_qualified` false and blocks final verification. This is deliberate conservatism, not an ordinary-side exception.

**Tests and verification.**

New regressions include a 120-record read and verify within budget, a fixture under the per-user temp anchor, legacy names blocking the final view, a 512-entry name check, implied-parent collisions, the derived read floor, a near-64 KiB registration in a budget request, and bypass self-tests in every boundary test. The seven runtime regressions fail on the committed builds. The new native tests close their context in `finally`. Otherwise a failed assertion would hold the leases, the FD/lease check would fail, and the fixture cleanup would be skipped; this was observed once against the old build and the stray fixture removed.

Verification, from a git-archive copy plus this patch, with source/test hashes fixed:
- Normal and UBSan isolated B-2 runs each pass 342 cases with zero failures/cancellations/skips and zero UBSan runtime errors.
- The general native suite passes all 880 existing cases, including the complete R-D SIGKILL traces. Its 52 skips are the B-2b-only cases outside isolated mode.
- The full unit suite passes 2,560 cases, with two existing skips.

New fixtures are invented and unsigned, created and removed by the tests themselves. Two older `/private/tmp` and three per-user temp `native-bar-fs-synthetic-*` directories predate this work and were left untouched. No real store, signing/key persistence, MCP registration, production enablement, push or Dot/market/notification/retention change is included.

## B-2b Independent Review Corrections

A separate read-only review of the reader at `9233b85` found no must-fix issue, one should-fix issue, seven low-priority items and one informational note. It confirmed that dropping the exact-name listings left no integrity hole on this APFS host: case-only renames, swaps, xattr changes, content edits with mtime restored, same-size rewrites, inode swaps and ACL/flag changes all change a ctime or inode that the reader compares. The corrections:

1. *Line breaks in private names (should-fix).* The native legacy pattern used ECMAScript `.`, which does not match LF/CR. Names such as `producer/<id>/2.json\n`, `maintenance/x\ny` or `.writer\nnote` were therefore classified as ordinary side files and still verified. B-2a, which defers non-ASCII names to native, blocks them. The pattern now uses `[\s\S]`, and in both classifiers a path containing any control byte never qualifies.
2. *Read floor below native.* B-2a's floor omitted fixed per-pass overhead. For inventory plus verification without reads it was below the native reader's actual work: 162,228 against 233,956 bytes. The floor now adds 12 KiB per pinned chain element at open and in each of four passes. A native test cross-checks the model against actual native read work under both anchors, with and without reads.
3. *Case-insensitive anchor components.* With exact-name listing gone, a registration whose fixture name differed only in case was accepted. Each opened anchor and fixture component is now compared with its on-disk spelling via `fgetattrlist(ATTR_CMN_NAME)`, which returns the stored name even when opened through a case variant, without listing the parent.
4. *Per-user anchor resolution.* The per-user anchor came from the OS temp-directory query, which creates a missing directory (a write outside the fixture), and from path canonicalization, which follows a symlink at the user-owned `T`. It is now accepted only as the canonical `/private/var/folders/<x>/<y>/T` shape, walked with no-follow components and required to be the caller's own 0700 directory. Neither call remains, and the reader boundary test forbids them.
5. *Generation digest.* `joint_generation` hashed volatile OS-ancestor fields that the inventory comparison ignores, so unrelated temp activity changed it. They are now excluded from the digest too.
6. *Non-regular recognized names.* A symlink or FIFO carrying a recognized name such as `3.json` reported `namespace_qualified:true`. It is now unqualified, as in B-2a; access qualification already blocked the final view.
7. *Regex compilation.* Patterns were compiled on every match. Compiled patterns are now cached per thread. A 504-entry depth-16 inventory fell from 13.1 s to 1.23 s and its verification from 13.5 s to 1.25 s, with identical read work.
8. *Tests and README.*
   - The final rehash path is now exercised: a test-only helper changes a read record through a held shared mapping, leaving mtime/ctime unchanged, and verification refuses it with `admission_read_changed`.
   - The tag matrix passes each handle with correct argument counts and asserts the tag refusals in both directions.
   - A budget test now shows one entry budget spanning both roots: each root fits alone, only the joint total exceeds.
   - The mutation denylist adds the rename/unlink/link/time/flags/ACL/xattr/attribute-list calls plus the two path-resolution calls.
   - The README count is updated.

**Informational.** An unsafe directory in scope (for example mode 0755 or an allow ACL) aborts the whole inventory with `unsafe_mode`/`unsafe_acl` rather than being kept as an unqualified entry. This is intentional: it fails closed and creates no partial view.

**Tests and verification.** The new regressions for control bytes, exact spelling, generation stability, non-regular names and the B-2a control-byte rule fail on `9233b85`. So do the no-read floor cross-check cases. The rehash, tag-matrix and joint-budget tests are coverage additions that the old reader also passes.

Verification, from a git-archive copy plus this patch, with source/test hashes fixed:
- Normal and UBSan isolated B-2 runs each pass 350 cases with zero failures/cancellations/skips and zero UBSan runtime errors.
- The general native suite passes all 880 existing cases, including the complete R-D SIGKILL traces. Its 59 skips are the B-2b-only cases outside isolated mode.
- The full unit suite passes 2,561 cases, with two existing skips.

Fixtures are invented and unsigned, created and removed by the tests. The pre-existing `/private/tmp` (2) and per-user temp (3) fixtures were left untouched. No real store, signing/key persistence, MCP registration, production enablement, push or Dot/market/notification/retention change is included.

## B-2c Constrained Acceptance Tests

On 2026-10-26 JST, the user requested the next acceptance tests. This run starts from `cbce6d3`, keeps the existing constraints and adds 25 cases to the isolated admission runner. Only new invented unsigned fixtures are created/removed. The fixed addon dependency is substituted in this test process's module cache/loader for fault cases, always restored in `finally`; there is no new application loader/provider parameter or native test API. Date substitution affects JavaScript in this test process only, not the OS clock. The ordinary addon and legacy methods are real in the tests except the explicitly substituted boundary below.

| Boundary | New evidence | Qualification |
|---|---|---|
| Release failures (3) | Failed close with a live real native pair; repeated failures retain the ticket claim; bootstrap visits other registries after one close fails | Adapter fault injection before native close, not a kernel `close` failure |
| Missing/old addon (4) | Loader refusal gives a coded error without loader detail; legacy/no-capability, version 5 and wrong-mode reports never begin a context | In-memory loader/export substitution; no binary is renamed or replaced |
| Initialization deadline (2) | Load latency exhausts the original window without beginning a context; a late returned real native context is released before opening roots | Real elapsed delay with a substituted boundary; native FD/root counters observed |
| Adapter wall rollback (8) | Before and after open/inventory/read/verify: no result escapes, leases release, a new explicit query remains possible | JavaScript `Date.now` substitution only; native system-clock rollback is not qualified |
| Native deadline (6) | Before and during inventory/read/final verification, actual elapsed expiry refuses and releases; the old lease is never renewed | Real native calls and elapsed waits; during-operation waits use the existing synchronous synthetic hook |
| Shared native FD pressure (1) | Six legacy synthetic sessions and retained preview handles take native FD usage above 464; the 48-FD-headroom check refuses admission without changing payload bytes, then a fresh query succeeds after release | Real native managed-FD pressure; no stage/purge/write method is invoked; not OS `EMFILE` qualification |
| Volume pin mismatch (1) | A contradictory expected read-only-mount flag refuses and releases | Real observed-volume comparison with a false expected pin; no actual remount/cross-device operation |

### Reproduced Failure And Correction

The release-failure tracer failed before correction: after `close()` threw `b2b_release_unconfirmed`, the same live snapshot could still run `verify()` and return a qualified native result. The adapter now marks release as requested **before** calling the backend and rejects all subsequent open/inventory/read/verify work. The resource and active ticket claim remain retained if release fails, so close/revocation can retry. Only successful native release clears that claim; it cannot be reused merely because one close attempt threw. This is a small adapter lifecycle correction, not a native syscall-close fix or new permission.

### Results And Remaining Qualification

The starting 350 cases pass before additions. After the fix, the 25 new cases pass, and normal/UBSan isolated runs each pass **375 cases**, with zero failures/cancellations/skips and no UBSan runtime errors. TypeScript no-emit checking, Clang static analysis and diff whitespace checks pass. Each native test checks return to its initial managed-FD/root counts. Existing limits, signature/authority/admission/execution/history flags and the recording/notification/retention rules remain unchanged. Normal shared JS/native build hashes and the PAUSED Dot configuration match the run-start values.

**B-2c is not fully qualified by this run.** Still unexecuted: genuine OS clock rollback/freeze, real mount/remount/cross-device/ownership transitions, OS descriptor exhaustion, kernel close/EINTR failures and lower-level release-error injection. These need a separately reviewed controlled host/fault setup; JS loader/clock/close substitutions above are not evidence for those native/kernel branches. No host clock, mount, ownership policy, process-wide OS resource limit or previously existing fixture is changed. The broader general native recovery/worker/SIGKILL and full unit suites were not rerun in this step; the 375-case isolated regression is the claim here. B-3/provider/checkpoint orchestration and later persistence/history/handoff slices remain separate gates. No commit, push, MCP registration or production enablement is included.

### Local Commit Reverification

The user subsequently approved committing this constrained B-2c patch separately, on top of `96756f9`. Fresh normal and UBSan runs each pass **375 tests**, with no failures/cancellations/skips or UBSan runtime errors. The current B3-A memory/boundary regression passes **307 tests** after rebuilding its dedicated validation output; an initial attempt used stale B3-A output from before the already committed allowance/sequence corrections, not a B-2c regression. TypeScript no-emit checking, Clang static analysis and diff checks pass. No additional runtime correction is made during this commit step.

The shared top-level JS build and normal native addon hashes, the complete PAUSED Dot configuration hash and the names of pre-existing synthetic fixtures match the start of reverification. Only newly invented unsigned native fixtures are prepared/removed by the admission runner; no real store is present at the configured default path. The five-file local commit contains the release-request guard, its constrained tests and B-2c documentation. It does not qualify the host/kernel gaps above, reopen Dot, alter confirmation/notification/retention conditions, push, deploy or enable any MCP/runtime entry.
