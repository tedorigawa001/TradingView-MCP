# B2-M2a Static Tool Qualification Scope And Approval Boundaries

Status: **detailed design only, committed as `9cdd834` and corrected after commit review**, 2026-11-02 JST, baseline `794aa94`, commit-review correction baseline `9cdd834`. The [commit review correction](#m2a-commit-review-correction) changes wording only; no slice, limit or stop condition changes. This refines [B2-M](NATIVE_BAR_ADMISSION_WORKER_METADATA_ACQUISITION_DESIGN.md), including the M1 commit-review correction. No tool is selected as execution-qualified, installed, imported or run by this document.

This design step changes only this document, the parent M design and BACKLOG, and its work is limited to local repository/installed-source text inspection, public specification-document reading and read-only verification. No candidate registry/repository metadata, package/source payload or runtime is acquired. No dependency addition, actual metadata/record/IP parse, connection code, real port/clock/timer, build, child/worker, native operation, fixture, signing/key operation, market/store/account data, MCP registration, activation or push in this design step; the user separately approved committing these three documents as `9cdd834`. The later [commit review correction](#m2a-commit-review-correction) records every execution of its review and reviewers, including `build:package` and full unit-suite runs in a disposable `git archive` copy. Dot stays PAUSED and judgment, notification, mail, retention and existing resource/time rules are unchanged.

## Outcome And Decision

M2a answers **which exact existing artifacts could be reviewed for which role, what their static evidence supports, and what is still missing**. It does not make an existing package trusted merely because it is installed, lock-declared, widely used, marked side-effect-free or exercised by another test.

Recommended direction, not adoption:

- Keep the proposed dedicated Node core HTTP/1.1 transport family. The executable, source/build/native closure, bootstrap and trust-store configuration remain unqualified; API documentation is not a binary pin.
- Treat the locally present `ip-address` declaration `10.7.4` as a candidate for syntax/subnet arithmetic review, not an approved public-destination policy or a permission to call its constructors.
- Keep the strict metadata decoder **unselected and blocked**. The limited inventory has not identified a decoder already qualified for duplicate-aware, bounded, noncanonical public JSON. This is not an exhaustive claim that no installed file contains such functionality.
- Do not bootstrap M using the still-under-audit `stream-json 3.8.0` / `stream-chain 4.4.1`. No fallback to a candidate, generic fetch, JSON.parse, another language/process, hand-written JSON lexer or a new dependency.

The first recommended slice is **M2a-1: bounded local inventory and role-specific accept/reject/gap tables**. This produces useful decisions without new helper code, executing a tool initializer, or implying M2b/M2c permission.

## Present Evidence And Its Limits

These are source-text observations for scoping, not a completed closure review or performance/security proof:

| Existing evidence | Observation | M2a interpretation |
|---|---|---|
| [package.json](../package.json) | `engines.node` is `>=22`; direct dependencies include Zod, not either target stream package; `ip-address` is an override | An engine range, declaration or override is not an exact usable runtime/tool identity |
| [package-lock.json](../package-lock.json) and installed `node_modules/ip-address/package.json` | Both declare `ip-address 10.7.4`; the lock also declares `ipaddr.js 1.9.1` | Local declarations agree, but neither authenticates installed file bytes or authorizes a transitive dependency as a new direct import |
| Installed `ip-address/dist/ip-address.js`, `ipv4.js`, `ipv6.js` | Entry exposes getters/requires; module-level code constructs address/range objects; `isGlobal` depends on embedded special-purpose tables and mapped-address behavior | Loading may perform address parsing and allocation before an explicit call. `sideEffects: false` is not evidence of an inert initializer. Full closure/table review is still needed |
| Installed `body-parser/lib/types/json.js` | Calls JSON.parse, including its normal object/array path | Not the required pre-collapse duplicate-key decoder; do not load its HTTP middleware/bootstrap |
| Installed `ajv/dist/compile/jtd/parse.js` | Parser compilation constructs generated functions | No adoption under the current no-code-generation/no-parser-execution boundary; presence of schema validation does not establish required lexical bounds |
| [unsignedIsolatedTypeScript.mjs](../test/helpers/unsignedIsolatedTypeScript.mjs) | Existing test-only source-analysis wrapper exposes a restricted JavaScript AST surface, not a strict metadata decoder | Its prior test use does not qualify another parse API, initializer or public JSON grammar. M2a-1 will not instantiate it |
| [boundedResponse.ts](../src/boundedResponse.ts) | Optional response URL, host-only comparison, whole-buffer fallbacks and nonfatal text decode | Not adopted as the M transport/decoder boundary; no shared-helper refactor in M2a |
| [M1 helper](../test/helpers/unsignedMetadataAcquisitionContracts.mjs) | Nine nullable profile references; synthetic summaries and all real authority denials | A static report must not fill real producer/authorization gaps or relabel real observations as synthetic |

The `794aa94` test-only reinforcement is the current baseline, not just `a21fc29`. Its historical full-suite/build/archive/platform results were not rerun in this design step; the `build:package` and unit-suite rerun recorded in the later [commit review correction](#m2a-commit-review-correction) is not counted as an M2a tool qualification either. No installed runtime version, resolved executable, CA store, live environment, resolver or credential is inspected to manufacture a clean host.

## Slices And Permission Stops

Approving the design does not authorize all rows. Every later request must name the slice and any exceptions; a failed row never grants a wider fallback.

| Slice | Proposed scope after separate approval | Explicitly not included |
|---|---|---|
| **M2a-1: local inventory and rejection gates** | Review a fixed manifest of already-present local text files; declared versions, actual entry paths, limited source hashes, imports and role gaps; small Markdown evidence tables | Loading/importing candidates, invoking parsers/AST tools, resolver probes, runtime introspection, binary/native reads, dependency resolution/install commands, new source acquisition or connection code |
| **M2a-2: static closure and effect profiles** | Review explicitly enumerated local transitive source edges and initializer paths, policy tables, documented API constraints and costs; stop on missing/unbounded/dynamic edges | Executing `require`, import, require.resolve, module hooks, candidate scripts, builtin initialization probes, source extraction via process.binding, VM evaluation or compilation |
| **M2a-3: static bundle decision** | Assemble source-bound role reports, disagreements, unresolved facts, proposed synthetic acceptance cases and a precise next permission request | Issuing a launch capability, setting M1 execution flags, installing a profile registry, runtime-byte projection, pin freeze, transport/clock/parser execution or public registration |
| **M2b: later private connection code** | Only a separately approved implementation with closed execution entry and fake-port models | Not granted by static conformity or by M2a-3; no actual imports/initialization or network effects |
| **M2c: later synthetic tool acceptance** | Separately approved invented metadata-byte decoding and specifically named initializer/address-parser exceptions | Not an automatic exception for IP parsing, subprocesses, native bootstrap, a fresh process, real clocks/timers, fixtures or network |
| **M3/M4/M5: later acquisition** | Only separately approved exact batches with independently qualified producers/approval/teardown | No permission follows from a complete static bundle or synthetic parser acceptance |

If existing files do not suffice, return `REQUIRES_SEPARATE_APPROVAL` with the missing artifact/effect and alternatives. Do not fetch runtime source, a package tarball, an advisory feed, an IP-table update or a decoder to finish the inventory. A future fresh launch, executable-binary inspection or pristine-host experiment needs explicit scope beyond the current source-text-only slices.

## M2a-1 Exact First Scope

### Input Manifest

Before a future inventory run, present exact repository-relative paths and expected purposes. The first proposed manifest is:

- `package.json`, `package-lock.json`.
- `src/boundedResponse.ts`, `test/helpers/unsignedIsolatedTypeScript.mjs`, `test/helpers/unsignedControllerData.mjs`, `test/helpers/unsignedMetadataAcquisitionContracts.mjs`.
- `node_modules/ip-address/package.json`, `node_modules/ip-address/dist/ip-address.js`, `node_modules/ip-address/dist/ipv4.js`, `node_modules/ip-address/dist/ipv6.js`, `node_modules/ip-address/dist/common.js`, `node_modules/ip-address/dist/v4/constants.js`, `node_modules/ip-address/dist/v6/constants.js`, `node_modules/ip-address/dist/v6/helpers.js`, `node_modules/ip-address/dist/address-error.js`.
- `node_modules/ipaddr.js/package.json`, `node_modules/ipaddr.js/lib/ipaddr.js`.
- `node_modules/body-parser/package.json`, `node_modules/body-parser/lib/types/json.js`.
- `node_modules/ajv/package.json`, `node_modules/ajv/dist/compile/jtd/parse.js`.

This is a 21-file seed inventory, **not** the complete execution closure. A referenced path is a proposed next review item, not permission to read an arbitrary import, require an entry or traverse the dependency tree. Rejected alternatives need only enough source evidence to explain their exclusion, not a full adoption audit. Additional local compiler/runtime source needs another exact manifest decision; it is not implicitly included by a source-analysis reference.

Reject unexpected symlink/alias paths (including parent components), special files or paths escaping the approved canonical repository root; do not repair permissions, follow HOME/global-package/config paths or resolve a missing package through PATH/network. Read identity/size and content with before/after identity checks; record drift instead of claiming a stable file. Ordinary read-only inspection is not a race-free future loader guarantee. Rechecking the approved actual bytes immediately before any later authorized load belongs to that later design.

### Proposed Local Audit Limits

These are limits for a future explicitly approved static review, not changes to M1, runtime, trading or notification limits, and not retrospective claims about today's read-only verification:

| Resource | Proposed bound |
|---|---:|
| Candidate identity/role combinations | 12 |
| M2a-1 approved distinct local files | 32, initially only the 21 named paths |
| One local source file | 16777216 bytes |
| M2a-1 distinct source bytes / processed bytes including rereads | 33554432 / 67108864 |
| M2a-2 closure files / edges | 64 / 128, each newly named path requires manifest inclusion |
| Whole M2a review series distinct source bytes / processed bytes | 67108864 / 134217728 |
| Retained audit report | 262144 UTF-8 bytes, no raw source dumps |

Check known size floors before content retention, charge failed/repeated reads and hash/copy/review passes, and keep unknown complete costs null. Per-slice counts do not reset the whole-series ledger; previous static reports are planning facts, not reusable execution authority. Do not silently increase limits or substitute a partial excerpt for a complete closure. Size limits alone do not prove allocation bounds for an unqualified inspection tool. No clock is needed to inspect these fixed counts; no elapsed-time or CPU-preemption claim is made.

### Acceptance And Output

M2a-1 finishes with a versioned human-readable report, not an executable module/profile store:

1. Baseline commit, manifest/lock digests, approved path set and local read identities are explicit. Separate declared version, local source digest and unavailable upstream authenticity; lock SRI is not a computed installed-tree digest.
2. Every candidate has a role, exact inspected entry/format, observed top-level effects, source references and a decision. Known rejections are distinct from unknown facts; no import or package manager is used to discover an entry.
3. The decoder row is either a justified already-present candidate requiring full static review, or an explicit blocker. No optimistic Boolean, generic JSON.parse fallback or self-qualification by the target stream packages.
4. All nine M1 profile roles have a gap row, including environment/authorization, even when no reusable library is proposed. No missing native/runtime source or boot evidence is replaced by a documentation version.
5. File/byte/report limits and unread/unlisted edges are visible. No summary says "closure complete" if a referenced file, version, loader condition, policy snapshot or source-to-binary relationship is unknown.
6. Dot PAUSED and protected-file/config hashes match. Only explicitly approved documentation changes occur; no candidate import, parser test, connection code or runtime launch is hidden in a verification shortcut.

## Static Qualification Criteria By Role

### Runtime, Bootstrap And Environment

The future bundle must distinguish the workspace inspection tool from the intended acquisition runtime. A successful source read or an existing test runner does not qualify its executable for M.

Required static evidence: exact proposed executable identity (unavailable until its own approved evidence collection), runtime source/build relationship, JS/native/loader/trust-store closure, platform/architecture/ABI, entry format/conditions, and a proposed fixed argument/environment manifest. Source text or a binary content hash alone is not publisher authentication or proof of runtime behavior. Missing bundled sources or dynamic libraries remain gaps; do not extract builtin source by running Node internals.

Review process-start effects before importing any candidate: loaders/preloads, snapshots, hooks, resolver/TLS/native initialization, lazy initialization, exit/error handling and logging. Installing guards after candidate imports cannot prove their initializers were inert. Existing `sideEffects` declarations, comments, type definitions and engine ranges are evidence to examine, not conformance receipts.

Propose a constructed minimal environment, not a dump/filter of live secrets. Account for inherited Node preload/module-search options, proxy variables, extra/system CA settings, OpenSSL configuration, key-log/client-key options and platform dynamic-loader influences. Do not read their values, `.npmrc`, keychains, credentials, HOME files or resolver configuration in M2a. [Node CLI documentation](https://nodejs.org/api/cli.html) is a source for the settings inventory, not a promise that one flag cleans every runtime/version. A fresh pristine process cannot be presumed; a later launch/bootstrap proposal must separately authorize its effects, or execution stays blocked.

### Strict Metadata Decoder

Select only a proven existing library mechanism for structured decoding. Require source-visible strict grammar/UTF-8 behavior, pre-collapse duplicate-key events after escape decoding, bounded key/token/numeric/depth/node work including unknown properties, explicit end/trailing-data handling and no object-key prototype effects. M1's exact caps remain unchanged. [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html) explains why duplicate names are not interoperable; this project deliberately requires refusal rather than silently choosing one value.

Review byte decoding, BOM and unpaired-surrogate policy, parser state and projection separately. A fatal UTF-8 decoder alone is not a duplicate-aware JSON parser; a schema validator after parsing cannot restore overwritten keys. Unknown parser internals remain a blocker for work/heap qualification. Disallow eval/generated-function compilation, network/file callbacks, native addons, WASM loaders, workers and target-package imports in this role unless an entirely separate later proposal is approved.

No actual metadata, record, IP or invented JSON parse runs in M2a. A later synthetic acceptance matrix should include escaped duplicate names, nested/unknown fields, malformed encodings, chunk boundaries, exact cap/one-past controls, trailing values, prototype-like keys and cancellation points. Writing that matrix is not permission to run it. If the scoped inventory yields no qualifying mechanism, stop with the missing decoder criteria and request a distinct tool/bootstrap decision; do not implement a custom lexer to avoid the stop.

### Address Policy, DNS And Peer Binding

Separate four things: address syntax/arithmetic, the reviewed allow/refuse policy data, the DNS producer and actual peer comparison. An IP library's `isGlobal` result alone does not establish the full M policy, real DNS behavior, TLS identity or routability. The [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) and [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) registries are policy-review inputs, not runtime destinations or an automatically refreshed table.

Review both families, overlapping-prefix precedence, unknown/N/A policy entries, mixed unsafe answers, mapped/compatible addresses, zone identifiers, translated/tunneled forms, alternate textual representations and embedded IPv4 semantics. Preserve the parent's prohibition on private/special-range and mapped-address bypasses. Exact reject/normalization rules and table versions must be explicitly reviewed before later use; do not adopt an installed package's broader default silently. Any OS peer normalization must remain tied to the approved chosen address, not permission to accept an unapproved DNS answer.

Bind source/table identity, row count, precedence and specification version; changed or unavailable policy evidence invalidates the profile for future consideration. No table update/fetch, resolver probe or constructor call in M2a. Selecting `ip-address` would still require review of all transitive/lazy initializer paths and separate approval to make a transitive dependency a new direct import or change the manifest.

[Node's DNS documentation](https://nodejs.org/docs/latest-v24.x/api/dns.html) distinguishes OS-backed lookup from direct DNS queries. Static review must expose resolver/native/thread/config effects and cancellation gaps; it cannot prove live cancellation, one-resolution behavior or the chosen peer. Do not call either DNS path, get resolver servers, change OS configuration or select a public-resolver fallback to close those gaps.

### HTTP, TLS, Clocks And Approval

Static transport requirements remain those of the parent: exact fixed HTTPS destinations, sequential owned HTTP/1.1 requests, no pooling/redirect/cache/auth fallback, complete raw headers with hard refusal, pre-retention charging, exact framing/end and independently observed settlement. Review every builtin/native initializer and error/teardown branch. A small wrapper around generic fetch or post-hoc body limits is not equivalent evidence. The [HTTP reference](https://nodejs.org/docs/latest-v24.x/api/http.html#httprequestoptions-callback) notes that a timeout setting is not itself an abort; a future owner needs explicit cancellation and close facts.

Review SNI/Host/hostname/chain checks, CA provenance, proxy bypass, protocol negotiation and client-key/key-log defaults against the exact intended runtime. [TLS documentation](https://nodejs.org/api/tls.html) is API evidence, not permission for a TLS handshake or certificate/key operation today. No actual TLS verifier, CA discovery or application/package signature work is performed.

The clock role requires an intended monotonic producer/domain and lifecycle/reset assumptions, but real clock reads or timers remain forbidden. M1 synthetic timestamps and phase-duration consistency are not real clock qualification. Timer ownership/reference/teardown and inability to preempt synchronous work must remain explicit, including unknowns.

The authorization role requires an independently trusted future approval producer and single-attempt binding; report hashes and `approved_supplied` fields cannot supply it. No new signing key, signature, secret, approval registry or durable replay store is created. If no already-approved authority exists, mark the role unavailable rather than minting a token from static source evidence.

## Evidence States And Bundle Rules

Per-role states are proposed report labels, not a new implemented state machine:

- `LISTED_UNREVIEWED`: candidate/source locator only.
- `SOURCE_BOUND`: the approved inspected source snapshot is identified; declaration/authenticity and source-to-runtime limits remain separate.
- `STATIC_GAPS`: some criteria lack evidence or the source/closure is incomplete.
- `STATIC_CONFORMANT_UNEXECUTED`: all stated static criteria have evidence for this role, including declared initialization effects, but no runtime acceptance or permission follows.
- `REJECTED_FOR_ROLE`: observed mismatch with a stated requirement, not a claim that the library is unsafe for other purposes.
- `UNAVAILABLE_SOURCE` / `REQUIRES_SEPARATE_APPROVAL`: missing source/evidence/effect; stop without another tool or path.

Record role/candidate, inspected path/format/conditions, source/version/digest provenance, reviewed edges, initializer effects, policy/cost facts, unmet criteria, baseline and intended next approval. Missing facts stay null/unknown, not zero/empty/complete. No source dump, raw external metadata, secrets or arbitrary response strings in the report.

A bundle binds the exact reports, approved path/edge manifest, baselines, mutually compatible versions/formats, policy identities and remaining gaps. One conformant role cannot stand in for another. Drift in any manifest/source/profile invalidates the bundle and requires review, not automatic pin refresh. Static output never grants execution, network/parser availability, authenticated approval, verified timestamps, persistence, package-byte verification or publisher identity. Do not feed it into M1 as an actual producer or change M1/B1/B2-A seals.

No finite static estimate proves V8 heap, OS/TLS/DNS work, synchronous interruption or teardown. Future cost review must retain bootstrap/parser/transport reservations as unknown until evidenced, preserve M1 per-kind wire overlap accounting, include inspection/copy/hash passes and charge failures. Do not borrow a previously approved native/runtime budget or reset the ledger between approval slices.

## Exit Criteria And Next Request

[Auxiliary exception](NATIVE_BAR_ADMISSION_WORKER_METADATA_PUBLIC_LOCATOR_AUXILIARY_EXCEPTION_DESIGN.md): documentation only; search approval separate.

The [G1/G2 scope gate](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_G2_QUALIFICATION_SCOPE_DESIGN.md) requires an exact nomination and separately approved bounded manifest before lookup; no candidate or read is granted.

The user-approved [G1/G2 retention extension](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_G2_RETENTION_EXTENSION_DESIGN.md) sets the current audit-document ceiling to 393216 bytes; earlier 262144 figures are historical. Only documentation is approved; G1/G2 and L01-L03 remain held.

See [M2a-2B2](NATIVE_BAR_ADMISSION_WORKER_METADATA_LOCATOR_SCOPE_DESIGN.md) for the unexecuted three-manifest proposal and separate source/retention budgets.

Its [document-only review](NATIVE_BAR_ADMISSION_WORKER_METADATA_LOCATOR_SCOPE_DESIGN.md#document-only-independent-review-and-commit-boundary) found no actionable issues; local commit is separately approved, not source access.

L01-L03 [metadata screen](NATIVE_BAR_ADMISSION_WORKER_METADATA_LOCATOR_SCREEN_REPORT.md): declarations agree; no decoder qualified.

Retention decision (660774a/M2a-2B2; user approved): unused78+391=469 -> notes88+469=557; report12/guard352/cap262144 unchanged; no refund/reset. G1/G2 held (D01-D08/B01-B08), L01-L03 held. Further source/effects/MCP/activation/commit need separate approval and reserved evidence/review space; else STOP. Dot PAUSED; judgment/notification unchanged.

Retention review: 2 doc-only reviewers clean; no source revalidation. Local commit approved.

The separately approved [M2a-2B1 two-file declaration screen](NATIVE_BAR_ADMISSION_WORKER_METADATA_DECLARATION_SCREEN_REPORT.md) at baseline `9eb15ed` reads only F01/F02, matches their historical identities, and retains three unverified declaration locators without following any installed metadata/public entry. Its later [document-only independent review](NATIVE_BAR_ADMISSION_WORKER_METADATA_DECLARATION_SCREEN_REPORT.md#document-only-independent-review-and-commit-boundary) reports no actionable findings in either reviewer's scope, not independent raw-source/declaration validation, and distinguishes the separately authorized local commit. It does not identify a qualifying decoder/runtime or alter role decisions. Its new actual/carried accounting is separate from the preceding document-only stages; all further paths, source passes and operational effects remain separate approvals.

The subsequent [M2a-2B decoder/bootstrap evidence-scope design](NATIVE_BAR_ADMISSION_WORKER_METADATA_DECODER_BOOTSTRAP_EVIDENCE_DESIGN.md) uses existing documents only at baseline `7cfefef`, preserving the intervening local-root privacy correction and current control hashes. Its [document-only independent review](NATIVE_BAR_ADMISSION_WORKER_METADATA_DECODER_BOOTSTRAP_EVIDENCE_DESIGN.md#independent-review-and-commit-boundary) reports no actionable findings from either reviewer and distinguishes the separately authorized local commit. It defines decoder/bootstrap evidence checklists, exact versus unnamed artifact slots, and proposes separately approved M2a-2B1 text screening of historical F01/F02 only. No new source, candidate selection, dependency, runtime probe or execution occurs; all role gaps and the carried ledger remain unchanged. The proposed screen/reservation and all later effects still need their own approval.

The later [M2a-3 static bundle decision](NATIVE_BAR_ADMISSION_WORKER_METADATA_STATIC_BUNDLE_DECISION.md) consolidates the reviewed reports at baseline `429ae7f`: nine explicit role gaps, six blocker groups, proposed unexecuted acceptance cases and a document-only decoder/bootstrap evidence-scope next request. Its [document-only independent review](NATIVE_BAR_ADMISSION_WORKER_METADATA_STATIC_BUNDLE_DECISION.md#independent-review-and-local-commit-boundary) reports no actionable findings from either reviewer and distinguishes the separately authorized local commit from the initial consolidation. The overall result remains `STATIC_GAPS`; no compatible qualified execution bundle or real profile is issued. It performs no new candidate-source read/revalidation, inherits the latest ledger without reset, and leaves all operational approvals separate. The earlier M2a-1 next-request wording below is historical, not a request to rerun its inventory.

The later [M2a-2 local closure/effect design](NATIVE_BAR_ADMISSION_WORKER_METADATA_CLOSURE_PROFILE_DESIGN.md) proposed exactly F07-F15 for reinspection plus E01 as F22. The user subsequently approved that M2a-2A inspection; its [report](NATIVE_BAR_ADMISSION_WORKER_METADATA_CLOSURE_PROFILE_REPORT.md) maps 17 identified literal require sites to admitted files and records source-visible initialization/call effects. Its [independent review](NATIVE_BAR_ADMISSION_WORKER_METADATA_CLOSURE_PROFILE_REPORT.md#independent-review-and-commit-boundary) reports no actionable findings after full source coverage was completed within a new reservation, and distinguishes the separately authorized local commit. It retains `STATIC_GAPS`, not runtime/host closure or execution qualification. Decoder/runtime/policy/authority gaps and rejected candidate decisions remain. Further source/review reservations or operational effects require their own decisions.

M2a-1 has subsequently been explicitly approved and its [21-file local inventory and role-gap report](NATIVE_BAR_ADMISSION_WORKER_METADATA_TOOL_INVENTORY.md) is recorded against baseline `c3b5607`. Its [independent review](NATIVE_BAR_ADMISSION_WORKER_METADATA_TOOL_INVENTORY.md#independent-review-and-commit-boundary) reports no findings from either read-only reviewer, preserves the carried source-work ledger and separately records the user's local-commit authorization. Local source identities do not grant execution. Seven concrete candidate-role screens retain only ip-address syntax/arithmetic for possible further static review; the strict decoder remains unidentified within scope. All nine profile roles retain gaps, with no executable bundle, dependency/import or permission change. The proposal below is historical to this design; M2a-2 and all later effects remain separate decisions.

M2a is complete only as a **static decision** when all roles have traceable observations, scope/closure limits and a justified rejection/gap/conformity result; unresolved blockers may legitimately be the outcome. It must not be reported as "all tools ready" while any runtime, decoder, policy, initialization, cost or authorization fact is unproved.

Recommended next request: approve **M2a-1's 21-file local text inventory, limited identities and role-specific rejection/gap tables only**. No helper/connection code or synthetic parser execution is needed for that first step. M2a-2 source closure, any extra file/path/binary scope, M2b code, M2c decoder/address/bootstrap tests, new-tool acquisition, fresh process and M3+ batches remain separate decisions.

## Verification Of This Design Step

This is a three-Markdown-file change only. Check local links/anchors, new-document ASCII/whitespace, exact Git scope and the existing-source/config hashes before and after. Do not run tests, package scripts, build:package, archive copies, import probes or historical multi-runtime checks as a shortcut. Existing tests may be described historically, not claimed to qualify a tool in this design step. The later [commit review correction](#m2a-commit-review-correction) records the checks its review ran in a disposable `git archive` copy.

The starting protected inventory includes all **561** existing `src`/`native`/`scripts`/`test` files plus package/lock/ignore entries counted by the checker, with aggregate SHA-256 `8f048a26b4be1965ed1219a8ebb241faba0e846e3cbcf7cf1abafe5b56a36c96`. Unlike the earlier 558-file check, it includes all three M1 files. Dot is PAUSED with full-configuration SHA-256 `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1`.

Public specifications were read as documents only, not candidate package/source acquisition or a local transport test. Moving Node documentation currently presents different release lines for different URLs; no such version is selected as the installed/executable pin. The version-specific CLI/TLS documentation URLs were unavailable through the document tool, so their available general API pages are cited only as unqualified background. Local source excerpts establish limited observations, not a whole-tree dependency audit. Final read-only verification results are recorded after the edits; at that point no commit, push or operational approval was implied.

Observed checks: all 21 seed paths name existing regular leaf files; their size metadata sums to 253280 bytes, within the proposed first-step envelope. This is only a path/count/size feasibility check, not a full component/closure review or a file-content qualification. Across these three Markdown files, 175 local file links and 126 heading anchors resolve; one historical statistical expression resembling a non-file Markdown link is excluded unchanged. New-document ASCII, trailing whitespace and final newline checks and tracked diff whitespace checks pass. The 561-file aggregate and Dot's PAUSED/full-configuration hash match the starting values. Git scope is exactly the three intended Markdown files. No test, dependency/tool import, actual parse, native/fixture/operational experiment, commit or push was run in this design step.

## M2a Commit Review Correction

2026-11-02 JST, review of `9cdd834` against the repository. The commit changes only this design, the parent M design and BACKLOG. Its cited facts hold:

- `package.json` requires Node `>=22`, lists Zod and neither target stream package as a dependency, and carries `ip-address` only as an override (`^10.7.1`).
- The lock and the installed package metadata both declare `ip-address 10.7.4`; only the installed metadata declares `sideEffects: false` (lockfile v3 has no such field), and the lock declares `ipaddr.js 1.9.1`.
- The `ip-address` entry exposes getters over `require`d modules. `ipv4.js` constructs `Address4` range objects at module level, and `isGlobal` depends on embedded special-purpose tables.
- `body-parser`'s JSON type calls `JSON.parse`, and AJV's JTD parser generates code.
- The 21 seed paths are regular files totalling 253280 bytes.

The review read the cited `ip-address`, `body-parser` and AJV files as text and did not import them itself. Local links, anchors, whitespace and the new document's ASCII check pass. In a `git archive` copy, `build:package` succeeds and the full unit suite passes 6373 of 6375 on Node 24 and Node 20 (no failures or cancellations, 2 existing skips). No test reads these documents. The review of `9cdd834` has no P1 or P2 finding.

Finding (P3, docs): the scope paragraph said no commit is performed, although the user separately approved and made the commit. A similar commit-status slip was corrected in earlier B2 and M1 documents.

Correction: the status line and scope paragraph name `9cdd834`. The two closing verification sentences now speak for the design step. The scope paragraph, the baseline evidence note and the verification section point here for the executed checks. The parent M design and BACKLOG record this correction. Slices, the 21-file manifest, limits, evidence states and every stop condition are unchanged. Two read-only reviews checked this correction. In its draft they found P3 slips: `sideEffects: false` attributed to the lock, sentences that still denied the executed checks (scope paragraph, baseline evidence note, verification section and this section's package-reading sentence), an incomplete parent sentence, a BACKLOG summary that misdescribed the status-line change, an overstated comparison with the M1 slip, and an incomplete list of the executions, including the interpreter path. Each is corrected above.

This correction imports no candidate and qualifies no package, tool or runtime. The commit review's own executions were read-only Git commands, `/usr/bin/python3 -I -B` scripts that checked or edited these documents or measured the seed files, and the `build:package` and unit-suite runs above. The two read-only reviewers ran only read-only shell and Git commands and `python3 -I -B` inspection scripts on these documents and the seed files; their bare `python3` resolved to `/usr/local/bin/python3`, a separate python.org 3.14 build. Dot stays PAUSED.
