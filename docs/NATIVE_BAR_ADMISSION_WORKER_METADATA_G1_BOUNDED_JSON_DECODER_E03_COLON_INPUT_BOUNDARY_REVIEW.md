# Colon/Input Boundary Review Record
Saved 2026-11-04 JST from one chat review and one independent source trace, at user approval; documents only, no test/model run. No route selected; no proof, adoption or runtime grant. Dot PAUSED; judgment/notification/mail unchanged.
BND=[design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_COLON_INPUT_BOUNDARY_DESIGN.md), 10124 bytes, SHA-256 2aa55c25483c505ca3a998c21b992852296409ff0919d8816fe88763946fa49b; text unchanged because RT pins it. Baseline e9f1645c1c31cfd214c4b693fe0a733be6dcf3dd.
RT/RR=reference-target/representation designs, SHA-256 56aa016911b3e36a4d5f4f6ea3851de5c96e4706f88fe0190cc09cbb7763a6d3/a1d5980601233bb06f60d6826c26398776152602b538c5f0b0a38170baefa02a. OWN=ownership design; H/I/ORD/S/W as already aliased.
Caps: metadata1024/R1 1536/R2 1536 include headings/links. Charge R3904/L461 from BND's review4096/integration503 left; current C547288/U104136; cap655360/guard352/unallocated3584 unchanged.

## Review 1: Finding (P2)
BND's real-input premise does not follow from its sources, and no E03 document cites OWN directly (I:29, W:3 and the parameter-evidence alias do).
CB3 allows index progress only with real unconsumed input. Yet I:8 gates advance on state alone; I:15 resumes without new input; OWN:24-27 keep READY/YIELDED for release after consumption, before NEED_INPUT/WAIT_EOF; W:34 charges that as normal work; S28 runs object-close release under READY/YIELDED. CB6 reads as needing a zero-byte advance to leave READY.
Consequences:
1. With zero bytes left and IdxPending, only NEED_INPUT (CB0) and Idx-free CB6 have rows. Other READY/YIELDED in PARSE_READY or RELEASE_INPUT has none, including fuel ending on a final colon.
2. A valid document needs a later byte after key close, colon and nested close, but not after root close, so waiting for a later delivery cannot be relied on there.
3. Uncompared routes: zero-byte normal work before the exhaustion transition; a classified close delimiter held unconsumed during S28 release (H:47 leaves timing OPEN; BND:6 consumes colon); S29's reserve (release, not Idx).
Limits: OWN:25 lists copy/release only, so using it for Idx is a refinement needing approval and proof. OWN:27 lets a yielded release continue only that operation, so Idx cannot interleave; before RELEASE_INPUT, input and index temporaries overlap in peak (W:24, S39); after it, OWN names no phase.
P3: CB11 names no post-state, while OWN:27 sends a live failed/unknown release or lost owner to REFUSED.

## Review 2: Independent Trace And Scope
A separate read-only reviewer got the sources and questions, not this finding. It found no pre-BND clause requiring unconsumed bytes in READY/YIELDED and the same missing rows; it also found that Idx before the exhaustion transition literally violates only RR:56, with BND:28/54 the nearest strains, and it raised the held-brace route, CB6 and CB11. BND:56/ORD:14 leave "inputless" undefined; a reading covering every zero-byte advance would also catch OWN:27 and CB6. Reachability and route conclusions are inferences from text, not executed facts.
Inherited: RR:56 says "READY/YIELDED needs real admitted unconsumed input" and that BND governs exhaustion, but BND:7, BND:18, BND:55-56, RR:6 and RR:70 keep exhaustion driving OPEN; read literally it also excludes CB6's READY. RR stays unchanged here; correcting it needs separate approval. RT's T3 stays conditional on this gate. BND:16 calls zero bytes drained; OWN:25 says a pending release is not.
The chat review found no other concrete defect in RT or RR against KVS, PR, S24-28, W8 and A4. Mechanical checks at e9f1645 passed: pins, charges C521465/C532233/C542923, hygiene, links.
OPEN: route choice, exhaustion timing, root-close acceptance, finite costs and owner lifetime. No A1-A3/A4-A7/E03/E05/E06 or host gate closes. Comparing routes by model or test needs separate approval.
