# K5 Close Span: Commit Point, K9's Prefix And G36
2026-11-07 JST. DOCUMENTARY; no model run, test, implementation, clause adoption, route selection or host qualification. Baseline HEAD cc43bb7278db1b4c06c401fef5f7e07ee9332c81. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
The gap at [AMEND](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_COMPOSITE_AMENDMENTS_DESIGN.md) line78: K5 is one event, and whether consumed-unpopped is K9's legal prefix (G34) is unproved (G36). Aliases as in AMEND's Scope, plus C (counter) from TRACE's, CS=[case schema](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_A1_A3_CASE_DESIGN.md) and PRES=its parent (CS5). CS30, G36 and S28 are line references, as is "G line8"; K5, CS12's I1-I4 and rows G5-G9 are IDs; CL0-CL5 and PC1-PC6 are AMEND's. PT1-PT2, L1 and SP1-SP3 label text here only.
Assumed, not facts: closeWitness, knownAck, serialDriver, order B (ORD21), AMEND line56's order; Zphase for the work. The span runs from CL1 to the pop unit; CL0 has no effect, CL5 has committed. Arrays are out: row G6 has no retirement.

## What the sources fix
| Source | Text | For the span |
|---|---|---|
| CS24, G30, G47 | K5 removes the object from O; atomic grouping, release and pop timing OPEN | No instant, no atomicity fixed |
| G line8 | Rows are "not implementation states/APIs or a schedule" | A row is not a moment |
| S28 | Incremental release at close under READY/YIELDED; objects stay uncompleted | Yields can fall inside (CW39) |
| C16, Route53 | "pop once on a valid close"; once "at qualified close" | How often; "at" needs a reading |
| CS30, G36 | "combined atomic event": "invent no separate steps or observable intermediate states"; "combined event": "invent no separate observable steps" | G36 drops "atomic"; CS30's examples are K2-K4 |

So "one event" is a fact about the row, not timing. G46 lists an "atomic tuple", G47 leaves grouping OPEN, S28 makes release incremental: CS30, if scoped to atomic events, might not reach it. G36 might; below assumes it does.

## L1: the witnesses do not see the span
Conditional on closeWitness and PC3, not knownAck. The closing object has no P key (row G5, CS24, PRES11) and no grammar event runs in the span. Retirement touches index records only (S28, PC5, RR59); n, q, M, P and f are proof witnesses, not runtime records (CS7, PRES10), and stay. So with the object in O or out:
- I1, I2 unchanged; I3: it has no P key, so either clause holds; I4: |O| stays or falls.
- CS33's bound: |M|<=n by injection and every P key belongs to another open object, so q<=n+|O| either way.
- PRES11's O within the stack holds while O leaves no later than the stack.

So I1-I4 do not select the commit point; A4 stays separate (CS34). No storage, cost or peak claim: sizes UNSET (CW15, CW19).
Aggregate tuple, if G36 applies: O minus the object and D minus one, once (G46); n, q, M, P, f unchanged. Completion, parent return, root witness and latch are not M/P/O/f/D changes (CS11, G46); AMEND line67 keeps them in the pop unit.

## Commit-point candidates
| | PT1: both at pop unit (AMEND) | PT2: both at consumption (early pop) |
|---|---|---|
| K5's tuple | One, at the pop unit | One, with the byte |
| Route53 | Read as pop unit | Needs "qualified close" to mean consumption |
| PC2, pop unit | Stand | Edited; separate record under a parent frame (AMEND line57) |

PT1's "open" needs a reading (item 3 below). PT2 is not refuted; K9 in its span holds K5, and its commit unit has CL3's OPEN. O at consumption with D at pop splits the tuple and fails if G36 applies (G17, G46).

## K9's prefix under PT1
Prefixes are of events (CS6, PRES6); n and q are committed reservations, not position. Denial adds no partial tuple and rolls back no spent work (PRES9, G's B4, C30); a failure after guards pass has only CW43 and analogy. Terminal rows fix position and grammar and change resources only (S8, RR57). So, reading SP2, consumed-unpopped is no new prefix: the last legal one excludes K5's tuple, and the consumed byte and retirement progress stay outside the witness.
| Point | Tuple | Row | O, D at freeze | Open |
|---|---|---|---|---|
| CL1, CL2, CL4 | None | K9 (row G9); CL4's denied pop unit may be row G7, no tuple either way | Before K5 | SP2 is a reading |
| CL3, retirement unit | None | K9; block unless failure known | Before K5 | Records unknown (Z-A92) |
| CL3, pop unit | Unknown | K9; block unless failure known | Unknown; L1's bound holds | OPEN: unknown commit boundary (CS34) |

Cleanup completes no grammar pop (S8, AMEND's CL2, CL4); an emptied live stack replaces no frozen bound (G34).

## "Observable"
No decoder document defines it; only CS30 and G36 use it. What a legal caller can get in the span:
| Channel | In the span | Grounds |
|---|---|---|
| Parser state | READY/YIELDED, no new name | I8, I15, S28, AMEND line58 |
| Calls, terminals | acceptDelivery, finish error, state kept; refusal, cancel terminal, no partial output | I7, I9, I11, I19, C32 |
| Errors | Reason, position, identities recorded: a refusal can show a position past the close | OWN37, PC1 |
| Charges, gauges | Charges grow; index gauges fall only with release | CS14, C32, PC6 |
| Completion, parent return, root witness, latch, wait | None before the pop unit | PC3-4, Route53-54, ZEXIT E4 |

If any yield in retirement were a banned step, G36 would conflict with S28, which row G5 cites, whenever fuel ends there (CW39). So the ban does not reach those yields, or K5 is OPEN for a mismatch (CS34). CL4 and an empty object have no records left, so only CW39 forces a yield there, given AMEND line56's units.

## Candidate text
- SP1, reading G36: "For K5, a separate observable step is one a legal call can tell apart by a new parser state, an effect of a new or partial tuple, or value completion, parent return, root witness or latch before the event commits. YIELDED, charges, index gauges, error metadata and existing contract errors in K5's span are not."
- SP2, reading K9 and G34: "K9's legal prefix excludes an event whose tuple has not committed. Under PT1, between consumption and the pop unit K9 freezes the prefix before K5; the consumed close and retirement progress stay outside the witness."
- SP3, K5's row, under PT1: "O leaves, D pops once, in the pop unit. From consumption to then row G5's span has no tuple; a yield keeps position, cursor and phase with no replay (C30, S20, PC5). Terminal rows stay G7's or G9's."

They would join AMEND's package after PC (line81), all three or none. Named sentences: CS24, CS28, G30, G34, G36, G47, PRES23, KVS46; CS7, I3 read as unpopped; CS30 read as scoped; C16, Route53 read as once, at the pop unit; AMEND line90 would point here. Not changed: I1, I2, I4, CS33, A1-A3, K6-K8, rows G6-G8, C30, S28, PC1-PC6.
Until SP3 is adopted the span's yield has no close row: K8, row G8 and PRES22 give only generic yield/resume, K6 names no object close. CS34 may then leave K5's case OPEN for a "missing transition".

## What stays open
1. CL3 at the pop unit, above.
2. The pop unit's atomicity: one bounded unit for tuple, completion, return and latch (G47, CW40).
3. "Open" in CS7 and I3: under PT1 a consumed, unpopped object stays in O, so O means not yet popped; SP3 would decide it.
4. Position: errors record it (OWN37), so CL1 and CL0 differ there, as do Z and H (PC1). SP1 would decide that is no step.
5. closeWitness, parent return, pending-close storage and costs (G47, KVS19, CW15, CW51-53), and AMEND's other items.

Writing this closes nothing: SP1-SP3 need approval (Z-A123, Z-A132).

## Model and RUN2 cross-check
Read by hand; shape only. V1 has no composite mode, so RUN2 is silent (COMPOSITE line60). The model pops at the close task's end (model143, model244); its write, cancel and owner plans fire at inserts, not retirement (model127, model300).

## Retention
Reserve9216 from F9216 ->0: design8192/integration1024, after moving 9216 of unspent reservations (ledger). Review and STOP are unreserved; saving either needs new allocation. Ledger and backlog growth charges integration1024. No truncation, borrowing, refund or further transfer.
