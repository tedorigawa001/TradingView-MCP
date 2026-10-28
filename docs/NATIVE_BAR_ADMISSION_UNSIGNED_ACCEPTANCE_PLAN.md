# C-C1 Unsigned Native Acceptance Plan

Status: **C-C1a and C-C1b-1 pure contracts implemented; C-C1b execution not approved or implemented**, 2026-10-28 JST. Original plan baseline: `35d29b9`, including the corrected C-C0 expectations. This specifies the C-C1 portion of the [joint acceptance design](NATIVE_BAR_ADMISSION_JOINT_ACCEPTANCE_DESIGN.md). Only supplied-data models, memory tests and source checks run; no native build/read, fixture creation, signing or filesystem teardown is performed.

The [C-C1b detailed design](NATIVE_BAR_ADMISSION_UNSIGNED_EXECUTION_DESIGN.md), designed from `1766c0a` and implemented as pure contracts on `ca164ad`, specifies the independent observer, live fixture lifecycle, original-baseline/GO handshake, worker supervision and bounded evidence/readback. C-C1b-1 adds only memory contracts/serialization/capacity models; inert adapters, isolated build and actual execution require separate approvals. C-C1a remains sealed and its cause/ownership/teardown checks are not replaced by protocol/evidence consistency.

## Execution Boundary

The proposed first C-C1 run is twelve fixed negative cases per build mode, sequentially under `/private/tmp`, with separate normal and UBSan evidence. At most 24 new fixtures are created, one live fixture and one case worker at a time. A case runs once per mode; a failed or blocked case is not silently retried. Prerequisite failures reduce the number actually run. These are harness bounds, not changes to native resource, trading or notification rules.

Approval for this scope would cover only:

- An isolated TypeScript/addon/independent-observer build and test-only runner, with no common build overwrite, service/MCP restart or automatic npm/CI hook.
- Exclusive creation of this run's new invented, unsigned fixture contents and private unsigned receipts/reports, and bounded teardown of only those fixtures by the selected mechanism below.
- Actual native context reservation, pair opening, inventory and permitted evidence capture as far as each declared negative case reaches. A logging-only test-process wrapper delegates the original addon calls unchanged.
- Existing public RFC 8032 test-vector checkpoint signing **in memory only**, for the cases requiring an authenticated C0. KeyObjects, decoded seed and checkpoint/signature bytes never go to disk, reports or IPC.
- Closing and settling this run's original handles/owner operations and checking managed-resource counters. No fault injection, concurrent readers or deliberate mid-read fixture mutation is included.

Still excluded: a signed witness/enrollment file, arbitrary signer/key/service, C-C2 positive joint acceptance, C-C3 faults, product write/move/prune/quarantine/recovery entry points, existing fixtures or stores, real market/account data, per-user temp anchor, host ACL/ownership/clock/mount/resource-limit changes, MCP registration and production enablement. Dot remains PAUSED; all trading/scenario/notification/mail and retention conditions stay unchanged.

## Implementation Units

1. **C-C1a: inert test harness and memory validation.** Add test-only runner/gates, fixed mode routing, fixture ownership/receipt/report contracts and refusal/teardown-decision tests. Executable connection code, if approved, remains inert until the explicit C-C1 run. No native build/load/read, fixture creation or signing occurs in this unit. C-C0 keeps its two exports and memory-only ledger; native observations cannot be imported into it.
2. **C-C1b: approved fixture/native execution.** After reviewing the harness, separately approve the isolated build, new unsigned fixtures, in-memory C0 signing and the selected cleanup mechanism. Run the twelve cases in each supported mode and retain every outcome. Approval of this document alone does not perform or authorize this unit.

These units are not permission tokens or automatic stage transitions. Missing approval, stage, mode or supported host fails closed before fixture setup or addon loading. Flags/manifests cannot substitute for the human execution decision.

Proposed files are `native/native_bar_fs/test_joint_admission.mjs`, narrowly scoped helpers under `test/helpers/`, a native suite under `test/native/`, and memory boundary tests under `test/unit/`. The existing addon/read implementation and application APIs are not changed to add a callback, backend, path or signer option. If execution discovers a runtime defect, stop the affected case and propose a separate correction.

## Build And Host Scope

- Build only into new `build/b3cc-validation/normal/` and `build/b3cc-validation/ubsan/`; the addon is under each mode's `native-bar-fs/native_bar_fs.node`, alongside that mode's compiled JS and observer executable. Receipts/reports use a new private `build/b3cc-validation/reports/<run-id>/`.
- Check each output ancestor without following links. New private directories and the observer executable are 0700; new data/JS/addon/receipt/report files are 0600. Existing common `build/` is not chmodded or removed. An already-existing mode output or run directory blocks the first run rather than being recursively cleared or overwritten. Subsequent build reuse/cleanup requires a separate bounded proposal.
- A dedicated test-only build wrapper reuses the current compiler/hardening flags, `NATIVE_BAR_SYNTHETIC_ONLY=1`, protocol 6 and local Node-API headers. Do not invoke the current native build script unchanged: its destinations are the common build or B-2b output. No downloads, dependency installation, signing service or mmap/fault helper is required.
- The runner freezes source commit and patch digest, Node/ABI/architecture, compiler/OS identity and each mode's JS/addon/observer hashes. All reader, registry and fixed memory-oracle imports must use the same mode/module instance. Existing oracle helpers currently select older validation/common output; implement reviewed test-only mode routing, never a production provider argument or permissive fallback.
- Native applicability is macOS local ownership-enforced, writable APFS with the reader's supported security/name semantics. Check only `/private/tmp` and necessary metadata; do not enumerate other temporary directories, discover/create a per-user anchor or follow `/tmp`. Unsupported host/volume or unavailable local tooling is BLOCKED/UNSUPPORTED, not a skipped native PASS.

Do not build or run the existing broad native test script: it creates extra fixtures, includes out-of-scope mutations and uses recursive cleanup. Isolated compilation is not MCP installation or production activation.

## Fresh Fixture Recipe

The live supervisor owns creation and the private receipt. It creates a new run directory first, then calls exclusive temporary-directory creation with the exact prefix `/private/tmp/native-bar-fs-synthetic-`. Keep the returned six-alphanumeric-character basename and its device/inode/type/UID/GID/birth identity in memory immediately. A collision, unsafe name or unsafe ACL blocks setup; never choose an old directory from a listing.

The baseline shape is:

```text
native-bar-fs-synthetic-XXXXXX/        0700, new directory
  .native-bar-fs-synthetic            0600: "synthetic-fixture-v1\n"
  .native-bar-admission-synthetic     0600: canonical existing fixture marker
  store/                             0700
    policy.json                      0600: canonical existing v6 profile
  admission-witness/                 0700
    1.json                           0600: {"invented":"C-C1 unsigned"}\n
```

Create each directory explicitly; open each file with exclusive creation and no-follow flags. No recursive mkdir of arbitrary supplied paths, file replacement, rename, append to an existing fixture or permissions repair is allowed. Set modes only on just-created owned objects and verify current UID, expected GID, file link count one, no flags and ACL `none`/`deny_only`. Reject allow ACLs, including inheritance. Do not clear ACLs to make the test pass.

The marker uses new, distinct fixture/store/epoch/authority/key/reference IDs and the unchanged policy hash; the public fingerprint is the existing RFC test key. The enrollment pin is a labeled invented hash, not a signed enrollment or original-intake claim. The fixed memory owner uses sequence 1 and that exact pin. Never write a signed record to `1.json` or a saved checkpoint to any file.

Only the case table may alter the setup, before registration. Use no producer/mirror/payload/receipt hierarchy. Additional names contain newly generated invented IDs. Bounds per fixture: at most 16 owned filesystem objects including the fixture directory, depth at most three below it, and at most 128 KiB total regular-file content. These small limits include markers/policy and are checked before creation. They do not replace native worst-case role/ACL accounting.

The fixture root always contains exactly the two markers, `store/` and `admission-witness/`. Supervisor receipts, traces and report files never live there. Existing `.DS_Store`, side files or other unexpected entries in an owned tree are not adopted or removed; stop and report the leftover.

### Independent Expectations And Frozen Work

Use known setup bytes plus an independent path-based `getattrlist`/ACL observer, not a copy of the reader's report. Extend the test observer only for the fixed owned paths and bounded file hashes/sizes required here, plus the ancestor/root directory sizes the current observer omits. Reads use no-follow opens and before/after identity checks, not an unchecked extension of its current marker `ifstream` to arbitrary witnesses. It remains test-only and read-only. No general arbitrary-path browser or fixture writer is added. Setup/teardown observer reads are reported separately from the joint reader's native evidence captures.

Record the actual setup inventory and ownership proofs separately from the input deliberately falsified by U4. Both remain fixed. Freeze complete registration and envelope digests before bootstrap/C0; later facts never replace the original input. Each case's envelope reserves the declared maximum witness count, not merely the actual count in a missing/gapped case. Charge policy/markers, all structural and ordinary entries, metadata and directory `st_size`, even when no evidence bytes will be read.

For the initial three-ancestor `/private/tmp` path, declare **65536 bytes of extra inventory headroom per ancestor**, 196608 bytes total, before reading native inventory. Actual setup sizes still have to be observed; missing sizes cannot be replaced by the headroom. Owned directory sizes are included separately from file-content bounds. Do not enlarge headroom after a refusal.

Use the unchanged C-A planner, shared-state accounting, full per-role caps and mandatory six-inventory/five-content/ACL schedule. Selected/decoded/interpretation reservations follow the existing formula even though these negative cases stop early. If any declared workload does not fit, report its planning refusal and mark the intended native case NOT_RUN; do not reduce a cap, skip a check or split one logical read. Full publication remains outside this run.

## Twelve Initial Cases

Codes below are C-B suffixes; reports preserve the full actual `b3cb_...` code and the declared layer. Every case uses a fresh baseline fixture except for the exact setup variation. C0 is sequence 1 throughout.

| Case / row | Setup or owner variation | Expected stopping layer / code | Required native observation |
|---|---|---|---|
| u0-unavailable / U0 | Fixed unsigned owner mode `unavailable` | checkpoint_c0 / `oracle_unavailable` | Real begin, no openPair/inventory/capture; zero authenticated requests |
| u0-unsigned / U0 | Fixed unsigned owner mode `unsigned` | checkpoint_c0 / `checkpoint_refused` | Real begin, no openPair/inventory/capture; zero authenticated requests |
| u1-unsigned / U1 | One unsigned `1.json`; normal fixed memory C0 owner | record / `record_refused` | One authenticated C0, real inventory and one witness capture with matching known size/hash |
| u2-missing / U2 | Create no witness file; reserve a one-witness envelope | prefix / `witness_prefix` | One authenticated C0, inventory; zero witness captures |
| u2-extra / U2 | Create unsigned `1.json` and `2.json`; reserve two witnesses | prefix / `witness_prefix` | One authenticated C0, complete inventory; zero captures, no truncated prefix |
| u2-gap / U2 | Create only unsigned `2.json`; reserve one witness | prefix / `witness_prefix` | One authenticated C0, inventory; zero witness captures |
| u3-pending / U3 | Add a small unsigned `store/.producer-<id>.tmp` | inventory / `publication_pending` | One authenticated C0, inventory; no witness or pending-file capture |
| u3-writer / U3 | Add small unsigned `store/.writer.lock` | inventory / `coordination_active` | One authenticated C0, inventory; no evidence capture or lock protocol operation |
| u3-reserve / U3 | Add empty `store/.quarantine-reserve-<id>.tmp` | inventory / `coordination_active` | One authenticated C0, inventory; no reserve consumption or evidence capture |
| u3-maintenance / U3 | Add unsigned `store/maintenance/<id>.json`; declare one maintenance slot and all its bytes/parents | interpretation / `transaction_mapping_pending` | One authenticated C0, inventory; stop before reading witness or maintenance evidence |
| u3-maintenance-bound / U3 | Same fresh setup; reserve entry/byte bounds but zero maintenance object slots | inventory / `work_envelope` | One authenticated C0, inventory; object-count excess (work-usage blockers exactly `maintenance_metadata`), no evidence capture |
| u4-expected-inode / U4 | Keep disk unchanged; set only the supplied data-root inode to a distinct unused bounded value; recompute the input registration digest | native / `native_refused` | One authenticated C0; real openPair fails against the original observed root with the wrapper-logged raw `admission_expected_binding`; registration delta only `bindings.data.inode`; no inventory/capture |

`work_envelope` covers every usage dimension and `native_refused` most openPair refusals, so these two codes alone do not prove their intended cause. An ancestor-size `work_envelope` or any other openPair refusal is not a PASS of these rows.

Both U0 modes request C0 once but never authenticate it or instantiate the private test key. Remaining cases require exactly one signed/authenticated C0. All twelve must have zero C1 requests, zero `verifyAdmissionInventory` calls, no transcript success and no successful joint result. Native inventory's internal repeated passes are not joint V0/V1. A complete response returned by the original call may be checked in memory; none is synthesized.

For U4, changing a marker hash would be rejected by JS registration before the intended native layer, so it is not this case. Choose an unused inode value that passes structural validation and differs from every observed proof. Preserve the untouched ownership receipt for cleanup; never use the deliberately false inode as the deletion proof. Signed `record_binding` and C-A `full_binding` are not expected from any C-C1 witness.

Aliases, wrong types, symlinks/hard links, allow-ACL injection, oversize leaves, standalone B-2 reverify comparisons, contention, clock/fault/close-error injection and other oracle modes are deferred. They are not additional implicit cases under this approval.

## Case Execution And Evidence

The supervisor creates/setup-checks one fixture and passes bounded declared data to one fresh disposable case worker for the selected mode. Original bootstrap/owner/query grants stay inside that worker; they are never serialized, reconstructed or sent over IPC. Freeze mode routing and code hashes before imports. No loader fallback to a common/older addon is allowed.

Within the worker, record baseline `info()` counters and shared state, create/enroll the original joint reader and owner, then begin/run once. A cache/export wrapper in this test process may log only the existing admission read exports and `info()`. It delegates exact original arguments, handles, bytes, return values and throws; it neither fabricates data nor injects negative faults. Restore it in `finally`.

Trace API begin/end ordering, supplied vs actual codes, C0 dispatch/authentication, raw native report hashes/counters and the bounded selected-byte hash/length. Do not claim kernel read-call counts from this API trace. For U0, native begin reserves two managed root slots without opening fixture FDs; openPair must never occur. For U1, verify both fixture markers have raw cap `"0"` and are not readable evidence, and compare the captured unsigned witness with the independent setup bytes. After any failure preserve the primary error, cancellation/settlement and cleanup outcomes separately.

Use actual wall/monotonic observations and the unchanged original deadline (default upper bound 600000 ms). No fake timestamps, sleeps to manufacture signature validity, clock overrides or deadline renewal are permitted. A supervisor watchdog may request cancellation and allow at most 60000 ms for original settlement after that window; this is not an extension of the reader TTL. A hung/lost worker stops the run with retained fixtures, not a successful release inferred from process exit. No automatic replacement worker/read or host process/service control is authorized.

## Ownership Receipt And Teardown

### Selected Proposal

Recommend **receipt-bounded non-recursive Node removal**, the first mechanism in the parent design, for this initial unsigned run. This choice needs explicit approval with C-C1b. It assumes no malicious same-UID code and no cooperative concurrent fixture writer. Other UIDs are excluded by the verified private modes/ACLs.

There is a path-based check/remove race, including intermediate components: `lstat` plus `unlink`/`rmdir` is not descriptor-anchored removal. Checking the parents narrows accidental misuse but does not close that race. If protection against same-UID path replacement is required, use the alternative test-only `openat`/`fstatat`/`unlinkat` C helper after its own implementation/review approval. Do not silently switch mechanisms or describe Node removal as FD-equivalent.

### Live Ownership Record

For every successful exclusive creation, immediately add the entry to a live supervisor-owned list. Do not create the next item until that identity is recorded. The companion unsigned private receipt records run/case/mode, supervisor/worker identity, the exclusively returned fixture name/base identity, exact relative paths and type, device/inode/UID/GID/mode/birth identity, regular-file link count/size/hash, initial ACL/flags and marker digests. Keep a bounded phase history (at most 64 records, 1 MiB per case) and no raw fixture/checkpoint bytes, signatures or keys.

The receipt is outside the fixture, exclusively created 0600 inside the new 0700 run directory; subsequent writes are only through the supervisor's original owned handle. It is an audit aid, not authorization after restart. Use bounded records and verify its identity on readback; a partial/corrupt record or failed receipt write stops further setup. No scan, import or automatic resumption of old receipts/fixtures is provided.

### Cleanup Preconditions

Before teardown, close the original query/snapshot/context, owner and bootstrap as applicable; independently attempt the remaining closes if one fails. Observe original operation retirement, confirmed query release, active workspace returned to baseline and native managed FDs/root slots returned to baseline. Keep primary and cleanup failures separate. ID tombstones can remain and are not a leak. GC, worker exit, an absent handle in a report or zero counters without original settlement is insufficient.

If the supervisor stops setup itself before any query/native context could exist, and every recorded creation's ownership remains fully verified, it may roll back only those recorded creations. A refused creation proof or a failed creation receipt write is not such a stop: the object stays owned and the whole tree is held. Otherwise an unknown handle/worker/ownership state means **leave the tree, stop dependent cases and report**. Do not kill a process and use its exit as deletion permission.

### Non Recursive Removal Sequence

1. Revalidate the known `/private/tmp` chain, fixture directory and all still-present owned parent directories with no-follow metadata. Check exact basename, original identity, owner/mode/ACL/flags and absence of links or mount crossing. Root names are never taken from a report supplied by another process or from a prefix scan.
2. Before deleting anything, compare a bounded inventory of only the owned tree against the supervisor's exact list. Unexpected, missing, aliased, changed, linked, unreadable or unsafe entries stop cleanup without adopting them. Read/hash only declared small regular files using no-follow opens with before/after identity checks; compare known bytes through their saved hashes. The independent observer rechecks ACL/flags; failures do not trigger repair.
3. Derive a fixed deepest-first deletion list from the live creation record, not from enumerated candidate names. No recursive `rm`, `force`, glob, directory rename/move or product retention/quarantine API is used.
4. Immediately before each `unlinkSync`, check every remaining parent identity and the file's recorded device/inode/type/owner/mode/link count/size. Remove only that exact regular-file path. Initial and final file hashes/ACL/flags are checked before this sequence; the remaining Node check/remove race is explicitly accepted only under the stated threat model.
5. After each unlink, append the result to the receipt. On any exception, absent entry, changed proof or failed receipt update, stop; do not continue clearing siblings or treat ENOENT as success.
6. Revalidate each owned directory before non-recursive `rmdirSync` and require it to be empty. Its device/inode/type/owner/mode/birth/ACL/flags must remain original; size, link count and timestamps may change only as expected from the already recorded child removals. Do not compare those mutable fields to their pre-removal values as if unchanged.
7. Remove `store/` and `admission-witness/`, then the fixture directory itself last. Verify its absence only at the original owned location; never search for a moved replacement. Keep receipts and bounded reports in the private run directory for review; do not sweep them or older fixtures as part of teardown.

On partial teardown, record exactly which entries were removed and which remain; no new query or retry is allowed. A later cleanup request needs a fresh bounded review and approval. After supervisor loss, even an apparently complete receipt cannot self-authorize removal. This test-artifact lifecycle does not change strictly-more-than-90-day eligibility or unknown-elapsed-time holds for product data.

## Report And Acceptance

Use a separate native acceptance report, not the C-C0 memory ledger or monitor/research journal. General output uses opaque case labels. Keep any cleanup locator only in the private receipt. Reports include reviewed source/build/manifest/registration/envelope hashes, mode/host applicability, start/end JST and monotonic order, declared/reached layer, expected/full actual code, authenticated/dispatched request counts, API trace digest, independent/native byte-size/hash comparison, resource baseline/end and original settlement/teardown disposition. All report files are unsigned and never contain saved checkpoint/signature bytes.

Bound each case report to 256 KiB, its API trace to 128 bounded summary events and the run index to 128 KiB. Raw native responses are inspected in memory under the existing response limit, not dumped into these reports. Exceeding a report/trace bound is a reporting failure, never permission to silently discard a failed attempt or truncate required evidence into a PASS. Do not remove build outputs, receipts or reports automatically; their later lifecycle needs its own bounded scope.

Each planned case starts NOT_RUN. PASS requires its exact negative outcome, required reached-phase assertions and confirmed teardown; it never means joint success or trading authority. A code/layer mismatch, altered bytes, unexpected later call, leaked/unconfirmed resource or teardown mismatch is FAIL. Host/tool absence or proven ancestor-only size churn is BLOCKED/UNSUPPORTED; preserve the observed facts, do not retry with a larger envelope. Intended later behavior remains NOT_RUN when preflight refuses. A correct negative outcome with a cleanup failure is still not a passing case.

Cleanly settled FAIL/BLOCKED cases may be followed by the remaining predeclared cases, without rerunning the failed case; release/ownership/integrity uncertainty stops all dependent cases and the other mode. A run cannot be accepted by aggregating a C0 from one case with a capture from another. Keep the two modes' failures and limitations visible. C-C1 acceptance requires all twelve declared rows in both modes to reach their expected assertions and teardown; a partial result is only partial coverage.

The native reader's narrow raw byte/inventory facts are reported as such. The joint diagnostic remains qualification-false; C1/V0/V1/transcript and C-C2 minimal positive milestone stay NOT_RUN. No authority/intake/history/view/approval/execution/elapsed-age/capacity/transaction-replay qualification follows from these unsigned cases. No real OS rollback/freeze, mount transition, descriptor exhaustion, kernel close/EINTR or power-loss claim is made.

## C-C1a Implementation

The [pure contract module](../test/helpers/jointUnsignedAcceptanceContracts.mjs) describes the fixed 12 cases in both modes and binds the declaration, case table and bounds with canonical SHA-256. Its bounded unsigned recipes contain only invented marker/policy/witness/side metadata. They produce strings and expected hashes in memory, not directories/files, key objects or signed records. Case setup for U4 is only a declared input-inode delta; the ownership model never incorporates that false expectation.

`createUnsignedOwnershipModel` accepts a new fixture declaration, explicit `baseline_resources: { fds, roots, workspace }` and supplied proof records, not a saved receipt. The original baseline is detached and retained; every cleanup observation's before/after values must both match it. It checks exact creation paths/parents, private type/mode/owner/link/content proofs, empty new directories, no object aliases/device crossing, setup completion/abort and immutable snapshots. A failed creation receipt write keeps the object owned and stops setup. Every cleanup observation lists each remaining owned directory's children, which must equal the remaining owned children. It retains partial removals and stops permanently on controller/receipt/identity/resource/release uncertainty or a removal failure. Its next-entry decision is deepest-first and non-recursive; mutable directory size/link counts are not immutable deletion identity, because the model's own child creation/removal changes them. Completion still requires a supplied original-location absence check; a missing final confirmation latches a stop rather than permitting a later self-reported recovery. The confirmed absence is recorded once, and `summarizeTeardown()` exposes a compact, non-authoritative summary for the negative model. No model calls `unlink`, `rmdir`, an observer, a recovery service or a file importer.

`assessUnsignedNegativeModel` checks a bounded supplied phase projection, exact case layer/code, C0 counts, capture/marker assertions, the cause evidence of the two catch-all rows (work-usage blockers, raw addon throws, registration delta) and settlement. Teardown comes from the ownership model's summary for the same plan, recipe, case, mode and fixture name, with no stop, every entry removed and the absence confirmed. Any primary code the harness preserves is accepted as an observation, so an unexpected joint success is a recorded mismatch. Facts on unreachable phases are inconsistent, including a claimed capture in U0. A consistent description is only `consistent_supplied_negative`, never native PASS. Native status and all authority/ownership/qualification flags remain false/NOT_RUN. These declarations and receipts are self-reported, unauthenticated and memory-only; hostile in-process Proxy reflection is outside their boundary. They are not a live supervisor, a fresh OS observation, a resource lock or cleanup permission. Runtime enforcement of the 24-fixture/one-worker bounds remains C-C1b work.

The [inert harness](../test/helpers/jointUnsignedHarness.mjs) exports inspection and an execution entry that unconditionally throws `cc1a_execution_not_approved`. No flag, environment value, plan, receipt or caller token unlocks it. The [standalone entry](../native/native_bar_fs/test_joint_admission.mjs) can inspect only the strict C-C1a argument form; imports are inert, missing/default/native-stage arguments refuse, and no npm/startup/CI-native hook is added. No acceptance CLI invocation is needed for the memory tests.

The approved executable connection code is a private, uncalled function. It selects only the fixed normal/UBSan reader output, uses original owner/reader grants, preserves primary and cleanup errors and independently attempts original closes. It performs no fixture or build operation, has no exported alias/caller and does not claim resource settlement from close calls alone. Both existing test oracle helpers add a strict `NATIVE_BAR_B3CC_MODE` route; invalid values and conflicting legacy isolation flags refuse before their dynamic imports, while legacy routes remain unchanged. Fixed key material/signing logic is unchanged. The signing helper and native reader are not imported by C-C1a execution paths; the private connection itself was not run.

Validation on the current Node 24/macOS host after local review: **65 C-C1a tests; 132 total selected memory/source-boundary tests, all passing with no skips**, covering C-C0 regression and the existing reader/signer source boundaries. Main-thread native-load and filesystem mutation/open tripwires allow only module-source reads and finish with no forbidden effect. Mode routing is checked by evaluating only the helpers' three pure selector statements with supplied environment objects, never by importing the signer or fabricating a backend. A regression for unreachable positive capture/marker assertions failed before the comparison correction. Seven JavaScript syntax checks, `tsc --noEmit` and diff checks passed; no full unit/native/filesystem suite, signature test or cross-platform CI run is claimed. Constant truth tables/source guards are not isolation from malicious obfuscated code.

## C-C1a Local Review

2026-10-28 JST: reviewed the entire inert harness, supplied-data contract/receipt models, mode routing and documentation. Three areas were corrected without enabling the private connection:

- **Resource baseline binding.** Before/after cleanup samples could both be changed to the same non-original values and still compare equal. Model creation now requires and retains the explicit original baseline; each dimension's before/after samples must match it. Tests cover independent dimensions, detached nonzero baselines and refusal of a missing baseline. This remains a supplied baseline, not authenticated native accounting.
- **Final absence uncertainty.** After all modeled removals, `fixture_absent: false` returned a nonterminal uncertainty that a later observation could turn into completion. It now latches `hold/absence_unconfirmed`, like other ownership uncertainty. No recovery/reset or extra cleanup attempt is introduced.
- **Primary-code preservation and bounds.** The unwired connection's formatter replaced known B-2/C-A pre-begin refusals with a generic error and accepted arbitrarily long code-shaped messages. It now retains known B-2/B3/contract codes up to 96 characters and redacts other failures. Only this pure formatter expression was evaluated in tests; the native connection, key/oracle helpers and filesystem teardown were not run.

The two lifecycle regressions and two formatter regressions failed before their corrections. Nine new test cases in total verify the changes and related baseline contracts. After correction, all 132 selected tests, seven syntax checks, `tsc --noEmit`, document-reference and whitespace checks passed. No further actionable issue was found in this local review; it is not independent review, native acceptance, signed-oracle execution or cross-platform CI evidence. The existing runtime/native/common build and paused Dot configuration were compared with the review start and remained unchanged. The user authorized a local commit; no push or production integration is included. C-C1b's real supervisor/observer/setup/teardown and acceptance evidence remain separately required.

Still required before C-C1b execution: implement/review the exclusive build/setup and live ownership controller, independent observer, original-call instrumentation/counter checks, worker/watchdog supervision, bounded private receipt/report persistence and selected real teardown. C-C1a's local review is recorded above. The private connection must remain uncalled until explicit execution approval and reviewed integration. No `.node` was built/loaded, fixture/report/receipt file created, signature prepared or cleanup executed in C-C1a. Dot and market/judgment/notification/retention conditions remain unchanged. No commit, push or production deployment is included in that implementation step.

## C-C1a Independent Review And Corrections

2026-10-28 JST: two read-only reviewers independently traced all twelve rows through the C-B reader, C-A, B-2a, the oracle registry and the native source, and confirmed every declared layer, code, order, request count and recipe byte. Nothing unlocks execution. The corrections in `ca164ad` concern evidence quality and test strength:

- **Causes of catch-all codes (medium).** `work_envelope` covers every usage dimension, so ancestor-size churn past the headroom read as a consistent u3-maintenance-bound. `native_refused` covers most openPair refusals, so a marker/ACL/name refusal read as a consistent U4. The rows now pin work-usage blockers of exactly `maintenance_metadata`, and the raw `admission_expected_binding` with a registration delta of only `bindings.data.inode`.
- **Teardown binding (medium).** Settlement and teardown were bare supplied values, so a trace could be paired with another case's or a held fixture's teardown. The negative model now takes the fixture declaration and the ownership summary (described above).
- **Test strength (medium).** The consistency test copied the model's phase rules. Phases are now a literal per-case table, and each blocker and creation refusal has a single-change test asserting the exact code; rollback rejections are tested.
- **Lower findings.** Unexpected joint success and pre-begin codes were malformed input; new directories were not required to be empty and cleanup had no child listing (an unlisted `.DS_Store` reached `rmdir`); creation had no receipt-write outcome; the plan hash omitted modes, anchor and outputs; the unwired connection did not check envelope slots and its formatter redacted `b3cc_` codes. Guards missed global `crypto`/`Intl`/timers, element-access `constructor`, removal of the mode check, a base fallback, `eval`, and a later helper import bypassing the selected base. The runtime tripwire missed promise APIs and `copyFileSync`/`cpSync`/`utimesSync`, and refused module reads through a symlinked `node_modules`.

Each defect was reproduced on `1766c0a` with its original input shape or by a source mutation that the old guard accepted and the new guard refuses. Verification in a `git archive` copy on Node 24.18.0, without `--preserve-symlinks`: 122 C-C1a and 57 C-C0 tests passing in three runs and under linux/win32 platform spoofs, and the full unit suite at 3,105 of 3,107 (no failures; two pre-existing environment skips). This is still memory/source evidence only: no native build/read, fixture, signature, cleanup, independent observer or cross-platform CI run is included.

## Next Approval

C-C1a's local review is complete. Its implementation/review permission does not authorize native build/read, fixture creation, signing or cleanup execution. C-C1b integration and execution remain separate from this memory-only result.

A subsequent C-C1b approval must explicitly name the twelve cases, normal plus UBSan, `/private/tmp` only, up to 24 newly invented unsigned fixtures, in-memory public-vector C0 signing, the receipt-bounded non-recursive Node cleanup and its residual same-UID race assumption, and private unsigned receipts/reports. It does not include signed witness persistence, real data, existing artifact cleanup, MCP/production activation, Dot restart or changes to any judgment/notification rule.
