# B2-M2a-2 Local Closure And Effect Profile Design

Status: **detailed design; M2a-2A inspection subsequently approved and reported**, 2026-11-02 JST. Baseline: `27f052d8728c798412d14e08110ab5bdfe6348dc`. This refines [M2a qualification boundaries](NATIVE_BAR_ADMISSION_WORKER_METADATA_TOOL_QUALIFICATION_DESIGN.md) using the reviewed [M2a-1 inventory](NATIVE_BAR_ADMISSION_WORKER_METADATA_TOOL_INVENTORY.md). The [subsequent inspection record](#m2a-2a-approved-inspection-record) distinguishes the historical design-only step from approved source reads. It does not reopen a rejected candidate or select an execution-qualified tool.

This step changes only this document, the M2a design and BACKLOG. It reads control documents and performs read-only Git/integrity checks, not additional candidate-source investigation. In particular, the prospective F22 below is not probed, opened, resolved or hashed in this step. No helper, parser, connection or profile-registry code is added. No dependency acquisition/addition, actual JSON/record/IP/AST parse, real port/clock/timer, build/test suite, child/worker, native read, fixture, signing, actual data operation, MCP registration, activation or push occurs. Dot stays PAUSED; judgment, notification, mail, retention, existing limits and seals remain unchanged. Committing these documents is a separate later decision.

## Recommended Next Slice

Request approval for **M2a-2A: a bounded, text-only address-source subgraph and effect report**, not the whole M2a-2 execution closure. Reinspect exactly F07-F15 and add only prospective F22. Resolve source references by explicit textual correspondence within this list, never by executing a resolver. If another target or unresolved loader condition appears, record it and stop expansion. Do not recurse merely because the 64-file ceiling has room.

This is the smallest useful next step: C01 is the only candidate retained by M2a-1, and its E01 reference is an explicit unresolved local source edge. Closing that edge might improve the address arithmetic/bootstrap evidence; it cannot supply the still-unidentified strict metadata decoder, actual runtime/loader, approved policy, DNS/peer producer, TLS, clock, environment or independent authority.

"Additional file" means an additional existing local source proposed for inspection, not a file to download, create, repair or install. F22's existence, identity, bytes, line count, further references and effects remain unknown until this exact inspection is separately approved.

## Exact Proposed Inspection Manifest

Paths are relative to the approved canonical local checkout of this repository (absolute path withheld; another clone, worktree or copy is not that root). The advertised Documents location was unavailable during prior work; do not follow or create an alias there. Reconfirm the approved canonical root before a later inspection; relocation needs an explicit scope decision, not automatic fallback.

| ID | Exact Local Path | Proposed Purpose | Current Evidence |
|---|---|---|---|
| F07 | `node_modules/ip-address/package.json` | Declared version, explicit main/format, side-effect/lifecycle declarations; read as text only | M2a-1 identity, 2361 bytes |
| F08 | `node_modules/ip-address/dist/ip-address.js` | Entry requires, re-exports and getter-triggered reachability | M2a-1 identity, 1772 bytes |
| F09 | `node_modules/ip-address/dist/ipv4.js` | IPv4 module initialization, constructors, range-table work and call paths | M2a-1 identity, 24641 bytes |
| F10 | `node_modules/ip-address/dist/ipv6.js` | IPv6 initialization, E01, embedded IPv4 and lazy/function paths | M2a-1 identity, 60225 bytes |
| F11 | `node_modules/ip-address/dist/common.js` | Shared predicates, reachability precedence and call-through effects | M2a-1 identity, 6161 bytes |
| F12 | `node_modules/ip-address/dist/v4/constants.js` | Literal table identity, construction and source-visible policy assumptions | M2a-1 identity, 2776 bytes |
| F13 | `node_modules/ip-address/dist/v6/constants.js` | IPv6 tables/pattern inputs and precedence assumptions | M2a-1 identity, 5371 bytes |
| F14 | `node_modules/ip-address/dist/v6/helpers.js` | Helper initialization and string/formatting dependencies reachable from the entry | M2a-1 identity, 1710 bytes |
| F15 | `node_modules/ip-address/dist/address-error.js` | Error-class initialization and error construction paths | M2a-1 identity, 372 bytes |
| F22 (proposed) | `node_modules/ip-address/dist/v6/regular-expressions.js` | Inspect E01 from F10:34 (`./v6/regular-expressions`), its initializer, regex construction and further edges | Unprobed; no existence, size, hash or behavior claim |

The nine existing files total **105389 bytes**; their expected individual hashes/identities are the inventory's F07-F15, not a new qualification. The new target's `.js` suffix is a proposed explicit artifact locator, not proof of Node resolution. If it is absent, an index/extension/export-condition alternative is not automatically allowed.

F01-F06 and F16-F21 are not reopened for semantic inspection. The protected-file checker may hash F01-F06 for integrity only; that overlap is separately charged below. Their historical findings stay historical. No source maps, declarations, tests, README, corpus/generator, license/security files, alternate package root, lock refresh or directory-tree discovery is implied. Such files need exact paths and a separate decision if evidence later requires them.

Do not chase E02's body-parser/debug/read chain, E03's AJV codegen dependencies, E04's Zod/VM/compiler references or E06's runtime/native paths to finish rejected roles. Installed Node binaries, builtin source extraction, CA/keychain/resolver/config/environment files, HOME/global caches and external registry/repository/specification retrieval are outside this next slice. A policy corpus's location must first be explicitly proposed; comments do not authorize finding it.

## Admission And Read Procedure

The future approval must name this ten-path manifest and the bounded text-only effects. A design approval alone grants no source read or launch. Use the existing trusted workspace inspection utility with builtin filesystem/path/hash/assertion operations; it is not a qualified acquisition runtime. Do not add a scanner/parser dependency or use an under-audit candidate to inspect itself.

1. Confirm baseline/control-report bindings and remaining cumulative budget without importing candidate code. Validate the canonical root and every approved path component. Refuse symlinks, escaping aliases, special leaves, unexpected hard links or component identity changes; do not repair permissions or substitute another root/package.
2. Check per-file and aggregate size floors before retention. Open read-only/no-follow, compare descriptor/path identity, bounded-read at most admitted size plus one byte, hash, and compare before/after device/inode/mode/owner/group/link count/size/mtime/ctime. Close in finally on success or failure. Charge the overflow probe and failed reads too. Ordinary inspections cannot prove race-free future loading or historical absence of transient changes.
3. F07-F15 must still match their recorded M2a-1 hashes and identities. Any difference is `STATIC_GAPS` / source drift; do not refresh the baseline to make it pass. F22 has no expected hash: record the observed local identity as new evidence, not upstream authenticity, first-seen history or executable permission. Reject malformed text rather than silently replacing bytes for semantic review; retain the byte hash independently.
4. Inspect complete admitted text for entry/initialization/call paths; literal require/import searches are locators only. Record ambiguous syntax, computed loading, getters, wrappers and generated code as unresolved instead of treating no literal hit as proof of closure. No AST/compiler/VM/eval, manifest JSON parse, regex execution, require/import/require.resolve, constructors or lifecycle scripts.
5. Revalidate the exact ten-file snapshot before finishing within the same read reservation. Hash or identity drift, missing bytes, unread regions, budget exhaustion or an unclassified reachable effect prevents a closed-subgraph claim. Stop without retries beyond the fixed reservation. Publish a bounded gap report even if the proposed target is absent or another edge blocks closure.

Reading metadata as text does not run its scripts. Inspection-tool summary decoding is not permission to parse inspected manifests, candidate records or addresses. Existing hashes authenticate neither publisher nor future runtime. No real clock or elapsed-time measurement is needed for this count/byte-based audit.

## Closure And Lifecycle Evidence

The proposed root is **C01's exact F08 CommonJS entry**, under the explicit hypothetical condition of its recorded local layout. Do not replace it with a cherry-picked deep entry to conceal known initializer work. Deep-entry alternatives can be described as unapproved proposals only. The report must distinguish the following scopes:

| Scope | What A Static Report May Establish | What Remains Outside It |
|---|---|---|
| Named local source subgraph | Every visible reachable source reference is mapped to an admitted file, or listed as a blocker, with conditions and full-text coverage stated | Runtime loader resolution, builtins/native closure and dynamically supplied targets |
| Module-evaluation effects | Source-visible allocations, helper calls, regex/address/range construction and export/getter behavior by phase | Observed initializer execution, actual allocation/time and absence of unknown host effects |
| Export/function reachability | Function/getter/constructor call edges and source-visible branches for intended arithmetic operations | Permission to invoke them, complete hostile-input timing bounds or caller enforcement |
| Public-destination policy | Installed literal data and precedence can be described and source-bound | Current IANA provenance, approval of defaults/normalization, DNS/peer/TLS/routability proof |

For each edge retain caller ID/line range, raw specifier or expression, phase/condition, proposed target ID or unknown, relevant export and disposition. Distinguish module-load requires from export getters, lazy function calls, callback registration/invocation and error paths. Count each source-site dependency edge once, including duplicate specifiers at different sites; use separate call/effect rows, not an inflated dependency count. The historical 35 literal occurrences across F01-F21 are not an already-complete graph or this subgraph's edge count. Record both counts, not their sum as a fabricated graph.

Computed/conditional load targets, package-name searches, alternate extension/index resolution, external callbacks, host globals or generated source without bounded admitted evidence are gaps. Cycles within admitted files must expose initialization order and partially initialized exports; do not flatten them into a harmless sorted list. If a missing target is discovered, name the observed raw reference and proposed exact next path where justifiable, mark it unread, and stop further source expansion. In-list review may finish to explain the blocker, but closure cannot pass. Do not guess the target's existence or behavior.

## Effect Profile And Cost Boundaries

Use human-readable rows, not a real M1 profile or executable registry. For every row record phase, source/call-chain evidence, classification (`source_visible`, `not_established`, `role_mismatch`), trigger, known count/size floor, unknown complete cost and consequence. "Not seen in reviewed text" is not "cannot occur". Required rows are:

| Effect Family | Required Static Questions |
|---|---|
| Bootstrap/exports | Which requires run immediately, which getters defer work, and what order/cycles/wrappers occur? |
| Allocation/parsing | Which top-level `new Address4` / `new Address6`, range maps and helper calls allocate or parse before explicit API use? |
| Regex/string/number work | Which patterns are literals or constructed, which inputs/loops are source-bounded, and which backtracking/BigInt/formatting costs are unknown? |
| Ambient access | Are filesystem, network, environment, process state, module search, logging, clocks/timers, randomness or host mutation referenced directly or through unresolved calls? |
| Deferred/error paths | Which callbacks/getters/functions defer work, throw, catch, mutate shared tables, generate code or reach external targets? |
| Policy/arithmetic | Which default/longest-prefix/null, mapped/translated/zone/subnet rules differ from the required boundary, without adopting those rules? |
| Teardown/lifetime | Is persistent state/registration visible; what cancellation, reference lifetime or shutdown fact is simply not established statically? |

M2a-1 already positively identifies module-level address parsing/allocation in F09/F10 and helper evaluation in F09/F10. Preserve it; neither `sideEffects: false`, an unused re-export nor lack of a network reference makes import inert or authorized. Distinguish regex literal compilation at module evaluation from matching on a later call. Documenting pattern text is not running an IP/regex test.

Source-visible fixed table counts (previously 26 IPv4 and 25 IPv6 literal rows) and literal byte lengths may be rechecked, not treated as heap/time upper bounds. Keep regex worst-case work, input-dependent loops/large-number conversion, engine/native allocation, interruption and host bootstrap costs unknown unless source evidence actually bounds them. Existing M1 budgets/seals are not filled by multiplying this audit's eight-pass accounting factor. No benchmark, synthetic parser execution, real clock or timer is authorized to fill a blank.

Do not adopt `isGlobal`, permissive syntax or installed table defaults as the M allow/refuse rule. Retain the parent's private/special-range and mapped-address bypass prohibitions, mixed-answer refusal and chosen-peer binding requirements. No table refresh, normalization implementation, new threshold or policy/notification change follows from a profile discrepancy.

## Proposed Reservation And Carried Ledger

Existing global ceilings remain: 12 candidate-role combinations; M2a-2 at most 64 closure files / 128 dependency edges; one source at most 16777216 bytes; whole M2a distinct source at most 67108864 bytes / processed charge at most 134217728 bytes; retained audit report at most 262144 UTF-8 bytes. These are ceilings, not authorization to use unspecified paths or reset earlier work.

Propose the following **narrower M2a-2A reservation only**, subject to its later approval:

| Item | Proposed Bound / Treatment |
|---|---|
| Local source manifest | Exactly ten files: nine rereads plus one new proposed path; no wildcard or automatic edge traversal |
| F22 admitted content | At most 262144 bytes; unknown now. Above this narrower limit: stop, not borrow the parent's 16 MiB allowance |
| One complete content pass | At most 367533 bytes: 105389 carried bytes + 262144 proposed bytes |
| All content passes | At most four reads/file across parent, revalidation and any separately requested review; all overlapping hash/excerpt/failed passes count |
| Content reservation | 1470132 bytes; eight-pass logical content charge 11761056 bytes |
| Growth probes | At most 40 extra bytes (ten files x four passes); reserve another 320 logical bytes, even if no growth occurs |
| Content/probe reservation | 11761376 logical bytes; failed/malformed/drifted files consume their reads; no retry/refund authority |
| Separate integrity overlap | Two protected-file/config checks, including F01-F06 twice: 207508 known candidate-overlap bytes / 1660064 logical bytes; integrity only, no additional semantic scope |
| Total future reservation | 13421440 logical bytes, content/probes plus integrity overlap; other complete inspection-tool costs remain unknown |
| Distinct source union | At most 22 files / 515424 bytes across M2a-1 and this proposal, not ten newly distinct files |
| Report | Check the carried M2a reports plus new closure/effect report together against 262144 bytes; no source dumps; BACKLOG links rather than duplicating the report |

Four reads/file is a total administrative reservation, not four rounds per actor. Allocate it before any future inspection: for example parent start/manual coverage/final validation use at most three passes and one remaining pass is reserved for a later explicitly requested reviewer. Reuse already retained admitted text where possible, while recording extra processing/hash/copy work. If more reviewers or independent rereads are needed, stop and seek another bounded reservation; reviewer delegation is not implicitly authorized by this design. The logical eight-pass charge is a conservative audit convention, not a measured V8/OS peak-memory or CPU proof. Unknown complete tool-internal costs remain unknown; do not present that multiplier as their upper bound.

The reviewed M2a-1 ledger carries **2754761 known candidate-file read bytes / 22038088 logical bytes**, with **27635008 logical bytes** conservatively allocated when both review ceilings are retained. Never drop the unused ceilings or reset the original work. This design step's two integrity-only protected-file checks reread F01-F06 twice: **207508 known bytes / 1660064 logical bytes**. They are not new candidate investigation, but count again: cumulative known **2962269 / 23698152**, conservative allocation **29295072**. Other integrity-only protected-file reads are not candidate semantic review; their complete internal costs remain unknown.

Adding the proposed future content/probe reservation to that conservative allocation would give **41056448 logical bytes**; including the separately reserved future integrity overlap gives **42716512 logical bytes**, below the unchanged whole-series ceiling (and below 67108864 as a conservative planning cross-check). This is arithmetic, not source permission or a completed capacity qualification. F22's actual bytes remain unknown, and previous allocated-but-unused work is not refunded to justify another effect. Record actual overflow probes/failed reads in a future report as well as retaining reserved ceilings. Extra integrity/verification candidate-overlap reads beyond the two reserved checks must be charged separately before they occur; the four-pass source allowance does not silently cover F01-F06 reads.

## Acceptance And Stop Results

M2a-2A is acceptable as a static report, including a blocked result, only when:

1. The exact approved manifest, baseline, old hashes, newly observed local F22 identity or absence, read coverage and cumulative actual/reserved ledger are explicit. No missing file, version/identity drift or size overflow is silently replaced.
2. The entry/edge table distinguishes eager, lazy, getter, constructor and error paths. Every unresolved edge/condition/host dependency is visible; literal search alone never earns "complete closure".
3. The effect table preserves known import-time parsing/allocation, distinguishes call-time behavior, and keeps unknown presence/cost/lifetime facts unknown. No initializer, address or metadata parser was executed to verify it.
4. A closed **named local source subgraph**, if justified by full admitted text, is labeled only with that scope and hypothetical entry/layout condition. Runtime/bootstrap/native completeness, policy adoption and execution remain blocked. Otherwise retain `STATIC_GAPS`; absence/drift/new paths can also require `UNAVAILABLE_SOURCE` / `REQUIRES_SEPARATE_APPROVAL`.
5. All nine role gaps are carried forward with narrow evidence changes explained. Address arithmetic source review cannot substitute for decoder, policy, runtime, transport, TLS, clock, environment or authorization. Do not grant C01 `STATIC_CONFORMANT_UNEXECUTED` for the full address/DNS policy while these criteria are unmet.
6. No M1 real profile reference/producer, registry, approval token, pin freeze or execution flag is created. Candidate rejection and improvement proposals do not amend existing policy, limits or notifications.
7. The report fits the retained-report cap, local links/anchors resolve, only authorized Markdown files change, and protected repository/config comparisons confirm Dot PAUSED and unchanged conditions. Read-only verification is not a parser test or a runtime acceptance receipt.

Failure produces the observed locator/condition, positive evidence, unknowns and the exact next approval needed. Do not auto-select another decoder, retry via another language/process, fetch source, launch a fresh host, or expand to rejected candidates. A missing F22 can be a valid stopped report, not a reason to install it.

## Later Decisions, Not Included

- Additional exact source paths, corpus/generator/provenance artifacts or a separate decoder investigation require a new manifest and budget decision. Their names may be proposed from approved text but their existence is not probed automatically.
- M2a-2B, if needed, is a follow-up **design** for the unresolved source/role evidence, not a preauthorized whole-tree scan. M2a-3 may assemble an explicitly blocked static bundle decision without claiming tools are ready.
- M2b closed connection code, M2c specifically named parser/initializer exceptions, runtime/native/bootstrap qualification, new acquisition/addition and M3+ requests retain their separate approvals. No numerical headroom or static result changes those boundaries.

Recommended next approval wording: **M2a-2A's exact F07-F15 plus proposed F22 local text inspection and bounded Markdown closure/effect report, with the two reserved read-only protected-file/config checks only**. F01-F06's integrity overlap is not semantic reinspection. No candidate import, actual parse, helper/connection implementation, runtime probe or operational activation. The four-pass reservation does not authorize a separate independent review unless requested.

## Verification Of This Design Step

Use only read-only control-document/Git checks and the existing protected-file/config checker. The 561-file starting aggregate is `8f048a26b4be1965ed1219a8ebb241faba0e846e3cbcf7cf1abafe5b56a36c96`. Dot is PAUSED with full configuration SHA-256 `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1`. Recheck after edits, charge its F01-F06 overlap as above, and check new-document ASCII/newline/whitespace, exact manifest/reservation arithmetic, local links/anchors and the three-document diff scope. Do not stat a proposed source merely to check a link; prospective paths are code text, not file links.

Observed read-only checks: the proposed table has exactly ten paths (nine carried plus one unprobed target); carried sizes and reservation/ledger arithmetic agree with the reviewed inventory. The new design passes ASCII, trailing-whitespace and final-newline checks. Across the new design, M2a design and BACKLOG, 180 local file links and 131 heading anchors resolve; one unchanged historical non-file expression is excluded. The carried inventory and new report/design text fit the retained-report ceiling. The proposed F22 is not a file link or an inspection input in these checks.

The two protected-file checks match the same 561-file aggregate and full Dot configuration hash above; Dot is PAUSED. Their candidate overlap is charged in this step's carried ledger, not hidden as free verification. The intended diff scope is exactly three Markdown files; tracked whitespace checks pass. These are document/integrity checks, not an independent review, parser acceptance test or runtime qualification. No suite, build, candidate import, source expansion, network fetch, operational experiment, commit or push was performed in this design step.

## M2a-2A Approved Inspection Record

The user subsequently approved the exact ten-file M2a-2A source inspection and reporting, without operational exceptions. The [closure/effect report](NATIVE_BAR_ADMISSION_WORKER_METADATA_CLOSURE_PROFILE_REPORT.md) records the completed inspection against Git baseline `27f052d` plus this approved uncommitted design. F07-F15 match the earlier local identities; F22 exists at 3719 bytes and adds only an admitted F13 require. All 17 identified literal sites (16 caller-target pairs) map locally, but the runtime/host/builtin and caller-input closure, policy, decoder and other role gaps remain. No execution qualification is granted.

The report carries the prior/design ledgers rather than resetting them. It charges two disk snapshots and two retained-source processing passes against all four source-pass slots, plus the two separately reserved integrity overlaps. Additional review rereads need a new explicit reservation, not a refund of unused size headroom. The design-only verification counts above remain historical. Subsequent work changes only this design, the M2a parent design, BACKLOG and the new report; no source/code/setting or operational condition changes, commit or push are part of that inspection slice. Dot remains PAUSED.

The subsequently requested [independent review](NATIVE_BAR_ADMISSION_WORKER_METADATA_CLOSURE_PROFILE_REPORT.md#independent-review-and-commit-boundary) used a new bounded reservation, retained both truncated displays as charged work and completed A's full source coverage before clean sign-off; B checked control documents only. Both reported no actionable findings. The report separates historical inspection counts from the later review ledger and the user's local-commit authorization. Static gaps, role criteria, source/path stops, limits and operational approval boundaries remain unchanged.
