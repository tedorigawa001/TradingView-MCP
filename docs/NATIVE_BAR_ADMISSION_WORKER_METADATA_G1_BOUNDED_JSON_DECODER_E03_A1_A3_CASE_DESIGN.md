# A1-A3 Preservation Case-Table Design
DESIGN_ONLY, approved 2026-11-04 JST; baselinede70ec49786d5351ae6982acbf2b75bb04dab2cb. Existing documents only. Dot PAUSED; judgment/notification/mail and operational limits unchanged. No implementation, model/test, acquisition, MCP or activation grant.

## Binding And Proof Domain
[Parent](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_PRESERVATION_DESIGN.md) SHA-256: 4af7841d441fcaa2897bf729a8ccd864f38101c39c9cabee45826e98cc8c0bed. Keep its source bindings/precedence; C/S are inherited counter/supplement aliases. S19-21 supersede C31; no old clause is rebound.
One response/owner/domain, all serial event prefixes. n/q are cumulative committed value-node/key reservations, not allocations or completed tokens. M/P are mapped/pending reserved keys; M/P/O/I1-I4 here are not source aliases. Pending means its property-value node is unreserved; unreserved token bytes are not q.
Injective f:M->V targets committed logical value-node IDs; |V|=n. M/P partition q keys. Each pending key belongs to its open object; O is the open-object set, |O|<=Dcap=32. Ncap=16384. Contents/aliases never merge IDs. These are proof witnesses, not runtime registries or free storage.
Conditional schema, not a completed proof/test. Keep C17/C19 reservation points, grammar eligibility and guards. Root must be an object (C17).

## Case Record And Common Invariants
Case fields: source/version, response/owner, legal pre-state, event/guards, delta n/q, M/P/O/f changes, post-state, argument, open premises. Include denial/terminal branches; missing fields block closure.
Invariant I1: q=|M|+|P|, disjoint M/P. I2: f is injective into V. I3: at most one P key per open object, none for a legally closed object. I4: |O|<=Dcap and n<=Ncap under the inherited guards.
A1 allows only legal serial grammar events to commit growth. Invalid calls/denied events add no new structural tuple; prior commitments remain. A2 forbids overwrite, recovery, terminal grammar resume and reservation replay. A3 forbids a new key while the previous key lacks its value node; grammar legality imposes any further restrictions.
Zero structural delta is not zero receipt/admission, decode, live storage or work; their ledgers/rules stay unchanged.

## Cases To Establish, Not Execute
| ID | Legal precondition / event | Structural change | Preservation obligation |
|---|---|---|---|
| K0 | Before the first reservation | n=q=0; M/P/V/O empty | Initial I1-I4; cover any reservation inside begin. |
| K1 | Legal quoted key start; no pending key in this object; all guards pass | q+1; add new key to P | P count there goes0->1; M/f/n unchanged; no speculative sibling. |
| K2 | Legal property-value start; its key in P; all guards pass | n+1; add distinct v to V; move key P->M; set f(key)=v | q unchanged; fresh v preserves injection. Map at node reservation, not completion. |
| K3 | Legal root or array-element value start; guards pass | n+1; fresh v in V; no invented key | M/P/f/q unchanged; count the node. |
| K4 | Legal object descent after required node reservation; depth guard passes | Add new object to O with no pending key | Keep ancestor correspondence; K2 accounts for a pending parent key's node commit. |
| K5 | Legal object close; no pending key there | Remove object from O | No P key lost; retain historical M/f/q despite live release. |
| K6 | Legal scalar/array progress or syntax event without new reservations | No new n/q; retain required correspondence | Cover continuation/array close/whitespace; their work is not free. |
| K7 | Duplicate/malformed input or denied node/key/depth guard | No new tuple; keep prior commitments | Keep last legal-prefix partition. An existing key may stay pending; no overwrite, synthetic node, refund or post-terminal sibling. |
| K8 | Delivery boundary in key/value; yield/resume | No reservation/mapping replay | Intermediate incompleteness is not failure. At explicit EOF, invalid/incomplete grammar follows existing failure rules/K7. Keep progress/IDs. |
| K9 | Refusal/cancel/cleanup after a legal prefix | Freeze witnesses; no new n/q or refund | No grammar restart. Shrinking live storage/depth does not change the frozen cumulative witness. |

Prove any existing combined atomic event's aggregate tuple/post-invariants; invent no separate steps or observable intermediate states. Cover root/nested objects/arrays, unknown fields, duplicate/later-invalid reservations, all grammar phases and denial boundaries. Rows do not prove complete coverage. K2-K4 permit no partial node commit when that same event's depth/other guard fails. K2/K3 array starts also pass depth.

## Conditional Result And Stop Conditions
Given K0 and preservation for every applicable event/branch, induction gives q=|M|+|P|<=n+|O|<=n+Dcap<=16416 while parsing. At termination use the frozen witness and constant Dcap. Cleanup does not reset cumulative n/q or fund the next response.
Unknown commit/guard boundary, non-unique node, unidentified pending owner, mismatch/cycle in sources or missing transition leaves the affected case OPEN. No capacity calculation proves injection. No A4 edge/index family inherits this proof; A4/A5-A7, E03/E05/E06, layout, work and host facts remain separate obligations.
Review schema/source/boundary consistency only. Completed proofs, models/tests, implementation, parser-policy exception/adoption, evidence acquisition, real operations, MCP/production need separate approval.

## Approved Retention
Baseline C463368/U68248/unallocated123392; cap655360/guard352. Reserve11264 from unallocated only ->112128: design6144/review3072/integration1024/stop1024. Before charges U79512. No old-reserve transfer or historic refund.
First create DESIGN and BACKLOG/640K links only. All parent growth uses this integration1024; old sections/charges stay frozen. REVIEW/STOP absent; review physical metadata1024/R1 1024/R2 1024 includes all headings/links. Stop on section/file shortage, never truncate, borrow or silently expand.
Charge D6132/L764; current C470264/U72616; cap655360/guard352/unallocated112128. Includes this line; no runtime grant.
