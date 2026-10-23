# Native Bar Cleanup Classification And Approval Previews

Status: phase 2, supplied-snapshot classification and process-local planning only, 2026-10-23 JST. No filesystem adapter, mutation executor, new MCP registration or production enablement. The [approved maintenance design](NATIVE_BAR_MAINTENANCE_DESIGN.md) remains the execution contract; this module does not satisfy its production release gates.

## Implemented Boundary

`src/nativeBarMaintenance.ts` exports `classifyNativeBarCleanup`, `NativeBarCleanupPlans` and three provisional provenance schemas. It imports only crypto, Zod and pure evidence schemas. It does not open/read/write a file, load the native addon, probe a process, take a writer/chart lock, access TradingView, send notifications or alter history. Existing receipt/maintenance schemas moved unchanged to `nativeBarArtifacts.ts` for consistent interpretation by the history reader and classifier. Existing recording/publication and production-maintenance refusal are unchanged.

Every report, preview and successful validation says `execution_available: false`. Reports/previews say `verification_scope: supplied_snapshot_only`. The fixed blocker is `cleanup_execution_not_implemented`. A plan is an approval **preview**, not an executable capability, host-authenticated human consent or authorization to operate on real data. `consumeForSyntheticValidation` consumes only a memory entry and explicitly returns `validated_only` / `no_operation_performed: true`. No executor callback exists.

## Evidence Input

The strict `native-bar-cleanup-snapshot-v1` input carries:

- Canonical UTC `as_of`, complete-inventory flag, root identity/owner/mode/ACL, policy hash, backend protocol and capabilities hash. Missing root plus an empty inventory returns no candidates and creates nothing.
- Exact relative paths, object types, ACL outcomes, complete parent identity chains and lossless decimal device/inode/size/link/time proofs. Root/parent ACL grants or unknown ACLs cannot qualify. Contradictory parent evidence and duplicate file identities block planning.
- Bounded bytes for evidence parsing, including raw interrupted stages. Content must match the supplied regular-file proof, owner, device, size, single-link count and raw hash. Unknown side files remain preserved, not JSON-decoded into evidence.
- Current owner tokens and process-incarnation liveness results. A death result must bind the exact owner hash and this snapshot's `as_of`. Current owner tokens override a death result. Boot/start mismatch requires the corresponding owner digest; `ESRCH` supports the legacy owner shape. Missing, stale, unknown or live evidence never means dead.

These are caller-supplied facts, **not independently verified OS evidence**. In particular, `coverage_complete`, liveness, root qualification and ACL labels are not authenticated by this pure module. A future trusted descriptor-based collector must produce and recheck them under the existing cooperative writer exclusion before any execution is considered. Creation `birthtime_ns` is required for registered created-object binding; the current primitive inventory does not yet expose the complete new snapshot contract. The new module does not silently substitute inode/mtime/PID heuristics for a missing field.

### Provisional Provenance

Schemas are validated in memory only. No new reservation, created-entry or quarantine marker is persisted by this phase, and existing writers do not emit them.

| Schema | Binding |
|---|---|
| `native-bar-producer-reservation-v1` | Operation/recording IDs, exact capture/stage path and kind, owner incarnation, root/policy and reservation time. No OHLC. |
| `native-bar-created-entry-v1` | Reservation hash, operation/stage IDs, exact path, creation time and device/inode/birthtime of the exclusively created object. Separate immutable metadata, not a reservation overwrite. |
| `native-bar-abandoned-quarantine-v1` | Completed operation ID, root/policy, quarantine time and exact target IDs/source paths/proofs. No copied content. Its durable publication, time provenance and recovery authentication are **not implemented**. |

The timestamps/identities in a synthetic snapshot permit structural testing; neither a self-consistent marker nor old native metadata alone authenticates a historical UTC event or grants purge authority.

## Classification

| Evidence | Result |
|---|---|
| Canonical valid receipt/payload | `committed`; never abandoned cleanup. Corrupt or missing canonical evidence globally blocks planning, even if its recording ID also has a stage. |
| Receipt, maintenance or live/unknown producer reference | Excluded from cleanup. A canonical receipt reserves its recording ID even before successful content parsing. |
| Registered valid pending capture or interrupted raw stage, exact created object, verified dead owner | `registered_pending_capture` / `registered_interrupted_stage`, quarantine-only candidate. No promotion to a receipt or first-seen observation. |
| Reservation without created-object proof | Preserved and excluded, even with dead-owner evidence; never falls back to legacy review. |
| Unregistered recognized capture/stage | `legacy_unverified`. A stage is bound to the recording ID in its name (`.<recording-id>-<tag>-<pid>-<random>.stage`) and checked against receipts, maintenance and live reservations like a capture. It gets a separate **review-only** plan only when that ID is known and unreferenced and no writer may still be publishing: no `.writer.lock` or `.writer.takeover`, no current owner token, and no live or unknown coordination or reservation owner. A stage without a recording ID in its name is preserved without review. No holding/destination path or movement authority; offline inactivity proof/legacy execution needs a later design and approval. |
| Strict dead claim/ticket/retired coordination | `dead_coordination`, quarantine-only candidate. Current lock/takeover and current/live/unknown owners excluded; the holder named by a `.writer.lock` or `.writer.takeover` body counts as current. A ticket must carry exactly its claim owner; a mismatch is the queue corruption writers refuse and globally blocks planning. A filename PID is not death evidence. |
| Abandoned quarantine | Purge candidate only if the complete exact set is present, no source remains, contents/proofs/marker match, no receipt/maintenance/live reference exists, and quarantine time plus target/marker native times are all strictly more than 90 elapsed days old. Exactly 90 days is excluded. Missing/changed/fresh/unverifiable metadata never qualifies. |
| Incomplete known maintenance, abandoned quarantine without its completion marker, new holding/events requiring unsupported recovery | Global blocker; preserve, do not bypass with an unrelated cleanup plan. |
| Clock quarantine, policy/provenance/retention metadata, Finder files, arbitrary files, nonregular/foreign/ACL-unsafe entries, hard links | Preserve; not ordinary cleanup targets. Contradictory duplicate object identities globally block planning. |

Root/policy mismatch, canonical corrupt provenance, inconsistent parents, incomplete inventory, incomplete maintenance, contradictory quarantine sets and case variants of store names (APFS compares names case-insensitively, so `Receipts/` or an upper-case ID may be the object the store uses) block the **whole plan**, even if an individual item's descriptive classification says eligible. A descriptive item is not a grant. No implicit JSON repair, wildcard, force-delete, fallback move or next batch exists.

## Exact Memory Plans

`prepare(snapshot, { action, candidate_ids })` accepts only `quarantine`, `purge` or `legacy_review` plus distinct explicit candidate IDs, at most 1,024. Paths, cutoffs, timestamps and replacement data are not selectors. The entire batch must qualify; it is never silently reduced or expanded.

The preview binds the action, issuing registry/process, generated operation/plan IDs, exact sources, proposed holding/destination slots, object/parent/root/policy/backend proofs and complete evidence generation. The generation includes unknown entries and references as well as recognized candidates. It sorts by code-unit order, so order-only inventory changes do not alter it; names equal under NFC (impossible together on APFS) refuse the snapshot. A new receipt, altered bytes, replaced parent/root, changed owner or added side file invalidates the unstarted plan. No raw OHLC/byte buffer is returned or retained in the plan.

Both wall and monotonic lifetimes are ten minutes, starting at preview issuance, with a final check after classification/validation work. Snapshot age must also be less than ten minutes both before and after that work; re-preview cannot give arbitrarily stale evidence a fresh lifetime. Clock rollback/invalid clocks clear outstanding plans. Up to 128 live plans are retained; expiry/reuse/restart does not preserve consent. No deadline is restarted after waiting.

`consumeForSyntheticValidation({ plan_id, plan_hash, action, confirm: true }, freshSnapshot)` accepts no scope override. The snapshot must be taken after the plan was issued (`as_of` later than `issued_at`), never the preview evidence itself. A matching registry memory entry is removed before binding/expiry/evidence validation, so failures after lookup consume it too. Malformed requests (including `confirm: false` or unknown fields) are refused before lookup. The supplied fresh snapshot is fully reclassified; changed eligibility or generation refuses the whole plan. Returned preview objects are detached from saved metadata, so mutating a preview cannot widen its saved targets.

A purge plan must cover every target of each abandoned-quarantine marker it touches; a split set would leave a marker naming missing targets. Retiring the marker and recording completion after a purge belong to the unimplemented execution phase; until then a marker whose targets are gone reads as an integrity failure. Quarantine previews say `move_without_purge`; purge previews say `irreversible_unlink` with no secure-erasure promise; legacy previews say `review_only` with no movement destination. All remain non-executable. Technical confirmation is not human authentication.

## Bounds And Remaining Gates

Existing ceilings are preserved: 30,000 entries, 1 GiB counted inventory, 1 MiB per read artifact, 256 MiB supplied evidence scan, 16 MiB recognized metadata and 8 MiB serialized response. Integer proofs are not converted to lossy JS numbers. Reports list only candidates with their proofs and parents; every other item carries its ID, path, classification and reasons, with per-class `summary` counts, so a full store with pending quarantine batches stays within the response ceiling (pathologically long names can still reach it and refuse). Plans also reject previews that exceed response/metadata/store headroom. This is only a preview-size check, **not** a worst-case durable transaction reserve: `capacity_reservation` remains `unverified_no_execution`.

Before execution: implement the trusted descriptor inventory and birthtime support, qualification/namespace checks, existing-writer exclusion, immutable recording provenance publication, versioned durable intents/events/completions, trusted quarantine-clock/recovery checks, bounded native-session lifecycle, transaction/recovery capacity reservation and prior-build compatibility. Then review the full crash/race matrix. MCP registration, production packaging/deployment, enablement and individual real-data operations each remain separately gated. Dot remains PAUSED; trading and notification conditions are not part of this module and are unchanged.

Synthetic tests run entirely on in-memory invented bytes/proofs/process results:

```sh
bdo npm run build
bdo node --test test/unit/nativeBarMaintenance.test.mjs
bdo npm test
```

Not yet checked: clock consistency between a target or marker birth time and the recorded quarantine time (each must still be more than 90 days old), and malformed names under `maintenance-hold/` or a non-UUID `.events` directory, which are preserved as unknown rather than blocking.

These tests do not prove real filesystem races, time authentication, real writer concurrency, crash recovery or safe production deletion. Native primitive synthetic tests cover a separate lower-level contract and do not turn a preview into authorization.
