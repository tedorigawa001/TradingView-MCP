# Sorted Key-Reference Representation And Resumable Reflection
DESIGN_ONLY, approved 2026-11-04 JST; baselineb25ed51c8f235ae36da9a098b4e213b4713f7175. Existing documents only; Dot PAUSED; judgment/notification/mail and operational limits unchanged. No implementation, parse/model/test, acquisition, MCP or activation grant.

## Sources And Conditional Selection
RT=[reference target](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_INDEX_REFERENCE_TARGET_DESIGN.md), SHA-256 56aa016911b3e36a4d5f4f6ea3851de5c96e4706f88fe0190cc09cbb7763a6d3, 10233 bytes at baseline.
Keep RT's PR/BND/ORD/KVS/H/C/S/I bindings/precedence; S19-21 supersede C31. B is conditional, not adopted. Key-close lookup/object-close release and owner/driver gates remain OPEN.
Propose a per-object in-place sorted-reference vector, key-record indirection and descending shifts. Logical fields/steps, not a host layout/container, pointer width, primitive, allocator, registry or capability adoption. Missing evidence blocks; no alternate-algorithm fallback.

## Logical Records And Ownership
Bind response/source/purpose/attempt/profile, owner/object generations and key identity. Shared fields preserve all bindings/costs with evidence.
| Record | Complete logical obligations | Boundary |
|---|---|---|
| KeyRecord | Key/object identity/generation, complete valid decoded UTF-8 reference/extent/generation, ownership/stability | CP-K reserves logically, not completed text/free storage. No borrowed views/substrings. |
| IndexEntry | Qualified reference to KeyRecord identity/generation | No unreserved value-node/value-dependent edge. ID/hash authenticates no handle/content. |
| IndexControl | Backing identity/generation, capacity, committed count/view generation, use-validity, mutation binding | Qualify access/encoding/publication; no guessed word size/free flags. |
| MovementCursor | Owner/object/candidate/content/decision; k/p, source/destination, phase, scratch identity/validity, field offset, effects/charges | Bounded progress, no parser state/log/recovery/controller. |
| Result correspondence | Separate insertion-order key/value relation and retained-key owner | CP-V establishes logical node/map, not physical edge/publication proof. |

Before CP-U qualify stable complete candidate content and S0/view excluding its reservation. RT KA03 means comparison bridge, not candidate entry/S1 before commit. Earlier equal-content different reservations remain duplicates.
Key identity differs from address/position; prove resolution across yields/moves. Any directory/pool/relocation/generation storage needs qualification/costs.
Index retirement frees no result keys. No temporary disguised as result may cross handoff; prove receiver-compatible key/edge ownership and charge conversions/copies.

## Preconditions And Extent
Let k be prior unique-key count, p the qualified rank (0<=p<=k), c the qualified provisioned capacity. Check k+1<=c and existing key guards; k<=255 for an admitted next key. No new allowance.
No automatic open-allocation/growth/reallocation/vector copy. Prove provisioning/initialization/headers/legal driving. Insufficient capacity blocks/refuses before mutation.
CP-K already reserved the pending key P. Require CP-U non-duplicate outcome plus exact rank/order/view/lifetime evidence. Membership alone proves no rank; bind rank to S0/comparison order. Missing evidence blocks, not a free rescan.
Historical S0 grants no mutable-backing access. No normalization/case-folding, host sort/hash/memmove, value scan-ahead or caller-supplied rank.

## Proposed Reflection Stages
Internal labels only, not new states/operations; require existing legal calls and bounded known progress.
| Stage | Required action | Qualified effect |
|---|---|---|
| IR0: preflight | Check decision/rank/content/view/owner, exact extents, work/capacity/cleanup | No mutation/node/map; checks/failures charged. |
| IR1: colon | Consume legal pre-colon whitespace/colon under B's guards | No premature index mutation; bad colon keeps key charges, no node. |
| IR2: prepare | Bind mutation/cursor/new view generation; revoke lookup before slot writes | Historical absence is no usable snapshot; retain all liabilities. |
| IR3: move | For i=k-1 down to p, resolve i into scratch; copy all fields to i+1 | Keep identity/field progress; no partial lookup/CP-V. |
| IR4: candidate | Write complete candidate reference at p after shifts | No q/n increment/re-reservation; bytes are not commit. |
| IR5: prepare commit | Check order/correspondence/once-only effect/completed cursor; retire scratch alias boundedly | No free full scan/early result/false release. |
| IR6: qualify | Qualify count k+1/new view generation/use-validity once | S0->S1, internal index only; partial/unknown metadata is no commit. |
| IR7: value | After IR6, process legal whitespace/value start with existing guards | CP-V: distinct node,n+1,P->M once,q unchanged; container node+depth together. |

IR2 follows IR1. Changed view/content/owner needs a qualified bridge; no replay/budget refill.
Scratch is a multi-field record, not an atomic pointer copy. Before each overwrite qualify source/aliases and reserve work/capacity/cleanup. Partial fields are not handles.
Descending movement preserves next source only in the vector model. Prove physical ranges/aliases, stable resolution and no reentrant/external reads; serial driving alone is insufficient.
Prove each effect/cursor acknowledgement across legal yields. Resume known completed prefixes only; unknown writes stop, not replay/guessed advance. No crash/restart recovery.
Final qualification assumes no atomic multi-field write. Prove use-authority/count/generation/failure consistency; intermediate metadata grants no access. Generations cannot wrap/reuse stale views.
Indivisible primitive exceeding a whole step rejects the profile before effects. Otherwise yield before an effect exceeding the remainder. No larger step/timer/new operation.

## Progress, View And Result Separation
Fix k/p/source bindings per candidate. Each shift reduces remaining moves; bound/charge field/scratch progress. Cover k=0,p=k,p=0 without reading uninitialized tail. No no-progress loops/repeated writes/free checks.
IR2-IR5 grants no lookup. Historical S0 authorizes no old reads; mixed/duplicated entries are neither S0 nor S1. Prove no caller/callback/receiver can observe mutation through aliases.
Cursor cannot reset input/admission/receipt/CP-U credit/q/n/budgets. Known IR6 completion permits no reinsertion/self-duplicate lookup; later use still needs current-view qualification.
After IR6, value refusal retains key/index costs without fictitious node/map; after CP-V retain committed witnesses. Sorting changes no result order or next-key grammar permission.

## Driver, Failure And Release
BND governs input exhaustion: no Idx in NEED_INPUT or invented bytes/calls; READY/YIELDED needs real admitted unconsumed input. Empty delivery/EOF/finish supplies no hidden mutation work.
Known progress continues only with same owner/legal state. Cancel/refusal freezes grammar/witnesses; same-owner cleanup releases qualified resources only. Owner loss/unknown write/commit/release blocks continuation/next acquisition.
No rollback/reinsert/repair/new owner/journal/retry/allowance. Unknown resources remain charged until qualified release. Terminal cleanup cannot complete IR6/resume parsing.
Close retires index with bounded normal work, no unbounded finish sweep/result-key release. Index/scratch/key backing/receiver release, GC and transport settlement differ.

## Capacity And Work Obligations
Manifest key/index backings/entries, scratch/candidate aliases, cursor/control/view/generation, registry/pool/headers/alignment, source/private input/carry and result keys/edges. Count shared backing once in full, every alias/operation, distinct copies separately.
Peak includes whole provisioned vector, retained keys/results and movement/control temporaries together. Logical reference copying does not imply payload copying; actual payload copies need charges. Key/node counts bound no allocations.
Move count is k-p. Charge preflight+(k-p)*full-entry-move+candidate write+all validation/commit/alias-release/dispatch/cursor work. Coefficients/repeated-pass maxima UNSET; no one-unit API/record assumption or Wn/Ws/Wf/Wc fit claim.
Before effects/references reserve work/capacity/worst cleanup liability. Movement/retirement uses normal work, not terminal reserve. No dropping-ref refund, absent-zero term or root deduction at handoff.

## Acceptance And Open Evidence
Review fields/rank/candidate exclusion, stage guards/effects, legal yields/ranges, scratch/cursor prefixes, visibility, once-only commit, CP-V separation and failures.
Paper cases only, none run: empty/first/middle/last insertion; equal/escaped-alias duplicate; stale key/view generation; each field/shift yield; unknown write/commit; colon-end input; whitespace/EOF; capacity/step/cleanup refusal; CP-V refusal after commit; close with result keys retained.
OPEN: provisioning/encoding, stable authenticated resolution, rank proof, effect/cursor and final-commit atomicity, alias exclusion, finite costs/release and input-boundary driving. Preservation/A1-A3/A4-A7/E03/E05/E06/host gates stay OPEN.
Separate approval: independent review/result saving, algorithm/representation or B adoption, proofs/models/tests, policy waiver, implementation, new evidence, actual operations, MCP/activation, commit/push.

## Approved Retention
Baseline C532233/U102807/unallocated19968; cap655360/guard352. Reserve16384 only from unallocated ->3584: design10240/review4096/integration1024/stop1024; before charges U119191. Old reservations/charges remain; no transfer/refund/spare reuse.
Create DESIGN and BACKLOG/640K links only. REVIEW/STOP absent; review physical metadata1024/review1 1536/review2 1536 includes headings/links. Stop on section/file shortage; no truncation, borrowing, alternate log or expansion.
Charge D10109/L581; current C542923/U108501; cap655360/guard352/unallocated3584. Includes this line; no runtime grant.
