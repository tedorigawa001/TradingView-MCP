# C-C Native Joint Read Acceptance

Status: **Detailed design proposal only; implementation and execution require separate approval**, 2026-10-28 JST. Baseline: `05e6fce`, including the C-B independent-review corrections. This refines the [joint connection design](NATIVE_BAR_ADMISSION_NATIVE_JOINT_DESIGN.md) and preserves the [B-2c host qualification gaps](NATIVE_BAR_ADMISSION_FIXTURE_READ_DESIGN.md#b-2c-constrained-acceptance-tests).

C-C compares the disconnected joint reader with real synthetic-only native calls and independently prepared expectations. Its useful positive scope under the current budgets is a minimal signed enrollment witness, not a complete producer publication. A successful fixture test cannot enable MCP, Dot, history acceptance, execution or production. Dot stays PAUSED. Market/scenario/notification/mail rules, all resource ceilings and plan formulas, strictly-more-than-90-elapsed-day eligibility and elapsed-time-unknown holds remain unchanged.

## Approval Boundaries

| Stage | Proposed implementation and execution scope | Still prohibited |
|---|---|---|
| C-C0 | Test-run manifest, explicit gate selection, build/fixture ownership contracts, report schema, source guards and memory-only refusal tests | Native compilation/load/read, fixture creation, signature preparation/persistence and real-data operations |
| C-C1 | Separately approved isolated native builds, independent observer, newly invented unsigned fixtures, actual negative reads and owned-fixture teardown; existing fixed public-vector checkpoint signing stays in memory | Signed record files, native positive joint qualification, existing fixtures/stores and host-policy changes |
| C-C2 | Separately approved test-only signing of one invented enrollment envelope, saving it only in a fresh private fixture, real minimal positive joint read and explicit owned-fixture teardown | Private-key files, arbitrary signing, full publication qualification, production keys/services and existing data |
| C-C3 | Separately approved controlled faults/changes in newly owned fixtures, test-process interposition around real native calls, cancellation/contention/release acceptance | OS clock/mount/ownership/resource-limit changes, kernel-failure claims, production or real-data mutation |

Approval of a design or earlier stage does not approve a later stage. A command-line flag or persisted manifest is not user consent. No default test command, npm lifecycle, CI workflow, startup/MCP import or automation may run C-C native cases. The current step writes documentation only and runs none of these stages.

C-C0 describes requirements and refusal dispositions only: it exports no executable native entry, creates no permission token and cannot mark unobserved environment/ownership facts ready or qualified. Its parsed plans never become a C-B enrollment, native handle or fixture-cleanup authority.

C-C0's memory tests live under `test/unit`, so they run in every CI job: ubuntu with Node 22 and 24, macOS and Windows with Node 24. They must not assume darwin, a present addon, an existing anchor or a writable `/private/tmp`. They install the same main-thread loader tripwire as the C-B tests (`05e6fce`), so a regression fails instead of loading an addon that a common `build/` may contain.

C-C1/C-C2 approval must explicitly include setup **and teardown** of only that run's new fixtures. C-C2 must separately include signed-record persistence; prior B-1/B3-B memory signing approval is insufficient. C-C3 must identify the permitted fault types and fixture mutations. Runtime/native changes discovered necessary by acceptance are a separate correction request, not permission to change limits or contracts until a test passes.

## Isolated Build And Runner

Proposed artifacts, not existing commands or MCP tools:

- A dedicated opt-in runner, for example `native/native_bar_fs/test_joint_admission.mjs`, with no native execution when no approved stage is selected.
- Dedicated JS/addon/observer outputs under ignored `build/b3cc-validation/normal/` and `build/b3cc-validation/ubsan/`. Never overwrite top-level `build/`, its normal addon, or the B-1/B-2/B3 validation directories used by other work.
- A test-only fixture/signing helper under `test/helpers/`, a native acceptance suite under `test/native/` and memory-only runner/boundary tests under `test/unit/`. Runtime modules must never import test signers or fixture writers.

All JS modules, the native addon and the fixed memory oracle must resolve to the **same** isolated mode directory. Current helpers select B3-B validation output; C-C will need a test-only selector or fixed helper packaging that cannot accidentally enroll a grant in a different module instance. Do not add a production backend/provider/path option to solve test routing.

The existing native build script writes either the common addon or `build/b2b-validation/`; calling it unchanged is not a C-C isolation plan. A dedicated test-only build wrapper must reuse its reviewed flags and source without adding a runtime loader or writing to either existing destination. Keep `NATIVE_BAR_SYNTHETIC_ONLY=1`, protocol 6, local Node-API headers, compiler hardening and separate normal/UBSan outputs. Missing compiler/headers/sanitizer runtime blocks the stage; no downloads or installation. No native source change is proposed.

Before any native stage, freeze the source commit and reviewed patch digest, actual Node/ABI/architecture/compiler/OS versions, build mode and addon/source hashes. Refuse an unreviewed source delta or unexpected binary/profile. macOS local ownership-enforced APFS with extended security and exact name semantics is required for native qualification. Linux/Windows and unsupported volumes keep memory/refusal results only; a skipped native case is not a native pass. A second per-user anchor is optional and separately approved; it must already exist at the native reader's exact canonical accepted path. Discovery must not create it or follow `/tmp`/other aliases.

## Fixture Ownership And Teardown

Every case uses an exclusively created `native-bar-fs-synthetic-<six characters>` directory immediately under an approved native anchor, initially `/private/tmp`. No fixture path is accepted from user data, a Page, a log or an existing directory listing. Keep parent/roots 0700, files 0600, current UID ownership, no inherited allow ACL, symlink or hard-link reuse. Refuse unsafe preconditions rather than repairing/chowning/chmodding an existing parent.

A negative variant may violate only its manifest-declared leaf property during approved new-fixture setup or C-C3 mutation. Any link target must itself be newly owned invented test material, never an existing file or store; teardown removes the owned link, not its target. Such a variant is not a relaxation of ordinary fixture preconditions.

The only fixture-root entries are the two existing markers, `store/` and `admission-witness/`. Extra harness receipts inside that root would invalidate the namespace. Keep a private, unsigned run receipt outside the fixture tree with run ID, exclusively owned basename/identity, marker digests and the bounded owned entry list. It contains no private key, raw signature or market/account data. Treat it as a cleanup aid, never as self-authenticating permission to remove a directory after a crash.

Record an independent setup inventory and expected bytes before the read. Normal cases assert unchanged file bytes and stable identity/ACL/flags after the run; fault cases compare against their declared mutations. No writer lock, repair, fsync of a real store or atime restoration is added. OS atime effects are not a promise of complete metadata immutability. Observe only the owned tree and necessary ancestor/volume metadata, never enumerate unrelated temp contents or real stores.

Finally, independently attempt original owner cancellation/settlement and native/query/bootstrap cleanup. Confirm original operation retirement and return of managed native FDs/root slots to their starting values before teardown. Global retained ID tombstones need not return to zero; they are deliberately retained. Global active workspace must be reconciled with other explicitly owned operations, not guessed from a partial close.

Teardown must use bounded no-follow, identity-bound removal of the originally owned directory, following the existing safe-deletion principles. A prefix match, prior `lstat` followed by unrestricted recursive deletion, `force`/glob cleanup or a caller-supplied path is insufficient. If no mechanism below is implemented and approved, leave the fixture and report the owned leftover rather than silently use `rmSync(...recursive...)`. Never call the product's purge/retention workflow to dispose of test artifacts. Test-fixture teardown does not alter the product's 90-day rule.

### Teardown Mechanism

Node's `fs` has no directory-descriptor-relative `openat`/`unlinkat`, so descriptor-anchored removal cannot be written in JavaScript alone. The existing B-2b native tests remove their fixtures with `rmSync(base, { recursive: true, force: true })`; C-C does not adopt that. The C-C1 approval must select one of these mechanisms, and C-C2/C-C3 reuse it:

1. **Receipt-bounded removal in Node (recommended for C-C1).**
   - Remove only the entries listed in the private run receipt, deepest first, with non-recursive `unlinkSync` and `rmdirSync`; neither follows a final symlink.
   - Immediately before each removal, `lstat` the entry and require its recorded device, inode, type, owner and mode.
   - An unexpected, missing or changed entry, or a directory that is not empty, stops teardown and reports an owned leftover.
   - Check the fixture directory's own identity last, before its `rmdirSync`.
   - A path-based race window remains between each check and its removal. It is accepted only because malicious same-UID code is outside the C-C threat model (see Reports And Completion); it is not claimed closed.
2. **Test-only descriptor-anchored helper.** A small C program, built like `admission_mmap_writer.cc` and never loaded by runtime code, opens the owned directory once and removes the recorded entries with `openat`/`fstatat`/`unlinkat` (`O_NOFOLLOW`, `AT_SYMLINK_NOFOLLOW`) and the same identity checks. Choose it if the path race must be closed. It is new test-only C code that needs its own review, not a change to the native reader.

Neither mechanism may list, reuse or remove pre-existing `native-bar-fs-synthetic-*` directories. As of 2026-10-28, earlier work left two under `/private/tmp` and three under the per-user temp directory. C-C never reads or removes them, and exclusive creation never reuses their names. The native reader does not list ancestor contents, so they do not affect a run.

If release or ownership cannot be confirmed, do not remove or repair the tree, attempt a replacement read, sweep older fixtures or infer recovery from GC/process exit. Report `release_unconfirmed`/an owned leftover and stop dependent cases. Later orphan cleanup needs its own verified scope and approval. General reports redact host paths; any cleanup locator stays in the private run receipt.

## Unsigned And Signed Preparation

### C-C1 Unsigned Negative Path

Create the existing markers/policy, one bounded invented unsigned witness file and only the additional unsigned entries declared by a case. The independent observer uses path `getattrlist`/ACL APIs, not the reader's FD facts. Existing `admission_fixture_expectations.cc` provides roots/ancestors/markers; any witness/entry extension must remain test-only and restricted to the originally owned fixture, with explicit role caps.

The fixed in-memory checkpoint oracle may sign C0 for sequence 1 and the invented enrollment hash using the already-approved public RFC test vector. **No signature is written to the fixture.** This permits real pair opening, inventory and witness capture, followed by `record_refused` on the unsigned witness. It exercises the corrected marker encoding (`raw_byte_limit: "0"`, not readable evidence), but does not reach V0, C1, V1, transcript completion or joint success. An unavailable/unsigned C0 instead must refuse before pair opening. Do not combine these different runs into one apparently successful chain.

A separate B-2 raw read/reverify comparison can check native bytes/counters within its own approved fixture/query, but cannot supply a snapshot or qualification to the C-B query.

### C-C2 Minimal Signed Positive Path

Use a fresh fixture, never turn an old C-C1 tree into signed evidence. The preparation order avoids circular pins:

```text
new private roots + known IDs/public-test-key fingerprint + markers/policy
 -> independent root/ancestor/marker observation
 -> invented E-A enrollment using those root proofs and a known pre-C0 timestamp
 -> logical record digest + outer canonical Ed25519 envelope in memory
 -> exclusively create admission-witness/1.json with those exact bytes
 -> independently recheck immutable bindings and freeze final registration/envelope
 -> attach fixed memory owner with sequence 1 and tip = logical enrollment hash
 -> create/enroll joint reader -> begin original query -> run -> release -> teardown
```

The markers contain fixture/store/epoch/policy identity, not the enrollment hash, so they need no post-signature rewrite. Root bindings use the existing immutable proof fields; directory-size headroom is accounted separately. Freeze and identify the test-only ancestry/capability digest preimages; they do not introduce a new host-qualified ancestry contract. The inner E-A model signature remains explicitly unqualified. The outer record uses only the existing signed-record format/domain and the public test vector; no new key/service or arbitrary signer input is introduced. Enforce the existing enrollment envelope cap of 8192 bytes as well as its native witness cap; prepare no producer/payload/receipt pair.

The already-public RFC vector constants may remain in reviewed test-only source. Keep instantiated private test KeyObjects and decoded seed buffers in helper memory; create no key file or new credential. Save only the explicitly approved synthetic outer record; C0/C1 signatures remain memory-only. Do not place run-generated signed fixtures, raw signatures or key artifacts in Git, a report, a journal or an upload. Persisting an envelope is not durability/power-loss or original-intake evidence.

Expected minimal result: two authenticated original requests, three generated query/challenge IDs, one record, sequence 1 and equal C0/C1 logical tip, captured byte count equal to the saved outer file size, original V0/V1 generation and confirmed cleanup. Assert:

```text
SHA-256(saved outer bytes) == native captured SHA-256 == B-1 encoded_sha256
logical record hash == enrollment pin == C0/C1 tip
```

Keep physical and logical hashes distinct. Only actually completed fixture signature/checkpoint/prefix/native-byte/snapshot/budget/timing checks may be true. Diagnostics remain entirely qualification-false. Even a successful result must keep view, authority/intake/admission/approval, history, execution/recovery, elapsed-clock, physical capacity and transaction replay false, with acknowledgement/as-of visibility `not_proven`.

## Fixed Work And Reachability

Choose each case's finite envelope and allowed lower limits from a documented case manifest and independent setup observation, before registration/C0. Include all common directory sizes, policy/marker framing, ordinary side entries and nonselected metadata, not just witness bytes. Missing headroom or unknown bounds block the case. Freeze the values and digest; do not refresh binding or enlarge the envelope after a failed read. A corrected manifest is a new explicit case, with the prior failure retained.

**Shared-anchor volatility.** Each native report counts the `st_size` of every ancestor directory (`ancestor-N`) in the common inventory bytes, and the reader checks every report against the frozen envelope.
- **Within a run, churn is harmless.** V0/V1 report the original snapshot's entries, and native snapshot comparison ignores ancestor size, link count, times and allocated bytes.
- **Before the run, it can bite.** The initial inventory after C0 is checked against an envelope sized from the earlier setup observation. On a shared anchor such as `/private/tmp`, unrelated processes can grow it in between, so the case refuses `work_envelope` after C0 has been consumed.

The manifest must therefore declare explicit ancestor-size headroom over the setup observation. A `work_envelope` refusal whose only excess is ancestor directory size is reported as BLOCKED (environment), with the observed sizes, not as a reader FAIL or PASS. It is not retried with a larger envelope in the same case.

Use the unchanged C-A planner and actual shared retained/workspace account. Preserve 512 entries, 1 GiB inventory, 16 MiB metadata, 256 MiB read work, 8 MiB response, eight roots, 512 managed FDs and 48-FD headroom. Six inventory passes, three captures plus V0/V1 native rehashes and all mandatory verification/ACL charges remain in the plan. Compare observed work with native limits and total model bounds; do not expect actual use to equal a conservative reservation.

The documented ACL range remains approximately three witnesses (or one witness with one mirror) at three ancestors, and two witnesses (or one pair) at seven ancestors, for the stated minimal layout. A complete publication does not fit. Do not reduce ACL text/call accounting, skip V1, trim a prefix, split one required read into convenient queries or lift a ceiling to admit it. A case whose preflight refuses is a **planning refusal**, not evidence that its later signature/content/cleanup check ran. Full publication/mirror/content positive coverage remains blocked pending a separate resource-design decision.

## Acceptance Matrix

Each row expands into manifest-bound cases; counts are not promised before implementation. Codes below use `05e6fce` C-B semantics, not the earlier generic `invalid_input` or `publication_incomplete` expectations.

| ID / gate | Stimulus | Required observation |
|---|---|---|
| G0 / C-C0 | No approval stage, unknown stage/path/backend, copied/foreign grants, mixed output modes | Refuse before native loading/fixture setup; no automatic retry, upload or deployment |
| U0 / C-C1 | Real native begin; unavailable/invalid C0 | No pair/root opening after C0 refusal; false diagnostics, zero authenticated requests, original cleanup and baseline resources |
| U1 / C-C1 | Signed memory C0, valid markers, unsigned witness | Traverse real inventory/capture then `record_refused`; one authenticated request, no C1 or positive result |
| U2 / C-C1 | Missing/extra/gapped witness namespace within a fitting envelope | Exact complete-prefix refusal before record decoding; no convenient shorter prefix |
| U3 / C-C1 | Pending stage, coordination/reserve or maintenance metadata | Reachable cases return `publication_pending`, `coordination_active` or `transaction_mapping_pending`, at the layer the manifest predeclares; no unplanned evidence reads |
| U4 / C-C1 | Case/role alias, wrong type/size/ACL/pin in a newly owned fixture | Native/classification/binding refusal and cleanup; no fix-up or normalization of evidence |
| S0 / C-C2 | Minimal one-record signed enrollment | Real original C0/read/V0/C1/V1/transcript/release order and the narrow result assertions above; normal and UBSan reported separately |
| S1 / C-C2 | Planned exact and one-less limits for each budget dimension | Exact fitting case remains below all bounds; one-less model refusal precedes native begin/C0. No new numerical default or ceiling |
| F0 / C-C3 | Fixed bad/replayed/changed C1 from memory owner | `checkpoint_refused` or `changing`; no record append, replacement snapshot, re-signing or transparent retry |
| F1 / C-C3 | Hold C0 or hold C1 after real V0; cancel/release/owner loss/duplicate run | Both sides stop; original in-flight settlement required; no early lease reuse, false diagnostics, preserved primary failure |
| F2 / C-C3 | Approved owned-file mutation while C1 is held | Original same-snapshot V1 rejects changed bytes/identity; no successful result with signatures alone |
| F3 / C-C3 | Real elapsed expiry/event-loop stall; test-worker JS rollback/clock/RNG faults | Original deadline is exclusive, no renewal or success; label JS faults separately from native/OS clock qualification |
| F4 / C-C3 | Real managed root/FD contention from explicitly owned synthetic contexts | Original native admission refuses `native_busy` before C0; release those exact contexts, no OS limit or real-store change |
| F5 / C-C3 | Throw before a real native close, then restore/delegate cleanup | `release_unconfirmed` with retained claim until genuine close/settlement; no reads after release request, primary failure retained |
| F6 / C-C3 | Missing/old/wrong-mode addon through test-process negative interposition | Coded `native_unavailable`/refusal, no opening; do not rename/replace the common binary or fabricate a positive backend |
| B0 / applicable gate | Complete publication or another non-fitting workload | `budget`/`work_envelope` at its actual earliest gate; later behavioral row remains NOT RUN, not passed |

Each manifest case predeclares the layer expected to refuse and its code, because similar stimuli stop at different layers:
- Pending, coordination and reserve entries refuse while the initial inventory is processed, whatever the envelope.
- Maintenance metadata reaches `transaction_mapping_pending` only when the envelope declares a maintenance slot; otherwise `work_envelope` refuses first.
- A refusal by the native reader itself (for example an unqualified snapshot at verify) is coded `native_refused` or another native class.

A case that stops at a different layer than declared is a FAIL, not a pass with a different code.

Signed-record corruption, an unbound extra payload, mirror byte mismatch or missing publication can be added only when the corresponding signed stage and fitting envelope exist. Verify reachability first. With present limits, do not claim full producer/mirror/receipt or maintenance replay acceptance merely from a preflight refusal. Numerical 1/10/2 ordering at large prefix sizes stays a memory-contract test when the native envelope cannot admit it.

## Observation And Fault Boundaries

Independent expectations come from known setup bytes and path-based metadata/ACL observation, never a copy of the native report being checked. Compare JS classification/counters with the real native inventory, preserving the known zero/read-only fixture-marker representation. Normalize only the volatile OS-ancestor fields already excluded by native generation checks; do not relax identity, ctime, ACL or flags to make a race pass.

A test-only addon-export wrapper may log and delegate each original call/handle unchanged. It may inject an explicitly approved negative failure around a real call, but cannot return fabricated bytes, snapshots, timestamps, release acknowledgements or qualified reports. Install before the reader loads the isolated addon; restore in `finally` and keep all interposition in a disposable test process. Production signatures/options and native sources stay unchanged. If a safe phase injection point is absent, record the case as blocked rather than add a public callback or pretend source extraction is native execution.

The external trace records actual API begin/end order with host monotonic observations, owner dispatch/settlement, native counters and original test-process handle identities. Require native context reservation before C0, opening only after authenticated C0, all captures before V0, C1 after real V0, V1 on the original snapshot and no extra reads/reopen after V0. JS delegation traces prove API order, not the count of kernel reads inside each native call. The five-pass/six-inventory schedule remains a source/accounting contract, corroborated by real checks/counters, not a fabricated syscall trace.

For close faults, call them adapter/interposition failures before genuine native release, not kernel `close`/EINTR tests. For JS clock substitutions, do not claim native wall-clock rollback/freeze or synthesize a passing native timestamp relation. GC or worker exit is not affirmative release verification. Equal UTC samples need not be artificially forced into a native-positive run; actual monotonic/order evidence and the existing memory cases have distinct scopes.

## Reports And Completion

Keep an unsigned, private bounded report under a future run-specific `build/b3cc-validation/reports/` directory with safe owner/mode/no-link checks. Freeze source/build/manifest/registration/envelope digests, known observation times in JST plus monotonic order, host applicability, each case's reached phase, expected/actual code, allowed qualification set, managed-resource deltas, cleanup/leftover disposition and normal/UBSan result. General output uses opaque fixture labels, not private paths, raw records, signatures or keys. This is test evidence, not the monitor's review log or research journal.

Distinguish PASS (including the expected negative refusal), FAIL, BLOCKED/UNSUPPORTED and NOT RUN. A substitute-boundary result must state what stayed real and what was substituted. Only the subset whose prerequisites and exact assertions ran can be accepted. Preserve failed attempts and environmental limitations; no selective rerun until green without reporting the original failure, no envelope/time-window adjustment after observing an outcome, and no resource-success claim from an absent counter.

C-C's minimal milestone requires independently checked ownership/teardown, the unsigned native negative path, the signed singleton positive path under its separate approval, original cleanup/order/budget assertions and separate normal/UBSan evidence on the declared host. It does not require an impossible publication case to be mislabeled as passing. Any unresolved release/integrity issue blocks that milestone. Regression tests and independent review follow at the same immutable source revision, but broad filesystem/native suites require their own fixture/setup scope.

B-2c/B3-D still owe genuine OS clock/freeze, mount/remount/cross-device/ownership transitions, OS descriptor exhaustion, kernel close/EINTR and broader host qualification. No power-loss/durability, malicious-same-UID isolation, production key custody, durable authority/history, elapsed-age or E-D transaction mapping follows from C-C. `view_verified` cannot be raised merely because this matrix passes. Dot, trading/notification/mail/retention conditions and all production enablement remain separate and unchanged.

Recommended next implementation request: **C-C0 only**, the non-executing manifest/guard/report contracts and memory tests. This proposal authorizes no code change or test execution by itself.
