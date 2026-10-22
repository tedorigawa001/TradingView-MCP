# Native Bar Safe Maintenance And Abandoned File Cleanup

Status: design and strictly-more-than-90-day abandoned-quarantine purge-candidate policy approved by the user, 2026-10-23 JST. Phase 1 implements native primitives and synthetic tests only; it does not register, deploy or enable them for production, or authorize real-data operations. The production maintenance refusal remains in force. No live market data is read, recorded, moved or deleted by this work.

## Decisions And Boundaries

Use a small in-process Node-API native backend for descriptor-relative filesystem operations. Keep scenario evaluation, consent plans, retention classification and history projection in TypeScript. Keep the existing native-bar writer serialization; do not replace it with a second, unrelated lock protocol. Maintenance never takes a chart lock or accesses TradingView/CDP.

Separate abandoned-file quarantine from irreversible purge. Neither a filename, an old mtime, a dead PID nor an intent file alone is deletion authority. Unknown files remain outside the cleanup allowlist. No startup, timer, quota handler or failed recording automatically runs cleanup.

| Decision | Approved design contract (integration not yet enabled) |
|---|---|
| Initial platform | macOS, qualified local APFS storage, with all required descriptor/ACL/exclusive-rename capabilities verified. Other platforms/filesystems refuse execution until their adapters pass the same tests. |
| Destination | Existing approved native-bar root only; preserve the exact default path allowlist. External volumes stay refused until a local, ownership-honoring mount is verified. No alternate temporary root, trash service or fallback directory. External path approval alone does not qualify its filesystem. |
| Committed retention | Prune eligibility remains strictly older than 90 elapsed days using observation/logical receipt age. No change to current eligibility or clock-ahead threshold. |
| Abandoned quarantine | Exact fresh approval, inactive producer/cooperative writer exclusion and validated object identity. Age is displayed, not a substitute for these checks. |
| Abandoned purge | Separate exact approval. Earliest candidate eligibility is strictly more than 90 elapsed days after a trustworthy quarantine timestamp, not an untrusted original mtime. User approved this design policy on 2026-10-23; it is not yet implemented or applied to any real file. Age alone never authorizes deletion. |
| Approval | Same-process, single-use plan/hash, explicit human approval through the host, and `confirm=true`. Both ten-minute wall-clock and monotonic expiry remain enforced. |
| Scope | Native-bar storage only. No recursive/general deletion, journal maintenance, chart changes, notifications, strategy changes, Dot integration or real-data testing. |

The separate quarantine period prevents a partially written file with no trustworthy creation clock from being treated as ancient. Quarantine does not reclaim its content bytes and is not a maximum-retention promise. Capacity exhaustion still stops work; it never triggers purge.

## Existing Implementation And Integration

`nativeBarHistory.ts` currently rejects production `maintain` before filesystem IO. Its pathname-based synthetic implementation must not become the production fallback. `nativeBarAccess.ts` publishes whole choosing/ticket/lock files and serializes cooperating writers, including dead-owner takeover. Owner files carry boot-session and process-start digests, so a reused PID no longer keeps a dead owner alive; earlier-build owner files keep PID-only liveness. `fsDurability.ts` single-file staging names are `.<stem>-<tag>-<pid>-<random>.stage`; recognizing that shape does not establish provenance or inactivity.

Introduce these narrowly scoped components after design agreement:

- `nativeBarMaintenance.ts`: bounded classification, exact plans, durable transaction state, status and recovery rules.
- `nativeBarFs.ts`: optional native-backend loader and opaque process-local sessions. Missing/incompatible backend yields an explicit unavailable result, not a server-wide startup failure or JS deletion fallback.
- `native/native_bar_fs/`: Node-API C/C++ implementation of validated root sessions, descriptor traversal, exclusive staging moves, verified reads/sync and bounded unlink from transaction holding directories.
- Dedicated synthetic tests with a second sibling directory representing an external victim. No production root or live OHLC fixture.

Node-API is the supported native-addon interface, but building native binaries adds toolchain and packaging requirements. ABI stability does not establish filesystem safety. The addon is a proposed dependency, not an already available component. [Node-API documentation](https://nodejs.org/api/n-api.html#node-api).

Prefer this in-process backend over an independent helper child: killing the MCP process then also ends native workers and closes their descriptors. A child surviving its parent could keep mutating while the existing PID-based writer lock is reclaimed. No root/setuid service, daemon, runtime download or runtime compilation is proposed.

Package only explicitly built/tested platform artifacts, with a backend protocol version and package integrity metadata. Keep unsupported systems able to use existing non-maintenance tools. Build/release changes and native-memory safety review belong to the implementation phase, not this design change.

## Threat Model And Honest Guarantees

Protect against path-prefix/symlink substitution, root or parent replacement between preview and execution, unexpected regular-file replacement, accidental side files, cooperative concurrent writers, interrupted publication, crashes, forged on-disk intents and replayed/expired plans. Refuse foreign ownership, unsafe modes, ACL grants, unverified volume properties, links and nonregular evidence.

The security target is the exact approved store/object identity, not an absolute pathname repeatedly resolved from scratch. A pinned directory may later be renamed; descriptor-relative operations must not follow the replacement pathname into a different victim directory. Detected namespace drift stops further operations and is reported. Do not promise that a pinned directory remains at its original pathname throughout a hostile concurrent rename.

A same-UID malicious process can modify this user's files, replace the addon or bypass advisory coordination. Ordinary 0700/0600 permissions and an in-process addon do not isolate against that actor or an administrator. Full protection against that stronger threat requires a separately owned storage service/OS privilege boundary and a different approval/design. It is not silently claimed here. Tests still exercise same-UID substitutions to verify that symlinks are not followed and unexpected objects are preserved.

`unlinkat` is not an atomic "unlink this inode if it still matches" API. A pre-unlink stat alone is insufficient. The design therefore uses fixed directory descriptors plus private, operation-specific holding slots and post-move identity checks. Ordinary `unlink` removes a directory entry; it is not secure erasure or a guarantee of reclaimed blocks, backups or open-descriptor contents. [Apple unlink documentation](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/unlink.2.html).

## Descriptor And Mutation Contract

1. A read-only preview opens the configured root by walking one component at a time from a trusted anchor, using no-follow, directory-only and close-on-exec opens. It creates no directory, lock, capability probe file or metadata. Missing root means no cleanup targets.
2. Bind the plan to root device/inode and store policy identity, parent directory identities, backend protocol/capabilities, coverage generation and exact targets. Encode device/inode/size/time counters losslessly as decimal strings. A content hash is not a substitute for object identity.
3. Retain an opaque root session in the issuing MCP process until plan consumption/expiry. Close it on expiry, cancellation or shutdown; finalizers only close descriptors, never mutate storage. At most the existing 128 live plans; bound open descriptors as well as plans. Parent descriptors need not remain open for all previewed targets.
4. After confirmation, take the existing native-bar writer lock. Recheck both clocks and root binding. Open each required parent relative to the pinned root, checking each component's actual object, owner, mode, descriptor ACL and filesystem identity. No absolute target paths, `..`, empty components, embedded separators, `AT_FDCWD`, shell commands or `/dev/fd` pathname emulation in mutation calls.
5. Read/hash bounded regular files through the opened descriptors, with no-follow/nonblocking opens and before/after descriptor metadata checks. Recompute receipt/payload bindings and eligibility; do not accept supplied timestamps or approval references as trusted evidence. Fail before any move if any target in the batch fails validation.
6. After a durable exact intent, move each entry into a newly allocated private holding slot on the same filesystem using a non-replacing descriptor-relative rename. Require the exclusive-rename capability. Reopen in that slot and compare the captured object identity, raw-byte hash, size, owner/type and approved bindings. A mismatched object is preserved, never unlinked. A race may already have moved that unexpected entry into holding: report the move/conflict explicitly, and never automatically restore over a new source entry or claim "nothing changed".
7. Only verified holding entries can be unlinked, and only when that exact plan authorizes irreversible purge. For quarantine-only approval, leave the verified bytes in their planned quarantine slot. Sync affected directories and state transitions before reporting their outcomes.
8. Join/finish native worker activity before releasing the writer lock, including timeout/cancellation paths. Transfer an original native-session monotonic deadline, not a fresh timeout after queue waits. Recheck expiry before each irreversible step; expiry mid-operation yields an explicit incomplete state requiring a new preview/approval.

Use macOS `openat`/`fstatat`/`unlinkat`, descriptor ACL reads and `renameatx_np` with exclusive destination semantics. Walk single components; `O_NOFOLLOW` on a final component alone is not a whole-path guarantee. The local SDK declares `renameatx_np`, `RENAME_EXCL`, `RENAME_NOFOLLOW_ANY`, `RENAME_RESOLVE_BENEATH` and `acl_get_fd_np`; declarations are not proof of runtime or volume support. Do not redefine missing flag numbers or silently drop unsupported flags. [Apple XNU API declarations](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/stdio.h).

Exclusive rename is a volume capability, not a universal property. Preview may read reported capabilities, but must not perform a test rename. Qualifying a filesystem uses only separately authorized synthetic scratch fixtures. An unsupported/ambiguous production operation refuses without a copy-and-delete, replacement rename or path-based fallback. Cross-device moves are refused. [Apple exclusive-renaming capability](https://developer.apple.com/documentation/foundation/urlresourcevalues/volumesupportsexclusiverenaming).

ACL checks in the mutation backend must inspect the opened object, not merely an earlier pathname listing. Keep the fail-closed absent/deny-only policy. Failure to read ACLs, ownership-disabled mounts or inability to verify required filesystem properties is an unavailable backend condition. Do not chmod/chown/repair permissions to pass validation.

Holding directories are not a new authorization boundary against a malicious same-UID process. Unexpected replacement inside holding also stops work. Do not infer an inode-conditional deletion guarantee that the OS does not provide.

## Artifact Classification

| Class | Necessary evidence | Proposed action |
|---|---|---|
| Valid committed receipt/payload pair | Canonical receipt, matching payload/context/policy, real clocks, exact IDs/hashes | Existing prune or clock-ahead workflow only; never abandoned cleanup. |
| Unreceipted native capture | Exact recording ID, bounded valid payload, no valid/corrupt receipt or maintenance reference under the writer lock | Abandoned quarantine candidate only; never fabricate a receipt, commit or first-seen time. Legacy origin needs the explicit review below. |
| Registered interrupted stage | Durable producer reservation, exact parent/name/object identity, producer inactivity and no committed/live reference | Quarantine the raw bytes without requiring valid JSON; separate later purge. |
| Completed publication's leftover hard link | Same inode as a committed artifact or active publication | Not an ordinary abandoned candidate. Preserve/report until a dedicated alias-recovery plan proves every relevant link. |
| Dead choosing/ticket/retired coordination | Strict bounded owner metadata; confirmed producer death; not the current transaction's lock/claim/ticket | Exact coordination cleanup candidate. Age and PID reuse are never permission to reclaim a live process. |
| Current writer lock, live/suspended producer or unknown liveness | Active owner, `EPERM`, malformed owner or unresolved PID reuse | Excluded. Do not rename/delete to obtain progress. |
| Maintenance intent, completion, policy or retention metadata | Transaction/coverage semantics | Not generic cleanup. Recover a known transaction separately; do not delete metadata merely because it is old. |
| Clock-ahead quarantine | Existing separately approved recovery evidence | Preserve. Abandoned cleanup cannot silently purge it. |
| `.DS_Store`, owner notes, unrelated JSON, unregistered unknown files | No recognized producer/operation relationship | Count/report, preserve. No wildcard or recursive cleanup. |
| Symlink, FIFO, socket, directory target, foreign file or unknown hard link | Unexpected object | Refuse in preflight. If substituted during a move, preserve the conflict holding entry; never follow, unlink or recursively inspect it as cleanup evidence. |

Candidate selection must cross-check all committed receipts, pending publications, live coordination and maintenance references. A canonical receipt with corrupt/missing content is an integrity failure, not proof that its payload is abandoned. Never route failed prune/recovery validation into a more permissive cleanup branch.

For new writes, propose a bounded immutable producer reservation before creating a stage: operation/recording ID, process incarnation, policy/root binding, exact area/name and intended artifact kind. After exclusive creation, publish a separate immutable created-entry binding the descriptor's identity before writing its contents; never overwrite the reservation to add fields. A crash in the create-to-register gap leaves an unverified entry, not an automatically eligible file. This reservation is operational provenance, never human consent or a prospective bar receipt.

The reservation integration changes the recording/publication path and therefore needs focused regression tests. It must not modify shared `fsDurability.ts` cleanup policy for unrelated stores. No raw OHLC, credentials or study metadata goes in the reservation.

### Legacy Files

Existing v1 leftovers lack the new producer reservation. Do not backfill trustworthy creation times, producer incarnation or ownership proofs from a stage name/mtime. Default preview labels them `legacy_unverified` and excludes them from the ordinary execution plan.

A separate explicit legacy-review mode may propose quarantine of individually selected, store-owned, regular unreceipted capture/stage entries. It must show that provenance/age is unverified, identify exact objects and hashes, acquire the same writer lock, exclude current/live producer files and all committed references, and obtain distinct human approval of that uncertainty. Unknown-owner coordination, corrupt receipts and arbitrary Finder/owner files remain excluded. If inactivity/reference safety cannot be established, preserve the file and require an offline recovery design; do not add a force-delete option.

Legacy review neither adopts the bytes as first-seen evidence nor makes them immediately purge-eligible. A later valid quarantine timestamp starts the proposed cleanup holding period. No bulk "accept all legacy files" mode.

## Plans And Proposed Interfaces

Names below are proposals only. No new MCP tool is registered by this design work.

| Interface | Side effects and authority |
|---|---|
| `prepare_native_bar_cleanup` | Read-only bounded inventory/classification. Select explicit kinds/IDs, not paths/globs or caller-provided cutoffs. Return eligible/excluded reasons, exact planned objects, sizes/hashes and uncertainty; distinct legacy-review mode. |
| `quarantine_native_bar_abandoned` | Consume a matching same-process quarantine-only plan after separate human approval. Move exact inactive uncommitted entries; no purge and no chart access. |
| `prepare_native_bar_cleanup_purge` | Read-only preview of exact, verified abandoned-quarantine entries strictly beyond the approved holding period. Exclude clock quarantine and unknown transaction states. |
| `purge_native_bar_abandoned` | Consume its own irreversible-purge plan and approval; only verified transaction holding/quarantine entries may be unlinked. |
| `get_native_bar_maintenance_status` | Read-only lookup by maintenance ID, distinct from recording status. Report per-target progress, conflicts and uncertain durability; never resume automatically. |
| Existing prune/recovery previews | Fresh recovery preview for their own incomplete transaction; no reuse of a cleanup grant or post-restart authorization. |

Every write tool uses `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`; every read/preview advertises read-only. Technical confirmation is not authenticated human approval. Plans must disclose destinations, moves versus irreversible unlinks, excluded files, actual bytes affected, logical versus physical deletion, retention/first-seen effects, quotas and the backend availability/blocker.

An execution request contains only plan ID/hash and `confirm=true`. Root, raw paths, inode numbers, raw OHLC, desired timestamps, arbitrary age overrides and replacement contents cannot be supplied by the caller. Selecting an ID from a preview does not expand its already validated scope.

Bind each plan to operation kind, exact targets/roles, root/parent identities, process-local capability, policy/protocol version, evidence/coverage generation and both deadlines. Any changed target or new reference invalidates the whole not-yet-started plan. The same target cannot appear twice or receive conflicting roles. A completed operation is looked up by its original ID, never repeated to obtain an acknowledgement.

Keep existing 1 GiB quota, 1 MiB artifact bound, 256 MiB evidence scan, 16 MiB maintenance metadata and 8 MiB response ceilings. Proposed cleanup batch cap: at most 1,024 files, additionally bounded by metadata, response and descriptor budgets; chunking needs new plans, never silently adds a next batch. Include all new reservations/events/completions in the byte and 30,000-entry inventory limits. Preview must budget the worst remaining transaction metadata plus recovery headroom before staging; the current fixed reserve is not a claim that arbitrary new journals will fit. If fewer entries fit, disclose the reduced exact batch. Oversized/unknown entries are excluded or stop the bounded scan with explicit coverage limits; they are not truncated into eligible evidence.

## Durable Layout And Transaction States

Proposed additional namespaces, all under the same approved root:

```text
operations/<operation-id>.reservation.json
operations/<operation-id>.created/<stage-id>.json
maintenance/<maintenance-id>.json
maintenance/<maintenance-id>.events/<step-number>.json
maintenance/<maintenance-id>.done.json
maintenance-hold/<maintenance-id>/<target-id>
quarantine/abandoned/<maintenance-id>/<target-id>
quarantine/abandoned/<maintenance-id>/timestamp.json
```

Names are generated identifiers, not encoded caller paths. Intents/reservations/events contain identities, roles, byte counts, hashes, clocks and outcomes, not copied OHLCV. Quarantine/holding retains the exact original bytes until an authorized purge. Metadata counts against quota; exhausted recovery reserve causes a refusal before staging, not automatic deletion of evidence or old metadata.

Quarantine completion includes a newly, exclusively created timestamp marker binding the operation, policy/root, exact target identities and hashes. Future purge must verify that marker and the actual surviving bytes/locations, not just an intent's old `quarantined_at`. Native marker/object metadata freshness can veto eligibility: for example, a recently created/replaced/changed marker or object is not eligible just because JSON claims an old date. Such metadata is not independent authenticated UTC proof and cannot by itself grant deletion. Missing/changed markers, clock inconsistency or an unverifiable original quarantine clock make the candidate ineligible; preserve it. A self-consistent forged/backdated intent test must include fresh actual marker/object metadata, not only a mismatched payload hash.

Use a versioned maintenance intent understood by new readers. Existing v1 intents are read-only inputs to a fresh validated recovery proposal, not rewritten in place. New-version intents must make older readers/writers fail closed before capture rather than silently misinterpret partial maintenance. Validate this compatibility against the prior build; update all running MCP instances before any future enablement. No automatic migration of `policy.json`, existing evidence, current lock protocol or journals.

| Durable state | Meaning and allowed next step |
|---|---|
| `planned` | Memory only; no persistence permission survives expiry/restart. |
| `intent_durable` | Exact roles/evidence bound; no history claims success yet. |
| `staging` | Some original entries may have moved into holding. Block affected history from partial success; preserve bytes. |
| `quarantined` | All exact moves/readbacks/syncs complete. Original pending IDs report `abandoned_quarantined`, not committed/pruned. |
| `purging` | Authorized irreversible unlinks underway, each with durable step evidence. Any uncertainty requires lookup and fresh recovery approval. |
| `complete` | Verified final locations/absence and durable completion record. Return the original operation result. |
| `conflict` / `durability_unknown` | Preserve unexpected objects; no blind restore, purge, intent repair or retry. Read-only diagnostic plus new user decision. |

An exact committed prune plan may stage and purge its already expired pairs in one approved invocation; it does not acquire the abandoned-quarantine holding period. Clock recovery stages/moves bytes to its clock quarantine and never unlinks them as content deletion. Abandoned quarantine and abandoned purge remain two separately approved operations.

For each entry, sync intent before move, then sync source/destination directories and post-move evidence before a completion event. For irreversible removal, first durably record `unlink_pending` with verified holding identity and authorization role; afterward verify absence and sync before `unlinked`. Crash with absence but no durable post-unlink acknowledgement is not reported as certain success from absence alone. Reconcile against the original intent, pre-step evidence and all valid locations, then report either verified recovery or `durability_unknown`.

After restart, no old plan/capability is live. Recovery must freshly inventory the root and source/holding/quarantine locations, validate actual identities/hashes/bindings, re-evaluate age/liveness and present a new plan. If a new receipt/reference exists, stop. Both a source and destination present, different content, missing proof, corrupt intent or duplicate identity requires a conflict, not "whichever file exists" recovery. Intent timestamps alone cannot make a fresh record expired. Ordinary missing files never authorize recreating evidence.

Interrupted v1 clock recovery can leave two hard links to the same inode. Handle this only through an explicit legacy-recovery plan validating both known locations, receipt/payload hashes, equal inode identity and the exact link set/count. Unknown additional links refuse recovery. Do not generalize this exception into hard-link cleanup of arbitrary entries.

## History And Status Effects

Abandoned bytes were never committed, so their quarantine/purge must not change retained first-seen, version occurrence numbers, accepted observations or the committed-history coverage floor. Recording status may gain explicit `abandoned_quarantined` / `abandoned_purged` outcomes backed by completion evidence. It must never treat a maintenance ID as a recording ID.

Committed prune preserves `history_truncated`, unknown original occurrence numbering and honest retained coverage. Clock quarantine preserves original clocks and explicit exclusion. No cleanup path re-stamps, recaptures, reconstructs missing bars or promotes partial JSON to a capture. Pure logical removal does not claim secure erasure, backup deletion or profit/accuracy improvement.

## Synthetic Acceptance Matrix

| Area | Required checks before production enablement |
|---|---|
| Root and parent substitution | Swap root/parent before open, after pin, after hashing and before move/unlink; substitute symlinks to an external-victim fixture. External-victim names/bytes/inodes remain unchanged; no replacement is followed. |
| Leaf and holding substitution | Replace a target with a symlink, different inode/same bytes, same inode/changed bytes, directory, FIFO, foreign file or unknown hard link. No unexpected object is unlinked; conflicts are explicit. |
| Capability failures | Missing addon/API/flag, wrong ABI/architecture, unsupported volume, ignored ownership, ACL errors, cross-device rename, exclusive-destination collision and failed directory sync refuse safely without fallback. |
| Permission changes | Explicit/inherited ACL grants and owner/mode changes on opened ancestors/objects; no permission repair or pathname-only authorization. |
| Producer concurrency | Multiple MCP processes, live/suspended producer, dead producer, PID reuse, unknown owner and a writer waiting for the same lock. No overlap, deletion to obtain a lock or unjoined worker after lock release. |
| Classification | Fresh/old valid pending capture, truncated registered stage, legacy unregistered stage, Finder metadata, corrupt canonical receipt, stage linked to committed evidence and unsupported oversized entry. Match the classification table exactly. |
| Crash boundaries | Kill before/after intent sync, each move, post-move verification, pending-unlink step, unlink, directory sync and completion/response. Fresh approval required after every restart; bytes and uncertainty accounted for. |
| Tampered recovery | Fresh evidence referenced by a forged old intent, changed policy/root identity, duplicated target, new receipt, both/missing/different locations and old v1 partial hard-link quarantine. No new record is deleted. |
| Consent and clocks | Wrong process/hash/kind, expired wall/monotonic deadline, queue expiry, rollback, quota pressure and replayed confirmation. No expired grant, implicit next batch or background cleanup. |
| History | A/B/A and volume-only evidence across prune, abandoned cleanup with identical values, as-of boundaries and retention floor. Uncommitted cleanup does not manufacture or remove a version. |
| No side effects | Missing-root/read-only preview creates nothing; tests use dedicated synthetic roots and an external-victim sibling only. No TradingView, Gmail, journals, Dot or production storage calls. |
| Native lifecycle | Bounded FDs/buffers, cancellation/join, process exit, no deleting finalizers; native sanitizer runs and packaging tests for each advertised platform/architecture. |

Do not use the real store to demonstrate a rename, deletion or capability probe. Passing TypeScript mocks is insufficient for the parent-swap claim: the actual native adapter must pass adversarial synthetic filesystem tests. Existing full-suite results from 2026-10-22 are not evidence that this unimplemented backend is safe.

## Rollout And Approval Gates

1. Agree on this design, particularly the optional native dependency, two-step cleanup, proposed quarantine holding period and explicit legacy-review limits.
2. Implement the native backend and primitive tests only in dedicated synthetic roots. Keep production maintenance refused; do not register new cleanup tools yet.
3. Implement classification, versioned transaction/recovery schemas and synthetic failure tests, including recording reservations and prior-build compatibility. Keep all existing market/notification rules untouched.
4. Obtain separate approval before MCP registration. Registration alone does not enable production execution, recording, cleanup or a restart/deployment.
5. Review packaging, native-memory/path safety and the full synthetic matrix. Only then consider an explicitly approved deployment/enablement and individually approved real-data operations. No unattended cleanup or Dot restart follows.

## Phase 1 Implementation Boundary

The user approved the design and strictly-more-than-90-day abandoned-quarantine candidate rule on 2026-10-23 JST, then authorized native primitives and synthetic tests only. [Implementation contract and test commands](../native/native_bar_fs/README.md). The optional loader and Node-API addon are disconnected from the MCP/server/history execution path. The only build is synthetic-only and refuses non-fixture roots in C++; its binary is excluded from package publication.

Implemented: pinned root/parent sessions, descriptor ACL/owner/mode/volume qualification, bounded byte proofs, exclusive holding moves, post-move verification, held-only unlink, incomplete outcomes, dual-clock expiry and bounded descriptor lifecycle. These are synchronous in-process primitives, not transaction/consent/recovery integration. The production-maintenance guard remains unchanged.

Not implemented in this phase: cleanup classification, producer reservations, versioned durable intents/events, replay/recovery, quarantine clock/90-day eligibility, staging/coordination cleanup, writer-lock integration, new MCP tools or production packaging. The broader acceptance matrix above remains a release gate. Neither approval nor passing primitive tests permits real-data operations, deployment or Dot restart. Dot remains PAUSED; the automation file and trading/notification-condition prefix remain byte-for-byte unchanged.
