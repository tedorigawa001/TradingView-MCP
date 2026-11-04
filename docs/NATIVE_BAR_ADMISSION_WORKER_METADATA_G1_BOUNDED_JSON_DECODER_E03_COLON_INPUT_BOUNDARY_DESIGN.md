# B Candidate: End-of-Delivery Colon And Pending Index Phase
DESIGN_ONLY, approved 2026-11-04 JST; baselinecfadff3a09c2f7281f926810e48c35c2a0b3d456. Existing documents only. Dot PAUSED; judgment/notification/mail and operational limits unchanged. No implementation, parse/model/test, acquisition, MCP or activation grant.

## Source And Limited Scope
ORD=[order comparison](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_INDEX_ORDER_SELECTION_DESIGN.md), SHA-256 a941e4473048f67f9337480bb3370d33a6a6217a001738d222d90ddfcda1bebf, 10236 bytes at baseline. Keep its expanded boundary gate, PB4 whitespace, reference-target/edge-timing OPEN and non-alias fixes, not earlier10077-byte body.
Keep ORD's PR/KVS/H/C/S/I bindings/precedence; S19-21 supersede C31. Start after qualified CP-U and legally consumed colon for one pending key. Key-close lookup, object-close release and A/C boundaries stay OPEN.
B remains a design candidate, not executable adoption. No new API/state exception/timer/hidden continuation/controller/delivery. Correspondence needs proof.

## Two Orthogonal Descriptions
Existing READY/YIELDED, NEED_INPUT, WAIT_EOF, REFUSED/CANCELLED/DONE keep I's meanings. IdxPending/IdxDone are phase labels, not parser states/aliases/implemented flags.
IdxPending: index completion unconfirmed; keep progress/resources. Here colon is consumed, input drained, no CP-V: n unchanged, existing q/key/P retained.
IdxDone: qualified internal commit/bridge, not property/result completion or next-key permission. PR's historical S0/S1 claim grants no current-view operation.
Input exhaustion and resource completion are distinct. NEED_INPUT/no pending input never means key/index/control resources are released. Root is incomplete while this property has no value, so do not manufacture WAIT_EOF.

## Entry And Exhaustion Boundary
Within a permitted operation, consume colon under grammar/work/guards and record exact position. Drained means zero remaining bytes, not a retained colon/dummy suffix.
NEED_INPUT requires existing qualified exhaustion/release with no pending input. Before input release, needed key/carry/decision references need owned stable lifetimes (S45). Raw views/substrings or earlier lookup are no copy proof.
Do not hide unconfirmed input/alias/carry/owner obligations to admit more data. Colon/cursor/phase/release/state timing needs proof, not prescribed code.
No normal Idx in NEED_INPUT. Wait for a legitimate operation, never assume/manufacture it. Later real nonempty input can provide READY/advance context only after admission and ownership/copy gates.

## Operation/Phase Correspondence
Conditional rows, not executions or a full proof.
| ID | Situation / valid operation | Existing state and phase | Obligations / outcome |
|---|---|---|---|
| CB0 | Consumed colon ends delivery | NEED_INPUT + IdxPending after qualified exhaustion boundary | No CP-V/node/map; keep existing key, decision and resource liability. No normal index continuation here. |
| CB1 | No next legitimate external operation | Remain waiting, with retained pending phase | No automatic work/completion, scheduled loop, fabricated delivery or claim of finite wait/lease lifetime. |
| CB2 | Numbered/bound nonempty delivery passes existing acceptDelivery gates | NEED_INPUT -> READY; IdxPending remains | Receipt/admission charged once. Ownership/copy/retention phase must qualify before parse/index work; n/q do not reset. |
| CB3 | Existing advance admitted with real unconsumed input and required phase evidence | READY/YIELDED + IdxPending | Bounded index progress before parsing value bytes; keep actual input unconsumed and preserve identities/cursors/charges across yield. |
| CB4 | Qualified index commit/bridge completes | Existing READY/YIELDED + IdxDone | No new q/n from Idx. Only then classify legal value start and apply CP-V/guards; no result publication or self-duplicate. |
| CB5 | After IdxDone, delivery contains only legal post-colon whitespace | Qualified exhaustion -> NEED_INPUT + IdxDone | No value/node yet; root remains incomplete. A later value still needs CP-V; do not repeat Idx. |
| CB6 | Legitimate empty delivery | Existing acceptDelivery behavior reaches READY, then existing exhaustion handling | Count empty delivery/body normally; no Idx pulse. Do not invent a direct admission->NEED_INPUT shortcut or synthetic callbacks. |
| CB7 | Drained input, NEED_INPUT, valid finish with explicit EOF but missing/incomplete value | Existing REFUSED; phase/resources frozen for qualified cleanup | Do not complete normal Idx in finish or sweep unbounded work. No fictitious value node, refund or output. |
| CB8 | finish offered in READY/YIELDED or with pending input | Existing contract error; state/phase/input/position preserved | No skipped bytes, implied EOF, parser reset or use of new dispatch budgets. |
| CB9 | Serial cancel admitted between nonterminal operations | Existing CANCELLED | Freeze cumulative/witness obligations; same bound owner's resource cleanup only. No synchronous interruption promise. |
| CB10 | Invalid sequence/handle versus qualified unsuitable delivery | Existing contract-error versus refusal distinction | Invalid offers do not advance parser/phase; qualified rejection keeps receipt charges and earlier resources without retaining the rejected delivery. |
| CB11 | Owner loss or unknown release/commit outcome | Stop/block under existing resource rules; invent no parser state | Preserve unconfirmed ownership/effects, block unsafe continuation/next acquisition. No replacement controller, repair or blind retry. |

Arrival is not guaranteed. Do not inspect a later value byte to select an error: B's qualified index work precedes value classification/refusal. Other ordering needs approval.

## Real Input, Zero-Byte Index Steps
Zero input-byte consumption still needs charged positive bounded index progress or the existing justified completion/yield boundary. READY/YIELDED proves neither progress nor finite calls.
Hold only real admitted bytes not yet consumed by grammar. This is not pretending drained bytes remain. Do not append dummy input, fabricate empty deliveries, read future value bytes to optimize failure order, or borrow the next response's allowance.
Preserve object/candidate, key text, UniqueValid evidence, S0->S1 relationship, input offset, index cursor/version and resource identities. Do not repeat reservations, decoded credit, completed comparisons or insertion. Input position staying fixed is not zero work and does not refresh Wn/Ws or ownership.
If a primitive cannot fit the separately qualified step/profile or outcome/progress is unknown, block/refuse as existing contracts require. No infinite YIELDED loop, extra timer/job or nonterminal cleanupStep for normal index work.

## EOF, Cancellation And Resource Lifetime
Valid EOF refuses an incomplete property without finishing Idx: lifecycle failure, not future-value parsing. Successful finish elsewhere keeps complete-root/stack/carry/release/receiver gates; no exception.
EOF offered while input remains is not permission to bypass advance; the call-state rules still apply. Cancel is serial/nonterminal only. Terminal cleanup does authorized release bookkeeping/live-gauge work under the same owner and original protected reserves; it cannot complete index publication to resume grammar.
Retain cumulative key/node/work/admission charges and last legal-prefix witness. Do not assume rollback, source lease release, memory reclamation or transport settlement. Clearing references is no release proof; unknown commit cannot trigger blind reinsertion/recomparison.
Waiting creates no internal loop, but proves no owner/driver lifetime, stable-read duration or retained-backing bound. Profile evidence and parent bounds remain; no TTL/indefinite freshness claim.

## Remaining Evidence And Acceptance
Per row record source/version, permitted operation/pre-state, phase/binding/generation/view, real input extent/position, guards, commit/cursor/release changes, cost/live set, post-state and open proof.
Prove old/new-input ownership, stable key/decision data, bounded copies/carry/backings, real input held across zero-byte progress, finite normal/step/dispatch/cleanup costs, same-owner lifetime and all valid/invalid/EOF/cancel paths. Unknowns are not zero or caller assertions.
Index movement, reference target/edge timing, physical publication/cursor/version and release evidence remain OPEN. IdxDone cannot be assumed if the selected index needs a not-yet-reserved value node/edge; no provisional node/edge allocation is authorized to force B to work.
This proposal does not qualify pending lookup at key-close or object-close normal release at input exhaustion. No automatic A/C fallback, inputless advance exception, hidden work, new operation or unbounded finish is allowed. If correspondence cannot preserve existing rules, B stays OPEN; refinement needs approval.
Review CB0-CB11, phase/state separation, true exhaustion, real retained input, empty/whitespace, EOF/error and liabilities. Paper cases, no tests run. No coverage/preservation, A1-A3/A4-A7/E03/E05/E06 or host closure.
Separate approval: independent review/result saving, strategy adoption, proofs/models/tests, parser-policy exception/adoption, implementation, additional evidence, real operations, MCP/activation, commit/push.

## Approved Retention
Baseline C510820/U91452/unallocated52736 includes prior159-byte order fix and353-byte integration atcfadff3; no repeated charge. Cap655360/guard352 and prior reservations/charges stay.
Reserve16384 only from unallocated ->36352: design10240/review4096/integration1024/stop1024; before charges U107836. No donor transfer/refund/spare reuse.
First create DESIGN and BACKLOG/640K links only; parent growth uses this integration1024. REVIEW/STOP absent; review physical metadata1024/review1 1536/review2 1536 includes headings/links. Stop on section/file shortage; no truncation, borrowing, alternate log or expansion.
Charge D10124/L521; current C521465/U97191; cap655360/guard352/unallocated36352. Includes this line; no runtime grant.
