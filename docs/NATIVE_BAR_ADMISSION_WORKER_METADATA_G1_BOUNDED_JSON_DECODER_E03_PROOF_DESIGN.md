# E03-A Logical Bound Proof Design
DESIGN_ONLY, approved documentation/allocation on 2026-11-04 JST; baselinee54334e374e9b9a27a2df5a796ac5a0f9d391c9c. Existing documents only; no execution grant. Dot PAUSED; judgment/notification/mail and all existing limits/gates unchanged.
This is a conditional paper-proof plan, not E03/E05/E06 closure, a qualified numeric profile or a claim about a particular parser. Each deduction below depends on named invariants that later models/implementations must discharge.

## Sources And Proof Domain
P=[parameter inventory](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_PARAMETER_EVIDENCE_DESIGN.md). I/C/W/S aliases and unchanged clauses remain bound to e54334e. E03-P2-01 amends P's ExamCum definition to lookup-only; corrected P SHA-256: 306948acc91a4d1238f0e06e22a2b2dc0b9dafcf10c2517c05027d6e0a53cb0a. No new runtime source is acquired.
S19-21 supersede C31. P separates cumulative key/comparison quantities from response-live payload; earlier retained results count once in Oretained at next begin. Old proposals remain unqualified.
Proof domain: one fixed source/purpose/attempt/profile response and every event prefix. Ncap=16384, Dcap=32, Kcap=256, Bcap=524288 are documentary inherited limits, not new allowances. Received bytes can exceed a refused cap; the proof uses admitted source bytes only. Parent batches/work/capacity are separate and never reset here.
ExamCum denotes lookup byte-pairs only; other comparisons still charge work.
Symbols: n is cumulative committed value-node reservations; q cumulative committed key reservations; pending is keys not yet associated with a reserved property-value node. UkeysSeenCum and ExamCum keep P's response-wide, non-refundable meanings. Ulive/UkeysLive are current-response retained decoded payload/key bytes, never a substitute for cumulative comparison credit.
Witnesses below are mathematical, not runtime logs/buffers/capabilities. Any later registry/storage needs E04/E07 cost evidence.

## Premises To Discharge
A1: only legal serial grammar events commit growth; invalid calls and denied guards commit none. No speculative sibling keys or second key while waiting for a colon/value (C17-20, S19-21).
A2: each property key's eventual value reserves a distinct logical value-node ID once. Equal contents or shared storage do not merge logical slots. No key overwrite, error recovery, resumption after refusal/cancel or replay of successful reservations (C17-20/C30, I19).
A3: each open object has at most one committed key without a reserved value-node ID; a legally closed object has none. Open objects are a subset of the container stack, whose depth never exceeds Dcap. This is an automaton invariant to prove, not merely infer from a guessed implementation.
A4: the corresponding logical edge/index family needs its own injective node/key mapping and at most one pending logical entry per open container. Multiple physical records/copies/temporary shift slots are not one logical slot by fiat.
A5: grammar positions and decoded appends are monotone across deliveries/yields. Each eligible key candidate's valid decoded UTF-8 bytes are credited once before any lookup comparison they fund; duplicates and later-failed candidates are included, but invalid-call bytes are not invented key credit (C23/C30, P clarification).
A6: strict UTF-8/JSON decoding assigns disjoint source intervals to credited scalar events, with decoded byte length no greater than each interval. No normalization, expansion callback, input replay or re-decoding credit.
A7: per-object lookup uses the proposed sorted references and one bounded three-way bytewise comparator per search iteration; remaining interval at most halves. Comparisons resume without rereading completed pairs. All non-pair work remains separately charged (S24-29).
Missing/contradictory premises leave the corresponding theorem CONDITIONAL. These invariants are not implementation evidence.

## Lemma 1: Reservation Correspondence
Partition q into mapped keys and pending keys. By A2, mapped keys inject into committed value-node IDs, so mapped<=n. By A3, before termination pending<=openObjects<=Dcap. Therefore q=mapped+pending<=n+Dcap<=Ncap+Dcap=16416.
Root/array nodes need no key, so using all n is conservative. No tighter limit or threshold change.
After refusal/cancel, freeze the last legal-prefix correspondence as a mathematical witness. No new key/node reservations occur. Cleanup may empty the live stack but cannot refund cumulative q/n. The proof uses the constant Dcap, not a later live depth of zero.
Preservation cases: close/descent/scalar, duplicate, malformed/incomplete key/value and denied node/depth/key guard. A duplicate/later-invalid pending key stays in q.
J=16416 is a conditional key bound. Edge/index families each need A4, not a shared J total. Allocations/bytes/padding/cleanup calls are not bounded by J. Capacity formulas cannot prove the injection.

## Lemma 2: Source To Cumulative Key Bytes
For each eligible candidate's decoded scalar event i, assign a unique admitted source interval of size si and credited UTF-8 size di. A6 requires di<=si and non-overlapping intervals across all candidates.
Proof cases: unescaped valid UTF-8 has d=s; short JSON escape uses two source bytes for one decoded byte; a non-surrogate unicode escape uses six source bytes for at most three UTF-8 bytes; a valid surrogate pair uses twelve for four. An incomplete/invalid sequence adds no fictitious decoded scalar; already credited valid prefixes remain.
Summing the disjoint intervals gives UkeysSeenCum=sum di<=sum si<=Badmitted<=Bcap. This is conditional on A5/A6, not a new response-total scalar threshold. Quotes, punctuation and value syntax only add uncredited source bytes. Unknown fields and duplicate/later-refused keys have no exemption.
Copy/carry/yield/cleanup add no credit. Encoding/transformation outside A6 blocks this deduction; JS length is not UTF-8 bytes or a heap bound.
For Ulive<=Bcap additionally require an evidenced single-copy retained payload representation whose entries are a subset of uniquely decoded/raw-lexeme events. Multiple copies, UTF-16 backing, projection and metadata need separate E04/E10 accounting. Handoff is not release; earlier results remain in root accounting.

## Lemma 3: Conditional Lookup Envelope
For k prior unique keys, T(0)=0 and T(k)<=1+T(floor(k/2)) under A7. Thus T(k)<=ceil(log2(k+1)); an eligible next key has k<=255, giving at most8 comparisons.
Each comparator examines no more byte-pairs than the incoming key's decoded UTF-8 length. Length-only decisions for empty/prefix keys add control work, not fabricated byte-pairs. Include duplicate candidates and preserve partial comparator/search state across yields.
Documentary example, not executed: an empty key plus a literal can require positive literal-check work with no lookup byte-pairs. Such checks are excluded from ExamCum, never from their work ledger.
Summing the per-candidate bounds for every response prefix yields ExamCum<=8*UkeysSeenCum, including after cancellation/cleanup. Neither quantity decreases when live bytes are released. No claim is made that byte reads, control, integer operations, decoding, shifts, copies or releases cost one unit or that the full workload fits Wn.
For insertion, at most k logical references move per admitted unique key. If each object's unique inserted count Ko<=256 and sum Ko<=q<=J, then total shifts<=sum Ko*(Ko-1)/2<=255*J/2. Actual field width, temporary storage, primitive costs and resumable commit details remain E04/E06 gates.

## Acceptance And Next Boundary
Record premise/source/owner/domain/case/dependencies/conclusion/open evidence. Reject cycles, unit/version mismatch and missing fields. Arithmetic proves no host fact.
Acceptance: explicit partition/injection/source intervals; terminal cleanup, empty/duplicate/escaped keys and one-past cases on paper; matching response/cumulative-live scopes. A conditional derivation alone closes no E03/E06 gate.
Propose later checks only, do not run them: depth32/33; denied reservation with no partial tuple; terminal cleanup with zero live depth; repeated resume/copy; partial UTF-8/escape; duplicate/later-invalid key credit; empty/prefix key search; exact/one-past checked arithmetic and missing injection/layout. E05 still needs exact arithmetic/profile evidence; this document does not implement rounding, integer or proof-checking code.
Review, pure models/tests and synthetic profiles need separate approval. Real source/host facts, parser-policy exception/adoption, build/child/native/fixture/signature/data work, MCP and activation stay unauthorized.

## Approved Retention
Baselinee54334e C442594/U57790; cap524288/guard352/unallocated23552. Approved documentation reservation: design10240/review4096/integration1024/stop1024=16384 from unallocated only; remainder7168. Existing reservations, failures and charges stay frozen, with no refunds or reuse of old spare pools.
Review physical metadata1024/R1 1536/R2 1536 includes headings/links; initial reflection created DESIGN and BACKLOG/retention links only. REVIEW/STOP remain absent. Links use this stage's integration1024. The inventory definition is now corrected without byte growth; its3-byte DESIGN remainder stays untouched.
Charge D9432/L445; current C452471/U64297; includes this record. No runtime gate, threshold or notification condition changes.
