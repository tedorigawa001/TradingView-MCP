# Native Bar Durable Admission And History Integration

Status: **design approved; E-A pure implementation/review only**, 2026-10-25 JST, based on `cf78e9d` and the current recording/history contracts, reviewed on `87d2327`. E-B through E-E, fixture persistence, key provisioning, MCP registration, production initialization and real-data operations require separate approval. R-D follow-up changes were committed separately in `87d2327`; they are not part of E-A. Dot stays PAUSED; trading, scenario and notification conditions are unchanged.

The [execution design](NATIVE_BAR_EXECUTION_RECOVERY_DESIGN.md) assigns E recording provenance and transaction-aware readers. The [R-D contract](NATIVE_BAR_QUARANTINE_RECOVERY_DESIGN.md#independent-admission-and-fresh-consent) additionally leaves recovery after controller loss blocked until an independent original-admission source exists. E must supply verifiable historical evidence without persisting or reviving an execution grant. A self-consistent intent, signature or hash chain alone is not sufficient.

## Scope And Decisions

Propose a fresh synthetic profile with three separate evidence chains: producer provenance, original maintenance admission, and the actual publication/transaction history. A trusted witness authority binds the first two independently of the data being recovered. History accepts only verified receipt/payload pairs and validated transaction effects. A reader never turns pending bytes into a receipt or a maintenance completion.

| Decision | Proposed boundary |
|---|---|
| Persistent evidence | Immutable witness records outside the capture/maintenance root, verified against an independently pinned trust anchor and a current checkpoint. A separate directory alone is not a trust boundary. |
| Restart | Restore evidence and consumed-attempt facts, never old plans, approvals, deadlines or an ordinal's right to run. Startup/status remain read-only. |
| Fresh authority | Every mutation still needs a new same-process exact plan, current native qualification and separately authenticated per-invocation host consent. That host bridge remains a production gate. |
| Format | A new, explicitly versioned synthetic policy and typed native adapter; no changes to existing v1/v2/v4/v5 schemas, no in-place policy edits, no real `/v2` root or migration. E-A's pure format identifiers are fixed below; actual authority/native formats still need their later qualification. |
| Initial execution scope | Abandoned quarantine only, at most two physical targets, original ordinal plus at most two recovery ordinals. No automatic splitting, retries, purge or metadata cleanup. |
| First implementation | E-A pure contracts, replay and capacity calculation only. Further slices need their own approval. |

The current v5 controller admits only its independently supplied invented inputs; its native engine does not accept E producer/witness namespaces. E must not pass disk JSON into that owner-capability factory or widen its namespace filters. Reuse pure algorithms and exact native primitives through a separately reviewed profile adapter, not a v5 policy override or raw-addon fallback. Registration of a native helper is not registration of an MCP tool; no E interface is registered by this proposal.

## Trust And Persistence

### Independent witness authority

The proposed authority is outside the worker/controller process and outside both mutable record trees. Its trusted configuration pins the expected store ID, enrollment epoch, verification-key identity, policy/profile and authority endpoint. Request parameters, environment flags, a store's `policy.json`, an intent's embedded public key and a copied capability cannot enroll or select a trust anchor.

Only the trusted intake can submit typed native/collector evidence to this authority. A generic sign-arbitrary-JSON endpoint is forbidden. Producer evidence must originate in the fresh collector/restoration path and native object observation; maintenance admission must originate in independent provenance/reference validation under the existing store writer exclusion. Neither may be derived solely from the intent it is asked to certify.

Each witness envelope binds a closed schema/domain, store ID and epoch, operation and artifact roles, exact scope digest, predecessor hash and lossless sequence, issuer/key identity, and relevant observation/publication brackets. Signatures authenticate only the named evidence under the pinned authority. They do not authenticate market truth, exchange release time, human consent or 90-day elapsed age. Private keys, credentials, account data and OHLC payloads are excluded from witness records.

Sign the canonical domain-separated body, excluding its own signature/hash and any future persistence acknowledgement. Record later observed publication in a different immutable envelope. Signature-format identifiers and byte ceilings must be fixed before E-B; unknown algorithms or a verifier supplied by a request refuse.

The signature algorithm, protected key provider, authority process isolation, checkpoint persistence and production enrollment/storage location are **approval and qualification decisions**, not implemented OS guarantees. A same-UID key file beside the records is not a substitute. Same-UID/admin compromise remains outside the existing isolation claim; no tamper-proof-storage claim is added.

### Current checkpoints and rollback

The authority must supply a fresh response bound to the verifier's challenge and the pinned store/epoch, naming its latest sequence/hash. It serializes extensions and refuses a second successor for the same accepted predecessor. The reader compares that checkpoint with the complete canonical ledger prefix and actual store bindings. A valid old signed prefix is historical evidence, not proof that it is the current complete state.

Missing authority, unknown key/epoch, replayed response, gaps, forks, a checkpoint ahead of the files or an older ledger than the checkpoint blocks admission and successful complete-history results. Do not choose the longest convenient prefix, reset sequence zero or enroll a replacement key automatically. An interrupted authority publication remains unresolved until its own supported read-only reconciliation proves the current tip; a disk scan cannot invent a high-water mark.

Restoring both the data and its alleged checkpoint from the same backup cannot establish freshness. Production recovery remains unavailable unless the checkpoint provider is independently qualified against the rollback/failure boundaries being claimed. If that provider's state is lost or rolled back together, report `trust_checkpoint_unavailable`; signatures do not repair the missing trust. A fresh store epoch, rekey, clone or authority replacement needs a separate explicit design/approval, not a recovery option.

First synthetic tests may use a fixture-only authority with a test trust anchor/checkpoint controlled independently by the harness. Persisting test records and restarting test processes does not qualify a production key store, an OS reboot, backup restoration or host consent.

### Proposed fixture layout

```text
native-bar-e-synthetic-<id>/       # explicit marked private test fixture
  store/                         # fresh E policy; not a real v1/v5 store
    policy.json
    captures/<day>/<recording-id>.json
    receipts/<day>/<recording-id>.json
    producer/<operation-id>/...   # exact declared reservation/creation/events
    maintenance/...               # separately versioned E transaction envelope
    maintenance-hold/...
    quarantine/abandoned/...
  admission-witness/              # independent bounded native root
    <sequence>.json               # immutable records with predecessor bindings
    <declared-temporary>          # interrupted bytes retained, never adopted
```

The test anchor/checkpoint authority is not reconstructed from either tree. Production paths are deliberately not selected here. No directory, key, policy, journal, reserve or capability probe is created by construction, preview, history or status. Both roots require pinned ancestors, private ownership/modes/full ACL evidence, qualified local filesystem behavior and exact native operations. A new external volume or pathname fallback is not allowed.

The first fixture keeps both roots on the same qualified local volume, with separate identity/access bindings. There is no atomic commit across the roots or the authority checkpoint, even on one filesystem. Predeclare and budget each publication, sync and read it back separately, then validate the complete matching prefix. A crash between trees yields incomplete/unconfirmed evidence, never a rollback, auto-repair or cross-root data rename. A different authority storage topology needs its own qualification.

Witness/provenance/retention metadata is retained and counted. E provides no metadata deletion, ledger compaction, reserve release or automatic cleanup. If maintaining the independent authority requires a different persistent service or storage location, provisioning it is a separate approval.

## Evidence Contracts

This section describes the complete E evidence roles. E-A implements their outer supplied-record contracts as specified below, not their native intake, authenticity or history acceptance. Each role uses a distinct discriminator and exact ID fields. A producer operation ID, recording ID, artifact attempt ID, maintenance ID, target ID, store epoch and recovery attempt ID are not interchangeable.

| Record role | Required evidence and meaning |
|---|---|
| Enrollment binding | Pinned store/epoch, both root identities and ancestors, complete access proofs, exact E policy and backend capabilities, authority/key identity. Configuration/evidence only, never standing consent. |
| Producer reservation | Before exclusive creation: recording/producer IDs, owner incarnation, intended payload-stage/final-payload/receipt-stage/final-receipt roles, separate artifact-attempt IDs and every exact final/temporary slot, limits and original invocation window. No OHLC. |
| Created entry | After exclusive empty creation and before content write: reservation hash, exact role/path and actual descriptor identity/birthtime/access/flags. Immutable separate record; a reservation is never overwritten to add a proof. |
| Content verification | Fresh locally collected capture digest, exact source contexts and restoration digest, bounded canonical length, post-write proof and observed sync/readback. The payload alone carries OHLCV; producer metadata carries hashes and existing contract references. |
| Publication intent and observation | Predeclare the exact source object and final slot, then separately bind observed non-replacing publication, native before/after proofs and sync/readback. Preserve original birthtime; a rename is not a new object. |
| Receipt preparation and linkage | Bind the exact verified payload, unchanged receipt semantics, recording sequence, partition/logical receipt clocks and proposed receipt digest before publication; afterward bind the actual matching receipt proof and observed publication. A linkage never creates or edits a receipt. |
| Maintenance scope certificate | Independently verified producer lineage, absent committed/live references, whole selected target set/proofs, fixed native layout/reserve evidence, original audit baseline, all attempt IDs/slots and capacity. Issued before the first data move, not inferred from a surviving intent. |
| Original envelope seal | Bind the scope certificate to the actual immutable original intent/manifest bytes and native proofs after publication. A certificate must not hash a future envelope that hashes the certificate itself. |
| Attempt consumption and publication witness | Persist exact original scope, ordinal, prefix, newly approved plan digest and consumed state before waiting; retain exact observed publications/coordination identities. Approval references are audit data, never reusable grants. |
| Terminal verification | Bind exact receipt/transaction terminal evidence and current proof/checkpoint. Original response acknowledgement remains separate and unproven after loss. |

All raw metadata uses bounded fatal UTF-8 decoding, canonical byte equality, duplicate-key/depth/unknown-field rejection, and lossless native counters/times. Match content, identity, access and actual role/path; neither a filename PID nor a matching body hash proves original ownership. Ordinary Finder/owner files remain preserved and counted. Unknown or malformed entries in private producer/admission/transaction namespaces block the whole view instead of becoming cleanup candidates.

## Producer Publication

After future implementation approval, the synthetic producer will follow this finite order:

1. Consume the fresh recording approval and take the existing store writer exclusion. Verify policy, capacity, independent authority and both original deadlines before chart access. Keep store-before-chart ordering; authority serialization must never hold an authority lock while waiting for a store/chart lock.
2. Acquire all four native series through the existing collector contract, then restore and verify every pane. Release the chart lock before disk publication, retaining store ownership. In E tests the chart API and observations are entirely invented; no live CDP connection is implied.
3. After successful collection/restoration, fix the partition-start clock `partition_at` before payload publication and bind it, the exact payload and all artifact slots in durable producer reservation evidence. This is the existing pre-publication partition meaning, not the later receipt or acknowledgement date. Create each stage exclusively through the native adapter, publish/read back its created-entry proof, then write contents. No create-to-register inference is allowed.
4. Verify/sync the payload, publish a pending publication record, perform an exact non-replacing native publication, and retain a separate observed-publication record. No shared pathname `link/unlink/rename` fallback or change to `fsDurability.ts` for unrelated stores.
5. Preserve the `partition_at` fixed in step 3, including across UTC midnight. Prepare and publish the exact receipt only while the invocation still has the necessary authority; bracket and link its actual publication independently. The witness must never record an observation of its own future persistence.
6. Return success only after all required receipt/linkage/checkpoint checks and observed durability operations. A publication failure stops the invocation, preserves artifacts and reports the confirmed prefix. No finalizer deletes pending bytes, repairs JSON, releases reserves or retries another capture.

New-profile publication must preflight the complete bounded payload/receipt/witness work and stop new writes on deadline expiry. Do not extend a lease to finish metadata. An incomplete result is acceptable; later status/recovery cannot fabricate a missing receipt. This stricter E boundary does not alter the existing v1 recording implementation or its payload/receipt publication behavior.

| Interrupted boundary | Read result and permitted interpretation |
|---|---|
| Reservation exists, object absent | `reserved_only`; no invented created proof or historical observation. |
| Object created, created-entry absent | `creation_unverified`; preserve, no ordinary abandoned execution. |
| Registered stage contains partial/raw bytes | `registered_pending`; not committed. Proven dead ownership and complete reference checks are still required before even proposing quarantine. |
| Complete final payload, receipt absent | `payload_pending`; no first-seen history, receipt synthesis or recapture. |
| Partial/invalid canonical receipt or missing referenced payload | Integrity/publication blocker, not a zero-row history or abandoned-cleanup opportunity. |
| Matching complete receipt exists, linkage/acknowledgement incomplete | `commit_unconfirmed`; block complete history until fresh exact reconciliation verifies that already existing pair and its original producer evidence. It may add a new current verification witness, never create/restamp a receipt or claim the old acknowledgement. |
| Receipt, linkage and current checkpoint all qualify | Eligible for the accepted-pair projection, with original observation/logical receipt clocks. Historical query visibility still is not proved. |
| Stage/final aliases or unexpected second link | Conflict; preserve all locations. No alias normalization or ordinary stage cleanup. |

Payload/final/receipt attempts have distinct lineage even when they share a recording ID. Midnight, repeated identical content, a returned A value and changed volume must not cause ID reuse, partition changes or provenance backfilling. A source/restoration failure may leave only explicitly approved operational metadata; it never publishes bar evidence as accepted history.

For that verification-only reconciliation, propose at most two separately approved attempts per producer operation, with distinct predeclared IDs/slots and consumption recorded before waiting. These are not maintenance recovery ordinals and grant no payload/receipt write, recapture or move. Unknown consumption or exhaustion leaves diagnostics only. E-A must budget both attempts from the beginning; E-E cannot discover unbounded extra journal slots after a failure.

## Maintenance Admission And Restart

Producer provenance establishes which operation created an object, not that it is safe to move now. Before original abandoned quarantine, a separate intake verifies the entire bounded namespace, native object proofs, producer lineage, actual owner inactivity and all receipt/maintenance/live references under the existing writer exclusion. Any valid, corrupt or unresolved receipt/reference excludes the affected bytes and blocks ambiguous whole-scope execution. No failed committed-maintenance check falls back to abandoned cleanup.

Keep the certificate construction acyclic: freeze the independently selected scope/layout/reserve digest; publish the original envelope referencing that digest; observe/read back the envelope and publish its external seal; require both before any move. Preparation before the seal remains non-executable. The external seal cannot be recreated later just because a disk envelope is internally consistent.

Persist ordinal consumption in the independent ledger before queueing or native execution. An unknown append result does not make an ordinal free. After controller/server loss, ordinal 1's invocation and all old capabilities/windows stay invalid, including when no attempt envelope appeared. A newly approved recovery can use only an unused ordinal 2/3 after proving the full original admission, current checkpoint, consumption ledger, known publications and actual remaining locations. Exhaustion or an unresolved consumption/fork stops recovery; no fourth attempt or fresh operation over the same leftovers.

Only exact declared control-plane deltas may extend the original reference audit. Keep that original hash distinct from the current complete joint store/witness generation. Unknown ledger entries, new receipts or unrelated producer operations invalidate an outstanding plan; do not ignore whole namespaces. Recording stays blocked during an unresolved maintenance transaction as required by the governing design.

Persisted coordination witnesses, when available, must retain the exact native own-delta and the independent observer's actual proof. Live/suspended/unknown owners remain blocking. A worker killed during `begin` before a trustworthy witness still has unwitnessed coordination; E does not adopt it from PID/name/body or add a force-retirement scan. Retirement needs the existing exact proof and a fresh separate approval, and never supplies data-mutation consent.

Read-only reopening validates evidence but creates no execution handle. A future host bootstrap may mint a new process-local internal handle only after every verifier succeeds and the fresh host approval bridge is qualified. Existing R-D WeakMap objects are not serialized, restored or imitated. Cross-process original monotonic deadlines are not reconstructed from UTC. Fresh recovery windows do not authenticate quarantine age; `elapsed_clock_qualified:false` remains until slice F qualifies its separate source.

## History And Status

The future reader takes a current pinned checkpoint, then a complete bounded native inventory of both roots. It validates raw records, identities/access, all declared publication slots and producer/maintenance dependencies before selecting receipt/payload pairs. A final checkpoint/inventory check must still match. Drift returns `changing`/unavailable without an unbounded retry, partial success or a cached older generation.

Only a complete matching receipt/payload pair with valid E provenance/linkage can enter the accepted list. Pass its original capture and receipt fields to the existing [pure projection](../src/nativeBarEvidence.ts); keep the [v1 history contract](NATIVE_BAR_FIRST_SEEN_DESIGN.md#historical-queries-and-their-limits):

- Identity stays source/full symbol/timeframe/bar-open/unknown price basis/context epoch. Only successor-confirmed native bars already known by the capture cutoff qualify; no forming bars, backfill or carry-forward.
- Initial A, repeated A, B and returned A keep their current occurrence semantics. Volume-only changes stay distinct; a context change starts a separate epoch. An absent bar in a later bounded window is not a deletion observation.
- As-of still requires both the original `observed_at` and logical `recorded_at` at/before T. Witness sealing/reverification clocks are additional audit evidence, not replacement first-seen dates or a claim that data was query-visible at T. Keep `storage_visibility_at_as_of:not_proven` and `original_acknowledgement:not_proven` after response loss.
- Abandoned quarantine/purge affects no accepted observation, first-seen/occurrence numbering or committed coverage floor. Recording and maintenance IDs retain separate lookup roles.
- Any supported committed retention/clock exclusion must derive from a separately validated complete transaction. Preserve `history_truncated`, earliest-retained versus original first-seen, null unknown occurrence numbers and the exact pruned-through floor. Unsupported committed effects make the E view unavailable; do not interpret legacy `.done` files as new-profile authority. E does not execute committed prune/clock recovery.

Legal completed-purge fixtures may exercise a read-only `spent` projection only when the original whole marker set, admission, exact terminal unlink chain and current checkpoint qualify. Keep the marker/provenance metadata. Missing/unconfirmed unlink, an altered set or absence alone never means `spent`. This reader prerequisite does not implement purge or qualify elapsed age; F remains blocked.

Expose recorded phase, current native locations, producer/admission verification, checkpoint freshness, publication/restore/cleanup uncertainty and required next approval separately. Until actual E qualification, public outputs keep `execution_available:false`, `recovery_execution_available:false`, `approval_authenticated:false` and `elapsed_clock_qualified:false`. Neither a history result nor a witness is a scenario signal, a trading recommendation or permission to notify.

## Capacity And Concurrency

Use the lower applicable existing ceilings across **both roots**, not a fresh allowance for each tree: 1 GiB logical inventory, 16 MiB metadata, 256 MiB actual evidence reads, 8 MiB response, eight native root leases, 32 live native targets per session, 512 native FDs and 48 additional-FD headroom. The first E native view keeps the conservative 512-entry combined ceiling; the broader 30,000-entry planner/v1 ceiling is not executable capacity. The v1 4,096-capture cap is likewise not a promise that this new view fits that many captures.

Use at most 1 MiB per capture, 16 KiB per receipt and 64 KiB per new provenance/witness record. Bound manifests/chains, canonical depth and protocol exchanges before recursive work. If exact declared chunks do not fit, refuse rather than raise a limit or silently trim a scope. Native evidence and physical allocated blocks, including directories, both roots, retained reserves, authority metadata, old attempts and all temporaries, must be counted; no deduplication or future deletion credit.

Capacity is derived from every finite planned reservation/created-entry/publication/witness/attempt/terminal step plus interruption and recovery headroom. The E-A calculator must enumerate these roles, not accept a caller's low aggregate estimate. Byte limits are not a physical reservation. Qualifying/accounting any authority-owned storage is a prerequisite; an unbounded external log is not free space. Current R-D's data reserve may not be spent implicitly on the new witness tree or reallocated after restart. A bounded reservation plan for both stores must precede E-C publication, with partial preparation retained if it fails.

The existing store writer ordering remains the only data-writer protocol. Authority extensions are serialized with an exact predecessor/checkpoint condition; they never call back into a held store/chart lock or obtain a second data-writer grant. Multiple MCP processes, lock waits, authority timeouts and unknown ownership stop the consumed invocation without automatic retirement, retry or deadline renewal. Read/status take no writing or chart lock.

## Failure And Compatibility Tests

All proposed execution tests use new marked fixtures, invented captures and an explicit test authority. No real chart, key store, admission directory or history is opened for qualification.

| Matrix | Required evidence before the relevant slice is accepted |
|---|---|
| Trust and forgery | Self-consistent forged intent, another good capture, embedded replacement key, wrong store/root/epoch/role, replayed challenge, missing verifier and lost authority state all refuse. Copying displayed results never mints a capability. |
| Rollback and forks | Valid older signed prefix versus current checkpoint, truncation, missing record, duplicate sequence, two successors, rolled-back consumption and replaced ledger root refuse. Simultaneous rollback of the trust source remains unsupported, not called detected. |
| Producer interruption | Failure and actual worker death before/after reservation, exclusive creation, created-entry, content write, publication intent, rename, directory/file sync, receipt and linkage. Unknown create-to-register gaps/aliases remain preserved. |
| Controller restart | Read after restart creates nothing; original grant/ordinal never revives. Known unused recovery ordinals require new approval. Partial consume/seal/coordination acknowledgement blocks rather than scanning for ownership. |
| References and races | New receipt, corrupt receipt, live/suspended/unknown producer, inode/ancestor/ACL/flags change, cross-root substitution and changing checkpoint stop the whole plan; no pathname fallback or partial batch. |
| History equivalence | Independently calculated A/A/B/A, volume-only/null-volume, context epochs, successor/cutoff, both as-of clocks, midnight, partial/missing receipt and truncation results match existing meanings. No capture from a receipt-less payload. |
| Maintenance reading | Abandoned effects leave committed rows/coverage unchanged. Full legal spent sets are descriptive only; missing unlink/changed markers/unsupported committed maintenance block. No metadata removal. |
| Bounds and durability | Both-root counts/bytes/FDs/read depth at exact bounds and one over, authority/storage exhaustion, failed preallocation, partial witness publication, sync failure and lost response retain explicit uncertainty. No quota increase to pass. |
| Prior builds | Current v1/v4/v5 high-level adapters reject the fresh E profile before chart/data actions, including waiters approved earlier. Raw same-process synthetic addon entry points are not a production compatibility/security fence. |
| Operational invariants | No MCP/normal-startup wiring, real-data access, Dot resumption, job changes or changes to scenario/notification rules. Source/setting hashes and constructor/read-only no-write checks accompany verification. |

No feature flag beside an old v1 policy can fence old readers. Real enrollment, profile initialization/migration, stopping/draining old processes, key rotation, production packaging and enabling recording/recovery each need separate reviewed approval. Testing fake producer histories does not authorize importing old temporary reports or backdating prospective history.

## Implementation Slices

| Slice | Deliverable after its own approval | Boundary |
|---|---|---|
| E-A | Strict proposed evidence roles, acyclic digest construction, pure producer/admission replay, restart decisions, joint capacity calculation | Invented in-memory inputs only; no I/O, native load, signature authority, capability minting or executor. Results explicitly supplied-model-only/non-executable. |
| E-B | Bounded native E evidence reader and fixture-pinned witness/checkpoint verification | Read-only existing marked fixtures; no constructor initialization, key creation or data mutation. Keep this profile separate from v5. |
| E-C | Explicit synthetic producer preparation/publication and witness persistence | Fake restored captures only, finite native steps, exact same writer order and whole payload/receipt scope. No live collector or real-key bootstrap. |
| E-D | Transaction-aware history/status adapter and classifier evidence mapping | Differential history tests and read-only spent fixtures; existing v1 readers/executors and committed-maintenance refusal unchanged. Raw-stage execution is not silently routed through v5's capture-only targets. |
| E-E | Durable synthetic restart verification and fresh-admission handoff | Independent test checkpoint, persisted consumed ordinals/witnesses, actual worker/controller restart and fail-closed gaps. Host consent, production trust/antirollback qualification and F purge remain unavailable. |

The currently approved implementation is **E-A only**. E-B requires a separate implementation approval; these contracts do not authorize E-B through E-E, persistent key/authority provisioning, real-data operation, MCP registration or production enablement. Before production can be considered, choose and qualify the authority/key/checkpoint boundary and storage lifecycle, then separately approve host consent and store enrollment/migration. Retain the strictly-more-than-90-elapsed-day purge rule and the hold when elapsed age cannot be proved; E supplies neither a clock fallback nor a strategy-rule change.

## E-A Implemented Boundary

`src/nativeBarAdmission.ts` is a separate pure module, not imported by any runtime entry point or MCP tool. It accepts invented in-memory JSON only and returns detached descriptive results. No filesystem/native helper, collector, ambient clock, process settings, signature generator, execution handle or writer is used. Existing v1/v2/v4/v5 contracts and adapters remain untouched.

- The new policy identifier is `native-bar-synthetic-admission-profile-v6`. Strict body/envelope/bundle, scope, original, layout and replay schemas have explicit v6 domains. Native counters remain decimal strings; all IDs are lower-case and role-distinct. The existing receipt's logical fields are preserved rather than restamped.
- Envelopes use only `native-bar-supplied-signature-v1` / `unqualified-fixture-v1`. `signature_checks`, trust pins, challenge and checkpoint are supplied model facts, **not an actual verifier, independent trust source or authenticated current checkpoint**. A self-consistent forged fixture may be structurally consistent but cannot become accepted history or a capability. E-B must qualify the real signature/checkpoint format separately; no verifier callback, algorithm fallback or key provisioning exists here.
- The body digest excludes the signature and future acknowledgement; the predecessor binds the whole preceding envelope. Scope issuance precedes the original seal. Coordination's separate domain binds the exact role/path/proof set, owner incarnation and attempt, excluding its own digest. Raw decoding requires fatal UTF-8 and exact canonical bytes. Structured entry points reject cycles, accessors, non-JSON objects, sparse arrays, array subclasses/extra fields and excessive depth/nodes/bytes before recursive schema work or canonical serialization; strict schemas reject unknown fields.
- Producer replay models reservation, empty exclusive creation, content verification, pending/observed publication, exact receipt preparation/linkage and two predeclared verification-only IDs. It rejects creation before reservation, identity/access/flags changes, path/partition substitution, reversed receipt sequence, illegal ordering and expired invocation windows. All incomplete prefixes stay uncommitted. Reverification can bind only the already published pair under a new finite window; it cannot rewrite payload/receipt, renew the original window or prove the lost response acknowledgement.
- Maintenance replay models at most two explicitly bound published orphan payload targets, the admission/original seal, original plus two recovery consumptions, exact coordination and outer publication witnesses. Native liveness, allocation/capacity audit digests and reference claims remain supplied/unqualified. The outer publication order needs coordination and its declared attempt; it is **not** replay of the underlying move/unlink journal. Terminal publication remains `terminal_witness_present`, never verified completion or `spent`. Unresolved maintenance blocks producer records and a second maintenance admission, including for a different orphan payload; a full verified terminal adapter belongs to E-D.
- Pure restart assessment preserves consumption even across a JSON decode/replay. Original ordinal 1 never revives, including a sealed original with no consumed attempt. Unknown/live/suspended/unwitnessed coordination, missing admission, changed references, stale views, terminal witnesses needing journal verification and exhaustion yield diagnostics only. Otherwise it reports the next unused ordinal and required fresh checks, not a grant. The original reference hash remains separate from the latest supplied reference hash. No UTC-derived quarantine age is qualified.
- Every result keeps execution/recovery, admission/signature/checkpoint/approval authentication, elapsed-clock qualification and committed-history availability false. `original_acknowledgement` and `storage_visibility_at_as_of` stay `not_proven`. A consistent supplied model is not a successful native admission, current storage observation, history projection or notification signal.

### E-A Capacity Model

The calculator enumerates the complete finite **supplied budgeting model**, not caller-provided record counts: mirrored producer metadata for both verification attempts; original/manifest, three maintenance attempts, up to 14 events per target, three marker slots and completion; independent admission/coordination/publication witnesses; authority checkpoints; payload/receipt objects and directories. Every immutable metadata publication charges three retained failed temporary slots in addition to its final slot. The nine exclusive native coordination objects across all three invocations remain charged even after retirement; exclusive creation has no publication temporary. Retirement is a separate approval, not executed or authorized by this model.

Role-specific witness ceilings (4/8/16 KiB, capped by the 64 KiB global maximum) are enforced on replayed envelopes and used by the calculator. Native journal slots conservatively charge 64 KiB; original/manifest, coordination and publication object proofs must also fit that ceiling. Payload/receipt caps stay 1 MiB/16 KiB. Existing entries, logical bytes, metadata and allocated bytes from data/witness/authority are summed without deduplication or future release credit. Free space must cover the additional allocation in each root independently; unknown free space refuses. Allocated bytes use a disclosed 4 KiB rounding model, **not native physical reservation or filesystem qualification**. Read/response/root/target/descriptor ceilings remain unchanged, with three extra root leases, two target slots and 48 additional FDs budgeted.

The 512 combined-entry ceiling can refuse a two-target plan even though two targets are the schema maximum. For example, one existing entry in each of the three roots plus the fully retained two-target maintenance program exceeds that ceiling. This refusal is intentional; neither the ceiling nor temporary/recovery headroom is reduced to make a plan fit. `fits:true` means only that the supplied budget fits this finite model. It never reserves capacity, verifies actual allocation/native read sizes, or supplies production permission. E-B/E-C must additionally bind actual inventory, authority storage and reservation evidence.

### E-A Synthetic Verification

The dedicated synthetic suite covers producer prefixes, receipt-only verification, exact lineage/seal bindings, trust/checkpoint substitution, raw/canonical input bounds, ordinal exhaustion/restart, coordination/publication ordering and exact capacity boundaries plus one over. Source-boundary tests parse imports and calls to keep E-A disconnected from startup, tools, native IO, ambient settings/clocks and capability construction. All fixture evidence is invented in memory; JSON round-trips are not actual process restart, signature, disk durability or power-loss tests.

Build verification uses an isolated `build/ea-validation/` output, with a test-only import selector, to preserve the shared build used by separate R-D verification. No environment selector exists in the runtime module. Initial E-A verification passed 81 synthetic tests plus three source-boundary tests. The initial full unit regression passed 2,352 tests (including the earlier 82 E-A tests), with zero failures and two existing skips; the two subsequently added E-A tests also passed in the initial 84-test focused run. The isolated TypeScript build and Bookmap's five Java classes/two Node tests passed. Initial restricted regression failures in existing process-information/localhost tests were reproduced and resolved by running with their necessary access, not changing code, thresholds, timeouts or skips. Existing tracked files except the E-A backlog addition, the shared R-D build, Dot PAUSED and both automation/condition hashes matched the implementation's starting state. That implementation step did not include independent review, commit, distribution, real recording/move/delete, MCP registration or production enablement.

### E-A Review Corrections

The subsequent code/test/design review found three pure-contract issues and reproduced them with five failing tests before correction:

1. Sparse arrays bypassed the node estimate before canonical serialization; inherited array `map` implementations could be invoked, and extra array fields could be silently discarded. The structured-input guard now bounds array length before enumeration/serialization and accepts only dense ordinary arrays with exact element keys. It refuses even the maximum JavaScript array length without traversing it.
2. Coordination/publication object proofs inherited the 1 MiB generic artifact ceiling, although their capacity slots charged only 64 KiB. Maintenance metadata proofs now enforce the same 64 KiB ceiling; exact-bound and one-over cases cover both roles. Payload proofs retain their separate 1 MiB allowance.
3. A new maintenance scope over another orphan payload could follow an unresolved maintenance. Replay now refuses that second admission rather than layering independent operations over unresolved state. A terminal witness alone still cannot reopen admission.

A sixth synthetic case explicitly verifies payload publication before UTC midnight and a logical receipt afterward: the predeclared partition/paths remain fixed, the later receipt time remains later, and no storage-visibility claim is added. This also clarifies the prospective publication prose above; it does not change v1 receipt logic, retention, trading or notification conditions. Review fixes have no IO, authority or execution connection. The focused suite passed 87 synthetic tests plus three source-boundary tests. With source/test hashes fixed, the complete unit regression passed 2,360 tests with zero failures/cancellations and two existing skips. The isolated TypeScript build and Bookmap's five Java classes/two Node tests also passed. This review is not a native, sanitizer, actual-signature, power-loss or separate-reviewer qualification. Existing unrelated source/shared R-D build hashes, Dot PAUSED and both automation/condition hashes remain unchanged; E-A's six related files alone are selected for commit. No push, distribution, real-data operation, MCP registration or production enablement is performed.
