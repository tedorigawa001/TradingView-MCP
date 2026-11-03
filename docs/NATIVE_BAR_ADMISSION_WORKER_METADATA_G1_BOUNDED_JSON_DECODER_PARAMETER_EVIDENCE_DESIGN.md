# G1 Decoder Parameter And Evidence Manifest Design
DESIGN_ONLY, approved documentation/allocation on 2026-11-04 JST; baselinebd86c85a79aacc400d94e4d3aedbbb48d5609dda. Existing documents only. No policy waiver, parser/model/test execution, source/dependency read, host probe, fixture, signature, data operation, MCP registration or activation. Dot PAUSED; judgment/notification/mail and all prior operational gates stay unchanged.
This is an inventory/schema proposal, not a numeric profile, implementation or proof. Unknowns remain unknown. Prior documentary D status does not make runtime Q true.

## Documentary Sources And Precedence
All references below are paths/lines in the committed bd86c85 tree, not newly acquired source evidence.
- I: [input/state](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_INPUT_STATE_DESIGN.md).
- C: [counter](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_COUNTER_DESIGN.md).
- O: [ownership](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_OWNERSHIP_DESIGN.md).
- W: [capacity/work](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_CAPACITY_WORK_DESIGN.md).
- S: [supplement](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_RECONCILIATION_DESIGN.md).
- R: [saved re-review](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_RECONCILIATION_REVIEW.md).
S supersedes only the named proposed clauses: C31's global error ordering, O's terminal-release/cancel/receiver gaps, W's aggregate padding and post-DONE cleanup suggestion cannot be revived by inventorying an old line. Earlier text and charges remain historical. R6 and R47-49 record documentary response only; no runtime gate was closed.
The existing decoder proposal, 512K retention design and BACKLOG remain policy/funding context. This inventory does not reclassify an old proposal as adopted. The upstream M source/host evidence is not established by C or R merely citing it.

## Entry And Evidence Contract
Each entry has stable ID, domain, owner, unit, quantifier/lifetime, value-or-formula, kind, evidence references, dependency IDs, applicability, failure rule and future approval boundary. Separate received/admitted/cumulative/live/peak quantities; a matching number or repeated name does not merge their ledgers.
Kinds: I=inherited value as documented here, C=inactive logical candidate, F=conditional formula, V=per-input/state variable not observed here, U=unknown profile term/property. I means documentary inheritance, not authenticated measurement or runtime qualification. Known threshold and unresolved interpretation can coexist.
Each evidence reference names exact document/path, full source commit, line/clause and evidence role. Roles are requirement text, proposed contract, documentary review, mathematical obligation or host/producer fact. A review of prose is never a host fact. A report's claim without its primary requirement remains unconfirmed.
Evidence states are DOCUMENTED, CONDITIONAL, MISSING or CONTRADICTORY; runtime status starts OPEN. Only a separately approved qualification review with matching factual evidence may close a runtime gate; a document review never does. Missing reference, cycle, mismatched domain/version/owner, conflicting unit or non-finite term blocks its dependent closure. Do not silently choose a favorable source or accept a caller's assertion as evidence.
Grouped coefficient rows below are inventory families, not complete executable profiles. Every selected layout/primitive field must later have a separately identified child entry with its own cost/unit/dependencies. Unlisted fields are not free.
Source/binding IDs are documentary roles only; no actual capability, credential, private path, raw delivery, market data or runtime registry is recorded.
Owners: receipt/batch belong to the qualified parent owner, admission/grammar to the decoder resource owner, source backings to the producer, retained root records to the acquisition owner and handed-off results to the bound receiver. Work and capacity ledgers remain separate. Family rows must be expanded before any profile can be complete.
An OPEN manifest is a valid documentary output, not an executable profile. Failed evidence admission blocks profile selection; do not invent a parser-state transition for an invalid call. Existing valid-operation refusal/cancellation/release rules stay authoritative.

## Parameter Inventory
Notation: B=response body cap, N=node cap, D=depth cap, K=keys/object. A reference such as C6 means source C line6. All actual V values are NOT_OBSERVED and all U terms UNSET, never zero.
| ID | Value or formula; unit and scope | Kind | Source / required evidence |
|---|---|---|---|
| B01 | B=524288 bytes/response; receipt vs admission separate | I | C6, C10-13; E01/E02 |
| B02 | deliveries=1024 callbacks/response, including empty | I | C6, C13; E01 |
| B03 | batch received-body=8388608 bytes/acquisition | I | C6, S18; E01/E02 |
| B04 | D=32 live containers; root1; peak separately | I | C16; E03 |
| B05 | N=16384 cumulative reserved value slots, not keys | I | C17-18; E03 |
| B06 | K=256 slots/object; committed key reservations not refunded | I | C19-20, S19-20; E03 |
| B07 | scalar ceiling65536 decoded UTF-8 bytes | I | C6/C23; E02 |
| B08 | scalar ceiling applies per key/string token | C | S15-16; upstream M equivalence E02 |
| B09 | numeric128 ASCII lexeme bytes/token | I | C25, S15-16; E02 |
| B10 | other parent/per-kind/overlap constraints not enumerated here | U | C6, W35; complete parent linkage E02 |
| A01 | Imax=9007199254740991 exact nonnegative logical integers | C | S17; representation/cost E05/E06 |
| A02 | P=1024 logical payload bytes/page, not allocator fact | C | W7, S34; E04 |
| A03 | page(x)=x if divisible, else x+(P-x%P) | F | S17; exact integers x,P; P>0; E04/E05 |
| A04 | J=N+D=16416 key/edge reservation slots | F | W8; one unsettled entry/open container, E03 |
| A05 | N+J=32800 optional payload slot candidate, not allocations | F | S35; selected layout and E03/E04 |
| L01 | k prior unique keys in current object; k<=255 | V | S25; eligible key slot, E03/E06 |
| L02 | comparisons/key<=ceil(log2(k+1)); maximum8 | F | S25; complete binary-search contract E06 |
| L03 | ExamCum<=8*UkeysSeenCum per response prefix, not total work | F | S26 scoped below; E03/E06 |
| L04 | shifts<=sum Ko*(Ko-1)/2 <=255*J/2 | F | S27; Ko<=256 and total keys<=J, E03/E06 |
| L05 | UkeysSeenCum / ExamCum: cumulative decoded key bytes / byte-pairs per response | V | S25-26 scoped below; E03/E06 |
| W01 | Wn=16777216 logical normal work/response | C | W30, S24; E06/E08 |
| W02 | Ws=4096 logical work/step or valid cleanup call | C | W30, S9; all overhead included E06/E08 |
| W03 | Wf=4096 reserved finish work inside Wn | C | W30/W46, S29; E06/E07 |
| W04 | Wc=8388608 protected failure/cancel cleanup work | C | W30/W51-54, S9-11; E07/E08 |
| W05 | Wn+Wc=25165824; Wf is not added again | F | W30, R47; no reset/refund E06/E08 |
| W06 | per-byte read/write/compare/decode and metadata costs | U | W32-33, S25-27; complete weights E06 |
| W07 | dispatch/check/transition/yield/error/copy costs | U | W32/W42, S9/S11/S19; E06/E08 |
| W08 | indivisible primitive maximum and finish/handoff costs | U | W40/W46, S29/S43; E06/E07 |
| W09 | parent remaining work and dispatch envelope | U | W35, S7/S9; E08/E11 |
| M01 | mNode/mEdge/mKey/mLookup/mFrame bytes/record | U | W9/W14, S32-35; full fields E04 |
| M02 | view/lease/registry/control bytes and counts | U | W15, O31-34; E04/E07 |
| M03 | header/alignment/minimum allocation and pool bounds | U | S32-35; per-allocation E04 |
| M04 | admitted delivery extent L; 0<=L<=B bytes | V | C12, W12; qualified extent E01 |
| M05 | full source backing count Qsrc and capacity Ssrc | U | S37; producer pools/retention E09 |
| M06 | Ulive / UkeysLive: current root-retained decoded payload/key bytes | V | W13, S32-39; E03/E04 |
| M07 | Ulive<=B only for justified single-copy payload storage | F | W13 scoped below; not total copies/heap, E03/E04 |
| M08 | sum_i page(ui) <=sum_i ui+1023*A for positive ui | F | S34; A real allocation count, E04 |
| M09 | carry/text/codec fields and input-copy temporaries | U | S45, O13; representation/copy E04/E10 |
| M10 | Rbase/Oretained bytes and root-retained identities | U | S36; disjoint finite manifests E04/E11 |
| M11 | projection serialized cap and backing representation | U | S38/R45 cite1048576; primary M link E02/E10 |
| M12 | root peak and separately approved capacity allowance | U | W16-19, S32-39; all live sets E04/E09/E11 |
| C01 | Cfixed cleanup overhead including calls/final confirmation | U | W51-53, S11; E07/E08 |
| C02 | Amax/Vmax/Lmax/Rmax coexisting releasable counts | U | W52, S32-39; E04/E07 |
| C03 | cA/cV/cL/cR release/check/bookkeeping work per resource | U | W52, S9-11; E06/E07 |
| C04 | CleanupNeed=Cfixed+Amax*cA+Vmax*cV+Lmax*cL+Rmax*cR | F | W51, S11; checked full sum<=Wc, E07 |
| C05 | valid cleanup progress/cursor and dispatch-call bound | U | S7-12; 2048 quanta is not call cap, E08 |
No inventory entry is assigned a measurement, implementation layout, primitive or runtime admission here.
Key accounting clarification (PE-P3-01): UkeysSeenCum counts each decoded UTF-8 byte of every eligible key candidate once, including duplicates/later failures, before any comparison it funds. ExamCum counts all byte-pairs examined in that response. Both are monotone across yields, token resets, refusal, cancellation and cleanup; no credit repeats on resume/copy. S26's Ukeys means UkeysSeenCum; W13's U means Ulive. Ulive/UkeysLive are current retained decoded payload/key bytes, not backing capacity; reduce only on confirmed root-scope release, never merely on handoff. ExamCum<=8*UkeysSeenCum holds per response prefix only under E03/E06; live bytes never fund it.

## Evidence Obligations And Stop Conditions
| ID | Required proposition and dependencies | Present role / action while open |
|---|---|---|
| E01 | inert qualified handle/extent and versioned receipt; exact batch attribution | proposed S18/S21/O11; no unauthenticated admission |
| E02 | exact M requirement mapping: thresholds, token scope, projection, parent/per-kind/overlap limits | documentary citations only; disagreement/missing primary link blocks adoption |
| E03 | node/key/depth correspondence, J proof and source-to-decoded accounting; cumulative keys vs live payload | conditional W8/W13/S26; no speculative slots or derived promotion |
| E04 | complete allocation/layout/alias/live-set manifest for all fields, pools, carry and copies | U in O31-34/S32-39; root capacity unknown, not zero |
| E05 | exact arithmetic and units, overflow-safe products/rounding/remaining-capacity checks | proposed S17; no host integer or operation-cost assumption |
| E06 | deterministic lookup, resumable compare/shift, cumulative byte-pairs and finite primitive worst-case work | proposed S24-29/W32-41; unknown indivisible cost blocks profile |
| E07 | admission/handoff atomicity, bounded release and all cleanup liability coefficients | proposed O18/S6-12/S42-44; no rollback-as-atomicity or false release |
| E08 | same owner's/serial driver's lifetime, finite dispatch/progress and no reset across calls | proposed S7-11; loss/unknown blocks, no replacement controller |
| E09 | producer stable-read lease, full backing identities/counts/capacities and retention closure | proposed O8/O11/S37; one input/1024 deliveries is not a producer bound |
| E10 | carry and projection representations, copies, UTF-8/UTF-16 distinction and receiver binding | proposed S38/S42/S45; no borrowed views or inferred heap cap |
| E11 | acquisition-root budget/lifetime closure for old outputs, hashes, rows and current result | proposed W35/S36-39; decoder-only success is not root settlement |
| E12 | independent host/bootstrap/transport/clock/GC and D01-D08/B01-B08/G2 qualification | still open in existing policies; no runtime/real-time/RSS claim |
These are obligations, not evidence newly obtained. Source/purpose/attempt/profile/generation and resource-owner/receiver identity must match across an obligation's references. A proposition can be a predicate, not a fake numeric byte count.

## Resolution And Documentary Acceptance
Each proof record names its claim, premises, exact evidence role/version, producer/owner scope, dependent parameter IDs and verifier/review result. Every premise is another named obligation or an explicit source leaf; no circular or self-authenticating closure. A model proof cannot prove an external host fact. Literal arithmetic alone proves neither a formula's premises nor its applicability. E03 may prove logical reservation correspondence without a host layout; E04 cannot use J as an unexplained premise or use its own capacity result to prove that correspondence. Conflicting evidence remains recorded and blocks affected closure.
Before adopting any numeric profile, materialize every applicable family member and required term, check dimensions/checked arithmetic, all dependency gates and root allowances. No unknown, negative, overflowed or unrepresented cost is admitted. Zero is allowed only when an explicit source and proof establish non-applicability/zero cost; absence is not zero.
Root accounting is over distinct full backings plus all views/headers/controls and every simultaneous copy. Source retention can outlive a decoder lease; result retention continues after handoff. max across phases needs complete non-overlap evidence. The old aggregate page(U)/page(N*mNode) shortcut needs an evidenced pool; byteLength, content equality, consumed position or logical release alone do not free root capacity.
Work includes reads/writes/comparisons, decode, initialization, checks, no-byte transitions, errors, yields, releases and final confirmation. Each resumable path needs positive charged progress and a finite total bound. Ordinary work cannot spend Wf/Wc early; Wf is inside Wn, failure reserve is separate. Structural validity is no promise of fitting Wn or a whole-VM/time bound.
Documentary acceptance requires: every named parameter/family/obligation above represented; source clauses bound to bd86c85; amended clauses not revived; I/C/F/V/U separated from evidence/runtime status; units/quantifiers explicit; unknowns and contradictions block affected execution; R's22 mapped entries are not runtime proof. Missing coefficients do not prevent documenting an OPEN inventory, but do prevent qualifying an executable profile.
Only propose later checks: dimension mismatch; exact/one-past and overflow; dependency missing/cycle; repeated receipt; alias/overlap; per-allocation rounding; producer-held sources; unconfirmed release/owner loss; finish/cleanup isolation and no-budget-reset. No test/model/parse is run here.
Future pure-model/test scope and any explicitly synthetic profile need separate approval; synthetic assignments must never fill unknown real-profile terms or qualify a host. Actual decoder implementation, no-handwritten-parser exception/adoption, new source/evidence acquisition, real ports/clocks/timers/build/child/native/fixture/signature/data operations, MCP registration and activation remain separate approvals.
Next refine only the proof/layout obligations chosen by a separately approved slice; do not start source acquisition or implementation merely because this inventory is complete.

## Approved Retention
Keep cap524288/guard352 and existing reservations/charges, including bd86c85's225-byte date charge and review-unreserved65. Approved from unallocated48128: design16384/review5120/integration2048/stop1024=24576; remainder23552. Documentation allocation applied; no runtime allowance adopted.
Review physical metadata1024/R1 2048/R2 2048 includes all headings/links. This reflection creates DESIGN and six parent links only; REVIEW/STOP remain absent. Old measured prefixes and old review records stay frozen; every new parent byte belongs to this stage's integration2048. No old free/reserved pool is reused, no past consumption refunded and no historical failure repaired by relabelling.
Charge D16251/L1520; current C442137/U58247; includes this record. Baselinebd86c85 C424366/U51442; no implementation or test grant.
