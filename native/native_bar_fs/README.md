# Synthetic Native Filesystem Foundation

Phase 1 of the approved 105-3 maintenance design, 2026-10-23 JST. This is **not a production deletion backend**. There is no MCP registration, server import, production-root support, writer-lock integration, cleanup classifier, journal, recovery grant or retention decision here. The existing production-maintenance refusal stays in force.

## Explicit Local Verification

On macOS with local Node headers and the Apple C++ toolchain:

```sh
bdo npm run test:native-bar-fs:synthetic
bdo npm run test:native-bar-fs:synthetic -- --ubsan
```

The runner compiles TypeScript, explicitly builds the addon and runs `test/native/nativeBarFs.test.mjs`. UBSan stops on its first error; the runner rebuilds the normal synthetic binary afterward, including on a failed test. No network downloads, runtime compilation, startup hooks or automatic cleanup are added to the server. Ordinary `build`, `prepack` and `npm test` do not build this addon. The `.node` output under ignored `build/native-bar-fs/` is not in the package's publish allowlist.

Only the locally tested macOS arm64/local APFS combination is qualified for these synthetic tests. Other architectures, volumes, ignored-ownership mounts and missing APIs are not production-qualified. Unsupported backends fail closed; the optional loader returns unavailable without a pathname-based mutation fallback.

## Primitive Contract

- The C++ build requires `NATIVE_BAR_SYNTHETIC_ONLY`. Its native root gate accepts only `<resolved OS temp>/native-bar-fs-synthetic-<six alphanumeric characters>/store`, with an owner-private sibling marker containing exactly `synthetic-fixture-v1\n`. It walks components using no-follow directory descriptors, not `realpath` followed by pathname mutation. `realpath` is used only to select the temporary anchor.
- `openSyntheticNativeBarFs` retains opaque process-local root/ancestor references. Read-only open and inspect create no entries. Both steady-clock and wall-clock deadlines are issued once, at most ten minutes. Expiry detected by an operation, explicit close and finalization release descriptors only. There is no expiry timer or deleting finalizer. Returned target closures may retain their issuing JS session until all handles are released.
- `inspect(area, day, name)` accepts only `captures`/`receipts`, a structural `YYYY-MM-DD` component and a lowercase UUID `.json` basename. This is path grammar, not calendar, capture, receipt or cleanup eligibility validation. No arbitrary path, destination, staging glob or supplied inode is accepted. It pins the original file descriptor, rejects nonregular objects, unsafe mode/owner/ACL, unknown hard links and files above 1 MiB, then hashes bounded raw bytes and compares before/after metadata.
- Proof includes lossless decimal device/inode/size/owner/mode/link/time values and SHA-256. A different inode with identical bytes is not the same target. ACLs are read from opened objects, absent/deny-only accepted, grants/errors refused. Darwin's absent-ACL `ENOENT` is separately confirmed by successful `fstatx_np` and `filesec_query_property` on the same descriptor, not treated as blanket permission to ignore ACL failures. See [Apple's ACL retrieval implementation](https://github.com/apple-oss-distributions/Libc/blob/main/posix1e/acl_file.c).
- `stage()` allocates an exclusive private operation slot and performs `renameatx_np` with `RENAME_EXCL`, `RENAME_NOFOLLOW_ANY` and `RENAME_RESOLVE_BENEATH`. It verifies the moved entry against the pinned original, permitting only the ctime change caused by rename, and syncs the file/affected directories. There is no replacement rename or copy/delete fallback. Every generated slot remains within pinned root descriptors.
- `purge()` accepts only that session's successfully staged and freshly reverified holding object. It uses `unlinkat` on the pinned slot, syncs the slot, checks absence and checks that the original opened inode has no remaining links. The primitive does not establish age, human consent or permission to delete real data.
- `status()` is a cached in-memory outcome, not a new filesystem verification or restart journal. `moved` distinguishes pre-move refusal from a move already performed. `conflict` preserves unexpected entries; `durability_unknown` never claims a certain completed transaction. No automatic retry, restore, directory removal or adoption of existing holding bytes is implemented. Empty slots and conflicts remain for later explicitly approved recovery design.
- Limits: eight live root sessions, 32 live targets per session and 512 native descriptors process-wide. Operations are bounded and synchronous in the MCP process; no independent child worker can outlive its writer. This primitive is not yet wired to a writer lock.

The synthetic-only callbacks force substitutions/interruption at named boundaries. They must return synchronously with no value, cannot reenter/close an active session, and are not MCP parameters or production APIs.

## Evidence And Remaining Gates

The dedicated tests use fresh synthetic roots and sibling victim fixtures only. They cover native successful move/unlink, namespace substitution, identical-byte inode replacement, changed bytes, explicit/inherited ACL grants, hard links/FIFO/oversize, exclusive destination collision, expiry, interrupted outcomes, bounded handles, optional-backend absence, actual process kill and GC without deletion. The UBSan run exercises the same suite. These are actual filesystem operations, not TypeScript filesystem mocks.

Pre-commit review on 2026-10-23 JST corrected a test-only gap: numeric negative arguments to Node's `utimesSync` become the current time. The fixture now supplies a negative `Date` and first verifies an actual `-500000000ns` mtime. Four added tests cover deny-only/multi-entry ACLs, process-wide FD exhaustion/release, empty content and the exact 1 MiB bound. All 51 cases pass normally and under UBSan; Clang static analysis reports no diagnostics. No native source change was required by this review. This was a parent-agent review, not an independent assessment or production acceptance.

This is not the entire maintenance acceptance matrix. Still required before production: classification and reservations, exact approval plans, versioned durable intents/events, retention/quarantine clock validation, forged-intent recovery tests, cooperative writer-lock integration, syscall-failure/power-loss matrix, broader native memory review/sanitizers, packaging qualification and a separately approved MCP/deployment gate. No binary is shipped by this change.

The approved **strictly more than 90 elapsed days after verified abandoned quarantine** is recorded in the design, not implemented in these primitives. Committed-record retention, clock-ahead criteria, scenario judgments and notification conditions are unchanged. Dot stays paused.

Pinned directories prevent pathname substitution from redirecting operations to an external victim. They do not guarantee that a directory stays at its original path during a concurrent rename. `unlinkat` is not an inode-conditional atomic unlink; private slots are not isolation from a malicious same-UID process or administrator. No secure erasure, power-loss proof or production acceptance is claimed.
