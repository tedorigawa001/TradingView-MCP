# E-B Read-Only Native Admission Verification

Status: **design approved; B-1 in-memory verification implemented only**, 2026-10-25 JST, based on `325ffc7` and the approved [slice E design](NATIVE_BAR_DURABLE_ADMISSION_DESIGN.md). The user approved B-1 and public-test-key signing preparation restricted to test memory. B-2/B-3 native reads/orchestration, fixture persistence, key/service provisioning, data mutation, MCP registration and production enablement are not authorized. Dot remains PAUSED; scenario, trading, notification and retention conditions stay unchanged.

## Purpose And Boundaries

E-B will read an **already prepared, explicitly registered synthetic fixture**, authenticate its outer evidence signatures/current checkpoint under an independently pinned test authority, and bind the bytes to descriptor-native snapshots of the data and witness roots. It returns a bounded read report, never a writer, original-admission capability, execution plan or accepted history.

| E-B may establish, within the fixture | E-B must not claim |
|---|---|
| Exact raw bytes, current native object/access proofs and bounded inventories observed during the read | Historical sync/durability, power-loss survival or continued immutability after return |
| A signature matches the fixed test public key and exact signed message/domain | Market truth, independent original intake, human consent or a production trust boundary |
| Two fresh, authenticated responses from the registered fixture authority name the same ledger tip | Detection of simultaneous rollback of that authority and both trees, or proof of non-forking by a malicious authority |
| A complete bounded logical prefix agrees with that tip and passes E-A's pure model | Transaction completion, safe movement/deletion, ownership retirement, an unused actual execution grant or committed-history eligibility |

E-C owns future producer/intake publication; E-D owns actual move/unlink journal replay and history projection; E-E owns a new same-process admission handoff. E-B does not skip those gates. The strictly-more-than-90-elapsed-day rule and the hold when elapsed time cannot be proved remain untouched.

## Existing Contracts To Preserve

The corrected E-A contract at `325ffc7` is the baseline:

- Raw depth/value counting precedes JSON construction; canonical UTF-8 bytes, strict fields, lossless counters, role IDs and byte bounds remain mandatory.
- Plan digests are single-use across the supplied ledger. Producers are serialized; reverification/recovery windows do not reopen the prior window or precede prior consumption.
- Original/manifest and coordination creation chronology is checked. A caller's `clear` cannot erase witnessed, unretired coordination. Diagnostic restart results have no next ordinal.
- Freshness derives from the checkpoint observation, not a freely relabeled `as_of` value. E-A's ten-minute bound is not renewed by a new native root lease.
- Capacity includes retained R-D reserve/headroom and per-volume free-space accounting. The complete two-target write program needs 551 entries even when empty, exceeding 512; one producer plus one maintenance target also does not fit. E-B cannot lower headroom, split a write plan or raise a ceiling to conceal this.
- E-A remains a pure supplied-model module. Its `unqualified-fixture-v1` label, hash definitions, schemas and false authority/execution flags are not replaced by actual authentication results.

Relevant implementation references: [E-A](../src/nativeBarAdmission.ts), [current adapters](../src/nativeBarFs.ts), [native reader](../native/native_bar_fs/native_bar_read.inc), [native root/profile checks](../native/native_bar_fs/native_bar_fs.cc), and [v5 read tests](../test/native/nativeBarRecoveryRead.test.mjs).

## Approved Design Decisions

| Decision | Recommendation |
|---|---|
| Native entry | Separate fixture-only `admission_read_protocol:6`, data/witness root roles and tagged read handles; do not widen v2/v5 profiles or use a policy override. Names are provisional, not registered APIs. |
| Actual signature | Ed25519 over a domain-separated canonical outer envelope containing the exact unchanged E-A record. Only a public verification key is available to the E-B verifier. |
| Trust source | An immutable test-bootstrap registration outside both trees pins fixture/store/epoch/authority/key identities, public-key fingerprint, native root/ancestor bindings and a read-only authority adapter. No enrollment from files or requests. |
| Freshness | Two independent challenge responses, before and after the joint read; exact same logical tip and epoch, bounded host observation brackets and a single non-renewable read deadline. |
| Publication scope | One signed outer envelope replaces each physical witness/mirror record, rather than adding detached signature sidecar files. Its **entire size**, including wrapper/signature, must fit the existing role ceiling. |
| Failure | No fallback, repair, retry loop, cleanup, new receipt, old checkpoint or partial-success view. Preserve the filesystem and return explicit unavailable/changing/incomplete diagnostics. |
| Result authority | Fixture-scoped cryptographic/native facts may be true in a separate section; admission, execution, approval, history and elapsed-age qualification remain false. |

Changing to a new signature-bearing inner E-A record would change predecessor hashes, checkpoint tips and existing replay fixtures. Detached sidecar files would add retained files/temporary slots and require new capacity design. The proposed outer envelope avoids both, at the cost of explicit separation between logical-record and physical-file hashes. If its overhead does not fit, refuse the fixture; do not increase a role limit or remove metadata/recovery headroom.

## Trusted Fixture Registration

Only the trusted test bootstrap may register a fixture and obtain an opaque **read-context token**. A displayed report, deserialized object, environment flag, marker file or disk public key cannot create one. This token authorizes only bounded reading of that registered synthetic fixture, not maintenance or future writes. E-B never reads a real history root.

The registration fixes:

- Fixture ID, expected E-A policy hash, store/epoch/enrollment hash and authority/key IDs. They are distinct from challenge, producer, artifact, maintenance and target IDs.
- Public `KeyObject` of type Ed25519 and its expected SPKI DER SHA-256 fingerprint. Reject private keys, replacement/embedded PEM or JWK, request-selected algorithms, URLs, key-provider loaders and key rotation/fallback. Import only fixed bootstrap public bytes; no private-to-public conversion in the reader.
- Data and witness root descriptors/roles, expected common fixture ancestor/marker and full native identity/access bindings. Data and witness must be distinct directories on the same qualified local APFS device, as E-A requires; one must not contain the other.
- A named, already registered fixture-authority read adapter and its independent store/epoch high-water state. No requester-supplied verifier/provider callback, RPC destination or signer endpoint. The first implementation uses a test-harness-controlled oracle, not a newly installed network service.

Proposed existing-fixture shape:

```text
<canonical test temp>/native-bar-fs-synthetic-<six alphanumeric characters>/
  .native-bar-fs-synthetic           # existing fixture marker, read only
  .native-bar-admission-synthetic   # proposed E marker, pinned by bootstrap
  store/                           # exact E-A synthetic v6 policy
    policy.json
    producer/<producer-id>/<sequence>.json
    captures/<UTC-day>/<recording-id>.json
    receipts/<UTC-day>/<recording-id>.json
    ...declared maintenance/holding/quarantine entries...
  admission-witness/
    <sequence>.json
    ...exact predeclared temporary slots...
```

This concretizes, rather than uses verbatim, the earlier illustrative `native-bar-e-synthetic-<id>` layout. The current native opener accepts only a six-character temporary fixture ending in `/store`; a new role-aware opener is required for the witness sibling. It must not make the old opener accept a different path/profile. Both markers and both roots must already exist; absence is `fixture_unavailable`, not initialization permission. Marker bytes/path alone do not establish trust. Their identities/access and the externally registered fixture ID must match.

No fixture, directory, marker, policy, key, authority journal, checkpoint file or reserve is created in this design step or by E-B construction/read/close. A later synthetic-test implementation approval must separately delimit test-harness setup/teardown of invented fixtures. Production key custody, service isolation, storage location, enrollment, migration and OS/backup rollback resistance remain unselected and unavailable.

## Signed Record Wire Contract

The B-1 strict outer record is `native-bar-signed-admission-record-v1`, with these fields:

| Field | Binding |
|---|---|
| `schema`, `scope`, `algorithm` | Exact new schema, `synthetic_fixture_only`, `ed25519` |
| `fixture_id`, `key_id` | Exact bootstrap fixture/key; key ID also matches the inner E-A envelope's key ID |
| `record` | Exact E-A v6 envelope, including its explicitly unqualified inner signature fields |
| `record_hash` | Existing `evidenceHash(record)`; this remains E-A's logical predecessor/tip identity |
| `placements` | Exact ordered list derived from the record role, never arbitrary caller paths |
| `signature_hex` | Exactly 128 lower-case hex characters, a 64-byte Ed25519 signature |

The signed message is UTF-8 of existing `canonical({domain:"native-bar-eb-signed-record-v1", envelope: unsignedOuter})`; `unsignedOuter` contains every field above except `signature_hex`. It includes the full inner record and its hash, not only a displayed digest. No signature, physical-file hash, later checkpoint or future persistence acknowledgement is included in its own signed message. This is the repo's canonical encoding, not a new claim of RFC 8785/JCS compatibility.

Each witness record is physically `admission-witness/<record.body.sequence>.json`. Only producer record roles also have a mirror at `store/producer/<producer-id>/<sequence>.json`; enrollment/maintenance witness roles have no invented producer mirror. Producer placements are ordered data then witness; other roles have exactly the witness placement. No leading-zero sequences, alternate casing, extra placements, role aliases, duplicate indices or alternate suffixes are accepted. Order logical sequences by their bounded lossless decimal value, not lexicographic directory order (`1,10,2`); require exactly `1..N`. Mirrors have identical outer bytes but distinct single-link native objects; a cross-root hard link is not deduplication.

Maintain three distinct meanings:

1. `record_hash`: logical E-A record identity and `previous_hash`/checkpoint tip input.
2. Native SHA-256 of the whole canonical signed outer file: current physical bytes/proof, also compared between mirrors.
3. Cryptographic signature verification under the pinned test public key: authenticity of that exact outer message, not historical/native/market truth.

Do not compare (1) directly to a native outer-file hash. Do not patch E-A's `signature_hex`/algorithm or use its `signature_checks` as actual verification evidence. The E-B adapter builds those **internal supplied-model inputs** only after the real verifier succeeds; no public API accepts precomputed `valid` assertions or an already assembled E-A bundle as a verified native view. E-A's nested result stays false-authority even after E-B's separate fixture verification succeeds.

No extra signature file or algorithm negotiation is introduced. The whole physical outer file must fit `NATIVE_BAR_ADMISSION_RECORD_BYTES[role]` (4/8/16 KiB), not that limit plus a wrapper allowance; 64 KiB remains the global record ceiling. Future publication of these wrapped records belongs to E-C. E-B cannot sign, append, wrap or rewrite a record on disk.

### Cryptographic Implementation Boundary

Use the supported Node verifier, not custom curve arithmetic or new crypto dependencies: `crypto.verify(null, signedBytes, pinnedPublicKey, signatureBytes)`. Before any verification, refuse a pinned key whose point is small-order (either sign of the eight small-order encodings) or non-canonically encoded (y ≥ p). Some OpenSSL builds accept such keys, and with Node 24.18.0/OpenSSL 3.5.7 one constant signature then verifies every message. Unknown algorithm/key type, invalid signature encoding, unsupported crypto configuration or verifier exceptions fail closed; do not try another algorithm/key or treat an exception as `false`-but-usable provenance. Test malformed/noncanonical signatures against the chosen runtime as well as known good/bad vectors before accepting that runtime profile.

Ed25519 uses 64-byte signatures; test-vector and encoding references are [RFC 8032, sections 5.1 and 7.1](https://www.rfc-editor.org/rfc/rfc8032.html#section-5.1). Node documents the `null` algorithm parameter for this verifier in [the official crypto API](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback). These references support the proposed API/encoding, not qualification of this machine or a production key store. The package's supported Node versions/configurations require explicit fixture tests; support in current online docs alone is insufficient.

## Read-Only Checkpoint Contract

The B-1 strict checkpoint is `native-bar-signed-read-checkpoint-v1`, a canonical response capped at **4 KiB including signature**. Its unsigned fields are schema, synthetic scope, algorithm, fixture/store/epoch/authority/key identities, enrollment hash, fresh `challenge`, logical `sequence`/`tip_hash`, and `observed_at`. Sign all of them under the separate domain `native-bar-eb-read-checkpoint-v1`. Do not reuse a record signature as a checkpoint or vice versa.

The fixture authority reads its existing independently maintained latest state and returns an authenticated read statement. A query must not extend a ledger, advance its high-water mark, consume an approval, allocate files, log to the record trees, generate a key or persist a fresh checkpoint. The verifier contains no signer; test signing belongs only to separately approved fixture preparation/authority harness code. No query starts/restarts the authority or requests a signature over arbitrary JSON.

For each explicit read:

- Generate a fresh lower-case random UUID challenge in the read context, not in startup/import/constructor. Bind the response to that exact context/provider/fixture and a single request. Challenge reuse or collision with any bound role ID refuses; no cached response or automatic replacement challenge is tried.
- Verify signature/domain/key/pins and require authority `observed_at` within the host UTC send/receive bracket. Use a consistent injected clock in synthetic tests; unknown clock relation or a wall-clock rollback blocks qualification instead of introducing a tolerance. This is a proposed fixture-reader check, not a change to market confirmation rules.
- Bound the response by the common ten-minute monotonic and wall-clock read deadline, including time spent in the authority call. Native/crypto/provider work does not get a fresh deadline. The fixed authority adapter must support a cancellable bounded asynchronous request, not a blocking foreign callback; late responses are discarded and handles are closed. Checks surround each bounded native/crypto operation; this is not an OS hard-real-time guarantee or a promise to interrupt a stalled kernel syscall.
- Obtain `C0` before reading the trees, then `C1` after final native checks under a different challenge. Require identical fixture/store/epoch/authority/key/enrollment/sequence/tip; observation times/challenges differ normally. A progressed tip is `changing`, not permission to append missing files, trim a prefix or retry automatically.

The authority adapter must independently know its current high-water state. Missing/lost/unqualified authority state blocks even with a cryptographically valid old file/checkpoint. Restoring both trees and an alleged authority state from the same backup does **not** establish freshness; no disk scan, longest-prefix rule, valid signature or challenge can repair that missing independent fact. An authority with the pinned private key can sign a fresh lie; this design assumes the registered test oracle is honest and independently controlled. Production anti-rollback/non-forking and OS/process/key isolation are not qualified by these tests.

## Native Read Profile And Namespace

The future native entry must expose only open paired read context, inventory, bounded read by inventory index, final verify and close. Its handles are tagged with E profile/root role and cannot be passed to inspect/stage/purge/coordination/recovery/writer methods. Existing native v2/v3/v4/v5 exports and high-level profile refusal stay unchanged. No raw-addon, Node pathname, symlink-following, compile/download or old-reader fallback is permitted.

This is a fence on the **new read handles/adapter**, not on arbitrary privileged same-process addon use. Existing raw synthetic open/write exports are not a production security boundary; their continued existence does not prove that an arbitrary addon caller cannot open another handle. High-level profile refusal and lack of E-B mutation methods are distinct claims. Production packaging/isolation and any restriction of those older raw exports remain separate review/approval gates, not silently included in E-B.

Reuse audited descriptor primitives, not old profile assumptions:

- Open every ancestor/marker/root without following links; pin actual name bindings, device/inode/owner/group/mode/birthtime/flags, complete ACL hashes and allocated blocks. Recheck anchors and access proofs before/after reads and at final inventory verification. Keep strict private fixture ownership/modes/ACL rules and the existing supported-volume checks; no volume capability mutation probe is needed or allowed.
- Inventory both roots completely with exact case-aware names. Reject folded evidence-name aliases and ambiguous identities. Regular evidence is single-link and opened nonblocking; symlinks, FIFOs, sockets, unknown ACLs or unsafe evidence never become readable evidence. Reject rather than chmod/repair.
- `policy.json` must be the exact E-A v6 profile and match enrollment/registration. Witness sequence names, producer mirror names, metadata temporaries and current data/maintenance namespaces are explicitly separate. Do not carry v5's root-file-as-evidence rule into E-B.
- Ordinary, explicitly recognized side files outside private evidence namespaces are preserved and counted, not parsed as receipts or selected for cleanup. Unknown/malformed entries in private producer/witness/maintenance namespaces block a complete verified view. Exact predeclared temporary slots are counted and reported pending, never adopted into a ledger; partial signature/witness bytes do not become an older complete prefix. Side-file churn changes the inventory generation and yields `changing`, not silent exclusion.
- Read complete raw bytes only after checking the role size, aggregate byte budget and native proof. Bound depth/value count on bytes before JSON construction, then fatal UTF-8, canonical equality, strict schema and signature verification. Role/filename/content bindings are checked independently. No `JSON.parse`-then-check allocation path is acceptable.
- Close inventories, descriptors and leases in `finally`, including partial pair-open, decode/crypto/provider failure, timeout and cancellation. Close is release-only, never coordination cleanup, `fsync`, unlink, atime restoration or reserve release. A failure to finish resource release prevents a successful report and remains explicit.

Read-only means no application-issued file/namespace/access mutation. Ordinary filesystem reads may affect kernel-managed access-time/cache metadata; do not promise bitwise-identical OS metadata or attempt to restore atime. No writer/chart lock is taken and no writer lock file is created. Busy/unwitnessed writer state is preserved and reported; E-B never probes by creating/deleting a file or retires an owner.

## One Bounded Joint Read

1. Validate trusted read-context token and fixed verifier/key/provider support without opening any unregistered path. Start one deadline/resource/read-byte context. A constructor/import performs no IO or authority contact.
2. Request and authenticate `C0`; refuse authority absence, unknown epoch/key or stale/mismatched response. Pin its enrollment and current logical tip.
3. Open only the two pre-existing registered roots and markers. Check policy/root/ancestor/enrollment bindings; take complete native inventories `I0(data,witness)` with the shared counters.
4. Read every witness record through its native index, enforce its exact sequence/placement, verify the real outer signature and logical chain `1..C0.sequence`. Missing files/gaps, files beyond the tip, forks/duplicates, mixed profiles and a tip/hash mismatch block the whole result. Neither a complete payload nor one root's good prefix supplies a missing witness.
5. Verify required producer mirrors independently through the data root and compare whole outer bytes, then internally project the unchanged logical records into E-A. Construct `signature_checks`/checkpoint only from the verifier's results and call pure replay. A blocked/invalid model cannot become verified because its outer signatures pass.
6. Bind current native payload/receipt/stage and metadata observations to their declared roles/digests where the producer model determines an unambiguous location. Historical creation proofs are issuer claims, not current empty-file requirements. Never require a stage to remain after a recorded rename, synthesize a missing receipt or recapture bars. An incomplete pair is reported incomplete, not committed history.
7. Maintenance-related locations/publications are read and authenticated as bounded evidence only. Since E-B does not replay the move/unlink journal, it cannot verify a source's legal absence, completion, retirement or `spent`; mark `transaction_mapping_pending`. Do not guess ctime relaxation, treat absence as deletion or make an unsigned location exception. Full current transaction/history interpretation is E-D.
8. Reverify both inventories/anchors/access/content bindings under the same context, then request/authenticate `C1`. Take final paired native checks after that response as well; any change anywhere, including the joint provider tip, yields unavailable/changing. Account for every pass; do not reset counters or return a partial older snapshot.
9. Publish a detached bounded report only if all checks for its stated verification scope succeed. In all cases close the read context. A result describes the observed brackets/stability, not an atomic cross-root transaction, a future stable view or a reusable grant.

No transparent retries: callers may explicitly begin a new read later with a new deadline/challenges, but that does not revive a prior plan or change prior consumption. Detailed checkpoints/raw signatures stay internal evidence; no private keys, payload OHLC, account data or host private paths are included in a general status report.

## Limits And Accounting

Preserve the E-A/R-D ceilings: **512 combined entries, 1 GiB logical inventory, 16 MiB metadata, 256 MiB actual evidence reads, 8 MiB response, eight root leases, 32 live targets, 512 native FDs and 48 additional-FD headroom**. Role record/capture/receipt maxima remain 4/8/16 KiB, 1 MiB and 16 KiB, with 64 KiB the global metadata-record maximum. JSON depth/value bounds remain those of corrected E-A; signed wrappers do not earn extra nesting allowance.

Both roots share one entry/metadata/read budget; reaching one root's limit does not create another allowance for the sibling. Native traversal limits must apply to **remaining global** budget and actual bytes, including both markers/policy, readback/rehash/ACL serialization, mirrors, final checks, both checkpoints and bootstrap metadata. Never sum two successful per-root reports after each already spent a full allowance. Repeated reads are charged repeatedly; the same file content/inode on another path gets no deduplication credit. Response accounting includes its complete serialized report/protocol overhead before returning.

Two read root leases are expected, but existing active native sessions/descriptors in the same process are included. This is not a machine-wide OS-descriptor or cross-process resource guarantee. The future authority adapter's read transport is also bounded; opaque external storage/resources are not free. A test oracle's authority-storage accounting may be supplied fixture data, **not verified native capacity**. Do not scan/provision production authority storage to fill that gap. Actual resource exhaustion/unknown accounting refuses the relevant qualification.

The E-B reader makes no allocations or physical reservations and cannot set E-A's `capacity_verified` or `physical_capacity_verified` true. The E-C full-program calculation remains unchanged and must charge wrapped records inside the same role ceilings, all retained slots/reserves, authority storage and shared-volume free space. Do not use E-B's smaller read-only footprint to authorize a write program that fails E-A capacity. In particular, two-target schema support is not an executable two-target plan under the present 512-entry ceiling.

## Report And Failure Semantics

Propose a new `native-bar-admission-read-report-v1` with:

- `scope:synthetic_fixture_only`, status, query/observation brackets, pinned fixture/store/epoch IDs, logical tip and joint generation digest.
- Separate fixture facts: outer signatures, two challenge responses, native snapshot/role bindings and logical prefix verification; each is true only after its actual check. An authentic incomplete prefix may have valid signatures without `view_verified:true`. That aggregate flag is false for unavailable, changing, incomplete or transaction-mapping-pending results; individual authenticated byte facts do not override the blocking status.
- Separate unresolved facts: original-intake verification, producer liveness/retirement, transaction journal replay, authority OS rollback isolation, durability, history availability and physical-capacity qualification are not established by E-B. An authenticated historical `dead` field does not establish present liveness.
- The original E-A model result nested without changed flags. No copied JSON report can reconstruct a read context or an execution capability.
- Public `execution_available:false`, `recovery_execution_available:false`, `admission_verified:false`, `approval_authenticated:false`, `committed_history_available:false`, `elapsed_clock_qualified:false`; `original_acknowledgement` and `storage_visibility_at_as_of` remain `not_proven`. Actual fixture-signature authentication is not human approval.

| Condition | Result; no mutation |
|---|---|
| Root/marker/backend/profile unavailable | `unavailable`; no initialization or fallback |
| Unknown key/algorithm, malformed/corrupt/noncanonical record or invalid signature | Integrity/authentication blocker; no usable verified view |
| Authority missing/unqualified, old/wrong challenge, wrong epoch/tip or response outside bracket/deadline | `trust_checkpoint_unavailable` or specific authentication/freshness blocker; no old checkpoint |
| Inventory/content/ACL/ancestor or checkpoint tip drifts | `changing`; no auto-retry or partial success |
| Missing mirror/witness, predeclared interrupted temporary, receipt/linkage incomplete | `publication_incomplete`; preserve and report only bounded diagnostics |
| Historical/current transaction location cannot be proven by producer-only checks | `transaction_mapping_pending`; no guessed absent/unlinked/completed state |
| Ledger/current coordination is live, suspended, unknown or unwitnessed/unretired | Owner/coordination prerequisite; no retirement or restored ordinal |
| Limit, timeout, cancellation or release failure | Unavailable/resource diagnostic; release-only cleanup, no successful view |

`view_verified` is limited to the exact read scope and stable observations; it must not be used as eligibility for execution, record acceptance or scenario notification. This work does not call Gmail, TradingView/CDP, account/order/alert tools, change a Study, select a pane or take a chart lock.

## Synthetic Acceptance Matrix

All cases require separately approved invented-fixture preparation; the reader itself creates nothing.

The user approved B-1's test-only use of public RFC test-vector key material to prepare invented signed messages in memory. The verifier/startup never imports that test code or receives a private key; no generated/persisted key, signer service or production credential is involved. This does not approve native fixture preparation or an authority service.

| Area | Required cases |
|---|---|
| Signature | RFC known good/bad vectors and independently prepared fixture signatures; bit flips, wrong key/type/domain/fixture/role/placement; malformed length/hex, unknown fields/algorithm, unsupported runtime; no verifier injection/fallback |
| Trust separation | Embedded replacement key/epoch/profile and copied report cannot enroll; valid signatures from another fixture/authority refuse; raw E-A `valid` claims and unwrapped files never qualify |
| Checkpoints | Distinct start/end challenges; old response, relabeled `as_of`, old prefix versus current tip, missing/gapped/forked/ahead ledger, changed final tip, authority loss/unknown state, timeout/late response and wall-clock steps |
| Native read | Root/ancestor/marker/policy substitution; flags/complete ACL/allocation changes; file replacement and symlink/FIFO/socket/hard-link/case aliases; mirror disagreement; stale/foreign/closed handles; no path fallback |
| Namespace | Recognized ordinary side files preserved/countable; malformed private entry blocks; interrupted predeclared slots never adopted; side churn yields changing; incomplete creation/publication/receipt retains uncertainty |
| Interpretation | Historical created proof does not require an extant empty stage; no receipt synthesis; midnight clocks preserved; maintenance source absence/completion/retirement stays pending for E-D; no accepted history or grant |
| Whole-query bounds | Exact ceiling/one over for both-root totals, wrapper-inclusive sizes, raw pre-scan, all repeated reads/checkpoints, complete response and live roots/FDs; near-exhausted budget on second root, provider stall and close at each failure boundary |
| No mutation/compatibility | Before/after names, bytes, modes/ACLs/flags/reserves unchanged aside from explicitly excluded kernel atime; instrumented no mutating syscalls/FS methods; read handles cannot invoke mutation exports; old v1/v4/v5 profile refusal and E-A pure outputs unchanged |
| Independent-state limit | Reader restarts with live independent oracle and detects an old file prefix; oracle state loss refuses. Simultaneous rollback/collusion is explicitly **not** called detected or production-qualified |

Native compilation/tests, static analysis/sanitizers and packaging are future approval/verification steps, not accomplished by this document. Do not run real machine-market comparison or provision a production key to fill a synthetic coverage gap.

## Proposed Implementation Sequence

| Step | Separately approved work | Stop before |
|---|---|---|
| B-1 | Bounded strict outer/checkpoint codecs, fixed-public-key signature verification, logical/physical hash separation and the internal E-A projection; in-memory synthetic vectors only | Any native open, fixture write, signer/service/key provisioning, MCP/startup wiring |
| B-2 | Dedicated native paired read profile, explicit existing-fixture registration, global resource/namespace accounting and read-only failure tests | Data publication/movement/deletion, writer/retirement APIs and production roots |
| B-3 | Two-checkpoint joint-view orchestration with the trusted fixture oracle, interpretation/failure reports and complete negative/regression qualification | Real intake/authority trust, accepted history, E-E handoff, execution and production enablement |

The approved implementation is **B-1 only**. B-2 needs its own approval; do not infer permission for native reads, fixture persistence, real-data operation, MCP registration or production enablement from the B-1 work.

## B-1 Implemented Boundary

`src/nativeBarAdmissionVerification.ts` imports only Node public-key/hash APIs, zod and the existing pure E-A/evidence modules. It has no native, file, network, process, ambient-clock, challenge-generator, signer, key-generation or key-import API. The fixed test public `KeyObject` is supplied separately from strict JSON pins; only an actual public Ed25519 key with the exact expected SPKI fingerprint is accepted. Private keys, encoded replacement keys and caller-selected verifiers are refused. Factory construction captures detached pins but establishes no independent trust source or read registration.

The implemented interfaces are:

| Interface | In-memory work only |
|---|---|
| `decodeNativeBarSignedAdmissionRecord(bytes)` | Bounded/canonical/strict outer parsing and wrapper-inclusive role ceiling; no authentication |
| `decodeNativeBarSignedReadCheckpoint(bytes)` | Bounded/canonical/strict 4 KiB checkpoint parsing; no authentication |
| `createSyntheticNativeBarAdmissionVerifier(pins, publicKey)` | Capture a fixed public test key/pins; returns no native or execution handle |
| `verifyRecord(bytes, suppliedLocation)` | Verify inner digest, enrollment/pin/role/placement bindings and actual outer signature; return logical hash separately from encoded-byte SHA-256 |
| `verifyCheckpoint(bytes, suppliedRequest)` | Verify signature, pinned identities, exact supplied challenge and inclusive supplied UTC send/receive bracket; refuse reversed or ten-minute-expired brackets |
| `verifyTranscript(input)` | Verify two differently challenged signed checkpoints against complete raw witness messages, lossless numeric order/chain/tip and pure E-A replay; reject unknown precomputed verification assertions |

Placements are explicitly `{root_role:"data"|"witness", path:<relative-to-that-root>}`. Thus witness sequence 1 is `1.json`, while a producer's mirror is `producer/<producer-id>/<sequence>.json` in the data root. The input transcript contains `records:[{bytes,location}]`, `start/end:{bytes,request:{challenge,sent_at,received_at}}`, and `evaluated_at`; all locations/times are supplied values, not native observations. It accepts raw signed evidence again, not a copied verification result or a supplied E-A `valid` list. Non-witness transcript locations, missing/duplicate sequences, changed checkpoint tips, role/challenge aliases and inconsistent E-A models refuse the entire result.

Successful cryptographic results set `fixture_signature_verified:true`; a complete transcript can additionally set `checkpoint_pair_verified:true` and `logical_prefix_verified:true`. `encoded_sha256` hashes the captured in-memory canonical outer bytes and is **not a native file proof**. `supplied_location_matches:true` is only a comparison with the supplied location. All admission/execution/recovery/approval/history/native-snapshot/view/elapsed-age flags remain false; acknowledgement and historical storage visibility remain unproven. The nested E-A result is unchanged, including its false signature/checkpoint-authentication flags.

No B-1 function generates a challenge, contacts the authority, reads a current high-water state, measures an actual request bracket/deadline or consumes a challenge. The explicit `challenge_generation_verified:false`, `actual_request_timing_verified:false` and `authority_state_verified:false` preserve that boundary. Re-verifying the same supplied transcript is intentionally pure and repeatable; B-3 must supply the real outstanding-request registry, randomness, monotonic deadline, cancellable provider and independent latest-state checks. A genuine signature from a dishonest/public test signer still does not prove current state, original intake, human approval or rollback resistance.

Input guards reject noncanonical bytes, fatal UTF-8 errors, duplicate keys, excess depth/values/bytes, accessors/cycles, sparse/decorated arrays and shared-memory (from any realm) or detached byte views before recursive schema/crypto work. Malformed UTF-8/JSON refuses with coded errors rather than parser text that would quote input bytes. Byte-view lengths come from intrinsic typed-array getters; input properties cannot understate the length or supply serialization callbacks. Own properties on a byte view are ignored rather than enumerated, because bytes are read only through intrinsic getters and copy. Byte views are copied by their exact slice into private memory. Public key instances with string-named own properties or accessor fields also refuse before fingerprint export, preventing instance-level callback injection. The public key remains a trusted bootstrap dependency; these checks are not a sandbox against arbitrary same-process code/prototype/runtime replacement. Repeated input references are charged repeatedly; whole-transcript input accounting includes all raw messages/checkpoints and the captured pins/location/request metadata, within the existing 16 MiB metadata ceiling. Result serialization is capped at the existing 8 MiB response ceiling. This is not native/protocol IO accounting or a physical reservation.

The runtime contains no signing function. Test code alone uses published RFC 8032 material in memory; the standard P-256 public generator is used only to test rejection of a genuine wrong-type public key. No key file, signed record/checkpoint file, native fixture, cache or authority is created. No native reader/test/compile or real-data operation is needed for B-1.

E-A source and semantics remain unchanged. Its old source-boundary test prohibited even this newly approved pure dependency; it now allows only `nativeBarAdmissionVerification.ts` with its exact pure-import list. B-1's own boundary tests still prohibit importing the verifier from any other runtime module/startup/tool, and prohibit signer/native/IO/ambient-clock/challenge APIs. They count dynamic `import()` with a literal specifier, and refuse aliased global or clock access (`globalThis`, `Function`, `performance`, `crypto`, `Date()` and any `Date.now` reference), each proven against bypass snippets. A non-literal dynamic import elsewhere cannot be resolved statically; it is reported, not proven safe. Existing production/MCP disconnection and all trading/notification rules remain intact.

Verification uses isolated `build/b1-validation/` output, never a shared/MCP build or deployment. The dedicated B-1 suites passed 60 synthetic cases plus three source-boundary cases; the combined E-A/B-1 run passed 169 cases. Raw-length accessor injection and key-export accessor injection were each reproduced failing before their guards were added. With source/test hashes fixed, the final full unit regression passed 2,439 tests, zero failures/cancellations and two existing skips. The isolated build, no-emit typecheck and Bookmap's five Java classes/two Node tests also passed. Tests use Node 24.18.0 on this host; the package's wider Node/configuration matrix is not claimed qualified. The preserved 525 tracked files outside the scoped docs/boundary-test change, E-A implementation, shared R-D build, Dot PAUSED and full automation/condition hashes match the starting state. No signed fixtures/key files were persisted and no native read/qualification/test was performed. Independent review, native/runtime trust qualification, commit and distribution are outside this implementation step.

## B-1 Review Corrections

The pre-commit code review found one checkpoint chronology gap: E-A compared the ledger's final record time only with the final checkpoint. A genuinely signed prefix containing a record dated after `C0.observed_at` but before `C1.observed_at` could therefore pass both-checkpoint verification. That is inconsistent with the same prefix already being named by C0; it is not an actual storage observation or a market-timing issue.

The transcript verifier now requires every signed record's `body.at` to be no later than the first checkpoint observation, without relabeling E-A's evaluation time or changing its source. One synthetic regression reproduces the missing refusal before the fix and checks equality, one millisecond later and a later in-bracket time after the fix. The equality case remains valid; either later case refuses with `b1_checkpoint_prefix_clock`. This compares supplied signed timestamps only: native creation, current authority state and actual request timing remain unverified.

The review also traced fixed-key/domain/pin verification, wrapper-inclusive limits, byte-view isolation, numerical prefix ordering, challenge/role separation, E-A projection and the false-authority output boundary. It is a local code review, not a separately delegated independent review or qualification of native reads, other Node/provider profiles or production trust. The focused B-1 suites now pass 61 synthetic cases plus three boundary cases; the combined E-A/B-1 suite passes 170 cases. Signing remains restricted to public RFC test material in memory. No native open/test/build, signed-fixture persistence, MCP wiring, production enablement or real-data operation is added. Dot and all trading/notification/retention conditions remain unchanged.

With the corrected source/test hashes fixed, the fresh full unit run passed 2,440 tests, zero failures/cancellations and two existing skips. Isolated compilation, no-emit typechecking and Bookmap's five Java test classes/two Node tests passed. The 525 tracked files outside the scoped changes and the shared build match the review's starting hashes. Dot remains PAUSED and both the full automation and condition-prefix hashes are unchanged. Only the seven B-1/design/boundary-test files are selected for the requested local commit; no push or distribution is part of this review.

## B-1 Independent Review Corrections

A separate read-only review of `6d95d1b` found no must-fix or should-fix defect. Signature binding, domain separation, transcript logic and the E-A projection held under every probe. Four low-priority findings and three informational items were reproduced; together with two items from the committer's own check, they are corrected as follows:

1. **Weak keys.** The factory accepted a small-order public key. With the repository's pinned Node 24.18.0/OpenSSL 3.5.7, the identity point and a constant signature verified two unrelated messages, so record and checkpoint domain separation lost its meaning. Node 24.22.1/OpenSSL 3.5.9 rejected the same signature, so the outcome depended on the runtime. The factory now refuses all eight small-order encodings with either sign, and any y ≥ p, as `b1_public_key_weak`, before comparing the pin.
2. **Cross-realm shared memory.** A `SharedArrayBuffer` from another VM context passed the `instanceof` check. Rejection now uses the intrinsic `ArrayBuffer.prototype.byteLength` getter, which throws for shared memory from any realm, growable or not. A detached view now refuses at the intrinsic copy as `b1_raw_input_bytes` instead of surfacing a raw TypeError.
3. **Boundary tests.** They missed dynamic `import()` and aliased access such as `globalThis.Date.now()`, `Date()`, `globalThis['proc' + 'ess']` and `Function('return this')()`. The B-1 and E-A boundary tests now record literal dynamic imports and refuse these aliases. The old visitor missed all nine bypass snippets; the new tests assert that each is caught.
4. **Malleability coverage.** A canonical-scalar test now uses S + L (the group order) both on the RFC 8032 vector and through `verifyRecord`. This runtime already refused it, so this is coverage rather than a behavior change.

Informational and committer items:
- `encoded_sha256` now hashes the captured raw bytes rather than a re-serialization of the parsed object.
- The whole-transcript accounting refusal `b1_transcript_input_bytes` is now exercised: just inside the structural guard, the pins and request metadata push the charged total over the ceiling.
- A forged `KeyObject` refuses as `b1_public_ed25519_key_required` rather than with a TypeError.
- Tests import `nativeBarEvidence.js` through the selected (shared or isolated) build.
- Per-byte `Reflect.ownKeys` enumeration of every byte view cost about 1.8 s and +170 MiB for a 16 MiB transcript. It is removed: own properties are inert, because bytes are read only through intrinsics. A decorated view, including one with an own `byteLength` accessor, now verifies its actual bytes without invoking the accessor.
- Raw `JSON.parse`/UTF-8 errors quoted input bytes. Both the B-1 decoders and E-A's `decodeNativeBarAdmission` now refuse with coded errors (`b1_malformed_json`/`b1_invalid_utf8`, `admission_malformed_json`/`admission_invalid_utf8`).

Two results are left as documented limits:
- B-1 still accepts C0 and C1 at the same instant with zero-width brackets. B-3 must enforce actual read ordering.
- Non-literal dynamic imports remain statically unresolvable.

Seven new cases were added. Five fail on `6d95d1b`: weak keys, any-realm shared memory and decorations, inert accessors, and coded B-1 and E-A errors. S + L and the accounting case are coverage additions that also pass on `6d95d1b`. The E-A/B-1 suites pass 177 cases. With source/test hashes fixed, the full unit suite passed 2,447 cases, with zero failures/cancellations and two existing skips. No native code, runtime entry point or MCP wiring changed. This is not qualification of other Node/OpenSSL profiles, native reads or production trust. No push, signed-fixture persistence or real-data operation is included.
