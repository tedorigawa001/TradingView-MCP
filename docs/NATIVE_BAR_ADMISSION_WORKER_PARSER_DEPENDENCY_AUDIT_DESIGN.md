# C2c-B2 Dependency Acquisition, Pinning And Static Audit

Status: **detailed design only**, 2026-11-02 JST, baseline `7970b9b`. This refines [parser selection and B1](NATIVE_BAR_ADMISSION_WORKER_PARSER_ACCEPTANCE_DESIGN.md), including its commit-review correction, not just `2d981f0`. The current checkout is clean at the start of this design. B1's package identity refusal and corrected gate tests are preserved. No new implementation, dependency, artifact, approval capability or executable connection is added.

Today permits repository/source-text reads, public specification-document reads, documentation edits and read-only verification only. No package metadata endpoint, tarball, immutable source file or source archive is fetched in this step. No dependency is acquired/added, no candidate import/record parse, archive-decoder run, real port/clock/timer, build/subprocess, native read, fixture/signature/real-data operation, MCP registration, production activation, commit or push is performed. Dot stays PAUSED; all judgment/notification/mail/retention rules and runtime resource/time ceilings stay unchanged.

## Decisions And Baseline

- Keep exactly `stream-json 3.8.0` / `stream-chain 4.4.1` as an **evaluation tuple**, not an adoption or security certification. No latest/compatible fallback, vendor patch, different decoder/parser or silently changed entry.
- Separate metadata discovery, user-frozen artifact expectations, artifact acquisition, static inspection, evidence persistence, root dependency declaration and installed-tree placement. Approval of one is not approval of another.
- Prefer bounded **memory-first** acquisition and archive inspection. Do not extract archive members onto disk to inspect them. No package manager is the default acquisition mechanism.
- Recommend **B2-A pure plan/receipt/approval-boundary contracts and synthetic summary tests** as the first implementation slice. It does not acquire a package, parse an archive/record, start an acquisition/archive inspector or child, create a directory or alter a manifest/lock. Existing guarded Node memory-test invocations remain the proposed test mechanism, not an effectful auditor startup.
- Do not clear B1 initialization, parser, heap, work or invocation-overlap blockers with B2 evidence. B3 still owns separately approved original initializer/parser execution; B4 owns schema/canonical memory acceptance; C2c-C/H/J and C2d remain separate.

The repository currently declares neither candidate in `package.json` or `package-lock.json` (lockfile version 3). It has existing runtime dependencies and overrides which B2 must not update. Its root scripts include `prepack` -> build, `prepublishOnly` -> test, and `pretest` -> build. These are explicit reasons not to use a packaging/test shortcut. The local tree is not an archive-inspector qualification receipt; no existing trusted tar-inspector helper was identified by the scoped helper-file search.

## Approval Matrix

Every effect is denied unless that row has a later explicit approval covering the exact plan digest, baseline and effect profile. This document itself grants none.

| Slice | Proposed scope after approval | Still forbidden |
|---|---|---|
| **B2-A: pure contracts, recommended first** | Fixed tuple/origin/tool-profile summaries; immutable approval-plan binding; nullable evidence stages; metadata/member/graph/lock-diff summaries; limits and memory-only synthetic tests | All network, real archive/metadata parsing, persistence, dependency edits, candidate/tool imports and runtime operations |
| **B2-M: metadata discovery** | Exact-version npm metadata and fixed upstream tag/commit metadata over explicitly allowed HTTPS; reviewed strict metadata-JSON decoding of bounded responses in memory | Tarball/source payload acquisition, disk writes, package-manager/Git CLI, dependency edits, candidate execution |
| **Pin review stop** | Present observed metadata and proposed exact URLs/SRIs/immutable commits to the user; freeze the approved expectations in a new plan | Turning observations into prior trusted expectations automatically; fetching unknown artifacts under a wildcard approval |
| **B2-F: opaque artifact acquisition** | Fetch the two exact approved tarballs, hash the bounded compressed bytes and compare against pre-approved SRI, in memory only | Decompression/member parsing, extraction, source fetch outside the approved URL set, installation/import |
| **B2-C: static archive/source audit** | Approved trusted inspector bootstrap; bounded decompression/member inspection, manifest JSON and JS syntax inspection as data; byte comparison against approved immutable upstream source; static graph/effect inventory | Any candidate module evaluation, record parser invocation, build/script/child, filesystem extraction, native addon load, live host/loader proof |
| **B2-S: evidence persistence** | Separately approved private audit root; exclusive writes of the bounded raw evidence/receipt manifest, with verified path/ownership/ACL/identity and an exact lifecycle plan | Root `node_modules`, `.npm` cache or arbitrary output paths, overwrites, automatic recursive cleanup or ledger/history writes |
| **B2-P: root pin declaration** | Reviewed exact two devDependency additions and narrow lockfile-v3 patch from verified receipts | Package-manager execution, `node_modules` changes, unrelated lock churn, global overrides/config changes, runtime import |
| **B2-W: installed-tree placement/readback** | Separately approved write/read set for the two absent package locations, based on an audited immutable inventory; verify actual paths/bytes/static export resolution | Automatic npm install/ci, symlink/bin hooks, old package deletion/overwrite, candidate evaluation, actual loader/namespace/host qualification |
| **B2 review** | Review exact artifacts, provenance limitations, pinned diff and evidence binding; any separately requested commit | B3 import/initializer/parse permission, push, application/MCP registration or production activation |

Acquisition requires outbound network sockets, DNS/TLS handling, transport clock/deadline behavior and cancellation. They are **not** hidden inside the words "download only". B2-M/F/C need a specifically approved transport exception: fixed HTTPS destinations/443, no listener/application port, only the transport's reviewed clock/timer profile, no child or worker watchdog. With the present blanket bans these stages cannot run. A denied permission is not a reason to switch tools or hosts. No actual port/clock/timer is used in today's design or B2-A.

Trusted transport/bootstrap and metadata-JSON decoding need a B2-M-specific approval before discovery; they cannot depend on a later archive audit being approved. Archive-inspector startup, standard-library/native decompressor initialization, distributed-manifest JSON parsing and JS syntax inspection need B2-C-specific approval. Neither is the candidate JSON record parser, and neither is effect-free. A "no parse of any kind" approval cannot be used to run them. Candidate import/initialization and record parsing remain forbidden even after B2-C approval.

## Network And Pin Protocol

### Discovery Is Not Authentication

1. B2-M reads only the two exact-version npm metadata resources and the fixed repositories `uhop/stream-json` / `uhop/stream-chain`. No packument/latest search, alternate version, repository discovery from package-controlled fields, Git clone, npm view or credentialed endpoint.
2. Record name/version, observed tarball URL, declared SRI, metadata-byte digest, upstream tag and full immutable commit where resolvable, and source/provenance state. Registry `gitHead` or a tag alone is not an authenticated release-to-source binding. Missing fields remain null; SHA-1-only integrity does not replace the required SHA-512 pin.
3. Resolve any annotated tag through its bounded metadata chain; cap it at four tag objects per package and refuse cycles, foreign repositories and unresolved targets. No source archive is requested. Metadata response and reference identity changes during the run stop the stage.
4. Pause for user review of the exact observed expectations. B2-F's approved intent contains each full URL, canonical SHA-512 SRI, source repository/commit, request limits and trusted transport profile. No unknown pin is a wildcard. A receipt learned after an operation cannot prove that it was approved before the operation.

The only proposed tarball URLs are:

```text
https://registry.npmjs.org/stream-json/-/stream-json-3.8.0.tgz
https://registry.npmjs.org/stream-chain/-/stream-chain-4.4.1.tgz
```

These are expected locators, **not verified artifacts**. Exact-byte SHA-512 recomputation is independent computation, not an independent publisher-authentication channel. Matching registry metadata and bytes from that same registry proves that consistency only. No registry signature/provenance verification is claimed; cryptographic signature operations remain outside this approval. If authentic provenance cannot be established under the approved operations, leave that state unavailable and stop before any claim requiring it.

### Transport Policy

- Allow only public HTTPS GETs to the fixed registry and explicitly enumerated GitHub metadata/immutable-source URLs. Reject userinfo, alternate ports/schemes, query/fragment substitutions, IP literals, local/private destination addresses, proxy/auth redirection and package-supplied mirrors. A reviewed transport must enforce destinations at connection time as well as URL validation; a hostname string check is not a rebinding defense.
- Redirect following is off. GitHub redirects to another host/path, CDN changes or repository renames require a new explicit URL-set review. No transparent alternate download route, archive service or external upload.
- Do not read `.npmrc`, authentication tokens, user keychains, account data or arbitrary environment settings. The trusted transport profile defines its minimal environment and TLS roots; ambient proxy/client-certificate/loader settings do not become authority. Public artifact failure must not trigger login or secret discovery.
- Disable automatic retries. Stop on incomplete bodies, decompression/content-encoding surprises, pin mismatch, changed baseline/approval, cap exhaustion or cancellation. A later retry needs a fresh approved attempt; do not silently merge partial or differently observed responses.
- Count received/decompressed bytes before retention, including transport decoding and refusal work. Require identity HTTP content encoding for archive bodies, and hash those exact archive bytes. A reported Content-Length is neither allocation permission nor completeness proof.

## Proposed Audit Limits

These are proposed **acquisition/audit safety caps**, not changes to the runtime parser, trading criteria, B1 record language or existing qualification envelope. They require explicit approval with the first effectful acquisition plan. They are not evidence that the selected artifacts fit. Stop and seek a revised decision if they do not; do not raise them automatically.

| Item | Proposed cap |
|---|---:|
| Candidate packages / tarballs | Exactly 2 / 2 |
| Metadata JSON body | 512 KiB each; 8 MiB combined |
| Compressed tarball body | 4 MiB each; 8 MiB combined |
| Decoded tar bytes, including extension headers and padding | 16 MiB each; 32 MiB combined |
| Regular package files | 256 each, matching B1's summary bound |
| Total logical members, including directories/extensions | 1024 per archive; hidden extension handling must be accounted |
| Single regular file or immutable-source response | 4 MiB |
| Manifest JSON or single license text | 512 KiB |
| Metadata/manifest JSON structure | Depth 32, 16384 total nodes, 256 keys per object, 64 KiB per scalar, 128 bytes per numeric lexeme |
| Canonical member path | 240 UTF-8 bytes, at most 16 segments |
| Immutable source responses combined | 32 MiB |
| HTTP responses / all received bodies | 528 / 48 MiB, including metadata and failed bodies |
| Persistable aggregate receipt/inventory | 1 MiB; no embedded source bodies |
| B2-S persisted raw evidence plus receipt | 49 MiB per run; at most 530 files, no decoded-tar duplicate |

The request manifest must also give a finite source URL set within these caps, number of decode/hash/inspection passes, simultaneous buffer reservations and an approved transport deadline. No deadline, execution-time/heap fit or inspector maximum is invented from the byte caps. Byte/header/output bounds and progress need synthetic adversarial tests before an effectful run; unknown cost/tool/bootstrap data blocks that run. Do not borrow or enlarge C2a's full transient reservation, use an unapproved subprocess/watchdog, or call a synchronous operation preemptible because a timer is checked after it returns.

## Static Inspector And Archive Rules

The proposed inspector is a qualification-only trusted standard-library tool, not a new runtime tar dependency. A possible implementation uses a separately pinned existing Python interpreter and its `zlib`/`tarfile`/`io` libraries; no interpreter version, executable path/hash, initialization closure or local installation is qualified today. Do not install Python or a tar package, run system tar/unzip, or hand-write an archive lexer as a workaround. Before B2-C, approve an exact inspector/tool profile and its synthetic-only validation; if that cannot meet the no-child and bounded-processing requirements, inspection stays blocked.

Proposed sequence after that approval:

1. Verify the compressed SRI before decompression. Use an audited incremental decompressor with a nonzero remaining-output bound plus a one-byte overflow detector; stop on overflow before retaining another output block. Do not use an unbounded whole-buffer decompress or an unbounded flush. Require a completed gzip stream, no unused tail/concatenated second stream, and valid trailer. Keep compressed, decoded and copied buffers in the simultaneous accounting.
2. Only after the total decoded-byte cap has been enforced, inspect a memory-backed uncompressed tar reader (`fileobj`/`BytesIO`, explicit uncompressed mode in the proposed tool). This bounds data available to header/extension processing before logical-member callbacks run. Review hidden PAX/GNU allocation/progress behavior too; counting only yielded files is insufficient.
3. Reject invalid checksums, truncated offsets/payloads, inconsistent lengths, unsupported/sparse formats, ambiguous end-of-archive/trailing data, duplicate/aliased names, and unsupported extension records. Do not repair or ignore an unexpected member to obtain a smaller passing tree. Accept only the narrow tar dialect whose handling was explicitly audited; a new dialect is a stop, not a fallback.
4. Files and child directories must have exactly one leading `package/` root, then a canonical relative path. One empty-payload root directory marker `package/` is permitted; any second/aliased root marker is refused. Reject absolute/drive/UNC/backslash paths, empty/dot/dot-dot components, NUL/control characters, invalid encoding, alternate-root prefixes, repeated separators, case/normalization collisions and file/directory prefix conflicts. Do not collapse or Unicode-normalize a malicious path into a permitted one. Preserve original name/type/header evidence separately.
5. Permit only regular files and ordinary directories required by the tree. Reject symlinks/hardlinks (including links resolving within the archive), devices, sockets, FIFOs, sparse files, setuid/setgid bits and unreviewed extended attributes. A regular-file check must precede any `extractfile`-style read because that API can return a reader for a link too. Never call filesystem `extract`/`extractall`, restore owner/time/mode from headers or execute a member.
6. Read payloads only as bounded memory data. Include every published regular file, not just the selected imports, in the inventory; missing/extra files cannot be hidden by a projection. Record path/type/size/content SHA-256. Define the inventory's canonical ordering/encoding to match the existing JS UTF-16/canonical contract, not a locale/Python sort. Archive-byte identity and the semantic payload inventory are distinct digests; excluded header attributes are explicit, not a claim of byte-identical tar reconstruction.

Tar/gzip parser validation is not JSON record acceptance. The inspector's own initialization, extension handling and bound tests remain approval prerequisites; referencing a standard library does not certify an installed version. No archive parser or decompressor is run in this design step.

## Manifest, Source, Graph And Effect Audit

Treat package JSON, lock JSON and source text as untrusted data under a dedicated approved metadata/syntax-inspection profile. Use structured parsers with strict UTF-8, duplicate-key handling and size/depth/member bounds, not regex extraction or candidate `JSON.parse`/tokenizer calls. Preserve raw hashes before decoding; never repair encoding or normalize CRLF/source bytes for equality. The B1 pure-helper JSON denial remains unchanged, not relaxed to make this auditor run.

Required audit rows:

- Manifest identity/version/type, license and actual license bytes; engines/platform conditions; complete export/import maps and target files; all dependency/peer/optional/bundled/workspace edges; scripts, bin entries, lifecycle files, `binding.gyp`, native/WASM artifacts and shrinkwrap. No new dependency kind is silently accepted. The initial expected ordinary dependency edge is only stream-json -> stream-chain `^4.4.1`, with exact approved chain bytes; the distributed manifests must confirm it.
- Exact logical entry `stream-json/core/parser.js:jsonParser` -> package `src/core/parser.js`, and its transitive chain/core/re-export/UTF-8-helper closure. Include unselected alternatives in the effect inventory when they may be evaluated at import time. Resolve specifiers from the owning package and reviewed export conditions, not by array position or a grep hit.
- Complete source edges (static import, re-export, literal dynamic import, builtin, conditional/computed/unknown), top-level allocation/state, TLA/asynchronous work, swallowed errors, shared Symbol registry, decoder selection/BOM behavior, process/global/native/IO/network/clock/finalizer effects. An unresolved computed edge or effect prevents a closed-set success. Conservative static discovery does not prove execution order, readiness, namespace identity or absence of side effects.
- Exact immutable upstream source bytes for the approved repositories/commits and reviewed member paths, with finite URL and source-to-package mapping. Different build/generated release files need an explicit reproducible mapping/evidence decision; no candidate build may be run here, no vendor edits or "equivalent after formatting" equality. Missing raw preimages or unproved generation stays unavailable.
- Source bounds/work reasoning keyed to exact entry **and closure/options/runtime profile**, including prior suffix, scalar/canonical lag, fragment overshoot and failure paths. A source audit can document a proposed bound, but B1's scalar summaries and a successful byte comparison cannot establish heap or host qualification.

The known transitive UTF-8 initializer, suppressed import failure and shared-symbol effects remain blocking facts to inventory, not permission to run them. B2 may produce an initialization decision proposal for a later explicit B3 approval; observed readiness/outcome remain unavailable. Do not set `original_readiness`, `decoder installed`, `parser executed`, host/loader/runtime proof or operational execution true.

The archive inventory may reveal source paths not knowable at the earlier pin freeze. The first static pass must emit their exact immutable-source URL proposal and stop before fetching any unapproved source body. A second, bounded source-URL approval is required unless that exact finite set was already approved. A path found in an untrusted archive cannot authorize its own network request.

## Receipt And Approval Binding

Proposed B2-A inputs are bounded ordinary data only: schema/profile ids, baseline source/manifest/lock digests, fixed tuple, approved URL/cap/tool summaries, nullable expected pins, observation-stage summaries, member/graph/effect inventories and an exact planned diff. No importer, callback, namespace, arbitrary path/backend, descriptor, credential, script, native handle or real approval token is accepted. An actual effectful runner/approval authenticator needs a later explicit implementation approval and cannot be added with B2-A.

Separate states at least: `UNAVAILABLE`, `OBSERVED_UNREVIEWED`, `EXPECTED_PINS_FROZEN`, `ARCHIVE_BYTES_MATCHED`, `STATIC_AUDIT_MATCHED`, `DECLARED_ONLY`, `MATERIALIZED_STATIC_MATCHED`, `REFUSED`, `STOPPED_UNKNOWN`. Their names describe evidence stages, not runtime authority. Distinguish the existence of a proposed plan, user approval evidence and actual operation results. No transition skips missing prerequisites; a first refusal/cancellation/unknown result cannot be reset by a late response or a new timestamp. Intent digests bind the exact previous receipt, payload expectations, graph/entry/options, tool, destination, byte/work plan and baseline. An unexpected manual change stops processing without reverting it.

Each real field has source, observation stage and approved expectation provenance. Unknown actual SRI/commit/tree/export/entry/graph/lock identities remain null, never invented zero digests or synthetic B1 values. Capture raw bytes/digests and verification method separately from publisher-authentication claims. Source and receipt times, if later approved, state their clock/source and do not create first-seen market/history evidence. No signed receipt, signature key or secret is created.

B1 adaptation is a **projection**, not a schema waiver: keep its two distinct package identities, compare supplied/expected values on both sides, name-bind source to the stream-json entry, allow legitimately identical export-map/entry bytes and preserve every existing blocker. The compact B1 view does not carry the full inventory or establish its provenance. Never silently change B1 to fit a real artifact. If real audited metadata contradicts its identity/shape constraints, stop for explicit contract review. No collector journal/first-seen/review-log or trading/job state is used as an audit receipt store.

## Evidence Location, Retention And Cleanup

Default M/F/C runs are memory-only; return only bounded non-secret summaries. They do not claim that raw evidence was durably saved or that another process can recover the byte evidence. Repeatable independent artifact review needs B2-S or a fresh explicitly approved fetch against the same pins, not an imaginary persisted receipt.

Proposed B2-S location is `<verified checkout>/.parser-dependency-audit/<approval_id>/`, outside `src`, `build`, `test/helpers` and `node_modules`. It is not currently created or ignored. Before persistence, separately approve that exact real path, the literal `/.parser-dependency-audit/` ignore entry, private ownership/mode/ACL profile, exclusive no-follow writes, finite file list/byte caps and cleanup plan. Reject a symlinked/pre-existing run directory, unsafe parent/ACL, wrong checkout or concurrent identity change; do not use `.codex`, user caches, temporary aliases or an arbitrary fallback path. Checking POSIX mode alone is not ACL qualification; if a trusted read-only ACL/identity bridge cannot be used under the granted permissions, persistence stays blocked. This design does not add or invoke one.

Persist only newly approved public dependency artifacts/source evidence and bounded audit receipts, never real market/store/account data or credentials. Use digest-named blobs and a path-to-blob manifest rather than creating archive/source-controlled output paths; keep the approved finite file/byte set within the persistence cap. No existing path is moved, overwritten or removed. Default retention is hold-for-user-review with no automatic expiry/deletion or unattended job; cap exhaustion stops new writes. Cleanup needs its own approval listing only newly owned files and revalidated identities. Do not use recursive rm, untrusted archive paths or a generic maintenance bridge to delete. Unknown/foreign files and partial writes are retained and reported, not repaired. Removing a proposed dependency declaration is a later narrow reviewed Git edit, not destructive checkout/reset or a forced cache cleanup.

## Root Pinning And Installed-Tree Boundary

After reviewed artifact/source receipts, B2-P may propose only:

- `package.json` devDependencies `stream-json: "3.8.0"`, `stream-chain: "4.4.1"` and the matching two root devDependency fields in lock-v3's `packages[""]`.
- Two lock package descriptors at `node_modules/stream-json` and `node_modules/stream-chain`, containing the audited version, exact approved resolved locator, canonical verified integrity, dev-only classification, license/engine and real distributed dependency metadata. No guessed integrity, source commit as tarball SRI, link/alias/file/git substitution, nested second chain, runtime dependency, existing override change or unrelated re-resolution.

Use a reviewed structured patch with baseline fingerprints and a semantic diff of every unchanged lock node; preserve existing formatting/fields. A manually constructed lock proposal is not proof that npm accepts it or that an installed tree exists. Existing `node_modules/.package-lock.json` is not evidence of the new tree, and must not be silently deleted or edited. Any need for a scoped override, different resolution, new metadata field policy or broader lock regeneration stops for review. No npm install/ci/pack, audit/fix, update/dedupe/prune, npx, global cache/config edit or root script is authorized by a pin declaration.

B2-W is separate even after the Git declaration: inspect and exclusively create only the two approved absent package locations from the audited regular-file inventory, with no candidate import. Existing packages, bin links, nested duplicates, hidden locks or concurrent modifications are a stop, not permission to overwrite/uninstall. Rehash actual installed paths/bytes and statically resolve reviewed exports under the pinned runtime condition profile. Expected layout is not observed resolution; actual Node loader/namespace/host proof remains unavailable. Do not run `import()`/`require()` to prove placement, nor assume a dev-only package cannot become reachable after it is copied into a live checkout.

Repository root scripts and normal npm lifecycle behavior make a general installer inappropriate under the current constraints. Even `--ignore-scripts` is not a child-process/network/cache-write guarantee, and does not turn an explicitly requested npm script into a no-op. Root package/lock declarations, materialization and eventual B3 execution each need their own reviewable effect plan. Do not activate an existing MCP server, restart it or alter startup/environment/loader settings to test resolution.

## B2-A Concrete First Slice And Acceptance

Proposed helper: `test/helpers/unsignedParserDependencyAuditContracts.mjs`; only pure plan/describe functions, plus two guarded tests. Final names/schema require implementation review; this document does not add them. Reuse existing bounded-data/canonical/false-authority patterns rather than expanding a runtime API.

Acceptance for a later B2-A implementation:

1. Exact tuple/origin/entry/profile; nullable expected/observed pins and stages; distinct identities with positive controls for shared export/entry bytes; no conversion of observed pins into pre-approved ones.
2. Intent binding to immutable baseline/previous receipt/tool/limits/URL set/destination; changed, foreign, expired-without-clock-proof or replayed approvals do not authorize an effect. Supply time/attempt facts only as data, never call a clock or invent an expiry.
3. Synthetic member summaries cover traversal/links/duplicates/case aliases/type/prefix conflicts, unsupported extension flags, count/size/padding/metadata limits, exact-ceiling and one-over controls. These are classifier contracts, **not an executed tar decoder or real fixture**.
4. Known lower bounds survive null peers; sum simultaneous and joint memory/work without double-counting; unknown complete totals stay null. Cap checks apply before any planned action; no refunds or hidden retry budget. Acquisition limits remain distinct from all existing runtime limits.
5. Static graph/diff summaries cannot claim a closed set with unresolved edges, unapproved initializers, missing source mappings or unrelated lock changes. Declaration, saved evidence, actual layout and runtime proof are separate states; all real-effect/authority flags remain false, `NOT_RUN` and unavailable runtime producers remain explicit.
6. Each negative uses an otherwise consistent control, its own refusal/blocker and a single-gate mutation; setup errors/earlier refusals do not count as coverage. Install guards before helper imports, including JSON record parse, low-level reads/async handles, clocks/timers, children, network, native load, filesystem mutation and signing. Boundary-only tests inspect text, not a candidate.

No B2-A test needs package/network/archive bytes, a new parser dependency, an archive tool, a directory, a signature, real timer or spawned child. After independent review, seek separate approval for the exact metadata stage; do not treat this detailed design or a passing pure model as effectful B2 approval.

## Specification References And Today's Verification

Primary references inspected as documentation text only:

- [npm lockfile format](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/): package-location records distinguish version, origin, integrity, dev/link state; a hidden installed-tree lock is separate. The default-registry locator also depends on npm registry configuration, so the planned transport origin policy cannot rely on lock text alone.
- [npm install configuration](https://docs.npmjs.com/cli/v11/commands/npm-install/): ignoring lifecycle scripts is narrower than preventing other installer effects, and explicit npm script commands still run their target script. [Lifecycle documentation](https://docs.npmjs.com/cli/v11/using-npm/scripts/) identifies install/pack hooks and implicit node-gyp behavior; no such command is run here.
- [Python tarfile documentation](https://docs.python.org/3/library/tarfile.html): the memory file-object interface and regular-file reader are possible inspector APIs; filesystem extraction has additional hazards and is excluded. [zlib streaming API](https://docs.python.org/3/library/zlib.html): output bounds, EOF and unused/unconsumed input are separate; an initial flush buffer size is not an output cap. These moving documentation pages do not pin or approve any local interpreter/library version.

Verification today is limited to local document links/anchors, whitespace, Git scope and a read-only Dot/configuration comparison. No synthetic/operational suite is run for a document-only change. No candidate metadata, archive, immutable source or new dependency has been obtained, no package/lock/code/job setting is changed, and no actual artifact/pin/source/initializer/heap/loader qualification is claimed. Full Dot configuration SHA-256 remains `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1` with status PAUSED. The user subsequently approved committing these three documentation files only. That approval does not authorize B2-A implementation, acquisition or other operational work; each still needs a separate user request.
