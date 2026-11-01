# C2c-B Parser Selection And Memory Acceptance

B2 detailed-design update, 2026-11-02 JST: [dependency acquisition, pinning and static-audit boundaries](NATIVE_BAR_ADMISSION_WORKER_PARSER_DEPENDENCY_AUDIT_DESIGN.md) use the latest B1 correction baseline `7970b9b`. Metadata discovery, reviewed pin freezing, opaque archive fetch, memory-only static inspection, optional evidence storage, root manifest/lock declaration and installed-tree placement have separate approvals. The recommended first implementation is B2-A pure plan/receipt contracts and synthetic summaries only; no acquisition, archive/record parse, dependency change or effectful runner. B1's identity/gate corrections and all runtime/operational refusals remain unchanged. This update is documentation only; B2 implementation/execution remains pending. Its [commit review correction](NATIVE_BAR_ADMISSION_WORKER_PARSER_DEPENDENCY_AUDIT_DESIGN.md#c2c-b2-commit-review-correction) after `a637266` requires any Python inspector to start from its pinned interpreter path with `-I -B` and a pinned minimal environment, names the exact root-script targets and records the commit; no slice, cap or stop condition changes.

Commit authorization update, 2026-11-01 JST: the user subsequently approved committing the corrected, independently re-reviewed B1 helper, two tests and three documentation files. The uncommitted/no-commit-request wording below records the earlier checkpoints, not a continuing restriction on that scoped commit. Fresh pre-commit verification passed the same 14 memory-only files, 1349 tests. This authorization does not include push, dependency/parser/connection changes or any operational activation; all existing prohibitions and Dot's PAUSED state remain in force.

Status: **C2c-B1 independently reviewed/corrected, committed as `2d981f0`, corrected after commit review and memory-tested; B2/B3/B4 remain pending**, 2026-11-01 JST, repository baseline `c934aa2`, commit-review correction baseline `2d981f0`. The [commit review correction](#c2c-b1-commit-review-correction) supersedes the counts of the [review corrections](#c2c-b1-independent-review-corrections) and adds the package identity refusal; those review corrections superseded the [initial B1 implementation checkpoint](#c2c-b1-implementation-and-memory-verification), including its test counts and pending-review statement; that initial checkpoint superseded the design-only status. This refines [record/initialization/host design](NATIVE_BAR_ADMISSION_WORKER_RECORD_INITIALIZATION_DESIGN.md), including the C2c-A commit-review correction. No candidate dependency, parser execution, connection or authority is added. Current entry/policy/producer refusals, fixed-role alias checks and `transient_overlap_unproven` remain intact. B2/B3/B4, C2c-C/H/J, C2d and operational acceptance remain separate.

No parser installation/materialization, actual record parsing (including invented records through the candidate), candidate module evaluation, connection code, real port/clock/timer, build, subprocess, native read/load, fixture/key/signature/real-data operation, MCP registration, production activation or push is performed; the B1 helper, tests and docs were committed as `2d981f0` only under the separate approval recorded above. Dot stays PAUSED; judgment/notification/mail/retention conditions and all existing resource/time limits are unchanged. The initial external research below read upstream source as text only; B1 tests use existing pure helpers and guarded in-memory summaries, not the candidate packages.

## Selection Decision

**Select `stream-json 3.8.0` with `stream-chain 4.4.1` as the fixed evaluation tuple, not as an adopted or qualified dependency.** Prefer its raw synchronous token function, not a Node/Web stream, assembler, JSONL or JSONC wrapper. A change to either version, entry, dependency closure or initializer requires renewed review; no automatic latest/compatible fallback. If the tuple cannot meet the gates below, reject it and seek a new decision rather than patching vendor code or relaxing limits.

| Candidate | Static evidence | Decision |
|---|---|---|
| `stream-json 3.8.0` / `stream-chain 4.4.1` | Tagged metadata declares ESM, BSD-3-Clause and a chain dependency range; core source exposes primitive token batches and unpacked options | Initial evaluation tuple; package-byte and initialization gates remain open |
| `@streamparser/json` | Tokenizer source retains scalar builders while offering partial-token events | Reserve alternative, not selected. A partial event or builder buffer size does not by itself prove bounded total retention |
| Older `stream-json` versions | 3.3.0 declares another chain range; 1.9.1 has a different entry/dependency geometry | No silent downgrade to escape an initializer. Older versions need their own complete review |
| Whole-record `JSON.parse`, handwritten tokenizer, record-format replacement | Do not solve the approved bounded-reader obligation as currently specified | Excluded; no new format, smaller accepted record ceiling or widened memory allowance |

Primary source metadata: [stream-json 3.8.0](https://raw.githubusercontent.com/uhop/stream-json/3.8.0/package.json), [stream-chain 4.4.1](https://raw.githubusercontent.com/uhop/stream-chain/4.4.1/package.json), [alternative tokenizer](https://raw.githubusercontent.com/juanjoDiaz/streamparser-json/main/packages/plainjs/src/tokenizer.ts), [3.3.0](https://raw.githubusercontent.com/uhop/stream-json/3.3.0/package.json), [1.9.1](https://raw.githubusercontent.com/uhop/stream-json/1.9.1/package.json). Tags are research locators, not immutable production pins or evidence that an npm tarball has been verified. This is a compatibility/architecture choice, not a security certification or claim of being vulnerability-free.

## Important Source Findings

The [tagged core parser](https://raw.githubusercontent.com/uhop/stream-json/3.8.0/src/core/parser.js) imports the chain core and UTF-8 helper even when only `jsonParser` is used. Its `buffer`, nesting stack, scalar accumulator/held surrogate and per-call token array all need bounds. Disabling packing does not eliminate read-ahead or batch allocation. Short complete strings can take a different path from incremental strings; both need acceptance tests.

The [chain UTF-8 helper](https://raw.githubusercontent.com/uhop/stream-chain/4.4.1/src/utils/fixUtf8Stream.js) starts a Node `string_decoder` import at initialization, selects implementations by runtime, suppresses import failure and can drop a leading BOM. This is an actual initialization effect even if the raw parser never calls that helper. Do not claim that a raw named import is initialization-free. The [core entry](https://raw.githubusercontent.com/uhop/stream-chain/4.4.1/src/core/index.js) re-exports other modules, and [defs](https://raw.githubusercontent.com/uhop/stream-chain/4.4.1/src/defs.js) uses the shared Symbol.for registry for sentinel/token-wrapper conventions. Include that registry effect in the initializer inventory; a globally reproducible symbol is not a private authority. Audit the evaluated closure, not just identifiers used by the adapter.

**Initialization is a blocking decision.** Before any third-party import in a later test, either explicitly approve the exact builtin-import/readiness behavior under a closed test profile, or reject this tuple. If approved, await and account for its original initialization completion; do not equate a swallowed failure/fulfilled readiness Promise with proof that a particular decoder was installed. The raw tokenizer must receive text from our independently fatal UTF-8 boundary, never the package's replacement/BOM-normalizing pipeline. No process/global spoof, importer rewrite, cache-busting URL or stripped-source copy may masquerade as acceptance of the unmodified package. An instrumented copy is test evidence only and must be compared with the pinned unmodified implementation.

These source observations are not parser runs or a complete transitive audit. Inaccessible source/metadata stays unverified; package-manager execution is not used to fill the gaps in this design step.

## Dependency Pin Contract

Proposed later addition is **test/qualification-only devDependencies**, exact versions without `^`, `~`, tags or URL aliases. A later production/qualification packaging decision is separate; no existing `src`, MCP tool, CLI or worker imports the parser as a result of adding a test dependency.

| Pin field | Required before adoption | Current state |
|---|---|---|
| Package/version | `stream-json = 3.8.0`; `stream-chain = 4.4.1` | Proposed tuple, tagged manifests read |
| Tarball origin/integrity | Fixed registry HTTPS origin, exact resolved archive URL, independent SHA-512 SRI and retained package metadata | Not verified; do not invent an integrity string |
| Source identity | Full immutable commit for each tag, release-to-distributed-file comparison | Not verified; a tag name is insufficient |
| Package tree | Runtime files, package.json/export maps, licenses, sizes and per-file SHA-256 | Not acquired or enumerated completely |
| Evaluated graph | Exact static/re-export/dynamic edges and builtin dependencies for the chosen entry | Initial roots known; full closure pending |
| Lock behavior | Exact `package-lock.json` entries, one intended chain instance in this closure, no unrelated drift | No lock edit made |
| Initialization | Fixed runtime identity, original readiness outcome and no unexpected effects | Unavailable pending explicit decision/tests |

Upstream's `^4.4.1` must resolve to the approved exact chain bytes in the qualification closure. A direct exact test dependency plus exact lock entries may suffice if resolution is proved; otherwise propose a narrowly scoped override after impact review, not a global override that changes unrelated consumers. Pin resolved file/namespace identities too: a matching version string or top-level lock entry alone does not rule out a nested second instance. Default package-root imports are not allowed substitutes for the reviewed subpath.

The future receipt is bounded supplied metadata: schema/profile id, both package/version/integrity/commit tuples, exact root/edge/file digests, runtime/entry/options digest, license inventory, and unavailable/consistent/refused states. It contains no import function, path factory, real descriptor, approval token or runtime proof. Unknown integrity/commit/file/readiness information produces blockers, never defaults. A metadata match does not set host, loader, parser or execution authority true.

Later acquisition must have its own approval and a reviewed mechanism. `--ignore-scripts` avoids lifecycle scripts but is not a guarantee that an installer creates no subprocess. Do not run npm install/ci/pack/test or any upstream test/benchmark/build under the present ban. Verify archive member paths/types/links and sizes before extraction; no links, traversal, arbitrary output directory or installer scripts. Do not vendor an edited tokenizer or keep a hidden fallback. Rollback of dependency edits is an explicit reviewed Git change, not deletion of user data or reuse of an old successful qualification receipt.

## Fixed Parser Profile

Proposed logical entry: named `jsonParser` from the reviewed `stream-json/core/parser.js` subpath, plus only the original chain sentinels/batch helpers required by the adapter. Resolve the actual `src/core/parser.js` and package exports from the verified installed tree. No Node/Web stream constructor, generic pipeline, assembler, filter that materializes subtrees, parseFile, JSONL/JSONC or default decoder wrapper.

Fixed options in a later adapter: `packKeys:false`, `packStrings:false`, `packNumbers:false`, `streamKeys:true`, `streamStrings:true`, `streamNumbers:true`, `jsonStreaming:false`. Pin the complete option object and reject caller changes. Process original returned batches without retaining or exposing mutable vendor token objects; copy only validated bounded summaries. Recognize only the pinned token vocabulary and the original empty/flush/batch protocol. Finish exactly once through that protocol, and reject input after finish, after first error or after cancellation; no fresh parser retry.

Public test adapter inputs are ordinary bounded Uint8Array chunks plus fixed supplied expectations and synthetic control facts, never strings with implicit coercion, file paths, imported namespaces, decoder factories or callbacks. A separate wrapper drives the selected unmodified tokenizer; grammar remains in the library. Schema projection and canonical encoding are local structured adapters, not a replacement lexer.

### Encoding And Canonical Contract

- Count original UTF-8 bytes including final LF before decode/hash. One document, root object, exactly one trailing LF; reject leading BOM, CR, whitespace outside canonical positions, comments, additional roots and trailing material. Reject invalid/truncated UTF-8 with a fatal standard decoder; preserve a real U+FFFD inside a valid string.
- Flush the fatal decoder before parser finalization. Never repair invalid UTF-8, normalize Unicode, strip BOM, concatenate surrogate halves through replacement encoding, or infer EOF from an empty chunk. Raw UTF-8 and escaped UTF-16 cases have separate tests.
- Validate every required/unknown field against the actual v1 writer, including the other build mode and non-selected rows. The current projection's 128-row/module window is not a smaller accepted disk-record language. Keep the 4194304-byte record, 2097152-byte combined manifest and existing row/page/file/pass ceilings.
- Track object-key order and duplicates using decoded keys and the existing JS UTF-16 comparator, not locale order or ordinary-object overwrite. Preserve array order. Reject role/path/identity aliases consistently with C2c-A; identical dependency copies do not become fixed-role aliases merely by relabeling them.
- Validate numeric lexemes before conversion, then canonical finite-number spelling at the applicable schema field. Decimal identity strings remain strings. Handle overflow, negative zero, leading zero, exponent alternatives and rounding explicitly; do not turn an unbounded digit stream into an unbounded string or BigInt.
- Canonical byte equality, raw-record SHA-256, input/artifact subset digests and module-projection correlations are distinct results. Equal digests alone cannot set exact byte comparison. Direct addon/reader LAUNCH pins remain required, with opaque missing preimages left unresolved.

Key/scalar/number/depth/node/row maxima must be derived from the writer's language and source, not selected to make a candidate fit. If a bound would reject an otherwise permitted emitted record, stop for format/contract review. Disabling packing is not permission to collect an arbitrarily large scalar in the projection layer. Standalone tokenizer tests may accept a large JSON primitive that the record schema correctly refuses; neither test substitutes for the other.

## Bounded Feeding And Work

The raw tokenizer returns a batch after each synchronous call, so a consumer-side depth/token check runs **after** that batch has been allocated. Do not feed the whole 4 MiB, nor assume a 65536-byte qualification page is a safe tokenizer call size. Use a fixed internal fragment size, initially evaluated at **256 original bytes maximum**, with 1/16/64-byte schedules as controls. This is implementation fragmentation, not a lower record ceiling or a caller-tunable acceptance rule.

Before selecting 256, prove from the pinned implementation the maximum retained text suffix, UTF-8 carry, temporary decoded text, scalar scratch, new stack entries and output-token batch for one call. A partial prior state plus one fragment matters. A malformed run of brackets can grow the vendor stack before the adapter sees its first token; the bound must include that overshoot. A complete short lexeme fast path and an incremental lexeme need separate bounds. Drain and release every batch before the next fragment; no array of all tokens, accumulating output, asynchronous fan-out or unbounded queue. Shared vendor constants/symbols are read-only observations, not mutable caller state.

Use an audit table with `derived maximum | reason/source | adversarial case | observed synthetic high-water | limitation` for each internal allocation. Unproved bounds remain null. Source/counter observations and deterministic logical allocation bounds do not prove V8 object overhead, GC freeing, RSS, native heap or wall-time fit. Instrumentation must not qualify modified vendor code as the actual candidate. No benchmark or real clock is introduced to make a memory test look like host qualification.

Charge before each feed/flush/encode/hash action: input bytes, decoder/copy bytes, parser byte-work, emitted token/node counts, row/subset/canonical work and diagnostics. Count refusal work without refund. Keep C2a's one raw-record hash and separately map additional hash passes/subsets/initialization into the existing other-work breakdown for 24 starts, 12 per mode. Include worst-case failure paths and helper/operation work; do not bill the record twice or hide a known lower-bound overrun behind an unknown aggregate.

Main-thread synchronous parsing cannot be interrupted by a fake deadline while inside the vendor call. Establish a source-level progress/work bound for all parser states before adversarial runs; a fake clock checked only after return is not preemption or proof of the 10000-ms/120000-ms limits. If a non-returning path cannot be excluded under the fixed workload, leave acceptance blocked and request a separate design decision. Do not silently add a Worker, child watchdog, real timer or force-exit fallback.

## C2a Overlap And Original Bytes

`c934aa2` keeps any known nonzero C2c transient peak blocked as `transient_overlap_unproven`. A parser-only memory test cannot clear that blocker. Track these domains separately:

1. **Inside original receive dispatch:** C2a receive/validation copies may still be reachable. Add parser/import prefixes and temporary allocations to that simultaneous footprint. C2a already reserves the full 4259840 transient bytes; no new nonzero parser transient is justified here.
2. **After a demonstrated asynchronous boundary:** a later C2c-C/J composition must prove the outer data handler and its batches are no longer referenced before new transient allocations. A yield inside an async producer is not enough if it resumes before the outer handler releases its references. Unreachable is not the same as garbage-collected. No such connection/yield code is added in B.
3. **Longer-lived state:** parser/decoder stack, current row, exact membership data, original-byte comparison window, pending PREPARE and status records. Preserve the 2375680 retained ceiling and account duplicates/aliases explicitly.

Memory acceptance may calculate a standalone parser peak but must still report invocation overlap and parser heap/host profile unavailable. No threshold, C2a reservation, diagnostic ceiling or parent-wrapper claim changes to remove the blocker.

For exact canonical comparison, qualify a bounded original-byte window/cursor model with invented input first. Record input offset, parser-consumed offset and comparator offset independently; prove maximum lag, including incomplete keys/numbers/escapes and surrogate handling. Reject before overrun, not after retaining a record-sized backlog. If a single-pass window cannot be proved within the unchanged envelope, the earlier same-original-descriptor positioned-reread design remains a future connection obligation. B does not open a descriptor or provide a caller-selected read backend. Test oracles may generate a second deterministic memory stream; that is not descriptor identity or mutation-between-read evidence.

## Memory Acceptance Matrix

All future execution in this matrix requires later explicit approval for **the real pinned parser on invented bytes only**. No actual build record, fixture, owner, compiled module or native addon is read or loaded. B1 checks the supplied group/status/count summaries, not the parser behavior in this matrix; none of those candidate-parser tests has been run.

| Group | Required positive and negative evidence |
|---|---|
| Pins/resolution | Exact tuple, SRI/commit/file set and subpath; wrong/missing metadata, nested second chain, symlink/alias, changed lock/exports, wrong builtin edge all block |
| Initialization | No unexpected effect before parser creation, original readiness settles once, no swallowed failure becomes qualified decoder, no late initializer can change acceptance |
| Grammar | Complete raw-library traces for objects/arrays/scalars; bad delimiters, truncated strings/literals/escapes/numbers, trailing comma and multiple roots refuse |
| Finalization | Decoder flush before one original parser flush; empty chunks do not mean EOF; repeated finish/feed-after-stop cannot restart; final pending number/string errors surface |
| UTF-8/UTF-16 | Every split of representative 2/3/4-byte sequences, invalid continuations/overlongs/truncation/BOM, valid U+FFFD, escaped/lone/paired surrogates under fast and incremental paths |
| Canonical bytes | Same structure with whitespace, reordered/duplicate/escaped keys, alternate numbers/escapes, CRLF or missing/extra LF never passes the exact comparison |
| Record schema | Actual root/rows/source/tool plans, required/extra fields, both modes and membership/roles; exact direct pins, artifact aliases and missing preimages |
| Size/bounds | 4 MiB and one byte above; 2 MiB manifest; 4096 rows and per-page limits; schema-derived scalar/depth/node/token/queue boundaries and one over each |
| Chunking | Identical result under one-byte, boundary, 16/64/256-byte and deterministic generated splits; each allowed public chunk is internally fragmented before the tokenizer |
| Retention | Long key/string/number, many tiny tokens, deep invalid nesting, incomplete suffix and error/finish; prove high-water before next feed and no all-token/full-record assembly |
| Work/stop | Precharge refusal precedes feed/hash; unknown cost/null bounds stay blocked; no refund, no resume or replacement after first failure; synthetic late/foreign/cancel facts cannot complete |
| Authority | Consistent data and all parser tests still keep NOT_RUN, execution/proof/host/loader/fixture/evidence flags false; C2c-A overlap blocker persists |

Byte-edge tests distinguish three claims: a generic valid JSON value at 4 MiB, a writer-valid record near its derived maximum, and a size-first refusal at 4194305 bytes. Do not invent an unknown padding field to claim successful maximum record acceptance. If no exact-4-MiB writer-valid sample follows from the writer, record that limitation; never lower the ceiling or conflate grammar acceptance with record acceptance.

Expected results come from fixed small vectors and an independent invented-record producer using the existing canonical contract. Tests may use a standard parser as a secondary oracle only on small bounded **test data** after that is approved; `JSON.parse` never implements the new record reader or adjudicates duplicate/canonical spelling alone. Use deterministic seeds, no RNG, real time, on-disk corpus or upstream runner. Exhaust all single split points on short vectors; use bounded representative schedules for large streams, stating coverage rather than claiming all partitions of 4 MiB.

Each refusal test first establishes an otherwise valid control and asserts the exact own code/state. Add one-condition mutations for pin mismatch, pack/stream/multiple-root flags, fatal decode/final flush, byte count/LF, canonical equality, duplicate/order/number gates, batch precharge/bounds and authority/overlap flags. Anchor absence, compile failure, TypeError from setup or an earlier unrelated refusal is not a killed mutant. Do not import a tokenizer for a boundary-only test: inspect syntax/text in the isolated parser as existing tests do.

Effect guards precede candidate dependencies. Retain corrected C2c-A's independent sink inventory, low-level read/FileHandle denial, safe sentinels and all link/mutation variants. Only exact verified package/helper source loading is permitted after later dependency approval; no arbitrary package scanner, filesystem corpus or actual native record. One file per `node --test --test-isolation=none` invocation avoids test-runner children. Do not use upstream scripts, full effectful suites or module cache resets to inflate acceptance totals.

## Proposed Slices And Approval Boundaries

| Slice | Scope after separate approval | Not authorized by that slice |
|---|---|---|
| **C2c-B1, committed as `2d981f0` and corrected after commit review** | Pure pin/profile/entry/options/readiness and acceptance-plan contracts; nullable source/heap/work bounds; supplied stage/overlap/capacity arithmetic; memory-only summary tests | No dependency edit/acquisition, candidate import, tokenizer call, actual parse, connection, filesystem or host qualification |
| **[C2c-B2](NATIVE_BAR_ADMISSION_WORKER_PARSER_DEPENDENCY_AUDIT_DESIGN.md)** | Pure B2-A first; separately approved metadata/pin freeze, acquisition, static archive/source audit, persistence, declaration and placement | No implicit network/clock/tool/filesystem permission, package script/build/child, candidate import/parse, owner/native/fixture or runtime connection |
| **C2c-B3** | Separately approve candidate initialization, raw tokenizer and fatal-decoder execution on invented in-memory bytes; grammar/chunk/finalization/high-water/progress tests | No real records, IO/ports/clocks/timers, library stream wrappers, worker/child watchdog, actual host qualification or unsealing |
| **C2c-B4** | Pure writer-schema projection, incremental canonical encoding/exact memory-byte comparison and raw/subset/direct-pin checks; composition with unchanged C2c-A | No native/descriptor/backend, C2c-C initialization connection, bootstrap, owner/signature operation, READY/proof or production entry |
| **C2c-B review** | Independent review of exact pinned artifacts, results/limits and regression coverage; any requested commit | No dependency update, operational trial or later-slice approval inferred from passing tests |

B1 helper: `test/helpers/unsignedWorkerParserAcceptanceContracts.mjs`; two public pure functions `planUnsignedWorkerParserAcceptance` and `describeUnsignedWorkerParserAcceptanceCapacity`, plus two guarded tests, now implemented as described below. Inputs are strict bounded pin/effect/entry/profile summaries, source-derived-bound status, supplied work/overlap and acceptance-case statuses. No package manager, importer, parser constructor, arbitrary path, code string or callback is accepted. Missing pin/initialization/language/bound/overlap data stays unavailable. Outputs separate `evaluation_tuple_selected`, `pins_consistent_supplied`, `synthetic_acceptance_complete` and runtime producers; none issues a capability. Known limits refuse during planning, before any future modeled execution. Null contributes only to a known lower-bound calculation, never a complete zero total. Do not modify C2c-A to make an unknown profile complete.

Do not conflate later B2 dependency approval with B3 import/parse approval. A tag/version tuple may be selected for evaluation while tarball pins and initialization are unresolved; this design intentionally records that state. C2c-C/H/J still own actual selected-mode import/cache, trusted bootstrap/loader proof and original descriptor/state binding. Only an independently reviewed complete future producer could feed C2b's private proof map; B alone cannot do so.

## Exit Conditions And Initial Design Verification

Accept B's memory evidence only when exact distributed bytes and closure are pinned, initialization is explicitly decided, raw token/finalization behavior and schema/canonical comparison pass independently, source/allocation/work bounds are justified without new limits, and every remaining host/overlap/original-IO limitation is visible. Failure of any component rejects or blocks the tuple; it never silently switches version, parser or record language.

The initial design-only step performed repository/public-source text reads, documentation edits, local link/diff checks and a read-only Dot configuration comparison only. No candidate bytes were installed/vendor-saved, no candidate code was imported/executed, and no parser/build/test/operational suite was run at that checkpoint. B1's later memory-only verification is recorded separately below. No claim of verified SRI, immutable commit, fully enumerated closure, parser acceptance, live memory/latency, real read provenance or notification change is made. Current configuration remains PAUSED and unchanged. No commit or push is requested here.

## C2c-B1 Implementation And Memory Verification

Implemented on `c934aa2`, 2026-11-01 JST, under the approval for pure contracts and memory-only synthetic tests. The interrupted implementation was resumed for documentation and final difference checks only. That follow-up removes one extra blank line at the memory test's EOF; helper code, test behavior and assertions are unchanged. Independent B1 review and any commit are still pending.

### Surface And Interpretation

- [Pure helper](../test/helpers/unsignedWorkerParserAcceptanceContracts.mjs): only `planUnsignedWorkerParserAcceptance` and `describeUnsignedWorkerParserAcceptanceCapacity` are exported. Both validate the same complete supplied subject and return the same frozen, bounded plan/capacity view; the latter is not a bypass for pin or initialization checks.
- [Guarded memory tests](../test/unit/nativeBarAdmissionUnsignedWorkerParserAcceptance.test.mjs) and [boundary tests](../test/unit/nativeBarAdmissionUnsignedWorkerParserAcceptanceBoundary.test.mjs): no candidate installation/import, tokenization, record decoding, real record or on-disk fixture. Existing isolated TypeScript syntax inspection and VM mutations exercise only repository contract source, not the proposed JSON parser.
- Fixed evaluation tuple, logical entry/target/builtin dependency and seven parser options are checked. Registry URL, canonical SHA-512 SRI spelling, immutable-commit-shaped values, file/export/entry digests and their supplied expectations are bounded metadata, not archive acquisition or cryptographic verification of package contents. A missing field remains a blocker even when other fields match; duplicate packages, extra chain instances and known mismatches refuse.
- The initializer's supplied closure digest must also match the supplied pinned graph. Source bounds must match the supplied parser-entry digest. An internally consistent receipt for a different closure/entry cannot replace that binding. Graph enumeration, licenses, lock contents and effect inventories are supplied summaries; their real provenance is not established here.
- The six-effect initializer inventory, supplied decision, original-readiness source, settlement and decoder outcome are distinct. A fulfilled readiness summary alone does not prove decoder installation. `approved_supplied` is data, not authorization to import the package or grant a runtime capability.
- All 12 acceptance groups must occur once, with bounded positive/negative counts or explicit null. `synthetic_acceptance_complete` means the supplied case summaries are complete; `acceptance_scope` is `supplied_case_summary_not_parser_test_results`. It can be true while pins or initialization still block the full plan. No group count is evidence that a grammar/encoding/canonical/schema/chunking test actually ran.
- Even a fully consistent invented subject keeps `NOT_RUN`, `runtime_producers: unavailable`, parser execution/availability, actual package-byte verification, runtime completion, startup proof, execution/signing/evidence and runtime qualification false. Unknown heap, source bounds and costs cannot qualify themselves by passing the pure model.

### Capacity And Work Scope

Three supplied phases (initialization/feed/finish) carry nine retained and transient components. Known lower bounds are added per phase and peaks compared with the unchanged 2375680/4259840 ceilings even when another component is null. Complete peaks stay null when any memory component is unknown. Source-bound nulls and missing prior-state coverage block completion. Necessary logical fragment/carry/stack/batch/work minima reject contradictory summaries; these minima do not constitute a vendor allocation bound, a heap estimate or proof of progress.

Standalone peaks remain separate from invocation overlap. C2a's full 4259840 transient reservation is retained in the simultaneous lower-bound view; every positive supplied B1 transient peak still adds `transient_overlap_unproven`. No yield, buffer reuse, GC claim, parent-wrapper calculation or C2c-A correction is changed. The phase input is a supplied accounting model, not an observation of actual object lifetimes.

Normal/ubsan each account for 12 starts. Prior hash work includes C2a's one raw-record pass; only additional passes, subset hashes and initialization hashes are added. Missing prior totals retain the known raw-pass floor without becoming a complete total. Known hash/helper overruns refuse even with unknown costs elsewhere. Feed/decode/copy/encode byte work, token work and flush work remain separate units, not an invented elapsed-time conversion. Precharge is a requirement recorded by the plan, not a newly connected execution mechanism; no refunds, synchronous-preemption proof or live-time qualification are issued.

The model retains the existing 4 MiB record ceiling and related manifest/row/page/file/pass limits. The maximum-record test supplies a size integer, not a 4 MiB record or proof that a writer-valid record of that size was parsed. Neither the file-count/case-count summary bounds nor the 256-byte logical fragment profile shrink the accepted writer language. Actual fragment/source bounds, full schema/canonical byte comparison, host/loader qualification and original-IO identity remain future obligations.

### Self-Check Corrections And Test Evidence

Before the interruption, seven new negative tests reproduced missing direct initializer/source binding and contradictory carry/decoded/stack/batch/work summaries (191 passing, seven failing with missing expected refusal). The implementation then added the direct digest bindings and logical consistency checks. Twenty behavioral mutation trials now preserve a successful control, change one guard, and require the relevant assertion to detect that change. This is not an independent review or exhaustive mutation-coverage claim. Boundary tests also check LF/CRLF syntax, 18 source/authority/guard mutations and seven harness deletion controls.

Fresh verification in the documentation follow-up ran one file per invocation:

```text
bdo proxy node --test --test-isolation=none test/unit/<file>.test.mjs
```

| Selected memory-only test file | Passed |
|---|---:|
| nativeBarAdmissionUnsignedWorkerParserAcceptance | 210 |
| nativeBarAdmissionUnsignedWorkerParserAcceptanceBoundary | 4 |
| nativeBarAdmissionUnsignedWorkerRecordInitialization | 159 |
| nativeBarAdmissionUnsignedWorkerRecordInitializationBoundary | 4 |
| nativeBarAdmissionUnsignedWorkerConnection | 94 |
| nativeBarAdmissionUnsignedWorkerConnectionBoundary | 4 |
| nativeBarAdmissionUnsignedWorkerStartup | 85 |
| nativeBarAdmissionUnsignedWorkerStartupBoundary | 5 |
| nativeBarAdmissionUnsignedWorkerPreparation | 158 |
| nativeBarAdmissionUnsignedWorkerPreparationBoundary | 5 |
| nativeBarAdmissionUnsignedController | 209 |
| nativeBarAdmissionUnsignedControllerBoundary | 14 |
| nativeBarAdmissionUnsignedWorkerTransport | 250 |
| nativeBarAdmissionUnsignedParentComposition | 70 |
| **Total: 14 files** | **1255** |

Failures, cancellations, skips and TODOs: zero. The new files contribute 214; the existing 12 files contribute 1041. Full unit/effectful suites, candidate-parser tests and operational acceptance are not run. Effect guards precede contract dependencies; independent sink inventories and safe denial probes cover low-level reads, async FileHandle acquisition, link/mutation variants, process/native/port/clock/timer/signing routes. The denial probes invoke replaced stubs, not those real operations.

The sampled complete/unavailable plans serialize to 2297/3238 bytes under the 16384 diagnostic guard; these are observed samples, not a proved global maximum. The invented standalone retained/transient peaks are 2304/0 bytes, not V8/native/host memory measurements or a deployment fit claim. Existing C2c-A's sampled diagnostic/retained values remain 7546/289792.

### Remaining Approval Boundaries

Next is independent B1 review and any separately requested commit. B2 acquisition/exact lock pinning/static distributed-file audit, B3 approval of original initialization and real parser tests, B4 schema/canonical-byte composition, and later C2c-C/H/J/C2d remain pending. Real SRI, immutable release commits, distributed files/full closure, initializer readiness/outcome, allocation/work/heap bounds and invocation non-overlap are still unverified; invented metadata is never substituted for them.

Only B1's new helper/two tests and these three documentation files are in the current uncommitted scope. Existing shared helpers, worker/runtime, source/native code, package/lock, operational seals, limits and judgment/notification/mail/retention settings are unchanged. Dot is read back as PAUSED with full configuration SHA-256 `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1`, matching the pre-interruption value. No parser dependency/acquisition, candidate import/actual parse, connection code, real port/clock/timer, build/child process/native read, fixture/signature/real-data operation, MCP registration, production activation, commit or push is performed.

## C2c-B1 Independent Review Corrections

2026-11-01 JST, same `c934aa2` baseline. Two independent read-only reviewers reported six P2 findings and one P3 finding. The parent reproduced the three helper inconsistencies with the guarded memory harness; three removed-validation variants still passed all 210 original behavior tests. Static source inspection also accepted bracket-form JSON parsing without executing that parsing call. The user approved fixing all seven, memory-only tests and independent re-review, not a commit or broader execution.

| Finding | Correction and focused evidence |
|---|---|
| P2: normal/ubsan may declare different record sizes and undercount the common raw pass | Both modes must bind the same record size before work aggregation. Two otherwise consistent mismatches failed before the fix and now refuse with `shared_record_size`. A one-condition behavioral mutation checks the binding independently of per-mode raw-hash mapping |
| P2: null placement hides a source-derived capacity overrun | Infer missing retained/transient minima from the source floor minus the known counterpart. When both are null, keep a joint allocation floor once and derive only necessary domain minima from the opposite domain's unchanged ceiling. Sum other known components, check each domain, and include guaranteed transient overlap. Six focused tests failed before the fix; tests now cover exact standalone ceilings, one byte over, joint feasibility, non-double-counting and unknown complete totals |
| P2: JSON bracket/alias parsing bypasses the source boundary | The pure helper has no need for the `JSON` namespace, so its AST boundary denies that identifier, including alias/destructuring/escaped forms. Six text-only cases failed before the fix, and LF/CRLF controls now reject them. A safe sentinel plus `block(JSON, ["parse"])` is installed before dependencies; independent inventory/alias probes call only denial stubs. No actual JSON parse was performed |
| P2: oversized record test succeeds on an unrelated raw-hash refusal | A coherent supplied-size builder updates both modes, raw hashes, all work units and prior raw-pass reservation. Sizes 1, 4194303 and 4194304 are successful summary controls; 4194305 requires the exact schema refusal through both public APIs. Relaxing only the schema ceiling is now caught by a behavioral mutation, not the raw-hash mismatch |
| P2: per-mode nullable helper cost is untested | Known prior work with either mode or both mode costs null must keep `helper_work_unknown` and a null complete total, while retaining the other mode's known cost. A mutation removing only the per-mode completeness update is caught |
| P2: retained-null completeness is untested | All 3 phases x 2 domains x 9 memory components have a null case asserting `memory_unknown`, incomplete capacity and null complete peaks. A mutation excluding retained values from completeness is caught |
| P3: null cardinality erases an independently known minimum | Stack/batch cardinalities keep the known 256-item logical minimum even when null. Known byte/work declarations below that minimum refuse; an unknown source amount does not erase its intrinsic carry/decoded/stack/batch floor. Eight focused tests failed before the fix. Work keeps the independent minimum when both batch and step bounds are unknown; no complete zero-work total is manufactured |
| Additional P3 from re-review: a null work cost drops independently known work from the known aggregate | Null feed/decode/encode costs still contribute the record-byte minimum, token work contributes the fragment/batch minimum and flush work contributes any known flush-step bound. Unknown copy/flush work without an independent floor contributes zero only to the lower bound, never a complete total. Five updated metric checks and one unknown-source/cost test failed before this fix. A 31st behavioral mutation removes only inferred work-floor accounting and is detected |

Null still means unknown: inferred lower bounds never replace a null complete peak/cost, grant a capability or establish a real allocator/heap/time profile. The new `known_combined_peak_bytes` is the largest supplied phase's joint lower bound, not the sum of separate phase peaks or a parent-wrapper/native allocation measurement. Source floors for a fully declared component remain strict; only unknown placements receive inferred minima. There is no buffer move, actual allocation experiment, parser call or change to any existing ceiling.

### Corrected Verification

The seven findings and the additional re-review P3 were handled in focused red/green steps. The test gaps were already demonstrated by the original 210-test surviving mutants; corrected tests now catch those exact removed gates. Tests use only invented metadata and contract source. Thirty-one behavioral mutations retain successful controls, unique anchors, valid syntax and an assertion detecting the changed behavior. Static controls comprise the original 18 mutations plus six JSON alias forms; harness deletion controls increase from seven to nine. This is targeted regression evidence, not exhaustive security or mutation coverage.

Fresh one-file-per-process `bdo proxy node --test --test-isolation=none` runs:

| Scope | Files | Passed |
|---|---:|---:|
| Corrected B1 behavior | 1 | 298 |
| Corrected B1 boundary | 1 | 10 |
| Existing selected C2c-A/C2b/C2a/preparation/controller/transport/composition tests, same files as initial checkpoint | 12 | 1041 |
| **Total** | **14** | **1349** |

Failures/cancellations/skips/TODOs: zero. Sample complete/unavailable plan diagnostics are now 2332/3273 bytes (the additional joint-floor field accounts for the 35-byte increase), still below 16384. The invented 2304/0 standalone peak and existing C2c-A samples 7546/289792 are unchanged. These are sampled model outputs, not real parser memory or global maximum proofs. Full unit/effectful suites and all candidate/parser/operational acceptance remain unrun.

Two independent read-only reviewers rechecked the corrected helper and both tests. The test/effect reviewer reported no new issue; the arithmetic reviewer found the additional null-work-floor P3 documented above. After its red/green correction, both final re-reviews reported no remaining actionable findings and each independently reran 298/10 tests. The parent also freshly reran all selected 14 files, 1349 tests. This is scoped review evidence, not a security certification or proof of all possible input combinations; guards are not a general-purpose isolation boundary.

No commit or push is requested. Dot is read back as PAUSED with the same full configuration hash recorded above; judgment/notification/retention conditions are unchanged. B2/B3/B4 and C2c-C/H/J/C2d are still separately gated; these corrections neither adopt a dependency nor authorize candidate initialization, real parsing, native/fixture/data operations, connection code, real ports/clocks/timers, builds/children, signing, MCP registration or production activation. Existing tracked source/native/test/shared-helper/package files have no diff; only the new B1 helper/two tests and three documentation files comprise the pending changes. Whitespace checks include the untracked files; the final documentation check covers local file links and the new review-checkpoint anchor.

## C2c-B1 Commit Review Correction

2026-11-01 JST, review of `2d981f0` against the code. In `git archive` copies the commit passed 31 related files / 2012 tests in every condition: Node 24.18.0 three times, linux/win32 platform spoofs, Node 20.19.6/26.12.1, isolation=none and CRLF. Its full unit suite passed 5537 of 5539 tests on Node 24 and Node 20, with no failures or cancellations and the 2 existing skips. No arithmetic defect was found. Every probe of a reviewed gate returned its intended refusal code or blocker. The largest blocker set (55 blockers) serialized to 3900 to 4085 bytes in the probed samples, far under 16384. No maximum is proved, because work units have no upper bound.

Findings, all in the tests unless noted:

- P2: Eleven live gates had no behavioral test, so removing or weakening any one of them left every behavior test passing. For four of them (the source-bound target, the batch-bytes minimum and both token-floor inputs), a mutation trial failed only because its search text vanished or its own mutant became a no-op. Probes showed the committed helper refusing or blocking each input that the weakened gate accepts:
  - the closure state blocker: no test fed `closure.state` unavailable or refused, although the heap, source-bound and cost-profile states were tested; and `all_edges_enumerated: false`, where only null was tested;
  - the canonical SRI spelling, for both sides and for a non-canonical expectation with unknown integrity. The invalid-list case changed only `integrity`, so the integrity mismatch refused it first, and its `/cc4(?:a|c2cb1)_/` pattern accepted that code;
  - the source-bound target: the fixture gave both packages one entry digest, so binding the source bounds to stream-chain's entry passed;
  - the cardinality-derived minima above 256 (stack bytes, batch bytes, steps per fragment), because every test used 256 everywhere;
  - the token-work floor's use of declared steps or of the batch cardinality, and its rounding of a partial fragment up. Sizes 1 and 4194303 appeared only as accepted controls, so no partial fragment below its floor was tested.
- P3: Relaxing the memory phase count, `files >= 1`, at most 64 additional passes, the BSD-3-Clause literal or the SRI pattern went unnoticed. Relaxing `record_bytes >= 1` was caught only through a trial's vanished search text. Without the phase count, a summary with no feed phase would skip every source floor.
- P3 (helper): stream-json and stream-chain could declare the same tarball integrity, commit or package-tree digest, and the fixture used one digest for every package field. That shared fixture entry digest is also what hid the source-bound target. The fixture change, not the new rule, closes that hole.
- P3 (docs): the status lines still read uncommitted and did not name the commit.
- Of 167 independent single-condition helper mutants, 140 failed a behavioral test. Of the other 27:
  - 3 are equivalent. The evaluation-tuple presence check is unreachable under the schema together with the package-set uniqueness check. The closed-set comparison refuses every input of the duplicate-effect check with the same code. Dropping the 256 floor from the cardinality minimum changes nothing, because `fragment_overshoot` already enforces it for known values;
  - 4 only change which refusal code fires;
  - 1 is caught by the static boundary test (the diagnostic ceiling);
  - 17 were the live gates and schema constraints above;
  - 2 were the scalar and canonical-window memory floors, found by the review of this correction (below).

  An earlier count of 142 included seven floor-map mutants that renamed a map key, which only broke the complete control. Those mutants now delete the map entry instead.

Corrections:

- **Helper, one rule:** stream-json and stream-chain may not share a tarball integrity, commit or package-tree (`files_sha256`) value, whether supplied or expected (`package_identity_alias`). These values necessarily differ for two packages: their tarballs and trees contain different package.json names, and they come from separate repositories. Export-map and entry digests are not compared, because two packages can legitimately share an export map or identical entry files; positive controls accept both. The source bounds stay bound to the stream-json entry by name.
- **Tests, 298 to 391:**
  - The fixture gives each package its own integrity, commit and tree/export/entry digests. The stream-json entry digest remains the source-bound pin.
  - 30 single-gate cases each have a test and a trial that removes or weakens exactly that gate:
    - closure state and edge enumeration;
    - the SRI spelling on both packages: both sides, expectation only and supplied value only;
    - the source-bound target, by name and not by position;
    - the scalar and canonical-window memory floors, and the zero clamp that keeps a known side above its floor from offsetting an unknown side's overrun;
    - the three cardinality minima;
    - both token-floor inputs, and partial-fragment rounding at 1 and 257 bytes;
    - nine alias cases: each identity, shared on both sides, by expectation only or by supplied value only.
  - One more trial pins partial-fragment rounding in the known token-work lower bound when its cost is unknown.
  - Positive controls: coherent cardinalities of 1000 with matching bytes, steps and token work; a 257-byte record; shared export-map and entry digests; reversed package order.
  - The invalid list asserts `cc4a_invalid_input` exactly. It adds:
    - a missing and an extra phase;
    - zero and 257 files;
    - a zero record and 65 passes;
    - a non-BSD license;
    - an SRI with misplaced padding and an abbreviated commit;
    - a different builtin and a different schema id;
    - a missing and an extra work mode, and an unknown phase, mode or acceptance-group name;
    - zero and 129 negative cases;
    - an uppercase digest;
    - an unknown key in each of the nine nested strict objects that had no such case (package, memory parts, profile, initialization, source bounds, memory phase, work mode, work and acceptance group).
  - The unavailable package, package-state, closure, initializer and qualification-state tests now assert their own blocker. A blocker that both packages raise is reported once.
- **Docs:** the status lines name `2d981f0`, and this section supersedes the counts of the review corrections.

Verification in `git archive` copies:

- Failing first: on the uncorrected helper, exactly the nine alias tests and their nine trials failed. Every other new test covers a gate that already existed, and on the old tests each of those gates survived as a mutant (sweep below). The exception is the shared export-map and entry-digest control, which bounds the scope of the new rule.
- Behavioral trials grow from 31 to 62. The 24 static mutations and 9 harness deletion controls are unchanged.
- On the 192 independent mutants that apply to both helpers (the 167 above plus 25 added during review), behavioral detection rises from 140 to 185. All 9 mutants of the new rule are caught, 194 of 201 in all. The 7 that remain are:
  - the 3 equivalent mutants;
  - 3 schema widenings whose input a later gate still refuses under its own code (more than 128 chain instances, one package, more than six effects);
  - the diagnostic ceiling, caught by the static boundary test.

  Other schema widenings of the second kind exist outside this set (the fragment range, the control count, the version and resolved lengths, the package name enum). A later gate likewise refuses their input under its own code, as it does for the decoder and finalization enums (`encoding_profile`). Widening a state, decision, readiness, decoder-outcome or readiness-source enum fails closed with a blocker, so no such input becomes a complete plan.
- 31 related files (2105 tests) pass on Node 24 three times, linux/win32 spoofs, Node 20 and 26, isolation=none and CRLF. The full unit suite passes 5630 of 5632 on Node 24 and Node 20 (0 failed, 0 cancelled, 2 existing skips).
- Two read-only reviews split the scope. The test reviewer confirmed that each gate case reaches its own gate and that each trial kills by behavior.
  - It found four P2 gaps: binding by position, the scalar and canonical-window memory floors, the closure builtin literal, and the supplied-side SRI spelling with an unknown expectation.
  - It also found four P3 gaps: the package-state blocker, a shared entry-digest control, the commit and file-count bounds, and rounding in the work lower bound.

  The helper and doc reviewer found the rule correct, with no P1 or P2. It checked 48 cross-package alias variants and the equivalence of the three remaining mutants over input grids. Its six P3 findings were doc wording. All findings were reproduced and corrected as described above.

  In the delta reviews, the test reviewer confirmed all eight of its findings closed. It then found two more P2 gaps (the zero clamp and the work-mode count) and three P3 gaps (the nullable digest pattern, unknown keys in nine strict objects, blocker de-duplication), now covered. The helper and doc reviewer reproduced every count and found two P3 wording slips, now fixed. In the next delta round, both reviewers independently found the phase, work-mode and acceptance-group name enums untested (P2), and the test reviewer also found the negative-case bounds untested (P3). All are now covered, and neither reviewer reported anything else at that bar. Final confirmations from both reviewers report no remaining findings.

Diagnostic samples stay 2332/3273 bytes, and the invented standalone 2304/0 peak is unchanged. Limits, C2c-A, shared helpers, the worker and all seals are unchanged; Dot stays PAUSED. No dependency, parser, connection or operational action is added.
