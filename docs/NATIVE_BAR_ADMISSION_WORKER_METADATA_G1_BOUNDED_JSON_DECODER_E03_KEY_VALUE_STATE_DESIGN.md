# Key Start, Uniqueness And Value-Start State Design
DESIGN_ONLY, approved 2026-11-04 JST; baselinef9ae065bcdcd0a79bc97ba56625761942ef0bd8c. Existing documents only. Dot PAUSED; judgment/notification/mail and operational limits unchanged. No implementation, parse/model/test, acquisition, MCP or activation grant.

## Sources And Scope
H=[event/guard mapping](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_EVENT_GUARD_MAPPING_DESIGN.md), SHA-256 1ab693e4d1cd6fd08286279bbe5e498fb2238b574522a08a03e9a278f5889932, 8050 bytes at baseline. Keep its bindings/precedence and corrected6132-byte case source. C/S/I inherit H's counter/supplement/input-state aliases; S19-21 supersede C31. No old clause is rebound.
R0-R5/CP-K/U/V are role/commit labels, not source aliases, APIs or adopted states. Existing serial/state/owner/budget rules apply.
One response/owner/object/key: n/q are cumulative value-node/key reservations, P/M pending/mapped keys with injective f. Object key slots differ from prior-unique-key index count k. No ID merging by contents/aliases or budget reset at object/delivery. Obligation schema, not a complete/executed proof.

## Role Transitions
| Role | Event / transition | Commit obligation |
|---|---|---|
| R0: key start expected | Eligible quoted key start -> R1 | CP-K before construction; initial key-or-end differs from post-comma mandatory-key. Object close: H G5. |
| R1: key decoding | Valid scalar continues R1; valid complete closing quote -> R2 | Append guards; no second reservation. Invalid codec/grammar refuses; carry separately charged. |
| R2: uniqueness comparison | Duplicate -> refusal; confirmed non-duplicate -> R3 | CP-U after complete key/lookup; exclude current candidate; no colon/value parse. |
| R3: colon expected | Whitespace stays R3; legal colon -> R4 | Unique decision required; no new key/node. Index dependency OPEN, not optional. Wrong syntax refuses. |
| R4: value expected | Whitespace stays R4; legal value start -> R5 | CP-V; quote starts a value, not key; invalid start creates no node. |
| R5: node reserved | Continue existing value parser outside this slice | Key mapped; node reservation is not value completion/next-key permission. Parent grammar applies. |

R0 needs key-expecting grammar, not just empty P. Quote while awaiting colon is not a new key. Object close, comma after completed value and parent return need evidence; no trailing-comma permission.
Inherit H B0-B4: charged operation checks, finite work before checks/effects, grammar classification, prospective counters and ownership/capacity/cleanup/work guards, then one commit. No unqualified profile is authorized.

## Three Commit Points
CP-K (C19, S19-20; H G1/K1): at eligible quoted key start, pass all guards before construction; reserve one object key slot/q entry, add its key to P with object ownership. n/D do not grow; D is live container depth. Yield phase/cursor consistency and atomic grouping need proof.
Guard256 before extending key/object state. Duplicate/later-invalid reservations remain charged. Key cap may fail before duplicate classification; no scan-ahead error ranking or unknown-field exemption.
CP-U (C20, S24-27; H G2/K6): after valid decoded key completion, compare this object's prior keys excluding the current candidate. Only completed lookup with qualified stable key/index identities establishes duplicate/non-duplicate; partial/unknown is not non-duplicate. Decision creates no key/value reservation.
Duplicates, including escaped aliases and those whose values would match, refuse before colon/value parsing. No overwrite/current property's node. No normalization/case-fold/raw-source equality shortcut. Empty keys/shared prefixes charge control/reads.
CP-V (C17-18, S20; H G3/G4/K2): at legal property-value start, all applicable guards precede construction/retention. Reserve a distinct value-node, n+1, move key P->M and set f(key)=node; q unchanged.
Object/array values require node+depth guards before either reservation/stack change. Arrays add D, not open-object count; objects also follow K4. Depth failure leaves no new node/map; prior key stays pending. Scalars add no depth. Root remains object-only; no exception here.
Later-invalid values do not refund key/node. Prove actual compound tuples without invented intermediate steps. Lookup decision, index publication, node reservation and completed-value publication are distinct.

## Decode, Lookup And Resume
Key length is decoded UTF-8 bytes/token, not quote/escape syntax; source bytes charge body/work (C23, S15-16). Invalid UTF-8/unpaired surrogate refuses. Guard before append; partial codec/carry and copies need separate bounds. No zero-copy or released-input view assumption.
UkeysSeenCum credits eligible decoded key bytes once, including valid prefixes of duplicate/later-failed candidates. No re-credit on resume/copy, credit for invalid scalars or refund on live release.
Received colon/value bytes are not permission to parse them before CP-U. Across yield/delivery preserve object/candidate, search interval, compare offset, reservation phase and input progress. Do not repeat committed reservations, completed comparison pairs or decoded appends.
Keep deterministic/resumable lookup, not host sort/hash. Comparison counts do not bound total work or imply constant time; weights/progress/capacity/cleanup stay OPEN.
CP-U is not insertion completion. Insertion commit, partial-shift consistency, membership/visibility and dependencies on colon/value admission remain OPEN. Eventually bind the decision to response/object/candidate/text/index identities and lifetime; no implemented witness or free metadata is implied. Missing evidence blocks qualification, not permission to assume stability.

## Failure And Terminal Obligations
| Failure point | Reservations / later behavior |
|---|---|
| CP-K guard fails | No new key/construction; keep prior commitments/work. |
| Invalid decode or duplicate | Keep admitted key/P and valid-prefix credit; no colon/value parse, overwrite or property's node. Terminal rules apply. |
| Bad colon/value start | Keep prior key; no fictitious node. |
| CP-V guard fails | No partial node/depth/map; prior key remains pending. |
| Failure after CP-V | Keep cumulative key/node/map witness; no refund on live release. |
| Cancel/refusal/invalid EOF | Existing serial nonterminal cancellation/explicit-EOF rules apply. Intermediate incompleteness is not EOF failure. Freeze legal-prefix witness; no restart/reset. |

Successful finish follows H, not that refusal row.
Zero structural delta is not zero receipt/admission, decode, storage or work. cleanupStep stays the same owner's resource operation, not a path back to R0-R5 or a replacement controller.

## Open Evidence And Acceptance
Document review: precedence, roles/guards, duplicate-before-colon/value, candidate exclusion, no replay/re-credit, node+depth atomicity and gaps. Cases (not run): empty/escaped-alias key, wrong quote, split codec, key cap first, EOF after colon, depth failure.
OPEN: predecessor/return/token states, input/phase/carry format, decision lifetime, insertion/visibility and finite work/dispatch/capacity/cleanup. No coverage/preservation, A4-A7/E03/E05/E06 or host closure.
Separate approval: independent review/result saving, proofs/models/tests, parser-policy exception/adoption, implementation, new evidence, real operations, MCP/activation, commit/push.

## Approved Retention
Baseline C482224/U74992/unallocated97792; cap655360/guard352. Reserve14336 only from unallocated ->83456: design8192/review4096/integration1024/stop1024; before charges U89328. Prior charges/reservations stay; no transfer/refund/spare reuse.
First create DESIGN and BACKLOG/640K links only; parent growth uses this integration1024. REVIEW/STOP absent; review physical metadata1024/review1 1536/review2 1536 includes headings/links. Stop on section/file shortage; no truncation, borrowing, alternate log or expansion.
Charge D8092/L813; current C491129/U80423; cap655360/guard352/unallocated83456. Includes this line; no runtime grant.
