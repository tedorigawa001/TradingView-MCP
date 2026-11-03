# G1 Allocation Capacity And Work Budget Proposal
DESIGN_ONLY, baselineec25455. Approved design documentation only, not a policy waiver, runtime allocation, import, parser/model/test run, source inspection, runtime qualification or operational authority. Dot PAUSED; judgment/notification/mail, M limits and all D01-D08/B01-B08/G2 gates stay unchanged.
Refine the [counter contract](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_COUNTER_DESIGN.md) and [ownership contract](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_OWNERSHIP_DESIGN.md). New numeric values below are inactive logical-model candidates, not adopted runtime limits, measured performance or calibrated acceptance guarantees.

## Parameters And Structural Capacity
Inherit B=524288 body bytes/response, N=16384 reserved value nodes, D=32 depth, K=256 keys/object, scalar65536 and numeric128. Batch/per-kind/overlap budgets and failed/recheck charges remain. Response-body bytes and retained-document bytes are separate domains despite equal ceilings.
Propose page payload P=1024; page(x)=P*ceil(x/P), page(0)=0. Padding is charged at full capacity, not used length. Metadata/lease/control cost is not zero for an empty delivery.
Use J=N+D=16416 as a conservative bound for key/edge reservation slots only if every open container has at most one unsettled entry and completed keys/edges are associated with reserved value nodes. Prove that correspondence before applying J; do not enlarge grammar counters or assume arbitrary speculative entries fit.
Required profile coefficients mNode/mEdge/mKey/mLookup/mFrame describe complete logical records. They are UNSET; do not invent sizes from a guessed pointer width, typed-array choice or host layout. A field omitted from the record model must not become an uncharged side allocation.

## Capacity Formula
Minput=page(L), where L is the admitted delivery extent, never an invented whole-response buffer.
For separately justified single-copy validated UTF-8 payload storage, decoded retained payload U<=B and Mpayload=page(U). This bound requires a source-to-payload accounting proof. Other encodings, representations, duplicates or materialized copies add their own storage; UTF-16 code units are not the inherited UTF-8 scalar counter.
Mslots=page(N*mNode)+page(J*mEdge)+page(J*mKey)+page(J*mLookup)+page(D*mFrame).
Add carry, view/lease/registry/control records, allocation headers/alignment, projection, errors and all temporary copies. These maxima and allocator/runtime/GC overhead remain UNSET, not zero.
MrootPeak=Rbase+Oretained+max_phase(sum of distinct root-live backing capacities and live metadata/carry/projection/error costs).
Rbase and Oretained must not overlap the phase sum. Track stable allocation identity/generation and every alias/owner; equal contents in different allocations are separate. Count a shared backing once at its full retained capacity, while charging all view metadata and operations.
The source backing capacity is not L. Include producer-retained source allocations, even after its lease ends, unless actual root-scope release is evidenced. A parser's one active delivery does not prove a producer holds only one backing allocation.
Do not claim MrootPeak or an admissible profile until every term has a finite reviewed bound and MrootPeak<=the separately approved capacity allowance. Logical payload/page formulas do not bound V8 heap, RSS, native pools, transient constructors or GC.

## Coexistence By Phase
COPY_PENDING includes full source backing, private-input reservation/copy, prior result/working state, carry and management records at the same time.
RELEASE_SOURCE retains those charges until release is confirmed; producer retention may continue in the root scope after decoder lease release.
PARSE_READY includes private input, growing payload/tree/key records, lookup/stack/carry and operation temporaries. Do not remove source allocations still retained by another root owner.
RELEASE_INPUT keeps consumed input/copy temporaries until logical release is confirmed. Consumed offsets and token-local resets are not release evidence.
finish retains the result and any remaining work records until preparation and the single handoff commit. After commit, move result ownership/accounting to the receiver; do not subtract it from the root total.
Only use a max between phases when their complete live sets and any asynchronous overlap are proved. Otherwise include the overlapping sets conservatively; unknown coexistence blocks execution.

## Logical Work Candidates
Propose normal total Wn=16777216, per-step Ws=4096, finish reserve Wf=4096 inside Wn, and protected failure/cancel cleanup Wc=8388608. Maximum decoder-model charge is Wn+Wc=25165824, not Wn+Wf+Wc.
These are refusal/admission limits for a proposed logical model, not evidence every valid JSON fitting structural caps completes, nor a bound on real elapsed time or the whole VM/transport workload. No source, producer, bootstrap, DNS/TLS, clock or GC work is silently included at zero cost.
Count byte reads/writes/comparisons, decoded operations, integer/metadata operations, state transitions including no-byte transitions, validation, copies and errors. Every loop/transition must have positive charged work. Unknown native/compound primitive cost needs its own finite profile bound; do not call it one unit merely because it is one API call.
Count source-to-private copying separately from receipt/admission. Initialization/zeroing, repeated scans, hashes and intermediate copies are additional work. Copy segments are not additional deliveries or JSON nodes.
Reserve Wf before ordinary work; ordinary availability excludes the unspent finish reserve. Charge normal RELEASE_SOURCE/RELEASE_INPUT and successful finish preparation to normal work, never pre-spend the failure reserve.
Each response start must also fit the parent acquisition's separately bounded remaining work/capacity envelope. Resetting a response cannot refill the parent budget or refund earlier failures. Parent and producer/runtime bounds remain evidence gates.

## Step And Primitive Admission
Before retaining/allocating/copying or making another irreversible change, require capacity, cleanup liability and the operation's finite maximum work to fit remaining step/normal allowances. Preserve the prior grammar/ownership guards and atomic reservation rules.
If the operation fits a whole Ws but not the current step remainder, yield before its effects and resume the same phase/offset without duplicate reservations/writes. Already spent checks remain charged.
If a primitive cannot be split and its proven maximum exceeds Ws, reject that execution profile before work; do not yield forever waiting for a larger step. No whole-allocation constructor or release is presumed cheap/interruptible.
The candidate page P does not prove a page operation fits Ws. For example, page initialization plus source reads plus target writes already add three payload passes, before management/primitive overhead. Every pass and residual cost must be bounded.
Invalid calls keep the inherited state/binding/input/position invariant. Their dispatch/validation work is charged by the owner, not free. Owner-dispatch exhaustion must stop further work without inventing an invalid-call parser transition; that stop/cleanup linkage requires a reviewed interface before execution.
Valid live-operation exhaustion or a technical failure before handoff enters REFUSED; accepted cancellation enters CANCELLED. Retain cumulative charges and recorded ownership; only bounded cleanup follows. Known bounded release progress may yield as already specified, never as a fresh retry.

## Finish And Commit Reserve
Before accepting a finish profile, prove bounded validation, temporary logical release, receiver readiness and the qualified atomic/non-failing handoff can fit Wf and one finish step. Wf is part of Wn, not new work.
No deferred/repeated finish or implicit larger step is authorized. If the required preparation/release/readiness is unconfirmed at the boundary, REFUSED before commit, no publication; retain cleanup pending.
The existing commit boundary stays: before commit the decoder owns the result and accepted cancellation prevents publication; commit jointly sets DONE/transfers ownership/removes parser references; afterward only the receiver owns it. Cleanup cannot release it, and unknown return/delivery cannot trigger republication.

## Protected Cleanup Liability
Require CleanupNeed=Cfixed+Amax*cA+Vmax*cV+Lmax*cL+Rmax*cR<=Wc.
Amax/Vmax/Lmax/Rmax cover all allocations, views, leases and other releasable references that can coexist; coefficients include release/verification/error work. All maxima and costs are UNSET pending evidence. Neither missing terms nor non-failing release are assumed.
Reserve Wc before begin. Before every new allocation/view/lease/reference, check that the increased worst-case cleanup liability still fits the protected allowance. Refuse before creating liability that cannot be covered. Registry/control storage and its cleanup are included too.
Cleanup uses bounded steps no larger than Ws under the existing resource owner. It performs release only, not grammar, retry, rebind or another result transfer. Normal unused work is not an automatic cleanup top-up or fresh response budget.
On unexpected cleanup exhaustion/failure/unknown release, preserve REFUSED/CANCELLED or DONE as appropriate and mark resources unresolved; no false free/settled status, next acquisition or new owner/budget/controller for automatic recovery. Receiver-owned post-commit result storage is never decoder cleanup liability.
Logical reference release, physical reclamation, erasure and transport settlement remain distinct. Removing decoder ownership does not erase producer/receiver retention from root accounting or refund cumulative work.

## Evidence And Documentary Acceptance
Before execution require finite record/layout completeness, producer/source-retention bounds, allocation/header/alignment and view/registry sizes, primitive non-preemptible maxima, copy/lease/release facts, cleanup coefficients, handoff cost/atomicity and runtime/host closure. No actual profile or constructor is selected here.
Propose, do not run: rounded/empty capacity; same-backing versus equal-content copies; overlapping copy/parse/cleanup phases; producer retention after lease release; receiver retention after handoff; unknown/overflow coefficients; primitive larger than a step; exact/one-past work; no-byte progress; invalid-call dispatch costs; cleanup liability growth; reserved finish/cleanup isolation; cancellation and unknown release with no refund/retry.
Next require the parameter/evidence manifest, then separately approved pure-model/test work. No parser implementation, policy waiver, new operational limit or measurement is granted by this design.

## Approved Recording
Unallocated93696 ->design12288/review4096/integration1024/stop1024=18432; remainder75264. Review physical metadata1024/R1 1536/R2 1536 includes all headings/links. Cap524288/guard352/prior reservations stay; docs applied only.
Old measured DESIGN prefixes stay frozen. New parent integration sections belong to this stage; no old report section is relabelled. All new parent bytes count toward integration1024.
Charge D11486/L0901; current C395437/U53235; includes this record's bytes. The work/page numbers remain inactive model candidates, not execution authority.
