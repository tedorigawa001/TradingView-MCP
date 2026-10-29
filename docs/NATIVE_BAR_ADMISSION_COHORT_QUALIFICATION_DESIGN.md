# 4-B3 Build, Evidence And Clock Qualification

Status: **4-B3-A, 4-B3-B and 4-B3-C reviewed in memory/source scope; private connections remain unexecuted; host/OS qualification and all invocation remain blocked**, 2026-10-29 JST. Original design baseline `63ff06b`; 4-B3-B starts from reviewed 4-B3-A `c1ade36`; 4-B3-C starts from `712112c`. This refines [4-B3](NATIVE_BAR_ADMISSION_UNSIGNED_CONTROLLER_DESIGN.md#remaining-4-b-slice-plan). The [pure-contract record](#4-b3-a-pure-contract-implementation), [private-connection record](#4-b3-b-private-unexecuted-connections), [review corrections](#4-b3-b-independent-review-and-corrections), [clock connection record](#4-b3-c-private-clock-and-timer-connections), [clock review](#4-b3-c-independent-review-and-correction) and [second clock review](#4-b3-c-second-independent-review-and-corrections) cover memory/source tests, not operational qualification. The existing [approval bundles](NATIVE_BAR_ADMISSION_UNSIGNED_CONTROLLER_DESIGN.md#approval-decisions), [execution design](NATIVE_BAR_ADMISSION_UNSIGNED_EXECUTION_DESIGN.md) and [acceptance plan](NATIVE_BAR_ADMISSION_UNSIGNED_ACCEPTANCE_PLAN.md) remain controlling. Conflicts block implementation rather than silently changing those contracts.

The original design turn changed documentation only; separately approved implementations are recorded below. None performs build, child/worker launch, native read, fixture operation, signing, evidence-file creation, real-data operation, MCP registration or production activation. Dot stays PAUSED; market/scenario/judgment/notification/mail and retention conditions are unchanged. The existing 436 artifacts are not newly qualified. Design examples and supplied-data tests must never report live qualification or saved evidence.

## Scope And Ownership

4-B3 supplies private qualification and clock connections, not the worker dispatcher (4-B4), evidence writer/fixture driver (4-B5), or complete operational assembly (4-B6). The public `inspectUnsignedCohortAssembly` remains a bounded, non-authoritative inspection; `executeUnsignedCohortAssembly` continues to refuse unconditionally before argument access or effect-capable imports. Existing C-C1a, inert-adapter and worker seals remain closed.

| Owner | Private original state | Never accepted from a caller |
|---|---|---|
| Supervisor invocation | Reviewed entry/profile, original monotonic origin/end, own child/FD inventory, irreversible stop and clock-invalid latches | Approval booleans, environment switches, callback clock, PID/FD or backend |
| Fresh builder | This invocation's exclusively allocated fixed root, input/tool/runtime closure, exact artifacts, original build-record FD/readback/close results | Saved build record, old output root, copied manifest, previous run's qualification |
| Cohort | Original build reference, qualified report namespace and directory handles, shared-index identity, common deadline | First case's run as index owner, serialized handle, model token |
| Case | Original cohort reference, fixed mode/case, its receipt/report identities and original worker session | Replacement cohort, caller path, another case's writer or timestamps |

A frozen null-prototype object is only a reference; its identity must be present in private state owned by the same live invocation. No reference reconstruction after controller loss, registry rehydration, general prepared-run setter, exported real factory or arbitrary qualifier callback. Model-only references inhabit a separate registry and are not convertible to runtime references.

Proposed private composition stays inside `test/helpers/unsignedCohortRuntime.mjs`; it must not make `unsignedInertAdapters.mjs`'s empty `preparedRuns` reachable. Pure schemas/planning can live in a new `unsignedCohortQualificationContracts.mjs`. Sharing build internals with a later stage needs a boundary review: the 4-C build-only entry must not import the cohort runtime or return a cohort reference. No new package script, CLI, MCP tool, automation hook or runtime flag is part of 4-B3.

## Fresh Build Qualification

### One Invocation, One Attempt

```text
SEALED
  future separately opened operational entry
  -> invocation clock/profile fixed
  -> fixed output root proved absent
  -> exclusive allocation -> input/tool closure fixed
  -> normal build -> UBSan build
  -> final bytes/profile/complete artifact set qualified
  -> original build-record fsync/readback/one confirmed close
  -> private live-build reference
  -> private report namespace qualification -> cohort ready

any unknown/failure -> STOPPED_RETAINED (never retry, adopt or resume)
```

Only the future private builder's actual completion in that supervisor can issue a reference. Compilation exit code alone is insufficient. Build-only `COMPILED_NOT_RUN`, a valid JSON record, matching hashes, an earlier probe or a successful memory model are not a substitute. Missing/failed record close blocks qualification even when the readback matched. The reference is neither returned to a public caller nor written to disk or a pipe.

Keep `build/b3cc-validation/` and its normal/UBSan layout. Existing root, symlink, alias, unsafe ancestor, unexpected type, source movement or ambiguous permission blocks before allocation. Resolving the old root is the user's separate manual prerequisite; do not enumerate alternative roots, move it, delete it or pick a new name. Failure after allocation retains the exact new root and original resource references; no repair, automatic rebuild or cleanup. Existing build-only behavior/profile is not weakened.

### Pin Manifest

The manifest is bounded descriptive data, not authority. Bind its version, role-tagged canonical rows, source status, profile and aggregate digests into the live reference. Reject unknown fields, duplicates within a role, missing mandatory fields, conflicting aliases and unsupported module resolutions. One physical file used by several roles has one identity/content row and explicit sorted role references, not contradictory duplicate rows. Distinguish ordered command inputs from sorted set digests; charge repeated reads even when rows are deduplicated.

| Group | Required information and qualification |
|---|---|
| Source | Commit plus source-root worktree status digest and actual complete file snapshot; include runtime entry/helper sources and build plans, not just tracked files. A dirty tree is described as dirty, not reproduced from HEAD |
| TypeScript | Exact compiler entry/runtime JS, project configuration, complete reported input set including declarations and standard libraries, emitted per-mode JS set; normal/UBSan JS byte parity |
| Runtime closure | Explicit fixed supervisor/worker/helper import graph, package metadata/resolution conditions and all selected runtime JS including zod. Eager worker imports before pins/READY; no newly resolved helper at GO. Unresolved computed import, unlisted dependency or unsupported loader blocks |
| Node | Launch path, resolved regular-file target, path-to-target binding, final-byte SHA-256, identity, version/ABI/CPU and approved startup policy. Reject preload/debug/report/loader startup options or incompatible inherited environment; no alternate Node fallback |
| Toolchain | Exact compiler, linker, Node headers and their transitive build inputs, SDK identity/settings and used inputs, UBSan runtime, fixed helper tools, selected argv/environment. No null linker/settings hash, path-only SDK claim or assumed four-header completeness |
| Outputs | Exact expected artifacts under both fixed mode roots, identities/modes/owners/link counts/sizes/content hashes and profile. No extra/stale files admitted as executable artifacts; scratch/reports/build record are separate roles, not executable outputs |

Closure collection must distinguish discovery from qualification. A bounded compiler dependency/input preflight may discover effective headers/SDK inputs only in a later approved build; qualify and hash the resulting closed set before compilation, compare compiler-reported dependencies and identities afterward, and reject additions/changes. Do not patch the manifest to fit newly observed inputs. Tool/runtime dependencies outside the reviewed closure cannot be silently omitted. OS shared-cache/system-library trust remains an explicit host-profile assumption, not a claim that the entire OS was hashed; unsupported dependency provenance blocks. Exact discovery argv and host-profile coverage require review before an operational entry can open.

SDK/tool launch aliases may be resolved only by the fixed role-specific discovery and recorded binding; that exception does not authorize symlinked checkout files, output ancestors, report paths or caller-selected aliases. Missing qualification, unsupported mount/metadata behavior or unstable before/after identities stops the invocation. This is not an attempt to authenticate a hostile same-UID process: the existing controlled-local-launch/non-malicious-same-UID assumption remains explicit.

### Checks And Budget

Full final-content checks occur at four runtime gates: build qualification, before normal's first fixture, before UBSan's first fixture, and final qualification. Before/after compiler input checks belong to the build phase and are separately charged. Before other actions compare the closed set's cheap dev/inode/uid/gid/mode/size/ctime/mtime bindings and exact expected output set; current ACL checks are separate. Never start a full hashing pass at every receipt or GO.

Immutable file pins do not include the report/build-record/scratch writers. Directory identity/type/ownership/mode/ACL/flags stay bound, but directory size/link count/ctime/mtime legitimately change through original recorded child creation. Track those actions separately; neither freeze mutable directory fields forever nor accept an arbitrary changed file pin as an expected directory update. No action updates the sealed executable/input digest.

The pure planner must calculate, before the corresponding reads, exact row counts, encoded bytes, aggregate file bytes and repeated hashing work. Use role-tagged bounded pages instead of passing 4096 rows through the existing 256-element generic array parser. Do not relax `copyData`'s depth/node/string bounds to accept a manifest. Proposed qualification contracts retain these existing ceilings: 4096 manifest rows, 64 MiB per regular input/artifact, 1 MiB captured output per tool, 4 MiB complete build record, and 65536 bytes/256 entries per ACL listing. A Node/tool role exceeding the file ceiling blocks pending a separately reviewed limit decision; it is not a reason to accept an unchecked binary.

Aggregate hash-work and command-count reservations are computed from the closed set and the four gates plus build checks, then compared with fixed qualification-profile ceilings. Those two new ceilings must be made explicit in 4-B3-A's capacity proposal/review before effect-capable code is connected; an absent ceiling is a blocker, not infinity or a caller option. No value is guessed from this host or chosen to make a failed run fit. Stream file content through a fixed bounded buffer; record actual charged bytes/commands and refuse before exceeding either reservation. Capacity estimates do not prove actual heap peaks or OS qualification.

Large manifests stay in the one bounded build record, not LAUNCH, receipts or the shared index. Compact digests reference them. Record encoding must include commands, retained-output metadata and failure/close information in the existing 4 MiB total; overflow is failure, not truncation of required pins. Do not put the build-record hash inside itself or treat the best-effort retained-output inventory as a qualified artifact list. Native's 256 MiB work envelope, owner reservation and observer budget are separate and unchanged.

## Evidence Namespace Qualification

### Fixed New Location

Derive only `build/b3cc-validation/reports/<run-id>/` from the original fresh build root and a supervisor-owned bounded run identifier. The identifier is correlation, not an approval token. Check the original fixed root/ancestor chain, exclusively create `reports/` and this run directory as 0700, and requalify immediately. Both must be newly owned by this invocation; an existing directory, name collision or inherited unsafe ACL stops without a replacement identifier. No path input, realpath-based adoption, prefix test or fallback to temporary/home/research/review-log locations.

Retain original directory FDs plus path bindings in the cohort. Creation failures preserve each directory's actual known existence and handle/identity, including an allocated directory whose later qualification failed. Do not claim that it is absent merely because initialization was incomplete. Close owned handles once as permitted by stop finalization, with errors recorded separately; never remove directories as rollback.

Closing an already-owned original FD is a close-only disposition, not a new path action: namespace taint or clock failure must not prevent that one close attempt. Do not reopen/requalify a pathname to obtain a replacement FD for closing, retry an uncertain close, or turn a confirmed close into permission to save, remove or resume.

### Before Every File Action

1. Confirm original cohort/build/namespace identity and applicable stop lane. A source/build failure may still allow bounded failure evidence if the namespace is independently safe; namespace uncertainty never allows a replacement destination.
2. Re-read each fixed ancestor and owned directory without following links; compare dev/inode/type/uid/gid/mode and the original directory-FD binding. Ancestors may be root/current-UID owned but not group/other writable; private directories must remain current-UID 0700. Reject unsafe flags, unsupported metadata or unknown permission results.
3. Obtain a fresh bounded ACL result for each relevant chain node and existing writer file. POSIX mode alone is insufficient. Allow only the reviewed no-ACL/deny-only profile; any allow ACE (including inherited), ambiguous listing, malformed/truncated output or changed identity blocks. Permission changes are never fixed with chmod/chown/ACL edits.
4. For an existing writer, compare original FD, path, regular type, current-UID 0600, nlink=1 and exact committed offset/size. Reject symlinks, aliases, replacement or unexpected growth/shrinkage. Reserve the next encoded operation before its open/write. Recheck identities and byte readback afterward.

ACL collection keeps fixed `/bin/ls -lde` with no shell, bounded output and fixed locale, asynchronously supervised, never `spawnSync` on the supervisor's timed path. Mode-specific flag qualification needs a fixed read-only metadata result as well: propose `/bin/ls -ldeO` on the same exact node, under the same one-helper slot and bounds, with a strict separately tested parser. It is not a native observer/reader call. Both listings' actual supported output/flag interpretation remain unverified until the later OS qualification stage; no parser match or missing field may mean "safe" by default. This proposed extra metadata command needs the normal 4-B3 implementation review and later operational approval, not execution in this design turn.

Refine the earlier `execFile` sketch into a private fixed-argv `spawn` transport with explicit bounded stream accounting and no automatic timeout/overflow signal. On capture overflow, latch failure and stop further capture into memory; retain the original process and bounded stream state, without a fallback command or forced exit. Do not use a wrapper's automatic buffer-limit termination. Compiler children also occupy the single helper slot and use the original remaining entry/build bound, not an invented 10000 ms compilation allowance or a case window. All compiler/metadata children are asynchronous in the future supervisor; no synchronous tool wait may disable its original timers. This transport is connection code only until separately approved invocation.

Do not cache ACL success across file actions. Because each listing is asynchronous, recheck deadline, stop lane and path/FD identities immediately after it and again before the file action. At most one helper child exists; a helper that exceeds min(10000 ms, remaining phase/entry bound) stops the run and retains its original child reference. No kill-on-timeout option, retry, alternate tool or automatic signal. Count these helper calls in the qualification profile separately from the observer's invocation allowance.

These are qualified pathname/FD checks under the existing same-UID assumption, not descriptor-relative creation/removal or a solution to the check/use race. An open directory FD alone does not make a later pathname operation safe against a malicious same-UID replacement. No deletion capability is added here.

### Shared Index And Saving Boundary

Keep fixed names: `<mode>-<case-id>.receipt.jsonl`, `<mode>-<case-id>.report.json`, `run-index.jsonl`. Mode/case are from the fixed catalog, not user strings. The shared index belongs to the cohort, never the first case. Expiring a case must not expire its owner's index checks. Losing the cohort blocks all new construction; stopping a still-live cohort blocks ordinary/new-case construction and preserves only its explicitly permitted 4-B2 failure-finalization lane. A case reference's apparent state cannot bypass either restriction.

4-B3 qualifies the original directory context and defines writer-owner binding; it does not open/write actual receipt/report/index files during validation. 4-B5 will connect original exclusive `O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW` 0600 opens, append-offset tracking, fsync, exact byte readback and single-close bookkeeping. Unknown open/write/fsync/readback/close taints the affected resource and prevents replacement or retry of an uncertain operation. Legitimate bounded short writes may advance the original cursor, but never restart a failed/uncertain append. No overwrite, rename-to-repair, truncation, automatic re-open or alternate file.

Retain the reviewed 4-B2 stop distinctions: before a candidate, only the permitted confirmed stop-summary/FAIL path; after candidate fixation/emission, no new evidence construction. Original already-emitted readbacks and original write/close outcomes can still record facts, not restart reporting or cleanup. A pending index readback prevents NOT_RUN finalization; after that finalization no new receipt/report/index construction. Cohort index close is once, and its runtime result is outside the already-written index. Never claim saved evidence or completed finalization merely from the qualification reference.

Existing ceilings remain: 64 receipt records/1 MiB, 16384 bytes/record, 262144-byte report, 131072-byte index (4096 header plus 24 rows of at most 5290), 24 fixed cases, unchanged recipe count/reservations. No extra qualification journal or twenty-fifth summary row. Failure diagnostics keep bounded primary/save/close outcomes and known partial locators/counts/hashes, not raw ACL output, keys, native responses or inferred successful saves. If required failure data does not fit or the destination is unsafe, retain it only within the bounded terminal diagnostic and report persistence as failed/unknown.

## Original Clocks And Windows

### Authority And Domains

The private supervisor reads its own `process.hrtime.bigint()` for monotonic points and `Date.now()` for wall labels; no runtime clock callback or externally supplied now/deadline. Capture the original invocation origin before any future build/tool action. Its reviewed entry supplies a fixed total limit only after the corresponding operational approval; missing/zero/unreviewed limit leaves the entry sealed. Build time is included, never followed by a new full cohort budget. Build-stage operations use that entry's remaining budget, not a case preparation/query window that has not begun.

The 4-B2 coordinator receives that same origin and absolute end when it is created after qualification. It must not reset `started_ns` at cohort readiness, mode change or case start. Check that the remaining bound covers the fixed 900000 ms case worst case before allocating a case; otherwise mark remaining rows NOT_RUN without opening case resources. This does not choose a total operational duration now: it remains part of the later 4-E approval and reviewed entry constant.

The supervisor creates one private clock-domain identity per invocation. A worker declares its separate domain in the original launch/READY session; validate syntax, bind it once to that worker and reject changes. Worker points order only that worker's trace; supervisor points order dispatch/write/receipt/receive facts. Never subtract parent and worker points, infer a dispatch timestamp from an arrival, or translate child wall time into a parent deadline. PID, domain labels and run IDs alone grant no authority.

`actualParentStamp` samples `mono-before -> wall-ms -> mono-after`, validates nonnegative/nondecreasing same-domain monotonic values and a finite representable wall value, and uses `mono-after` with UTC/JST strings derived from the same wall-ms. Keep both monotonic sampling bounds in bounded invocation diagnostics; the existing receipt stamp shape is unchanged. UTC midnight/JST date rollover has no lifecycle effect. No promise of NTP accuracy, exact event time inside the bracket or power-loss continuity.

Wall time is descriptive, never elapsed-time authority. A backward/changed wall clock keeps its actual labels and an uncertainty indication; it does not renew a deadline or retroactively reorder monotonic events. Invalid/unrepresentable wall data prevents producing a new stamp and stops new work. Exceptions, malformed monotonic points, domain changes or rollback permanently invalidate timed dispatch; a later valid clock sample cannot recover it or create a new settlement grace. Keep already-known original resource outcomes even when their later timestamp is unavailable; do not invent a zero/current valid point.

### Fixed Internal Operations

| Operation | Private connection and stop rule |
|---|---|
| `remainingPhaseMs` | Sample the original clock, select min(original phase deadline, original invocation end), floor to whole ms; less than one ms refuses. Before any case phase exists, only the entry-bound build/qualification lane is available |
| Short qualification helper/observer/write reservation | min(10000 ms, remaining applicable window); reserve referenced timer before dispatch and consume operation identity once. Compiler supervision uses the separate original entry/build remainder. A reservation is not permission to dispatch after its expiry |
| Ordinary dispatch | Check at planning and again at actual original write-start, after intervening qualification awaits. GO write-start, not intent/readback/acceptance/completion, starts query supervision |
| Shutdown CANCEL | Recheck original binding, frame/ordinal budget, clock qualification, worker/pipe liveness and original settlement deadline at actual write-start; no later retry or renewed window |
| Readback/completion/exit | Apply the original completion, even after stop. A completion observed before stop samples the clock in its check; one arriving after stop records the fact without a new sample or invented timestamp. Lateness remains failure. Recording a close/exit does not create release/ownership proof or permit new work |
| Timer callback | Read clock again. Early callbacks re-arm only for the remaining original deadline; delayed callbacks latch the known original deadline, not callback time. A stale operation-generation callback cannot affect a new phase |

Use the unchanged preparation/query/settlement/teardown bounds of 120000/600000/60000/120000 ms and helper/write/observer cap 10000 ms. Settlement is set once from the first original stop/cancel/completion trigger, never its later observation. The clock-invalid lane cannot send a timed CANCEL; closing the original command pipe once and retaining original resource facts remain governed by the existing shutdown policy, not a guessed time window.

All timers are referenced, associated with original operation generations and cleared/settled once; no `unref`, interval-based renewal or second timer as a fresh allowance. Check long hashing loops between bounded chunks and check the clock immediately after synchronous OS calls. Timers cannot interrupt a blocked synchronous call; late return stops before its next action. On helper timeout retain the original child and all known pending handles. Default signal policy remains none; no forced process exit, PID-based signal or auto-recovery. A lost supervisor invalidates all live references.

## Failure Decisions

| Observation | Required disposition |
|---|---|
| Old root, incomplete input closure, changed pins, null tool hash, unexpected artifact/profile | No live-build reference; retain new outputs if any; later cases NOT_RUN |
| Build record readback/close unknown | Descriptive compiled output only, qualification failed; no report namespace allocation |
| Unsafe/changed/unknown namespace, ACL, flags or writer binding | Taint namespace/writer; no further saves there, no replacement path; bounded terminal diagnostic only |
| Build/source invalid but namespace independently qualified | Stop execution; only the already-permitted failure-evidence lane, never a fresh success or cleanup |
| Helper still live past its bound | Stop subsequent helpers/worker/fixture actions; retain actual child; user action needed, no signal |
| Monotonic fault or unparseable timed envelope | Permanent timed-dispatch refusal; no valid-sample recovery; preserve original late callbacks without new work |
| Wall adjustment only, valid values | Keep factual labels/uncertainty; order and deadlines stay monotonic, no added trading/notification rule |
| Case retired, original cohort/index valid | Later legitimate index work uses cohort ownership, not the retired case; stop/freeze rules still apply |
| Cohort deadline/stop reached while original write/close is pending | Preserve its actual completion/uncertainty once, but no continuation or PASS manufactured from a late callback |

## Proposed Implementation Slices

These are proposed approval boundaries, not authorization by this document:

| Slice | Deliverable | Allowed validation after separate approval |
|---|---|---|
| **4-B3-A (recommended next)** | Pure role/pin/namespace/clock-result schemas, paged manifest/capacity plan and irreversible supplied-data qualification model; explicit fixed hash-work/helper-count ceiling proposal and accounting | Main-thread memory/source tests only. No real clocks/timers, OS tools/FS qualification, key/signature, build/child/native/fixture/evidence write. Every qualification/execution/save/ownership/timestamp flag false |
| **4-B3-B** | Reviewed private fresh-builder provenance and evidence-namespace connection code; exact effect import/command/closure list, original resource ownership and stops | Unexecuted connections; injected memory substitutions only inside source-extracted tests, never a public injectable runtime. No actual builder/tool/file creation or real reference issuance during validation |
| **4-B3-C** | Private own-clock/referenced-timer connections to 4-B2, common entry origin/end, cohort-owner checks on the timing input (the index consumer itself connects in 4-B5), boundary/source guards | Memory clock/timer/tool results plus structural tests; no real timer, child, native, fixture, signature, saved evidence or seal opening |

If a helper-count/hash-work bound, dependency coverage, metadata parser or entry policy is not fully specified/reviewed, its effectful connection stays blocked. No numeric cap is inferred from an old successful build. Actual OS qualification waits for 4-C/4-D/4-E; each invocation needs its own fresh build and approval bundle. Completing 4-B3 is not acceptance of a native run, recovery authority, permission to publish evidence, or approval to run a partial cohort.

### Required Memory And Boundary Cases

- Identity: reject copied/serialized/model tokens, cross-invocation references, old-record adoption, reused root, wrong signature profile and missing build-record close. Original private issuance only after every required gate; no issuer exported.
- Closure/capacity: missing runtime zod/Node/linker/header dependency, new import/dependency after sealing, duplicate alias, dirty-source mismatch, extra output, unsigned/ad-hoc profile mix, all maximum sizes and one-over cases. Exact complete-record size and repeated hash/helper work, separate from native/observer/4-B2 model budgets.
- Namespace: inherited allow ACL despite 0700, ACL/identity change during await, truncated/ambiguous metadata, unsafe flags, alias/symlink/FD-path mismatch, unqualified partial allocation, collision, wrong link count/offset; no repair/retry/fallback. A later case can bind only the original cohort index, not the first case or a replacement writer.
- Clock: zero/one-ms boundaries, exact deadline, rollback/domain mismatch, malformed envelope then valid stamp, UTC/JST rollover and backward wall labels, delayed/early/stale timer, build time consuming cohort time, and helper time consuming the phase before actual write-start. No cross-domain arithmetic or new grace.
- Stop: readback/close/exit after stop, uncertain GO then CANCEL, unknown clock preventing timed CANCEL, pending index before NOT_RUN, candidate freeze and no new construction after NOT_RUN. Late facts remain facts, not resumed authority.
- Seals: importing/calling every public inspection/execution entry with hostile getters refuses before effects; constructible tripwires for process/FS/network/native/key/signature/timers and source checks for private imports/exports/flags. Tripwires are a secondary guard, not a sandbox or OS proof. Existing 4-B1 signing tests are not implicitly reauthorized.

Design exit: linked contracts, ownership/failure rules and next approval scope are documented. No implementation, test success, independent review, live qualification or operational acceptance is claimed by this document.

Documentation verification: relative links/anchors and whitespace checked; only this new document, its parent design and the backlog changed. Read-only before/after checks found the 2568 protected source/native/build/package/config content hashes unchanged, the 436 old artifact hashes/sizes/modes unchanged, and Dot PAUSED with its complete configuration hash unchanged. These are non-mutation checks, not 4-B3 behavioral or OS-qualification tests. No commit or push in this design turn.

## 4-B3-A Pure Contract Implementation

2026-10-29 JST, baseline `63ff06b`, after explicit approval of pure contracts/capacity and memory tests only. Existing uncommitted design documents are preserved. New files:

- `test/helpers/unsignedCohortQualificationContracts.mjs`: three pure exports (profile, capacity planner, supplied-data model), with no runtime import, real clock, timer, filesystem, child, key or signature operation.
- `test/unit/nativeBarAdmissionUnsignedQualification.test.mjs`: memory tests with guarded imports and constructible effect tripwires, including real-clock/timer refusals.
- `test/unit/nativeBarAdmissionUnsignedQualificationBoundary.test.mjs`: fixed imports/exports, source-mutation guards, no production/builder/worker connection and unchanged unconditional runtime seal.

### Fixed Reservations

These are harness qualification limits, not changes to trading, notification, retention, native work or observer limits:

| Quantity | Bound and accounting |
|---|---|
| Manifest | 4096 distinct physical file rows; 64 pages, 128 rows/65536 encoded bytes per page; 2097152 aggregate canonical-row bytes |
| Individual file / full pass | 64 MiB / 256 MiB, including Node/tool roles; oversized input refuses, with no fallback |
| Content hash work | 2 GiB total = four input before/after passes plus four complete runtime gates at most. `8 * input_bytes + 4 * artifact_bytes`; inputs and artifacts share the 256 MiB pass ceiling |
| Qualification helper commands | Ceiling 131072; reserve `discovery + 2 * (rows * 8 + namespace_nodes * 4)`. Discovery <=128, namespace nodes <=32; maximum reservation 65920. Factor 2 reserves ACL and flags metadata. No actual command is invoked |
| Build record | Manifest reservation plus caller-supplied bounded non-manifest reservation <=4 MiB; complete-record-body validation/saving belongs to the later private builder |
| Other bounds | 1 MiB tool capture; 65536 bytes/256 ACL entries; 65536-byte future hash buffer. No allocation/read of that file buffer occurs here |

These finite reservations precede effectful connection. The helper-command reservation deliberately excludes 4-B5 per-append writer work, which must receive its own complete schedule and fit the shared ceiling before connection; the headroom is not an assertion that every later writer schedule fits. Modeled counters charge supplied checkpoints and reserved discovery only, never observed OS work. JSON byte bounds are not V8 heap measurements.

### Model Semantics And Limits

Input pages close before the four ordered input checkpoints; output pages can be added only afterward. Closing outputs requires exact `src/**/*.ts` -> relative `.js` names (excluding `.d.ts`) and identical JS bytes in normal/UBSan, plus each mode's fixed addon/observer. Duplicate paths/inodes, conflicting output roles, aliases, unsafe modes/owners/links/ACL summaries, unknown fields, bad digests, missing declared roles and mixed signature-profile descriptions stop permanently. The mapping is the current project's fixed emit profile; a future builder must independently verify the compiler's actual dependency/emit closure and cannot infer it from these model declarations.

Supplied build qualification precedes matching record/readback digests and confirmed fsync/close descriptions; namespace binding follows only afterward. Namespace data uses a bounded symbolic ancestor/checkout/build/output/reports/run chain, exact derived report directory, original model owner and FD/path identity descriptions. Mutable directory child fields are not file pins. An unsafe/unknown namespace result taints the model. The shared-index owner reference is cohort-model scoped, not case scoped, and copied/foreign/stopped references refuse.

All clock values are supplied data. The model retains one original end across build/mode checkpoints, floors the remaining window and permanently stops for malformed points/envelopes, rollback, domain mismatch or deadline. Gregorian UTC/JST labels are checked with pure arithmetic against the same supplied wall milliseconds. Backward labels and wall deltas inconsistent with monotonic sampling brackets become uncertain without changing the deadline; invalid labels stop. No real timer dispatch, stale-timer transport, helper supervision, actual close-only execution, repeated live namespace check or 4-B2 adapter connection is implemented here; those remain 4-B3-B/C and later stages.

An opaque identity is only a model token. Closure-complete/metadata/record/FD descriptions are unauthenticated supplied assertions, not OS evidence or original-builder provenance. Every approval/ownership/save/timestamp/signing/runtime qualification flag remains false, native status NOT_RUN. Header Node/version/ABI/profile data is syntactically bounded, not verified against a host. No record body, ACL text, filesystem dependency graph or signature is read/verified/saved by this helper.

### Initial Implementation Verification

The first profile/capacity/order tests failed before their implementation. Expanded tests exposed two implementation gaps, then passed after correction: identical stale JS in both modes must still fail the exact source-derived emit set; a forward wall jump must be marked uncertain just as a backward jump is. The source boundary initially rejected the benign regex `.exec` spelling; the parser now uses `.match` without weakening the forbidden process-execution guard.

New **82 memory + four boundary tests** pass, including a constructible-tripwire self-test, 4096-row positive case, aggregate-manifest overflow, exact file/pass/2-GiB hash boundaries, denied inherited ACL summaries, namespace substitution, readback/close refusal, permanent clock failure and UTC/JST/leap-day cases. Selected regressions pass **627 tests**, zero failures/skips: the two new files plus existing unsigned assembly/controller/execution/acceptance memory and boundary files, run individually with `--test-isolation=none`. No npm/pretest/build, signing-test reuse or full operational suite.

Final read-only checks: all three new JS files pass syntax checking; document links/anchors and tracked/untracked whitespace checks pass. The 2568 protected content hashes, 436 existing artifact hashes/sizes/modes and Dot's PAUSED/full-configuration hash match the pre-implementation baseline. No independent review, commit or push is part of this implementation request. Completing these supplied-data tests does not open any entry or qualify a real build, namespace, timestamp, index or native run. 4-B3-B/C, 4-B4 through 4-B6 and all operational stages still need separate approval.

## 4-B3-A Independent Review And Corrections

2026-10-29 JST, review of the six uncommitted implementation/design files on `63ff06b`, followed by user-authorized corrections and local commit preparation. Two read-only reviewers independently covered state/binding/namespace/clocks and capacity/tests/boundaries/documentation. They reported two P2 findings and one P3 test gap:

- **P2, emitted-name order:** source paths `src/a.test.ts`, `src/a.ts` sort in that order, but emitted names sort as `a.js`, `a.test.js`. Comparing the unsorted mapped source array incorrectly refused a valid exact output set. Sort the mapped expected names before comparison, without changing manifest order/hashes or weakening parity/exact-set checks. A new positive test failed with `artifact_set` before the fix and passes afterward.
- **P2, retained overflow:** the model appended a page before checking aggregate manifest bytes, leaving its stopped retained snapshot above 2 MiB. Check prospective bytes first, validate against both retained and staged path/inode sets, and commit page rows/counters only after complete validation. Strengthened overflow-retention and new invalid-final-row atomicity assertions both failed before the fix and pass afterward. Rejected pages preserve the prior rows, counters and byte bound; the stop latch remains irreversible.
- **P3, cumulative limit sensitivity:** add direct ingestion tests for the 4097th short row and the 65th one-row page, independent of the capacity planner and per-page tests. Both refuse without retaining the excess row/page; their preceding 4096-row and 64-page prefixes are accepted. No ceiling was raised.

The state reviewer rechecked the order correction and independently reran **83 memory tests** with no remaining actionable issue in that scope. After the staged-page correction, the capacity reviewer rechecked adjacent duplicate/staging logic and independently reran **86 memory + four boundary tests**, with no new code/test findings. The earlier 82/627 counts above are the initial implementation record, not the revised result.

Final selected regressions by the implementing session pass **631 tests**, zero failures/skips, using the same ten individual main-thread memory/source files. All original limits, false qualification/authority flags and public entry seals remain unchanged. Syntax, document references and whitespace checks pass. The protected 2568 content hashes, old 436 artifact hashes/sizes/modes and Dot PAUSED/full-config hash match the review-start baseline. Only the three new helper/test files and three approved design/backlog documents are included in the requested local commit; no build, operational child/worker, native read, fixture, signing/key, real-data operation, MCP/production activation, Dot restart, trading/notification/retention change or push is included.

## 4-B3-B Private Unexecuted Connections

2026-10-29 JST, from `c1ade36`, after approval to add private connection code and memory-only tests. `unsignedCohortRuntime.mjs` keeps its original two public exports: inspection returns false qualification flags and execution refuses before examining arguments. Neither calls the new zero-argument private composition root. There is no exported factory, registry setter, arbitrary path/backend/clock parameter, CLI, package script, MCP entry or automation connection.

### Added Connections

- A private fresh-build flow owns its state, directory/file handles, input/artifact pins and weak build/namespace registries. The fixed root must be absent; original exclusive allocation, normal/UBSan ordering, final snapshot, original record write/fsync/exact readback/confirmed close, umask restoration and new report namespace precede return of any private references. Existing/saved outputs and supplied JSON are not producers. The namespace references the same original build/state, not a first case or copied descriptor.
- Fixed source traversal and TypeScript input discovery, source-parsed literal runtime imports/reexports, explicit Node/zod/TypeScript/tool/SDK/header roles, preprocessor dependency discovery and comparison with compiler-produced `.d` files are connected. Input rows are bounded, aliases are explicit, AST-read hashes bind to the first snapshot, later source additions/pin changes refuse, output names are source-derived and normal/UBSan JS bytes must match. Unknown or computed module resolution refuses rather than being omitted.
- The private native build plan derives from the unchanged unsigned plan but uses a separate fixed linker-ad-hoc prototype and scratch dependency files. It is not an option on the old build-only entry and has never run. New-addon permission normalization is limited to its original fresh output FD/path; no existing/common output is repaired.
- Ancestor/path/FD checks, 0700 exclusive report directories, 0600 exclusive record, link/offset/owner checks, strict bounded deny-only ACL/zero-flag listing parsers, and rechecks after asynchronous metadata operations are wired. Unknown output, inherited allow ACL, changed identity, partial allocation or namespace collision stops, without relocation/retry/deletion. Original close attempts work after stop and never reopen a replacement handle.
- One fixed-argv asynchronous helper transport has bounded combined stdout/stderr, an original child slot, a required referenced supervision handle and no shell, automatic timeout signal, kill, destroy or unref. Overflow pauses capture and retains the child. Late close records disposition only; it cannot resume a stopped scope. Compiler waits use the future original entry bound, not a new case window.
- A private module-owned set retains at most one attempted scope, including known allocations, failed/unknown closes and original children. Even a failure with confirmed closes is not retried in the same supervisor. Primary errors, close outcomes and umask-restore uncertainty remain distinct. No cleanup or controller-restart adoption is added.

### Closed Prerequisites And Limits

This is **connection code, not an operational builder or host qualification**. Five private functions remain unconditional refusers and are pinned by source tests: operational-entry policy, original clock, referenced timer connection, host dependency-closure qualification, and native signature qualification. Policy/clock refuse before the private root imports filesystem/process capabilities. There is no supplied `approved`/`qualified` flag that bypasses a gate.

4-B3-C still needs the original clock/timer integration. The later operational/profile stages must qualify the actual Node startup/module resolution, package export conditions, CJS/computed-resolution coverage, compiler/linker/framework/SDK input closure, shared-cache trust profile and native signatures. The current source/dependency collector is not by itself proof of complete effective host inputs: notably, preprocessor dependencies alone do not cover linker/framework inputs. The host-closure gate therefore refuses before any compiler plan can run. Missing future worker sources or unsupported runtime resolution also block. No gate may be replaced with a model boolean or successful parse; operational unsealing and any shared build-only refactor need their own reviewed approval. The standalone 4-C entry must still not import this cohort runtime.

Metadata parser strings, dependency output shape, tool argv, signature profile, native bytes and platform behavior have **not** been compared with the real OS in this turn. Unknown formats refuse. This implementation opens no cohort/mode execution, worker, query, fixture, case receipt/report/index writer or post-stop failure-evidence lane. Those later consumers must requalify the original namespace and supply the existing stop/freeze rules; the private initial namespace reference alone grants none of those actions.

Original 4-B3-A limits are unchanged. Actual future file-hash charges are separate from native/observer work, with hard 64-MiB file, 256-MiB pass and 2-GiB total ceilings. Bounded discovery/AST/dependency reads also consume that total and can conservatively refuse before the modeled maximum; no larger budget is inferred. Directory enumeration is incremental and bounded; manifests refuse before retaining an over-limit row. Build-record I/O is one bounded write/readback pair (at most twice 4 MiB), not another executable-input hash pass. The record carries role-tagged snapshots and fixed tool plans, with a count/digest prefix explicitly labeled `before_record_open`: metadata calls needed to qualify its own write/readback cannot be self-included. No extra record cycle or claim of power-loss durability is added. Later per-case writer work remains unreserved and disconnected.

### Initial Memory Verification

Two new test files cover **40 memory + five boundary tests**. The memory suite installs constructible effect tripwires before importing the sealed runtime; filesystem mutation, native/child/worker/network/key/signature/RNG/real-clock/timer calls are refused. Only private function declarations are source-extracted into isolated VM contexts, with invented in-memory nodes/FDs, child emitters, timers and separate registries. A successful simulated flow creates **VM-local references only**, never a reference in the imported module. Converting VM capacity DTOs to host plain data avoids a cross-realm prototype rejection; it does not create runtime provenance. No disk fixture, key, build or process was made for tests.

Coverage includes original record readback/close ordering, combined primary/close failure, failed umask restoration, partial directory allocation, permanent one-attempt disposition, namespace collision/copy refusal, streaming FD/path/content checks, link-count changes, ACL/flag parser refusal, dependency and runtime import parsing, source changes between discovery and snapshots, exact artifact sets/parity, bounded tool output/timeout, unreferenced timers, missing pipes and late original-child close. The five boundary tests pin public/private seals, private import/producer placement, fixed spawn constraints and absence from production/launch entries. Existing 4-B2/4-B3-A boundary tests now delegate only this named private body to the new strict connection boundary; the public seals, pure-model import checks and forbidden top-level operations stay intact.

Selected regressions pass **676 tests**, zero failures/skips, across twelve individual main-thread files using `--test-isolation=none`. No npm/pretest/build or signing tests. These results do not prove actual compiler/Node/Mach-O/ACL/dependency output, timing, filesystem durability, live reference issuance or native acceptance. Independent review, commit and push are not performed in this implementation request.

Final non-mutation checks match the start of this slice: all 2568 protected source/native/build/package/config content hashes, the 436 old artifact hashes/sizes/modes, and Dot's PAUSED/full-configuration hash are unchanged. Five changed JS files pass syntax checks; changed/new source whitespace and document links/anchors pass. Changes are limited to the runtime helper, two existing boundary tests, two new tests and three design/backlog documents. No real evidence file or runtime reference was created.

## 4-B3-B Independent Review And Corrections

2026-10-29 JST, separate user request to review the eight uncommitted files on `c1ade36` and commit after correction/verification. Two read-only reviewers independently covered provenance/resource/stop lifetimes and input-set/capacity/test-boundary behavior. Four P2 findings and two P3 findings were corrected:

- **P2, record stability:** preserve the complete size/link/time/identity observed immediately after byte readback and compare it again after asynchronous metadata checks. Previously an append/rewrite in that interval could be accepted with an old hash. A final original-record pin check also prevents changes during namespace construction from issuing a namespace reference. Both new negative tests failed before correction; same-size/time-changing rewrites and appends now refuse.
- **P2, late child outcome:** record a bounded original helper disposition (command ordinal, exit code/signal, known/late flags) before clearing child slots or taking the stopped early return. A duplicate close cannot overwrite the first actual result. This records facts without restarting work or manufacturing release proof.
- **P2, TypeScript set stability:** re-run the original fixed `--listFilesOnly` command before and after every full input snapshot and compare its strict, sorted set with initial discovery. A changed configuration/library set cannot be pinned after discovery while omitting the added input. These calls consume the existing discovery/helper reservation; no ceiling increases.
- **P2, import-await race:** recheck the original helper slot after the asynchronous child-module import, before any spawn. Concurrent import continuations previously both passed the initial empty-slot test. The test substitution now preserves the await via a resolved in-memory module, rather than erasing that scheduling point; the reproducer observed two simulated spawns before correction and only one afterward.
- **P3, primary error:** addon permission normalization now preserves its primary failure when the original close also fails, while retaining the unknown close once. The reproducer initially received the secondary close error instead of the original permission error.
- **P3, enriched capacity row:** include artifact `mode` and `kind` in the candidate row before the canonical-byte check and retention. A near-2-MiB synthetic-prefix test initially admitted an over-limit result and now refuses before retaining the last row. This is a byte-boundary test, not an OS-qualified input manifest.

Each substantive reproducer above failed before its correction and passes afterward. A P3 follow-up adds a direct change-during-snapshot case for the second TypeScript recheck; it observes the initial discovery plus before/after listings (three calls) and refuses the intervening change. An attempted temporary guard-removal mutation was rejected by the protection mechanism and was not performed; no mutation-failure result is claimed for that follow-up. Guards remained in place for the direct interleaving test. The earlier 40/676 counts are explicitly initial implementation results, not the revised totals.

Final independent rechecks report no remaining findings in the assigned scopes. The state reviewer directly reran **47 memory + five boundary tests** after its fixes; the input/capacity reviewer directly reran **48 memory + five boundary tests** after the final coverage addition. The implementing session ran the same twelve-file selected regression set: **684 tests passed**, zero failures/skips, all files separately with `--test-isolation=none`.

All five prerequisite gates, public seals, limits, native/observer budgets and market/judgment/notification/retention conditions are unchanged. The protected 2568 content hashes, 436 old artifact hashes/sizes/modes and Dot PAUSED/full-config hash match review start. Syntax, links and whitespace are checked. Only the runtime helper, four test files and three design/backlog documents belong to the requested local commit. No build, operational child/worker launch, native read, fixture operation, signing/key creation, real-data operation, MCP registration, production activation, Dot restart or push occurred. This review does not qualify a host, filesystem, native object or operational run.

## 4-B3-C Private Clock And Timer Connections

2026-10-29 JST, implementation on `712112c`, under approval for connection code and memory-only synthetic tests. The private root now contains its own monotonic/wall clock and referenced qualification timer implementations. The operational policy still unconditionally refuses **before** either clock access or effect-capable imports; host-closure and native-signature gates also remain unconditional refusers. The two public exports, execution refusal, imports, operational entry seals and all original limits remain unchanged. Replacing the two private clock/timer placeholders is not operational unsealing.

### Implemented Connections

- The zero-argument clock reads only its private policy's canonical positive `total_limit_ms`; no duration is chosen here, no caller clock/deadline or approval flag is accepted. Origin precedes all future build imports/tool work. A frozen B2-compatible binding preserves that origin and the original absolute end across readiness/mode/case transitions. Thirty-digit monotonic bounds, nondecreasing samples, exact-end refusal and floored whole-ms reservations prevent a fresh allowance. Invalid/throwing/rollback samples permanently latch refusal; later valid samples do not recover.
- `stamp()` brackets one wall sample with monotonic reads. Its nested `stamp` preserves the existing four-field receipt shape; separate bounded `sampling` metadata retains both points and the same wall-ms. UTC/JST labels use explicit milliseconds, including midnight/leap-day rollover. Backward labels or non-overlapping elapsed/wall intervals (allowing one-ms quantization) set a sticky **possible adjustment**, not an assertion of NTP error. Wall labels never authorize elapsed time. Invalid/unrepresentable wall samples stop new work. Only the previous sample is retained, not an accumulating history.
- Qualification timers allow only the existing metadata/discovery/compiler roles and one original timer slot per retained invocation. Metadata/discovery use min(10000 ms, original entry remainder); compiler uses original entry remainder. Handles must report referenced. Original generation/segment identities make cancelled or earlier callbacks inert. Early callbacks re-arm only the remaining original deadline, including a final sub-ms detection segment; long delays are segmented at Node's 2147483647-ms scheduling ceiling without moving the end. Delayed callbacks retain the known deadline, never their later observation as a fresh trigger.
- Actual spawn-start, output chunks and close completion recheck the reservation. Timer cancellation is attempted once; unknown cancellation stops work and retains the original timer reference and a bounded uncertainty flag, without retry. A prior timeout/tool failure stays primary. An unknown clear cannot turn a completed tool into success. Original timed-out children stay retained until their original late close callback records facts once, without new clock-dependent work, signal, replacement child or restart. Timers cannot interrupt blocked synchronous OS calls.
- `originalCohortTiming` checks the original retained state, weak build/namespace references, confirmed record close/identity, cohort namespace phase and evidence stop/taint before returning descriptive timing input. The private builder calls it only after namespace qualification. It is reusable by the later cohort/index consumer independently of first-case retirement; copied, foreign or first-case substitutes cannot qualify. It is **not** a writer, execution grant, new namespace check or saved evidence. B2 construction with that binding is compared in memory, not performed by a new operational driver.

### Validation And Remaining Work

The new memory suite source-extracts only private declarations into a separate VM with explicit fake monotonic/wall sources, manually fired fake referenced handles and invented child emitters. Real clock/timer, child/worker, native, filesystem mutation, network and signing/key calls are denied by constructible tripwires installed before importing the sealed module. Deterministic calendar formatting uses explicit invented milliseconds only. A first run exposed a missing `refuse` declaration in the test VM; adding that test dependency resolved it without changing a runtime guard. No public injection seam was added.

Selected main-thread regressions comprise **753 passing tests**, zero failures/skips: **68 new clock/timer memory tests**, the existing 48 private-connection memory tests, six connection-boundary tests and the existing qualification/assembly/controller/execution/acceptance memory and source-boundary suites. Files run separately with `--test-isolation=none`; no npm/pretest/build, signer suite or operational whole-repository suite is used. Coverage includes real-transport source with invented children/timers, original-end consumption during an import wait, late callback/close behavior, cancellation uncertainty, fixed B2 phase limits/900000-ms fit, domain/envelope failure and retained close-only disposition. This is not actual scheduler, power-loss, clock-source, host or OS qualification.

Actual GO/CANCEL/worker session timestamp consumers (4-B4), cohort-owned writer and observer phase timers (4-B5), and final private assembly/request provenance (4-B6) remain disconnected. Those consumers must use the original binding and recheck their original B2 phase at actual write-start; this slice does not replace them with arbitrary callbacks or invent `patch_sha256` from input hashes. The fixed operational total duration, host dependency closure, OS signature/profile qualification and operational approval still block invocation. No real clock/timer, build, child/worker, native read, fixture, signature, real-data operation, MCP/production activation, independent review, commit or push is performed in this implementation turn. Dot remains PAUSED with unchanged judgment/notification/retention conditions.

## 4-B3-C Independent Review And Correction

2026-10-29 JST, review of the seven uncommitted 4-B3-C files on `712112c`. Two read-only reviewers covered clock/timer/tool lifetime and timing ownership/test boundaries independently. The ownership/boundary reviewer found no concrete bug and directly ran **68 clock + 48 connection + six boundary tests** successfully. Its residual note was that the first-case-lifetime test actually checked repeated cohort timing reads without creating or retiring a case. That test is now named for its actual coverage; full case/index lifecycle integration remains explicitly unverified in B4/B5/B6.

The clock/timer reviewer found one **P3**: after an early callback cleared its timer, `schedule()` reset `cleared` before replacement `setTimeout` succeeded. If replacement scheduling threw, cancellation still held the old handle and cleared it twice, violating one-attempt cancellation and potentially misreporting uncertainty. A new memory regression failed before correction (`clears.length` was two, expected one). Moving the clear-state reset immediately after successful replacement-handle assignment fixes it; the test also verifies one failure callback, permanent stop, no false cancellation uncertainty and inert stale callbacks. No duration, generation, scope, signal or approval rule changed.

The clock reviewer rechecked the correction and directly reran **69 clock + six boundary tests**, reporting no remaining concrete findings. The implementing session's final thirteen-file main-thread memory/source regressions pass **754 tests**, zero failures/skips; the earlier 68/753 counts above describe the initial implementation, not this corrected total. Syntax, changed-document links/anchors and whitespace are verified. Actual scheduler/OS behavior, power-loss continuity and case lifecycle consumers are not qualified by these tests.

Protected runtime/native/build/package/config content hashes (2568 files), all 436 old artifact hashes/sizes/modes and Dot's PAUSED/full-configuration hash match review start. All public and prerequisite seals, judgment/notification/mail/retention conditions and operational limits remain unchanged. Only the runtime helper, three test files and three design/backlog documents are included in the user-requested local commit. Real clocks/timers, build, operational child/worker launch, native read, fixture/signature/real-data operations, MCP registration, production activation, Dot restart and push remain unperformed.

## 4-B3-C Second Independent Review And Corrections

2026-10-29 JST, review of committed `930267a`. Two read-only reviewers split the work: one took clock/timer/tool lifetime, the other timing ownership, tests and documents. Every finding below was reproduced in an addon-free `git archive` copy before correction. None concerned the clock/timer core: deadlines never moved, cancellation stayed one attempt, and no promise stayed unsettled across 8000 randomized event orders.

**P2, carried from `712112c`.** The connection-boundary assertion contained the literal text `"child = spawn("`. The repository-wide scan for bare-command spawns read it as a spawn call, so the whole unit suite failed on every CI platform. The assertion now uses an equivalent regex search.

**P3 corrections:**

- **Primary cause at timer arm.** A scheduling failure cancelled before it stopped, so an unknown clear could record `cc4b3c_timer_cancel_unknown` instead of the actual `cc4b3c_timer_unreferenced`. Stop now precedes cancellation, as tool failure already did. The transport's own unreferenced-handle refusal follows the same order.
- **Spawn-start cause.** The start recheck's catch discarded the actual refusal and recorded `cc4b3b_tool_start`. It now stops with its own cause (entry deadline or sub-ms reservation) before the stage failure, as chunk and close checks already did.
- **Expiry label.** Every timer expiry rejected as `cc4b3b_tool_deadline`, including:
  - monotonic rollback;
  - a clock read failure;
  - a lost reference;
  - an unknown early clear;
  - an earlier stop.

  The timer now passes its recorded reason. Only a timer or entry deadline rejects as `cc4b3b_tool_deadline`. Any other stop rejects as `cc4b3b_tool_timer_stop` and keeps its cause in `s.stopped` and the timer disposition.
- **Wall slack.** The possible-adjustment boundary was 1 ns more lenient than the reviewed 4-B3-A stamp model on both sides. It now uses the same 999999-ns slack.
- **Late synchronous returns.** The [timer rule](#fixed-internal-operations) requires a clock check immediately after synchronous OS calls, but the private connections did not do this. They carried on after `lstat`, `fstat`, `open`, `mkdir`, `opendir`, `read`, `write`, `fsync`, `fchmod` and `realpath` returns; for example, the record `lstat` led straight into `write` and `fsync`. A private `afterSync` check now follows every such return:
  - `mkdir`/`open`/`opendir` first record the new resource, so it stays retained or closed.
  - Record write/readback first counts its bytes, so the record keeps actual I/O.
  - `close` and umask restoration remain the cleanup lane.
  - Some checks are redundant with the next step's own check. The rule is uniform so that a later edit cannot open a gap.
- **Late flag.** Whether a post-deadline close was `late` depended on whether its expiry callback had already run. A close before stop now runs its completion check first and records `late` when that check fails. A close after stop still reads no clock.

**Test, guard and document gaps:**

- The checkpoint entry deadline and the builder's returned timing had no test.
- The static clock guard missed:
  - an implicit `new Date()`;
  - legacy `process.hrtime()` and `process.uptime()`;
  - destructured or aliased `Date`/`process` readers;
  - `globalThis` element access;
  - a policy-supplied origin.
- The 4-B3-B memory VM used its realm's real `Date`.
- The main-thread `Date`/`hrtime` replacements hid the earlier `Date.now`/`hrtime.bigint` recorders.
- Several ownership checks were masked by another check in every test.
- BACKLOG claimed a cohort-level index check that no code performs.
- The completion row read as if the clock were sampled after stop.

### Corrections And Validation

**New memory regressions.** Each of these fails on the reviewed runtime and passes after correction:

- stop order at arm time and in the transport;
- the spawn-start cause;
- five non-deadline expiry causes;
- both exact wall-slack edges;
- close/expiry order;
- three late-return sweeps.

The sweeps place the deadline right after each OS return in turn and require that only close or umask-restore cleanup runs before the next check refuses. They cover:

- build/record/namespace allocation;
- discovery and snapshots, including an empty input;
- artifact snapshots with permission repair.

A lexical boundary test also requires every non-cleanup synchronous return in the private root to be followed by a checkpoint before the next return.

Further tests cover:

- the checkpoint deadline;
- the builder returning the same frozen binding and exactly one post-namespace point;
- each ownership check in isolation;
- callback reference loss and unknown early clear;
- tool failures staying primary over unknown cancellation;
- an entry-capped tool timer.

**Static guard.**

- `Date` is allowed only as the clock's `Date.now()` or one-argument label formatting.
- `process` is allowed only through fixed fields; `hrtime` only as the clock's `hrtime.bigint()`.
- `policy` is allowed only as the clock's `total_limit_ms`.
- The guard refuses `globalThis`, `global`, `performance`, `Intl`, `Temporal`, `AbortSignal` and `Atomics`, and string-keyed access to clock or timer names.

The old guard let 11 of the 13 new variants through.

**Tripwires.**

- The replacement `Date` and `hrtime` carry their own recording `now`/`bigint`.
- `process.uptime/cpuUsage/resourceUsage`, `performance.now` and, where present, `Temporal.Now` are recorded.
- The 4-B3-B VM gets a recording `Date`.
- A boundary test checks that both memory suites install every tripwire before their first helper import.

**Bounded waits.** Tool waits now use bounded microtask turns instead of awaiting a promise that a defect could leave pending. Two earlier mutants hung the suite this way.

**Documents.**

- The 4-B3-C deliverable now reads cohort-owner checks on the timing input; the index consumer itself remains 4-B5 work.
- BACKLOG wording is corrected.
- The completion row now separates a check before stop from facts recorded after stop.
- The earlier [validation statement](#validation-and-remaining-work) that real clock/timer calls were denied by tripwires overstated the coverage this section adds.

**Test counts.**

| Suite | Tests | Was |
|---|---|---|
| Clock | 91 | 69 |
| Connection | 53 | 48 |
| Boundary | 9 | 6 |

The nine related qualification/assembly/controller suites (504 tests) pass three times, under linux and win32 platform spoofs and with CRLF copies of the changed files. The three changed suites also pass on Node 20.19.6, 24.18.0 and 26.12.1.

**Mutation.** The mutation sweep kills 44 of 54 runtime mutants, including both mutants that previously hung. The 10 survivors are equivalent:

- dropping the backward-wall term, because nondecreasing monotonic brackets already imply it;
- a close after stop rechecking, because the stopped state refuses before reading the clock;
- eight late-return checks whose next step checks the clock first.

**Scope.** Only the runtime helper, three test files, this design and BACKLOG change. No real clock/timer, build, child/worker, native read, fixture, signature, real-data operation, MCP registration, production activation, Dot restart or push is performed.
