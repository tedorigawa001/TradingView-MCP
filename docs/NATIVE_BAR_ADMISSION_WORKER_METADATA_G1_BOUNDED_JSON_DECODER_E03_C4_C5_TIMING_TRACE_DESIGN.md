# C4/C5 Duplicate Refusal Timing: Paper Traces And Policy Comparison
2026-11-06 JST. DOCUMENTARY; no model run, test, route selection, premise closure or production behavior. Baseline HEAD cd161d54338bcdbac096c759222de74746dc79ef. Existing RUN1/RESUME01 STOP and no-retry stay; RUN2 is a historical record.

## Scope
Timing step of the [proof procedure](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ROUTE_PREMISE_PROOF_DESIGN.md), whose Scope defines I/OWN/S/G/BND/Z-A, model and RUN2. Also C=[counter](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_COUNTER_DESIGN.md), KVS=[key/value state](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_KEY_VALUE_STATE_DESIGN.md), Route=route comparison. I7/C20/S45 and model165 are line references; CB6/ZA2/G2 are IDs. All hand-read from text. Z and W stay conditional on their OPEN premises.

## Model hand trace
Decision is the model's admitted delivery count at refusal (model 135, 165-166, 287-288, 306-310, 335); RUN2 does not print it.
| Case, layout | Delivery ends | Key complete | Z | WH |
|---|---|---|---|---|
| C4 d0 | 13 | 1 | 1 | 1 |
| C4 d1 | 1..13 | 10 | 10 | 11 |
| C4 d2 | 4,5,10,11,13 | 3 | 3 | 4 |
| C4 d3 | 0,4,4,5,10,11,13 | 5 | 5 | 6 |
| C5 d0 | 15 | 1 | 1 | 1 |
| C5 d1 | 1..15 | 12 | 12 | 13 |
| C5 d2 | 4,5,12,13,15 | 3 | 3 | 4 |
| C5 d3 | 0,4,4,5,12,13,15 | 5 | 5 | 6 |

Fuel and fields change no delivery number. Three layouts x3 fuel x2 fields give 18 differing pairs and d0 gives 6 equal ones, which agrees with RUN2 D=0,18 for both cases; both routes refuse as duplicate at the same position. Each differing layout offers a one-byte next delivery and none has an empty delivery right after the duplicate key, so +1 is a fixture property, not a bound. d3's later empty follows the first, unique key: WH's lookup waits through it, a two-delivery lag the refusal count does not show.

## Contract traces
Dk is the delivery containing the second key's closing quote. Keys compare by decoded content, so C4 and C5 differ only in source length and numbering (C20, KVS25-26); C5 tests no decoder. Z: lookup before release (ZA2-3). W: release, then lookup once real input exists (Route26, model165).
| Trace | Z decision | W decision | W extra admitted; parsed | Grounds |
|---|---|---|---|---|
| T1 bytes follow the quote in Dk | Dk duplicate | Dk duplicate | none; 0 | C20, KVS34, ZA1 |
| T2 quote ends Dk; next nonempty L | Dk duplicate | Dk+1 duplicate | 1 delivery, L body; 0 | I7, C12, OWN17-22 |
| T3 quote ends Dk; m>=1 empty, then L | Dk duplicate | Dk+m+1 duplicate, unless cap1024 refuses first | m+1 deliveries, L body; 0 | I7, C6, C13, CB6 by analogy |
| T4 quote ends Dk; EOF after any empties | Dk duplicate | finish refuses as incomplete; undecided | those empties; 0 | I9, I11, Route66, RUN2 C18 |
| T5 quote ends Dk; next rejected, or copy fails | Dk duplicate | limit, suitability or copy reason; undecided | rejected none, copy failure L body; 0 | C12, S21, OWN17/19; model58 unmodeled |
| T6 quote ends Dk; cancel before W lookup | Dk duplicate | waits; CANCELLED; undecided | arrivals so far; 0 | I10, CB1/9 by analogy |

Every trace ends without DONE, colon/value parse, CP-V node or output, so these duplicate traces show no acceptance difference; valid documents under actual budgets stay unknown (S29, Route55). W reads no later byte before lookup (C20, KVS14-15/34, BND38 by analogy). Reason is first-detected by design, with no scan-ahead ranking (S20). W adds receipt/admission/copy/release work inside existing caps and carries the lookup binding across waits (S45). Admitted-but-unparsed bytes occur on both routes in T1; only W admits a later delivery. During lookup each route holds one private input: Dk for Z, the next delivery for W. Waiting is not W-only: a unique key waits for its colon on every route (boundary review line12), holding key and index.
Existing text requires refusal before colon/value parsing (C20, KVS26, G2), not in the same delivery. KVS34 preserves search state across yield/delivery but authorizes no wait: BND6/56 and proof lines17-18 leave key-close lookup OPEN and CB rows are post-colon only. Neither route has current authority; each policy below is prospective.

## Policy comparison
A same delivery. Z meets it, with Zphase OPEN; for key close that is an authority gap rather than a CB3 conflict (BND6), though BND56's "inputless advance exception" needs explicit scope (Z-A source map). Plain W fails T2-T6, so W at key close is excluded unless another qualified way exists. Candidate in no existing document: hold the classified closing quote unconsumed during lookup, so real input remains (BND42) and the BND CP-U->Colon->Idx->CP-V order stays; it needs HheldClose-like proof, KVS R1->R2 correspondence and its own comparison, and RUN2 says nothing about it. Meeting A reports duplicate in all six traces, removing the RUN2 C18 difference and the key-close lookup obligation of WcarryAcrossWait.
B next nonempty admission. Z and W both meet it, so it forecloses neither route. The bound is the existing caps, not time. W needs key-close rows equivalent to CB0-CB11 and explicit acceptance of T5/T6 outcomes: the 2026-11-05 decision covers RUN2 C18's reason only, not limit, copy, cancel or an alias at EOF. A complete key needs no future byte, so the wait only avoids zero-byte work.
C at most one later numbered delivery. Z meets it; for W T3 decides it: an empty delivery has no lookup row and CB6 gives Idx no pulse. Outcomes found: staying pending, or a parent withholding empties with numbering redefined, which is B; refusal at or after admission, which turns a valid document into REFUSED against I7/C6/C13 (model C1 d3, ends 0,4,4,5,7, expects DONE); zero-byte lookup there, which needs Zphase-kind authority and avoids no proof. A delivery count bounds no time, so C does not improve T6.
This list is not claimed exhaustive.

## Decision
User decision 2026-11-06: B. CP-U's outcome precedes colon/value parsing and may wait for the next nonempty admitted delivery; empties need not drive it. T4-T6 reasons except suitability are accepted, including an alias at EOF. Suitability, release/owner failure and wait lifetime stay open. A route deciding earlier also meets B. Prospective acceptance criterion: no clause, row, route, premise or candidate is adopted or closed.

## Retention
Reserve7680 from F12800 ->5120: design6656/integration1024. Review and STOP are not reserved; saving either needs new allocation. All positive growth of ledger and backlog charges integration1024; actual charges are in the ledger. No truncation, borrowing, refund or transfer.
