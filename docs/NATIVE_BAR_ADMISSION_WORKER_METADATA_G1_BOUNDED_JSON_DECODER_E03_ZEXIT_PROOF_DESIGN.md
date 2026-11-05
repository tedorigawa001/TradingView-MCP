# Zexit: Exact-End Entry, Input Release And Waiting-State Commit
2026-11-06 JST. DOCUMENTARY PROOF WORK; no model run, test, implementation, route selection or host qualification. Baseline HEAD 6942ca3407765ebd0c798f7c15041d3fa207b643. RUN1/RESUME01 STOP and no-retry stay. Zexit stays OPEN; nothing here is adopted.

## Scope
Item 2 of the [proof procedure](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ROUTE_PREMISE_PROOF_DESIGN.md), whose Scope defines I/OWN/S/G/BND/Z-A, model and RUN2. Also CW=[capacity/work](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_CAPACITY_WORK_DESIGN.md), CONS=write/cursor, Route=route comparison and [TRACE](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_C4_C5_TIMING_TRACE_DESIGN.md) for policy B. I9/OWN27/Z-A82 and model165 are line references; ZA6/CB6/G5 are IDs. E0-E7 and B1-B7 label rows below, not states or APIs.
Zexit is named for Z, but W needs a release and commit too (OWN24-27, I17, Route26), and the model's phases 3-4 do not branch on route (model151-163). Entry differs, and W carries a pending binding through release. Z-A is Z-path text (Z-A23-24, Z-A124), so for W it is analogy, as are CONS and CB rows, which address index work. Every argument assumes ownedKeys, knownAck and serialDriver. E3 and E0's pending task also assume WcarryAcrossWait; Z rows after exact-end work assume Zphase; W's E4-E5 assume HheldClose; E5 assumes closeWitness. These are dependencies, not facts.

## Claim and conditional invariant
Claim (OPEN): once entry qualifies at the exact end of one admitted delivery, one same-input release leads to NEED_INPUT only for known incomplete state or WAIT_EOF only for known complete root; every other path ends under existing terminal or block rules, or stays YIELDED if the driver stops (Z-A67). Neither state implies EOF, DONE or handoff (I9, I18, Z-A86).
Invariant from entry until commit, except as stated:
- Inv1: same response, owner and delivery; position exactly at end; no re-read or grammar (Z-A70, Z-A75, Z-A81, ZA5).
- Inv2, from promotion's end (B3 on): whatever is needed after release sits in independently owned bounded storage, not a view of input (S45, OWN13, Z-A71). Input stays held until then.
- Inv3: release progress is known, monotone and once-only; unconfirmed is not freed (OWN26-27, Z-A73, CONS28).
- Inv4: saved grammar, stack, root and tail witnesses stay unchanged; release cannot repair them (Z-A75, Z-A81).
- Inv5: public state stays READY/YIELDED, so admission and finish stay contract errors (OWN25, I7, I9, I11).
- Inv6: normal work pays, with positive progress and no reset, refund or borrowing (CW34, Z-A128-129, OWN33).

Argument: a qualifying row must establish Inv1 and Inv3-6. Promotion changes only owned carry, decisions and charged liability; preparation only bound metadata; an acknowledged effect only the release cursor, its records, gauges and charges; a yield no progress; commit only reads saved witnesses. If every step has finite positive charged progress within remaining budgets, the driver keeps calling advance and every effect is acknowledged, the sequence reaches commit. Known incomplete and known complete are disjoint, so commit selects one target, as I17 and G line41 require. If any premise is unknown the argument stops at the blocking row; it never falls through to incomplete (Z-A82).

## Exact-end entry
| ID | Context at exact end | Z | W with H | Target | Not allowed |
|---|---|---|---|---|---|
| E0 | Empty delivery, nothing consumed | Eligible | Eligible; a pending task stays pending | Prior context's target | Idx pulse or direct admission-to-wait shortcut (CB6, Route63, Z-A101) |
| E1 | Valid incomplete, between tokens, no task, including post-colon whitespace with Idx settled (CB5) | Eligible | Eligible | NEED_INPUT | Unknown read as incomplete (ZA7) |
| E2 | Partial key, string, number, literal, UTF-8 or escape | Eligible after carry (S45) | Same | NEED_INPUT | Fabricated completion, credit or node (Z-A36, Route62) |
| E3 | Complete key or consumed colon, task pending | Not eligible: task first (ZA2, Z-A70) | Post-colon: CB0 candidate. Key close: no row yet (TRACE, BND56). A whitespace-only delivery is real input, Idx first if CB3 holds (model165); consumed whitespace with Idx pending has no CB row | NEED_INPUT (W only) | Running the task during release (Z-A75) |
| E4 | Close consumed, retirement pending; nested, root or empty alike (Z-A103) | Not eligible (S28, proof line14) | Does not arise if HheldClose holds: the byte stays held, so not at end (Route25, model142) | None | Reporting a complete root (Route53) |
| E5 | Complete object root, no task, empty stack, no token or carry | Eligible | Eligible | WAIT_EOF | Implied EOF or DONE; delayed tail latch (I16, Z-A82-83, Z-A86) |
| E6 | Bytes remain | Not entry | Not entry | Grammar or tail rules | Dropping them; hidden whitespace sweep (Z-A84) |
| E7 | Eligibility, witness or owner unknown | Not entry | Not entry | Existing refusal or block | Guessing a wait or no work (Z-A32, Z-A82) |

A later delivery in WAIT_EOF repeats this trip under tail-only rules; non-whitespace refuses (I7, I16). Plain W without H has no answer to E4 at a final root close: no later byte is guaranteed (Route26, boundary review line12).

## Release sequence and failure boundaries
Order: qualify entry, promote carry and decisions, prepare release, effect through acknowledgement, commit state. Preparation is not release and reduces no live gauge (Z-A73); consumed offsets are not release evidence (CW25).
| Boundary | Fuel ends | Known failure or exhausted normal budget | Unknown outcome or owner loss | Serial cancel | Input |
|---|---|---|---|---|---|
| B1 entry qualified, no promotion | Resume same phase (ZA3) | REFUSED (CW43) | REFUSED with block (Z-A90, OWN39) | CANCELLED | Held |
| B2 promotion partly done | Yield only at known prefix (Z-A74, CONS42) | REFUSED; partial carry is an owned liability (CW43) | REFUSED with block; no guessed promotion (Z-A74, Z-A90) | CANCELLED | Held |
| B3 release prepared, no effect | Yield if it fits a fresh step; else reject profile before effects (CW39-40, CONS34-35) | REFUSED, not a fresh attempt (CONS37) | REFUSED with block (Z-A90, OWN39) | CANCELLED | Held |
| B4 effect begun, acknowledgement not known | Not reachable if admitted (CW38, CONS26, CONS34-35); else unqualified (CONS28) | REFUSED; ownership kept (OWN27) | REFUSED with block; no repeat release or membership test (OWN27, OWN39, Z-A85) | Cannot preempt the interval (CONS43, Z-A91) | Unconfirmed; never counted as freed |
| B5 known partial release | Yield; advance continues release only (OWN27) | REFUSED (OWN27) | As B4 | CANCELLED; cleanup continues from the cursor (S8, S10) | Remainder held |
| B6 release acknowledged, commit pending | Finalize that release only (ZA6) | REFUSED (CW43, ZA8); no double release | Owner loss as B4; unknown commit: block, post-state open (Z-A85, Z-A92; CB11 by analogy) | CANCELLED if ZA6 is adopted; no re-release | Released |
| B7 state committed | Public waiting state | None | Owner rules (OWN39) | CANCELLED | None |

Before B7 cancel lands only at a legal yield, since it is serial between operations while nonterminal (I10, S43). After failure or cancel, cleanupStep under Wc only releases and cannot finish normal work (S8-9, Z-A91); its liability must fit before each new liability is created (CW53). Cleanup failure, unknown outcome or exhausted Wc blocks the resource set: terminal state stays, resources stay unresolved and the next acquisition is blocked (S10, CW55, OWN39). Across B1-B6 admission and finish are contract errors with charged dispatch (OWN25, I11, CB8, Z-A89, Z-A105). At B7, finish in NEED_INPUT refuses without completing a task (I9, CB7, Z-A106). No retry (OWN28). A known failure can refuse a structurally valid document (S29, Route55).

## Atomic or intermediate
Two candidates for the procedure's deliverable, neither selected:
- Atomic exit: one qualified operation releases, acknowledges and commits, collapsing B4-B6 into one interval; an unknown return still blocks (CONS39, OWN44 by analogy). No such primitive is identified or assumed (OWN49, CONS25).
- Qualified intermediate states: READY/YIELDED stays through B5-B6 and advance only finalizes. OWN27 covers B5. B6 rests on ZA6, unadopted and itself needing proof (Z-A80); after release OWN names no phase (boundary review line14). This needs no atomic primitive, but needs B6's authority and a phase row.

Both need effect-to-acknowledgement evidence. B4 is the hardest point but not the only one: proof line14 names an unknown acknowledgement or state commit. At B4 the decoder cannot tell freed from held, so it must keep the liability and stop.

## Source gaps found
Named, not resolved; adoption must name any superseded sentence (Z-A123):
1. "Drained" has two meanings. BND16 means zero remaining bytes; OWN25 says a pending release is not drained, and I9 gates finish on drained (boundary review line19). Wording only: I7/I9 gate on state and OWN25 refines I. Route13-16 separates the boundaries; no clause fixes the word.
2. I17's "Input exhausted" is ambiguous. OWN24-25 and, for Z, Z-A117 point to confirmed release; nothing adopts that.
3. B6 has only general rules; no row fixes its phase or post-state (boundary review line14).
4. W's exit with a pending key-close task has no row: Z-A70/82 are Z-scoped (Z-A24) and CB0 is post-colon. W under policy B needs one (TRACE lines 38, 43).
5. "Inputless" is undefined (BND56, ORD14 via BND5); a reading covering every zero-byte advance conflicts with B1-B6, OWN27 and CB6 (boundary review line18, Z-A121).
6. Mismatch: CB11 names no post-state, while OWN27 says REFUSED (boundary review line15). This document reads them together as REFUSED with block; nothing adopts that.
7. After a live B4 failure or unknown outcome, OWN27 keeps ownership for cleanup, Z-A85 and OWN28 bar repeating, and S10 addresses only cleanup's own outcomes. No row says whether cleanupStep may touch that input or the remaining set.
8. Owner-dispatch exhaustion stops work with no parser transition, and that linkage is unreviewed (CW42, S9).

Premise, not a gap: serialDriver, unproved. Further advance calls need finite dispatch and no timer or hidden loop (S7, Z-A67, Route46).

## Model and RUN2 cross-check
Read by hand. It supports the shape only:
- Release-only: normal work in phase 3 is the V_RELEASE control, detected in RUN2 (model155, model209, RUN2 line14).
- B6's shape exists: fuel can stop with state YIELDED, phase 4 and input released (model156, model158-162, model321).
- The C23 plan blocks at phase 3 when fields=1 and phase 4 when fields=4 (model152-154, model159-161). B6's REFUSED-and-blocked there is a model choice, not a source row.
- RUN2 line40 gives C23 18 comparable and 6 not comparable. By hand the 6 are layout d2, whose first release has WH's lookup pending and Z's done: same mechanics, different entry tuple (model114-115, model391-392).

Not modeled: promotion, carry, budgets, segmented release (one tick), known failure versus unknown, and cancel or owner loss during release, which fire only at an insert task (model300). V_ADMISSION and V_FINISH have no detection control (RUN2 line14). RUN2 is no evidence for B2, B3, B5 or cancel at B1-B6.

## Required before closure
Bind: a release primitive with effect, acknowledgement and failure facts (OWN49); the atomic or adopted-phase form; carry, alias and registry layout and costs (CW15, CW59, Z-A127); finite unit, step, normal and dispatch bounds (CW40, Z-A129); cleanup liability coefficients (CW51-53); owner and driver lifetime (S7, Z-A67); close and root witnesses; and parent EOF notification (Z-A110). Until then Zexit is OPEN, and evidence alone adopts nothing (Z-A132). No Z-B proof, root completion, route choice or execution follows.

## Retention
Reserve13824 from F29184 ->15360: design12288/integration1536. Review and STOP are unreserved; saving either needs new allocation. Ledger and backlog growth, including the funding reallocation's record, charges integration1536; actual charges are in the ledger. No truncation, borrowing, refund or transfer.
