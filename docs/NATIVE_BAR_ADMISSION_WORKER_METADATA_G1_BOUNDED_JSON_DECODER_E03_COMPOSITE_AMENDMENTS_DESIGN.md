# Composite Amendments And Z-B: Candidate Text
2026-11-07 JST. DOCUMENTARY; no model run, test, implementation, clause adoption, route selection or host qualification. Baseline HEAD ed2e9f70317b50e6cccea49d4eedf5f6e0231ce5. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
The last stage [COMPOSITE](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_COMPOSITE_ROUTE_DESIGN.md) names (line64). [WCARRY](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_WCARRY_PROOF_DESIGN.md) holds N1 and N3. Aliases are as in the Scope of ZPHASE; "amendment n" is its list; E0-E7 and B1-B7 are ZEXIT's; X1-X4 are COMPOSITE's. S28 and model143 are line references; CB3/ZA2 are IDs. CR, KC0-KC7, PC1-PC6 and CL0-CL5 label text here only, not states or APIs. CONS reaches lookup and retirement by analogy (ZPHASE line6).
Quoted text is a candidate. Adoption must name superseded sentences and needs separate approval (Z-A123, Z-A132). Amendment 1 would take its second branch (COMPOSITE line41), so CB0, CB3, BND42 and BND54 stay as written.
Assumed, not facts: ownedKeys, knownAck, serialDriver, closeWitness, order B (ORD21), CB3 as Idx's only driver; Zphase for work at exact end; Zexit after it; WcarryAcrossWait.

## Amendment 2: "inputless" (the gate)
BND56 and ORD14 ban an inputless exception without defining it. A broad reading catches zero-byte lookup, retirement, B1-B6, OWN27 and CB6 (boundary review line18, ZEXIT gap 5).
Candidate: "An inputless exception is a call, pulse, timer, fabricated delivery or hidden continuation added to drive work, or normal task work outside READY/YIELDED. A legal advance in READY/YIELDED under a row naming its zero-byte work is not one merely because no byte remains. The word grants nothing: zero-byte work with no such row stays unauthorized."
Banned: advance in NEED_INPUT (BND19, RR56, ORD45). Unauthorized: Idx at exact end, which has no such row. Outside the ban: KC, PC, B1-B5, CB6's trip and N1's exit, each under its own row. BND56's other bans stay.

## N2: narrowing Z-A
Idx is literally "runnable without future bytes" (Z-A29) but does not settle before release here, and it is no future-byte dependency (Z-A30, Route18): CB3 holds real input without reading it. New category, candidate:
"Known route-deferred action: at exact end, a fixed route assignment defers a bound task that needs no future byte's content to a named driver. Under the composite only Idx at R4 + IdxPending, driven only by CB3, after N1's exit and CB0. It is not Z-enabled, not a future-byte dependency, and no effect of it has begun (X2)."
With bytes left nothing is deferred: CB3 runs it first (ZA1).
| Sentence | Change under the composite |
|---|---|
| Z-A29, ZA2-3 | Z-enabled means lookup, retirement and pop; route-deferred excluded |
| Z-A35 | Drop the post-colon Idx example |
| Z-A70, ZA4 | Release entry also admits a route-deferred action with no effect begun; "cannot conceal runnable work" keeps every other case |
| Z-A82 | Stands once narrowed; IdxPending may stay bound (CB0) |
| Z-A24 | Stands for plain Z; CR is the composite's own row |
| Z-A30, ZA5, Z-A75, Z-A99, Z-A101-102, Z-A121 | Unchanged; CB3 binds Idx only, so no blanket real-input rule |

Candidate row CR: "At exact end in PARSE_READY, saved grammar and phase evidence select one row: R2 -> KC; pending close -> PC; R4 + IdxPending -> N1's exit, then CB0, with CB3 as Idx's only driver; no task -> ZA4. Unknown blocks (E7). No runtime route choice, fallback or Idx in any other row." It is a function only if X1 holds. It gives WCARRY gap 5 text, not proof.

## Amendment 3: phase row and OWN's list
ZA2-3, narrowed, serve as the row. Candidate OWN edits:
- OWN23, for the final period: "; it may also hold a bound lookup, retirement or pop, or CB3's Idx, which read no input."
- OWN24, after "after consumption": "and after any bound lookup, retirement or pop settles".
- OWN25: "A pending copy, release, bound lookup, retirement or pop is not drained input."

Idx stays off OWN25's list (WCARRY line47). OWN27 stays: a yielded release continues release only, so no task interleaves. Input and task temporaries still overlap (boundary review line14, Route47); no fit is claimed. B6's phase (ZEXIT gap 3) and the atomic or intermediate form stay unselected.

## Amendment 4: reading I17
Candidate: "'Input exhausted' in I17 is the state boundary (Route13-16): position at exact end, no Z-enabled task, that input's release confirmed, witnesses known. Position at end alone is not exhaustion. A route-deferred action may stay bound through it (CB0)."
I7 and I9 gate on state, so "drained" (ZEXIT gap 1) stays a wording issue.

## Amendment 5: key-close rows
BND6 and BND56 leave this out. Candidate rows; with bytes left ZA1 and KVS14 bind lookup first and KC1-KC7 apply. Measure: ZPHASE line77.
| ID | Situation | State | Obligations and outcome |
|---|---|---|---|
| KC0 | Closing quote is the last byte (R1->R2) | READY/YIELDED, PARSE_READY, lookup bound | q/n unchanged (KVS25); input held; no colon, value or release (KVS34, ZA2) |
| KC1 | advance | Same | Next comparison unit over owned key text and S0; reads no input. k=0 still charges control (S25) |
| KC2 | Fuel ends, or next unit exceeds it | YIELDED | Interval and offset kept, no repeat credit (KVS34); yield before effects; over a whole step rejects the profile (CW39-40) |
| KC3 | Duplicate | REFUSED in this delivery | Key reservation kept, no node (G2). Meets policy B, which does not require it (TRACE43) |
| KC4 | Non-duplicate | R3, no task; may yield (ZA3) | Next byte, or E1 with decision and rank carried; no clause holds them past release (WCARRY gap 1) |
| KC5 | acceptDelivery or finish | Contract error | State kept, dispatch charged (I7, I9, I11, OWN25, Z-A89) |
| KC6 | Serial cancel at a yield | CANCELLED | Cleanup never finishes lookup (S8, Z-A91) |
| KC7 | Known failure or budget end; unknown view or owner lost | REFUSED; REFUSED with block | CW43; no replay (CONS38, Z-A90, RR57) |

## Amendment 6 and Z-B: object close
Claim (OPEN): from a classified valid close (G5), the pending close holds through any yield until a terminal row or one pop; the pop brings value completion and parent return, or root completion with its latch, once, and no later byte is classified before that.
Candidate order: classify and guard -> consume and bind retirement as one unit -> retire index records (S28) -> pop unit -> E1, E5 or the next byte. An array close has no retirement (G6, S24), so no pending close.
Pop timing, candidate: late, after the last retirement unit. S28 keeps the object uncompleted meanwhile and Route53 bars an early parent property or element. Early pop, at consumption, is not chosen and not refuted: it needs a separate record under a parent frame that looks current, and removes the object from O (K5, G5's row) with its index live. Late pop keeps D counted through retirement; no guard reads it, since no byte is classified (PC3).
Pending-close representation, candidate: "An owned record of object generation, close witness and retirement cursor, kept with the unchanged frame. Not a state."
- PC1: consumed once. Position is past the byte, never re-read; the witness replaces it (unlike H: Route52).
- PC2: frame, O, D, M, f, q and n unchanged until the pop unit (G5, Route53).
- PC3: closed to grammar. With bytes left no byte is classified (ZA1); with none, no exit (E4).
- PC4: not complete: no value completion, parent return, root witness, latch or WAIT_EOF (S28, Route54, Z-A83).
- PC5: retirement touches index records only; key text and edges stay (S28, G5, RR59). Cursor known, monotone, once only.
- PC6: normal work pays, charges only grow; no cleanup budget or finish sweep (S28, RR59, RR65).

Preservation, if knownAck holds: an acknowledged unit changes only cursor, records, gauge and charges; a yield changes no progress. Termination: records left, then control (ZPHASE line79), each unit fitting a step; sizes UNSET. Completion enables the pop unit under Z-A64, not by looping.
Pop unit, candidate: "After the last record is acknowledged, one bounded unit pops D once, removes the object from O, completes the value and returns to the parent, or marks the root complete and latches tail-only." PC's end; one aggregate tuple (G36) that must fit a step (CW40). The latch is not delayed: I16 keys on root completion, S28 puts that after retirement, and no byte is classified between.
| Point | Fuel ends | Known failure, budget end | Unknown, owner lost | Serial cancel | Input |
|---|---|---|---|---|---|
| CL0 classified, no effect | Yield before effects | REFUSED | REFUSED, block | CANCELLED | Unconsumed |
| CL1 consumed, bound, none retired | YIELDED; resume | REFUSED; frame frozen | REFUSED, block | CANCELLED | Held |
| CL2 known retired prefix | YIELDED; no repeat | Same; rest is cleanup's (S8, CW53) | REFUSED, block | CANCELLED; no pop | Held |
| CL3 any unit's effect, no acknowledgement | Not reachable if admitted (CW38) | REFUSED, liability kept (OWN27 by analogy) | REFUSED, block, no repeat | Cannot preempt (Z-A91) | Held |
| CL4 all retired, pop pending | YIELDED; pop unit only | REFUSED, no pop | REFUSED, block | CANCELLED | Held |
| CL5 pop committed | YIELDED, settled (ZA3) | Grammar or B rows | Same | CANCELLED | Held to exit |

Cases: nested: parent object or array then expects comma or close, a byte or E1; its index is settled (X3) and stays live. Root as last byte: E5 and WAIT_EOF with no later delivery (Route55, boundary review line12), if the driver keeps calling. Root with bytes left: retirement first, then tail rules; a bad byte costs that work first, with no scan-ahead (I16, G41, S20). Empty object: zero records, control still charged (Z-A103). Pending key or trailing comma: no valid close, no binding (G30, KVS19). Finish (EOF) or admission here errors (I7, I9).
Gaps: closeWitness's grammar states (G47); record storage and cleanup coefficients (CW15, CW51-53); the pop unit's atomicity; K5 is one event; whether consumed-unpopped is K9's legal prefix (G34) is unproved (G36); parent return (KVS19, G47).

## Adoption package, if ever requested
Order: amendment 2; N2, ZA1; amendments 3, 4; N1, CR; KC; PC. Partial adoption fails: without 2 every row meets the broad reading, and KC or PC without 3 and 4 have no phase or commit reading.
Precedence, candidate: these rows govern only the sentences below; everything else stays, and a further conflict stops work rather than resolving silently.
| Named sentence | Change |
|---|---|
| BND56, ORD14 | "Inputless" scoped; BND56's first sentence scopes BND, so it stays |
| BND6, RR6, RR56, CONS63 | Only Z key/object close, real-input OPENs yield |
| OWN23-25 | Extended as above |
| I17 | Named reading |
| Z-A29, Z-A35, Z-A70, ZA2-4 | Narrowed; Z-A24 joined by CR |
| G30 with its C16, K5; G36, G47, Route52-53 | Pop timing and representation candidates |

Not changed: CB0-CB11, BND7, BND19, BND42, BND54, ORD45, S28, OWN27, I7-11, I16.

## What stays open
Candidates now exist for N1, N2, amendments 2-6 and Z-B; N3 has a decided criterion, not clause text (WCARRY gap 2). Writing them closes nothing. Still owed: every premise, ZEXIT gaps except 4, WCARRY gaps, the gaps above, what policy B and N3 leave uncovered, and finite costs, primitives, lifetime and parent bounds. Evidence adopts nothing (Z-A132).

## Model and RUN2 cross-check
Read by hand; shape only. V1 has no composite mode, so RUN2 is silent (COMPOSITE line60). Under Z the close is consumed at classification (model200); retirement and pop take records*fields+1 ticks, so an empty object takes one (model201, model212); the last tick pops (model143), matching late pop. The task runs before any next byte (model165). Not modeled: budgets, unit size, record storage, K5's split, failure, cancel or owner loss in retirement (model127, model300). V_POP has no detection control (RUN2 line14).

## Retention
Reserve13312 from F13312 ->0: design12288/integration1024, after moving 10752 of unspent reservations (ledger). Review and STOP are unreserved; saving either needs new allocation. Ledger and backlog growth, including the move's record, charges integration1024. No truncation, borrowing, refund or further transfer.
