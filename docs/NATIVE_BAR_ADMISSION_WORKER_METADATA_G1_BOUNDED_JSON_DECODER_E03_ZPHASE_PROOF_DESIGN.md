# Zphase: Normal Work At Exact Input End
2026-11-06 JST. DOCUMENTARY PROOF WORK; no model run, test, implementation, route selection or host qualification. Baseline HEAD 85731a846770b8898fafd3df5f95b23b677397c8. RUN1/RESUME01 STOP and no-retry stay. Zphase stays OPEN; nothing here is adopted and no conflict is resolved.

## Scope
Item 1 of the [proof procedure](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ROUTE_PREMISE_PROOF_DESIGN.md), whose Scope defines I/OWN/S/G/RR/BND/Z-A, model, RUN2 and boundary review. Also KVS=[key/value state](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_KEY_VALUE_STATE_DESIGN.md), ORD=[order comparison](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_INDEX_ORDER_SELECTION_DESIGN.md), CW=[capacity/work](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_CAPACITY_WORK_DESIGN.md), CONS=write/cursor, Route=route comparison, [ZEXIT](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ZEXIT_PROOF_DESIGN.md) for what follows this work and [TRACE](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_C4_C5_TIMING_TRACE_DESIGN.md) for policy B. I8/S28/Z-A64 and model165 are line references; ZA2/CB3/G5 are IDs.
Every argument assumes ownedKeys, knownAck and serialDriver, and object close also closeWitness; these are dependencies, not facts. CONS addresses index writes, so it applies to lookup and retirement only by analogy. Z-A is an unadopted proposal (Z-A19, Z-A51).

## Claim
Claim (OPEN): a legally enabled bound normal action may progress at pos=end before input release, including across a legal yield (Route24, ZA2-3). It claims no invented byte, no work needing a future byte and no work in release or a waiting state.
READY alone proves nothing: a final colon can exhaust both input and fuel, and READY/YIELDED neither authorizes Idx nor shows a same-owner continuation or qualified effect (proof line10, CONS63).
Z holds the consumed input through this work, so its peak has input and index temporaries together (ZA2, Route47, boundary review line14).

## Three boundaries, three kinds of authority
| Boundary | Action and effect class | Existing text | Status |
|---|---|---|---|
| Key close | CP-U lookup: comparisons read-only on index and keys, with resumable offsets (S25, KVS34) | BND6/56 leave it OPEN; ORD45 asks for proof; no row forbids it unless "inputless" is read broadly | Authority gap |
| Post-colon | Idx: preparation, shifts and final commit; multi-field mutation (ORD6, RR43-47, CONS25-28) | CB3, BND42 and BND54 expect real input; CB0 waits instead; RR56 keeps the premise OPEN | Strain; conflict if CB3 is exclusive |
| Object close | S28 retirement: incremental release of lookup ownership (S28, RR59) | S28 places the work under READY/YIELDED; BND6/56 and ORD45 leave it OPEN at exhaustion; the state has no row (Route52); pop timing OPEN (G5, G line47) | Work closest to text; state and facts remain gates |

So Zphase need not stand or fall as one: the CB3 and BND strain sits only at post-colon, though "inputless" reaches all three if read broadly. A composite with Z at key close and object close and W at post-colon would leave CB0 and CB3 untouched. It would pay with WcarryAcrossWait for Idx, remove Idx from Z-enabled work (Z-A35, Z-A70, Z-A82) and still need amendments 2-6 below. No document compares it, RUN2 says nothing about it and no automatic hybrid is allowed (Z-A24, Route29-30, Z-A124). It is noted, not selected.

## Clause correspondence
| Clause | Z at exact end | Relation | Needed |
|---|---|---|---|
| I7 | State stays READY/YIELDED, so admission stays an error | Compatible | None |
| I8 | Zero consumption fits "exact consumption"; the gate is state only | Compatible, no authority (Route19) | Phase authority |
| I9, CB8 | Finish stays an error | Compatible | None |
| I15 | Fuel yield resumes without new input (ZA3) | Compatible | None |
| I16 | Latch at completion, which follows retirement (S28) | Compatible | Z-B proof |
| I17 | Commit waits for settled work; a byte-end reading would conflict | Ambiguous (ZEXIT gap 2) | Named reading |
| I18-19 | DONE and terminal rules stay as written | Compatible | None |
| OWN21-22 | Copy and source release finish before this work (ZA0, Z-A41) | Compatible | None |
| OWN23 | Work in PARSE_READY reads no input, though the row says parse | Silent | Phase row |
| OWN24 | Work sits between consumption and release | Silent on order | Phase row |
| OWN25 | Its list names copy and release only | Extension (boundary review line14) | Approval and proof |
| OWN27 | Release stays release-only; work ends first (Route42, Z-A75) | Compatible | None |
| S25-28 | Bounded resumable normal work, with no input condition | Compatible | Costs OPEN |
| KVS34 | Search state kept; later bytes not parsed | Compatible | None |
| BND19, RR56 | No Idx in NEED_INPUT; Z stays READY/YIELDED. RR56's real-input premise stays OPEN (BND42 row) | Compatible on Idx | None for that sentence |
| CB0 | Same situation, other outcome: Idx settles before NEED_INPUT | Conflict if exclusive | Named amendment |
| CB3 | Idx runs with no real unconsumed input | Conflict if exclusive | Named amendment |
| BND41 | Positive charged progress | Compatible | Evidence |
| BND42 | The premise line; Z holds only consumed input | Strain | Named amendment |
| BND54 | Lists real input across zero-byte progress as a proof duty | Strain | Named amendment |
| BND56, ORD14 | "Inputless" is undefined | Conflict only on a broad reading (ZEXIT gap 5) | Scope the word |
| CB6 | No task is pending at an empty delivery: work settled first | Compatible unless "inputless" covers it (Z-A121) | Scope the word |
| CB11 | Unknown outcome stops; post-state open (ZEXIT gap 6) | Direct at post-colon, analogy elsewhere | Same gap |
| CONS63 | Requires proof, grants none | Compatible | This proof |
| ZA1 | Bytes remain: task first; not this claim | Unadopted | Adoption |
| ZA2-3 | The authority claimed | Unadopted | Adoption |
| ZA4 | Exit once settled (ZEXIT) | Unadopted | Adoption |

## Exact-end traces
| Point | Key close | Post-colon | Object close |
|---|---|---|---|
| Last byte's event | Closing quote consumed; R1->R2 (KVS13-14) | Colon consumed; R3->R4, no CP-V (KVS15-16, BND11) | Close classified and consumed, no pop (Route52) |
| Reservations | q/n unchanged (KVS25) | q/n unchanged (CB4, ORD12) | M/f/q kept; depth pops once at qualified close (Route53); timing OPEN (G5) |
| Known effect | Comparison result, offset, charge | Field or entry write through acknowledgement (CONS17, CONS28) | Release cursor and live gauge (OWN27 by analogy) |
| Unknown outcome | Stale view or cursor blocks; no repeat credit (KVS25, KVS34) | Block, no replay (CONS38, RR57) | REFUSED with block (OWN27 by analogy, RR57) |
| Final outcome | Duplicate: REFUSED in this delivery, which would meet policy B but is not required (TRACE43). Unique: R3, then ZEXIT E1 | IdxDone; value needs a real byte, then E1 (CB4, CB5 by analogy) | Pop once, then parent or root, all under Z-B; then E1 or E5 |

For all three, with fuel remaining or exhausted, before and after each known effect:
- Fuel remains and the next unit fits: it runs.
- Fuel ends on the last byte or after a known effect: YIELDED with the bound task and known prefix, or settled context if that was the task's final effect; the next advance resumes it (ZA3, I15, CONS42). It cannot end inside an admitted effect-to-acknowledgement unit (CW38, CONS26).
- The unit exceeds the remainder but fits a whole step: yield before effects (CW39, CONS34).
- The unit exceeds a whole step: reject the profile before work (CW40, CONS35).
- Known failure or exhausted normal budget: REFUSED (CW43). Owner loss: REFUSED with block (Z-A90).
- Cancel lands only at a legal yield (I10, S43); cleanup cannot finish the task (Z-A91).
- Stop at unknown phase authority, cursor, effect or budget; retryability is never inferred (CONS38, Z-A92).

Under order B (ORD21) with task first (ZA1, KVS15, ORD37, S28), one byte binds at most one of these tasks; completion leaves refusal, or a future byte or tail state with ZEXIT's OPEN entry next (shape: model90, model179, model188, model201). Z-A64 allows a further no-byte action; here that is control work owed to Z-B.

## Preservation and termination
Invariant from binding until the task ends: same response, owner, object and candidate; position at end, input held, no byte re-read; bound task with known prefix; prior reservations; monotone charges; public state READY/YIELDED.
Preservation, if knownAck holds: an acknowledged unit changes only its authorized prefix and charges, and a yield only charged checks; neither touches input position or reservations, and only a completing unit makes its boundary's transition (R2->R3, IdxDone, pop) (Route47, Z-A65, KVS34, CONS36).
Termination obligation, with a lexicographic measure:
- Key close: comparisons left, then byte pairs left, then control; at most ceil(log2(k+1))<=8 comparisons, none at k=0 (S25).
- Post-colon: preparation stages left, then moves left r=k-p with scratch and write fields left in each, then candidate-write fields, then final-commit stages (RR IR0, IR2-IR6, CONS48-49, RR50, RR64).
- Object close: index records left; zero entries still cost control (S28, Z-A103).

Obligation of this document: each unit with its dispatch and resume checks must fit one whole step; a larger primitive is rejected (CW40), and stale preparation blocks (CONS42). Given that, and a step allowance refilled per advance (CW30, CW39, model102), each legal advance completes at least one unit, so advance calls are bounded by units.
Not shown: unit sizes and coefficients are UNSET (RR64, CW15); that the driver keeps calling (Z-A67); that a valid document fits Wn (S29, Route55). The bound counts calls, not time (CW31). Invalid calls spend the owner's dispatch ledger and move no measure (S9, CW42, ZEXIT gap 8). Exhausted budget ends in REFUSED: termination, not success.

## Amendments named, not made
Precedence between these sources is not decided here. Until adoption, existing bindings stand (Z-A17, Z-A19); adoption must name superseded sentences and has separate approval (Z-A123, Z-A132). Route74's wider map (S29, S42-45, G30/41-47, CB7) stays for route selection.
1. Post-colon: either amend CB0, CB3, BND42 and BND54 to admit exact-end Idx in a named phase, or keep them and exclude post-colon from Z.
2. Scope "inputless" in BND56 and ORD14 (Z-A121).
3. Adopt ZA2-3 or an equivalent phase row, and extend OWN25's list (boundary review line14).
4. Fix a reading of I17 (ZEXIT gap 2).
5. Key close: add a zero-byte lookup row; BND does not cover it.
6. Object close: prove the pending-close representation and pop timing (Route52, G line47).

## Model and RUN2 cross-check
Read by hand. It supports the shape only:
- Only Z runs a task at exact end (model165). RUN2 lines41-42 give zeroWork 25 for both routes, but exhaustedWork 25 for Z and 0 for WH (columns line16, model318-319). So zero consumption is not what separates them; having no real byte left is. These are maxima, possibly from different runs.
- Lookup is one tick (model179), so resumable comparison is not exercised. Idx and retirement are abstract tick counts (model188, model201).
- Not modeled: budgets, unit size against a step, yield before effects, and unknown lookup or retirement. The write plan fires only at an insert task, as do cancel and owner plans (model127, model300). V_LOOKUP, V_COLON and V_POP have no detection control (RUN2 line14).

## Required before closure
Bind: the amendments above and their precedence; an identified legal continuation; stable owned input and control through the work; primitive-to-acknowledgement semantics; finite unit, step and dispatch bounds; parent lifetime (proof line10) and driver lifetime (Z-A67). Until then Zphase is OPEN, and evidence alone adopts nothing (Z-A132). No route choice, Z-B proof or execution follows.

## Retention
Reserve13312 from F15360 ->2048: design12288/integration1024. Review and STOP are unreserved; saving either needs new allocation. Ledger and backlog growth charges integration1024; actual charges are in the ledger. No truncation, borrowing, refund or transfer.
