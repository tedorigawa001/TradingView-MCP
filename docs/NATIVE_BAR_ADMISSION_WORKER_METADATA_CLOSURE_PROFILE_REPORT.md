# B2-M2a-2A Local Address Closure And Effect Report

Report version: **M2a-2A v1, static source inspection; independent review complete**, 2026-11-02 JST. Git baseline: `27f052d8728c798412d14e08110ab5bdfe6348dc`, with the [M2a-2 detailed design](NATIVE_BAR_ADMISSION_WORKER_METADATA_CLOSURE_PROFILE_DESIGN.md) separately approved while uncommitted for this exact inspection. Its earlier design-step observations are historical, not contradicted by the subsequently approved reads below. The [M2a-1 report](NATIVE_BAR_ADMISSION_WORKER_METADATA_TOOL_INVENTORY.md) is retained unchanged. The later [independent review and commit boundary](#independent-review-and-commit-boundary) distinguishes inspection, review and the separately authorized local commit.

## Result And Decision

**The ten-file text investigation is complete; C01 and the M bundle remain `STATIC_GAPS`, not execution-qualified.** Existing F07-F15 identities/content match M2a-1. Newly admitted F22 exists, is 3719 bytes / 95 lines, and references only admitted F13. All 17 identified literal require sites map to admitted local files (16 distinct caller/target pairs). No additional candidate path was probed or read.

This closes the previously unread E01 source target for the **visible local dependency graph under the stated hypothetical CommonJS layout**, not the host/runtime/bootstrap/native closure, hostile-input cost contract or public-destination policy. Full-text human review and a literal locator pass found no additional explicit module-load site in these bodies; that is not an AST-derived or runtime completeness proof. Host-supplied helpers, mutable builtins/exports/receivers and loader/cache behavior remain unqualified. There is no `STATIC_CONFORMANT_UNEXECUTED` result for the full address/DNS role, and no new profile, producer, permission or direct dependency.

Import is not inert: F09/F10 build address/range objects and parse fixed addresses during module evaluation. F22 itself eagerly requires F13 and defines helpers/string data; its regex-string generation functions are called later by Address6 methods, not during its own module initialization. Actual imports, regex/IP/metadata parsing, constructor calls and measurements were not performed.

## Scope And Evidence Method

The user approved F07-F15 plus proposed F22 only, text inspection/reporting and two integrity-only protected-file/config checks. Files were read using the trusted workspace utility's builtin filesystem/path/hash/assertion operations; no candidate or parser was imported, resolved or executed. Metadata was text, not JSON input. The inspector's own structured summary was decoded by the orchestration layer, not by an inspected dependency. Standard text locators do not execute any candidate regex pattern.

The canonical root was the approved canonical local checkout of this repository (absolute path withheld; not another clone, worktree or copy); there was no Documents alias/fallback. Before content retention, the inspector checked all sizes and parent components, rejected symlinks/nonregular leaves/unexpected hard links, and compared M2a-1 identities for F07-F15. Read-only/no-follow descriptors matched path identities; bounded size-plus-one reads, descriptor/path/parent checks before and after, byte-preserving UTF-8 checks and finally-close were used. No source drift, malformed text, missing target, failed read or budget fallback occurred. These observations do not prove a race-free future loader, publisher identity or absence of historical transient changes.

The first snapshot retained complete bodies in memory. Each complete file was displayed with line numbers for human review; F10 was covered in consecutive ranges 1-490, 491-1000 and 1001-1461, without rereading disk. A second retained-text pass located literal requires/ambient words and counted already-reviewed table rows. These locators are not a source parser or an independent code review. Comments mentioning `Buffer`, `os.networkInterfaces`, a Teredo nonce or registry URLs are not calls to those host services; no link, corpus or source-map was followed. No raw source, contact details, actual market/store record or credential is copied into this report.

## Manifest And Local Identities

Paths are repository-relative. F07-F15 keep the M2a-1 identifiers; F22 adds one distinct file, not a new version/publisher pin. Each observed content hash and full file identity is stable across this slice's two snapshots. The prior report retains the full F07-F15 identity rows; they were compared, not silently refreshed.

| ID | Inspected Path | Bytes | Lines | Local File SHA-256 |
|---|---|---:|---:|---|
| F07 | `node_modules/ip-address/package.json` | 2361 | 91 | `da8deffa558848bddae7ebcc7875cddb7edfc6a996de046560cf10ff0a4b0094` |
| F08 | `node_modules/ip-address/dist/ip-address.js` | 1772 | 35 | `3e38a4b349282e67a811aece46e273b1b24abbba2897bea707a00170ebdfc200` |
| F09 | `node_modules/ip-address/dist/ipv4.js` | 24641 | 602 | `69b33990eca8bf92704c0b47843c2869daa517ee5cb7cb170c052481bcb67c90` |
| F10 | `node_modules/ip-address/dist/ipv6.js` | 60225 | 1461 | `47f28ef06d0e49a9ea0980492e95258b1bb40952f12be268cc3c1221312b5e95` |
| F11 | `node_modules/ip-address/dist/common.js` | 6161 | 154 | `15b5caebd299350e045dfc4e83cc9f4a082eac6bd8eb3581b00036c55ca2072e` |
| F12 | `node_modules/ip-address/dist/v4/constants.js` | 2776 | 51 | `f8de9ffd2d22c3225856132439a631ff114fa1a0a91a2c16e7b51f924198db91` |
| F13 | `node_modules/ip-address/dist/v6/constants.js` | 5371 | 131 | `659c2a35b79e0e1a67f85bf5704446bc2439ea7fede7e99fa5b349a6094b2ce5` |
| F14 | `node_modules/ip-address/dist/v6/helpers.js` | 1710 | 54 | `80660cbe876ed3e7224268638582db8def929a53bc8822c5a5d8a0c321cca50f` |
| F15 | `node_modules/ip-address/dist/address-error.js` | 372 | 12 | `d0bb8495a78ce2a1e2c1ad231c15b3a8146fec8c8ea32b121fcbe1e032b9cc0e` |
| F22 | `node_modules/ip-address/dist/v6/regular-expressions.js` | 3719 | 95 | `31f99f670ac43ebe9694dc84b6cc9a00eb5af08f90c0ca0d2d8c5c63e5b67415` |

This snapshot totals **10 files / 109108 bytes**; the existing nine contribute 105389. The whole M2a distinct source union is now **22 files / 256999 bytes**, not a complete installed package tree. F22 is below its approved 262144-byte content limit; no parent's larger allowance was borrowed.

F22 full identity: device `16777229`, inode `149208604`, mode `33188`, uid `501`, gid `20`, link count `1`, size `3719`, mtime_ns and ctime_ns both `1792807646157621186`. Those filesystem timestamps are recorded metadata, not a verified observation time, server first-seen history, monotonic clock or elapsed-time proof. No real clock read occurred.

Source-set SHA-256 (ordered path/content-hash rows): `cf2b12e227a27b4b1c6addbd3c8842f1e0738858609cc35cb486adce20521e24`.

Complete identity-snapshot SHA-256 (ordered full rows): `62fbe707d6ffebd686d6d290f0370fe14d0f4dd8deb986a35113ac9447590487`.

These are local source observations, not lock SRI verification of an installed tree, upstream authenticity, an approval signature, a runtime-byte pin or M1 authority. F07:19/22/52-55 still declares version 10.7.4, `dist/ip-address.js`, Node >=12 and `sideEffects: false`; none overrides the positive initialization effects below. Lifecycle commands in F07:24-34 were not run. Source maps, type declarations, scripts and corpus paths remain outside scope.

## Literal Dependency Graph

All rows below are source-visible **eager module-body require call sites**. Getters delay exported property lookup, not the preceding require. The targets are explicit textual mappings within the admitted layout, not a successful Node resolver experiment. Each site counts once, including F10's repeated common target.

| Edge | Caller / Line | Raw Specifier | Admitted Target | Relevant Binding / Phase |
|---|---|---|---|---|
| D01 | F08:27 | `./ipv4` | F09 | Address4 binding; value getter at F08:28 |
| D02 | F08:29 | `./ipv6` | F10 | Address6 binding; value getter at F08:30 |
| D03 | F08:31 | `./address-error` | F15 | AddressError binding; value getter at F08:32 |
| D04 | F08:33 | `./v6/helpers` | F14 | Immediate import-star helper, then exports.v6 object |
| D05 | F09:28 | `./common` | F11 | Immediate namespace binding; isCorrect called at F09:31 |
| D06 | F09:29 | `./v4/constants` | F12 | Patterns, width and tables used during initialization/calls |
| D07 | F09:30 | `./address-error` | F15 | Constructor/error paths |
| D08 | F10:29 | `./common` | F11 | Immediate namespace; isCorrect at F10:37 |
| D09 | F10:30 | `./v4/constants` | F12 | Embedded IPv4 handling |
| D10 | F10:31 | `./v6/constants` | F13 | Immediate patterns/types; later top-level range construction |
| D11 | F10:32 | `./v6/helpers` | F14 | Formatting and parse-error escaping |
| D12 | F10:33 | `./ipv4` | F09 | Embedded IPv4/conversion calls, not a reverse F09-to-F10 edge |
| D13 | F10:34 | `./v6/regular-expressions` | F22 | Former E01; later regex-generation methods |
| D14 | F10:35 | `./address-error` | F15 | Error construction |
| D15 | F10:36 | `./common` | F11 | Separate source site; testBit in Teredo inspection |
| D16 | F11:13 | `./address-error` | F15 | Error construction in shared helpers |
| D17 | F22:31 | `./constants` | F13 | Immediate namespace for helper functions; no new file |

There are **17 sites / 16 distinct caller-target pairs**, across nine JavaScript bodies plus metadata F07. F12/F13/F14/F15 have no module-load site identified by full-text review; F07 is metadata, not an evaluated module. All targets of the identified sites are admitted. The named graph has no inter-file cycle: for example F10 -> F22 -> F13 and F10 -> F09 -> F11 -> F15 do not lead back. Object methods and callbacks are separate call/effect facts, not extra module-dependency edges. The old 35-locator count across F01-F21 remains a historical count and is not added to 17 or called a complete graph.

Under ordinary unmodified CommonJS semantics, F08 requires F09 before F10; F09 obtains common/constants/error definitions before building its range constants. F10 then requires its listed dependencies before building IPv6 ranges. Repeated common/constants loads would ordinarily reuse a cache, but no actual host/cache/hook behavior was qualified. F08/F09/F10/F22 first consult `this.__createBinding`, `this.__setModuleDefault` and `this.__importStar` before fallback implementations (respectively lines 2-24, 3-25, 4-26, 2-24). A supplied/prepopulated export object or modified host/prototypes could alter those call targets. This prevents promoting a closed literal graph into a complete initializer/host-effect guarantee.

No new unread source target arose from F22. That is not permission to resolve an alternative entry, inspect a builtin/native source, or chase a source-map comment. The source-visible host boundaries above are reported as gaps without probing their implementations.

## Phase-Specific Effect Profile

Classification is source evidence, not an implemented profile: `source_visible` records positive text/call-chain facts; `not_established` preserves unknown host/cost/lifetime facts; `role_mismatch` records a conflict with an inert-import/full-policy requirement. None is an execution receipt.

| Family / Phase | Classification | Source Evidence And Trigger | Known Floor / Unknowns / Consequence |
|---|---|---|---|
| Bootstrap and export setup, module evaluation | `source_visible` | F08:2-34, F09:3-31, F10:4-37, F22:2-31; require calls, namespace-helper setup, property definitions and exported functions | At least the 17 identified load sites plus object/function setup are source-visible. Runtime module evaluation counts, wrappers, loader work and heap are not measured |
| Address construction, module evaluation | `source_visible`, `role_mismatch` for inert import | F09:580-601 -> constructor F09:37-87 -> parse F09:112-122. F10:1443-1460 -> constructor F10:86-161 -> parse F10:691-778 | Parsing/allocation precedes explicit API use. The normal-source count below is not permission to import, a time limit or an observed runtime count |
| Shared closure setup, module evaluation | `source_visible` | F09:31 / F10:37 call F11:91-101 isCorrect, producing per-family closures | Helper execution itself is an initializer effect; the returned correctness function calls correctForm only later |
| Literal patterns and policy data, module evaluation | `source_visible` | F12:10-50; F13:11-130 create regex/table objects and literal data | Table/pattern allocation is distinct from matching; engine compilation, allocation sizes and ambient prototype behavior are unqualified |
| F22 initializer versus helpers | `source_visible` | F22:25-41 exports definitions, eagerly requires F13 and assigns ADDRESS_BOUNDARY string. F22:42-94 contains later helper bodies | No top-level call to simpleRegularExpression/possibleElisions or new RegExp is identified in F22. Helpers still entail input-dependent work when invoked |
| Regex generation, function call | `source_visible`, costs `not_established` | F10:1394-1440 -> F22:32-94. regularExpressionString constructs another Address6 and pattern strings; regularExpression calls new RegExp | Nested loops depend on helper arguments; normal eight-group address paths differ from direct/internal calls with arbitrary arguments. No adversarial regex, allocation or interruption bound is established |
| Address syntax and arithmetic, constructor/method call | `source_visible` | F09:69-87/112-122/283-397; F10:124-161/190-199/691-800; F11:47-119 | String scans, parseInt, split/map, BigInt conversion and cached binary strings occur on source-visible paths. Existing local guards do not establish a whole raw-input or host-work budget |
| Deferred formatting/callback dispatch, function call | `source_visible`, host closure `not_established` | F14:8-52; F09:555-559/570-576; F10:629-682/1317-1384; array callbacks, receiver methods, HTML escaping, optional input properties | Receiver fields/methods, arrays, exports and shared regex/data objects are not a frozen audited capability. Arbitrary receivers/getters/prototypes can change costs/effects |
| Error paths | `source_visible` | F15:4-9 extends ambient Error; F09:74-85/112-120; F10:129-158/703-740; F11:78-118 | Error creation and some formatted parseMessage content are present; isValid catches construction errors (F09:96-104 / F10:170-178). Error runtime hooks, complete failure costs and caller policy are unknown |
| Ambient I/O, clocks, registrations and generated execution | `not_established` as host guarantee | Full admitted text has no identified explicit filesystem/network/environment/real-clock/timer/randomness call, eval/new Function, native/worker load or registration API. Positive host inputs include require, exports, this and ambient Object/Error/RegExp/BigInt/string/array operations | Absence of an identified direct call is not absence of effects through an unqualified host, replaced helper or caller object. No builtin/OS source or runtime probe was used to fill this gap |
| Lifetime/teardown and shared mutation | `source_visible` state; teardown `not_established` | Module-level range tables and regex objects; exported mutable constants in F12/F13, class instances and lazily assigned _binaryZeroPad (F09:555-559 / F10:678-682) | State may live with module/cache/instances. No static freeze/invalidation authority or cleanup/abort/settlement contract is supplied; no actual timer/handle was created by this inspection |
| Public-destination decision | `role_mismatch` as a drop-in full M policy | F11:62-73; F09:548-549; F10:1140-1145/1285-1291 | Source-visible defaults/embedded-address delegation are not policy adoption, DNS/peer binding, TLS verification or route evidence |

### Source-Count And Cost Limits

F12:24-49 has 26 special-purpose rows, F13:105-129 has 25, and F13:27-60 has 34 type keys. With the unmodified displayed tables and ordinary builtin behavior, F09:580-601 describes 14 direct Address4 constructions plus 26 map-driven ones: 40. F10:1443-1460 describes 34 type-map plus 25 policy-map plus 11 direct Address6 constructions: 70. The derived **110 address-constructor invocations** are a source-level normal-initialization calculation, not executed input tests, host-observed counts, complete internal allocations or a memory/time maximum. Mutated tables, imports, prototypes and host helpers are not qualified by it.

The address length checks are not a raw-input preallocation contract: F09 strips/tests a subnet before its 15-character address check (F09:69-85); F10 scans subnet/zone before its groups-based address check (F10:124-158). A stripped zone can be longer than the remaining address, and optionalGroups is caller-supplied (F10:117-121). Direct methods/functions and mutable receiver fields also need their own caller/input constraints. Do not interpret 15/45-character post-processing checks as an acquired-data wire/token/depth cap or a synchronous interruption guarantee.

F13:84-88 comments warn about the exported RE_ZONE_STRING pattern's quadratic case; F10:142-148 instead searches a zone by index. This report records the text and separate paths, not a benchmark or a newly reproduced vulnerability. F22's pattern building remains call-time; regex literals in F12/F13 are still module-evaluation data/effects. Worst-case regex/BigInt/string/engine work, V8 heap, runtime bootstrap, cancellation and teardown stay unknown. The audit ledger multiplier below must not fill those blanks or change any M1/runtime cap.

## Policy And Unread Evidence

Reconfirmed observations, not changed allow/refuse rules:

- F11:62-73 skips null reachability rows, chooses the longest matching non-null entry and defaults to true if none matches. F09:548-549 also excludes its multicast range. F10:1285-1291 requires its native global-unicast range unless embeddedIPv4 delegates to IPv4 semantics.
- F10:1120-1145 / 813-827 makes mapped and NAT64 well-known embedding distinct from the notation flag is4 at F10:1109-1110. isGlobal may delegate to embedded IPv4 rather than simply deny every mapped form. That behavior is not approved M policy. Existing private/special-range and mapped-address bypass prohibitions, mixed-answer refusal and approved-peer binding remain unchanged.
- F09:69-77 permits a CIDR suffix; F10:124-161 handles CIDR and zone syntax. Library syntax/arithmetic utility is not a strict canonical DNS-answer gate, and no normalization wrapper or new dependency was introduced.
- F12:13-21 and F13:92-102 claim registry/corpus provenance. No registry, corpus, generator, upstream repository, security document, source map or declaration was fetched or inspected. Currentness, authenticity, complete prefix policy and data-to-runtime relationship remain unknown. Comments pointing at those artifacts are not an approval to open them.

F01-F06 and F16-F21 were not semantically reopened. The protected-file checker rereads F01-F06 only for integrity, charged below. M2a-1's rejected alternative decoder/generic transport candidates and unread E02-E06 chains retain their decisions; no fallback, recursive scan or decoder selection occurred.

## Nine Role Dispositions

| Role | Result | Narrow Change Or Remaining Gap |
|---|---|---|
| runtime | `UNAVAILABLE_SOURCE` | No exact intended executable/source/build/native/ABI qualification; M2a-1's engine-range evidence is not upgraded |
| bootstrap | `STATIC_GAPS` | Former E01 now mapped, all identified local requires in scope; positive initializer parsing/allocation remains. Host loader/helper/cache/builtin/environment/lifetime evidence absent |
| transport | `STATIC_GAPS` | No HTTP/1.1 owner, real DNS/peer, wire/header bounds, cancellation or independently observed close evidence added; rejected C07 stays rejected |
| address | `STATIC_GAPS` | C01's local source identity and call/effect paths improved, not adopted. Policy provenance, strict caller/normalization rules, DNS producer, peer binding and full cost/host contract remain unresolved |
| tls | `UNAVAILABLE_SOURCE` | No CA/SNI/hostname/chain/runtime/native source or real verifier qualified |
| decoder | `REQUIRES_SEPARATE_APPROVAL` | No strict bounded duplicate-aware metadata decoder identified; prior rejected mechanisms are not reopened |
| clock | `UNAVAILABLE_SOURCE` | No real monotonic producer/domain/timer evidence; filesystem timestamps are not substitutes |
| environment | `STATIC_GAPS` | No constructed qualified bootstrap/environment; no live option, secret, proxy, CA or resolver values read |
| authorization | `UNAVAILABLE_SOURCE` | Source hashes/report fields are not trusted approval, signature, replay authority or execution permission |

No role is marked conformant merely because F22 is now read. Overall `STATIC_GAPS` is a legitimate stopped static decision, not a partial authorization to acquire metadata.

## Carried Work And Reservations

This slice deliberately reserves all four source-pass slots conservatively: initial disk snapshot, full retained-text display, retained-text locator/count pass and final disk revalidation. The middle two reread no candidate file but are charged as full source-processing passes rather than free work. No reviewer was delegated; these slots are not reusable review authority. The underlying byte-preserving decode/hash/copy work is covered by the logical audit convention, not claimed as a measured complete tool/heap/CPU bound.

| Work | Actual Candidate File Read Bytes | Additional Retained-Source Processing Bytes | Logical Charge |
|---|---:|---:|---:|
| Initial ten-file snapshot | 109108 | 0 | 872864 |
| Complete line-number display from retained bodies | 0 | 109108 | 872864 |
| Literal edge/ambient locators and row counts from retained bodies | 0 | 109108 | 872864 |
| Final ten-file revalidation | 109108 | 0 | 872864 |
| Two protected-file integrity overlaps, F01-F06 twice | 207508 | 0 | 1660064 |
| This slice known total | 425724 | 218216 | 5151520 |

The two disk snapshots each made ten EOF probes; probes returned zero bytes, so actual candidate-read bytes are not incremented. The approved 40-byte / 320-logical-byte growth-probe ceiling is retained within the full reservation, not refunded or used for another read. No read failed, and both snapshots stayed within the ten-path/367533-byte per-pass content envelope.

Carry forward M2a-1 **2754761 read bytes / 22038088 logical bytes**, its conservative allocation **27635008**, and the design step's integrity overlap **207508 / 1660064**. Before this slice: **2962269 read bytes / 23698152 known logical bytes**, conservative allocation **29295072**. After the table above: **3387993 cumulative actual candidate-file read bytes**, plus this slice's separately identified **218216 retained-source processing bytes**, for **28849672 cumulative known logical bytes**. The eight-pass charge is bookkeeping, not evidence of unknown complete internal, elapsed, heap, OS or runtime costs.

The **42716512 logical-byte cumulative conservative allocation** from the approved design remains reserved in full, including unknown-size headroom, growth probes and prior review ceilings; do not refund it to authorize a new operation. It is below the unchanged whole-series 134217728-byte processed ceiling (and the conservative 67108864 planning cross-check). Counts remain 22 distinct files / 256999 distinct bytes, 17 identified dependency sites in this scoped graph, one retained C01 role candidate, and the unchanged 64-file/128-edge/12-candidate ceilings. The combined carried/new reports are checked against the unchanged 262144-byte retained-report cap. No M1 resource/time, retention, trading or notification rule is amended.

## Next Decision And Permission Stops

At the initial inspection checkpoint, M2a-2A stopped after this report and proposed independent review with a new explicit read reservation, because the four source-pass slots above were conservatively allocated. The user subsequently requested that review and a local commit after a clean result; its new reservation and actual work are recorded below. No old slot or unspent numerical size allowance was reused as permission. Any further candidate reread still needs an explicit bounded reservation.

After review, M2a-3 can assemble a justified **blocked static bundle decision** without pretending the nine roles are ready. Alternatively, a separate design can identify an exact decoder/tool or policy/runtime evidence manifest. No mandatory next network fetch or whole-tree scan follows from closing E01. New local paths/corpus/generator/binary investigation, runtime/bootstrap qualification, M2b closed connection code, M2c initializer/parser exceptions and M3+ acquisition keep separate approval boundaries.

No new source/closure investigation, dependency acquisition/addition, actual parse, helper/connection code, real port/clock/timer, build, child/worker, native/store read, fixture, signature/key, actual data operation, MCP registration or production activation is authorized by the report. Dot stays PAUSED; judgment/notification/mail/retention conditions and all existing seals stay unchanged. No commit or push is included in this slice.

## Verification

The final ten-file snapshot matches the starting source-set and complete identity-snapshot digests above; all nine carried identities/content hashes are unchanged, with no failed read or additional path. The two protected-file comparisons match the 561-file aggregate SHA-256 `8f048a26b4be1965ed1219a8ebb241faba0e846e3cbcf7cf1abafe5b56a36c96`. Dot remains PAUSED and its full configuration SHA-256 is unchanged at `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1`.

At the initial inspection checkpoint, document checks confirmed the ten manifest rows against the captured metadata, all 17 edge rows against the retained-text locator record, 16 distinct caller-target pairs, nine role rows, and 79 cited line ranges within their captured files. Source-count and carried/reserved byte arithmetic passed. The new report and design passed ASCII, trailing-whitespace and final-newline checks; tracked diff whitespace checks passed. Across the report, design, M2a parent and BACKLOG, 186 local links and 132 heading anchors resolved; one unchanged historical non-file expression was excluded. The carried inventory, new report, design and M2a parent together were below the 262144-byte audit-report cap.

At the initial inspection checkpoint, Git scope was the four intended Markdown files, including the pre-existing uncommitted design changes. No helper/code/package/lock/setting was changed, no candidate was imported or parsed, and no suite, build, child/worker/native/fixture/signing/data/operational/MCP experiment, independent review, commit or push had been performed. Those checks were source/document verification, not initializer/parser acceptance, runtime qualification or an execution-capacity token.

## Independent Review And Commit Boundary

The user subsequently requested independent review and a local commit if there were no remaining problems. Two read-only reviewers split the work: A checked the source-backed graph, eager/getter/host distinctions, normal-constructor counts, F22 phases and policy/input/cost caveats; B checked only control-document provenance, nine roles, scope, evidence labels and ledger arithmetic. Both ultimately reported **no actionable findings**. No runtime/host or security-wide qualification follows, and `STATIC_GAPS` is unchanged.

A initially withheld full sign-off: two retained-source displays were truncated, leaving parts of F10/F11 unreviewed. Visible claims had no discrepancy, but that was not counted as a complete clean review. Before repair, one additional bounded retained-text pass was explicitly reserved; no new disk read or source path was permitted. Small sequential displays then covered every line of F07-F15 and F22 (2686 lines / 109108 bytes) without truncation. A confirmed the graph and cited effects, while retaining the distinction between identified literal sites and AST/loader/host/semantic completeness. All three retained passes, including the two truncated ones, remain charged; nothing was refunded because the display was incomplete.

A ran five bdo-prefixed read-only shell commands and no Git command, one body read/file (109108 bytes), 20 read calls including ten zero-byte EOF probes, and three retained-source processing passes (327324 bytes). The display repair used the existing memory only, with zero new shell commands or disk reads. B's initial review ran nine bdo-prefixed control-document/arithmetic commands, no Git command and zero candidate-source/retained-source bytes. B did not claim to independently verify candidate behavior, protected-file integrity or Dot state. Neither reviewer wrote files, ran a suite/build/parser/import, followed a new reference or performed an operational experiment.

### New Review Reservation And Actual Work

The prior conservative allocation **42716512** remains intact, not reset. Before review source reads, the parent reserved A's one disk pass and two retained passes, one parent final disk pass, two protected-file integrity overlaps and twenty possible growth-probe bytes: **5151680 logical bytes**, cumulative **47868192**. The coverage repair reserved one further retained pass, **872864**, before execution, giving **6024544 new reserved logical bytes / 48741056 cumulative conservative bytes**. This separate reservation is administrative approval for limited review, not a strategy/runtime budget change or permission for another candidate/path/effect.

| Review Actor / Work | Candidate File Read Bytes | Retained-Source Processing Bytes | Known Logical Charge |
|---|---:|---:|---:|
| A, one disk pass plus three retained passes | 109108 | 327324 | 3491456 |
| B, control documents only | 0 | 0 | 0 |
| Parent, one final ten-file revalidation | 109108 | 0 | 872864 |
| Parent, two integrity overlaps of F01-F06 | 207508 | 0 | 1660064 |
| New review known total | 425724 | 327324 | 6024384 |

The twenty source EOF probes returned zero bytes. Their full 160-logical-byte headroom stays within the reservation, not recycled for another operation. No source read failed, extra candidate file was opened or baseline was refreshed. Starting from the inspection checkpoint above, cumulative actual candidate disk reads are now **3813717 bytes**; explicitly counted retained-source processing is **545540 bytes**; cumulative known logical charge is **34874056 bytes**. The conservative **48741056** allocation retains all prior unused ceilings and current probe headroom, below the unchanged M2a whole-series ceiling. Complete inspection-tool internal/heap/elapsed/OS costs remain unknown; the multiplier is not their proof or a runtime capacity token.

At review completion, before these documentation-only additions, the parent's final ten-file snapshot matches both source/identity digests above and every recorded file identity/hash. The two review-phase protected-file checks match the same 561-file aggregate and Dot PAUSED/full-configuration hash in Verification. Subsequent edits affect only documentation, with no further candidate read.

B then checked the review/ledger/commit-boundary additions and the historical-phase wording correction, using five further bdo-prefixed control-document/arithmetic commands, zero Git commands and zero candidate-source/retained-source or Dot/integrity bytes. It again reported no actionable findings. The old Verification paragraph's present-tense denial of independent review was explicitly limited to the initial inspection checkpoint; it does not deny the later review or separately authorized commit. B's review totals fourteen shell commands, no edits or commits. The parent's document-only checks confirm both ledgers' arithmetic, the ten manifest rows, 17 sites/16 pairs, nine roles, 79 cited line ranges, ASCII/newline/whitespace rules and the retained-report ceiling. Across the four changed documents, 190 local links and 136 heading anchors resolve; one historical non-file expression remains excluded. Final tracked/staged whitespace and exact commit scope are checked before committing, without a suite/build/candidate import or another source pass.

Only this report, the M2a-2 design, M2a parent design and BACKLOG belong to the separately authorized local commit. Git filters/working-tree encodings/ident attributes are unspecified for all four paths; the index was empty before staging. Hooks, signing and automatic Git maintenance are disabled for staging/commit. The resulting commit ID is reported from actual Git history after success, not predicted here. No push, source/code/setting change, tool activation, dependency/import/parse, actual port/clock/timer, build/test/native/fixture/signature/data operation or notification-condition change is authorized by this administrative commit. Dot stays PAUSED.
