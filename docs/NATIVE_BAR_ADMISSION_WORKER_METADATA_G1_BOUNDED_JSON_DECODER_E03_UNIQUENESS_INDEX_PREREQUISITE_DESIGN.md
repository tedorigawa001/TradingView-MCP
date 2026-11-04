# Uniqueness Decision Binding, Lifetime And Index Prerequisites
DESIGN_ONLY, approved 2026-11-04 JST; baseline03ca061b693b00fa5e861d73af625849f0fb2476. Existing documents only. Dot PAUSED; judgment/notification/mail and operational limits unchanged. No implementation, parse/model/test, acquisition, MCP or activation grant.

## Source And Status
KVS=[key/value state design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_KEY_VALUE_STATE_DESIGN.md), SHA-256 9d5a07e4bdc398591e99b7ef6074a336489c10df3f4c01ff29c454c0436d75fa, 8092 bytes at baseline. Keep its review-cap naming fix/source chain, not earlier8076-byte body. H/C/S/I retain bindings/precedence; S19-21 supersede C31.
CP-U binding/lifetime and index prerequisites only. No insertion ordering, shift algorithm, layout, version field or cursor selected. Names are evidence predicates, not adopted flags/APIs/capabilities/registries; caller assertions do not satisfy them.

## Domain And Required Binding
Keep CP-K/U/V's response/source/purpose/attempt/profile, bound owner and object/candidate. n/q are cumulative value-node/key reservations; this key is already reserved. Identity alone proves no stable content/ownership. Kcand is decoded candidate content, not inherited key-count k or a slot ID.
| ID | Required binding / evidence | Missing or changed fact |
|---|---|---|
| UB01 | Response/source/purpose/attempt/profile and the same resource owner/generation | No cross-response reuse, fresh owner or budget. |
| UB02 | Object identity/generation and current admitted key-reservation identity | Equal key bytes do not identify the object/slot. |
| UB03 | Complete valid decoded key content, identity and proved stability/lifetime | Identity/hash alone cannot prove unchanged bytes or a valid lease. |
| UB04 | Prior semantic key set S0 of this object, excluding the current candidate | No comparison against self or another object's keys. |
| UB05 | Lookup view/order/identity and resumable interval/offset at comparison | Same membership does not prove stable search across yields. |
| UB06 | Completed duplicate/non-duplicate outcome and progress evidence under existing lookup rules | Partial/unknown comparison is not non-duplicate. |
| UB07 | Ownership, retention and finite work/capacity/cleanup for the evidence | No free witness storage, guessed host fact or unconfirmed release. |

Requirements, not observations. Representation/versioning/stable reads remain OPEN. IDs, caller numbers or content hashes do not authenticate themselves.

## Three Separate Assertions
1. Under UB01-UB07, completed non-duplicate lookup establishes Kcand absent from bound S0. Duplicates refuse before colon/value parsing; no overwrite/current property's node. Decision adds no q/n.
2. Qualified insertion proves S0->S1=S0 union {Kcand}, this candidate once, preserving other keys and required order/identity/visibility. Relation to prove, not an implemented commit.
3. Later use needs qualified state/ownership/dependencies. Historical absence in S0 grants no current-index search/mutation/publication.

Kcand in S1 due to this insertion is not a self-duplicate or reason to insert/reserve again. Distinguish this candidate's S0->S1 effect from unrelated membership.
Index publication adds no key/node reservation. CP-K's q and CP-V's node/P->M meanings stay. Index reflection, node admission and value publication are distinct.

## Logical Lifetime, Not Clock Expiry
No TTL, real clock/timer or periodic revalidation. Use-validity needs proved bindings/content, snapshot/view-at-comparison, completed outcome and ownership.
Across yield/delivery/copy keep identity/progress without repeated credit/completed comparisons. Serial driving does not prove stable key/index backing. Unknown content/generation/view/owner/outcome blocks reuse, not optimistic uniqueness.
Physical change need not falsify historical S0 absence; it grants no changed-view operation. Prove a bridge to the selected next phase, not transplant to another index/response/attempt.
Terminal refusal/cancel/owner loss blocks grammar. Keep cumulative charges/legal-prefix witness and unconfirmed ownership until qualified release. History is no live capability; no automatic recompare/retry/new controller/budget.

## Dependency Gates Before Later Work
| Predicate | Required evidence | What it does not grant |
|---|---|---|
| UniqueValid | Completed non-duplicate result bound to candidate/content/S0 and view-at-comparison; qualified ownership/lifetime | Not a caller boolean, insertion completion or current-index search permission. |
| DepsResolved(colon) | Proved index/phase/visibility, ownership and finite-work dependencies for colon | Does not pick insertion before/after colon or permit unresolved dependencies. |
| DepsResolved(value) | Proved value-admission dependencies and all applicable guards; node+depth together for containers | No node/map on a failed guard; no publication merely because CP-U succeeded. |
| IndexCommitQualified | Proved membership/order/identity/visibility atomicity, once-only candidate effect and pending-resource/failure treatment | Not a rollback claim or a completed physical insertion. |

Next events need UniqueValid plus their dependency proof, not CP-U alone. Keep grammar eligibility/H B0-B4; no premature parse or partial structural tuple.
No insertion-first rule: order versus colon/node admission stays OPEN. Predicates cannot be declared true; the chosen strategy needs separate design/evidence. No R3-R5 execution while that relationship is unresolved.

## Partial Reflection And Unknown Outcomes
Partial shift/publication proves no stable S0/restored order. Keep resource identities/progress/unconfirmed effects. No qualified view, parse/publication with unresolved dependencies or inferred rollback success.
Unknown commit blocks blind reinsertion/recomparison. Later membership alone cannot identify this candidate's commit versus stale/other state. Reconciliation needs separate design/approval/evidence; none here.
Do not hide failure/owner loss by clearing pending resources or claiming release. Only the same owner's qualified cleanup under existing budgets; no restart/repair/new worker/job/controller/allowance.
Reads/checks/compare/shift/metadata/dispatch/confirmation, witness storage/release need finite charges. No primitive costs/layout or real-time/heap guarantee selected.

## Acceptance And Remaining Evidence
Document review checks UB01-UB07, current-candidate exclusion, S0/S1 distinction, historical truth vs current permission, logical lifetime, no duplicate reservation/replay, dependency gates and explicit unresolved ordering.
Cases (not run): same bytes/different object or attempt; candidate/text generation change; changed order/same membership; partial compare/shift; own key in S1; unknown commit; cancel/owner loss.
OPEN: binding/stable reads, decision lifetime, insertion/visibility/commit point, cursor/carry, reconciliation, finite normal/step/finish/cleanup/dispatch costs and owner lifetime. No coverage/preservation, A1-A3/A4-A7/E03/E05/E06 or host gate closes.
Separate approval: independent review/result saving, proofs/models/tests, parser-policy exception/adoption, implementation, new evidence, real operations, MCP/activation, commit/push.

## Approved Retention
Baseline C491129/U80423/unallocated83456 includes prior16-byte KVS fix and290-byte integration at03ca061; no repeated charge. Cap655360/guard352 and prior reservations/charges stay.
Reserve14336 only from unallocated ->69120: design8192/review4096/integration1024/stop1024; before charges U94759. No donor transfer/refund/spare reuse.
First create DESIGN and BACKLOG/640K links only; parent growth uses this integration1024. REVIEW/STOP absent; review physical metadata1024/review1 1536/review2 1536 includes headings/links. Stop on section/file shortage; no truncation, borrowing, alternate log or expansion.
Charge D8028/L551; current C499708/U86180; cap655360/guard352/unallocated69120. Includes this line; no runtime grant.
