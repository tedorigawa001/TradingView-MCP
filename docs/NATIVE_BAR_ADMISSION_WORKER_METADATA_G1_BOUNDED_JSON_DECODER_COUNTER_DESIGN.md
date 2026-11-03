# G1 Pure Counter Contract Proposal
DESIGN_ONLY, baselineff5b1b7. No policy exception, decoder implementation, model/test execution, source access or operational authority. Dot PAUSED; judgment/notification/mail and all M/G2 gates stay unchanged. This refines input/state only as a proposal. Existing documents establish cap values but not every definition below; reconcile these definitions before implementation, never silently substitute them for an existing contract.

## Domains And Fixed Limits
Use response-bound counters with immutable source/purpose/attempt/profile identity. New deliveries, yields, failed syntax and equal content do not create new response budgets. Only a separately admitted new response has fresh response counters; its parent batch charges continue.
Keep M caps: response body524288, deliveries1024 including empty callbacks, depth32, nodes16384, keys256/object, scalar UTF-8 bytes65536, numeric lexeme bytes128. Batch received-body8388608, all failure/recheck charges and per-kind/overlap limits remain. Retention524288 and response-body524288 are unrelated domains; neither funds the other.
Values are exact nonnegative integers. Use checked remaining-capacity arithmetic before addition; do not wrap, clamp to a limit or invent zero. If an observed total cannot be represented exactly, mark it OVERFLOW/unknown and refuse; an old exact value is not a fabricated exact new total.

## Received Versus Admitted
The qualified delivery owner accounts actual received bytes/deliveries, including an oversized rejected delivery and zero-length callbacks. These observations are not authenticated merely by caller-supplied numbers. Ownership/provenance and binding remain evidence gates.
Parser admission counts bytes/deliveries accepted for application retention, separately from observed receipt. Check call state/binding/sequence/extent first. Other/out-of-order/reentrant calls are invariant-preserving contract errors, not new parser admissions. Actual validation/transport work still belongs to its owner's work ledger, not zero-cost work.
For a legal acceptDelivery, check delivery count and cumulative body limits before retaining/copying input. Check parent batch remaining capacity too. If any guard fails, enter REFUSED, retain none of that delivery and leave it with the caller. Observed received costs remain charged; admitted counters/input position do not partially commit. If all guards pass, commit the admission tuple once, then READY.
Empty deliveries add one delivery and zero body bytes. Re-offering admitted bytes is not deduplication or a refund; invalid sequence/pending-input calls cannot admit them twice. All original transport/internal-buffer qualification gaps remain; these counters do not prevent allocations that occurred before the application boundary.

## Structural Reservations
Depth is a live container-stack gauge: root object opens depth1, each nested object/array adds one; scalars/keys add no container depth. Check before push, pop once on a valid close. Keep peak depth separately. A scalar at depth32 may fit; another container at33 refuses. Closing a container never refunds cumulative work/nodes.
Nodes count reserved value slots: root plus each property value/array element, including containers, primitives, unknown fields and incomplete tokens. Keys are not value nodes. Reserve once when a legal value start is recognized, before constructing/retaining that value. Root must be an object; an invalid start still costs observed input/work but creates no fictitious node.
For a container start, node and depth guards must both pass before committing either reservation or modifying the stack. Node reservations never decrease when a token later fails, a value is rejected or cleanup frees its memory.
Key slots are object-local reservations made at a quoted key start, before key construction; duplicate and later-invalid keys use their admitted reservation. Guard256 before extending the object/key state. A failed reservation does not increment an admitted counter beyond its cap. Unknown fields are not skipped or exempt.
A complete decoded key is compared with that object's existing keys before colon/value parsing. Equal/unequal and escaped-alias duplicates refuse; the duplicate value is never parsed or given a value-node reservation. Do not normalize/case-fold keys. A key-limit refusal may occur before there is enough decoded text to classify a duplicate; neither path overwrites a value.

## Scalar And Number Length
For strings/keys, scalar length is decoded payload UTF-8 bytes, excluding quotes and escape syntax. Source syntax still charges body/work. Count every decoded scalar before append; invalid UTF-8/unpaired surrogates refuse. A supplementary Unicode scalar contributes four UTF-8 bytes, not two UTF-16 code units or twelve escape-source bytes.
Pending UTF-8/escape/surrogate state is separately bounded/charged before retention, not free because decoding is incomplete. Its exact storage/copy formulas remain an ownership/capacity gate.
Numeric length is the original ASCII lexeme, including sign, dot, exponent marker/sign/digits; cap128 is additional to the scalar ceiling. No conversion/coercion is performed. Boolean/null payloads are fixed ASCII literals and still consume node/body/work charges; their scalar length cannot exceed the inherited ceiling.
Token-local scalar/numeric gauges may start at zero for a new token; this does not free previously retained text or refund cumulative body/work. Track live text/pools separately in the later capacity contract.

## Work, Updates And Refusal
Track cumulative byte scans, decoded units, transitions (including no-byte transitions), key comparisons, copies and errors. Their weights, total work, per-step allowance and cleanup reserve are UNSET; no execution until finite reviewed values exist. Logical counts are not engine/RSS/real-time bounds.
Preserve comparison/token/reservation phase and consumption position across yields; a successful reservation/decoded append is never repeated on resume. A denied event commits no structural growth. Already spent observation/work and prior successful reservations are not rolled back.
A guard produces bounded reason/position metadata, no body. At each event check only applicable guards in this order: arithmetic, delivery, body/batch, depth, node, key, scalar, numeric; otherwise apply grammar checks. Never scan ahead to rank future errors. This proposed reporting order changes no acceptance rule.
On REFUSED/CANCELLED, preserve cumulative costs, stop new admissions and expose no partial output. Live gauges may decrease only with actual release; reference release is not GC/erasure/settlement. Cleanup uses a pre-reserved separate allowance, never an automatic reset or borrowing from the next response. Unresolved cleanup blocks the next acquisition.
finish preserves counters; DONE still needs explicit EOF, complete object root, empty stack and no pending token/carry. Root completion latches whitespace-only handling immediately through the same delivery and all yields/deliveries; trailing input charges receipt/work before refusal.

## Documentary Acceptance Cases
Propose checks, do not run them: each limit exact/one-past; empty delivery1024/1025; body-limit failure with caller retaining the delivery; depth32 scalar versus container33; node/key reservations across yields; duplicate-key reservation without parsing its value; unknown nested fields; escaped key aliases and supplementary Unicode; invalid/unfinished tokens; overflow and batch carry; cancellation/error cleanup with no refund.
Next remain ownership/alias enforcement, allocation/copy formulas, work/cleanup values and independently approved model/tests. Complete counter definitions do not qualify a decoder or host.

## Approved Recording
Unallocated123392 ->design8192/review3072/integration1024/stop1024=13312; remainder110080. Review physical metadata1024/R1 1024/R2 1024; all labels count. Cap524288/guard352/prior reservations stay; docs applied only.
Charge D8158/L0619; current C372179/U41677; these include this record's bytes. No new counter-runtime or test grant.
