# CP-U, Colon, Index Reflection And CP-V: Order Comparison
DESIGN_ONLY, approved 2026-11-04 JST; baselinecb847674519e78ee5a0e899a824ffab88c8e345f. Existing documents only. Dot PAUSED; judgment/notification/mail and operational limits unchanged. No implementation, parse/model/test, acquisition, MCP or activation grant.

## Sources, Terms And Authority
PR=[uniqueness/index prerequisites](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_UNIQUENESS_INDEX_PREREQUISITE_DESIGN.md), SHA-256 e91e72628125fcae35ba6885dcc9125fb577de0de592b5dcf731fbf1f517c9cd, 8028 bytes at baseline. Keep PR's corrected8092-byte KVS and inherited H/C/S/I bindings/precedence; S19-21 supersede C31. No clause is rebound.
CP-U/CP-V/Colon retain KVS meanings. Idx means bounded preparation, resumable movement and qualified final commit, not one indivisible call, new API or shift algorithm. A/B/C and PB0-PB4 below are documentary labels, not source aliases or adopted parser states.
B is ranked for further design, not executable adoption or true assignment to unresolved predicates. Layout, insertion, cursor/version and work costs stay OPEN; old documents/charges/statuses stay historical.

## Fixed Constraints For All Candidates
- CP-U must establish complete valid non-duplicate lookup for this candidate before colon/value parsing. Received bytes are not permission to parse ahead.
- Exclude current candidate from prior S0; insertion into S1 is not self-duplication. No repeated comparison credit, key reservation or insertion.
- n/q remain cumulative value-node/key reservations. CP-K already reserved the key; Idx adds no q/n. CP-V creates a distinct node/P->M mapping only after applicable guards.
- Container value starts, including arrays, require node+depth together; scalars add no container depth. Root remains object-only.
- Keep the same bound serial owner, grammar/operation states and finite normal/step/finish/cleanup budgets. No new timer, inputless-call exception, controller or allowance.
- Unconfirmed index/resource state grants no lookup/publication or rollback success. No completed-property/result publication just because an internal index commit occurred.

## Comparison
| Candidate | Order | Useful separation | Failure/proof liability |
|---|---|---|---|
| A | CP-U -> Idx -> Colon -> CP-V | Index dependencies can be settled before colon | Bad colon may follow index mutation; pending index/key resources and cleanup still need proof. |
| B | CP-U -> Colon -> Idx -> CP-V | Bad colon stops before index mutation; partial Idx has no new current-property node/map | Invalid value or CP-V refusal can still follow committed index work. Input ending after colon is a progress/state gate. |
| C | CP-U -> Colon -> CP-V -> Idx | Node guard may refuse before index mutation | Partial index work coexists with reserved node/map; coupled failure, visibility, publication and cleanup proofs are needed. |

A/C are not forbidden solely by existing text; each needs full dependency/evidence proof. C's early node guard and B's early colon check are tradeoffs, not measured speed/memory claims.
No outcome-driven ordering, suppressed refusal, scan-ahead error ranking or silent guard changes. Record spent costs/refusal points; do not erase them.

## First Detailed-Design Candidate: B
Prefer B to separate index work from node admission and stop bad colon before index mutation. This is a proof-structure preference, not a performance, acceptance-rate, signal or resource-fit claim.
B needs evidence for UniqueValid, DepsResolved(colon/value) and IndexCommitQualified at the appropriate boundaries. Failure to establish these leaves B OPEN; do not automatically switch to A/C.

| Phase | Entry evidence / action | Exit obligation |
|---|---|---|
| PB0: CP-U | Qualified non-duplicate outcome for same response/object/candidate/content/owner and bound S0/view-at-comparison | Preserve decision/progress identities; no colon/value processing from partial/unknown lookup. |
| PB1: Colon | Legal context, charged parsing and DepsResolved(colon); only legal whitespace/colon here | Establish colon without new q/n or speculative classification of a future value to pick an error. No premature Idx mutation. |
| PB2: Idx progress | Stable binding bridge, checked work/capacity/cleanup guards and qualified same-owner progress | Bounded/resumable preparation/shifts; preserve resource IDs, cursor/version and unconfirmed effects. No current-property CP-V/node/map yet. |
| PB3: index commit | IndexCommitQualified for candidate once: S0->S1 with required order/identity/visibility and failure treatment | Internal index settled, not finished property/result. q/n unchanged; the key can still be pending P. No self-duplicate/reinsert. |
| PB4: CP-V | Legal property-value start, qualified next-phase bridge/DepsResolved(value), all applicable guards | Distinct node, n+1, P->M once; q unchanged. Container node+depth commit together before construction/stack change. |

Bind colon recognition/consumption, progress writes and publication in a phase/cursor model; the table is no instruction schedule/atomicity proof. One final commit does not make all movement atomic/constant-time.
Historical S0 absence grants no current use. Bind S0->S1 to the same candidate/content and index view/epoch using PR's qualified bridge. Key-count k is not Kcand or a marker.
An index key before CP-V is still an unfinished property, not a value or next-key permission. Empty P after CP-V does not replace parent grammar.

## Input Boundary And Driver Gate
Existing I permits advance only in READY/YIELDED, admission in NEED_INPUT/WAIT_EOF with no pending input, and finish with drained input/explicit EOF plus completion/resource gates. R3/R4 role labels do not create a legal call.
If a delivery ends immediately after colon, prove when Idx progress is driven, when input exhaustion transitions occur, how yield preserves the pending phase, and what finish/admission may do. Do not invent advance in NEED_INPUT, hidden work, fake pending bytes, extra deliveries, an unbounded finish sweep or a nonterminal cleanupStep route.
Normal index work must fit the existing operation/driver envelope. Required owner lifetime, serialization, finite dispatch/progress and no-reset rules need evidence. Terminal cleanup cannot secretly perform normal parsing/index completion. Until this is shown, B is not executable.
Do not assume more input or switch candidates to hide this gate. Contract refinement needs separate approval.

## Failure Branches And Retained Obligations
| Boundary | Required handling |
|---|---|
| CP-U incomplete/duplicate/bad binding | No colon/value parse or optimistic uniqueness. Duplicate follows existing refusal; binding/protocol errors keep their distinct treatment. |
| Bad colon | No Idx mutation under B; keep prior key reservation/work. No fictitious node. |
| Idx guard refusal/partial shift | No CP-V or exposed qualified index. Keep owned resources/progress/unknown effects; no assumed stable old view or rollback success. |
| Unknown index commit outcome | Block blind reinsertion/recomparison. Later membership alone is no commit proof. Reconciliation requires separate design/approval. |
| Invalid value or CP-V guard failure after index commit | Keep key reservation and index effects/costs; no new failed-event node/depth/map, no automatic index removal/refund. Preserve last legal-prefix witness. |
| Later failure after CP-V | Keep cumulative node/key/map witness; live release does not refund. No partial result publication. |
| Cancel/owner loss | Existing serial cancellation/terminal gates; preserve unconfirmed ownership and resource liability. No restart, replacement owner or new budget. |

Same owner's qualified cleanup handles resources under existing reserves, not unknown-commit repair/retry. Clearing references/progress does not prove release.

## Required Evidence Before Selection/Qualification
Record source/version, candidate, phase/operation pre-state, binding/generation/view, guards/prospective counters, tuple, cursor/progress, live sets, success/refusal/error post-state and open proof.
Prove ordering-dependent ownership/lifetime and stable reads, once-only effects, partial-state visibility, no hidden normal/cleanup borrowing and all failure/publication branches. Count key text, old index, simultaneous movement temporaries, witness/control/carry and required parent root resources without double-counting aliases or omitting copies.
Unknown weights, layout, capacity overlap, release coefficients or driver facts are not zero. A comparison count or structural-validity bound proves no fit within Wn/Ws/Wf/Wc or real-time/heap limit. No new numeric runtime allowance is selected.
Document review: three orders, fixed constraints, B ranking, phases, input-after-colon gate, failure liabilities, no fallback. Paper cases (not run): duplicate, bad colon, delivery-end colon, Idx yield/unknown commit, invalid value, node/depth refusal, owner loss.
OPEN: movement/commit algorithm, marker/version/cursor, parent return/completion, visibility and finite cost/cleanup/host evidence. No coverage/preservation, A1-A3/A4-A7/E03/E05/E06 or host qualification closes.
Separate approval: independent review/result saving, strategy adoption, proofs/models/tests, parser-policy exception/adoption, implementation, new evidence, real operations, MCP/activation, commit/push.

## Approved Retention
Baseline C499708/U86180/unallocated69120; cap655360/guard352. Reserve16384 only from unallocated ->52736: design10240/review4096/integration1024/stop1024; before charges U102564. Prior reservations/charges stay; no donor transfer/refund/spare reuse.
First create DESIGN and BACKLOG/640K links only; parent growth uses this integration1024. REVIEW/STOP absent; review physical metadata1024/review1 1536/review2 1536 includes headings/links. Stop on section/file shortage; no truncation, borrowing, alternate log or expansion.
Charge D10077/L523; current C510308/U91964; cap655360/guard352/unallocated52736. Includes this line; no runtime grant.
