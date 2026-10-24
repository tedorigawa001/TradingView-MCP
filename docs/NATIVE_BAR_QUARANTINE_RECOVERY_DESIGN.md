# Native Bar Quarantine Recovery Execution

Status: **v5 / two-target / two-recovery / controller-loss-stop design approved; R-A pure contracts implemented**, 2026-10-24 JST, following `15d9f36`. The user authorized R-A record formats, remaining-action planning, capacity accounting and synthetic tests only. R-B/R-C/R-D implementation, fixture execution, real recording/movement/deletion, MCP registration, deployment and production enablement are not authorized. Dot stays PAUSED; trading/scenario/notification conditions are unchanged.

The [parent execution design](NATIVE_BAR_EXECUTION_RECOVERY_DESIGN.md) remains the governing safety contract. The first connection below is deliberately narrower: move-only recovery of independently admitted invented fixtures, with finite retries. It does not complete slice E provenance/history integration or slice F purge.

## Current Barriers

| Current implementation | Consequence for recovery |
|---|---|
| Protocol 4 creates one opaque in-process plan, one attempt and a fixed publication schedule. Native phases and positions start at zero. | Reopening a root and resetting `next` or a phase is not recovery. A separate typed native admission path is required. |
| The v4 inspector accepts one original attempt and derives every publication from the original plan. | Appending recovery records would violate its contract. Do not relax its parser or reinterpret an existing policy. |
| Any maintenance/quarantine/producer namespace or old reserve blocks a new plan. | Preserve this ordinary-execution blocker. A recovery admission may explain only the selected transaction's exact known deltas. |
| The v2 reducer binds attempts to the original reference hash and requires a fresh attempt after an old pending step. | Keep the original hash as audit evidence; separately bind the current reference generation. Never finish an old pending step with another attempt's ordinary success event. |
| A v2 completion requires `timestamp.json` born after the last event. | Reusing an older marker after new verification events is invalid. Version the physical completion/marker binding instead of changing the old rule. |
| Native facts and self-consistent JSON do not establish original cleanup eligibility or current human consent. | Recovery needs independent original-admission evidence and a new issuer-bound approval. Disk hashes alone cannot select good captures for movement. |

The existing v4 inspector remains read-only. `complete` means verified surviving terminal records, not proof the original caller received a response or proof of power-loss durability.

## First Connection Scope

Call the first connection **D-R0**. The pure R-A contracts below are implemented; native admission, execution and controller capabilities remain proposed and disconnected. None is a registered tool.

- Use a **fresh, already provisioned marked temporary fixture**, with exact proposed policy `{"schema":"native-bar-synthetic-quarantine-recovery-profile-v5"}` and typed native protocol 5 admission. Do not create it through a constructor or recovery preview.
- Support one original quarantine transaction, **one or two invented capture targets**, the original attempt and at most **two freshly approved recovery attempts**. The complete target set stays fixed. Refuse larger sets; never trim, split or automatically continue a batch.
- Preserve the existing v4 path and its 16-target limit unchanged. V4 incomplete fixtures remain diagnostics-only; no in-place policy edit, format conversion or v4 recovery execution is included.
- No purge/unlink, source restoration, overwritten metadata, re-recording, receipt repair, legacy adoption, metadata cleanup or reservation release. Root temporaries, old markers, incomplete layouts and reserves remain preserved.
- Keep every public plan/result at `execution_available:false` and `recovery_execution_available:false`. A future local fixture execution result may separately report exact synthetic effects; it is not production authority.

The user approved these narrower engineering limits. They do not change a trading rule, notification threshold or the strictly-more-than-90-day deletion condition. Only R-A implementation is authorized so far.

## Independent Admission And Fresh Consent

D-R0 uses a trusted **fixture controller** outside the worker/store being tested. Before the original worker can move anything, this controller retains an admission ledger for the exact fixture: root/ancestor identities and access-control digests, policy/capabilities, original intent/manifest/plan hashes, selected source identities/content/flags/ACL digests, fixed destination/publication/temporary slots and reserve allocation evidence. It independently owns the invented fixture inputs; it does not derive eligibility from the intent it is asked to recover.

Keep the digest construction acyclic. The controller first freezes a scope certificate for the independently selected inputs, approved plan/slots and verified original allocation. Its `scope_digest` excludes the not-yet-built intent hash. The initial writer then embeds that digest in the intent envelope; the controller separately seals the resulting intent/manifest hashes to that certificate before admitting the first move. No record hashes itself or a future completion. A failure before this seal is diagnostics-only, not a partially authorized recovery scope.

The initial approval must explicitly cover declared coordination/reserve/layout/metadata preparation, using independently selected source proofs and the fixed original plan. Before the controller seal, its native handle is preparation-only: no capture move is available. Sealing may admit only that already approved exact scope within the same unexpired original lease; it cannot add a target or renew the window. A crash before sealing preserves preparation files and does not become a recovery opportunity.

The controller also retains consumed attempt ordinals and known publication acknowledgements. A restarted test worker receives an opaque admission capability through trusted test bootstrap, not a request parameter, environment boolean, serialized plan or store file. Copying its displayed fields does not mint that capability. The original admission is historical scope evidence, **not a surviving execution approval**.

Each invocation still needs a new process-local plan ID/hash and a new single-use fixture approval from that invocation's issuer. Consume approval and its finite attempt ordinal before waiting. Wrong issuer/hash/operation/root/target set, consumed approvals and expired windows refuse. This is not the missing production host-authenticated consent bridge.

**Only worker restart while this independent controller survives is supported initially.** Loss of the controller ledger, a whole-controller/OS restart, or an unavailable admission source blocks mutation. Do not rebuild authority from on-disk JSON, re-admit the same root as a fresh fixture or backfill a witness. Durable host/producer admission across that boundary is a separate design and slice E/production gate. Same-UID/admin compromise is not isolated by this test controller.

**The fixture controller is test scaffolding, not a production authority model.** In production the nearest equivalent of controller loss is an MCP server restart, after which this design would block recovery. R-B and R-D therefore validate record contracts, native step enforcement and interruption handling, but say nothing about how a real store proves its original admission. Production recovery stays blocked until slice E supplies a durable, independently verifiable admission source and that source passes its own review; nothing learned from the controller may be promoted to that role.

## Preview And Execution Boundary

Proposed interfaces are separate from `createSyntheticNativeBarQuarantineRegistry`:

| Boundary | Proposed responsibility |
|---|---|
| Read-only recovery inspection | Fresh descriptor inventory and strict decoding; return recorded phase, observed locations, contradictions and proposed remaining actions separately. No lock, layout, reserve, journal or probe writes. |
| Recovery preparation | Require controller admission; open one newly qualified native/C lease; retain the native view, exact remaining actions, unused declared slots, current references and all limits. Return a detached display plan, not a caller-editable input snapshot. |
| Native protocol 5 admission | Re-derive legal roles/steps from bound records and native facts. Mint a distinct opaque recovery handle tied to the same C session. Accept no caller paths, proof booleans, phase counters, destination overrides or raw metadata payloads from MCP requests. |
| Fixture execution | Match plan and fresh opaque approval, consume once, take existing writer exclusion, recollect and revalidate, publish a new attempt, then execute only its remaining steps. |
| Finalization | Release only exact owned coordination in `finally`, close references and report failures/uncertainty. No data rollback, unlink or automatic retry. |

One lease has one original wall/monotonic **ten-minute** window from opening. Preview, queueing, approval, reopens and same-lease re-preview never extend it. A later separately approved invocation gets its own lease/window and ordinal, not an extension of the old grant. The v2 attempt's `issued` uses that lease opening time and `expires_at` is exactly ten minutes later. Fresh collection must occur after plan issuance and again under writer ownership; target clocks must also satisfy the reducer's UTC checks.

Live, suspended or unknown writers block. A proven-dead lock requires the existing C retirement rules and a fresh preview after the resulting baseline change; retirement is not a data-recovery permission. Prefer reporting that coordination prerequisite before issuing a recovery plan. If contention/retirement is discovered after approval, stop the consumed plan and disclose its coordination effects. Such failed invocations can exhaust the finite attempt budget even without a data move.

## Strict Record Contract

Use new strict **v5 envelopes/readers** in the fresh profile. Reuse the v2 event/attempt schemas and pure replay for legal prefixes where their semantics apply; do not change their existing callers or fabricate a v2 completed bundle for a different physical marker path.

| Record | Required binding |
|---|---|
| Original v5 intent envelope | Unmodified v2 intent and manifests, original complete plan, independent-admission `scope_digest`, native root/ancestor/access/flags evidence, finite attempt IDs and ordinal schedule, all final/temporary slots, full peak budget and verified original reserve identity/allocation. Publish, verify and obtain the independent controller seal before the first move. |
| Attempt envelope | New v2 attempt, fresh recovery-plan digest, original admission/intent/manifest digests, ordinal, previous published attempt-envelope hash, validated event-prefix hash/count, freshly collected complete inventory/reference generation, all target observations and exact allowed actions. Bind both original reference audit hash and current reference hash; do not substitute the latter into v2 `reference_hash`. |
| Target event | Existing v2 sequence/previous hash, current attempt hash, exact target, legal phase and proof. Native phase admission must enforce pending publication before a move and verified publication after sync/readback. |
| Attempt-specific timestamp | `quarantine/abandoned/<maintenance-id>/<attempt-id>.timestamp.json`; original intent, final event hash, exact final target set/proofs, current attempt and new observed publication bracket. `elapsed:null` and elapsed qualification false. |
| V5 completion envelope | `maintenance/<maintenance-id>.done.json`; strict terminal-state check over the full v2 prefix, original scope, all **published** attempt-envelope hashes in ordinal order, used v2 attempt hashes, final attempt ID and its timestamp path/hash/proof, exact target set and logical completion clock. Require marker creation after the last verification event and completion before the current deadline. |

An attempt published without any event still consumes an ordinal, remains retained and is listed in the completion's published-envelope chain. The v2 reducer's used-attempt list does not cover such envelopes; the v5 validator checks both lists without discarding unused attempts. An ordinal consumed before an envelope was published is not a reusable slot: retain the controller's witness and report publication as unconfirmed, not as proof no effects occurred. An absent known-acknowledged record or an event referencing a missing attempt blocks.

The initial and recovery writers must use this same v5 contract from their first publication. Every JSON record is canonical/fatal-UTF-8/duplicate-key checked. Unknown fields/versions, path-role confusion, missing manifests, event gaps or altered known records block without repair. A new bounded reader grammar must explicitly recognize the attempt-specific marker names; do not weaken protocol 2's namespace rules globally. The v5 reader keeps the exact-namespace rule added in `15d9f36`: every entry under `maintenance/<id>.*`, `maintenance-hold/<id>/` and `quarantine/abandoned/<id>/` must be a declared publication (including all three attempt-specific timestamp names), a layout directory or a target slot, and declared temporaries stay at the root. Any unplanned entry blocks inspection and recovery, so slice F never meets an object this transaction did not quarantine.

D-R0 emits only the four ordinary move event types and `recovered_verified`. Per target and ordinal, allow at most one recovery verification and each of the two remaining moves at most once. No redundant verification loop, `failure`/unlink event, or in-attempt retry spends extra slots. A syscall/publication failure halts that ordinal and is reported with the surviving prefix and current uncertainty; it does not authorize another journal write after expiry. Other v2 event types remain available to their existing pure model, but are not executable D-R0 paths.

No v4 policy is modified or migrated. Verify that the current v1 history reader and v4 quarantine coordinator reject fresh v5 fixtures before data action, including waiting/stale invocations. Raw legacy Node-API fixture primitives are trusted same-process test internals, not a compatibility or security fence; the new registry must never call them as a fallback.

## Recovery Decisions

All targets must pass before any new move. Each target must have exactly one permitted current location, single-link identity/content/flags/access checks and a legal durable prefix. Block the entire set on a contradiction; do not salvage a convenient subset.

| Durable phase and actual location | Freshly approved remaining work |
|---|---|
| Valid intent/manifests, no event, exact original source | Recheck independent original admission and absence of receipts/references; publish new attempt, then fresh `move_pending` and normal stage/quarantine steps. Missing intent is not this case. |
| `move_pending`, source still exact | New attempt emits `recovered_verified(source)` referencing the old pending hash, then a **new** `move_pending` before staging. Never execute the old pending grant. |
| `move_pending`, exact held object | Sync/verify current holding, emit `recovered_verified(holding)` against old pending, then new quarantine-pending/move/verified steps. Do not append `held_verified` using the old attempt. |
| `holding`, exact held proof | Fresh verification event under the new attempt, then new quarantine steps. No source restore. |
| `quarantine_move_pending`, exact holding | Reconcile to holding in the new attempt, then publish a new pending event and move once. |
| `quarantine_move_pending`, exact final object | Sync/verify final, emit `recovered_verified(quarantine)` against old pending. No second rename. |
| `quarantined`, exact final proof, marker absent or valid older attempt marker present | Fresh verification for **every** target; create the current attempt's timestamp, then the v5 completion. Preserve old markers and use the new clock, never the old intent date. |
| Valid surviving completion and exact current set | Read-only `complete`, `original_acknowledgement:not_proven`. No new attempt, move, marker or acknowledgement reconstruction. |
| Both locations, no permitted location, altered proof/access, a move without legal pending, new receipt/reference, other incomplete transaction, malformed known metadata or unavailable admission | Block all mutation; preserve evidence and name the reason. |
| No complete original intent/manifests, interrupted initial layout/reserve only, or exhausted ordinals | Diagnostics only. No fabricated intent, reserve cleanup or new ordinary-quarantine plan. |

For a pending move only, ctime may differ within the original pending-to-fresh-observation UTC bracket, using the v2 precision rule; all immutable proof fields and the full access/flags binding must still agree. This records **where the object is verified now**, not who moved it or the original move time. For an already verified phase require its exact recorded proof; unexplained ctime/access changes are not normalized away.

### Preserving An Interrupted Publication

Final names are never overwritten. A canonical final event already in the contiguous prefix is read/validated, not published again. A truncated or malformed final record blocks; its content is not repaired from a temporary.

An old root publication temporary remains immutable preserved evidence even if its bytes look complete. A later attempt uses its own predeclared temporary for the still-free next final sequence slot, after fresh admission/approval and a newly derived legal event. No temporary adoption, copy-forward, unlink, rename-to-trash or partial-write continuation is allowed.

If a previous attempt published its timestamp but not completion, validate and retain that timestamp. The new attempt publishes a different, predeclared timestamp **after** its new verification events and binds it in completion. Do not overwrite `timestamp.json`, rewrite an old time or treat multiple timestamps as multiple cleanup sets. The active marker is derived only from validated completion; slice F must not consume these records until its separate reader/clock gates pass.

Validate each retained timestamp against its own bound attempt and historical event prefix, including the exact then-final proofs and publication bracket, not against a later attempt's final event hash. An inactive timestamp is not ignored: malformed, changed or out-of-scope older metadata still blocks. A later valid timestamp neither certifies the earlier acknowledgement nor creates a second target set.

## Baselines And Capacity

The native recovery view starts from a complete new inventory and validates the original admitted target/parent/root identities against controller evidence and legal transitions. Bind owner, group, birthtime, mode, flags and complete ACL digests, not just the `deny_only` category. All source/holding/final and reference namespaces participate. New receipts, live/unknown references, missing committed evidence, unknown private entries or unrelated transactions block.

The selected transaction's original and already published **exact declared** records, retained temporaries/reserve and permitted current target locations can explain its own incomplete state. Every entry still participates in the inventory/generation. C's exact-owned coordination delta is separate. No `.writer*`, `maintenance/*`, unknown-file or transaction-prefix exclusion is allowed. Proven retirement changes require a new complete baseline, not hidden self-deltas. Revalidate after issuance, under exclusion, before/after each addressed step and before acknowledgement; observed drift cannot be undone to revive the consumed plan.

Proposed D-R0 bounds reserve all possible publication names from the original plan. For `N` targets, `1 <= N <= 2`:

| Item | Fixed bound |
|---|---|
| Attempts | Original plus two recovery ordinals; failed waits/consent consumption count too. |
| Target events | Original at most `4N`; each recovery at most `5N` (reconciliation plus two pending/verified moves). Global event slots `1..14N`, no gaps in the published prefix. |
| Final publication slots `P` | Manifest + intent + three attempt envelopes + `14N` events + three timestamps + completion = `9 + 14N`, at most 37. |
| Temporary slots `T` | At most one generated temporary per final slot **per ordinal**, conservatively `3P`, at most 111. A failed ordinal never reuses its temporary. |
| Record size `L` | 65,536 bytes including envelopes; check actual canonical size before any write/move. Never truncate or silently chunk a mismatching plan. |
| Peak journal/layout bound `B` | `(P + T + 32) * L + 1,048,576`, at most **12,845,056 bytes** (12.25 MiB). Includes retained temporaries, directory allowances and recovery headroom. |
| Inventory | Fresh-fixture initial cap 128; proposed recovery enumeration cap 512, counting all entries. This is a new bounded recovery view, not an increase to v4 preparation. Refuse if exceeded. |
| Shared ceilings | Eight roots, 32 live targets/session, 512 FDs; require at least 48 additional FD slots before writes. Keep 1 MiB artifact, 16 MiB metadata, 1 GiB inventory, 256 MiB actual read and 8 MiB response ceilings. |

Preflight logical capacity using occupied records, retained temporaries and all remaining declared slots without deletion credit; count a published final once, never reset accounting per attempt. All v5 headers/manifests/envelopes must actually fit `L`, including the complete declared name matrix. Reject before the first data move if they do not fit. Charge mandatory hash rereads and revalidation for the complete invocation against 256 MiB; exhaustion stops, not next-batch continuation.

The original v5 fixture writer must qualify native physical allocation, reserve `B` once and bind the reserve object/allocation acknowledgement before the first move. Recovery requires the same owner-private single-link reserve and a qualified native allocated-space observation; logical `st_size == 0` is not zero consumption. No new reserve or blind repeat of `F_PREALLOCATE`, and no truncate/hole-punch/release is allowed. Unknown/lost/substituted allocation evidence blocks. The allocated-space observation is `fstat` on the pinned reserve descriptor, using `st_blocks * 512`: the slice D review read 4,325,376 allocated bytes from a size-0 reserve this way. The original v5 intent records the reserve identity and the allocated bytes observed right after `F_PREALLOCATE`; recovery requires the same identity and at least that allocation, and blocks otherwise. Whether `st_blocks` stays faithful on APFS for clones, compression or snapshots remains a qualification gate before any production use.

Maintain separate logical-record and physical-allocation ledgers. Count the retained reserve in physical occupancy and enforce the 1 GiB ceiling on observed physical occupancy plus remaining peak as an additional conservative check; do not count it as available write credit or double-count it as newly allocated for each attempt. Before any attempt writes, require a fresh free-space estimate of at least twice its remaining peak, bounded by `B`. Estimates/reservations do not guarantee later writes; any allocation/write/read/sync failure stops all new steps and preserves evidence.

For the initial preparation, check at least `3B` free before allocating the retained reserve: one `B` for that object plus the `2B` journal headroom required after it. The largest proposed initial estimate is 38,535,168 bytes (36.75 MiB). Later attempts do not allocate that reserve again and still check their fresh remaining peak without using it as credit. These are new-profile estimates, not changes to v4's existing checks or guarantees of future disk availability.

Do not append past the fixed event/attempt/temporary capacity, extend an expired lease to finalize, or erase old records to make room. Exhaustion stays inspectable and blocked. Reservation retirement and metadata cleanup require a different approved operation.

## Completion And Time

Verify and sync the entire final set; publish/read back the new attempt-specific marker; choose logical completion after that verification and before completion publication. Verify/sync/read back completion and request the final root full flush before reporting a new response acknowledgement. Return logical time, observed publication/sync acknowledgement and `original_acknowledgement:not_proven` separately. A surviving completion after response/full-flush uncertainty remains read-only terminal evidence, not proof the original response or final flush was acknowledged.

Never replace a valid completion to improve its clock or certainty. Persist UTC brackets without inventing historical move times. UTC rollback relative to recorded events/native observations, future facts or ambiguous clocks block execution. Per-invocation monotonic deadlines do not qualify cross-process elapsed age. Keep `elapsed_clock_qualified:false`; **all purge remains unavailable**, including after 90 calendar days. The approved strictly-more-than-90-elapsed-day condition is unchanged.

## Implementation Order And Acceptance

Each step needs separate implementation approval. R-A alone has that approval and is implemented within the boundary below; R-B onward remains unimplemented.

| Step | Deliverable | Required synthetic acceptance |
|---|---|---|
| R-A | Strict v5 plan/attempt/completion envelopes, exact remaining-action planner, prefix validation and capacity accounting as pure functions | Every decision-table row; fixed whole scope; unused/consumed attempts; malformed/gapped records; marker-before-new-event rejection; `N=1/2`, `N=3` refusal, `P/T/B` boundaries and no old API/schema/hash changes. |
| R-B | Fresh-profile fixture controller admission and read-only native recovery view | Forged self-consistent intent cannot select an otherwise good capture; missing controller/wrong issuer/root/ACL/reference/ordinal refuses; source/held/final and allocation facts; no preview writes. Old v1/v4 high-level writer rejection, including prior waiters. |
| R-C | Typed protocol 5 native plan/step enforcement and finite publication integration | Current C lease/lock, no TTL reset, no arbitrary paths/phases or legacy fallback; pending-before-move; old pending reconciled by a new attempt; different timestamp per attempt; preserved temporary/reserve/collision and exact quota/FD/read bounds. |
| R-D | Fixture-only coordinator, process-death recovery and final review | Actual worker SIGKILL at every new publication/move/sync/response boundary; repeated interruption through both recovery ordinals; no second move after response loss; stale/live/unknown locks; new references; full-flush failure; invalid final metadata; exhausted slots; controller loss; no real data/MCP/Dot connection. |

**Recommended order:** implement R-A alone first. Its pure record contracts, remaining-action planner and capacity accounting stay useful whatever admission source is chosen. Start R-B onward only after deciding whether the controller scaffolding is worth building before slice E defines the durable admission source.

R-D must compare native facts and replay/remaining-action decisions independently, not only call the same reducer twice. Run normal/UBSan and relevant sanitizer/static analysis, standard regression and failure injection without overlapping build versions. Power interruption, unsupported/remounted filesystem qualification, real host approval, real producer/history integration and production deployment remain later gates.

## Approved Decisions (2026-10-24)

1. Fresh v5 fixture profile and versioned completion/attempt-specific marker contract; leave all v4 and real stores unchanged.
2. Initial two-target/two-recovery limit and the finite no-cleanup capacity strategy; larger or exhausted sets remain blocked.
3. Controller-survival-only historical admission for the first synthetic connection, as test scaffolding only. Whole-controller/OS restart stays blocked until an independently approved durable admission source exists, and production recovery stays blocked until slice E supplies one.

No decision here authorizes data operations in the current workspace, new MCP registration, production initialization/migration, Dot resumption or trading/notification changes.

## R-A Implemented Boundary

`src/nativeBarRecovery.ts` imports only Zod and the existing pure evidence/transaction helpers. It creates no directory, opens no store, loads no native addon, samples no clock, issues no approval and changes no existing schema or caller. All IDs, times, records, observations and accounting are explicit supplied inputs. The only byte decoder accepts bounded canonical UTF-8 JSON bytes, not a pathname; duplicate keys, noncanonical encodings and malformed/gapped chains refuse.

| Pure API | Responsibility |
|---|---|
| `createNativeBarRecoveryLayout` | Fix every publication, ordinal-specific temporary, marker and reserve name for one or two targets. Names have no filesystem effect. |
| `validateNativeBarRecoveryBundle` / `decodeNativeBarRecoveryBundle` | Strict v5 original/scope/attempt/timestamp/completion binding over the unchanged v2 prefix reducer. Validate full shared-parent evidence, role IDs, historical markers and both published/used attempt lists. |
| `calculateNativeBarRecoveryCapacity` | BigInt peak accounting, finite P/T/B limits, original reserve occupancy, remaining-slot headroom and exact ceilings. Neither physical allocation nor free-space measurement is authenticated. |
| `planNativeBarRecovery` | Reconcile supplied complete inventory, references, native binding, controller ledger, current locations, retained metadata/temporaries, clocks and budgets. Return the entire descriptive residual plan or none. |

The original envelope embeds an independently supplied scope certificate, not an authority token. Its initial plan hash excludes that certificate; the certificate binds the plan/manifest/native evidence/reserve; the envelope embeds its digest; supplied controller fields separately bind the envelope hash. Actual independent selection, ledger survival, opaque bootstrap and issuer authentication are R-B/R-D work. A caller can fabricate self-consistent supplied fields; R-A never elevates them to native facts or permission. Missing controller data blocks incomplete recovery, while exact completed records remain read-only inspectable.

Replay output is explicitly tagged `native-bar-recovery-replay-v5`, including missing-original diagnostics. It reuses v2 transition checks internally, but never labels a v5 completion as a v2 replay or changes the v2 completion contract. Single-link file proofs cannot alias each other, a target, the reserve or a bound root/parent directory. Planning applies the v2 attempt's native-clock bound at lease opening, not just the later inventory observation; an object changed after that bound blocks instead of producing an attempt that would fail prefix replay.

Marker evidence separates `{record, proof}`: only `record` is the timestamp's canonical on-disk body, and its separately supplied native proof hashes those bytes. The completion binds that proof and the exact attempt-specific path. This avoids a self-referential marker digest. Historical markers validate against their own event prefix and are not ignored or rewritten.

Capacity has separate logical inventory, maintenance metadata and physical occupancy totals. Retained publication temporary bytes count toward metadata, although their contents are never parsed, adopted or cleaned. Recovery accepts the same reserve proof with observed allocation at least its original acknowledgement; it charges the actual supplied allocation, never allocates again or uses it as credit. Empty entry counts with nonzero occupancy and underreported supplied totals refuse. The fixed extra headroom is still reserved when no publication remains.

Every R-A result has `execution_available:false` and `recovery_execution_available:false`; planning also reports `approval_authenticated:false`, `original_acknowledgement:not_proven` and explicit native/controller/approval blockers. `planned_only` is not an executable plan or a recovered grant. The module does not qualify elapsed age or offer purge. A malformed supplied bundle throws; an unavailable/contradictory fresh view blocks the whole set without partial actions.

Fresh descriptor evidence, live/unknown writer handling and exact self-coordination deltas, authenticated controller admission, single-use consent, actual clock/FD/read/allocation enforcement, immutable publication, sync acknowledgement and interruption execution are **not R-A**. No R-A output may bypass those later gates. Existing native reader/quarantine/history entry points remain unchanged and do not import this module. The pure tests simulate events only in memory; they do not create a v5 fixture or record/move/delete market data.

Verification on the final fixed R-A source (2026-10-24 JST): 125 dedicated tests passed, including all 56 one/two-target decision combinations, contradictory/malformed records, both recovery ordinals, retained markers/temporaries and quota boundaries. Standard `npm test` passed with 2,242 Node tests and two existing skips; Bookmap's five Java classes and two Node tests passed. Build and whitespace checks passed. No native fixture execution, UBSan rerun, real-data comparison, independent review, commit, deployment or MCP registration was performed. Dot remains PAUSED and both the full settings hash and trading/notification-condition hash match the pre-work values.

## R-A Commit Review

The 2026-10-24 self-review found one supplied-record chronology gap: a completed chain could place its data events before the original reserve-allocation acknowledgement. Two synthetic cases reproduced acceptance (acknowledgement during the event prefix and after completion). Every data event must now be at or after that acknowledgement. This is a consistency check over supplied records, not authentication of allocation or original admission; R-B remains responsible for those facts. An original with late allocation and no data event can still be inspected/planned after the acknowledgement.

Six added in-memory review cases cover that chronology, valid late preparation, the unchanged v2 nanosecond bound, native identity changes despite identical acknowledged bytes, and a consumed ordinal that has no published attempt envelope. No native code, existing schema, MCP registration, production refusal, Dot setting or trading/notification condition changed. The review is local self-review, not an independent review or a native/production qualification.

Final verification: 131 R-A tests passed; together with the unchanged v2 record model, 252 passed. The first standard run failed three existing wall-clock duration assertions under high machine load (forward-period backoff, Pine lexical audit, redaction); it is not counted as a pass. Without changing their code or thresholds, all 34 tests in those three files passed serially, and the identical complete unit suite passed with `--test-concurrency=2`: 2,248 passes, two existing skips, no failures. Bookmap's five Java classes and two Node tests passed separately. Build, whitespace, frozen-source hashes, Dot PAUSED and unchanged settings/condition hashes were verified before committing the six scoped files. Load-sensitive existing duration tests remain a test-environment caveat; no production or native-recovery qualification is claimed.
