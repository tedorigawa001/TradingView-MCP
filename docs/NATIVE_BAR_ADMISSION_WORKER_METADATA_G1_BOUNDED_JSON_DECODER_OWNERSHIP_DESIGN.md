# G1 Ownership, Aliasing And Copy Contract
DESIGN_ONLY, baseline392d5f5. Approved design documentation only, not a policy exception, implementation, import, parser/model/test execution or operational authority. Dot PAUSED; judgment/notification/mail, M bounds and D01-D08/B01-B08/G2 gates remain. No qualified producer, lease, copy primitive or host is claimed identified.
Refine the [input/state contract](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_INPUT_STATE_DESIGN.md) and [counter contract](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_COUNTER_DESIGN.md); do not silently reinterpret their limits or invariant-preserving errors.

## Candidate And Principals
Propose one mode: bounded per-delivery copy from a qualified stable-read lease into decoder-exclusive storage. No automatic zero-copy, ownership-move, other-parser or whole-response text/json/arrayBuffer fallback. Copying one delivery does not authorize collecting the full response.
The delivery producer owns the source allocation. The decoder resource owner holds admitted leases, private input, carry, keys, tree and temporaries. A receiver owns the successful result only after one explicit handoff. The resource owner exists from begin; cancellation never creates a new unowned cleanup task.
The source remains producer-owned and unmodified by the decoder. A lease must exclude source mutation throughout copying and all yields. Neither caller assertions, owned:true, type checks, readonly/freeze nor a matching hash proves exclusive/stable ownership or authentic origin.

## Handles And Aliases
Admit only qualified internal handles bound to source/purpose/attempt/profile, delivery sequence, span, backing-allocation identity/generation and validated extent. Handles/descriptors do not mint authority. Untrusted objects, getters/proxies and raw caller Buffers are not a qualification shortcut. Validation itself needs inert qualified metadata access.
Reject unproved shared, resizable, detachable or externally mutable source storage. Partial/pooled views require the full backing extent, alias/mutation rules and lifetimes to be known and bounded; the visible byteLength alone is insufficient. Do not perform new host/native introspection to fill missing evidence.
Do not retain a borrowed source view/substring in carry, keys, tree or output. Unknown string slicing/rope or view backing behavior is not assumed to create an independent copy. Only a separately evidenced copy/storage mechanism can satisfy the contract; absent evidence stops execution.
Track internal view/owner relationships explicitly. No source capability, writable alias or input backing view escapes to callbacks, logs, caches or result receivers. No new user-supplied callback is introduced.

## Admission And Internal Phases
Check existing operation/state/binding/sequence/extent, delivery/body/batch limits and work/capacity/ownership-profile guards before obtaining parser retention or starting a copy. A guard refusal admits nothing, leaves the delivery with its caller and preserves observed received costs.
A qualified all-or-nothing operation must establish the stable lease/reservations and commit admission once. Do not infer atomicity from a multi-step rollback. If the primitive/ownership proof is unavailable, no executable profile is qualified. Preparation performed by the producer remains charged to its own owner.
Commit admitted counters once for the delivery extent, not copy segments; admission is not grammar/EOF success. Live allocation/copy failure after admission -> REFUSED. Preserve admitted charges/ownership until release confirmation; bounded cleanup only. Valid pre-commit cancellation -> CANCELLED, with the same charge/ownership rules.
Keep public READY/YIELDED with an internal resource phase:
- COPY_PENDING: copy bounded segments into private input; retain stable source lease. No grammar reads the source directly.
- RELEASE_SOURCE: after copy completion, confirm lease release before grammar work.
- PARSE_READY: parse only private input using the existing structural/scalar/work guards.
- RELEASE_INPUT: after consumption, release temporary input ownership before NEED_INPUT or WAIT_EOF.
A pending copy/release is not drained input. Do not admit another delivery or accept finish while these phases keep the parser READY/YIELDED. This is a proposed connection to the existing state contract, not a new public operation, worker, timer or execution path.
Copy progress and grammar-consumed position are separate, exact and monotone. Preserve phase/offsets across yields; do not repeat completed writes/reservations. Empty deliveries still count under the counter contract. Copy segments do not add deliveries or value nodes.
While live, a release with known bounded progress may yield in READY/YIELDED in its release phase; advance continues that operation only. Failed/unknown/exhausted release or lost owner/progress -> REFUSED; keep ownership for cleanup. Unconfirmed never means freed.
Finite segment work, capacity and release allowances are UNSET. No immediate synchronous preemption or wall-time promise. No retry, alternate copy mode, hidden full-buffer collection or second owner on failure.

## Accounting And Logical Lifetime
Count every simultaneous source backing allocation, private input, decode carry/text, keys, stack/tree, projection, error data and copy temporary, plus handle/view metadata. Reserve before retention/allocation/copy, not after observing success.
Count a backing allocation once at its full retained capacity when several internal views reference it, but charge all view metadata and operations. Equal bytes in distinct allocations are separate resources. Do not deduplicate actual copy/scan/hash costs by content or count an unknown pool as the visible slice.
Receiving a byte and copying it are distinct charges. Keep receipt/admission counters unchanged by internal segmenting while adding actual copy/read/write/validation work. Dropping a reference never refunds cumulative work, body, node or key charges.
Token-local reset/consumption does not prove backing storage is no longer retained. Live-gauge reductions require the corresponding logical release, not a guessed GC event. Exact layout, bounded ownership registry, allocation/copy formulas and runtime/GC overhead remain open; no RSS or total heap bound is claimed.

## Refusal, Cancellation And Owner Loss
REFUSED/CANCELLED stay terminal for parsing: no resume, re-admission, retry, rebinding or partial output. The existing resource owner may perform bounded release only, never restart grammar work. Body-free errors record bounded reason/position and nonsecret resource identities, not bytes, private paths, addresses, credentials or capabilities.
Release the source lease and private temporaries under reserved cleanup rules; do not falsely return the source as a newly transferred allocation. Its producer ownership never changed. Partial destination copies remain private until released.
Keep cleanup pending/confirmed/unknown separate. Unconfirmed release or owner loss blocks the next acquisition and result publication; another process's identity or wall time cannot establish cleanup or permit automatic recovery. No new controller/job/recovery mechanism is authorized here.
Reference release, physical reclamation, erasure and transport settlement are different facts. Confirm only the observed logical ownership release. Missing native/host/producer evidence is a blocker, not zero cleanup cost.

## Success And Result Handoff
finish keeps EOF/root/stack/carry/counter gates. Preparation must fit reserved work/cleanup. If temporary release or receiver readiness remains unconfirmed, enter REFUSED before commit; no deferred finish. Keep ownership/cleanup pending. Readiness does not publish.
One qualified atomic/non-failing handoff commit jointly sets DONE, transfers result ownership to the receiver and removes parser ownership/references. Before commit the decoder owns the result: technical failure -> REFUSED; accepted cancellation -> CANCELLED, no publication. After commit only the receiver owns it; decoder cleanup must not release it. DONE cannot be cancelled/reversed; an unknown return/delivery outcome never permits republication.
Result storage cannot alias borrowed source/input backing; no parser cache or hidden references. Readonly/shallow freeze is not proof. Handoff atomicity and serialization against cancellation need evidence; otherwise execution stays blocked.
No implicit fanout, receiver callbacks, user-prototype setters or secondary result copies. Multiple receivers, deep immutable snapshots or a different ownership mode require separate profile, capacity/work accounting and approval. A result digest is not source authentication or a receipt.

## Open Gates And Documentary Acceptance
Required later evidence: producer/lease identity and stability, alias enforcement, atomic admission, copy/storage mechanism, finite segment/cleanup work, bounded registry, release/handoff commit facts, source/host initializer closure and allocation/copy coexistence formulas. No guessed constructor, builtin behavior, runtime path or absent cost is supplied.
Propose, do not run: mutation/alias attempts across yields; pooled/partial/shared/resizable/detachable sources; refusal before retention; copy allocation/failure after admission; empty deliveries; copy/parse offset preservation; carry/source-view leaks; cancel during every phase; unresolved release/owner loss; EOF with pending resources; double/fanout handoff; distinct equal-content allocations; no-refund accounting.
This is still a proposed ownership contract. Code, synthetic tests, registration, production activation and a no-handwritten-parser policy exception all remain separate approvals.

## Approved Recording
Unallocated110080 ->design10240/review4096/integration1024/stop1024=16384; remainder93696. Review physical metadata1024/R1 1536/R2 1536 includes headings/links. Cap524288/guard352/prior reservations stay; docs applied only.
Charge D10178/L0693; current C383050/U47190; includes this record's bytes. Counter-runtime, code and test grants remain absent.
