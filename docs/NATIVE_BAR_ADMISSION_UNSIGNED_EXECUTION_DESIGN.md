# C-C1b Observer And Execution Design

Status: **C-C1b-1 pure contracts implemented; adapters, build and execution remain unapproved/unimplemented**, 2026-10-28 JST. Design baseline: `1766c0a`; implementation baseline: `ca164ad`, including C-C1a's later cause/teardown bindings. This refines the [unsigned acceptance plan](NATIVE_BAR_ADMISSION_UNSIGNED_ACCEPTANCE_PLAN.md), including its original resource baseline and latched-uncertainty corrections. It does not unlock C-C1a or change the twelve cases, two build modes, native budgets, market/judgment/notification/mail rules or product retention conditions. Dot remains PAUSED.

## Boundary And Components

The scope stays twelve negative cases per mode, normal then UBSan, at most 24 exclusively new unsigned fixtures, one live case fixture and one case worker. There is no C1 request, joint V0/V1/transcript success, saved signature, real-data operation, MCP registration or production enablement. Existing fixtures/build outputs are not adopted, repaired, swept or removed.

Proposed executable test-only components, not implemented or called in C-C1b-1:

| Component | Responsibility | Forbidden authority |
|---|---|---|
| Dedicated isolated build wrapper | New mode outputs, pinned JS/addon/observer hashes, local tools only | Common build overwrite, dependency installation, MCP/service restart |
| `admission_unsigned_observer.cc` | Independent bounded metadata/content observation of the fixed anchor and owned recipe | Reader addon calls, writes, signing, arbitrary paths or old-fixture discovery |
| Private fixture supervisor | Exclusive creation, live ownership list, recorded intents/results and non-recursive teardown | Importing a receipt as ownership, accepting an external cleanup path, product purge/recovery |
| Fresh case worker | Original bootstrap/owner/query, delegated native trace, original release diagnostics | Fixture writes, replacement handles/backends, raw checkpoint/key output |
| Bounded evidence writer | Private unsigned case journal, report, run index and readback | Rewriting failed attempts, approval tokens, history/market journal integration |

C-C1a's `executeUnsignedHarness` stays unconditionally refused. A future C-C1b entry is a separate test-only entry, not another branch selected by changing an inspect flag. Moving/refining the private connection into a prepared worker session needs review; its current uncalled function cannot supply worker supervision or durable evidence by itself. The C-C1a seal tests remain, with separate boundary tests for the new worker's only permitted caller.

## Ordering And Original Baselines

The existing ownership model requires `baseline_resources` at construction. Actual workspace accounting is exposed through the original bootstrap's `describe()`, whose complete fixture binding is unavailable before setup. Do not guess zero, add a global accounting API, or reconstruct a baseline from cleanup results.

Use this order:

```text
approved run -> isolated build/preflight -> exclusive receipt/run directory
 -> supervisor creates and independently checks the fixture, recording every identity live
 -> freeze correct ownership proofs, actual registration, envelope and their digests
 -> spawn one worker -> load exact addon/info -> create original bootstrap only
 -> BASELINED: actual native info + bootstrap workspace, no owner/query/read context yet
 -> initialize the memory model from the supervisor's live creation list and that baseline
 -> persist/read back baseline and GO intent -> GO exactly once
 -> owner activation -> original reader/query -> one negative run -> original release/close
 -> RELEASED diagnostics -> independent pre-teardown check -> bounded teardown -> absence check
 -> FINALIZE worker -> clean exit -> report/readback -> terminal receipt -> run index
```

The supervisor owns a private in-memory fixture reference created only from its successful exclusive creation. Receipt DTOs, worker messages and C-C1a model descriptions cannot construct it. Feeding its already-recorded live creation facts into the memory model is not replaying a saved receipt. The real ownership decision remains with that original supervisor reference and independent current checks; the model remains unauthenticated.

Record native `live_fds` and `live_sessions` as managed FDs/root slots, not OS-wide descriptors. Record `active_workspace_bytes` from the actual original bootstrap. Retained metadata/ID tombstones are separate: they may grow and need not return to their original size. Preserve the explicit baseline for the whole case. Owner enrollment may add retained memory; the original begin's C-A calculation must revalidate the unchanged envelope against actual accounting after owner activation. A preflight refusal is not a native case pass.

**Conservative pre-query disposition:** before a baseline or original query exists, the C-C1a settled-query cleanup tuple cannot truthfully be supplied. A setup/bootstrap/pre-GO failure therefore retains the fixture and stops the run. Do not invent a baseline, label a live worker `never_started`, call a never-created query `settled`, or create a replacement worker/query to justify deletion. Early rollback is optional in the parent plan and is not connected in this initial implementation; a more permissive pre-query cleanup contract would need a separate proposal/review.

## Independent Observer

Build a dedicated read-only executable, rather than broadening the legacy observer's single-path `ifstream` entry. Reuse only reviewed general OS idioms; do not include/link the addon observer/classifier, accept native report bytes, or derive expected proofs from the data being tested.

Its inputs are bounded scalar selectors: protocol version, fixed operation, one of the twelve case IDs, exact six-character fixture basename, invented extra UUID and an optional recipe entry index. The anchor is compiled as `/private/tmp`. Entry paths come from the fixed recipe vocabulary, never arbitrary path arguments or a directory search. Compare the observer's recipe identity/digest with the Node plan before using it.

| Operation | Observation | Scope |
|---|---|---|
| `anchor` | `/`, `/private`, `/private/tmp` identity/access and volume capabilities | Metadata only; never list anchor contents |
| `entry` | One successfully created or next-to-remove recipe entry and necessary parents | Works during partial setup/teardown; no requirement to recreate missing markers |
| `inventory` | Complete bounded owned tree and all required proofs, including directory sizes | Unexpected names/types stop; do not read or adopt their content |
| `absence` | Original anchor unchanged and exact original fixture basename absent | Only after the supervisor recorded successful final rmdir; never search elsewhere |

Use independent `getattrlist(..., FSOPT_NOFOLLOW)`, ACL and volume observations, with no-follow component walking and read-only file opens. Bind path observations back to the opened object's device/inode/type/owner/birth identity, before and after reads. Hash regular bytes incrementally, with no-follow opens, link-count/type/size checks and pre/post metadata comparisons; do not extend `ifstream` to witness paths. An unstable proof is a refusal, not a new baseline. This does not claim protection against the malicious same-UID replacement race excluded by the parent plan.

Output one strict versioned JSON result, at most 64 KiB, and a bounded code-only error on failure. IDs, sizes and nanosecond fields remain exact decimal strings. Return kind, device/inode, UID/GID, full mode, flags, birth/mtime/ctime, link count, size/allocated size, ACL kind/hash, file SHA-256 when requested, volume facts and observer byte/node counters. Output hashes, not raw file bodies or ACL text. No key, signature check or arbitrary JSON body decoding is needed in the observer.

Bounds per invocation: at most 16 owned objects plus three ancestors, depth three, 128 KiB aggregate regular-file content, two bounded content passes, two ACL-text observations per node with the existing 65536-byte/256-entry limits, and a 4 MiB charged work cap including framing/metadata. Refuse before exceeding a cap. At most 64 observer invocations per case; account their actual work separately from the original reader's 256 MiB limit. Independent-observer work is not free and cannot be charged as if it were native evidence capture. The first pure capacity implementation must verify this schedule against the actual observer algorithm rather than silently enlarge these bounds.

Normal/UBSan observer outputs stay in their corresponding new mode directory. Setup and cleanup use the same pinned observer binary for the case. It neither sets permissions nor clears inherited allow ACLs; incompatible ACL/volume/ownership/name conditions block the case.

## Fixture Supervisor

The live supervisor is the only fixture writer/remover. Keep its ownership list separate from the worker's deliberately wrong U4 input. All path composition is private, from the exclusive returned basename and exact recipe paths; a report, prefix match, resolved alias or user path cannot become a cleanup target.

1. Validate source/build hashes and fixed output ancestors. Exclusively create new 0700 mode/run directories; existing outputs refuse. The observer executable is 0700; new data/JS/addon/receipt/report files are 0600. Never chmod or delete an existing common output or parent.
2. Initialize a new private case receipt and confirm its first valid record by readback before creating a fixture. Record a bounded create intent for the exact prefix, then exclusive temporary-directory creation. Immediately bind the returned name and original identity in the live list before any await/next creation; persist the result before proceeding. A crash between creation and result can leave an unidentified orphan: no scan is allowed to recover/adopt it.
3. Create each recipe directory explicitly, and each final-name file with exclusive/no-follow creation. Record intent, finish bounded writes, verify FD/link identity and independent ACL/content proof, then record result. Do not use a temporary rename/publication, recursive mkdir, permission repair or arbitrary file generator.
4. Freeze a complete independent setup inventory and known-byte hashes. Owned-directory sizes are measured after setup; ancestor headroom stays 65536 bytes per ancestor, 196608 total. Use the unchanged C-A per-role/ACL/schedule accounting and preserve all failures. No native-supplied value updates the setup binding or envelope.
5. Send only the frozen correct registration/envelope and the explicit U4 input delta to the worker. The private ownership list keeps the correct inode. Marker hashes are not the U4 negative input: JS would reject them before the intended native layer.

The twelve recipes currently contain at most nine owned objects. Check the generated list, total bytes and depth, not an assumption of nine. The approved upper fixture bounds remain sixteen objects/depth three/128 KiB and the cohort remains at most 24 new fixtures. A malformed or unrecorded creation stops setup; no next item, opportunistic rollback or alternate name is attempted.

## Worker Protocol

Use a fresh Node child process, fixed script/argv and exact mode per case; do not inherit parent `execArgv`, debugger/preload/report flags or old isolation selectors. Set only the reviewed environment allowlist, including the one `NATIVE_BAR_B3CC_MODE`. Reject incompatible loader variables rather than falling back. The parent does not load the addon. During a case there are at most the supervisor, one case worker and one bounded observer process; observers are serialized and the worker is quiescent during teardown.

Recheck pinned JS/addon/observer identities and hashes before each case and finalization. Reuse the newly built outputs only within this same live approved run, never by adopting an older output directory. A changed artifact/source stops the run rather than rebuilding mid-case. Compiler scratch and any tool caches must be newly owned private run outputs; no installation, old-cache cleanup or inherited compiler flag injection is allowed.

Use dedicated directional pipes carrying bounded newline-framed JSON, not serialization of arbitrary JS objects. Enforce a 64 KiB frame bound incrementally before JSON parsing, strict schemas/unknown-field rejection and at most 32 control/status frames per case. Commands are data only. Every message binds protocol/run/case/mode, source/build/recipe/registration/envelope digests, an opaque exchange ID and a directional ordinal. These are correlation fields, not user approval or a restart capability. No KeyObject, original grant/handle, raw native byte buffer, checkpoint response or signature crosses the pipes.

Trace events are at most 1 KiB each. Transfer at most sixteen events per bounded `TRACE_CHUNK`, at most eight chunks/128 events, before the terminal diagnostic frame; chunks bind the same exchange and monotonic ordinals. Hash/count the assembled trace and reject missing/duplicate/reordered chunks. Count these chunks within the 32-frame limit; do not exceed a frame by attaching the whole trace to `RELEASED`. Worker stdout/stderr are not protocol channels: unexpected output is capped at 8 KiB per stream and becomes a summarized failure, not a raw report dump.

| Parent command | Legal worker state | Result |
|---|---|---|
| `PREPARE` | New | Validate frozen binding/mode; load pinned addon, call info, create original bootstrap; send `BASELINED` |
| `GO` | Baselined, once, after persisted parent intent | Activate fixed owner, enroll original reader, begin/run once; expected failure or unexpected primary code retained |
| `CANCEL` | Active original case | Cancel/release the same original query; no replacement handle, replay or deadline renewal |
| `FINALIZE` | Released and parent teardown decision finished | Close remaining channels, return normal protocol exit; not proof of query release |

`BASELINED` contains actual counters and bootstrap workspace/retained metadata, but no owner or private key has been created. It cannot arrive after GO or be replaced by another baseline. The parent then instantiates the C-C1a memory model with that baseline and its live creation facts. Missing/duplicate/reordered/wrong-mode messages latch a protocol stop.

For GO, use only the already-reviewed fixed owner modes for the selected case. U0 imports the unsigned helper and makes no private test KeyObject. The other ten cases instantiate the existing public-vector key only inside their worker and sign C0 in memory. The original begin recalculates actual memory work; if it refuses before native begin, do not label the planned row reached. Raw C0 bytes stay inside the original owner/reader path and are never serialized or logged.

Await the original run outcome, independently attempt query release and all reader/owner/bootstrap closes, and preserve the primary code independently of close errors. Capture final original query diagnostics, post-close bootstrap workspace and native info, together with any failed close. Send `RELEASED` only for a complete bounded result packet; unknown settlement is reported as such, not converted into a released acknowledgement. The worker then waits quiescent; it does not start another case or a new query.

## Observation Provenance

Install a logging-only wrapper around the exact isolated addon's admission read exports and `info()` before the original reader first requires it. Delegate each original receiver, argument, handle, return value and thrown error unchanged. Retain only bounded hashes/counts and API begin/end events; never return synthesized facts or substitute a clock/backend. Restore the cache/export wrapper in finally. Legacy mutation/recovery APIs are outside the call allowlist.

Native context/open/inventory/capture/verify/close events are directly observed NAPI API events, not kernel read counts. C0 request/authentication counts and original released/cleanup state come from the actual original query diagnostic. For the fixed owner, its signed-request count is an additional owner observation; U0 has no such signed-owner counter. The source-pinned original released gate requires retirement and lease release, but the internal retirement token itself is not exported.

Keep these origins distinct in the report. Exact transport dispatch/authentication/retirement timestamps are not exposed by the current diagnostics; leave them null and use source-pinned order constraints/observed bounds, not invented events. For example, original authenticated C0 must precede observed openPair in the unchanged reader. If an assertion requires a direct transport timestamp/token that these interfaces cannot provide, mark that assertion BLOCKED, not independently observed. No public callback, mailbox consumer, runtime instrumentation or new signing interface is added just to make it pass.

U0 must observe real begin but no openPair/inventory/capture, with zero authenticated requests. U1 must capture exactly its known unsigned witness and compare length/hash, and inventory markers must remain cap `"0"`/not readable evidence. Other cases stop at their exact declared layer. All cases require zero C1/verify/transcript calls and no positive joint return. Preserve the distinction between native inventory's internal repeated passes and joint V0/V1.

## Supervision And Stops

The unchanged query deadline is at most 600000 ms; original release gets at most the existing proposed 60000 ms supervision grace, never a new read window. Proposed harness bounds are 120000 ms for case preparation and 10000 ms per observer call, always limited by the remaining phase window. These detect/report lateness; they do not promise to interrupt a blocked synchronous kernel call.

Worker loss, malformed/oversized output, hung observer, identity change, receipt failure or unconfirmed original release stops dependent cases and the other mode. Drain only already-original settlement within the bounded grace. Do not re-request a checkpoint, re-sign, create a replacement worker/query, refresh a binding, repair a journal or retry with larger limits.

The live supervisor itself latches RETAIN independently of the memory model. Reconstructing a model, rereading a receipt or obtaining a later good observation cannot clear it. There is no within-run reset/recovery entry.

**New explicit execution-approval item:** bounded termination of only this run's original child process objects is proposed for unexpected hangs: after original cancellation/grace, SIGTERM and at most 5000 ms, then SIGKILL and at most another 5000 ms. It applies only to the exact owned worker/observer child, never a caller-supplied PID, process group, existing service, MCP, TradingView or Dot. It is failure containment, not a fault-test case or release proof. This is not authorized by the earlier fixture proposal; without that additional approval, report the owned hung child for user action rather than introduce automatic signals.

Whether a child exits normally, crashes or is terminated, absence of an original release/counter acknowledgement means RETAIN and no teardown. Exit/GC/zero counters in another process cannot satisfy it. After release was acknowledged, an unexpected loss during teardown stops the next action and records any already-completed removals; the lifecycle is not an atomic transaction.

## Non Recursive Teardown

The selected initial proposal remains receipt-bounded Node removal under the stated non-malicious-same-UID/no-concurrent-writer assumption. Directory descriptors may help compare identity; Node's path-based unlink/rmdir are not descriptor-anchored. No design claim closes the check/remove or intermediate-component replacement race. A stronger test-only C remover is a separate proposal, not an automatic fallback.

Require the original supervisor reference, original worker release diagnostic, original baseline/end counter match, successful receipt readback and independent complete remaining-tree check. The C-C1a model may confirm supplied consistency but never substitutes for these actual facts. No worker frame or persisted receipt can authorize a target path.

For each fixed deepest-first entry: yield to process pending supervision events, check worker state and all known parent identities, independently recheck required access/proofs, persist a delete intent, immediately recheck path/leaf identity, perform one non-recursive unlink or empty rmdir, then persist its exact result. Check immutable device/inode/type/UID/GID/mode/birth/ACL/flags throughout; regular-file size/link count/hash must match setup. Directory mutable size/link/timestamps are not falsely required to equal their creation values after known child work. Enumeration never adopts an unexpected name. ENOENT before a declared successful removal is a failure, not success.

Remove the fixture root last. Final absence succeeds only when the original anchor still matches and the exact original basename returns ENOENT after the recorded rmdir. Any missing/unknown final check latches hold, as in `1766c0a`; a later observation cannot silently recover it. Leave remaining entries and receipts on error, report exactly which steps finished and stop. No recursive force/glob, rename/quarantine, product retention/prune, old-fixture scan or restart-based cleanup exists.

## Evidence Files And Readback

Only the new private run directory receives unsigned evidence:

| File | Bound and content |
|---|---|
| `<mode>-<case>.receipt.jsonl` | At most 64 events / 1 MiB; intents, original identities, baselines, exact side-effect results, stop state |
| `<mode>-<case>.report.json` | Exclusive write once, at most 256 KiB; final outcome, evidence origins/hashes, original diagnostics/counters, cleanup/absence and worker exit disposition |
| `run-index.jsonl` | Append-only, at most 128 KiB; run header and final case/report/receipt hashes, including failures and NOT_RUN rows |

Open with exclusive/no-follow creation and keep the original writer FD. Check owner/mode/link identity on readback using original FDs and current links; never reopen an unverified report path. Writes handle partial/zero writes fail-closed, then sync the owned evidence file and read back the bytes/hash before the next side effect. A partial/corrupt line stops the run; do not truncate, repair, replace or append a fictitious success. Do not claim power-loss durability, authenticated history or cross-process recovery merely because fsync/readback succeeded.

Each receipt event has a version, run/case/mode/ordinal, bounded kind/payload, previous-event hash and a hash over canonical fields excluding its own hash. Intent records are confirmed before their side effect; result records are confirmed before the next action. The chain detects accidental changes, not malicious same-UID editing or user approval.

Preflight event capacity is `4 * planned_owned_entries + 16`: creation intent/result, deletion intent/result, plus sixteen lifecycle/failure slots. The present recipes use at most nine entries, so at most 52 reserved events fit the existing 64. If the actual recipe/schedule requires more, refuse before creation rather than raise the cap or drop failures. Native API traces remain separately bounded at 128 summary events; no unbounded heartbeat log is added.

The sixteen overhead slots reserve twelve lifecycle summaries (case allocated, setup sealed, worker prepared, baseline bound, GO intent, run outcome, release checked, cleanup precheck, absence checked, worker finalized, ready to report, terminal) and four stop/failure summaries. Record bounded error arrays inside those summaries, not one extra receipt line per trace/frame/close error. Unused slots need no fabricated event; overflow is a reporting failure.

Avoid circular hashes: a report binds the receipt prefix through `ready_to_report`; the later terminal receipt event binds the report hash; the run index binds that terminal event and report. Do not put the final receipt/index hash back into the report. Final report creation happens after teardown/absence and worker finalization; child exit is recorded but never used to infer original release.

Keep actual wall observations in JST plus original UTC native stamps. Parent, worker and observer monotonic values carry clock-domain labels; order across processes uses message ordinals/acknowledgement edges, not subtraction of assumed-identical clocks. No timestamp is backfilled from report-save time. Report analysis/failure/teardown/save times separately.

Never persist key/seed objects, generated signatures, raw checkpoint packets, arbitrary stdout/stderr, account/market data or original opaque handles. Unexpected child output is bounded, summarized by code/count/hash and causes failure; it is not dumped as evidence. General output has opaque case labels; cleanup locators stay only in the private receipt. Disable inherited preload/debug/heap-report options in test children; this is an application non-serialization policy, not a guarantee about OS swap/crash dumps. Keep all artifacts local and ignored; no upload, monitor/research-journal write, auto-expiry or sweep is proposed.

## Outcome And Acceptance

PASS is only the exact declared negative case with required observations, original settlement, independent ownership/byte checks, confirmed teardown/absence and saved/read-back evidence. It cannot raise joint view/history/intake/approval/execution/capacity/elapsed-age/transaction qualifications. Signature bytes exist only for original C0 inside the ten fixed-owner workers per mode; the two U0 workers per mode never create the private test key.

FAIL covers unexpected layers/codes, extra native calls, changed data, malformed protocol, resource/ownership uncertainty, failed cleanup/save or abnormal worker finalization. Unsupported tools/host/volume or a proven ancestor-only envelope excess is BLOCKED/UNSUPPORTED, without a larger retry. A prior planning refusal leaves the intended native behavior NOT_RUN. Preserve every failed/blocked attempt; no replacement run, shortened prefix or later PASS overwrites it. Retained or unknown fixture state prevents all following cases. Pure model consistency is not a native PASS.

Accept the complete C-C1b cohort only when all twelve cases in each mode have their required evidence; otherwise publish partial coverage and gaps. No C-C2 positive milestone, full publication/mirror/receipt coverage, OS clock/mount/descriptor-exhaustion/kernel-close or power-loss qualification follows.

## Implementation And Approval Sequence

1. **C-C1b-1: pure contracts and memory tests.** Implement message/state/evidence schemas, immutable provenance/baseline binding, receipt event/byte capacity and stop decisions. No child spawn, native compilation/load/read, fixture creation, signing or removal.
2. **C-C1b-2: inert adapters.** Add observer source, fixture/evidence adapters and supervised worker code behind separate closed execution entries. Source/memory tests only; executable connection/cleanup code needs explicit implementation approval and remains uncalled.
3. **C-C1b-3: isolated build only.** After review and separate approval, compile the two fresh mode outputs and observer; no addon loading, fixture, signing or cleanup execution. Local compiler/header/runtime absence blocks; no downloads or common-output overwrite. Tool temporary output stays in a newly owned private run scratch area, not an old temp directory.
4. **C-C1b-4: actual cohort.** Separate approval names the twelve cases/two modes, fixed anchor and at most 24 new unsigned fixtures, independent observer reads, original native read path, in-memory public-vector C0 signing, private evidence writes and the selected non-recursive cleanup/race assumption. Child-only failure termination is an additional explicit choice; it never expands deletion permission.

Only **C-C1b-1** is implemented below. Its approval does not approve the adapters or any later execution, child termination or Dot restart.

## C-C1b-1 Implementation

`test/helpers/unsignedExecutionContracts.mjs` adds five test-only supplied-data interfaces, without importing a reader, oracle, worker, filesystem adapter or native binary:

- `describeUnsignedExecutionCapacity`: the original recipe geometry, `4*n+16` receipt reserve, fixed byte/frame/trace limits, separately charged observer work and run-index reserve. Nine entries require 52 events; twelve exactly consume 64, thirteen or more refuse. Each encoded receipt record including LF is capped at 16384 bytes, so 64 records fit 1 MiB. The run index reserves a 4096-byte header plus at most 24 case lines of 5290 bytes, totaling 131056 bytes, below 128 KiB.
- `describeUnsignedExecutionWindow`: bounded arithmetic on supplied, same-domain monotonic observations. Preparation/query/settlement caps remain 120000/600000/60000 ms. An observer gets at most 10000 ms and only the remaining supplied phase window; there is no clock read, timer, deadline renewal, cancellation or signal implementation. Future live adapters must pin the original clock points themselves; this stateless calculation cannot authenticate those points.
- `createUnsignedExecutionProtocolModel`: immutable source/build/recipe/registration/envelope/exchange binding, strict directional ordinals, one original baseline and GO, bounded chunks, release/counter consistency and finalization/exit ordering. Uncertainty or protocol failure latches STOPPED/RETAIN. A later good observation cannot reset the same model. Cancellation is a data transition, not a call to a query or process. Retained metadata may grow while FD/root/workspace counters must match the original baseline.
- `createUnsignedExecutionEvidenceModel`: memory-only write-intent/result ordering, known recipe entries and proof schemas, deepest-first schedule, twelve lifecycle and four failure-summary slots, canonical hash-chain strings, exact supplied-string acknowledgement before another action, report-prefix/terminal/index linkage and exclusive report/index construction. Its initial allocation requires only the planned case/IDs and source/build provenance; the returned fixture name and observed registration/envelope hashes are bound at their later observation steps, never guessed before creation. Failure summaries can preserve bounded original release/close failures, entry failures, output hashes/counts and exit dispositions, without converting them to release success or saving raw output. Immutable directory identity remains bound while size/link/allocation/mtime/ctime can change after known child work.
- `inspectUnsignedExecutionEvidence`: bounded replay of supplied receipt/report/index strings against an initial allocation and an expected sealed declaration (explicitly null if setup never sealed), rejecting missing, repeated, reordered or modified records, foreign bindings, unknown fields, false saved-file claims and circular report references. It does not read a file, reconstruct ownership or resume execution.

Wire frames and evidence lines are canonical sorted-key JSON followed by exactly one LF. The 64 KiB wire cap includes LF and is checked before parsing. Requiring canonical bytes rejects duplicate keys, extra whitespace and multiple frames; a later streaming adapter must also enforce this cap incrementally before assembling a complete string. Trace chunks carry at most sixteen strict, code/hash/count-only events, each at most 1 KiB, with no raw arguments, native buffers or checkpoints. Exact C0 dispatch/authentication/retirement timestamps remain null. Supplied wall UTC/JST strings are format checked only, not independently observed or calendar/offset qualified.

The observer reservation subtracts two 65536-byte ACL observations per owned/ancestor node, two aggregate content passes and the 64 KiB output from the unchanged 4 MiB cap. The remainder is explicitly the metadata/framing ceiling for the future algorithm, not an assumed zero cost. The observer algorithm and its per-operation schedule still do not exist and are **not capacity-qualified**. Its worst per-case 64-call reservation is separate from, and does not enlarge, the reader's 256 MiB native budget.

`consistent_supplied_lifecycle` and `consistent_supplied_evidence` mean only protocol/serialization consistency. They are not the C-C1a negative-row assessment, native PASS, durable save, actual release, fresh directory/ACL observation or permission to delete. In particular, this layer does not replace `ca164ad`'s exact phase/cause/registration-delta/byte/marker assessment or directory-child/ownership/teardown model. Those original checks and the future independent live supervisor remain mandatory before any real case acceptance or teardown. New model instances and replay cannot clear a future supervisor's independent live RETAIN latch. The models deliberately have no execution or recovery caller.

### Verification And Limits

The new memory suite exercises all 24 recipe/mode schedules without creating their contents, fixed capacity edges, 128 trace events/eight chunks, original nonzero baselines, protocol/clock/order failures, permanent stops, readback mismatch, four reserved failure summaries, report/receipt/index corruption and failure preservation. Its tripwires block child/worker launch, native loading, key/sign operations and fixture I/O. Source guards pin imports/exports and ensure the module remains absent from runtime/MCP, the native entry, the existing sealed harness and package scripts. C-C1a's seal/cause/teardown tests are retained, not weakened.

Fresh verification: 89 new behavioral tests plus four boundary tests, and 189 existing selected C-C1a/C-C0/reader/oracle-boundary tests, all passed (282 total; no skips). Three new-file syntax checks and `tsc --noEmit` also passed. Tests first exposed, then verified corrections for a truncated stop reason, an injected method receiver callback, and scalar JSON roots escaping as uncoded errors. Capacity, lifecycle, evidence and failure-preservation tests were exercised before their corresponding implementation. This is local memory/source verification, not an independent review or an actual 24-case native cohort.

During initial tool-help discovery, a `node --help` subprocess was inadvertently launched once; this exceeded the no-child-process constraint and was disclosed in the chat. It performed no fixture/native/sign/data operation. Subsequent memory tests explicitly use Node 24's `--test-isolation=none`, one test file per direct invocation, without test-file child processes. This exception must not be described as a wholly child-process-free work session.

No native build/load/read, real or synthetic filesystem fixture, signature, cleanup, evidence-file save, MCP registration, production activation or Dot/rule change is included. No actual normal/UBSan cohort, independently verified save/ownership/release, isolated native/observer build or independent review has been performed. The local review and commit authorization are recorded below; push is not included. Next implementation approval remains C-C1b-2's inert adapters, not execution.

## C-C1b-1 Local Review

2026-10-28 JST: reviewed the six-file implementation/design change against `ca164ad`. Two issues were reproduced with failing memory tests and corrected:

1. **Medium: pre-creation receipt required post-creation facts.** The evidence model formerly required a returned temporary-directory name, full recipe hash and observed registration/envelope hashes before it could confirm `case_allocated` or the first creation intent. Those values cannot exist at that point in the approved live sequence. The model now starts from a strict allocation declaration containing the planned fixture IDs/case, source/build digests and exchange ID only. Its fixed recipe template is inspected in memory through the unchanged C-C1a helper using a private unused sentinel; only a name-independent template hash is retained in allocation provenance. That sentinel is never an observed name, final recipe binding or cleanup locator and never appears in serialized evidence. No C-C1a API or recipe bytes were changed.
2. **Low: crash signal names were lost.** Exit packets and failure summaries accepted only SIGTERM/SIGKILL, so a spontaneous SIGABRT/SIGSEGV/SIGBUS/SIGINT was rejected as malformed rather than preserved as worker loss. A bounded signal-name field now records such dispositions. This is observation data only, with no PID, process handle, signal operation or additional termination permission.

Every receipt record keeps the immutable allocation. Before creation, `fixture_name` and full `binding` are null; the first creation intent explicitly records only the fixed prefix. Only the root creation result can supply the returned basename, and that name becomes confirmed only on exact supplied-string readback. A non-root result cannot replace it. After all creation results have been confirmed, `setup_sealed` accepts the observed registration/envelope digests and derives the complete original protocol/recipe binding. That binding is not published by `describe()` until this record's readback is confirmed. The earlier receipt bytes/hashes remain unchanged; no retrospective rewrite or new receipt event is required. The 52-event maximum for the current nine-entry recipes and all original limits remain unchanged.

Pre-setup failure reports/index rows carry allocation provenance and an explicitly null full binding, rather than invented later observations. Replay accepts those incomplete-case failure records without a hypothetical final declaration, while a sealed case must match the caller's expected full declaration. These strings remain unauthenticated model data and cannot grant ownership or resume a supervisor.

Eleven regression/related tests were added. Fresh local verification passed all 100 behavioral plus four boundary tests and 189 existing selected tests: **293 total, no skips or failures**. Three syntax checks, `tsc --noEmit`, and document/whitespace checks passed. No further actionable issue was found in this local review; it is not independent review or native acceptance. This review uses direct per-file `--test-isolation=none` invocations and does not run product/test child processes, native code, signing, fixtures or cleanup. The initial implementation's previously disclosed help subprocess remains a historical exception, not a claim about this review. The user authorized a local commit only; hooks, signing and automatic maintenance must stay disabled for that commit. Dot remains PAUSED and its saved configuration, market/judgment/notification/mail rules and product retention conditions are not modified.
