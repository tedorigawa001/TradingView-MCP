# G1 Bounded JSON Decoder Proposal
Status: DESIGN_ONLY. This is a separately proposed self-written decoder for M metadata, not a selected/qualified runtime or an applied exception to the existing proven-library/no-handwritten-parser policy. Implementation, synthetic execution, policy changes and operational effects need separate approval. Dot stays PAUSED; judgment/notification/mail rules stay unchanged.

## Scope And Interface
Accept owned UTF-8 byte deliveries, not a prebuilt whole-response string. The proposed interface has begin, bounded step/feed, finish and cancel states; exact signatures remain for the pure-contract slice. States distinguish NEED_INPUT, YIELDED, DONE, REFUSED and CANCELLED. Publish no partial tree. DONE requires a complete object root, observed end and no trailing value.
No reviver, custom numeric/duplicate callback, eval/code generation, dependency import, worker/process, filesystem/network hook or fallback to JSON.parse/another parser.

## Grammar And Keys
Strict JSON only: reject BOM, malformed UTF-8, unpaired surrogates, comments, trailing commas, NaN/Infinity, root arrays/scalars and extra input. Validate split UTF-8/escape sequences across deliveries with bounded carry state.
Decode each key, compare with keys already admitted in that object, and refuse any duplicate BEFORE colon/value parsing, including identical values and escaped aliases. Do not add normalization/case-folding. Apply this to nested/unknown fields too.
Use an explicit bounded container stack. Keep internal key/value entries rather than assigning input names onto ordinary objects. Key comparisons must be explicitly accounted, not assumed constant-time. A proposed bounded list/index avoids relying on an unaudited hash-table work bound.
Numbers remain validated original lexemes; schema-specific conversion is separate. No silent precision loss or LosslessNumber compatibility promise.

## Inherited Bounds And Charging
Keep M bounds: body524288 bytes/response, deliveries1024, depth32, nodes16384, keys256/object, decoded scalar UTF-8 bytes65536, numeric lexeme bytes128. Preserve M batch/per-kind/overlap limits; no enlargement or guarantee every syntactically valid input fits.
Define counters and exact-cap/one-past behavior against existing contracts before implementation; do not silently redefine nodes/depth/key/scalar accounting. Count unknown/rejected fields. Check before retaining/copying a byte, extending a scalar, admitting a key/node or pushing a container.
Charge byte scans, decoding, transitions, comparisons, copies, errors and cancellation work. Total work and per-step fuel values are UNSET; qualification/execution is blocked until finite reviewed values exist. Yielding is not timer preemption or a millisecond guarantee. Check cancellation between bounded steps; no promise of immediate synchronous interruption.

## Ownership And Open Evidence
Account for simultaneous delivery buffers, decode carry/text, key storage, stack, tree, projection, errors and copies; preserve caller ownership for unconsumed bytes. Refusal/cancel exposes no partial result and drops owned references. Reference release is not guaranteed GC, memory erasure or transport settlement.
Layout, pool capacities, allocation/initializer closure, runtime/GC/heap overhead and exact ownership/copy formulas remain UNKNOWN. No whole-heap bound is inferred from body size. G2/bootstrap, clocks, transport and D01-D08/B01-B08 remain independent gates.
The user-supplied parse excerpt motivates this proposal (equal-key duplicates bypass its handler; values precede duplicate checking), but its exact source/version is unverified. Do not merge it with the tag-read evidence or claim an upstream defect/adoption.

## First Slice And Acceptance
First propose pure input/state/refusal/ownership contracts and capacity/work formulas, then separately approved memory-only tests. No parser implementation or test runs are authorized here.
Acceptance includes equal/unequal/escaped/nested duplicates; unknown fields; every byte split including UTF-8/surrogates/escapes/numbers; invalid grammar; exact/one-past limits; prototype-like names; cancellation/yield points; EOF/trailing data; failure cleanup. Tests do not qualify runtime or prove real-time/RSS bounds.

## Approved Reservation
Reserve design4608/review2048/integration512 using G1 unreserved2048 plus G2 unreserved5120; reserve stop512 inside terminal. Total7680; cap393216/guard352/unallocated512 unchanged. Existing reservations/evidence stay intact. Allocation/docs approved; no policy change.

Review fix (user approved): this reflection charged design4566/integration466, giving consumed352011/unspent40341 at 977656e; the tag-read ledger (4a65529) then carried C352528/U39824. This note, the BACKLOG dates and the BACKLOG line charge 821 bytes to review unreserved1033, leaving 212; consumed 353349/unspent 39003.

[counter definitions](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_COUNTER_DESIGN.md): approved design rules only; ownership/work values and qualification remain open.
