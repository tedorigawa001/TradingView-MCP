# Paged transaction connection within stage A

2026-11-17 JST. The reviewed connection plan was approved for pure implementation and synthetic verification under existing limits. Stage B, expanded limits, production/native operations, commit, DOT, external models and backtests remain unapproved. Existing STOP and protected unallocated 765 bytes remain intact. No diagnostic/capacity ledger, native store, running process or chart is changed. PID-reuse/native qualification remains unverified.

## Implemented boundary

`src/internal/nativeBarCommittedPagedConnection.ts` exports only an internal fixed-limit `inspectCommittedPagedMaintenanceStageA(input)` entry. There is no profile parameter, environment switch, writer, restart or production integration. The server/MCP/native readers do not import it. `inspectCommittedPages` remains a preparation-only structure inspector; the connection does not invoke that full inspector or start another budget.

`src/internal/nativeBarCommittedSemantic.ts` now contains the shared original semantic/replay functions and terminal result formatting. The v3 public entry keeps its original byte collection, version/schema/hash validation, one reserve and one budget, then enters that shared semantic path. v3 retains embedded-v2 baseline rules and its original manifest allowance; the new connection's baseline/64-pair page restrictions are not added to the v3 entry. Existing v1/v2 records and source bytes are not rewritten.

All wire values retain their actual schema, canonical byte count and SHA-256. A new intent keeps a `baseline_ref`; its verified page rows are attached as a separate internal `resolved_baseline` reference. They are never serialized as a fabricated v2 intent or substituted into its raw hash. Common validation still proves the original receipts, baseline generation, provenance, eligibility, replay prefix and completion. Callers cannot provide a validated-view flag through either byte-input schema.

## Fixed grammar and bindings

| Wire role | Permitted schema in the connection |
| --- | --- |
| Root / result | `native-bar-committed-input-v4` / `native-bar-committed-result-v4` |
| Framing page | `native-bar-committed-page-v1` |
| Intent / manifest | `native-bar-committed-intent-v3` / `native-bar-committed-manifest-v3` |
| Attempt / event / completion | Corresponding `native-bar-committed-*-v3` |
| Receipt, payload, old maintenance/completion | Unchanged original v1 schemas |

The connection rejects v2 transaction records, the preparation root tag and unsupported combinations. The normal v3 entry rejects the new root/transaction tags. Empty/no-transaction history is allowed only with empty baseline collections and a null root baseline generation. Orphan journal records still refuse in the common transaction phase.

The root has `snapshot` and `snapshot_generation`. Snapshot contains `policy_hash`, the original evaluation fields, declared `baseline_generation`, `manifest_commitment`, four `collections` and ordered page references. Framing collections are exactly `baseline_maintenance`, `baseline_receipts`, `directory`, `inventory`, in that order. References enumerate their physical frames first; directory rows enumerate every subsequent evidence/journal frame exactly once. Root, pages and body occurrences all consume input bytes and frame counts. Missing, repeated, out-of-order, wrong-role, wrong-collection and unreferenced physical frames refuse.

Each framing page commits to canonical `{schema:"native-bar-committed-collection-v1",kind,entries:logicalRows}`. A page carries kind, ordinal, total pages, commitment and whole entries. Root references additionally bind its exact raw SHA-256 and entry count. Inventory rows use canonical order, while baseline receipt chronology/policy and original body binding are deliberately not inspected by this framing layer.

A manifest is one journal frame, directory-referenced once, with original chunk/maintenance identity, up to 64 pairs, ordinal, total pages and `collection_commitment`. Its shared logical commitment is SHA-256 of canonical `{schema:"native-bar-committed-manifest-collection-v1",pairs:allManifestPairsInDirectoryOrder}`. This hash excludes manifest framing/IDs and its own field; intent's ordered chunk-ID/raw-hash references bind that framing separately. Manifest bytes are not also counted as framing pages. Repeated physical input occurrences still count repeatedly; repeated references do not manufacture a second physical occurrence.

The new binding retains original object/root/parent/approval-claim fields, uses `backend_profile: committed-contract-paged-stage-a`, `backend_protocol: 2`, and replaces embedded `baseline` with `baseline_ref.receipts` / `.maintenance`, each containing commitment and count. Its `baseline_generation` remains the original canonical logical `{receipts,maintenance}` hash. New intent additionally declares `manifest_commitment` and its exact ordered manifest references and `pair_count`.

The binding graph is acyclic: logical rows -> collection commitments/page bytes -> page and manifest raw hashes -> intent raw hash -> attempt/event/completion hashes -> evaluation and root snapshot -> snapshot generation. Baseline pages do not contain descendant journal/root hashes. Existing approval references are still unverified supplied claims; no page gets its own synthetic approval or completion.

| Equality / integrity requirement | Verification location |
| --- | --- |
| Physical frame occurrence, page order/count, raw hashes, strict canonical UTF-8/schema, collection contents | Wire phase, before legacy diagnostics |
| Root snapshot generation and intent/root baseline declaration commitments/counts/generation | Wire phase; declaration equality only |
| Root's actual manifest-pair commitment and intent's matching declaration | Wire phase |
| Policy agreement, inventory identity/hash resolution, journal/evidence/inventory/intent/attempt hashes and evaluation tuple | Common pre-legacy phase, preserving v3 order |
| Supplied old receipt/payload binding and known old-batch copy time order | `legacyView`, before legacy-effect snapshot |
| Actual baseline canonical generation, chronology, policy, original receipt/body bindings and old maintenance references | Common transaction phase, after snapshot |
| Manifest set equality, ordered ordinal/total/commitment, chunk identity/raw hash, total target count, duplicate IDs/sequences/object scope | Common transaction phase, after snapshot |
| Attempt/intent/approval references, remaining action scope, event chain/time/clock/proofs, whole completion and uncertainty | Common replay and completion projection |

Individual hashes being valid never substitutes for those equalities. Non-target bodies and current source membership remain required for confirmed completion. Missing bodies still yield the original hold/unconfirmed-completion classification; missing terminal target bodies are permitted only through the original completion proof. Later v1 maintenance and corrected-clock recording continue through the same shared checks.

## Diagnostic phases and outer stop

The early copy-time contradiction yields a rejected internal decision with null effects and `not_evaluated`. A later baseline or store-wide sequence contradiction preserves the bounded frozen legacy snapshot, with non-null effects, `partial` and remaining uncertainty. The registry spans all old references, supplied receipt copies and frozen originals; only temporal predecessor state resets per old transaction. An unknown timestamp is not filled from a day, observation or another epoch. A quality hold cannot excuse a structural contradiction.

The shared decision contains status/reason, effects and their status, adoption state/blockers, read effect, unconfirmed completions, boundary, approval-time diagnostic and pair states. For v3 it is formatted into the unchanged v3 result. For the connection it appears under `semantic`, while the outer result always has `stage_a_only: true`, `adoption.state: blocked`, `read_effect: blocked` and all native/execution/authentication/history flags false. A conditional internal diagnostic is not permission to read native history or execute maintenance. Tests compare the full internal decision, including adoption/blockers/read effect, so the forced outer stop cannot hide a missing internal gate.

## Shared limits and accounting

| Resource | Existing fixed limit retained |
| --- | ---: |
| All supplied occurrences / one frame | 16 MiB / 1 MiB |
| Frames, including root/pages/bodies | 30,000 |
| Connection baseline / claimed active receipts | 1,024 / 1,024 |
| Selected pairs across all manifests | 1,024 |
| Framing rows / manifest pairs per frame | 512 / 64 |
| Work | 4,194,304 |
| Lexical depth / nodes per frame | 64 / 262,144 |
| Entire encoded result, including `semantic` | 8 MiB |

Other original action, identity, proof and schema bounds remain in force. The public v3 binding schema is unchanged, including its existing embedded baseline representation limits.

One budget is created at each entry and shared by raw preflight/copies, page and body parsing, schemas, hashes, canonical encodings, field/index visits, sort comparisons, common preprocessing, replay, diagnostic freeze and output encoding. Counts are checked before copying all source frames; derived collection entries are charged before retention, and every additional pass is charged. A stopped budget retains the first reason and cannot be resumed or replaced. All accepted output, including the nested semantic decision, passes the single output limit; failure uses the already bounded diagnostic reserve.

An old-limit negative case uses 176 synthetic pairs, about 3.2 MB of wire input. Its v3 semantic control fits the old budget, but combined new wire-plus-semantic work refuses as `work_limit` before the legacy snapshot. Replacing the budget just before common verification incorrectly permits that case and is detected. This is budget-continuity evidence, not a 176-pair capacity guarantee, RSS measurement or expanded-profile result. The test initially assumed a post-snapshot resource stop; inspection showed exhaustion earlier, and its expected phase was corrected without changing verification code or counting the failed draft as success.

## Synthetic verification and provenance

New small tests compare no-transaction reads, both operation kinds in intent/staged/pending/complete states, absent terminal targets, missing non-target receipt/payload/both with fixed inventory, unconfirmed completion, corrected-clock continuation, early copy-time failure, late baseline/sequence refusal, omitted optional times and old-record order reset. Binding negatives refresh outer hashes before testing contradictory declarations or stale inner references; malformed transport alone cannot satisfy a semantic guard test. v3's v2 manifest still accepts 65 pairs while the new manifest frame refuses more than 64.

The frozen `test/fixtures/committed-v3-connection-golden.json` was generated from the captured pre-connection source SHA-256 `03181cb4fb5cef15297565603e0bcd7491cd0da259d831b08f776b6a9b944f0a`, evaluated in memory with the unchanged pure contract dependencies. Eleven cases freeze input hashes, full result hashes and charged work. Their current v3 outputs match the reference, including early-null and later-partial diagnostics. The reference is not generated from the new shared semantic implementation during regression tests.

Mutation execution remains in memory. The harness now relocates a mutated shared dependency through its actual wrapper, resolves fixture URLs, and isolates child test-runner context so controls and failures are readable. Initial control failures from fixture-URL relocation were corrected before any connection mutation was credited. Only assertion failures after passing unmodified controls count. The previous fourteen semantic and twelve page conditions are retained, with twenty-four connection cases for declarations, collection binding, premature semantic checks, budget reset, inner incomplete gating, outer adoption/read stop, manifest metadata and the new wire parser's own page/directory checks. The expanded campaign initially exposed a surviving total-page-count mutant (C13): an added resealed overclaim fixture detects it without changing verification code. Earlier failed drafts are not counted as successful campaigns. Some conditions intentionally overlap between entry paths; case count is not a count of independent vulnerabilities or exhaustive coverage.

## Remaining before stage B

This is bounded connection evidence only. It does not allocate or verify 4,096 captures, a 256 MiB evidence bucket, 1,024-pair maximum operation or 328 MiB input. The original maximum construction sketch is still conditional, and the new wire grammar's actual maximum serialized sizes/nodes/work must be audited against it for both operations and mixed old maintenance. Current collection/string retention is not the expanded streaming/summary implementation. Independent OS peak/tree monitoring, supervisor/clock/cleanup qualification, frozen resource flags and separately approved fixture/result capacity are still required. No larger profile, normal-entry migration or production activation is authorized by this work.

## Connection implementation verification checkpoint

Build and no-emit type checking succeeded. **537 selected synthetic tests passed**, zero failures/skips: the previous 481, 54 connection/compatibility cases, and two new connection mutation-campaign tests. The child control/mutant runs are not added again to the test count. All **50 targeted mutation cases** were detected in the final run (14 shared semantic, 12 preparation-page, 24 connection); no survivor remains in that selected campaign. This is not exhaustive mutation or native/capacity qualification.

The eight moved guard/replay functions remain byte-identical to the captured pre-connection source. Reversing only the explicitly added baseline accessor and new-version manifest checks also reconstructs the entire old semantic helper section exactly. Eleven frozen old-v3 cases retain their exact inputs, results and work counts. The existing committed regression test and immutable v1 contracts are unchanged; the capacity ledger, diagnostic record and unrelated pending work are preserved. Artifact fingerprints at this implementation checkpoint follow; the P3 follow-up below records the updated test fingerprints. Build files were generated locally for these tests; these hashes do not establish the version loaded by any running MCP process.

| Artifact | SHA-256 |
| --- | --- |
| `src/nativeBarCommittedTransactions.ts` | `34be7d0cd925b5fa6280ca66edec0bfcb916f9e2ea843ed5d115e3945ca9a717` |
| `src/internal/nativeBarCommittedKernel.ts` | `05c72fd1d29339a29b193bb3d55bec37bacf56e0d7b6cd0d13b19bcb13f67f86` |
| `src/internal/nativeBarCommittedSemantic.ts` | `e85d04baf97307131b724c090c8ff1d2a50bf0e814e5ef73d9d1e29db92215fb` |
| `src/internal/nativeBarCommittedPagedConnection.ts` | `7031b99c377e1aa2c72943abf85f06d884132e41b022c0fc093b70078133161e` |
| `src/internal/nativeBarCommittedPages.ts` | `c9452eb22155b2a0025064f5265d548eac17906b4f0261a67f7ff02cc31ac65d` |
| `test/unit/nativeBarCommittedTransactions.test.mjs` | `43fe41d26e6ad2a631603d9d85d025101572e2e6758e64ffae91255d33d8e118` |
| `test/unit/nativeBarCommittedPagedConnection.test.mjs` | `458d3eb2f67689cbb053e0b5e12f7fee902b68cbb99b036f3c9694e5fe502832` |
| `test/unit/nativeBarCommittedConnectionMutations.test.mjs` | `5189179b5ad46d504f6a55c18396783f9005d6607ba7160755fbb15e2643a441` |
| `test/unit/nativeBarCommittedPagingMutations.test.mjs` | `62e64ab2b54561b3c5eb7c73bf7ca62d5ab63fb5bf8fea064d2ad4700c3eb771` |
| `test/helpers/committedConnectionFixture.mjs` | `02a3285f249c75d19b69076d963a60f7857645973895745bd989b14dfbc58f29` |
| `test/helpers/committedPagingMutationHarness.mjs` | `7ac3fccd7a98e011abe2ae8a0aa40655b48a0985d025bd24b26971945195433d` |
| `test/fixtures/committed-v3-connection-golden.json` | `f1de87430023fd1e33527255c917abe79f6a39b8b04776158e7fe0e7e421cd15` |

Final compiled mutant fingerprints before dependency relocation:

| Case | SHA-256 prefix |
| --- | --- |
| C01 | `a646167fb92b` |
| C02 | `ee091a99fadc` |
| C03 | `da5c0167a62d` |
| C04 | `c19c37c0f503` |
| C05 | `1a14900a6f19` |
| C06 | `398d4bd1dee5` |
| C07 | `104791a2bb42` |
| C08 | `5afcfa2388c8` |
| C09 | `2ed899efdccf` |
| C10 | `a3c67c8d7d8c` |
| C11 | `eb7d161a304d` |
| C12 | `ae711c962612` |
| C13 | `0b6a5904b093` |
| C14 | `2b54a361be54` |
| C15 | `21687c32ca34` |
| C16 | `0d5da93d9fda` |
| S01 | `92f6e59ea039` |
| S02 | `8a757f30127a` |
| S03 | `2afcddb3f744` |
| S04 | `7fc4a17e7605` |
| S05 | `32dfe21a48b8` |
| S06 | `3b46fb364571` |
| S07 | `64dddb70ede0` |
| S08 | `e2c69e3cc1aa` |
| G01 | `184a75a97d5a` |
| G02 | `8a757f30127a` |
| G03 | `7728ec84a929` |
| G04 | `5ea2b57ea878` |
| G05 | `f877438ce7d5` |
| G06 | `c25ecab6e998` |
| G07 | `8a4fe7083194` |
| G08 | `e2fa0fe447d5` |
| T01 | `fb7d0d74e62d` |
| T02 | `92f6e59ea039` |
| D01 | `bdd3852e4b60` |
| D02 | `839cc0d73586` |
| D03 | `bc5dfade3ea6` |
| O01 | `a50e94c100c6` |
| P01 | `b74873a46b21` |
| P02 | `4776a2c05036` |
| P03 | `0c1a98cad6eb` |
| P04 | `3543f3d61157` |
| P05 | `1ed9443c2b2a` |
| P06 | `fa9dae9a7a25` |
| P07 | `cf8e0b3516d2` |
| P08 | `b12ef19ce9cd` |
| P09 | `756a4d0823e1` |
| P10 | `220fa2524cbe` |
| P11 | `9ff710a18dff` |
| P12 | `22f97bf9044b` |

Only approved implementation/test/document files were changed. No existing pending file was removed, no capacity was reserved or charged, and no commit or runtime/production action was performed. Existing STOP and unallocated 765 bytes remain protected. Stage B and expanded-resource claims remain blocked by the obligations above.

## P3 follow-up: connection baseline metadata admission limit

The review found a coverage gap in the connection's own 1,024-receipt baseline guard. The previous preparation-only limit test exercised another module. A memory-only mutant removing this connection guard survived the existing connection suite, although a 1,025-receipt probe changed from the required wire refusal to a semantic hold. The guard itself was correct and is unchanged.

Two connection cases now use the same one-target intent fixture, adding only frozen receipt metadata for the other baseline members. No corresponding source bodies, attempts or completion are supplied. Both baseline references/generation and outer frame/collection/snapshot hashes are resealed so that a stale hash or another limit cannot substitute for the intended check. Both inputs are below 16 MiB, every frame is below 1 MiB, and work remains below 4,194,304.

| Baseline receipt metadata | Total bytes / largest frame | Charged work | Internal result | Outer result |
| ---: | ---: | ---: | --- | --- |
| 1,024 | 792,990 / 170,071 | 1,248,713 | `held / baseline_source_missing`, effects `evaluated`; blockers `baseline_source_missing`, `transaction_incomplete` | Adoption/read blocked; authority flags false |
| 1,025 | 793,757 / 170,237 | 879,054 | `rejected / store_receipt_limit`, effects null and `not_evaluated`; blocker `store_receipt_limit` | Adoption/read blocked; authority flags false |

The 1,024-member case proves admission to the semantic phase, not successful observation of 1,024 captures. Its known body shortage remains a quality hold; it has no unconfirmed completion or retired effects. The 1,025-member case has no projected pair state or effects because the count refuses in the wire phase. These are metadata boundary controls, not expanded-capacity, native-history or stage-B evidence.

New targeted mutant **C17** removes exactly `ref.kind === "baseline_receipts" && rows[ref.kind].length + page.entries.length > LIMITS.store_receipts` in the compiled connection module. Its SHA-256 prefix before import relocation is `2c66b3c85d05`. The two unmodified boundary controls pass; removing the guard makes the 1,025-member rejection assertion fail. The wire campaign now runs separate passing, nonempty controls for its small, cumulative-budget and baseline-boundary patterns before counting detections. No source module or numeric limit is changed; only these two test files and this verification record are updated for P3.

Follow-up verification: **539 selected synthetic tests passed**, zero failures/skips (the previous 537 plus the two boundary cases). **51 targeted mutation cases** were detected, including C17; child control/mutant executions are not counted again as separate suite tests. This is targeted coverage, not exhaustive mutation or capacity qualification. The implementation source and build artifacts retain their pre-follow-up hashes, including connection source `7031b99c377e1aa2c72943abf85f06d884132e41b022c0fc093b70078133161e`.

| Updated test artifact | SHA-256 |
| --- | --- |
| `test/unit/nativeBarCommittedPagedConnection.test.mjs` | `7922999dd4963ec69ec2bf1042404930398b8c17b486c0cc11ba68132d4759b2` |
| `test/unit/nativeBarCommittedConnectionMutations.test.mjs` | `39d01ceb8f33d97c2ba25b60e8da256cd387a0bc61027b8a303ceebafe132ece` |

Earlier checkpoint fingerprints/results above remain historical. Readback verifies the updated tests and record while retaining all other existing files, STOP and unallocated 765 bytes. No stage B, limit change, production operation, commit, DOT, external model or backtest was performed.

## Old-limit streaming/summary implementation checkpoint (2026-11-17 JST)

`src/internal/nativeBarCommittedStreaming.ts` adds a separate internal candidate entry, `inspectCommittedStreamingMaintenanceStageA`. It accepts the same v4 byte grammar. The existing v3 entry, fixed kernel limits and original bounded connection remain available as controls; there is no server, MCP, recorder, history-reader or executor connection to this candidate. Outer adoption/read/execution remain blocked regardless of the internal semantic verdict. This checkpoint does not enable stage B or production maintenance.

### Snapshot, body lifetime and canonical output

Each invocation owns a new frame catalog, packed summary arena and shared `StreamBudget`. Preflight validates every source brand, attachment, fixed size, frame count and aggregate size before the first private body copy. Only source references remain between reads. A scoped read copies one frame, hashes that same copy, verifies its expected role/position/length/hash and parses it; nested scoped reads refuse. Root snapshot generation is bound once. Rereads repeat the checks and consume the original budget, without fallback or retry. `finally` disposes the catalog and arena; no summaries/body-presence facts survive into another invocation.

The complete original schema, including all four series and every bar, must pass before a payload becomes a summary. Retained payload fields are capture cutoff and four observation times; raw hash, physical index, byte length, role and supplied-body presence remain in the frame record. Bars, arbitrary context/provenance strings and decoded/schema ASTs are not retained. Missing bodies cannot become present merely because another invocation supplied the same hash. Completed terminal targets may remain absent only under the existing bound completion proof, while non-target shortages preserve unconfirmed completion.

`nativeBarCommittedSummaryArena.ts` stores scalar references and object/array layouts in append-only packed word/string slabs. Read-only views expose the fields needed by the unchanged semantic checks without retaining prior ASTs. Only ASCII contract fields are retained by this arena; payload strings, including Unicode, are checked by the full original schema and discarded. Canonical streaming itself supports the existing Unicode, surrogate, escape and number spelling, including lone surrogates.

`nativeBarCommittedStreamCore.ts` streams canonical logical objects directly into hashing/comparison/size validation. Logical arrays are hashed as arrays, not as page hashes. Scoped manifest-row production completes a row before its source frame is released. Output fragments use at most 1,024 UTF-16 source units, keeping the source slice, escaped/sliced copies, comparison and UTF-8 conversion within the planned 64 KiB logical scratch allowance. A continuous 64-byte remainder spans fragments and scoped rows. Size scans, escaping, conversions, comparison/hash operations and additional visits are prepaid; no prefix digest escapes on failure. The first stopped reason remains latched. Shared semantic hash/size helpers perform the exact original encode/hash/scan operations when the budget is the v3 budget, retaining its work counts.

### Claims before semantics and immutable intent state

Let I be actual input bytes, F total frames, Fm manifest frames, M all manifest pair declarations (including duplicates/orphans), B baseline receipts and S selected targets after semantic admission. The candidate retains the existing I <= 16 MiB, F <= 30,000, B <= 1,024 and S <= 1,024 limits. Every new manifest has at most 64 pairs, and each pair physically supplies two 64-character hashes, so M <= min(64 Fm, floor(I/128)) <= 131,072. No S-based gate is applied to the wire declarations.

All M declarations retain only identity/sequence/hash references and source-frame/element locators. Full selected-pair receipt/proof state is materialized lazily, after the existing semantic pair-count/alias checks; original cheap fields are not copied into the scalar pool a second time. The wire manifest commitment rereads scoped full frames and hashes their original logical pair sequence without retaining the full M proofs. This permits the same late semantic rejection order and limits retained full target states to the existing S bound, including the final candidate that refuses. Tests count 1,024 and 1,025 declarations without truncating to S; those oversized duplicate fixtures then exhaust shared work before semantic adoption, rather than proving maximum-operation capacity. A smaller 64-declaration fixture reaches the original late `pair_alias` refusal with partial diagnostics.

The initial intent retains its raw hash, kind/ID, original approval reference/plan hash/time and baseline/manifest declaration references independently of every attempt. Its root/parent proof catalog is loaded only after the common one-intent check. Thus multiple intents do not construct multiple supposedly single-transaction catalogs. Root and at most 2,050 parent entries retain every proof attribute required for access, physical identity and target-scope checks. After those checks, their owning fields are cleared, packed proof cells/string regions are zeroed, and old proof views are revoked. Original approval state remains available throughout replay and final eligibility. Attempt, event and completion bodies are schema-validated on initial admission but retain only frame descriptors until replay. A fresh semantic cursor loads the current row, erases each consumed event/completion, strips the consumed action table and erases the superseded attempt. At most the active attempt and current replay row remain materialized; remaining permissions, clock/approval history and chain/ctime/uncertainty state remain separate bounded replay state. Actions are not erased before their scope has been compared and copied into the remaining-permission set. Selected manifest proofs are separate occurrences and remain available for event evidence/ctime checks. Slabs are not reused and work is not refunded; physical slab storage is released at invocation end.

The logical row model remains: manifest locator/identity fixed part <= 64 bytes per M; receipt-view fixed part <= 128 bytes per representation with R <= F+B+M; selected-pair fixed part <= 512 bytes per S; original-intent fixed part <= 512 bytes plus at most 1,024 manifest references at 64 bytes each; root/parent fixed parts <= 256 bytes each plus 64-byte index allowance per entry. Strings occupy the separate bounded pool; shared layout dictionaries, view/lookup/sequence/approval/clock maps and their growth must also be counted. These are packed logical data allowances, not V8 object-size or RSS measurements.

Every reserved arena word is charged before reservation. Conservatively, packed word reservations are <= 4W bytes for W <= 4,194,304 shared work, and scalar reservations are <= I. Each of the two append-only slab families rounds up by less than 64 KiB. Counters advance before slab allocation so a partially failed allocation cannot understate its reservation. Caller-owned input buffers, current private frame/text/parse/schema trees, JS indices/views/layouts, result/diagnostic structures and engine/GC overhead are separate terms. No 128 MiB index target or expanded-profile RSS/60-second qualification is claimed by these bounds.

The candidate's bounded `streaming` diagnostics are captured at `before_result_encoding`; canonical fragment/hash counters therefore exclude the final result encoding, while `work_charged` includes it. `arena_bytes`/`scalar_bytes` are high-water reservations, not current live data, serialized record size, ledger consumption or measured RSS. Erasure does not decrement them.

### Synthetic verification and limitations

Build and no-emit type checking succeeded. The final selected run passed **584 tests**, zero failures/skips: the prior 539 selected tests plus 44 streaming cases and one streaming mutation-campaign test. The unchanged eleven v3 goldens retain exact input/result hashes and charged work. **70 targeted mutation cases** were detected (the prior 51 plus ST01-ST19), each after a passing, nonempty control. Child controls/mutants are not added again to the suite count; this is targeted, overlapping coverage, not an exhaustive campaign. Mutation graphs are relocated entirely in memory with shared dependency identities; source/build/test modules are not overwritten.

Coverage includes scoped row/canonical equivalence; 63/64/65-byte and 64 KiB boundaries; escaping, Unicode and finite-number spellings; refusal before hash output on exhausted budget; preflight before copies; changed/detached sources, role/snapshot binding and nested-read refusal; proof revocation/original approval lifetime; both operations and replay states; a resumed attempt with a different approval; early-null versus late-partial diagnostics; root/parent access, alias and scope checks; complete targets without bodies; missing non-target receipt/payload/both across invocations; corrected-clock continuation; and one shared wire/semantic budget.

The candidate's own baseline metadata contrast uses the existing one-target intent fixture and resealed collections: 1,024 receipts reach `held / baseline_source_missing` with evaluated effects at 3,764,589 work; 1,025 refuse as `store_receipt_limit`, null effects/not evaluated, at 2,186,196 work. These are metadata controls, not 1,024-capture qualification. Two-target completed controls use 42,438 bytes/201,205 work for prune and 42,535 bytes/201,105 work for clock recovery. Both report one simultaneously retained private frame, two materialized targets and one proof catalog. Each completed control loads 18 replay rows, releases 17 before result formatting, retains one active attempt until invocation disposal, and reports a peak of two materialized compact replay rows. Packed reservations are 13,816 bytes; scalar reservations are 20,465/20,566 bytes respectively. Repeated scoped frame copies are counted, not presented as distinct inputs or RSS.

A separate earlier broader run including `nativeBarHistory.test.mjs` reported **645 tests: 643 passed, one failed, one skipped**. The failure is the existing PID-incarnation test at line 537, stopping with `store_lock_busy: active writer queue`; the history/access source and that test are unchanged. This is retained as failed/unconfirmed PID-reuse evidence, not converted into a pass by the successful selected pure suite. No repair of that environment/lock behavior is included here.

During development, an initial schema-view layout made the candidate's 1,024-receipt control exhaust work; a shared-layout direct lookup replaced repeated per-field searches without changing limits. A resumed-attempt fixture initially supplied an evaluation tick behind its new attempt and correctly held; its synthetic clock was corrected before crediting the control. The first reset-budget mutant survived a reason-only assertion because view costs still exhausted the original budget; the regression now also checks reported cumulative work. These earlier drafts are not counted as passing verification.

Before stage B, the actual simultaneous JS/index/replay allocation bounds, both-operation maximum constructions, work estimate, approved recording capacity, independent OS peak/tree/time monitoring and qualification remain open. Existing recovery design, production integration and PID-reuse qualifications also remain open. No limit, ledger allocation or STOP is changed; the protected unallocated 765 bytes and all unrelated pending work remain unchanged. There was no production operation, chart/DOT/external-model/backtest action or commit.

## Streaming P2/P3 correction checkpoint (2026-11-17 JST)

The preceding streaming checkpoint is historical. Review identified repeated full-manifest parsing per selected pair (P2), plus object-key array allocation before its budget payment (P3). Both corrections remain confined to the internal old-limit candidate and shared helpers' streaming branch. No limit, wire version, production entry or authority flag changes.

### Indexed manifest access and one private frame

After the complete canonical manifest and original schema pass, a prepaid scan records each pair's absolute byte start/end in two Uint32 entries (8 bytes per declaration). It does not perform eligibility, alias or target-scope checks. These locators supplement the cheap identity/sequence/hash summary; full pair proofs are still materialized only after the original common count/alias checks reach that pair. Thus the M-before-semantics bound and late diagnostic order are retained; invalid later declarations are not silently dropped or evaluated early.

`StreamFrames.readIndexed` owns at most one private raw frame. Its first access checks the existing physical index/role/size/raw hash and snapshot binding, copies the frame, and parses only the selected indexed pair through the original `pairSchema`. Later pairs use the same frozen private frame. Each hit still checks source attachment/size and hashes the current non-shared source for change detection; that full-frame hash cost is prepaid and is not represented as free work. There is no repeated full-page JSON/schema parsing per pair. Whole-manifest validation/commitment passes remain constant per wire phase; pair decoding/schema work follows the individual pair sizes. Source change or detachment stops immediately without retry.

An unrelated ordinary read or a different indexed frame evicts the cache before making another private copy. The miss branch does not retain the evicted cache in a local across replacement. Cached reads retain raw bytes only, not a prior decoded/schema AST. Nested reads refuse, all buffers remain bounded by the existing 1 MiB frame limit, and disposal clears the cache. The 36/64-pair controls report one indexed frame load and 35/63 hits with one private frame peak. Remaining target/replay state, original approval, proof erasure and the outer adoption stop are unchanged.

| One manifest page, intent-only control | Input bytes | Shared work after correction | Internal result |
| --- | ---: | ---: | --- |
| 36 pairs, prune | 287,293 | 1,437,666 | consistent, transaction incomplete |
| 36 pairs, clock recovery | 287,302 | 1,437,023 | consistent, transaction incomplete |
| 64 pairs, prune | 507,729 | 2,566,605 | consistent, transaction incomplete |
| 64 pairs, clock recovery | 507,738 | 2,565,458 | consistent, transaction incomplete |

The prune pre-fix controls exhausted work at 30/12 materialized pairs respectively. These are small valid-page regressions, not 1,024-pair or stage-B qualification. The cache removes repeated copying/decoding/schema validation on hits; repeated source-hash checks remain an explicitly charged page-size-dependent cost for future maximum-work estimation.

### Key enumeration prepayment

`prepaidObjectKeys` pays enumeration and key-array storage before calling Object.keys, then charges sort comparisons separately. A JSON.parse reviver records exact raw object key counts in an invocation-local WeakMap by parent identity. Reviver/metadata work is prepaid from lexical nodes. This avoids relying on raw textual traversal order, which differs from reviver order for integer-named keys. Strict schema clones use the proven frame maximum key count; arena views carry their shape count. Internally constructed two/three-field hash containers and fixed result objects have explicit internal bounds. Unregistered helper objects reserve the existing per-record node bound conservatively. Bounds are not input-schema fields, validation grants or replacements for the original schema checks, and unused prepayment is not refunded.

The summary arena also prepays keys before allocating their array/layout. Only current registered shapes use tighter bounds; the actual resulting key count must fit. Tests with one work unit remaining observe zero ownKeys calls for both canonical processing and summary construction. Unicode, number spelling, 64-byte residuals, 64 KiB output boundaries and canonical collection hashes remain covered. The normal v3 branch still performs its original operations and charged work.

### Verification and retained limitations

Build and no-emit type checking passed. The final selected run passed **592 tests**, zero failures/skips (the earlier 584 plus eight new cases). All eleven unchanged v3 golden input/result hashes and work counts match. **76 targeted mutation cases** were detected after passing nonempty controls: the previous 70 plus ST20-ST25 for cache reuse, reintroduced full-page parsing, post-enumeration payment, cached-source hash checking, ordinary-read eviction and pair-span corruption. No workspace module is overwritten by mutation execution; these targeted, overlapping cases are not exhaustive coverage.

New controls cover both operations with 36/64 pairs per page, canonical and summary prepayment, numeric-key reviver ordering, and cached source/eviction/nesting/attachment behavior. Existing early-null/late-partial diagnostics, pre-semantic 1,024/1,025 manifest claim counts, original approval/proof lifetime, replay cleanup, missing evidence and corrected-clock continuation still pass. The schema-output copy initially lacked raw key provenance during logical manifest hashing; the corrected scoped hash consumes the original raw pair objects only after complete schema success. This prevents conservative fallback charges per pair while preserving original logical bytes. That failed draft is not credited as passing verification.

The 1,024-baseline metadata control still reaches held/baseline_source_missing with evaluated effects at 4,078,920 shared work. The 1,025 control refuses as store_receipt_limit with null/not-evaluated effects at 2,441,337. Added prepayment moved the prior 68-pair budget fixture's stop before the legacy snapshot; the cumulative-budget control now uses 52 synthetic pairs to exercise the original post-snapshot stop, retaining its reason, partial-diagnostic and reported-total assertions. No budget or phase assertion was weakened to obtain a pass.

All resource counters and packed-memory allowances remain logical reservations rather than RSS measurements. New key-bound WeakMaps, span vectors, cache metadata, JS views/indices and engine/GC costs remain part of the simultaneous-allocation audit required before stage B. The existing PID-reuse failure/unconfirmed classification above is retained; that broader native-history test was not rerun or repaired here. Stage B, enlarged limits, native maintenance/recovery integration, production qualification and maximum-input timing/RSS remain unapproved/unverified. Existing STOP, protected unallocated 765 bytes, capacity ledger, connection diagnostic record and unrelated pending changes are preserved. No production operation, commit, restart, chart change, DOT, external model or backtest occurred.


