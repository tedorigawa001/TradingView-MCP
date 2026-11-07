# Release Label And Representation Decisions
2026-11-07 JST. DOCUMENTARY; records user decisions for steps 1-2 of the plan. No ES, ER, EC or EP read, search, probe, model run, test, implementation, adoption or host qualification. Baseline HEAD 19b149a494748d4c9a00cdff8b7df44957e9494d. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Steps 1-2 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md). Aliases as in PLAN's Scope; ES, ER, EC and EP are PLAN's classes. R1-R3 label text here only, not states or APIs.
The decisions are prospective, like CRIT's criteria: later drafts follow them, and they say which host facts steps 3-5 look for. They adopt no representation (RR7, RR71, CONS10), set no record size (CW9, S27) and close no premise. Naming ArrayBuffer and typed-array operations qualifies no primitive or constructor (OWN49, CW59). Changing one needs a new decision.

## Step 1: release label
User decision 2026-11-07: Node.js 24.18.0, the version `.node-version` names at baseline. It is a label, not B01 identity (QS line10): it names whose documentation ER reads and which tag EC would read once B01-B03 allow. BOOT line85's P05 stays unnamed; RUN2_PREPARE line6's v24.18.0 binary is a model-run record, not that identity. No executable, build, download or install is named for it. CI tests unpinned majors 22 and 24; facts for 24.18.0 are not combined with another release's or an edition's without evidence that they correspond (PLAN lines 19, 41; SEL line7).

## Step 2: representation decisions
User decisions 2026-11-07. The cells give the options as put to the user; the notes below draft consequences, not further choices.
| ID | Decision | Not chosen | Why |
|---|---|---|---|
| R1 | Owned-byte keys: inside the decoder a key is its escape-decoded UTF-8 bytes, copied into R2's arena and compared there by byte loops, with no bulk copy function and no JS string | Keys as JS strings | ES and ER are not expected to show string slicing or rope retention (PLAN lines 14-15); OWN13 would stop at least until EC, which may not close it (PLAN line16) |
| R2 | One fixed arena per response: at begin, one decoder-owned ArrayBuffer of fixed length from the caps, with regions for key bytes, records and control; never grown, reallocated or passed outside the decoder | Fixed backings per family; ordinary JS objects | More allocations and cleanup terms; object layout, headers and GC are not fixable by ES or ER, unlike the arena's internal layout |
| R3 | Float64 integer fields: every integer field is a Float64Array element holding an exact integer in 0..Imax; arithmetic uses Numbers, each result checked against Imax | Uint32 fields with a range check | Uint32 cannot hold all of 0..Imax: a second, narrower bound, and its out-of-range conversion would need ES evidence |

R1. Keys are copied from private input, never the source (OWN21, OWN23). No borrowed view or substring holds a key in carry, KeyRecord, index or tree (OWN13, S45, RR13); R1 adds that no JS string does. The bulk-copy bar covers set, copyWithin and slice on key bytes, beyond RR27's memmove bar; CW32 would need each one's bound. Duplicate detection is byte equality after escape decoding, with no normalization (D03). That is name equality only under strict UTF-8: the proposals refuse BOM, malformed UTF-8 and unpaired surrogates (G1_BOUNDED_JSON_DECODER_DESIGN line9, COUNTER_DESIGN line23), and D01 still needs evidence for them. Owning keys does not make the source stable during COPY_PENDING: OWN8, OWN12 and E09 stand.
R2. Records include CW9's node, edge, key, lookup and frame records and RR's KeyRecord, IndexEntry, IndexControl, MovementCursor and scratch (RR43). Control is the storage the act's RS, CA and IE name, independently owned after input release (Z-A79). Ledgers, registry and cleanup cursor outlive the arena (CW43, S8, S11), so they are not R2's control; their storage, value payload, private input and codec carry stay undecided (CW13, S45, M09). RR25 also bars growth and reallocation. Only views made once at begin receive the arena; it never reaches a caller or the receiver (RR21, RR51). So WCARRY lines 77 and 82's "Result" reads as projection copies of arena content (RR21, S38), and S28 releases index ownership logically while WCARRY line79's backing lasts until the arena is dropped. N3's capacity reservation at IR2 (act Part 7) is a logical one inside capacity charged at begin; its work and cleanup reservations stand. Projection's use of arena views stays open (S38, E10).
Cleanup liability is checked before creation (CW53). What a known creation failure does at begin is a row I line14 lacks (cf. CW43); heap exhaustion stays open (PLAN line25). Once evidenced, the arena adds one backing and a fixed set of views to CW51's Amax and Vmax, coefficients UNSET (CW52). S33's single-pool grouping needs it qualified as an evidenced pool with header, alignment and physical allocation count (PE line101). Its full length is charged from begin, even for a small response; dropping it is a logical release, and root capacity stays charged until reclamation is evidenced (OWN40, CW56). Creation is treated as one indivisible primitive, its zero fill charged work (CW33): if its maximum is unproved or exceeds Ws, the profile is rejected or blocked (CW40, E06), and a new decision is needed.
R3. Each operation is checked so that no operand or result leaves the integers 0..Imax (A01, E05); counters, offsets, generations and charges share that domain. Key bytes are Uint8Array elements of the same arena; no other element type is used. Float64 regions start at multiples of 8, a view rule the ES slice must confirm.
Field counts and sizes are not set here: mNode-mFrame and reference width stay UNSET (CW9, S27, M01). Once fields are set, a record's logical payload would be its field count times the Float64 element size the ES slice must confirm: a data length, not retained memory. Header, alignment, pooling and GC overhead stay UNSET, never zero (CW15, M03).

## What the decisions ask of steps 3-5
Expectations only; nothing read.
| Fact | Class | For |
|---|---|---|
| Fixed-length ArrayBuffer creation: zero fill, failure, whether it is resizable without maxByteLength, which operations detach a buffer | ES | R2 |
| Typed-array element get and set on an attached fixed-length buffer: user code, coercion, reentry; view offsets and element sizes; Float64 exactness to 2^53; Number arithmetic exactness and rounding near Imax | ES | R1-R3 |
| Whether an ArrayBuffer in this release can share, pool or move its backing; allocation failure; external memory accounting | ER | R2, ownedKeys |
| Creation's path in one tag and the physical layout, once B01-B03 allow; no class proves a maximum (PLAN line31) | EC | R2, E04 |

Whether anything can detach the arena without a reference to it is the first ES row's question; that no reference, view or buffer property leaves the decoder is a code property for later review, not a host fact.

## Open even then
Every record's field list and every size (CW9, M01-M03); projection, result and receiver representation (S38, E10, D06); D01's evidence for the UTF-8 refusals; the source lease (OWN8, OWN12, E09); unaltered ArrayBuffer and typed-array intrinsics at begin (B02, PLAN line26); the arena's physical independence, reclamation and root capacity (PE line101); creation failure (I line14) and cost (CW40); every finite cost (B08). R3 answers PLAN line30's representation choice, still unadopted. Evidence adopts nothing (Z-A132).

## Next, not approved
Steps 3-4, the ES and ER slices for the rows above, each need per grant the locator PLAN lines 14, 41 and 50 allow (QS line7), funding, plan review, the exact request and destinations, and execution approval (PLAN line49). PLAN's first read slice estimate stands: design4096/report2048/integration1024.

## Retention
Reserve9216 from F101248 ->92032: design8192/integration1024. Review and STOP are unreserved; saving either needs new allocation. Ledger and backlog growth charges integration1024. No truncation, borrowing, refund or transfer.
