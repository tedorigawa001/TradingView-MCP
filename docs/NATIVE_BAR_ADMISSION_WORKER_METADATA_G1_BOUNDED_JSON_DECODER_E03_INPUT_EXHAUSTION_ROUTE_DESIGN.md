# Input Exhaustion: Driver Route Comparison And Selection Gates
DESIGN_ONLY, approved 2026-11-04 JST; baseline639269a8efa4c7b415248da4382cb8292a14fc0f. Existing documents only; Dot PAUSED; judgment/notification/mail and operational limits unchanged. No implementation, parse/model/test, acquisition, MCP or activation grant.

## Sources At The Baseline Commit
CONS=[write/progress](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_WRITE_CURSOR_COMMIT_DESIGN.md), 10181 bytes, SHA-256 c4b29d6c8d1b6ca48cc673df461d7c2a37fbfa1df6506621cf00da53fcf715ff.
BR=[colon/input review](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_COLON_INPUT_BOUNDARY_REVIEW.md), 3904 bytes, SHA-256 fd40d53bc3667756ee822405d845d9749ba04f7e448e3aa6a3c918c202cf971c.
OWN=[ownership](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_OWNERSHIP_DESIGN.md), 10862 bytes, SHA-256 c86285c490cb039907f182ea6c0b734b87664bbdfb94b0b9885a86fd0293f90a.
Also at that commit: I=[input/state](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_INPUT_STATE_DESIGN.md), S=[reconciliation](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_RECONCILIATION_DESIGN.md), G=[event/guard](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_EVENT_GUARD_MAPPING_DESIGN.md), CW=[capacity/work](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_CAPACITY_WORK_DESIGN.md).
Keep RT/PR/BND/ORD/KVS bindings/precedence; S19-21 supersede C31. CONS59 gives necessary completion/bridge, not sufficient CP-V permission; all guards remain. CONS63 does not assert that bytes remain.
Route-Z/H/W/F are route labels, not H/W source aliases, states/APIs or phase permission. No clause is replaced; B/routes remain unadopted.

## Four Distinct Boundaries
1. Byte exhaustion: exact consumed position equals admitted extent, not resource completion.
2. Enabled normal work settled: required work needing no future byte is complete. Refusal follows terminal rules, not the normal sequence.
3. Input resource boundary: fragments/keys/progress have stable owned lifetimes; private input release confirmed. Consumed is not released.
4. State boundary: root/stack/token/carry/resources justify NEED_INPUT/WAIT_EOF. DONE needs legal finish/explicit EOF/handoff.

Incomplete tokens need actual bytes, not fabricated runnable tasks: qualify carry/release and ordinary input waiting. Do not skip enabled comparison/commit/close release merely because no future input arrived.
Existing serial operations only. I8 state-gates advance; READY/YIELDED alone does not prove Idx permission or that bytes remain. OWN's zero-byte release grants no automatic Idx.

## Comparison
| Route | Candidate mechanism | Coverage / selection limitation |
|---|---|---|
| Route-Z | Settle enabled bounded normal work after the last byte, before RELEASE_INPUT/exhaustion-state transition | First target for key lookup, B post-colon index, nested/root close; needs phase/driver refinement, not derived permission. |
| Route-H | Classify a legal object-close delimiter and retain its actual admitted byte unconsumed through bounded index retirement | Close-only; prove classification/consumption/pop/completion. Does not solve key-close or B post-consumed-colon Idx. |
| Route-W | Qualify release/exhaustion then await a genuine later numbered delivery | Incomplete grammar may wait. Not universal: no guaranteed delivery after root close. |
| Route-F | Existing one-step finish preparation/temporary-release allowance | Ancillary: complete root/legal finish/drained resources/EOF/proved reserve-step fit. No normal lookup/Idx/unfinished-root completion. |

Rank Z first for covering all three enabled-work boundaries without assuming another delivery. No acceptance/performance/memory-fit/time claim. Unproved Z stays OPEN, no H/W/F fallback.
H may be a close-only comparison, not an adopted hybrid with Z. Holding colon to insert first changes B's CP-U -> Colon -> Idx -> CP-V order; separate design/approval required.
W preserves candidate/key/input lifetime and admission guards. Admission refreshes no pending-response budget; no parent/other-response borrowing or manufactured delivery for root close.
S29/CW finish reserve is inside normal work. OWN43/S42-44 release/readiness/handoff gates remain. F cannot turn pending S28 retirement into complete root or bypass illegal/refused finish.

## Route-Z: Conditional Phase Order
Refinement proposal only, not a selected phase/current permission.
| Step | Conditional obligation | Forbidden shortcut |
|---|---|---|
| Z0: admission/copy | Finish existing COPY_PENDING and RELEASE_SOURCE gates before grammar/index work | No direct source reads or parsing during source-release continuation. |
| Z1: normal work | In qualified PARSE_READY, consume legal bytes and bind enabled lookup/Idx/close obligations to the same object/candidate/owner | No fabricated task, grammar growth, future-value classification or repeated credit. |
| Z2: bytes end | Preserve exact end position, known progress and still-owned private-input/control resources while enabled work remains | Do not pretend a byte remains, enter NEED_INPUT prematurely or label input released. |
| Z3: continuation | A legal advance in READY/YIELDED may progress only that qualified pending normal phase, under finite work/dispatch and CONS effect/acknowledgement gates | Phase permission needs proof; no new call, timer, hidden loop or uncharged zero-byte pulse. |
| Z4: release input | On the nonterminal normal path after required work settles, qualify needed carry/key/decision ownership and enter RELEASE_INPUT | Once in release-only continuation, no Idx interleaving or return to parsing as repair. |
| Z5: transition | After qualified release, incomplete root -> NEED_INPUT; complete root with all gates -> WAIT_EOF | No implied EOF, DONE, result publication or state transition based on byte count alone. |

Last-byte quote/colon/close may exhaust fuel: preserve pending phase/cursor, not assume follow-up fitted. YIELDED needs qualified legal phase and finite charged progress.
Prove same pre-bound owner/driver lifetime and explicit legal continuations within finite parent dispatch. No synchronous preemption/automatic scheduling; missing evidence blocks qualification.
Retained consumed input needs full capacity/alias charges and stable source-independent key/carry. Zero consumption is not free/reread/recredit authority. Input and work/phase cursors differ.
Live failure follows existing refusal/resource rules; failed/unknown/exhausted release or lost owner/progress follows OWN27 REFUSED with liabilities. No replacement-owner mutation or terminal cleanup completing normal work.

## Close, Root And Parent Correspondence
G5 needs valid close/no pending key. Bind classification, consumption, index retirement, stack/object pop, value completion and parent return. G47 timing remains OPEN, not proved by a route table.
Z post-consumption needs proved pending-close representation/invariants, not assumed incomplete-object validity. H holds a real stable admitted byte at exact unconsumed offset, not replay/new reservation.
Keep n/q/M/f witnesses; pop depth/open-object once at qualified close. No early parent property/element or pending-close masquerading as complete root for finish.
S28 retirement precedes object completion. I16/G41 tail-only latches immediately at root completion across later input; no new root/sibling, delayed latch or future-byte error ranking.
Final-byte root close must reach normal/resource boundaries without another delivery. Still require EOF/legal finish, not implicit handoff. Missing work/ownership evidence refuses/blocks; structural validity guarantees no acceptance.

## Boundary Coverage Required Before Selection
| Case | Required distinction / evidence |
|---|---|
| Complete key ends input or fuel | CP-U needs complete stable content and qualified prior view; no colon/value parse before outcome, no repeated comparison credit. |
| Legal colon is final byte | B's colon remains consumed; no CP-V without actual legal value start/all guards. Compare enabled Idx driving without invented bytes. |
| Partial UTF-8/escape/key/value | Needs future input, not fabricated byte-independent completion; preserve bounded owned carry and no fictitious node/key. |
| Empty admitted delivery | Count receipt/admission normally; READY still needs bounded copy/release/exhaustion bookkeeping. No fake Idx pulse or direct undocumented shortcut. |
| Post-colon whitespace only | Separate Idx settled/pending and absent value. Do not repeat known commit, invent value or infer root completion. |
| Nested/root close, empty object | Bind legal close, one pop, result retention, root tail and zero-entry control costs; no reliance on future delivery for root. |
| finish/EOF while pending | READY/YIELDED finish stays a state-preserving contract error; valid drained incomplete EOF refuses, no sweep. Successful finish keeps all root/resource/handoff gates. |
| Yield in release / cancel / unknown effects | Release continuation does release only. Serial cancel/owner/unknown outcome rules preserve charges and liabilities; no repair/rollback/retry. |

Cover last-byte fuel before/after acknowledgement, nested return and trailing non-whitespace. Separate index/grammar/admission/resource/lifecycle events; invalid-call checks/dispatch still cost work.

## Selection Gates And Later Refinement
Per route/case record source clause, operation/pre-state/phase, input extent/position, enabled task, owner/view/cursor, guards, effects/charges, post-state and gaps.
Require legal phases, split/fuel/root coverage, consumption/close/pop/tail semantics, once-only effects/current-view qualification, ownership/live-set overlap, finite unit/step/normal/finish/cleanup/dispatch costs and all failure branches.
Required future clause mapping includes I8/15/17/19, OWN20-28, S28-29/S42-45, G30/41-47 and BND CB0/CB3/CB6/CB7/CB11 plus its reviewed real-input premise. Identify amendments/precedence explicitly; existing historical text/pins/charges stay frozen.
No closure from comparison. Route/refinement/source replacement, preservation/models, host evidence/execution need separate approval. No new operation/state/driver/controller/delivery budget/limit.

## Work, Capacity And Acceptance
Count consumed input, key/result/index, prepared actions, pending-close/carry/cursor/view/control and aliases/headers together. Shared backing once in full, copies separately; slots bound no heap/allocations.
Normal lookup/Idx/close retirement/RELEASE_INPUT use normal work; finish its qualified reserve; terminal release original cleanup. Reserve before effects; no source/parent/next-response borrowing/refund.
Prove bounded positive progress and finite continuation/dispatch; bytes/slots or Wn/Ws prove neither. Unknown costs/lifetime/release block, not zero defaults.
Document review checks all routes, Z ranking only, source-change obligations and case coverage. All cases are paper proposals; none run. Physical layout/alias/atomicity/cost/host gates and A1-A3/A4-A7/E03/E05/E06/preservation stay OPEN.
Separate approval: independent review/result saving, route/strategy/B adoption, proofs/models/tests, policy waiver, implementation, evidence acquisition, operations, MCP/activation, commit/push.

## Approved Retention
Baseline C563537/U112463/unallocated110080; cap786432/guard352. Reserve20480 only from unallocated ->89600: design12288/review6144/integration1024/stop1024; before charges U132943. Old reservations/charges, including CONS's2/249-byte fix, stay; no transfer/refund/spare reuse.
Create DESIGN and BACKLOG/current768K links only; parent growth uses this integration1024. REVIEW/STOP absent; review physical metadata1024/review1 2560/review2 2560 includes headings/links. Shortage stops; no truncation, borrowing, alternate log or expansion.
Charge D12005/L609; current C576151/U120329; cap786432/guard352/unallocated89600. Includes this line; no runtime grant.
