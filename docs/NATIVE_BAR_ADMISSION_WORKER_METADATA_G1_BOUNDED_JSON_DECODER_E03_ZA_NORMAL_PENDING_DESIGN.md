# Z-A: Normal-Pending Subphase And Exhaustion Transition Contract
DESIGN_ONLY, approved 2026-11-04 JST; baseline43de8a48244ba1f4a3a0ed1e721076a827a114f4. Existing documents only; Dot PAUSED; judgment/notification/mail and operational limits unchanged. No implementation, parse/model/test, acquisition, MCP or activation grant.

## Sources At The Baseline Commit
All byte counts and SHA-256 pins below refer to that commit, not later linked bodies.
| Alias | Baseline source | Bytes; SHA-256 |
|---|---|---|
| ROUTE | [document](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_INPUT_EXHAUSTION_ROUTE_DESIGN.md) | 12271; c5c4acca325d362072c9b7ed3a3b115a4f60ec419a0a1b8c8201ce344cbc2b8b |
| CONS | [document](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_WRITE_CURSOR_COMMIT_DESIGN.md) | 10181; c4b29d6c8d1b6ca48cc673df461d7c2a37fbfa1df6506621cf00da53fcf715ff |
| I | [document](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_INPUT_STATE_DESIGN.md) | 3088; 5932f463539f906def32b57927980ecfbfdcb7eaacb9e6d102b2f26141df7601 |
| OWN | [document](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_OWNERSHIP_DESIGN.md) | 10862; c86285c490cb039907f182ea6c0b734b87664bbdfb94b0b9885a86fd0293f90a |
| S | [document](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_RECONCILIATION_DESIGN.md) | 15156; 7613f70b51e0cbd0ea43cbec7357601c3f35159993b34eae0ae3570b249e70cb |
| G | [document](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_EVENT_GUARD_MAPPING_DESIGN.md) | 8050; 1ab693e4d1cd6fd08286279bbe5e498fb2238b574522a08a03e9a278f5889932 |
| CW | [document](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_CAPACITY_WORK_DESIGN.md) | 11951; e5de4167c2a8fbef79175cf230d63b5a3a30b85093d3468c1836a35b0daae9c5 |
| BR | [document](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_COLON_INPUT_BOUNDARY_REVIEW.md) | 3904; fd40d53bc3667756ee822405d845d9749ba04f7e448e3aa6a3c918c202cf971c |

Keep RT/PR/BND/ORD/KVS bindings/precedence; S19-21 supersede C31. CONS10181 states necessary completion/bridge, not sufficient CP-V authority or remaining-byte evidence.
ROUTE12271 ranks Z by single-route scope only. W(key-close/post-colon)+H(close) remains uncompared, not fallback. Z-A neither excludes it nor proves Z better.
No source clause replaced. Future Z refinements below need separate adoption/route approval and proof. Historical bodies/reviews/pins/charges stay frozen.

## Scope And Auxiliary Label
Z_NORMAL_PENDING is proposed auxiliary evidence inside qualified PARSE_READY, not public state/flag/API/capability/registry/scheduler/owner. No Idx permission from its name.
Z-A covers one bound Z-task continuation and RELEASE_INPUT entry/exit. No host layout/primitive/root-close sequence/route/profile selected.
Before-release settlement is Z-conditional, not W/H/F/composite policy. Distinguish byte end, route-enabled work, release and state readiness. Refusal follows terminal rules.

## Evidence Categories, Not New Parser States
| Category | Proof obligation |
|---|---|
| Known Z-enabled action | Qualified Z/grammar/phase identifies required work runnable without future bytes; bind next effect/progress. |
| Known future-byte dependency | Grammar/token needs actual bytes and no Z-enabled task is pending; qualify carry/release, not fabricated completion. |
| Completed action / no enabled work | Effects/current view/resources are acknowledged; next grammar may still need bytes or EOF. |
| Unknown/unsuitable evidence | Eligibility/effect/owner/view/cost/exit is uncertain; existing refusal/block, not guessed waiting/no work. |

Not an exhaustive enum/API. Completed work may coexist with next-input dependency; unknown eligibility is not a known wait.
Examples: qualified completed-key lookup, B's post-consumed-colon Idx, or normal close retirement with separate legal-close witnesses. Z-A supplies no Z-B witness.
Partial UTF-8/escape/key/value needs real input. Existing bounded owned carry promotion grants no decoded credit, node/key or delimiter.

## Continuation Admission
Require all:
- Existing serial advance in READY/YIELDED plus separately qualified Z phase; state alone is insufficient.
- Completed COPY_PENDING/RELEASE_SOURCE under OWN; no bypassed lease/copy uncertainty.
- Fixed response/source/purpose/attempt/profile, same owner/object/key generations, numbered delivery/extent/exact position.
- Qualified key/content/view/decision/rank or close context, stable owned data and CONS known prefix.
- Bound next action, finite primitive/work/dispatch, capacity/cleanup and original parent envelope; all grammar/phase guards remain.

Use inert qualified metadata, not caller flags/getters/proxies/hash equality/host probes. Unknown blocks.
No future-value scan for error ranking. CP-U, Idx, CP-V, value completion and next-key permission differ. Ordinary grammar with real bytes keeps its original growth/guard rules.
The label/continuation/release/bookkeeping creates no q/n reservation or close/pop authority. Z-B and original guards remain; stored proof/control records and accesses cost resources.

## Conditional Transition Table
Supplemental obligations only, not current executable permission.
| ID / condition | Candidate action | Required restriction |
|---|---|---|
| ZA0: COPY_PENDING/RELEASE_SOURCE | Continue that operation under OWN | No grammar/Idx before copy/source-release/private-input qualification. |
| ZA1: PARSE_READY, bytes remain | Bound normal task first where ordering requires; otherwise guarded grammar/tail | No general ban on legal growth, speculative next-byte event or repeated credit. |
| ZA2: exact end, Z-enabled task | Keep consumed position/input ownership/pending binding; qualified advance | No invented bytes, premature release/NEED_INPUT or new fuel. |
| ZA3: last-byte effect exhausts fuel | Preserve known effect/cursor/classification at justified YIELDED | No assumed follow-up completion, replay or inferred release. |
| ZA4: exact end, known wait/settled context | Qualify owned carry/key/decision and release entry | Unknown is not this row; no forced future-byte completion/fictitious node. |
| ZA5: RELEASE_INPUT pending | Same-owner normal-budget release/bookkeeping only | No Idx/grammar/repair or unconfirmed exit. |
| ZA6: released, state commit pending | Finalize only the same release acknowledgement/control operation | No double release, freed-backing reads, normal work or early admission. |
| ZA7: qualified exit tuple | Known valid incomplete context -> NEED_INPUT; known complete root/all gates -> WAIT_EOF | No unknown-as-incomplete, implied EOF/DONE/root proof/publication. |
| ZA8: error/failure/cancel/unknown | Original contract-error/refusal/cancel/owner-block distinction | No new parser state/retry/rollback/rebinding/budget/controller. |

Only the bound task progresses. Completion may enable another no-byte action or genuine waiting; reclassify with charged guards, not blind looping.
Zero consumption is work; input and work cursors differ. Preserve received/admitted/cumulative and parent charges. A fresh step refills no total normal/cleanup/parent allowance.
Indivisible work exceeding a whole step rejects the profile before effects; if it fits fresh but not remaining fuel, yield first. Prove positive finite progress and dispatch/call bounds, not merely slots or Wn/Ws.
Prove the pre-bound same owner's/driver's lifetime and explicit lawful continuations within its parent envelope. No timer, hidden loop, synchronous preemption or elapsed-completion promise.

## RELEASE_INPUT Entry Contract
On the nonterminal Z path require the same admitted delivery at exact end, no Z-enabled task/unresolved normal effect, and a known wait/settled context. Future-input dependency cannot conceal runnable work.
Under S45/OWN, preserve needed fragments/keys/decisions/progress in independently owned bounded storage before input release. Borrowed private/source views, substrings or assumed rope copies are no ownership proof.
Qualify stable backing/aliases and every carry/copy/control cost before release; producer retention elsewhere remains root-accounted after lease release.
Bind exact-once allocation/generation/release cursor, cleanup liability, control records, normal/step work and same owner. Preparation is not release and cannot reduce live gauges early.
Yield entry preparation only with known progress/stable data under its qualified phase. Unknown outcomes follow refusal/resource blocks, not guessed promotion.
After entering RELEASE_INPUT, continuations are release/acknowledgement only. No backtracking into normal work as repair; later input/phase requires legitimate admission.

## RELEASE_INPUT Exit And Public Transition
Confirm the same input's logical release and required decoder input-view obligations. Dropping references/bits proves no GC/erasure/transport settlement.
Keep independently owned bounded control/cursor evidence after backing release. No freed-input reconstruction. Alias/acknowledgement/cost updates need CONS-like known effect/progress qualification.
Known release with state commit pending permits only finite finalization of that release in a qualified existing READY/YIELDED context. This phase correspondence/atomicity/failure behavior needs proof, not assumed permission.
Before exit prove coherent same-delivery release/cursor/position/owner/work and valid saved grammar/root/tail/stack/token/carry witnesses, not a caller boolean.
NEED_INPUT requires known valid incompleteness, owned carry and no Z-enabled task. WAIT_EOF requires known complete object root and all resource/stack/token/carry gates. Unknown completion is not incomplete by default.
Z-B still owes close classification/consumption/retirement/pop/value-completion/parent return. Z-A creates no root witness or delayed tail latch: I16 applies immediately at root completion.
Real remaining bytes still need original grammar/tail processing; do not drop them via early release. Entry requires exact end, not a hidden whitespace sweep/unconsumed-data finish.
Qualify release/state finalization once with known effects/costs. Unknown outcome permits no repeat release, membership test or guessed cursor. Full admission preconditions precede next delivery.
WAIT_EOF is not DONE. Finish retains explicit EOF/state/root/stack/carry/release/receiver/single-handoff gates; no decoder cleanup deferred past successful handoff.

## Error, Cancellation And Owner Boundaries
Invalid/out-of-order/raw/misbound/reentrant calls preserve state/bindings/owned input/position; charge finite owner checks/dispatch. Invalid finish is not valid EOF refusal.
Live failure and failed/unknown/exhausted release or lost owner/progress retain OWN27 REFUSED/resource obligations where applicable. Owner loss grants no replacement mutation; keep evidence/root blocks.
Cancel stays serial between nonterminal operations, not effect/finish preemption. Terminal work is original same-owner protected qualified release, never Z completion/grammar/re-entry for parsing.
Unknown effects/cursor/release/commit prove neither completed nor untouched/retryable. Historical prefix is no current snapshot; no rescan/reinsert/rollback/journal/recovery.
Separate producer/result root retention, logical release, GC and transport settlement; no refund/false free.

## Boundary Cases To Establish
| Case | Required handling / evidence |
|---|---|
| Last-byte/fuel key quote | Preserve complete-key/CP-U phase; no colon/value before outcome or repeated credit. |
| Last-byte/fuel B colon | Colon remains consumed; no CP-V without actual legal value/all guards. |
| Partial token | Genuine input dependency, bounded owned carry; no synthetic completion or waiting for nonexistent work. |
| Empty delivery | Normal receipt/admission/READY; bounded bookkeeping/release/exhaustion, no Idx pulse/direct shortcut. |
| Post-colon whitespace | Distinguish Idx settled/pending from absent value; no repeat commit/value/root fabrication. |
| Nested/root/empty close | Separate Z-B close/pop/root/tail proof; no future-delivery reliance for root; zero entries still cost control. |
| Last release effect/ack yield | Known exact prefix, release-only continuation, no double release/Idx. |
| Zero-byte READY/YIELDED finish | State-preserving error, not hidden EOF permission/buffering job. |
| Legal drained incomplete EOF | Refusal, not index sweep; keep cumulative counts/liabilities. |
| WAIT_EOF/trailing input/success | Tail-only and full finish/receiver/handoff gates; no implied EOF/second transfer. |
| Failure/cancel/owner loss/unknown | Original distinctions/resource blocks, no extra owner/fuel/retry. |

Paper cases, none run. Parent transport-EOF notification/dispatch/lifetime needs evidence; no queue/callback added.
Per case retain source version, operation/pre-state/phase, byte/work cursor, eligibility, owner/live set, guards, effects/charges, post-state/invariants and gaps.

## Source-Clause Refinement Map
| Source boundary | Conditional Z-A refinement / retained restriction |
|---|---|
| I7-9 | Keep admission/advance/finish names/state gates; qualify Z phase separately. No admission/finish with pending input/resource work. |
| I15-19 | For Z distinguish byte end, normal completion and release before exhaustion commit; immediate tail/terminal rules remain. |
| OWN20-28 | Auxiliary evidence inside qualified PARSE_READY, not authority derived from zero-byte release. RELEASE_INPUT remains release-only. |
| S6-12/24-29/42-45 | Original owner/budgets, normal-versus-cleanup separation; Z-B close and one-step finish gates stay open. |
| G events/close/root/EOF; CONS | Keep guards/counts/known effects. State bookkeeping proves no close semantics or sufficient value admission. |
| BND CB0/3/6/7/11; BR | Future no-byte phase/EOF-error/live-release post-state correction needs explicit scope; no blanket real-input rule/replacement now. |

Future adoption must name superseded sentences, dependencies and approval. All source bodies stay unchanged here.
W(key-close/post-colon)+H(close) remains uncompared. Z-A proves no composite failure and forces no other route's work before release; no automatic hybrid/fallback or B-order change.

## Capacity, Work And Open Gates
Count consumed input with keys/results/indexes, prepared values, classification/cursor/view/ack/control, carry/pending-close and aliases/headers. Full shared backing once, copies/view metadata/operations separately.
Normal progress/carry/release/finalization use normal work; finish only its qualified reserve inside normal work; terminal release original protected cleanup. No free coefficient/allocation/dispatch.
Before effects qualify finite unit/step/normal/capacity/cleanup and parent envelope; include failed checks/continuations. No total reset/refund or parent/next-response borrowing.
OPEN: host layout/primitives/aliases, effect/control/exit atomicity, finite progress/dispatch/lifetime; Z-B close/root; Z-C full live-set/work proof; W+H comparison/route choice.
A1-A3/A4-A7/E03/E05/E06/preservation/host remain OPEN. Labels/paper correspondence prove no executable profile or acceptance guarantee.
Separate approval: independent review/result saving, route/strategy/B/source adoption, proofs/models/tests, policy waiver, implementation, evidence, operations, MCP/activation, commit/push.

## Approved Retention
Baseline C576697/U119783/unallocated89600; cap786432/guard352. Reserve24576 only from unallocated ->65024: design16384/review6144/integration1024/stop1024; before charges U144359.
Keep old reservations/charges, ROUTE's266/280 fix and design17/integration135. No transfer/refund/spare reuse.
Create DESIGN and BACKLOG/current768K-ledger links only; positive parent growth charges this integration1024. REVIEW/STOP absent; physical review metadata1024/review1 2560/review2 2560 includes headings/links. Shortage stops; no truncation, borrowing, alternate log or expansion.
Charge D16067/L621; current C593385/U127671; cap786432/guard352/unallocated65024. Includes this line; no runtime grant.
