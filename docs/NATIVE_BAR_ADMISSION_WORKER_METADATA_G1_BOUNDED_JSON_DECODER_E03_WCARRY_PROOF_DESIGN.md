# WcarryAcrossWait: Post-Colon Idx And R3 Carry
2026-11-06 JST. DOCUMENTARY; no model run, test, implementation, adoption, route selection or host qualification. Baseline HEAD 4b427c8a51b02233fbacd0f82c7f743fd44069e3. RUN1/RESUME01 STOP and no-retry stay. WcarryAcrossWait stays OPEN; nothing here is adopted.

## Scope
Item 3 of the proof procedure (proof line47), narrowed by [COMPOSITE](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_COMPOSITE_ROUTE_DESIGN.md). Aliases are as in the Scope of ZPHASE, plus C (counter) from TRACE's; "amendment n" is ZPHASE's list. S28 and model165 are line references; CB3/IR2 are IDs; X1-X4 and N1-N3 are COMPOSITE's. Dc is the delivery ending in the colon, Dn the next nonempty one; WR3, WP, WD and Car1-Car3 label rows here only.
Assumed, not facts: ownedKeys, knownAck, serialDriver, order B (ORD21), CB3 as Idx's only driver; Zexit for every exit; Zphase for a settled decision.

## What is left of item 3
Under COMPOSITE lookup settles before release, so CP-U across a wait, W's T2-T6 and key-close rows like CB0-CB11 (TRACE38) drop out unless the direction changes. One key's waits:
| Context | Exact end at | Task | Row | Route |
|---|---|---|---|---|
| WR3 | R3, unique key (ZEXIT E1) | None | None | Every (TRACE33) |
| WP | R4 + IdxPending, colon just consumed (E3) | Idx, not begun (X2) | CB0 | W only |
| WD | R4 + IdxDone | None | CB5 | Every |

WP is this direction's only wait of its own.

## Claim and conditional invariant
Claim (OPEN): from the release commit, WR3 and WP hold through any number of legal empties and any wait; Dn resumes grammar from WR3 and runs Idx from WP before any byte is classified (CB3-4); other events end under existing terminal or block rules. No claim about arrival, duration or budget fit (S29, CW31).
Invariant from the release commit until Dn's first byte (WR3) or IR2 (WP):
- Car1: same response, owner, object generation, candidate, key text and grammar witnesses; q, n, P unchanged; charges only grow (CB0, BND43, C5, RR52).
- Car2: UniqueValid, rank p, k and S0 view generation unchanged, in owned storage (BND17, KVS36, RR26, S45).
- Car3: index still S0: no mutation begun (X2), no other writer before CP-V (X1, RR7).

Argument: in NEED_INPUT only acceptDelivery, finish and cancel are legal (I7-11), invalid calls preserve state (I11) and no loop exists (BND50), so nothing runs during a wait. An empty's trip changes counters and resource records only (CB6, N1); induction covers any number. Serial driving does not show storage independent or alias-free (RR44, RR51).
Progress, by count only: each admission spends a delivery, empties included (C6, C13), so at most 1024 occur; Wn can refuse earlier (CW43). A valid document has a later byte (boundary review line12), so if it arrives and the driver calls, absent a cap, refusal, cancel or owner loss, Dn reaches CB3 and Idx's measure (ZPHASE line78) runs with input held. No time bound follows (CB1).

## CB0-CB11 correspondence
Conditional; BND stays a candidate (BND7). WR3 has no rows.
| Row | WP | WR3 analog | Needed |
|---|---|---|---|
| CB0 | E3 after B1-B7, with Car1-Car3 | E1 exit, no phase | N1; ZEXIT gap 3; gap 1 |
| CB1 | Waits; no lifetime claim | Same | Gap 6 |
| CB2 | Admit, then copy and source release, before Idx (OWN21-22) | Same, no phase | N3 |
| CB3 | Only Idx driver; input unconsumed, unclassified | None; bytes parse | Gaps 3, 5; BND41, BND54 |
| CB4 | IdxDone, then classify | Colon: R3->R4, then CB3 or WP | Reference target (BND55) |
| CB5 | Becomes WD | Whitespace stays R3 | None new |
| CB6 | READY, exit trip, no pulse | Same (E0) | N1; amendment 2 |
| CB7 | finish refuses; no Idx | I9 refuses | N3 |
| CB8 | Error, also in N1's state | Same | None |
| CB9 | CANCELLED; at a wait index unmodified (X2) | Same | Coefficients (CW51-53) |
| CB10 | Invalid preserves; qualified rejection REFUSED | Same | None new |
| CB11 | Block, no invented state | Same | ZEXIT gap 6; gap 4 |

## N1: exit-only row
Candidate text, not adopted: "Exact end, no bytes left, READY/YIELDED + IdxPending, in PARSE_READY or RELEASE_INPUT. advance only runs ZEXIT B1-B7 to CB0: no Idx, grammar, rescan or node."
It covers a final colon with or without fuel left and, after OWN21-22, the READY an empty leaves at WP (CB6). Zero-byte release is already OWN24-27's, so unlike Z's row OWN25's list need not grow for Idx, which stays out (BND19, CONS64); B1-B3 need this row (ZPHASE line33). It still needs amendments 2 (a broad "inputless" catches it, OWN27 and CB6) and 4, N2 and B6's phase (ZEXIT gap 3).

## N3: Idx failure at a later delivery
Idx starts only after Dn is admitted and copied, so a known failure (work, capacity, write: RR25, RR65, CW43, CONS37) ends REFUSED with Dn charged and unparsed; an unknown effect blocks (CONS38). If EOF, cancel, rejection or no arrival comes first, Idx never runs and that outcome stands. No such path reaches DONE, so when Idx would fail on W and Z alike, status, reason and delivery number change, not acceptance: T4-T6's shape. Whether Idx fails can differ: its temporaries meet Dn's input, not Dc's (COMPOSITE line26), and resume checks add work; coefficients are UNSET. Policy B names CP-U only (TRACE43).
IR0 precedes the colon (RR33-34) but only checks, and later admissions spend Wn. RR65 and CONS26 require reservation before effects, not before a wait. Candidates for budget failure:
- (a) Reserve Idx's worst at IR0, held across WR3 and WP. Failure moves to IR0 or admission (OWN17). An exact work reserve refuses only later failures (CB4, C5); a capacity reserve meets IR0's input, not Dn's, and can refuse a fitting document.
- (b) Reserve at IR2. Failure surfaces where Idx runs, after admission and copy. No hold across a wait.
- (c) Add Idx's worst to WP's admission guard. Refuses before retention (OWN17), but must count Dn's own copy and release.

User decision 2026-11-06: (b). A budget failure may surface where Idx runs, after Dn's admission and copy. Write failures, unknown effects and whether Idx fails stay uncovered. Prospective criterion: nothing adopted or closed.

## Boundary matrix
| Event | WR3 | WP | Charged | Grounds |
|---|---|---|---|---|
| No arrival | Waits | Waits | None new; live set held | CB1, BND50 |
| Empties | Trip, back to wait | Same, no pulse | Receipt; delivery +1 each, body 0; Wn per trip | CB6, C13, CW7 |
| Dn | Whitespace stays, colon ->R4, wrong byte REFUSED (KVS15) | CB3, then whitespace WD, value CP-V, invalid REFUSED (KVS16) | Receipt; delivery +1, body +L once; Wn for copy, release, Idx | CB2-4, OWN33, S18 |
| Limit, or qualified unsuitable | REFUSED before retention | Same | Receipt | I27, C12, S21, CB10 |
| Invalid offer | Error, state kept | Same | Owner dispatch | I11, CW42 |
| Copy or release failure | REFUSED | Same | Admission kept, liability held | OWN19, OWN27 |
| finish | REFUSED, incomplete | Same, no Idx | Dispatch | I9, CB7, BND47 |
| Cancel | CANCELLED | Same | No refund | I10, CB9, S8-10 |
| Owner lost, unknown outcome | Block, no new owner | Same | Liabilities stay | CB11, OWN39 |
| Wn ends | REFUSED | Same | None new | CW43 |

Before Idx, copy reads bytes (OWN21) and nothing classifies them (BND38). No decision, credit, reservation, node or write repeats (BND43, CONS36). Terminal rows then draw Wc (S9), which normal work never tops up (CW54); the parent envelope is not refreshed (CW35).

## Allocation and lifetime manifest
| Item | WR3 | WP | Until | Open |
|---|---|---|---|---|
| KeyRecord, key text | Held | Held | Result, else cleanup (RR21) | Backing (RR13, RR20) |
| Decision, rank, k, view generation | Held | Held | IR6 | Gap 1 |
| Index backing and control, S0 | Whole | Whole | S28 | RR25, RR63 |
| IdxPending evidence | No | Held | IdxDone | A label, yet it costs (BND10, CONS21) |
| Witnesses, ledgers, control evidence | Held | Held | Not fixed | Layout (Z-A79) |
| Tree, stack, other keys, indexes | Held | Held | Result or S28 | OWN31, RR62 |
| MovementCursor, scratch | No | No (X2) | From IR2 | Overlap with input in CB3 |
| Last input, source lease | Released | Released | B5-B6; OWN22 | Unconfirmed stays charged (OWN27); producer retention (CW18) |
| Cleanup liability | Covers all | Covers all | Cleanup | CW51-53 |
| Owner, driver, receiver | Outlive it | Outlive it | Release | Unproved (S7, BND50) |

WP's live set is WR3's plus IdxPending evidence, and WD's plus decision and rank, phase labels aside. No wait is the peak: Dn's copy (CW22) and CB3 hold more (COMPOSITE line26). No token is open, so no token carry. Sizes UNSET (CW15, RR64).

## Source-bridge gaps
Named, not resolved (Z-A123).
1. Decision lifetime: KVS36 defers it; BND17 and CB0 keep "decision"; RR26 requires rank and view; no clause carries them through a wait. Every route needs this.
2. N1's row; N3's text.
3. Resume check: BND43 says preserve and RR42 needs a bridge on change; no row says what is rechecked after a wait. Stale or unknown blocks, no rescan (RR26).
4. Owner loss during a wait: nothing runs, so no clause says who notices or when (S7, G line13).
5. CB3 is a row, not an exclusive rule (RR56, BND7); X1-X3 read it as exclusive.
6. Wait lifetime and parent bound: none on any route (CB1, BND50, TRACE43).

Inherited: ZEXIT gaps except 4 (COMPOSITE line51); amendments 2, 4. TRACE43's suitability stays.
Result on paper: WP's own obligations are N1-N3, CB3's exclusivity and IdxPending evidence; decision carry, the resume check, wait lifetime and owner questions exist on every route. Until storage, gaps 1-5, inherited items, costs and owner and parent bounds are bound, the claim stays OPEN; evidence adopts nothing (Z-A132).

## Model and RUN2 cross-check
Read by hand; shape only. V1 has no composite mode, so RUN2 is silent (COMPOSITE line60). Rank is computed at the colon (model187), so its R3 carry is unexercised. No layout has an empty right after a colon (model41-53, model288). Budgets, capacity, admission rejection and resume checks are not modeled.

## Retention
Reserve11264 from F13824 ->2560: design10240/integration1024. Review and STOP are unreserved; saving either needs new allocation. Ledger and backlog growth charges integration1024. No truncation, borrowing, refund or transfer.
