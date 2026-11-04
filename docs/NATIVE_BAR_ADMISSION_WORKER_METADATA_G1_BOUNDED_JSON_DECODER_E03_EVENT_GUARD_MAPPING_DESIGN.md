# Legal Events, Guard Boundaries And K0-K9 Mapping
DESIGN_ONLY, approved 2026-11-04 JST; baseline817df36764d50a1c71df91eb7a3f7f63376e625e. Existing documents only. Dot PAUSED; judgment/notification/mail and operational limits unchanged. No implementation, parse/model/test, acquisition, MCP or activation grant.

## Sources And Domain
E=[case schema](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_A1_A3_CASE_DESIGN.md), SHA-256 a9190f790c8e772177eaedd70540ac27ea29fdebc9a9a6fcb501cb0e2e6bdde5, 6132 bytes at baseline. Keep its atomicity/array-depth and non-alias fixes, not the earlier6049-byte body.
C/S/I inherit E's counter/supplement/input-state bindings/precedence. S19-21 supersede C31; no clause is rebound. n/q/M/P/O and invariant labels are proof notation, not source aliases or runtime facts.
Use E's fixed response/owner/domain: n/q cumulative committed value-node/key counts, M/P mapped/pending keys, injective f and open-object set O. D is live container-stack depth, including arrays; |O|<=D<=32, n<=16384. Witnesses survive live release; storage/cursors still need cost/ownership evidence.
Rows classify documentary events, not implementation states/APIs or a schedule; they prove no coverage/preservation.

## Guard Boundaries
| Layer | Required boundary | Failure rule |
|---|---|---|
| B0 | Bounded inert operation/state/binding/sequence/extent checks and finite owner dispatch charge (I, S19/S21) | Invalid/reentrant/raw/misbound calls preserve parser invariants; no grammar event/reset. |
| B1 | Reserve checked finite work before each valid-operation check/effect (S19) | Unknown primitive/budget blocks qualification; no free classification/scan-ahead. |
| B2 | Charged minimal grammar/context classification identifies the event (S19) | Invalid syntax reserves no fictitious node/key/depth. |
| B3 | Checked prospective counters and required ownership/capacity/cleanup/work guards (S20) | Only applicable guards; no scan-ahead ranking of future errors. |
| B4 | One tuple commit after all applicable guards pass (S20, C18/C30) | Deny without partial new tuple; keep prior commitments and spent work/observations. |

Order/dependency only; no cost qualification, callbacks/getters/coercion or host inspection. C31's superseded global order stays invalid.

## Event Correspondence
Apply B0-B4 where relevant; record grammar/lifecycle/admission/resource kind rather than treating every operation as grammar.
| ID / kind | Event and source | K mapping | Reservation / postcondition |
|---|---|---|---|
| G0 / context | Before first reservation; begin binding context (I, E K0) | K0 | n=q=0 before first reservation; account separately for any reservation inside begin. Not a parsing grant. |
| G1 / grammar | Quoted key start in object's key-expecting state (C19, S19-20) | K1 | Key/object and ownership/capacity/cleanup/work guards before construction; q/P grow once, no prior pending key there. |
| G2 / grammar | Key decode/unique-key comparison/legal colon (C20/C23, S25) | K6; failure K7 | No value node before uniqueness. Equal-value/escaped-alias duplicates refuse before colon/value parsing; retain key reservation. |
| G3 / grammar | Legal scalar property/array-element start (C17, S20) | K2 or K3 | Node/applicable guards; map key at reservation, not completion. Object root only. |
| G4 / grammar | Legal root/nested container start (C16-18, S20, E atomic note) | K2 or K3; K4 for object | Node+depth pass before either reservation/stack change. Resolve parent key with node. Arrays increase D, not O; K2/K3 array starts also check depth. |
| G5 / grammar-resource | Valid object close, no pending key (C16, E K5, S28) | K5; release boundary OPEN | Keep M/f/q and result key text/edges. Bounded normal-work index release precedes object completion; pop timing OPEN. |
| G6 / grammar | Valid array close/token continuation/syntax/whitespace without new reservation (C16/C23-30, E K6) | K6 | Array close pops D once, not O. Keep correspondence; append guards apply. No zero decode/storage/work claim. |
| G7 / refusal | Wrong-position syntax/duplicate/applicable guard failure (S19-20, C19-20/C30) | K7 | No new failed-event tuple; keep prior reservations. No overwrite/refund/post-terminal sibling. Key cap can fail before duplicate classification. |
| G8 / step-input | Input drained mid-token; yield/resume (I, C30, E K8) | K8 | Preserve position/phase/IDs; no replay. Intermediate incompleteness is not EOF failure. Carry/alias/work evidence required. |
| G9 / terminal-resource | Refusal/cancel/owner cleanup (I, S6-12/S43) | K9 | Freeze last legal-prefix correspondence; no new n/q or refund. Cleanup is not grammar; live depth0 cannot replace frozen bound. |

Prove any existing combined event's aggregate tuple/post-invariants; invent no separate observable steps. G4 covers root/array-element containers: depth failure cannot leave a new node committed. Existing caps/rules, not a favorable error order, decide applicability.
Record each legal phase/denial branch or missing case. Unknown fields/later-invalid tokens are not exempt.

## Operations And EOF: Separate From Grammar
acceptDelivery is admission, not K1/K2/K3. Require NEED_INPUT/WAIT_EOF, no pending input and numbered/bound extent checks (I/C12/S18-21). Qualified parent charges receipt once, including empty/rejected deliveries. Batch checks use the bound receipt after-total, not payment of the same delta twice. Applicable admission guards pass before retention/copy and one commit. Qualified-bound suitability refusal differs from invalid-handle contract error.
Input exhaustion chooses NEED_INPUT/WAIT_EOF from root completion; it is not EOF. Once root completes, only JSON whitespace is legal through the remaining delivery and later deliveries/yields; otherwise G7.
finish requires drained input and explicit EOF. Invalid/incomplete grammar/token/UTF-8/carry refuses then G9. Success needs complete object root, empty stack, no pending token/carry and existing release/receiver/handoff gates (I, C33, S29/S42-44). No replay or unqualified handoff.
Serial cancel is between nonterminal operations, not promised inside synchronous finish (S43). cleanupStep uses the same bound owner/driver and protected finite cleanup budget. Only authorized release records/live gauges change; terminal state, bindings and cumulative admissions stay fixed (S6-12). Unknown release/owner loss blocks, not retry/rebinding.

## Open Evidence And Acceptance
Record source/version, legal pre-state, kind, classifier result, guards/prospective counters, atomic tuple, M/P/O/f/D changes, success/refusal/error post-state, argument and open premises.
Token-specific grammar states/decision rules, actual atomic grouping, close-delimiter/index-release/pop/completion timing, cursors and finite primitive/dispatch/capacity/cleanup facts remain OPEN. G5 cannot hide pending release or remove result-owned keys.
Acceptance: precedence, K0-K9 references, grammar/admission/resource separation, node+depth atomicity, pending owner, incomplete-input/EOF and explicit gaps. No A1-A3/A4/A5-A7/E03/E05/E06 or host closure.
Separate approval: review/result saving, proofs/models/tests, parser-policy exception/adoption, implementation, new evidence, real operations, MCP/activation, commit/push.

## Approved Retention
Baseline C470264/U72616/unallocated112128 includes prior83-byte case fix and297-byte integration at817df36; no repeated charge. Cap655360/guard352 and prior reservations/charges stay.
Reserve14336 from unallocated only ->97792: design8192/review4096/integration1024/stop1024; before charges U86952. No donor transfer, refund, old spare reuse or runtime allowance.
Create DESIGN and BACKLOG/640K links only; parent growth uses this integration1024. REVIEW/STOP absent; review physical metadata1024/R1 1536/R2 1536 includes headings/links. Stop on section/file shortage; no truncation, borrowing, alternate log or expansion.
Charge D8050/L516; current C478830/U78386; cap655360/guard352/unallocated97792. Includes this line; no runtime grant.
