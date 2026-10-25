# B-2 Paired Native Reader And Fixture Registration

Status: **design approved; B-2a memory-only contracts implemented**, 2026-10-25 JST, based on `6f285f9` and the [E-B design](NATIVE_BAR_ADMISSION_READ_DESIGN.md). The user approved registration/classification/budget contracts, in-memory ticket management and synthetic tests only. B-2b native reads, fixture creation and all later integration remain separately gated. No native backend is loaded, compiled or invoked in this step. Dot remains PAUSED; market confirmation, scenario, notification and retention conditions remain unchanged.

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
| Tests | Future explicit approval for newly created, invented unsigned fixtures only; no persisted signatures or keys |

Only B-2a's memory-only work is approved for implementation. Native operations/fixture preparation, B-3 and subsequent E slices keep separate implementation gates.

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

The original design-only step made no implementation changes; the subsequent approval covers B-2a only. Any native test fixture creation/removal in B-2b must be explicitly authorized and confined to its newly created invented fixtures; it must never touch a pre-existing operational store or an unrelated temporary file. Normal MCP binaries/builds and job settings are not rebuilt or restarted. No fixture/key/marker creation, native invocation, real-data operation, commit, push or deployment is included in B-2a.

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

Verification: 99 memory-only synthetic cases plus three source-boundary cases pass (102 B-2a); the combined E-A/B-1/B-2a run passes 279 cases with zero failures/cancellations/skips. Isolated TypeScript compilation and no-emit typechecking are used, not a shared MCP build. Missing-module/function tracer tests failed before implementation; ordinary side-directory misclassification, mandatory-read undercount and known-ticket close after revocation were each reproduced before correction. Close on a known ticket remains release-only/idempotent even after registry/bootstrap revocation; a foreign/copied ticket still refuses, and all non-close operations remain revoked. This step does not run the general unit/Bookmap/native suites because they create disk fixtures or generated fixture artifacts; it claims no such regression or native qualification. No fixture, key, signature or marker is persisted. Independent review and other Node/runtime profiles are not qualified by this implementation step.

## B-2a Review Corrections

The pre-commit local review found two correctness gaps and reproduced each with a failing memory-only regression before changing the implementation:

1. Whole-path classification missed reserved ancestors when an ordinary side-file leaf caused the folded path to remain ordinary. `CAPTURES/notes.txt` and `RECEIPTS/2026-10-25/.DS_Store` were not blocked. Children underneath known file roles such as `policy.json/notes.txt` could also look ordinary. Classification now checks every parent prefix for reserved-name aliases and requires any recognized parent role to be a directory. Ordinary side files under correctly named capture/receipt directories and nested ordinary owner directories remain ordinary.
2. Response/retained-memory floors charged fixed registration/control and Buffer bytes but did not grow with the inventory entry count. A 500-entry in-memory report could exceed the returned response bound while the model still fit a smaller limit. The calculation now derives the complete inventory-frame and three retained-frame/scratch bounds described above, adding them regardless of understated supplied counters. The test covers ordinary and worst-case escaped long paths, wide lossless proof values, classification fields and lower response/metadata limits. Existing ceilings, read-only boundaries and all E-A/B-1 semantics remain unchanged.

After correction, B-2a passes 101 synthetic cases plus three source-boundary cases (104 total); the combined E-A/B-1/B-2a run passes 281 with zero failures/cancellations/skips. Isolated compilation and no-emit typechecking pass. Only the fixture-free suites are run: no general unit/Bookmap/native fixture setup, native invocation, real-data operation, MCP registration or production enablement is part of this review. This is a local review, not a separate independent review or native/runtime qualification. The nine scoped B-2a/design/boundary-test files are the requested local commit; no push/distribution is included. Dot stays PAUSED and market/notification/retention conditions are unchanged.
