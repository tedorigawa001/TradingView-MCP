# ES1 Correspondence Decision: Conditional Use
2026-11-08 JST. DOCUMENTARY; records one user decision. No read, search, probe, model run, test, implementation, adoption or host qualification. Baseline HEAD c5110c63bd59be8eac03f07f838a824e7b96f8ce. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
The closing STOP of [REPORT](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_REPORT.md) line21, for the R1-R3 of [REP](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md). Aliases as in [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md); Q1-Q6 as in the ES1 design (REPORT line3); the design's line5 awaits this decision. The ES1 slice stays ended: no read, retry or follow-up.

## Decision
User decision 2026-11-08, of four options put (conditional use; one ER read to narrow it; waiting for EC or EP; ending ES without correspondence): conditional use, with the funding 5120 that option stated. Why: no PLAN class shows conformance (PLAN lines 14-17, Cannot show), so every route ends in an assumption; EC waits on B01-B03, EP on B01-B08 and OWN12 (PLAN line43).
HES1, an assumption: for each fact REPORT lines 15-20 record, the runtime labelled 24.18.0 behaves as that fact states. HES1 is OPEN and is not evidence: under it no ES1 fact is combined with release or tag facts (PLAN line19), a claim resting on it is CONDITIONAL on HES1 ([PROOF](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_PROOF_DESIGN.md) line21), and REPORT's facts stay edition facts. HES1 also assumes those records match the text, which only the reading session checked (c5110c6), and inherits REPORT line14's limits.

## Coverage
Covered: Q1, Q2, Q4's operations and key rule, Q6, and Q5's stated encodings, Number input, byte-order rule and no-throw.
Not covered: Q3 zero fill (UNKNOWN); whether detaching needs a reference (Q4, REP line34); which byte order the agent uses; user code, and coercion or Uint8 conversion outside the clause (Q2, Q5); anything REPORT does not record; the executable (B01, QS line10); intrinsics altered at launch or before begin (B02, PLAN lines 14, 26); physical sharing, retention, cost and exhaustion (PLAN line14); CI's unpinned majors 22 and 24 (REP line9).

## What R1-R3 gain, conditionally
- R2 (REP line29): without maxByteLength the arena is fixed-length; REPORT line16's creation failures are candidates for the row I line14 lacks (REP line21). Zero fill stays UNKNOWN; REP line21's charge for it stands.
- Detach (REP line34): under HES1 the clause's detach operations and key rule hold (REPORT line18); whether the embedder or anything else detaches the arena stays open, and no planned ER row names the arena's detach (PLAN line42, REP line31).
- R1 and R3 (REP line30): only the raw-byte encodings, unsigned byte and binary64 (REPORT line19). Element get and set, user code, coercion, reentry, view offsets, element sizes, the multiple-of-8 rule (REP line22), Float64 exactness and Number arithmetic wait for later grants.

## Gates
HES1 closes no premise, gate or qualification; any separately approved qualification review (Z-A132) treats it as unmet. No class, alone or together, proves it (PLAN lines 14-17); ER, EC or EP may narrow it, each through its own slice and approvals (PLAN lines 49-50). Nothing closes on HES1 without evidence for it; changing its status needs a later decision.
Later ES grants are not covered: each needs its own correspondence decision, and PLAN line41's STOP stays their default.

## Next, not approved
The next ES grant (expected: TypedArray, Number, Data Blocks) or step 4's ER slice, each with its own locator, funding and approvals (PLAN lines 49-50).

## Retention
Reserve5120 from F84352 ->79232: design4096/integration1024 (ledger and backlog growth). Review and STOP are unreserved; saving either needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
