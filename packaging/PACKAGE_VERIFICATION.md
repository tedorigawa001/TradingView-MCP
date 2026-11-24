# 0.1.48 distribution candidate (preparation pending)

The approved JS allowlist is unchanged: the same 225 paths and SHA-256
`4ed01e849833b02fa949a844dca219af607cce8b58529c04b495060c15517c61`, now fixed
by `npm-js-0.1.48.json`. Since 0.1.47 no source file was added or removed;
only `src/server.ts`, `src/strategyExperiment.ts` and `src/tradingview.ts`
changed. `RELEASE_VERSION`, package.json, the two root version fields of
package-lock.json and both distribution version fields are 0.1.48. Dependency
data is not regenerated.

## New 64 MiB campaign

The user approved releasing 0.1.48 by the same procedure as 0.1.47, in a new
64 MiB campaign. The authoritative configuration is `scripts/package-approval.mjs`:

```
0 prior + 524,288 preparation + 51,380,224 B maximum + 2,097,152 release stages
+ 6,291,456 fixed margin + 6,815,744 unallocated = 67,108,864 (64 MiB)
```

* Preparation: `package-2026-11-24-reverify-0.1.48-prep01` (512 KiB, the same
  six slots as before, including the future approval-b.json slot).
* Execution B: `package-2026-11-24-reverify-0.1.48` (49 MiB, the same eight
  buckets as before).
* The 2 MiB release-stage reservation is held for the later npm login,
  preflight, publication and readback records. Preparation and B cannot use it.
* Neither margin is available for automatic use. No refunds after deletion.

The 0.1.47 records carry no reservation into the new campaign. They are bound
as history by SHA-256, and preparation and B check the chain:

* the ready 0.1.47 preparation status,
* the passed 0.1.47 B result that binds that status and its input manifest and
  produced the artifact (851,982 bytes, `625fbbae...`),
* the verify01 readback and its status: four confirmed verdicts, the
  release-stage total of 311,296 bytes, and a published version 0.1.47 whose
  tarball digest equals the B artifact.

This change permits the version/configuration update, synthetic tests and the
single 0.1.48 preparation with readback only. No B receipt, compiler emission,
npm pack, commit, publication, DOT or production operation is authorized here.

# 0.1.47 distribution candidate (history)

The approved JS allowlist is unchanged: the same 225 paths and SHA-256
`4ed01e849833b02fa949a844dca219af607cce8b58529c04b495060c15517c61`, now fixed
by `npm-js-0.1.47.json`. Since 0.1.46 no source file was added or removed;
only `src/server.ts` and `src/tradingview.ts` changed. `RELEASE_VERSION`,
package.json, the two root version fields of package-lock.json and both
distribution version fields are 0.1.47. Dependency data is not regenerated.

### Outcome

* Preparation `package-2026-11-21-reverify-0.1.47-prep01` was ready for
  review: 57 tests, 6 syntax files, inputs unchanged.
* With approval B (`56f351f5...`), B passed. The artifact is
  `verified-0.1.47.tgz`, 851,982 bytes, SHA-256 `625fbbae...`. B charged
  19,467,978 bytes, so the campaign reached 19,992,266 bytes through B.
* CI passed on the candidate `c698ba2` (run 44913069796, all five jobs). Tag
  `v0.1.47` points to that commit.
* `scripts/run-npm-release-0.1.47.mjs` published it. The registry accepted
  the second PUT, sent after a web one-time password, with HTTP 202
  `{"success":true}`. Its readback 30 seconds later still saw the
  pre-publication state, so pub01 recorded `accepted_readback_unconfirmed`.
* `scripts/run-npm-verify-0.1.47.mjs` (verify01) confirmed all four anonymous
  readbacks: the version document, the dist-tag, the tarball bytes and the
  install packument.
* The release stages used 311,296 of their 2,097,152 bytes.

### New 64 MiB campaign

The user approved releasing 0.1.47 by the same procedure as 0.1.46, in a new
64 MiB campaign. The authoritative configuration was `scripts/package-approval.mjs`
at `c698ba2`:

```
0 prior + 524,288 preparation + 51,380,224 B maximum + 2,097,152 release stages
+ 6,291,456 fixed margin + 6,815,744 unallocated = 67,108,864 (64 MiB)
```

* Preparation: `package-2026-11-21-reverify-0.1.47-prep01` (512 KiB, the same
  six slots as before, including the future approval-b.json slot).
* Execution B: `package-2026-11-21-reverify-0.1.47` (49 MiB, the same eight
  buckets as before).
* The 2 MiB release-stage reservation is held for the later npm login,
  preflight, publication and readback records. Preparation and B cannot use it.
* Neither margin is available for automatic use. No refunds after deletion.

The 0.1.46 campaign (84 MiB) closed at 50,957,298 cumulative bytes after its
publication readback. Its records carry no reservation into the new campaign.
They are bound as history by SHA-256, and preparation and B check the chain:

* the ready 0.1.46 preparation status,
* the passed 0.1.46 B result that binds that status and produced the
  published artifact (846,950 bytes, `241353c2…`),
* the verify02 readback and its status, which closed the campaign.

This change permits the version/configuration update, synthetic tests and the
single 0.1.47 preparation with readback only. No B receipt, compiler emission,
npm pack, commit, publication, DOT or production operation is authorized here.

# 0.1.46 distribution candidate (history)

The approved JS allowlist has 225 paths, fixed by `npm-js-0.1.46.json` and
SHA-256 `4ed01e849833b02fa949a844dca219af607cce8b58529c04b495060c15517c61`
(UTF-8 POSIX paths, lexical order, LF after every path). Package metadata,
README.md and LICENSE are the only three additional regular files.

The kernel, semantic verifier and stream core remain in the package for v3
compatibility. Four stage-A-only modules, the SMA measurement/adapter and all
validation copies are excluded. No production maintenance or stage B is enabled.

`scripts/package-verifier-core.mjs` implements pre-write content reservations,
a filesystem-write tripwire, single-member gzip with bounded inflation, strict
tar EOF/content validation and TypeScript/manifest checks.
`scripts/verify-package.mjs` implements the isolated workflow, including npm
no-write qualification, source snapshots, explicit compiler output, canaries in
the actual pack root, package graph/syntax checks, exact tarball readback,
unpacked v3 goldens and a missing-shared-dependency control.

The 64 MiB approval covers cumulative new work-file content, not RSS or filesystem
metadata. Six new-run buckets have 8 MiB each; normal logs have 960 KiB and the
final record has a pre-reserved 64 KiB (49 MiB maximum). Initially 15 MiB remained
unused. After the explicitly approved continuation below, the campaign instead
retains 9 MiB for the stopped run and 6 MiB unused. Neither margin is automatically used.
There are no refunds after deletion. The protected existing 765 bytes are unused.

### Stopped preparation run

Run `package-2026-11-18T05-17-30-705Z-ba852d20-3d59-49e4-b0a8-9d9957d16765`
stopped during the first snapshot write, before npm qualification, compilation
or packing. Node's captured writeFileSync still looked up the instrumented
fs.openSync; this falsely classified the quota writer as unmanaged. The original
final-record attempt hit the same defect. The run has not been retried.

The quota writer now calls captured open/write/close primitives only after the
reservation. A virtual-filesystem regression failed before the fix and passed
after it; the selected package verifier suite passed 13 tests. A further
in-memory quota regression now forbids consuming the final reservation twice,
including through a second writer sharing the same budget. The latest selected
run passed all 14 tests, with zero failures or skips. This does not
qualify the isolated build, real package or unpacked v3 run: those remain pending.

The original reservation record is preserved. A separate, read-back-verified
`report/stopped.json` records the stop and counter uncertainty. Original counters
were not persisted; conservatively retain the full source/report allowances
(9 MiB), rather than resetting or claiming exact reconstructed consumption.
Any next run needs an explicit decision accounting for this hold within the
existing 64 MiB approval; no extra allocation or automatic retry is implied.

The user subsequently approved one new run: retain that 9 MiB hold, cap new
writes/reservations at 49 MiB, and leave 6 MiB unused within the same 64 MiB.
The runner verifies the stopped record's SHA-256 before accepting this carry.

### Approved continuation: passed

Run `package-2026-11-18T05-28-09-196Z-b7db5ad2-0329-41ef-ae73-42f9ee93afd8`
passed. The original stopped run was preserved, not restarted. Verification still
uses version 0.1.45; the 0.1.46 target label does not change package metadata.

* The selected boundary/EOF/quota suite passed 14 tests with no failures/skips.
* The write tripwire refused a deliberate unreserved write before IO; this
  expected control is separate from the zero unexpected write attempts below.
* Pinned npm library qualification returned a real tarball with scripts, cache
  and automatic filesystem output disabled; no unexpected FS mutation was observed.
* Isolated TypeScript 6.0.3 compilation reported zero errors and emitted 231 JS files.
* The 225-file stage retained all three shared internal modules, had no missing
  relative dependencies across 580 edges, and excluded all eight in-root canaries.
* The actual archive contained exactly 225 JS and three metadata files. Single
  gzip member, CRC/ISIZE, bounded inflation, tar EOF/padding, exact paths and
  content hashes all passed. All 225 unpacked JS files passed Node syntax checks.
* All eleven v3 golden input/result hashes and work counts passed from the
  unpacked package. A separate unpacked copy missing StreamCore refused its import.
* Original src/test/docs/build hashes matched before/after. No application entry,
  real chart, model, production maintenance, DOT or backtest was executed.

Artifact: `artifact/verified-0.1.45.tgz`, **846,951 bytes**, SHA-256
`c3a0401c4fd5d86c82d0aece441b3df374db230478de3b8661094985973bee99`.
Final record: `report/result.json`, **3,488 bytes**, SHA-256
`c1e6ec3d8516553c569876c00a2d7cfa12b58a973916552571c99cbdc2e10f75`.
Both live under the continuation run's `.release-work/` directory. Independent
readback verified the archive, record, write-manifest hash and its 1,167 recorded
files. The manifest excludes its own write and the final record to avoid a
self-referential hash.

Known new file-content bytes: **19,182,811**. Cumulative new reservations:
**19,244,859** (the difference is the unused part of the pre-reserved 64 KiB
final-record allowance). Including the unchanged 9 MiB carry, the conservative
campaign reservation is **28,682,043 bytes**, below 64 MiB. The fixed 6 MiB
unused margin and protected 765 bytes remain untouched. This is content-byte
accounting, not RSS, physical disk allocation or a release/publication approval.

Version update, commit, publish, production operations and DOT remain out of scope.

### Review fixes (no new build or pack)

The preserved continuation result above describes the earlier verifier. It is
not a qualification run of the following fixes, and has not been rewritten.

* All tar numeric fields (mode, uid, gid, size, mtime, checksum and device fields)
  now validate raw bytes before ASCII conversion. Only supported ASCII octal,
  leading spaces and terminal NUL/spaces are accepted. High-bit/base-256 values,
  signs, non-octal digits and digits after a terminator are rejected. Regressions
  cover each field and valid zero/space/NUL boundaries.
* The approval is bound to the exact continuation ID above. An exclusive,
  non-recursive mkdir of that fixed run root is the atomic one-use claim;
  pre-existing, empty and interrupted roots all consume the approval. No new UUID,
  check-then-create race, automatic removal or fallback run is permitted. The
  historical run root already exists, so the runner refuses before any new
  output, compilation or pack. The 9 MiB hold, 49 MiB ceiling and 6 MiB unused
  margin are unchanged. A future run needs a separately reviewed new approval
  and cumulative capacity accounting; this code grants neither.
* The runner explicitly captures SHA-256 and byte counts for its own ESM source,
  the verifier core, the dedicated test suite and the fixed allowlist. Initial
  bytes are retained in the source snapshot; `verifier_inputs.before` and
  `verifier_inputs.after` bind the report to those versions. A missing/changed
  input fails qualification, and the pass event is emitted only after this check.
  CJS dependency hashes remain a separate record. The historical report lacks
  these new identity records and is not retroactively upgraded.
* Hash confirmation and pass-event saving have separate exception handling.
  If saving the event fails, the result is failed with phase
  `pass_event_recording` and the original save error; matching before/after hashes
  and `verifier_inputs_unchanged: true` are retained. A changed/missing input
  instead fails as `verifier_identity` and suppresses the pass event. The added
  regressions execute the runner's actual finalization body with memory-only IO
  and inspect its serialized final report: quota/save failure, successful saving,
  changed/missing input and an earlier failure. The two save-failure cases failed
  before the fix. No bootstrap, approval claim, compiler or pack is executed.

The added claim tests use an in-memory filesystem, including competing claims
with independent budgets and failure before the first content write. No approval
root or work output is created by these tests. The selected suite passed all
28 tests with zero failures/skips, and all three verifier/test JS files passed syntax
checks. In-memory removal probes confirmed detection of the raw-byte numeric,
atomic approval-claim and verifier-identity guards. Read-only verification also
accepted the preserved 228-file tarball under the stricter parser and matched
the report, stop record and all 1,167 write-manifest entries. No v3 qualification
or packaging workflow was rerun. Existing
STOPs, pending changes and the protected 765 bytes remain in force. No new
64 MiB reservation, build, pack, version update or release is authorized here.

### Reverification A: approved 84 MiB campaign, B pending

The user approved the 20 MiB addition, 512 KiB preparation reservation and A only.
The authoritative configuration is `scripts/package-approval.mjs`. Its equation is:

```
28,682,043 prior + 524,288 preparation + 51,380,224 execution maximum
+ 6,291,456 fixed margin + 1,202,373 unallocated = 88,080,384 (84 MiB)
```

The prior stop keeps its conservative 9 MiB; the successful old run retains its
19,244,859-byte reservation (including unused final-record capacity). Both old
records are SHA-256-bound. Prior plus preparation reservations are 29,206,331
bytes. Including a future full B run would give 80,586,555 bytes. Neither margin
nor the separate protected 765 bytes is available for automatic use.

* A ID: `package-2026-11-18-reverify-r02-prep01`.
* B ID: `package-2026-11-18-reverify-r02`.
* Both are under `.release-work/`, in separate exclusive, non-reusable roots.
* A may write only input-manifest.json (448 KiB), approval-a.json (8 KiB),
  test-results.json (16 KiB), readback.json (16 KiB) and status.json (16 KiB).
* The other 8 KiB is a reserved future approval-b.json slot. A cannot write it.
  It is not a second preparation run: writing that one receipt requires a later
  explicit B approval, stays within the existing 512 KiB reservation and must use
  exclusive creation without replacing any A record or code.

`scripts/prepare-package-reverify.mjs` runs synthetic tests and syntax checks,
freezes the input manifest, verifies readback and reports its status. It never
imports the execution runner, TypeScript compiler or npm pack implementation.
It checks the read-only B authorization loader refuses the missing B receipt.
Test subprocesses use memory-only filesystems for mutation/claim controls; no
real B claim, chart, application entry, compiler emission or pack is performed.
Work-file content is quota-counted before IO; repository code edits are separate
authorized changes and do not permit logs or generated output elsewhere.

The manifest uses compact rows `[relative_path, size, sha256_base64]`, grouped
by fixed roots; its own hash is SHA-256 hex. It includes all 231 source files,
configuration/package metadata, verifier and preparation code, both test suites,
v3 fixtures/helpers, workspace type sources and JSON, TypeScript JS, zod runtime
JS, the complete fixed npm tree and the Node executable. Workspace .bin shims
are excluded and are never invoked. Symlinks in selected trees, oversized files,
incomplete enumeration or a manifest over 448 KiB stop A without truncation.

B remains pending. Its separate receipt must bind the exact manifest bytes,
ready preparation status bytes, campaign hash and both IDs. Missing A/B records,
an A-only receipt, wrong hashes/budget/IDs, failed preparation or changed current
inputs prevent the B claim. B copies approved bytes, verifies loaded CJS inputs,
and rechecks the complete input set before passing, alongside the ESM identity
check. Existing output quotas, 225-file allowlist and v3 STOP flags are unchanged.
The standalone historical continuation configuration remains consumed and is
not an execution route for the new campaign.

Preparation results and the final input-manifest/status hashes are recorded in
the preparation root and accompanying chat after readback. This document is
frozen as an input before that capture; it does not claim a new build/pack/v3 run.
Version stays 0.1.45. Existing STOPs, pending changes and 765 bytes are retained.

### A evidence and tested-input binding fixes (no preparation rerun)

The existing prep01 directory and its five files remain historical, unchanged
records. Their status-v1 result is not upgraded by these source fixes. Its old
manifest is stale after the edits below; it cannot authorize a run of this
revision. The consumed preparation ID, its 512 KiB reservation and the pending B
ID remain unchanged. No new preparation, reservation or B receipt is created.

* B now reads approval-a.json and test-results.json as well as the B receipt,
  manifest and status. A status-v2 record binds the exact A and test-result bytes
  by SHA-256; the B receipt in turn binds that status. A must have phase A,
  decision approved, both configured IDs, the exact campaign hash and budget,
  and no B grant. Missing, changed, oversized or mismatched A evidence rejects B.
* Test-results-v2 binds the before/after input-manifest SHA-256 values, a matching
  flag and the test/syntax outcome. B requires both digests to equal its manifest
  hash, a passing summary, six syntax checks and consistent ready-status checks.
  Incomplete old status/test formats are rejected.
* Future preparation captures and saves its input candidate before starting any
  tests. It records the after-test digest even when tests fail, or an explicit
  missing digest/error if capture fails. It rejects drift after tests and again
  before readback, and binds A/test hashes into status-v2. Input or test failures
  never produce ready_for_review.

Regression coverage executes the actual preparation body with memory-only IO,
including drift just after tests, drift before readback, failed tests, missing
post-test input and the stable success path. Loader tests use virtual evidence
to check missing/tampered A and test records without touching actual B. The
initial nine regression cases failed before the corresponding fixes. Current
source verification results are reported in chat; no existing preparation result
or frozen manifest is rewritten to claim these newer tests passed there.

Re-establishing preparation evidence for this revision requires a separately
approved new preparation ID and cumulative accounting that preserves prep01.
Preparation rerun, B consumption, build, pack, version update, commit, publish
and DOT remain prohibited in this change.

### Expanded A2: 0.1.46, prep02, B still pending

The user approved folding the version update into A2 before prep02. The current
candidate version is 0.1.46 in package.json, the two root version fields of
package-lock.json and both distribution version fields. Dependency data is not
regenerated. The shared RELEASE_VERSION constant binds validation, the campaign,
the execution report and the future artifact name `verified-0.1.46.tgz`. Tests
reject old/next versions and mismatched package, lock or distribution metadata.
The 225 paths and their fixed path hash remain unchanged.

* New A2 preparation: `package-2026-11-18-reverify-r02-prep02`.
* Unconsumed execution B: `package-2026-11-18-reverify-r02`.
* Old prep01's five files remain byte-for-byte historical records. The old v1
  status is explicitly accounting-only; it cannot satisfy B's v2 evidence gate.
* Prior reservations now carry 29,206,331 bytes: 28,682,043 for the old runs plus
  the whole 524,288-byte prep01 reservation. Legacy successful-run checks retain
  their historical 28,682,043 total instead of comparing it to this enlarged carry.
* The new 512 KiB comes from the former 1,202,373-byte unallocated amount, leaving
  678,085 bytes. No old unused bytes are refunded or reused.

```
29,206,331 prior + 524,288 prep02 = 29,730,619 reserved before B
29,730,619 + 51,380,224 B maximum = 81,110,843
81,110,843 + 6,291,456 fixed margin + 678,085 unallocated = 88,080,384 (84 MiB)
```

The preparation limits remain 448 KiB inputs, 8 KiB A2 receipt, 8 KiB future B
receipt, and 16 KiB each for tests, readback and final status. A2 cannot write a B
receipt. It uses the corrected pre-test input freeze, before/after digest record,
A/test/status hash chain, and repeated verification of the historical records.
The preparation result and final hashes are recorded only under prep02 and in
chat after readback; this document is frozen before its capture.

This approval permits version/configuration changes, synthetic tests and a
single preparation/readback only. No compiler emission, npm pack, B consumption,
commit, publication, DOT or production operation is authorized. Existing STOPs,
pending changes, the old artifacts and protected 765 bytes are retained. The old
0.1.45 build/pack/v3 results above are historical evidence, not qualification of
the 0.1.46 candidate. B needs a separate review and explicit approval bound to
prep02's exact manifest/status/campaign hashes.
