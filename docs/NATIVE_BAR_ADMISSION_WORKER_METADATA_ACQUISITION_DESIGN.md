# B2-M Metadata Acquisition Scope And Approval Boundaries

Status: **M1 pure contracts implemented; independent review complete, local commit approved**, 2026-11-02 JST, baseline `f81c6bb`. This refines the [B2 acquisition design](NATIVE_BAR_ADMISSION_WORKER_PARSER_DEPENDENCY_AUDIT_DESIGN.md), including the B2-A commit-review correction. No collector, actual producer or execution permission is implemented.

The original design step used repository/source-text reads, public specification-document reads, three Markdown edits and read-only verification. The later M1 approval additionally permits the pure helper and memory-only synthetic tests described below. The following review request authorizes an independent review, scoped fixes/verification and a local commit after a clean review, not a push. No candidate registry metadata, GitHub repository metadata, tarball or immutable source endpoint is contacted. No dependency acquisition/addition, actual metadata/record/archive parse, connection code, real port/clock/timer, build/child/worker, native read, filesystem fixture, signature/key, market/store/account data, MCP registration or production activation is performed. Dot stays PAUSED; judgment, notification, mail, retention and existing resource/time rules are unchanged. Prior specification browsing is not an executed local transport test; M1 does not acquire further external information.

## Outcome And Non-Goals

Keep the evaluation tuple exactly `stream-json 3.8.0` and `stream-chain 4.4.1`. B2-M would observe bounded public metadata from npm and the fixed repositories `uhop/stream-json` / `uhop/stream-chain`, resolve only explicitly approved Git object references, and return a small **unreviewed observation/proposed-pin report**.

It must not fetch package/source bytes, install a tool, freeze an expected pin, verify a tarball, authenticate a publisher, populate B1's actual file/export/entry identities, run a candidate, or qualify a host/loader/heap. Metadata acquisition is a real network and metadata-decoding operation, not a synonym for an effect-free read. With the user's present bans, **every effectful B2-M step remains blocked**.

The design separates **discovery batches** from a **final metadata batch**. Discovery may expose exact object URLs for user review, but cannot grant itself another request. No process is kept alive waiting for human approval, and no raw bytes are silently persisted. A final batch must re-observe and validate its whole approved reference graph in one bounded attempt; historical discovery reports are not current evidence.

## Approval Slices

Each row needs a later explicit request covering its exact scope. Approving this design or one row does not authorize another.

| Slice | Proposed permission after separate approval | Still excluded |
|---|---|---|
| **M1: pure contracts, recommended first** | Fixed tuple/request-family summaries, finite batch manifests, binding/state/cost/capacity models, nullable provenance, memory-only synthetic summary tests | Fetch/DNS/TLS, actual metadata decode/JSON parse, tools/dependencies, connection code, clocks/timers, persistence and all operational actions |
| **M2a: trusted-tool selection and static qualification** | Review exact already-available runtime/decoder/address-policy/bootstrap source and version/digest/initialization profiles as text | Invoking/importing an unqualified tool, acquiring/installing one, network or actual parsing; absent adequate tooling, stop for another decision |
| **M2b: closed connection/owner code** | Only separately approved private connection/authorization/teardown code and fake-port model tests, default-denied entry | Actual ports/clocks/timers, candidate/tool initializer execution, real parse, caller-supplied transports/callbacks, public CLI/MCP registration |
| **M2c: synthetic tool acceptance** | Only explicitly approved in-memory invented metadata-byte decoding and trusted bootstrap qualification, with a reviewed effect inventory | Real metadata, record/candidate parsing, sockets, real clocks/timers, fixtures, signatures; this is the first parse exception, not an implicit part of M1/M2b |
| **M3: initial discovery** | An approved one-shot, memory-only batch of the six exact initial metadata URLs below, plus specifically enumerated transport/clock/decoder/bootstrap effects | Any response-derived follow-up request, package/source payload, auth discovery, disk writes, retries, dependency changes |
| **M4: exact object discovery** | A fresh approved finite batch of exact Git tag/commit-object URLs learned earlier, to propose any still-missing exact URLs | Templates/wildcards as capabilities, unapproved hops, old bytes as current evidence, preserved resource/attempt authority across processes |
| **M5: final metadata observation** | One fresh approved manifest containing the complete finite URL set, graph expectations, initial reads, bounded object reads and planned final rechecks | Auto-extending the manifest, automatic expected-pin freeze, artifact/source fetch, B2-S/P/W or B3 permission |
| **Pin review stop** | Present final observations, missing facts, provenance limits and exact proposed B2-F expectations to the user | Automatic approval, package adoption, or B2-F execution; those remain separate |

M2c and M3/M4/M5 require their own explicit exceptions to the current parse/runtime bans. Actual acquisition also needs approved outbound HTTPS, DNS/TLS initialization and verification, real acquisition clocks/referenced timers and teardown. It does not grant application listeners, CDP/TradingView access, child processes or worker watchdogs. TLS certificate-chain checks are transport verification to name explicitly; no application/package/receipt signing, key generation, package-signature verification or account/keychain discovery is included.

## Exact Request Set

### Initial Discovery

Exactly these six planned GETs; order and per-request identifiers are frozen before execution:

| Package | Purpose | Exact URL |
|---|---|---|
| stream-json | npm exact-version metadata | `https://registry.npmjs.org/stream-json/3.8.0` |
| stream-chain | npm exact-version metadata | `https://registry.npmjs.org/stream-chain/4.4.1` |
| stream-json | bare tag reference | `https://api.github.com/repos/uhop/stream-json/git/ref/tags/3.8.0` |
| stream-json | v-prefixed tag reference | `https://api.github.com/repos/uhop/stream-json/git/ref/tags/v3.8.0` |
| stream-chain | bare tag reference | `https://api.github.com/repos/uhop/stream-chain/git/ref/tags/4.4.1` |
| stream-chain | v-prefixed tag reference | `https://api.github.com/repos/uhop/stream-chain/git/ref/tags/v4.4.1` |

These are proposed locators, not observations of their availability. Both spellings are preplanned observations, not a fallback search after failure. An exact-ref 404 may be reported as an unavailable HTTP observation; it is not proof that a tag/repository does not exist or that authentication would fix it. Do not authenticate or enumerate other tags. Non-ref errors, malformed bodies, identity mismatches and unexpected statuses stop the batch.

### Object Discovery And Final Manifest

Only these **families for planning**, never executable wildcard permissions:

- `https://api.github.com/repos/uhop/<fixed-package>/git/tags/<full-40-lowercase-hex-object-id>`
- `https://api.github.com/repos/uhop/<fixed-package>/git/commits/<full-40-lowercase-hex-commit-id>`

An unknown ID stays null and cannot be requested. The user must see and approve each fully expanded URL and its parent reference/object before a later batch may use it. Ignore response-supplied destinations as authority; derive the one permitted URL from the fixed repository, expected object type and already reviewed ID, then require exact manifest membership.

No matching-ref list, package packument, latest/range lookup, release/default-branch search, repository discovery, regular commit-diff endpoint, Git tree/blob, raw source, archive, tarball, download statistics or signature/provenance endpoint. In particular use Git **object** commits, not the endpoint that returns changed-file patches. GET only, no HEAD probe, conditional-cache request, POST or mutation.

GitHub documents [exact refs](https://docs.github.com/en/rest/git/refs#get-a-reference), [annotated tag objects](https://docs.github.com/en/rest/git/tags#get-a-tag) and [Git commit objects](https://docs.github.com/en/rest/git/commits#get-a-commit) separately. The collector must preserve that distinction; documented examples containing authentication or redirect options are not an approval to use them.

## Reference Graph And Consistency

1. Name-bind npm `name`/`version` and every requested repository/ref to the fixed tuple. Reject a successful wrong object, wrong repository or array/list response; do not select a plausible element.
2. Preserve reference-object ID, annotated-tag-object ID, peeled commit ID, registry-declared `gitHead` and commit-tree ID as different fields. Validate exact requested/ref/body identities. A lightweight ref can point directly to a commit; a tag object may point to another tag.
3. Allow at most **four distinct annotated tag objects per package in total across both spellings**, not four per spelling. Track visited IDs/parent edges; refuse cycles, a fifth object, unknown object types and cross-repository URLs. A shared object is fetched once per purpose/attempt and can satisfy both aliases without duplicate byte/work credit.
4. Every next hop must already be an exact approved URL. In discovery, return proposed follow-up URLs and terminate with `AWAITING_EXACT_URL_REVIEW`; no background continuation. In M5, any newly observed unapproved ID stops the attempt rather than widening the plan.
5. If both tag spellings resolve, require the same commit or stop as ambiguous; do not select the favorable spelling. If only one is available, record the other as unavailable. If neither resolves, commit/source identity remains unavailable. Optional `gitHead` is an npm declaration, not an authenticated binding: missing stays null; a supplied disagreement with the chosen peeled commit is a stop for review.
6. Fetch the two exact peeled Git commit objects only under their own approved URLs. Require each response's object identity to match; do not follow its tree, parents, HTML URL or signature payload. GitHub's reported signature fields are not locally verified publisher evidence.
7. M5 repeats the six initial GETs as **preplanned revalidation**, not retries. Use the same headers/profile; require raw-body SHA-256 equality for successful initial metadata/refs and the same availability outcome for an unavailable ref. Any change stops; do not normalize/reorder JSON to manufacture equality or silently refresh a pin.

M5 has at most 6 initial reads + 8 tag objects + 2 commits + 6 rechecks = **22 request attempts**, at most 16 distinct URLs. Unused object slots do not authorize other endpoints. A failure stops immediately; attempts/body bytes are charged, not refunded. Rechecking does not yield an atomic npm/GitHub snapshot, prove publisher identity or prove a registry tarball was built from that commit.

## Discovery Lifetime And Human Review

Separate approvals cannot be smuggled into one indefinite acquisition session:

- Each discovery invocation closes its own handles/timers and returns only a bounded report and exact next-URL proposal. Raw buffers are released from ownership; no file/cache/journal/review-log, daemon or waiting worker is created. Release is not a cryptographic memory-erasure claim.
- A subsequent invocation gets a fresh attempt ID, baseline/profile/expiry and explicit approval. The prior report is a planning hint, not live raw evidence, a durable replay registry or a continuation token. Report earlier attempt IDs/counts to the user; no automatic retry/reset/refund.
- Once all anticipated exact object URLs are reviewed, M5 starts anew. It reads the initial endpoints again, checks the now-expected graph, reads only preapproved object URLs and rechecks initial endpoints. Discovery bytes/times never fill missing M5 evidence.
- If references move, a new hop appears, approval expires, the process is lost or teardown is uncertain, the attempt remains stopped. Do not revive it with a later timestamp or another process's clock. A fresh user decision is required; no settings/job change is made to keep it alive.
- Memory-only operation cannot provide independently replayable raw preimages after teardown. Independent raw-byte review needs a separately approved fresh fetch or B2-S persistence, not a claim that a report hash saved the bytes.

## Transport And Bootstrap Qualification

Preferred direction for later review: a dedicated, qualification-only Node core HTTPS/HTTP/1.1 owner, sequential requests and no general-purpose fetch fallback. **No runtime version/binary, network adapter, IP policy, certificate profile, decoder or initializer is qualified by this design.**

The future effect plan must pin the executable real path/content, approved arguments/minimal startup environment, transitive initialization closure and builtin/native-library/TLS trust profile before loading connection code. No bare PATH launcher, package CLI, `npx`, `npm view`, curl, Git CLI, Python process, browser, remote executor or worker/child watchdog. No runtime restart/MCP registration. Native OS/TLS/DNS work intrinsic to an approved transport must be listed; this never grants the bar-store native reader or an addon load.

No inherited proxy, loader/preload, env-file, client-certificate, key-log, custom CA or credential setting becomes authority. Do not inspect `.npmrc`, Git credentials, tokens, user HOME/config/keychains or arbitrary environment/files. A proposed bundled-CA-only TLS profile must be verified for the pinned runtime and explicitly bound; no system/user trust discovery or insecure certificate bypass. If a trusted minimal bootstrap cannot be established without more effects, stop and request a separate design/approval rather than inventing a clean host.

Required transport properties before M3:

- Exact ASCII HTTPS URLs on `registry.npmjs.org` and `api.github.com`, destination port 443, no userinfo/query/fragment/encoded-path aliases, explicit port alias, alternate host or redirect. Canonical URL equality and approved path membership both apply; no suffix-only host check.
- Approved DNS/profile only for those hosts. Validate all returned candidate addresses with a reviewed IPv4/IPv6/special-range policy; select one permitted address, prevent a second hidden resolution/family fallback, and compare the actual peer address against that approved choice. Refuse mixed unsafe answers, loopback/private/link-local/unspecified/multicast/reserved destinations and IPv4-mapped bypasses. Hostname checking or `net.isIP` syntax recognition alone is not public-destination qualification.
- No global DNS/proxy/agent mutation or public-resolver fallback. [Node's DNS documentation](https://nodejs.org/docs/latest-v24.x/api/dns.html) distinguishes OS name resolution from direct DNS queries; the exact resolution path, its network/internal-thread effects and cancellation limits belong in the profile, not an assumption that DNS is effect-free.
- SNI/Host/certificate hostname remain the original approved host when connecting to a vetted address. Require normal certificate-chain/hostname verification before application data; reject altered peer/host, TLS failure or unapproved protocol negotiation. No credentials, client keys or package signatures.
- One request/socket at a time, no pooled or reused connection, HTTP/2, proxy CONNECT, upgrade, WebSocket, cookies, upload or listener. Explicit bounded headers and body handling; no global agent shared with production. Redirects, informational/upgrade responses and auth challenges stop rather than open another route.
- Fixed outbound headers only: JSON Accept for npm; GitHub vendor JSON Accept, a reviewed non-secret User-Agent and a pinned API-version header. The current GitHub examples name `2026-03-10`; this is a proposal to review, not observed compatibility or permission to choose another version. Request `Accept-Encoding: identity`; reject other response content encodings instead of adding a decompressor.

The [Node HTTPS reference](https://nodejs.org/download/release/v24.18.0/docs/api/https.html) describes the core surface; a documentation version is not a pin/qualification receipt for an installed runtime. Existing [boundedResponse.ts](../src/boundedResponse.ts) is **not** adopted: its optional response URL, host-only check, whole-buffer fallbacks and nonfatal text decoding do not establish the above connection/decoder contract. Do not refactor or weaken that shared helper in this slice.

## HTTP Completion And Strict Metadata Decoding

Before projecting any successful metadata:

1. Bind request ID, exact URL/purpose, package/repository, attempt and actual transport result. Validate raw header size/count and unique critical fields before using normalized headers. Reject conflicting/duplicate framing/type/encoding fields; handle every rejected/incomplete response within the same budgets. The profile must expose a complete raw-header view and hard refusal, not a setting that silently drops excess headers.
2. Successful required resources need 200 and a reviewed JSON media type with UTF-8 or no charset. Only the exact-ref purpose may produce a bounded 404-unavailable observation. 3xx/304/401/403/409/429/5xx are not successful metadata. Rate-limit/Retry-After headers are information only: no sleeping retry, token lookup or limit endpoint. [GitHub's rate-limit documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) does not guarantee quota for this machine or authorize an authenticated fallback.
3. Count each delivery and received byte before retaining/copying; use bounded streaming only, not response `text()`/`json()`/`arrayBuffer()` fallbacks. An oversized chunk is refused before application retention; it still counts as received work. Transport/parser internal allocations require separate qualification, not a post-hoc cap claim.
4. Require observed HTTP end/completion, correct framing/length where declared, no premature close, trailing/unconsumed data or decoder error. Content-Length alone is not completeness. Preserve a raw body hash only for the exact successfully received identity-encoded bytes; partial-body hashes have separate incomplete status and are not metadata identities.
5. Strict UTF-8, reject BOM and malformed/unpaired Unicode, then strict JSON grammar. No comments, trailing comma, NaN/Infinity, extra top-level value, root array/scalar or coercion. Reject duplicate object keys **after escape decoding**, including aliases such as `name` versus its escaped spelling. Bounds must cover keys, values, numeric lexemes and unknown fields, not just projected keys.
6. Use a separately selected/reviewed bounded structured decoder; no regex field extraction, handwritten JSON lexer, candidate `stream-json`/chain bootstrap, JSONC-as-JSON assumption, or `eval`. Bare `JSON.parse` plus a reviver/Zod check is insufficient to recover overwritten duplicate keys. [RFC 8259](https://www.rfc-editor.org/info/rfc8259/) discusses duplicate-name ambiguity; [ECMAScript's JSON.parse specification](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.parse) specifies the resulting object, not a pre-collapse duplicate-key audit.

**Decoder selection is an unresolved execution blocker.** The source search found existing fatal-UTF-8/canonical internal-record paths, not a qualified decoder for noncanonical public registry metadata. Their internal-record grammar, prescan and post-parse canonical equality are not adopted here. Do not import them, add a dependency, start an interpreter or use candidate code to escape this blocker. If no already-available in-process decoder can be qualified under M2, present a separate tool/bootstrap proposal and stop.

## Proposed M-Specific Caps And Work Accounting

These require explicit approval before any effectful plan. They only narrow the parent audit envelope; no runtime/trading/notification/retention cap changes.

| Item | Proposed bound |
|---|---:|
| Active attempts / sockets / responses being decoded | 1 / 1 / 1 |
| Final request attempts / distinct URLs | 22 / 16 |
| Annotated tag objects | 4 per package, 8 total across both spellings |
| Body bytes | 524288 per response; 8388608 total including failures/rechecks |
| Raw response header bytes / pairs | 16384 / 64 per response |
| Body deliveries | 1024 per response, including zero-length callbacks |
| JSON depth / nodes / keys per object | 32 / 16384 / 256 |
| Scalar UTF-8 bytes / numeric lexeme bytes | 65536 / 128 |
| Report/manifest/receipt projection | 1048576 bytes total, no raw bodies/source/signature payloads |
| Root acquisition deadline | 240000 ms |
| Request deadline, including resolution/TLS/body | 15000 ms |
| DNS/TLS phase or body-inactivity ceiling | 5000 ms, always inside the absolute request/root deadlines |
| Teardown settlement | 10000 ms, no next request while close is unresolved |
| Simultaneous owned referenced timers | At most 3; settlement reuses released slots |

An initial batch has six attempts; object discovery names its exact smaller finite count. A final manifest has separate operation rows for initial and recheck purposes even when the URL repeats. Its URL set is deduplicated, its attempts and byte work are not. At maximum response size, 22 bodies exceed the 8 MiB aggregate bound: that is intentional independent enforcement, not a promise that all worst cases fit or permission to enlarge the cap. The body cap is not a bound on all wire traffic, TLS/DNS work or process RSS. DNS/TLS/header/decode/copy/hash/validation/failure/close work and bootstrap allocations must have their own finite reviewed accounting in the qualification plan; unknown internal maxima still block execution.

Logical memory includes raw response bytes, incoming transport buffers, decoded text, duplicate-key/parser state/tree, projection, retained digest/graph/receipt rows and trusted bootstrap reservations while they coexist. Rechecks need the earlier hashes/outcomes, not an indefinitely retained raw-body set. A 512 KiB UTF-8 input may need up to 1048576 logical bytes for UTF-16 code units alone; this is **not** a V8 heap estimate. Unknown parser/transport/initializer overhead remains null and blocks real execution until a finite reviewed budget exists. Sum disjoint resources and use max for proven overlaps; count bytes/requests per kind before totals. No refund/retry budget or borrowing C2a's full transient reservation.

The [Node HTTP reference](https://nodejs.org/docs/latest-v24.x/api/http.html#httprequestoptions-callback) states that a timeout setting only emits a timeout event; the future owner must actually abort/destroy and observe settlement. Referenced timers preserve liveness, not synchronous JSON-parser preemption. A qualified monotonic clock domain is required for deadlines/expiry/regression; wall UTC/JST times are separate acquisition timestamps. Remote Date/Age, publication/commit time and a later process's wall clock do not prove elapsed time or first-seen history. Unknown cancellation/close/clock facts remain stopped; no watchdog child or fabricated cleanup success.

## Receipt, Pin Proposal And B2-A Boundary

Proposed bounded receipt fields, all keyed by package name rather than array position:

- Schema, baseline source/manifest/lock identities, attempt/plan/profile IDs, exact operation URL/purpose/ordinal, previous report reference and **its non-authoritative provenance**, granted effect scope and finite limits.
- Runtime/bootstrap/transport/address-policy/TLS/decoder/clock profile references; request start/end and observation clock/source, received counts, raw successful body digest, completion/refusal/teardown facts. These fields are unavailable until real producers exist and the approved operation succeeds.
- Registry-declared name/version/tarball/SRI/gitHead, fixed repository/ref, annotated-object path and resolved commit; each field's raw-body digest/source stage and nullable status. Preserve an unsupported original integrity field as a bounded declared datum; only a single canonical SHA-512 value can become a proposed B2-F pin. No SHA-1 fallback, whitespace/multi-algorithm selection, synthetic zero digest or silent normalization.
- Exact expected tarball locators are checked as **data only**, never fetched by M. Registry body SHA-256, registry-declared tarball SRI, future computed tarball SRI, commit/tree IDs and future package/export/entry/graph digests stay distinct. The latter actual-byte fields remain null at M.
- Final consistency outcome, known limitations, exact next-URL or B2-F pin-review proposal, and which effects were **not run**. Never return raw public author emails/maintainer lists, commit messages, commands, signatures, headers carrying secrets or arbitrary response strings in errors.

The [npm metadata description](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md) explains declared `dist` fields and version data; reading those fields is not tarball hashing. `repository`, homepage, documentation, error text and embedded URLs are untrusted data, never instructions or network authority. Duplicate package identities contrary to B1/B2-A remain a review stop, not permission to change those contracts.

B2-A only accepts `synthetic_summary` observation provenance and `audit-summary` clock facts, and always denies actual authority. Do not rename real observations to those labels and claim real verification. M1 may compare invented summaries against its pure rules, but an eventual real M receipt/producer and any B2-A/B1 projection need an explicit later implementation/review. A proposed metadata observation maps conceptually only to `OBSERVED_UNREVIEWED`, never automatically `EXPECTED_PINS_FROZEN`, `ARCHIVE_BYTES_MATCHED` or a runtime-ready flag.

## M1 First Implementation And Acceptance

The user approved **B2-M1 pure batch-plan/provenance/state/capacity contracts and memory-only summary tests**. The qualification-only helper is [unsignedMetadataAcquisitionContracts.mjs](../test/helpers/unsignedMetadataAcquisitionContracts.mjs), with [behavioral](../test/unit/nativeBarAdmissionUnsignedMetadataAcquisition.test.mjs) and [source-boundary](../test/unit/nativeBarAdmissionUnsignedMetadataAcquisitionBoundary.test.mjs) tests following B2-A's corrected pattern. This is not an effectful connection adapter.

M1 acceptance:

1. Exact tuple/origins/resource kinds and literal initial URL set. Follow-ups require an already expanded reviewed ID/URL, parent/repository/type binding and finite graph; no wildcard, array position or response URL authorizes I/O.
2. Immutable intent binds baseline, predecessor-provenance limitations, exact operations including rechecks, runtime/tool/clock/environment/address/TLS/decoder summaries, budgets/expiry and one attempt. Unqualified inputs remain blocked and all actual-execution/authentication/persistence flags false.
3. Per-package metadata availability, optional-ref 404 semantics, graph depth/cycles/aliases/ambiguous commits and missing gitHead/source binding are explicit. Unknown SRI/commit/field sources remain null. A discovery stop cannot turn into a new request without another plan; final observation requires a complete freshly observed supplied batch, not discovery-time evidence.
4. Separate planned, supplied-model and actual receipt states. Terminal failure/cancellation/unknown close cannot reset via a late callback, deadline extension or new process; immutable observed facts can be retained as partial facts without creating success. No fake real producer/approval token or runnable connection entry.
5. Per-kind count maxima sum; known-but-unenumerated/disjoint facts retain their floors and combined floors receive their own caps. Duplicate/revalidation attempts and failed bytes are charged; simultaneous buffer floors combine without double counting, unknown complete totals stay null, no native/runtime-reservation borrowing.
6. Accepted controls at each exact ceiling and own-refusal/blocker negatives one past it, each isolated from other failing gates and accompanied by single-gate controls. Check URL/body-kind/metadata-stage/previous-stage/budget/expiry/parent binding, empty/null/unknown facts, diagnostics and all strict schemas. Never substitute an earlier error for the intended failure.
7. Install effect guards before helper/dependency imports; finish all top-level imports/source loading **before the first test registration**, with no later top-level await/for-await/await-using, including the registration statement. Preserve the `f81c6bb` root-after-hook correction and its LF/CRLF detector. No optional parser import, actual JSON metadata decode, new timer/port/child/fixture or candidate startup in M1 tests.

M1 does not select/import/run a metadata parser or transport. Before M3, unresolved real bootstrap, decoder, address classification, cancellation/close, source/work/heap and approval-authenticator qualification must each be resolved under M2's own approval. A pure `approved_supplied` Boolean/digest, passing test or this document can never mint real execution permission.

## M1 Implementation And Verification

The only exports are `planUnsignedMetadataAcquisition` and `describeUnsignedMetadataAcquisitionCapacity`. Both validate/detach a strict `unsigned-metadata-acquisition-v1` data input and return the same deeply frozen modeled view. Inputs are invented summaries only: `synthetic_summary`, `synthetic_current_attempt`, `supplied_review_summary` and the `metadata-summary` clock domain. `prior_reports` are `planning_hint` references, never current body evidence or durable attempt authority.

The plan digest binds exact operations/rechecks, graph/parents, attempt/baseline, prior-report references, profiles, clock window, work, memory and budgets, with fixed tuple/caps. Receipt chaining binds each supplied current-attempt row to the plan/predecessor. Approval data must match the plan/baseline/profile/attempt/window and cannot be marked used. This checks a **supplied summary**, not authenticity: it is not a replay registry or execution token. Neither export accepts a raw metadata body, callback, decoder or transport implementation.

Modeled states: `PREFLIGHT_BLOCKED`, `PLAN_ONLY`, `DISCOVERY_OBSERVED_PARTIAL`, `AWAITING_EXACT_URL_REVIEW`, `FINAL_METADATA_OBSERVED_UNREVIEWED`, `REFUSED`, `STOPPED_UNKNOWN`. Known contradictions refuse with bounded codes; unknown completion/close/timing/strict-decoding facts stop replay and cannot be followed by another row. Discovery proposals contain exact derived URLs and `authorizes_request: false`. Final object operations follow their approved parents, use fresh supplied observations and retain distinct rechecks. Final unreviewed metadata is not pin freezing, verified package bytes or runtime readiness.

Capacity sums per-kind maxima, charges rejected bytes/rechecks, retains null totals for unknowns, independently caps body reservations and combines simultaneous disjoint buffer floors with maximum joint floors. The shared four-tag budget includes historical unlisted targets and new observed hops across both aliases. Work/logical UTF-16 floors are not measured heap/time guarantees. Existing runtime reservations and production limits are unchanged.

Imports are existing Zod and pure data/hash helpers only. The line decoder is not called; no JSON/metadata parser runs. Actual execution, authentication, persistence, timestamps, producer/parser/network availability, TLS qualification, signing, tarball-byte verification and pin-freeze flags remain false even for a complete invented batch. `native_status` is `NOT_RUN`; `runtime_producers` is `unavailable`.

Initial implementation verification, before the independent-review fixes below, used separate main-process `node --test --test-isolation=none` invocations, not package scripts:

- M1 behavior **181/181**, source/harness boundary **15/15**. Seventeen own-gate controls retain a valid positive control, require the intended refusal and remove only that gate in memory. Removing duplicate-key rejection still stops at unknown decoding, not success. Boundary checks include 11 text-only effect mutations, six authority/limit mutations, nine guard-deletion controls and five late-top-level-await controls under LF/CRLF.
- Selected existing memory-only regressions: B2-A behavior **400/400**, boundary **15/15**; B1 behavior **391/391**, boundary **10/10**. Total **1012/1012**, zero failures/cancelled/skipped. No full repository suite, build, native/transport experiment, candidate parser run or alternate runtime/platform qualification.
- Guards precede helper/dependency imports; source loading finishes before test registration. Probes verify denial of metadata JSON parsing, I/O, real clocks/timers, ports, children/workers, native loading and signing. Boundary tests examine source ASTs with the existing isolated TypeScript helper, not a new parser dependency or actual metadata/record decoding.
- Red tests exposed and fixes covered parent-before-child ordering, observed cycles behind historical roots, known JSON bounds hidden by unknown HTTP completion and sharing observed-hop budgets with historical unlisted targets. A partial-body test's wire counter was corrected to include its changed body. No existing policy was relaxed to make tests pass.
- The **558 protected existing files** retain aggregate SHA-256 `797fd4bd54a3ecb167328b3ec82957a188044c7511db74dbba21cbd629882aba`. Dot remains PAUSED; full configuration SHA-256 is unchanged at `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1`. New M1 files are excluded from the pre-existing-file comparison. Operational source, native, scripts, dependencies/lock and automation settings are unchanged.
- Documentation checks cover 176 local file links and 130 heading anchors across this document, its parent and BACKLOG. One existing confidence-interval expression that resembles Markdown link syntax is not a file link and was excluded without editing it. New-file ASCII/trailing-whitespace/final-newline checks and tracked diff whitespace checks pass. The intended working-tree scope is the three M1 helper/test files plus these three design/backlog files; no commit was made.

Outer report/diagnostic ceilings and some redundant defenses are source-pinned rather than claimed as independently reachable one-past cases under this smaller strict schema. Passing these checks is not a parser/transport security proof. Real bootstrap, strict duplicate-aware decoding, address/TLS, clock/cancellation, heap/work and approval-authenticator qualification remains unavailable. No real observation is relabeled synthetic for B2-A/B1. The initial implementation request did not include commit/push; the subsequent review request separately authorizes a local commit after a clean review. M2a tool-source qualification and all effects remain separate.

## M1 Independent Review

Two read-only reviewers examined state/graph/binding and accounting/guard behavior separately. Initial review identified three P2 issues; follow-up accounting review identified two more. Each was reproduced as a failing test inside the existing effect guards before changing the helper:

1. Known per-record `http.wire_bytes` was absent from aggregate work/budget checking. Per-record wire floors now sum `max(wire, known body + known headers)` and join the existing fixed reservation with `max`. The view reports `wire.known_consumed` separately from nullable `modeled_consumed`; rejected/unknown responses do not refund known work.
2. Known `json.parsed_bytes` disappeared when received body bytes were null. Shared `bodyFloor` now takes `max(received body, parsed bytes)` for per-kind usage, hash/decode floors, per-operation body bounds and known wire floors. Unknown complete totals remain null; overlapping known bytes are not added twice.
3. A supplied DNS/TLS or inactivity duration could exceed the supplied request elapsed time while remaining below its absolute phase cap. Known phase durations must now be at most `end_ns - start_ns`, with a dedicated `phase_duration` refusal. Equal duration is accepted and one nanosecond over is refused for both fields. The existing zero-duration control was made internally consistent by setting its phases to zero, not by relaxing the check.
4. Known usage not enumerated in record rows could overlap the record wire total under a simple maximum, losing a known excess. The per-kind wire calculation now preserves the portion of additional known body/header use that cannot already fit within listed wire. Tests cover zero/one-byte residuals, different-kind sums and unknown counters with retained known facts.
5. A first residual-only correction incorrectly assumed unknown listed body/header quantities could not overlap usage, causing false refusal. The final pure `minimumWire` calculation models that overlap explicitly instead of treating unknown as exact zero. Three same-kind unknown-component regressions cover body, headers and both.

For each kind, the final wire minimum starts from the sum of listed `max(wire, known body + known headers)` floors. Only an unknown component can consume the slack within its row. Slack is split into body-only, header-only and shared pools; shared space cannot be consumed twice. For additional known body/header requirements `B`/`H` and slack `SB`/`SH`/`SX`, the additional minimum is `max(0, B-SB-SX, H-SH-SX, B+H-SB-SH-SX)`. Kinds are disjoint and summed; that result is compared by maximum with the original fixed reservation. This retains proven non-overlap without adding the full reservation twice, borrowing another kind's slack or assuming a qualified upper bound for an unknown counter.

After these fixes, new behavior tests are **228/228** and boundary tests **15/15**, with zero failures/cancelled/skipped. Forty-seven behavior tests were added; eight additional isolated gate/constraint-removal controls bring that count to **25**. Twenty-five small integer combinations are compared with an independent exhaustive allocation enumerator. Four targeted removals separately exercise body, header, joint and shared-space constraints with otherwise valid controls. The private pure wire function is exposed only inside the in-memory test compilation, not as an actual export or execution entry. Both read-only reviewers' final confirmations report no remaining findings; both independently ran 228 behavior tests and the accounting reviewer also ran all 15 boundary tests. The parent freshly reran these two files plus the four selected B2-A/B1 memory-only regression files: **1059/1059**, zero failures/cancelled/skipped. This is not a full suite or runtime qualification.

The review and fixes do not add a producer, parser, transport, dependency, fixture, effectful entry or registration. The protected 558-file aggregate and Dot's PAUSED/full-configuration hash were checked again and match the initial values above. Only the same six M1 helper/test/design/backlog files are intended for commit. Hooks, commit signing and automatic Git maintenance will be disabled for the local commit. This does not authorize a build, native read, operational change, runtime restart or push. The next scope is separately approved M2a source/tool qualification, not metadata acquisition.

## Historical Verification Of The Design Step

Only three Markdown files are intended to change: this new design, its parent and BACKLOG. Verification is local links/anchors, whitespace/ASCII for the new document, exact Git scope and before/after protected-file and Dot hashes. No test suite, build, parser/tool invocation, acquisition, fixture or connection experiment is part of this design step. Public specifications above were read as documentation only, not candidate metadata or qualification evidence; moving documentation does not pin local tools or guarantee current endpoint behavior.

Observed read-only checks: 164 local file links/anchors and whitespace/new-document ASCII pass; request arithmetic is 22 attempts / 16 distinct URLs, with a separate 8388608-byte body cap (22 maximum-sized responses would be 11534336 bytes and must not all be admitted). The 558 protected source/native/script/test/package/lock/ignore files retain aggregate SHA-256 `797fd4bd54a3ecb167328b3ec82957a188044c7511db74dbba21cbd629882aba`. Dot remains PAUSED with full configuration SHA-256 `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1`. These checks do not qualify a real metadata decoder/transport or execute the historical B2-A test counts.

At that design-only checkpoint, implementation and review were separate next actions. M1 was subsequently approved and implemented as recorded above; independent review, commit and every effectful execution permission remain separate. No collector or operational authority is installed by accepting this plan or passing M1 tests.
