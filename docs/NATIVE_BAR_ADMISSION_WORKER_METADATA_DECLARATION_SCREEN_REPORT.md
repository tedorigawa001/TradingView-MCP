# B2-M2a-2B1 Declaration Text Screen Report

Status: **two-file declaration screen and document-only independent review complete; three unverified locator proposals; no decoder/runtime selected or qualified**, 2026-11-02 JST. Baseline: `9eb15edf1e1f0939e89fddbbeab53f19c51f6009`. The user separately approved F01/F02 inspection within the reservation in the [M2a-2B design](NATIVE_BAR_ADMISSION_WORKER_METADATA_DECODER_BOOTSTRAP_EVIDENCE_DESIGN.md). This report is not a manifest parser, profile, pin freeze, actual metadata receipt or execution capability. At the initial inspection checkpoint, independent review and commit had not been performed; the [later document-only review and commit boundary](#document-only-independent-review-and-commit-boundary) records their separate authorization and review limits.

## Result And Scope

F01/F02 match their [R1 historical identities](NATIVE_BAR_ADMISSION_WORKER_METADATA_TOOL_INVENTORY.md#file-manifest-and-content-identities) in both this slice's initial and final snapshots. Complete text coverage is **116 + 1569 = 1685 lines / 60506 bytes**. No installed package file, directory listing, public entry, runtime/binary, source map or dependency source was probed/read. Source freshness is established for these two files only, not the other twenty historical files, ignored sources or any complete package/runtime tree.

Three declaration-only proposals L01-L03 below may help narrow a later metadata inspection. They are **not new qualified decoder candidates**, and each may prove irrelevant to raw JSON decoding. A JSON/schema/parser name or version does not establish lexical events, duplicate-key detection, early allocation bounds, an installed entry or safe initialization. No decoder/bootstrap requirement is discharged. The bundle stays `STATIC_GAPS`; decoder stays `REQUIRES_SEPARATE_APPROVAL`, runtime `UNAVAILABLE_SOURCE`, bootstrap/environment `STATIC_GAPS`. All other role gaps and C01-C07 decisions remain unchanged.

Only the report, its M2a-2B design note, parent M2a design note and BACKLOG change. There is no dependency acquisition/addition, manifest/candidate/record/IP/JSON/AST parse, import/initializer, helper/connection code, real port/clock/timer, build/test, child/worker, native read, fixture/signature/key, actual data operation, MCP registration, activation or push. Dot remains PAUSED; judgment, notification, mail, retention, limits and M1/B1/B2-A seals remain unchanged. The private local root remains withheld.

## Method And Coverage

The existing workspace inspection utility used filesystem/path/hash/assertion builtins, not any inspected package. Before retaining content, it checked the privately approved canonical root and parent components, regular single-link leaves, R1 identities and exact expected sizes, then admitted only these two paths. Read-only/no-follow descriptors matched their paths. Bounded size-plus-one reads and before/after descriptor/path/parent checks detected no growth, drift, alias, special file or failed read; descriptors closed in finally. Byte-preserving UTF-8 conversion and a NUL check were performed, not JSON grammar validation.

The initial snapshot retained complete text as line arrays. One sequential retained-text pass combined line-number display, human review and literal text locators without rescanning a whole body. F01 was displayed once in full; F02 was displayed in consecutive ranges 1-200, 201-400, 401-600, 601-800, 801-1000, 1001-1200, 1201-1400 and 1401-1569, with no truncation. This is not an AST/JSON parser or authenticated structured projection. The orchestration layer decoded only the inspector's own summary, never either manifest as JSON.

Names/versions below are readings of cited declaration passages, not verified registry/installed data or execution semantics. Resolved/integrity fields, URLs, script commands and optional/platform information were treated as untrusted text, never instructions. No URL was contacted, SRI decoded, package tree enumerated, manifest evaluated, code executed or environment/runtime probed. No raw lock body, contacts, arbitrary command, credential or private root is retained here. Ordinary Git/control-document work is not qualified as M's future runtime or measured complete internal work.

## Two-File Snapshot

| ID | Approved Path | Bytes | Lines | Content SHA-256 |
|---|---|---:|---:|---|
| F01 | `package.json` | 5389 | 116 | `585b722ac51f5999a4486b959c7b1276ec7fd4f0438d9300b387c09d2778bb0e` |
| F02 | `package-lock.json` | 55117 | 1569 | `f4c72172689e8b455f200dd78d93b5b29b83b359604fc3eeac58c5bc118c7a05` |

Both leaves retain device `16777229`, mode `33188` (regular 0644), uid `501`, gid `20`, link count `1`; sizes are above. F01 inode is `139499856`, with mtime_ns/ctime_ns both `1792692530376017493`; F02 inode is `139499855`, with both `1792807646385540307`. These are raw filesystem values, not trusted observation/first-seen times or elapsed-time evidence. No real clock was sampled; the report date is context, not a measured acquisition timestamp. ACLs, extended attributes, binary provenance and source-to-runtime trust are not qualified by these inspection checks.

Ordered two-file path/content-hash source-set SHA-256: `e8663f52a7f7c5046427f6f38cb28c11d7c5e0dbf091c3a41e3c912c6eb6329f`.

Ordered full-row identity-snapshot SHA-256: `4c7eaf3363b3e4c8cb5e5d559c69947925cfc1f51667026cc402cff7f6d5ec0c` (row fields: id, path, bytes, lines, sha256, identity). Both digests and all identities match across the two snapshots. These subset digests are intentionally not the 21-file/10-file historical set digests. They are local content bindings, not publisher authentication, signatures, real approval or a race-free future loader guarantee.

## Retained Declaration Locators

The proposal count is **3**, below the permitted maximum of five. R1's seven screened entry/role combinations are not relabeled ten source-reviewed candidates. Reserving room for possible further investigation never grants another read or changes the twelve-combination ceiling. No exact public decoder entry or API is known for these proposals.

| Locator | Declared Name / Version | Text Evidence | Why A Later Metadata Inspection Might Help | Still Unknown / Disposition |
|---|---|---|---|---|
| L01 | `json-schema-traverse` / `1.0.0` | F02:1012-1016; adjacent AJV dependency declaration at F02:400-408 names `^1.0.0` | Determine whether any documented entry is relevant to raw JSON bytes or only schema/object traversal; a JSON-schema-associated name is a locator, not functionality evidence | Installed metadata, public entry/format, API, duplicate/lexical/internal bounds and initialization all unknown. Not adopted; prior C04 rejection is not reopened |
| L02 | `json-schema-typed` / `8.0.2` | F02:1017-1021; SDK dependency text F02:71 names `^8.0.2` | Distinguish a potential decoding mechanism from declarations/types/schema utilities before proposing source review | Same unknowns; the name does not prove executable parsing exists. Not adopted or initialized |
| L03 | `zod-to-json-schema` / `3.25.2` | F02:1560-1567; SDK dependency F02:75 and the peer Zod passage at F02:1564-1566 | Establish whether any public entry could matter for byte decoding, rather than assume schema-related declarations satisfy the decoder role | Same unknowns; peer/dependency declarations do not qualify Zod or an adapter. C06 remains rejected for its original role |

These are low-confidence, declaration-only search proposals, not positive evidence of strict decoder suitability and not claims that those packages cannot serve other uses. Reading their own metadata could simply rule them out; no feature is inferred from their names. This is **not** `NO_NEW_LOCATOR`, because three proposals are retained, but **no qualifying new decoder/runtime is identified**. Labels L01-L03 are report references, not implemented M1 states or producer IDs.

### Potential Next Paths, Unread And Ungranted

| Locator | Exact Proposed Metadata Path | Basis / Limit |
|---|---|---|
| L01 | `node_modules/json-schema-traverse/package.json` | Conventional metadata-path proposal from the F02 directory key; existence/identity/size/content not probed |
| L02 | `node_modules/json-schema-typed/package.json` | Same; no directory enumeration or alternate path resolution |
| L03 | `node_modules/zod-to-json-schema/package.json` | Same; no public entry/source/API is named as approved |

These precise proposals are not source-derived public entry paths or evidence of current installation. Every lookup/stat/read needs separate exact approval and a new bounded reservation. If a proposed metadata file is absent, aliased, changed or unsuitable, stop; no alternate export/version/dependency tree or external fetch follows automatically. No part of the present F01/F02 reservation covers these three paths.

## Other Observations, Not Additional Proposals

- F01:97-107 and F02:11-38 declare direct/dev dependencies. No declaration in F01 establishes a separate strict bounded JSON decoder. Names and ranges in this limited manifest do not prove that no installed mechanism exists elsewhere.
- C03/C04-related body-parser 2.4.0 and AJV 8.20.0 declarations remain visible (F02:400-429/442-465), and Zod 4.6.7 is declared at F02:1551-1558. No old rejected body/parser/compiler/helper API was reopened; their previously read source was not reread or reprocessed.
- Optional peer `@cfworker/json-schema` is a range/optional declaration at F02:80-87, not a concrete newly inspected package entry. No corresponding installed identity/API is supplied by this screen, and it is not retained as a fourth proposal.
- Parser-name passages include eventsource-parser 3.1.0 (F02:680-687), fast-xml-parser 5.10.1 with a CLI locator (F02:783-804), parseurl and range-parser (F02:1123-1130/1215-1226). These declarations alone do not establish the required strict JSON API/events/bounds; no implementation behavior is asserted or CLI/source followed. They are not additional locator proposals or formal role rejections.
- Root Node `>=22` (F01:93-95 / F02:37-39), dev `@types/node` 26.1.0 (F02:370-377), and TypeScript 6.0.3 plus its Node range/CLI declarations (F02:1463-1474) do not identify an intended executable, clean bootstrap, source/build/ABI or trusted builtin/native environment. No compiler, CLI or runtime probe was used. Optional native/platform declarations likewise do not authorize a native read or reveal actual host selection.
- F01:15-31/44-91 lists build/CLI/lifecycle paths and commands. They remain data, not acquisition/bootstrap fallbacks. Registry locations and integrity text in F02 are declarations only; they are not acquired source bytes, provenance or an installed-tree checksum.

## Unresolved Evidence And Permission Stops

All M2a-2B D01-D08/B01-B08 facts remain unmet for any newly proposed mechanism. Strict UTF-8/grammar, escaped duplicate-key events, early key/token/depth/node/unknown-field bounds, internal allocation/work, exact entry/closure, trustworthy initialization and original-owner refusal/end/teardown remain unestablished. Bootstrap/runtime/environment, actual policy/DNS/peer/TLS, clocks and trusted execution authorization are not improved by root declarations. No real M1 profile or pin is filled, no synthetic label is applied to a real observation, and no limit/seal/notification condition is changed.

Recommended next decision: separately design/approve a bounded **metadata-only** manifest for L01-L03, or reject the low-confidence proposals and request a distinct decoder/tool/bootstrap decision. Source/code inspection, package acquisition or actual parsing is not a mandatory continuation. A package metadata result would still need a separate exact public-entry/closure/source/cost and later synthetic-acceptance plan. No automatic M2b/M2c/M3+ permission follows, and unknown runtime paths stay unnamed.

The present two disk passes and single retained pass are fully consumed. Independent review may use these documents only without a new candidate-source pass; any source reread or new path needs its own explicit reservation. Numerical headroom or a failed future hypothesis is not a refund/retry authority.

## Actual Work And Carried Ledger

| Work | Candidate Disk Read Bytes | Retained-Candidate Processing Bytes | Known Logical Charge |
|---|---:|---:|---:|
| Initial two-file snapshot | 60506 | 0 | 484048 |
| One sequential retained review/locator/display pass | 0 | 60506 | 484048 |
| Final two-file revalidation | 60506 | 0 | 484048 |
| This slice known total | 121012 | 60506 | 1452144 |

There were eight read calls including four zero-byte EOF probes over both snapshots. The full four-byte / **32-logical-byte growth headroom** stays reserved even though no extra byte was returned; no retry, failure or drift occurred. The decode/hash/copy/line-array/control-transfer work is charged by the existing eight-pass convention, not a measured complete heap/CPU/OS/elapsed bound. The retained pass traversed each source line once for numbered display and literal locators, without a second whole-body scan or truncated-display repair. Extra candidate passes were not taken.

Carry forward the reviewed totals: disk **3813717**, retained **545540**, known logical **34874056**, conservative allocation **48741056**. This approved slice adds the table above and reserves the full **1452176** including probes. Result: cumulative actual candidate disk bytes **3934729**, retained processing **606046**, known logical charge **36326200**, conservative allocation **50193232**. `(3934729 + 606046) x 8 = 36326200`; known work and reserved ceilings remain distinct, with prior unused ceilings retained. Complete inspection-tool costs remain unknown. No earlier slot/reservation is reset, reused or refunded.

Historical distinct-source union stays **22 files / 256999 bytes** because these two paths/identities match R1; no other historical source is revalidated here. The report and carried audit documents fit the unchanged 262144-byte retained-report cap; source ceilings and all M1/runtime bounds remain unchanged. The new paths above consume no source reservation until separately approved. Control-document/Git/config work is not zero total work, but no protected-source walk or other candidate-body verification is hidden in it.

## Verification

The final source snapshot matches both initial digests and every recorded F01/F02 identity/hash, with exactly two disk passes/file, one retained pass and 1685 lines covered. Four zero-byte probes and eight source read calls are retained in the accounting. No source read failed, display truncated, alternate path opened or candidate-body integrity pass added after this final revalidation. Subsequent edits are documentation only.

Document-only checks confirm both manifest rows against captured metadata, three declared name/version proposals and three explicitly unread/ungranted metadata paths, 23 cited line ranges within the captured files, source-pass and cumulative arithmetic, and all five immutable current control inputs. Five changed-content local Markdown links and one heading anchor resolve without source/external lookups. ASCII/newline/trailing-whitespace/private-root checks and tracked whitespace checks pass. All eight named audit documents, including this report, fit the unchanged 262144-byte cap.

At the initial inspection checkpoint, the beginning/end exact configuration comparison retained Dot PAUSED with full SHA-256 `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1`. Git scope was this new report, the M2a-2B design note, parent qualification note and BACKLOG; no staged or committed work had been performed. The rest of the source tree and installed/runtime artifacts were not revalidated. No test suite, candidate parser/initializer, actual acquisition or runtime qualification substituted for those checks. Independent review, commit and push were not part of that initial inspection step; any next source read still needs separate approval/reservation.

## Document-Only Independent Review And Commit Boundary

The user subsequently requested independent review using existing documents only and a local commit if clean. Two read-only reviewers examined the four-document change against baseline `9eb15ed`, without rereading F01/F02 or any cached candidate lines. A checked locator/evidence semantics, source/installed-entry uncertainty, preserved role rejections and later permission stops. B checked documented identities, citation bounds, accounting/caps, privacy provenance and design/parent/BACKLOG consistency. Both reported **no actionable findings in their document-only scopes**.

This does **not** independently revalidate underlying declaration names/versions, original source snapshots, inspection coverage, actual installed files, runtime behavior or configuration. The source facts remain the initial inspection's observations. Current document-table consistency and plausible line bounds are distinct from comparing raw source again. Review grants no metadata/entry lookup, decoder selection, profile, source pass or actual parser test.

A ran 22 bdo-prefixed shell commands including five Git commands; it read the full report/governing design/parent, relevant BACKLOG entries and targeted supporting passages, plus mandatory verification instructions. Truncated document displays were narrowed for the reviewed passages. B ran 18 including six Git commands; it read the full report/design, changed parent/BACKLOG text and targeted support, with automated document checks and no truncated output. One B checker compatibility attempt failed and was successfully rerun. Both reported zero candidate-source read/stat/hash, cached-source processing, config reads or new source reservations, and no writes, staging, commit, agent spawning or external access.

The parent's document-only row checker initially failed because a Markdown-row locator was overescaped; it was corrected to require exactly two historical R1 rows and rerun successfully. This was a control-checker preparation error, not a source drift or failed source read. No report claim was accepted on the failed result, no source was reread to repair it and no repository helper/connection code changed. The final checker derives the historical comparison from R1's Markdown, not cached source bodies or fresh source/hash operations.

| Review Actor | New Candidate Disk Bytes | New Cached/Retained Candidate Bytes | New Source Reservation |
|---|---:|---:|---:|
| A | 0 | 0 | 0 |
| B | 0 | 0 | 0 |
| Parent control-document/Git/config checks | 0 | 0 | 0 |

The completed inspection totals remain disk **3934729**, retained **606046**, known logical **36326200** and conservative allocation **50193232**, with the 32-byte logical probe headroom and prior unused ceilings retained. All initial source-pass slots stay consumed; no reset/refund/review reread slot is created. Control-document/Git work is not zero total work; complete internal/heap/elapsed/OS costs remain unknown. The five bound control inputs and the privacy correction stay unchanged. No fresh source/protected-file/ignored-file/runtime integrity claim is made, and private absolute roots remain withheld.

The parent clarified historical no-review/no-commit wording and appended this actual review result. B then reviewed the four-document additions and again reported no actionable findings, using two further bdo-prefixed shell commands including one Git command; its cumulative counts are 20 shell / seven Git commands. The follow-up performed no source/cache/config read, candidate stat/hash, source reservation, declaration/snapshot/coverage revalidation or edit/staging/commit. The report's three low-confidence proposals, all nine role gaps, original candidate rejections, limits/seals, judgment/notification/mail/retention conditions and Dot PAUSED remain unchanged. Parent configuration comparison is separate from the reviewers' limited observations.

The parent's final document-only checker compares the two source-report rows with R1's historical Markdown rows, not source files or cached source text. It checks the three proposal references/unread paths, 23 citation bounds, all carried arithmetic, current immutable control inputs and the retained-report cap. Nine changed-content document links and five heading anchors resolve, including both M2a-2B1 BACKLOG entries. ASCII/newline/trailing-whitespace/private-root and tracked whitespace checks pass; the eight named audit documents fit the unchanged 262144-byte cap. Exact Dot configuration comparisons match the beginning PAUSED/full-hash identity. Git scope is the four intended Markdown files; staged scope/whitespace and actual commit success are checked separately. No fresh source/protected-file validation, candidate parse/import, suite/build or operational test is implied.

The index was empty before staging, with filter/working-tree-encoding/ident attributes unspecified for the four intended paths. Only this report, the M2a-2B design note, parent qualification note and BACKLOG belong to the separately authorized local commit, using command overrides to disable hooks, signing and automatic Git maintenance. The actual commit ID is reported from Git history and the chat after success, not predicted here. No push, source/metadata lookup, dependency acquisition/addition, actual parse/import/initializer, connection implementation, real port/clock/timer/build/test/child/native/fixture/signature/data/MCP/activation effect follows from this administrative commit.
