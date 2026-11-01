# C2c Record, Initialization And Host Qualification

C2c-B1 commit review update, 2026-11-01 JST: the [commit review correction](NATIVE_BAR_ADMISSION_WORKER_PARSER_ACCEPTANCE_DESIGN.md#c2c-b1-commit-review-correction) adds exact-code single-gate tests with trials for the B1 gates that no test isolated, and makes the schema and unavailable-state tests assert their own code (tests 298 to 391; 140 to 185 of the same 192 independent mutants). The helper now refuses a tarball integrity, commit or package-tree digest shared by stream-json and stream-chain. Limits, C2c-A, shared helpers and seals are unchanged; Dot PAUSED, no operational action.

Commit authorization update, 2026-11-01 JST: the user approved the corrected C2c-B1 six-file commit after the reviews below. Its [authorization and verification checkpoint](NATIVE_BAR_ADMISSION_WORKER_PARSER_ACCEPTANCE_DESIGN.md) supersedes earlier uncommitted/no-commit-request wording. No push or broader execution is authorized; Dot and all existing conditions remain unchanged.

C2c-B1 review-correction update, 2026-11-01 JST: [seven original findings, an additional re-review P3, corrections and memory verification](NATIVE_BAR_ADMISSION_WORKER_PARSER_ACCEPTANCE_DESIGN.md#c2c-b1-independent-review-corrections) use `c934aa2`, preserving its fixed-role identity and transient-overlap corrections. One pure helper/two tests are corrected; two final independent re-reviews report no remaining actionable findings and no commit is requested. New tests 298/10 and existing selected 12 files 1041 pass, total 1349, with no failure/cancellation/skip. This is supplied-summary consistency, not candidate-parser acceptance or runtime qualification. The evaluation tuple stream-json 3.8.0 / stream-chain 4.4.1 is not adopted; real integrity/immutable commits/distributed files/full closure, initializer outcome and bounds remain unverified. Acquisition, candidate import and real parser execution on invented bytes each remain separately gated. No existing C2c-A/shared helper, dependency, worker/runtime, limit, judgment/notification setting or operational seal is changed; Dot remains PAUSED. The initial-design and C2c-A historical checkpoints below retain their original scope and counts.

Status: **C2c-A independently reviewed/corrected, committed as `e2730ad`, corrected after commit review and memory-tested; C2c-B1 committed as `2d981f0` and corrected after commit review; remaining B/C/H/J pending**, 2026-11-01 JST, source baseline `76c618b`, commit-review correction baseline `e2730ad`. The [commit review correction](#c2c-a-commit-review-correction) supersedes the counts of the [review correction](#c2c-a-independent-review-and-corrections) and enforces the transient sentence in Capacity And Work as a blocker; that review correction superseded the initial [implementation checkpoint](#c2c-a-implementation-and-memory-verification), including its counts and pending-review statements. The C2c-A and C2c-B1 reviews and commits were each separately approved. This refines [C2 startup](NATIVE_BAR_ADMISSION_WORKER_STARTUP_CONNECTION_DESIGN.md), including its latest commit-review correction, without qualifying C2c runtime. Existing C2b entry, policy, work, startup/disposition and C3 refusals remain closed. C2d and C3/C4 remain separate. The initial design below does not authorize any broader implementation or execution.

No real port/clock/timer, build, child process, native read/load, fixture operation, signature/key operation, real-data operation, MCP registration or production activation is authorized. Dot stays PAUSED. Judgment, observation bands, confirmation counts, notification/mail, retention and all existing resource/time ceilings are unchanged. Inspection below is of repository text, not a readback of a build record, addon or host qualification.

## Findings In The Current Source

| Area | Source fact | Unresolved obligation |
|---|---|---|
| Record producer | `saveOriginalBuildRecord()` in `test/helpers/unsignedCohortRuntime.mjs` writes `canonical(record) + LF` as one `native-bar-cohort-private-build-v1` document, at most 4194304 bytes | A qualification page model is not a paged disk format. No worker parser exists for this document within the existing envelopes |
| Manifest | `inputs` and `artifacts` each contain rows and a digest. Their combined row encoding is limited to 2097152 bytes / 4096 rows | Do not retain both complete arrays plus parsed objects, canonical copies and incoming pipe buffers |
| Role vocabularies | The runtime writer uses input role arrays including `compiler_dependency` and output `mode/kind`; the qualification model has a different role vocabulary | Define an explicit writer-to-closed-set mapping. Neither blindly reuse the model schema nor silently add accepted roles |
| Record identity | Writer records path, device/inode/uid/gid/mode/size/nlink/mtime/ctime and SHA-256; aggregate digests accompany rows | Hash equality is not metadata/ACL safety, exact membership, module resolution or freshness |
| Reader | `src/nativeBarAdmissionReader.ts` creates a top-level `FinalizationRegistry`; its addon require is lazy inside `beginRead()` | Import allocates state but does not itself begin a fixture read. Finalizer registration and any cleanup are separate future events |
| Joint reader | `src/nativeBarAdmissionJointReader.ts` captures Date/hrtime/randomUUID and imports timer functions at module initialization | Capture is not sampling, scheduling or UUID generation, but cached identities and later use must be inventoried |
| Registry | `src/nativeBarAdmissionOracleRegistry.ts` imports pid and creates WeakMaps/Sets and counters | Per-process singleton/cache identity is required; no bootstrap, owner claim or enrollment at startup |
| Owner helpers | `fixedMemoryCheckpointOracle.mjs` and `unsignedCheckpointOracle.mjs` read environment selectors and perform top-level awaited compiled imports; the fixed helper captures Date methods and hashes a public-key fingerprint | Neither helper is an effect-free namespace. No helper import is currently permitted by the fake-only approval |
| Native initialization | `NAPI_MODULE_INIT()` calls `rparser_init()`, captures `JSON.parse` in N-API instance data and defines all native methods, including maintenance methods | Native module load and initializer effects need independent approval/review. Protocol info alone does not qualify them; expose only the eight admission functions through the private facade |
| Host checks | Runtime `qualifyMetadata()` runs `/bin/ls -lde` and `-ldeO`; `verifyOriginalHostClosure()` and `verifyOriginalNativeProfile()` still unconditionally refuse | Parent metadata subprocesses cannot be copied into a worker that forbids child processes. No worker-local host/ACL/native-profile producer exists |
| Closure discovery | Runtime closure traversal resolves literal specifiers; dynamic `new URL(...)` owner-helper imports and package conditions need additional treatment | A textual aggregate or the old isolated artifacts do not establish the exact future worker dependency graph |

These are prerequisites, not newly observed market events or defects to repair in this design-only change. The C1 withheld-READY ordinal issue and the documented C1/C2b behavioral differences are not changed.

## Decisions And Explicit Gates

Recommended direction:

1. Preserve the v1 on-disk record and its 4 MiB ceiling; use an established incremental JSON tokenizer with a bounded schema projection, not a handwritten tokenizer or whole-record `JSON.parse`.
2. Qualify parsing, module initialization and host provenance separately. A supplied consistency result never becomes a private startup capability.
3. Refuse before the next acquisition/import when any prerequisite, capacity, cost or original disposition is unknown. A partial implementation must not emit READY.

Still requiring an explicit decision/approval:

- **Parser dependency:** select and pin an exact package/release, transitive files and package metadata after source/behavior review. No dependency is installed or vendored here.
- **Record-language bounds:** derive field, token, nesting, node and module-set maxima from the current writer. If an added bound excludes a record the current writer can emit, stop for explicit contract/format approval; do not disguise a lower record ceiling as safety validation.
- **Host bootstrap:** identify a trusted, read-only, no-subprocess producer that can qualify namespace/ACL/native-load conditions before loading the candidate addon. Its binary origin and loader trust cannot be certified by that candidate addon itself.
- **Loader stability:** decide and justify how an inspected artifact is the one Node/dyld executes. Hash-then-import and metadata rechecks alone do not defeat a hostile concurrent same-uid writer.
- **Initialization profile:** approve an exact role-tagged closure and effect manifest, including unavoidable native initialization. No broad permission to import arbitrary project or package modules is granted.

Until resolved, each gate reports unavailable. A new record format, preinstalled native bootstrap, extra descriptor/channel, changed launch payload or stronger host assumption is a separate proposal, not authorized fallback.

## Record Reader Contract

### Binding And Files

The private worker derives only the fixed build root and selected normal/ubsan layout from its original invocation. LAUNCH supplies expected digests, never paths, descriptors, parser settings or callbacks. One original startup reference owns one record-read attempt and every acquired descriptor. Parent/session PID, serialized receipt, a parsed object or a supplied `matched` bit cannot recreate it.

Require a qualified anchored directory chain, no-follow child traversal, type/ownership/mode/link-count/ACL/flags checks and file-size bounds before consuming bytes. `O_NOFOLLOW` on a final path is not an ancestor traversal proof. Node path-based `lstat/open/fstat` checks alone do not supply the missing descriptor-relative namespace producer. No generic filesystem or maintenance facade may fill this gap.

Capture original handle, pre-read identity, read offset, bytes admitted, per-operation reservation and first failure before another action. Short positive reads advance the same handle/offset; zero before the expected end, extra bytes after it, nonregular files, alias/role duplication, identity changes and unknown close stop. Do not reopen, retry a failed read or mark an uncertain close released. Read-only operations may update OS access metadata; future operational approval must state this rather than promising zero filesystem effects.

### Parsing And Canonical Bytes

The parser adapter must establish all of the following, not merely return a valid object:

- Exact original bytes, including the final single LF, match LAUNCH's record SHA-256. Reject BOM, CR, additional roots, comments, trailing material and invalid/truncated UTF-8 without replacement-character repair.
- JSON grammar belongs to the established tokenizer. The schema adapter enforces the writer's root, required/unknown keys, field types, finite/canonical numbers, canonical string escapes, duplicate keys and strictly increasing object-key order using the existing JS key comparator, not locale sorting.
- Validate before unsafe numeric conversion. Identity/counter decimal strings remain exact. Reject alternate numeric spellings that canonical re-encoding would change; do not accept Infinity after overflow or erase a duplicate via ordinary object assignment.
- Derive limits for tokens, stack depth/nodes, partial UTF-8/surrogate state, scalar scratch, current row and tool-plan arrays before enabling the parser. Bound allocations inside the package, not only emitted token counts. Setting a parser's buffer-size option is not proof of a maximum.
- Project one row at a time. Validate both manifests and every field, including unselected-mode rows; discard nonessential values after their contribution to exact subset digests/membership checks is known. No silent skipping of unknown sections or whole-manifest assemblers.
- Reproduce `inputs.sha256`, `artifacts.sha256`, role-tagged sets and the ten LAUNCH artifact correlations from their actual defined preimages. Compare source commit, selected mode, build profile and exact expected members. The record does not contain every LAUNCH field: do not invent run/nonce/template preimages or equate `status_sha256` with a patch digest.

Canonical validation needs an explicit raw-byte strategy. Proposed qualification candidate: a streaming encoder driven by validated tokenizer events, compared byte-for-byte against a positioned reread of the **same original descriptor**, with bounded pages, identity checks and EOF verification. Hash the original record independently. This avoids a full raw/parsed/canonical triple and does not change the disk format. It is not implemented or proven to fit: decoded-string chunk boundaries, escaping, number spelling, parser read-ahead, comparator lag, second-pass work and mutation between passes must be tested. A pair of equal hashes must not be mislabeled an exact byte comparison.

If this cannot fit or preserve the full writer language, leave `record_reader` unavailable. Alternatives such as a paged record/sidecar or reduced scalar language require explicit format approval, revised writer/reader binding and fresh artifacts; do not add them automatically.

### Candidate Assessment, Not Selection

Two primary-source candidates were inspected as documentation only:

| Candidate | Useful documented property | Qualification blocker |
|---|---|---|
| [`stream-json` Parser](https://github.com/uhop/stream-json/wiki/Parser) | Streams keys, strings and numbers in chunks; packing can be disabled | Verify exact pinned version, grammar/error/finalization behavior, strict UTF-8/BOM policy, internal queues/read-ahead and dependency initialization. No assembler/JSONL mode for this single large record |
| [`@streamparser/json` Tokenizer](https://github.com/juanjoDiaz/streamparser-json/blob/main/packages/plainjs/README.md) | Plain-JS tokenizer API with partial-token and number-conversion hooks | Documentation says complete scalar values are accumulated. Prove internal retention limits; `stringBufferSize`/partial events alone do not establish bounded memory |

The first is the initial evaluation candidate because primitive chunking matches the required projection; it is **not yet adopted or qualified**. Documentation claims do not prove canonical, duplicate, adversarial-memory or deadline properties. Record the selected release/commit, integrity, licenses, runtime entry and complete closure before a later dependency approval. No moving branch URL is a production pin. Node filesystem semantics are referenced from the [fixed v24.18.0 documentation](https://nodejs.org/download/release/v24.18.0/docs/api/fs.html), not treated as an ACL or loader-attestation API.

## Initialization Effect Manifest

One immutable plan enumerates each source/compiled file and package entry by selected mode, normalized fixed path, role, source/artifact digest, import kind, ordered direct dependencies, allowed exports and phase-specific effects. ESM and CJS package conditions, re-exports, top-level await and dynamic URL imports are explicit edges. Traversing all branches of an environment selector is not authorization to load them. Reject extras, missing members, duplicate/aliased identities, selected-mode disagreement, uncertain package resolution, existing conflicting cache and lazy GO-only imports.

Classify effects rather than giving modules one boolean `pure` label:

| Class | Treatment |
|---|---|
| Literal/schema/function creation, bounded maps and public fingerprint hashing | Account allocation/hash work and retained module state; no runtime authority |
| Capturing pid, Date/hrtime/randomUUID/timer identities | Inventory exact references; no sampling/generation/scheduling during import, no global monkeypatching |
| FinalizationRegistry creation | Account original registry; no registration/native resource at startup; GC cleanup is not a disposition proof |
| Environment selectors and top-level awaited imports | Require exact original selected mode and fixed resolved compiled targets, no default `build/` fallback in the worker path |
| Addon/dyld/N-API initialization, JSON.parse capture | Explicit host-qualified effect profile before invocation; unknown initializer/load behavior refuses |
| Owner enrollment, private/public key construction, signing, native begin/open/read, fixture/filesystem writes, child/network/timer activity | Forbidden during startup; obtaining a namespace does not permit calling these functions |

The two existing owner helpers expose callable key/signature or oracle behavior for later phases. Import them only after the entire exact initialization closure is qualified, before READY, retaining namespaces without invoking enrollment. Only `enrollFixedMemoryCheckpointOracleC0Only` and the fixed unsigned-owner export may be retained for future dispatch. Never route the unrestricted fixed-owner export. An eventual need to split environment resolution from helper initialization is a narrowly reviewed source change, with fresh closure/pins; this design does not edit existing helpers.

The native facade owns exactly `info`, `beginAdmissionRead`, `openAdmissionReadPair`, `admissionInventory`, `readAdmissionEvidence`, `verifyAdmissionInventory`, `closeAdmissionInventory`, `closeAdmissionRead`. Capture their original receivers and functions, forward once, preserve original return/throw and latch observation failure without re-calling. Info may verify protocol 6 / synthetic_only only after load prerequisites; it is not a native read, resource-baseline or host-attestation substitute.

CJS ownership requires the exact resolved addon filename, Module object, exports descriptors and function identities. ESM has a separate module map: do not promise to erase it by deleting `require.cache`. Install the admission-only facade once before the lazy reader could load the addon. Keep it across READY and through later original preparation/read disposition. Restore only the exact owned facade after known disposition; never overwrite foreign replacement. Uncertain load/import/install/restore remains retained and cannot be retried or reported unloaded. C2c failure does not manufacture a reusable second invocation.

## Host Qualification And Trust Boundary

Split the obligations; none may be inferred from the others:

1. **Namespace/access:** anchored directory and original descriptor identities; ownership, modes, ACLs (including inherited allow), flags, link counts, volume/profile and change detection.
2. **Launch/runtime:** exact Node executable/ABI/architecture, allowed process flags/environment and selected-mode resolution; no preload/loader/permission-policy surprise. Merely reading `process.version` is not binary provenance.
3. **Native/module load closure:** addon image, architecture/profile, dynamic/system libraries, package resolution and initialization effects, bound to exactly what will be loaded. `linker_adhoc` is not application signing or independent signature verification. The existing Mach-O header inspector alone is not a complete load-closure proof.
4. **Original lifetime/freshness:** worker-local original action, clock domain/generation, file/loader epoch and still-current producer reference. Parent observation time cannot be translated into worker time or replayed as a current fact.

Node's ordinary filesystem metadata does not supply the required macOS ACL/loader proof. Current `/bin/ls` qualification uses subprocesses and remains a parent-side method only. Existing native ACL routines are behind the candidate addon and operate in fixture/session contracts; they are not a trusted bootstrap for loading that same image. Do not invoke generic `nativeBarFs` maintenance functions or run codesign/otool/ls in the worker as a fallback.

Proposed future solution boundary is a separately reviewed **read-only trusted bootstrap bridge** capable of descriptor-relative traversal/ACL/flags and original load-closure facts without a worker subprocess. Its origin must be qualified before candidate loading by an approved Node/OS/launcher trust root, not a record supplied by the candidate, a copied DTO or the candidate's self-report. How this bridge is delivered, kept within the existing process/FD/work envelope and matched to actual loader bytes is unresolved. Adding a binary, preload, descriptor handoff, IPC channel or assumption of immutable deployment needs separate approval. If unavailable, startup refuses; C2c does not relax the host model to make progress.

The controlled-local-OS assumption already named in source is a limitation, not proof against hostile root/same-uid mutation. State exactly which writers/loader substitutions are excluded and which changes are checked. Parent build receipt and worker-local observations can be correlated but cannot impersonate each other's trust/clock domain. No host evidence is persisted in this design step.

## State And Disposition

Proposed private progression: `NEW -> PRECONDITIONS_KNOWN -> RECORD_OPEN -> RECORD_VALIDATED -> CLOSED_SET_MATCHED -> INITIALIZATION_QUALIFIED -> MODULES_ACQUIRED -> CACHE_BOUND -> STARTUP_PROOF`. These are internal states, not new wire messages or public authority flags. Parsing may construct a quarantine-only projection before final hash/canonical/identity checks; no row/path from it authorizes an import or native load.

The initial preconditions include known budgets and a qualified bootstrap/record/parser closure; final module/native qualification precedes each relevant import. Emit one unforgeable proof in the existing private WeakMap only after all gates, known outcomes and original checkpoints pass. Bind owner, exact original LAUNCH binding identity, selected mode, protocol/native profile, record/closure/host plan and one consumed bit. DTOs and supplied plan completeness never mint it. READY still belongs to C2b's original callback/boolean-return protocol.

Before every effect and after each synchronous return/await, check the original session, first-stop latch, time, lifetime refs, work ownership and acquisition generation. Store returned resources before another checkpoint. Unknown import completion, partially returned handles, failed close and uncertain cache ownership retain originals; known refusals before acquisition are distinguished from unknown outcomes. Stop closes known owned record resources once; an import cannot be cancelled/unloaded by inference. Late completion may settle original obligations only, never restart progress. No grace window, new timer slot, force exit or replacement import/read is added. Keep C2b's corrected FAILED decision based on its own stream/return/callback/time facts.

## Capacity And Work

Unchanged ceilings: record 4194304; combined manifest 2097152; 4096 rows / 64 pages / 128 rows per page / 65536 page bytes; hash buffer 65536; per-file 67108864; pass 268435456; retained buffers 2375680; transient buffers 4259840; wire 65536 x 32; configuration 60000; helper/status 10000 ms; preparation 120000 ms; case-fit 900000 ms; one phase plus one operation timer; total hash work 2147483648 and helper commands 131072.

The profile's page limits describe supplied qualification, not disk chunks or mandatory parser packing. A row never requires keeping an entire 2 MiB array. Do not add unused maxima as independent spendable memory. For each reachable phase calculate simultaneous live buffers:

`peak = decoder + pending_PREPARE + retained_status_lines + record_input_page + canonical_compare_page + UTF8/token_scratch + current_row + retained_membership_projection + hash_scratch + parser_queue_copies`.

Use original lifetimes, alias/ownership and peak overlap, not summed file sizes. Account parser-owned JS strings/token arrays/module state separately as explicitly bounded or unqualified heap; encoded-buffer arithmetic is not total V8/native/RSS measurement. The C2a transient reservation already reaches 4259840; no additional transient scratch fits until non-overlap/reuse is proved. Existing 393216 retained reservation and 3260/7645 diagnostic figures are not a C2c capacity result. The 65536 parent wrapper still requires recomputation in composition; do not store full rows/record/paths in diagnostics.

Define a disjoint work schedule for every pass: raw-record hash including LF, exact comparator reread, subset/role digest bytes, artifact rehashes, native/profile metadata, package/module checks, initialization fingerprint and all helper/timer registrations. CPU/token/compare and I/O work need named operation/byte bounds even when they do not hash. A read allocation must be reserved before reading/decoding/hashing; parser output cannot grow an unreserved queue. Known excess refuses before action; unknown cost stays null; failure never refunds consumed work.

C2a currently ties per-start `work.record_bytes` to the record size. Do not change that meaning to hide multiple passes. Record any additional hash work explicitly in the existing `other_hash_bytes` with a checked per-start/per-mode breakdown in the new pure plan, without double-counting it in module/pin/metadata costs. If that mapping cannot express the actual schedule, propose a separate schema change. Include all 24 starts (12 per mode), existing wire/subject costs and failure paths; a cohort lower bound can already exceed the unchanged total and refuse. No successful total or runtime cost is asserted here.

## Implementation Slices And Acceptance

Each row requires separate approval. These names subdivide C2c, not new operational stages.

| Slice | Deliverable | Excluded and completion gate |
|---|---|---|
| **C2c-A, recommended next** | Pure prerequisites/record-projection/effect-manifest/host-evidence consistency contracts, state/disposition model, disjoint capacity/work planner; memory-only tests | No tokenizer dependency/actual parse, connection code, filesystem/host reads or imports of owner/compiled/native modules. Runtime producers remain unavailable; flags stay false |
| **[C2c-B](NATIVE_BAR_ADMISSION_WORKER_PARSER_ACCEPTANCE_DESIGN.md)** | Proposed fixed evaluation tuple; B1 pure pin/acceptance plan, B2 dependency receipt/static audit, B3 raw-parser tests, B4 schema/canonical memory tests | Every sub-slice needs separate approval. Tuple selection is not verified SRI/commit, initializer approval or dependency adoption. No original IO/native/host proof or runtime grant |
| **C2c-C** | Exact initialization/selected-mode/cache contracts and fake-only private connection tests; reconcile closure discovery and owner import effects | Connection edits separately approved; use invented namespaces/cache entries, never import actual owner or addon code. Unresolved host gates still refuse |
| **C2c-H** | Review the trusted-bootstrap and actual loader-binding design, then separately approved implementation/synthetic verification | No bootstrap binary/API or host assumption is approved here. Must resolve trust circularity and no-subprocess geometry before any candidate load |
| **C2c-J** | Sealed original record/pin/import/cache/startup-proof/disposition integration with all prerequisite producers, fake-only tests | No operational run. Producer/format/closure/host/work approval blockers must be explicit; missing components continue to refuse. No C3 or enrollment |
| **C2d, later** | Original worker startup memory composition and parent compatibility, including documented C1 differences | Not full preparation/GO/native execution or operational qualification |

### C2c-A Concrete Scope

Proposed new helper `test/helpers/unsignedWorkerRecordInitializationContracts.mjs` and memory/boundary tests; documentation updates only otherwise. Proposed exports: `planUnsignedWorkerRecordInitialization`, `describeUnsignedWorkerRecordInitializationCapacity`. No parser/tokenizer, runtime registry, capability issuer, effect callback, path resolver or connection change in A. Reuse existing pure bounds/hash/label parsing; do not pass a 4 MiB record to the generic supplied-object parser.

Inputs are bounded summaries/rows in explicitly bounded pages and costs, complete expected C2a binding/digests, a selected-mode role/effect plan, supplied host observations with source/scope/identity and unavailable/consistent/refused dispositions, and original supplied phase/generation facts. Preserve opaque missing preimages and distinguish unknown from zero. Runtime bridge and parser profiles start unavailable. Per-row/schema maxima unresolved by the writer audit remain blockers, not fabricated numbers. A caller cannot supply a function, native handle or `qualified: true` to bypass them.

Outputs include exact schema/encoded-view inventory, first refusal or explicit blockers, supplied-consistency state, original resource/disposition summary, phase-specific buffer overlap, known lower bounds and nullable complete cost totals. Every output keeps `native_status: NOT_RUN`, `runtime_completion_proven: false`, `execution_available: false`; no live startup proof or READY grant is returned even if every supplied comparison matches.

A acceptance: strict unknown-key/type/mode/binding checks; writer/model role mismatch stays explicit; missing parser/bridge/loader/heap profile stays blocked; row/byte/page boundaries and unknown costs; no refund; read-before-reservation refusal; canonical-vs-hash distinction; stopped/late/foreign/unknown outcomes cannot recover; original cache replacement is never overwritten; independent peak/work arithmetic includes all starts and prior reservations. Pin imports/exports/seals and use independent successful controls plus targeted mutations. Deny low-level reads, subprocesses, ports, clocks/timers, native loading, owner imports, key/signature and mutations before target dependencies, as in corrected C2b tests. No real tools/builds are run to obtain a test total.

### Later Acceptance Families

Before declaring C2c integrated, require evidence for: every byte split of representative UTF-8/escape/number tokens; malformed/duplicate/noncanonical/truncated/maximal inputs; unexpected role or package edge; strict raw/semantic/subset digest separation; no full-record retention; short/late/foreign reads and failed close; ACL/ancestor/loader changes; pre-cached/foreign module and native initializer errors; mode fallback refusal; unavailable work and deadline equality; stop during each acquisition/import/install/restore; exact once-only original calls and receiver/outcome preservation; unused maintenance/owner/key functions never invoked; late completion retention and original proof once-consumption; parent-compatible READY/FAILED/PREPARE schedules. Memory tests do not close real host/native/OS qualification.

## Initial Design-Step Verification

Only repository/document reads and documentation edits were performed. No parser package was installed, no target/owner/compiled/native module was imported and no build/test/operational suite was executed. Text/diff/link checks and the read-only Dot configuration check are design verification, not memory-test, parser or host acceptance. No commit or push is requested in this step.

## C2c-A Implementation And Memory Verification

2026-11-01 JST, after separate approval, initial checkpoint only. The review section below supersedes the 86/4 and 984 counts, twelve/five mutation figures and pending-review statements here. Added only `test/helpers/unsignedWorkerRecordInitializationContracts.mjs` and its memory/boundary tests; existing helpers, worker/runtime, source, package/lock files and automation configuration are unchanged. The two designed exports remain the only public surface. There is no tokenizer, record parser, filesystem/native reader, executable adapter, capability registry or issuer. Existing data/Zod, C2a startup and qualification-profile helpers are the complete direct dependency inventory.

### Concrete Supplied Contract

- Strict input groups: C2a startup subject, supplied session/generation, eight prerequisite dispositions, one record-summary page, selected-mode module/effect summaries, source/scope/identity/domain-bound host summaries, disjoint per-mode costs and phase-specific memory reservations, and a bounded event sequence. Functions, accessors, raw record content, unknown fields, invalid roles and foreign module edges refuse. Source/identity/path hashes are correlations, not original handles.
- One projection has at most 128 rows, and one module summary at most 128 nodes; events use the existing 128-event trace bound. These bound this model input, not the v1 record language or the future runtime's accepted closure size. A 4194304-byte record summary is tested without allocating or parsing that record. Compiler-dependency input roles remain writer vocabulary; unresolved translation is a separate `role_mapping` gate, not a change to qualification-model roles.
- `module_projection_sha256` hashes the supplied module/effect summary. It is not substituted for the build's actual module-set digest, raw record hash or source provenance. Canonical `hash_only` never satisfies the separate `exact_supplied` comparison field. Parent/self-reported host data cannot satisfy the worker-source consistency gate. Every such comparison remains supplied-only.
- Missing parser, writer-language, role-mapping, initialization, host-bridge, loader-binding, heap or cost profiles remains an explicit blocker. Matching supplied profiles can complete a hypothetical plan but cannot qualify any real producer. All outputs retain NOT_RUN, unavailable runtime producers and false execution/proof/signing/evidence flags.

### State And Accounting

The pure planner replays bounded facts; it does not expose an event callback or keep a live registry. A complete supplied plan starts PRECONDITIONS_KNOWN, then processes record-open/validation/closed-set/initialization/modules/cache/completion in order. Each step requires one exact supplied cost reservation before its modeled begin, and one original session/generation/action. Reservation and begin are separate. Step deadlines borrow at most 10000 whole milliseconds from the unchanged original preparation end; begin/result never renew them. Foreign, null/backward clock, lost lifetime reference, late, refused or unknown facts latch the first stop.

STOPPED never returns to progress. A late known result of the original unknown acquisition can settle that resource to owned/absent without completing another step. Known-owned record/cache disposal has one modeled begin and result; unknown close remains retained. Foreign cache ownership cannot be restored or overwritten. No actual descriptor/cache/function is accepted or touched. `SUPPLIED_COMPLETE` is deliberately not STARTUP_PROOF, READY or runtime completion. Static `supplied_plan_complete` describes prerequisite/cost consistency separately from the event model's stopped/completion state.

Per-mode step sums are reconciled with C2a's single-record charge and explicit extra record/subset/initialization hash costs; additional whole-record hashes are exact multiples of record size. Extra work maps to `other_hash_bytes`/helper totals, without rebilling record size or hiding unknown costs in an aggregate. All 24 starts and existing subject/wire reservations remain counted. Known lower bounds use the greater of C2a and step breakdowns; an unknown C2a module cost cannot hide a known excessive step. Each startup's read-pass lower bound also respects the existing 268435456-byte ceiling. Failure never refunds reservations. Parser work units are supplied bounded byte-work estimates (at least one per declared record byte), not observed tokenizer counters or a newly qualified CPU profile.

Phase-overlap plans sum distinct named buffers and take peaks over phases, refusing known excess even beside null costs. Unknown overlap keeps complete peaks null. Existing decoder/pending-input/status floors and record-validation scratch floors prevent zero-cost invented slots. The successful small invented schedule has **289792 retained / 0 transient encoded-buffer reservation bytes**, not measured process memory. Exact existing 2375680/4259840 ceilings and one-byte-over refusals are tested; no new spare space is inferred. Parser heap, actual copy lifetimes, native/module memory, full composition and the parent wrapper are still unqualified.

### Verification And Remaining Work

Node 24.18.0, one file per `--test --test-isolation=none` invocation:

| Files | Passing tests |
|---|---:|
| New record-initialization / boundary | 86 / 4 |
| C2b connections / boundary | 94 / 4 |
| C2a startup / boundary | 85 / 5 |
| C1 preparation / boundary | 158 / 5 |
| Controller / boundary | 209 / 14 |
| Transport / parent composition | 250 / 70 |
| Total, 12 files | 984 |

No failures, cancellations or skips. Twelve behavior mutants have successful unmodified controls and syntax-checked unique substitutions. Seventeen worker-contract/source mutations and five independent guard-inventory deletions are detected. The memory harness denies low-level reads, ports/constructors, clocks/timers, subprocess/native/key/signature/data effects before loading target dependencies; it uses a readSync sentinel and independent required-sink inventory before safe probes. Only allowlisted UTF-8 source reads are permitted for module/source loading. Source inventories are scoped regression checks, not a proof against every possible JavaScript escape.

The two lower-bound/read-pass omissions were first reproduced by failing tests, then corrected. Fixture input mistakes were corrected without loosening contracts. The maximal plan's **7546 encoded bytes / 16384** is checked field-by-field against every partial progression and representative stopped/unknown views, independent of the caller's event count/boolean state. This reserves only plan diagnostics, not the entire capacity report or a parent/C2a/C2b composition wrapper; no V8/native/RSS bound or live provenance is claimed.

Next: independent C2c-A review and any separately requested commit. Parser dependency/real parsing, connection code, actual module/native loading and trusted bootstrap/loader qualification remain separately gated. No real port/clock/timer, build, test-runner child, native read, fixture/signature/data operation, MCP registration, production activation, commit or push was performed. No full unit/effectful suite was run. Dot remains PAUSED with its full configuration hash unchanged; judgment/notification and existing limits remain unchanged.

## C2c-A Independent Review And Corrections

2026-11-01 JST, user-requested review of seven uncommitted C2c design/implementation/test files on `76c618b`. Two read-only reviewers covered supplied contracts/state/disposition and capacity/work/test boundaries respectively. Their static final delta reviews report no remaining code/test findings. A P3 stale-documentation observation is resolved by this superseding checkpoint and the explicit historical labels above. The implementing session alone ran memory-only tests; no reviewer executed the target or operational tools.

Seven distinct P2 findings from the independent reviews, plus one P2 found during integration, were corrected within the new helper/tests:

1. **Close checkpoint:** a null/foreign/backward clock or current lost/unknown lifetime reference could itself stop the model, then immediately permit a new close. New close begins now require a non-invalid original clock and current referenced pair. Healthy original cleanup after phase expiry is still allowed without a new window. Results of already-started closes remain settle-only even after an invalid checkpoint; a later healthy timestamp cannot undo a sticky clock fault.
2. **Costs after their consuming stage:** an initialization hash reservation could move to `complete` with unchanged totals. Stage floors now bind metadata hashing to record-open, module/pin hashing to closed-set, and initialization hashing to initialization. Record validation retains its existing raw/subset/extra-pass floors. This does not change any overall ceiling or charge record size twice.
3. **Supplied page limits:** a globally valid page could exceed C2a's smaller supplied `page_rows` or `page_bytes`. Both supplied per-page bounds are now checked in addition to global bounds and canonical projection size.
4. **Direct LAUNCH pins:** changing both a module artifact and its local expected artifact could evade comparison with a corresponding LAUNCH pin. Addon artifact and reader artifact/source digests now bind directly to their existing LAUNCH fields. Aggregate module/JS-set digests and the pure module-projection digest remain distinct; no unavailable preimage is invented.
5. **Known manifest pass bound:** individually valid 64 MiB file rows could establish a page lower bound above the unchanged 256 MiB pass ceiling while declared read costs stayed small. The page's known file-size sum now refuses that overrun even though a single projection is not the whole manifest.
6. **Guard routes:** available lchmod/lchown sync/callback/promise mutations are denied. Async `fs.open` and `fsp.open` are fully denied rather than returning an unguarded real FileHandle from an allowlisted source path. Source loading retains only the existing narrow path-checked UTF-8 read/openSync path. The independent sink inventory and source-removal controls include these routes before any safe probe; no original mutation or FileHandle read was used to test them.
7. **Masked aliases:** the previous duplicate-row case failed a row-count check before either alias gate. Two otherwise-valid subjects now independently duplicate path or identity digest, assert the exact refusal, and detect deletion of their own alias guard.
8. **Unbegun reservation retirement (integration):** stop after reserve but before begin left the modeled action active forever, although no acquisition had begun. Stop now retires only that unbegun active reservation while preserving its action record and spent costs. Unknown begun acquisitions still retain their original obligations; no retry or refund is introduced.

Twelve failing cases reproduced the helper defects before correction: two close checkpoints, three stage-floor shifts, two page-bound mismatches, three direct-pin mismatches, one manifest pass overrun and one unbegun reservation. Alias/guard coverage additions are not claimed as previously observed runtime failures. Additional positive controls preserve expired healthy cleanup and late close settlement. All operations and facts in these cases are invented data; no live cleanup is performed.

Fresh verification, Node 24.18.0, separate `--test --test-isolation=none` invocations:

| Files | Passing tests |
|---|---:|
| Record-initialization / boundary | 102 / 4 |
| C2b connections / boundary | 94 / 4 |
| C2a startup / boundary | 85 / 5 |
| C1 preparation / boundary | 158 / 5 |
| Controller / boundary | 209 / 14 |
| Transport / parent composition | 250 / 70 |
| Total, 12 files | 1000 |

No failures, cancellations or skips. **25 behavioral trials** (12 initial plus 13 targeted new trials) detect their mutations after successful controls and unique syntax-checked substitutions. **26 static mutations** comprise 17 contract/source mutations and 9 guard/inventory removals. Missing anchors, compile/setup failure or unrelated masking are not accepted as killed behavior mutants. Maximal plan diagnostics remain **7546 / 16384 encoded bytes**; the successful small invented buffer reservation remains **289792 retained / 0 transient**. These are not real parser/heap/native measurements, a complete manifest proof or a parent-wrapper calculation.

Only these seven C2c files are included for the requested conditional commit. No shared helper/model, existing worker/runtime, source, package/lock, automation configuration, judgment/notification rule, resource/time ceiling or operational seal changes. Parser/dependency adoption, real parsing, connection code, real ports/clocks/timers, build/subprocess/native read, fixture/signature/real-data operations, MCP registration, production activation and push are not performed. Dot remains PAUSED with its full configuration hash unchanged. Full unit/effectful and operational suites remain unrun; later C2c-B/C/H/J and C2d approvals are still required.


## C2c-A Commit Review Correction

2026-11-01 JST, review of `e2730ad` against the code. In `git archive` copies the commit passed 29 related files / 1647 tests in every condition: Node 24.18.0 three times, linux/win32 platform spoofs, Node 20.19.6/26.12.1, isolation=none and CRLF. Its full unit suite passed 5172 of 5174 tests on Node 24 and Node 20, with no failures or cancellations and the 2 existing skips. Every probe of the reviewed paths returned the intended refusal code or stop reason, so no helper defect was found there.

Findings, all in the tests unless noted:

- P2: The state tests fed foreign-session/epoch, foreign-clock and lost-lifetime facts as `stop` events, which stop the model by themselves. Each of those gates could be removed with all 102 tests passing. So could:
  - the reservation gates: planned cost, step order, an active reservation, a reused action id and a sub-millisecond window;
  - result before begin;
  - the close gates: close before stop and close of an unowned resource.
- P2: Projection and role-mapping gates were not tested one at a time:
  - record bytes, rows, pages and manifest bytes against C2a;
  - page rows above record rows and page bytes above manifest bytes;
  - canonical projection size and generation zero;
  - input-row mode and roles, and artifact-row mode, role count and role.

  The invalid list asserted only that something threw. The "record size" case was actually refused by the record-hash cost floor, and "duplicate step" still passed through a TypeError when its own gate was removed.
- P2: Several gates had no blocker or refusal test at all: host namespace/ACL/launch/native-profile/loader statuses, record identity/membership, the artifact subset digest, the unsigned-owner export restriction and unknown helper/parser/hash costs.
- P3 (design and helper): Capacity And Work says no additional transient scratch fits beside C2a's 4259840-byte reservation until non-overlap is proved. Yet the planner accepted a full-ceiling C2c transient as complete, a test asserted it, and the reported transient peak omits C2a's receive copies.
- P3 (helper): Distinct fixed roles with identical artifact digests were accepted, and the fixture used one digest for every module, although the effect manifest rejects aliased identities.
- Of 130 independent single-condition helper mutants, 64 failed a behavioral test.

Corrections:

- **Helper, two rules:**
  - A reader, registry, contracts, fixed-owner, unsigned-owner or addon artifact digest must appear on exactly one module (`module_identity_alias`). Identical dependency copies may repeat among themselves, but never alias a fixed role. Only artifact identity is checked. Source digests remain correlations, and the reader source is compared with its LAUNCH pin.
  - Any known nonzero C2c transient peak adds the blocker `transient_overlap_unproven`.
    - C2c-A cannot show that C2c transient buffers never coexist with C2a's receive reservation: C2b starts startup inside its `data` handler (`startOriginalWorker` runs the producer up to its first await there).
    - The Capacity And Work sentence therefore stands, and the planner's transient figure is a C2c-only phase figure, not an invocation peak. A phase above the ceiling is still refused.
    - C2c-B/C must either yield out of the handler before allocating transient buffers or charge that prefix on top of C2a's reservation. Released there means unreachable, not freed.
- **Tests, 102 to 159:**
  - The fixture gives each fixed role its own artifact digest. Its addon, reader and reader-source digests are the LAUNCH pins.
  - The invalid list asserts each exact code, and "record size" now changes only the record size.
  - The state list feeds non-stop facts and asserts the first stop.
  - 56 single-gate cases each have a test and a trial that removes exactly that gate. They cover:
    - record projection and row role mapping;
    - module edge/export/effect uniqueness, the unsigned-owner export and fixed-role identity;
    - host/record/subset blockers, unknown helper/parser/hash costs and unproven transient overlap;
    - both partial step-total clauses (the lower clause through helper commands, because the stage floors already imply it for hash bytes), the record hash/compare floors, the other-helper mapping and the step-helper lower bound;
    - the retained/page floors and memory/work step uniqueness;
    - foreign session/generation/clock/lifetime and the reservation cost/order/active/id/window gates;
    - result before begin, a second begin, begun acquisitions, close before stop, unowned close, retention of an unknown module import and the blocked state.
  - A control shows that identical dependency copies are accepted.

Remaining defense in depth: 11 of the 132 re-run mutants still pass behavioral tests.

- Four fail only because a trial's search text disappears, which is not coverage:
  - the exact step-total clause, covered by the two partial clauses;
  - the post-completion step index;
  - a null planned cost, which always blocks first;
  - the close-attempted bit behind the owned check.
- Seven are masked by an earlier gate:
  - the C2c re-check of C2a's null setup;
  - begin's stopped/blocked/unknown-action/active checks;
  - result's active and outcome checks behind each other.

Verification uses `git archive` copies:

- **Record-initialization tests:** 159 tests and 4 boundary tests pass. 81 behavioral trials (previously 25) and the 26 static mutations are detected after successful controls.
- **Independent sweep:** on the same 130 mutants, 119 now fail a behavioral test (previously 64). The two new-rule mutants are also detected, giving 121 of 132.
- **Failing first:** on the uncorrected helper, the alias and transient-blocker tests and their trials failed. The other new tests are coverage tests, and the sweep measures their effect.
- **Related tests:** 29 related files / 1704 tests pass in every condition: Node 24 three times, linux/win32 spoofs, Node 20.19.6/26.12.1, isolation=none and CRLF.
- **Full unit suite:** 5229 of 5231 tests pass on Node 24 and on Node 20, with no failures or cancellations and the 2 existing skips.
- **Diagnostics:** maximal plan diagnostics stay 7546 / 16384; the bound already allows 48 blockers and at most 45 occur. The small invented buffer reservation stays 289792 retained / 0 transient.

No shared helper/model, worker/runtime, source, package/lock, limit, judgment/notification rule or seal changes. Dot remains PAUSED. No real port, clock, timer, child process, native read, fixture, signing, data, MCP registration, production activation or push operation was performed. C2c-B/C/H/J and C2d remain pending.
