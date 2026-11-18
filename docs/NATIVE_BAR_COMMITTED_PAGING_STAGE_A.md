# Committed maintenance paging: stage A preparation

2026-11-17 JST. Stage A was approved for pure preparation and small synthetic tests under existing limits. Stage B, expanded limits, native operations, runtime integration, DOT, external models, backtests and commit remain unapproved. Existing STOP, unrelated uncommitted work and protected unallocated 765 bytes remain intact. No capacity reservation or ledger update is made here. PID-reuse/native qualification remains unverified.

## Implemented scope and compatibility

This preparation-only checkpoint is retained as historical evidence. The later bounded semantic connection and its current fingerprints are recorded in [the connection stage A record](NATIVE_BAR_COMMITTED_PAGED_CONNECTION_STAGE_A.md). That follow-up does not enable stage B or establish the conditional maximum resource estimates below.

`src/internal/nativeBarCommittedKernel.ts` contains the bounded canonical decoder/encoder, raw SHA-256, original schemas, immutable limits and latched shared budget extracted from the v3 verifier. The semantic/replay body of `src/nativeBarCommittedTransactions.ts` remains unchanged: its public exports, v3 input/result schemas, v1/v2 bytes and authority flags keep their contract. The early supplied-copy time-order check still precedes the diagnostic snapshot; the later global sequence check may return preserved partial diagnostics. Existing regression tests and the fourteen targeted mutations are rerun after extraction.

`src/internal/nativeBarCommittedPages.ts` is an internal preparation inspector, not a v4 history reader or a new transaction executor. It uses the same fixed limits: 16 MiB aggregate input, 1 MiB/frame, 30,000 frames, 1,024 active receipts, 1,024 selected pairs, 4,194,304 work units, 64 lexical depth and 262,144 nodes/frame. Preparation also caps its baseline receipt collection at 1,024. No option, environment setting, import or test helper can select expanded verification. It is not imported by the server, MCP, recorder or native reader.

Success means **page structure and schemas validated**, not transaction semantics or admissible history: `validation_scope: page_structure_and_schema_only`, `stage_a_only: true`, `semantic_replay_available: false`, adoption/read authority blocked, `effects: null` and `effects_status: not_evaluated`. The existing v3 verifier alone retains its current diagnostic semantic replay. Page checks do not prove receipt provenance, baseline/source agreement, eligibility, global sequence ownership across all evidence populations, approval, current inventory truth or completion; those must be connected to paged semantic replay before B capacity success can be claimed. A page-preparation success cannot hide or override a later semantic rejection.

## Exact preparation grammar and hash graph

Input is a dense ordinary array of attached nonresizable ArrayBuffers. All occurrence lengths and aggregate bounds are checked before copying; repeated buffers count repeatedly. Input is strict canonical UTF-8 JSON only, with bounded parsing and no fallback. One shared invocation budget covers copying, parsing, schema clones, hashes, encodings, sort comparisons, collection/index visits and result preparation. It never resets per page or collection.

* Root schema: `native-bar-committed-pages-preparation-v1`; fields `snapshot`, `snapshot_generation`.
* Snapshot fields: `policy_hash`, the unchanged v3 `evaluation` tuple, `baseline_generation`, `collections`, `pages`. There is no hash of the root inside its own snapshot.
* Collections appear exactly once in order: `baseline_maintenance`, `baseline_receipts`, `directory`, `inventory`, `manifest`. Each declares `kind`, `commitment`, `total_entries`. Empty collections have no pages and still commit to empty rows.
* A root page reference has `index`, `kind`, `ordinal`, `total_pages`, `entry_count`, exact raw `hash`. References enumerate all page frames in kind/ordinal order at physical indexes 1 through P. A page wrapper has schema `native-bar-committed-page-preparation-v1`, `kind`, `commitment`, `ordinal`, `total_pages`, `entries`.
* Each ordinary page has 1..512 rows; a manifest preparation page has 1..64 pairs. Rows remain whole. Body frames follow pages; directory indexes enumerate them exactly from P+1. Root, pages and body occurrences are all counted, with no unreferenced frame accepted.
* Directory rows use the original role/hash schema. Every body is raw-hashed, canonical-decoded and validated against its original immutable role schema. Inventory rows have unique recording-ID/role and strict canonical order. Baseline receipts have unique ID/sequence, increasing sequence/time and original policy/day checks; maintenance rows have increasing unique IDs. Manifest rows have increasing sequence and unique IDs across page boundaries. These collection checks do not replace the stronger replay checks.

For kind K, its commitment is SHA-256 of canonical `{schema:"native-bar-committed-collection-preparation-v1",kind:K,entries:logicalRows}`. It excludes page framing and its own commitment. Baseline generation remains SHA-256 of the exact canonical v2 logical object `{receipts,maintenance}`; it is not a hash of page hashes. Snapshot generation hashes the canonical snapshot, including collection commitments, exact ordered page references, baseline generation and evaluation tuple. Thus logical rows -> collection commitments/page bytes -> page hashes -> snapshot -> snapshot generation, with no cycle. Page regrouping changes snapshot generation but preserves logical baseline generation. New preparation tags cannot be relabelled as v3/v4 inputs or intent-v3 records.

This A implementation intentionally retains bounded decoded collection rows and canonical strings. It is not the planned streaming implementation for 328 MiB. Connecting a new paged intent, bounded payload summaries and semantic replay, and streaming original canonical commitments without full collection strings are still required. Immutable v2 intents remain constrained by their original embedded representation.

## Maximum-case construction specification, not executed input

`test/helpers/committedPagingSizing.mjs` computes counts and conservative template byte bounds without allocating expanded records or invoking expanded verification. Nine small witnesses at sequence widths/boundaries 1, 9, 10, 99, 100, 999, 1000, 1024 and 4096 use valid v1 receipt/payload schemas. Each pair is exactly 65,536 canonical bytes. ASCII padding occupies one provenance `corrections` field, under its 65,536-character bound; actual payloads are 65,130..65,133 bytes and receipts 403..406 bytes. The payload hash is resealed after padding. Distinct IDs/sequences and increasing UTC receipt times keep original identity/ordering rules. No unknown timestamp is inferred.

Construction uses 4,096 such pairs: exactly 268,435,456 bytes, **including all receipt bytes**. For prune, the first 1,024 captures dated 2026-01-01 onward are more than 90 days before a 2026-05-01 approval. The full operation has one new paged intent, sixteen 64-pair manifests, one 4,096-action attempt, eight legal events per pair and one whole completion. The initial baseline retains all 4,096 originals, the terminal source inventory retains 3,072 pairs, and deleted target bodies may remain only as saved supplied proof copies outside active inventory. Retaining all originals as proof keeps the combined evidence bucket exactly 256 MiB. One approval/completion per page is forbidden. The clock counterpart needs its own eligible ahead-time/clock tuple and quarantine event templates with the same bounded counts; the two operations must pass separately before claiming both kinds compatible.

The following are **template/specification upper bounds**, not measured input or constructed complete v4 transactions:

| Profile | Normal read | One complete maximum operation |
| --- | ---: | ---: |
| Captures in source/baseline / selected | 4,096 / 0 | 4,096 / 1,024 |
| Raw receipt + payload bytes | 268,435,456 | 268,435,456 |
| Logical evidence/journal frames | 8,192 | 16,403 |
| Directory / inventory / baseline pages | 16 / 16 / 0 | 33 / 12 / 8 |
| Total supplied frames including root | 8,225 | 16,457 |
| Root + framing bytes, upper bound | 3,489,792 | 6,387,168 |
| New journal bytes, upper bound | 0 | 20,258,816 |
| Total supplied bytes, upper bound | 271,925,248 | 295,081,440 |
| Lexical nodes, conditional template upper bound | 2,627,584 | 4,341,360 |

Byte assumptions are explicit: root <=64 KiB; page envelope <=512 bytes; directory row <=160 bytes; inventory row <=256; baseline receipt <=512; manifest pair <=2,048; event <=2,048; intent <=64 KiB; attempt <=1 MiB; completion <=256 KiB. The new journal includes manifest framing and is not counted again as root/inventory/baseline framing. There are no old-maintenance records in these two positive construction profiles; the separate mixed-legacy profile remains mandatory. Each page size implied by these bounds remains below 1 MiB. A complete new intent/attempt/event/completion grammar must establish every assumption and its acyclic binding before the construction becomes a valid v4 positive fixture. The arithmetic and the nine valid pair witnesses alone do not establish that proof.

The full profile remains 256 MiB evidence + 24 MiB old metadata + 32 MiB new journal + 16 MiB framing = **328 MiB / 343,932,928 bytes**, with disjoint categories, all buffer occurrences charged, no deletion credit and no recovery reset. Schema-valid exact 328 MiB coexistence is not asserted.

## Work and memory accounting obligations

The implemented A budget is the original latched budget, not the proposed expanded budget. Small page-preparation controls (page size 32) recorded these totals; they exclude semantic replay and are not RSS/latency/capacity evidence:

| Captures | Input bytes | Frames | Lexical nodes | Charged work |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 12,075 | 8 | 856 | 17,298 |
| 8 | 41,093 | 20 | 2,986 | 57,492 |
| 16 | 79,797 | 36 | 5,826 | 111,115 |
| 32 | 157,891 | 70 | 11,558 | 219,406 |
| 64 | 314,479 | 139 | 23,048 | 436,569 |

The future audit must itemize input copy/preflight; UTF-8 and lexical scans; canonical/schema passes; raw and collection digests; inventory reference resolution and baseline revalidation; early raw-copy versus later combined legacy ordering; every legacy/copy/baseline sequence-owner registration; role/provenance/eligibility/unknown-time checks; replay and completion projection; and snapshot/result reserve. Shared IDs do not excuse repeated actual passes. All sorts charge comparisons. Summaries must retain proof origin and exact generation after payload eviction. The frozen legacy diagnostic snapshot must coexist with later indexes without moving the early-stop boundary.

An **unproven conditional envelope** in the sizing helper is `32*ceil(inputBytes/64) + 96*lexicalNodes + 33,554,432` work units, giving 421,765,120 for the normal construction and 597,865,728 for the full construction, below the proposed acceptance threshold 805,306,368 (25% margin under 1,073,741,824). The coefficients, template node bounds, full/mixed-store membership counts and semantic replay visits have not been audited against an expanded implementation. The helper returns `work_sufficiency_proven: false`. This is an explicit remaining proof obligation, not evidence that A has certified B's work sufficiency, and may not justify enabling B or changing a ceiling.

Keep the proposed memory model: 328 MiB caller input + 8 MiB scratch + 96 MiB current decode/schema + 128 MiB summaries/indexes + 64 MiB canonical/output staging + 128 MiB allocator retention + 272 MiB margin = 1,024 MiB incremental RSS. Current A collection retention is not evidence for this model. Per-structure byte/count bounds, source-buffer lifetimes, transfers/clones, retained diagnostics and streaming commitment buffers must be audited. No disk/recording reservation is implied; persisted B fixtures/results need a separately identified approved destination/capacity source, never the protected 765 bytes.

## Measurement environment and B gate

The observed A test environment is Node v24.18.0, V8 13.6.233.17-node.50, darwin arm64, OS release 27.2.0. Node binary SHA-256 is `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`; package-lock SHA-256 is `d27be13b97d2e1645d4e221e07ac7ca4a7efa7b5ae5f416fa6e2c95050f94231`. These identify A's environment, not a running MCP connection or production build. B must freeze its actual binary, flags, environment, dependency/module/fixture hashes and supervisor before approval; no B flags are enabled here.

Use the independent supervisor's `process.hrtime.bigint()` for R0 acquisition timestamps, t0, t1 and the 60,000,000,000 ns deadline. A 2,000-read local probe observed a minimum positive step of 41 ns; this is only a small resolution observation, not an accuracy, scheduling or deadline guarantee. B must qualify monotonic behavior in its frozen environment. Never subtract UTC or another process's counter from this clock. Warm-up/R0 <=256 MiB precedes any case input allocation; t0 precedes first transfer; t1 requires bounded result validation, all owned processes reaped and transport/I/O closed. Preserve the plan's incremental 1 GiB, candidate/tree 2 GiB and 60-second actual limits and stage-wide stop rules.

Proposed Darwin peak acquisition is an external OS `/usr/bin/time -l` wrapper around **each** owned generator/verifier worker, with its peak-RSS unit/parser fixed and checked against Node's diagnostic `resourceUsage().maxRSS` (KiB) on small controls. Independent live sampling must use a bounded, explicitly accounted OS sampler at <=10 ms; wrapper, sampler, producer, verifier and supervisor processes all belong to the monitored tree. The wrapper/parser, sampling route, unit agreement, process identity/reaping, monitor overhead, stall/allocation control stops and cleanup have **not** been implemented/qualified. A self-reported heap metric or sampled RSS alone cannot substitute for independent peak/tree accounting. Their availability must be demonstrated before B; absence, monitor gaps or unit ambiguity stop the stage. No OS wrapper, expanded worker or capacity measurement was launched by A.

Remaining before a concrete B approval: finalized new paged intent/root/event grammar and construction proof for both operation kinds; streaming/summary semantic connection retaining exact v3 diagnostics; audited work/space bound including mixed legacy stores; qualified supervisor/clock/peak/tree monitoring; fixed resource flags and approved artifact destinations. Normal-entry migration and production activation remain outside A/B even after these pass.

## Verification record

The initial page-entry test failed because no implementation existed. Subsequent behavior-first cases reproduced acceptance of 1,025 baseline entries and cross-page out-of-order manifest pairs; both now refuse. Tests cover root/page/collection/evaluation commitments; missing, duplicate and reordered pages; strict canonical UTF-8; baseline hash independence from pagination; frame/count/pair/work limits; 512/64 inclusive page boundaries; and fixed authority/version boundaries. Expected work exhaustion is a small old-limit negative case, not capacity success.

Mutation modules are evaluated in memory after resolving their original dependencies; no source/build/test module is overwritten. Bare-import relocation in the harness initially failed its control and was corrected before counting page mutations. Only assertion failures after passing controls count as detections. The existing ten selected guard controls detect all fourteen reconstituted semantic mutations; the page controls detect twelve targeted page mutations. These are targeted campaigns, not exhaustive coverage or native/capacity qualification.

Build succeeded and **481 selected pure tests passed**, zero failures/skips: 452 existing tests, 27 preparation/construction tests and two mutation-campaign tests. Child controls/detections are not added again to that count. The final campaigns detected fourteen semantic and twelve page mutants, with zero survivors in the selected set. No maximum input, RSS capacity run, native operation, external source/model, chart or backtest was used.

Preparation-only source/test fingerprints at this checkpoint (the connection follow-up records its own artifacts; older hashes in the main plan identify the pre-extraction review baseline):

| Artifact | SHA-256 |
| --- | --- |
| `src/nativeBarCommittedTransactions.ts` | `03181cb4fb5cef15297565603e0bcd7491cd0da259d831b08f776b6a9b944f0a` |
| `src/internal/nativeBarCommittedKernel.ts` | `89e8ab71e974bbc7d6b594acd29280407defc553a19c17bf98302603d1597d19` |
| `src/internal/nativeBarCommittedPages.ts` | `c9452eb22155b2a0025064f5265d548eac17906b4f0261a67f7ff02cc31ac65d` |
| `test/unit/nativeBarCommittedTransactions.test.mjs` | `43fe41d26e6ad2a631603d9d85d025101572e2e6758e64ffae91255d33d8e118` |
| `test/unit/nativeBarCommittedPages.test.mjs` | `44ecbb1af9c3f97b60c1831814b81c26a518a1d81890f3f7f18576621741efa1` |
| `test/unit/nativeBarCommittedPagingMutations.test.mjs` | `1483094f4201f53060ea733e346fd952332da53877af6e4818fdfe2b9aedc9fc` |
| `test/helpers/committedPagingFixture.mjs` | `a536c625055f9d4a8de54145764dda62a4a088287920f1949832a5ac8eb8ac23` |
| `test/helpers/committedPagingSizing.mjs` | `a991663217559a86229d473ea8a7c73d0207640122df9c50a08506202fa655f6` |
| `test/helpers/committedPagingMutationHarness.mjs` | `3818a1cfd0fdb6d206143407ec99dbdf883e6ffda9537adb7c6782d463f25a7c` |

Mutation hashes below identify the final compiled mutant text before dependency relocation; the modules and test source are evaluated in memory. The control uses the same relocation. These short hashes do not authenticate a deployed build.

| Targeted condition | Mutant SHA-256 prefix |
| --- | --- |
| G01 | `5f58e981c251` |
| G02 | `78e0dad4f071` |
| G03 | `5120516ef968` |
| G04 | `5d3931a3b2e3` |
| G05 | `5bfd9683c8d6` |
| G06 | `e05f0c2d3137` |
| G07 | `68e8c3c3f177` |
| G08 | `60b70d9abd1b` |
| T01 | `335343f86cef` |
| T02 | `27178e56029c` |
| D01 | `905b5aebd0be` |
| D02 | `eb4a235718a2` |
| D03 | `aa6deba621fb` |
| O01 | `649017ebcb2f` |
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

Only the existing main design and committed verifier source were changed; the existing committed regression test, immutable v1 contracts, unrelated pending files, connection diagnostic and capacity ledger were preserved byte-for-byte. The new preparation, test/helper and record files are uncommitted. Existing ceilings and STOP remain in force.

