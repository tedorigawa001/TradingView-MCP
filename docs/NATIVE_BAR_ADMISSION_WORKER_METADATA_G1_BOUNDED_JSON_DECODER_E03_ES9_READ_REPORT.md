# ES9 Read Record
2026-11-09 JST. PREPARED_UNEXECUTED; calls 0/2, one attempt; nothing adopted. Baseline f1c74df.
Plan: [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES9_READ_DESIGN.md), reviewed; aliases as there. Pending, separately: this record's review and approval; execution approval acknowledging the design's Unknowns.

## Request
1. `mcp__Claude_Browser__navigate` `{"url":U}`; U is the URL on design line 8.
2. `mcp__Claude_Browser__javascript_tool` `{"action":"javascript_exec","text":T}`; T is design lines 14-18 joined by LF, no final LF: 430 bytes, SHA-256 71967cef66fde1acef77242598bd668a65c05bf128ce42bd28d3533fe64e352d.
No tabId or force; each call uses the then-fronted pane tab. Before call 1: design line 44's gates (ES6 line44, ES1 line42), whose tool and capacity checks make no browser call. PLAN lines 49-52 and the design's rules and stops apply; any stop ends the attempt. The length and tail checks, and checks that the logged navigate input url equals U and the logged javascript_exec input has T's SHA-256 (a mismatch is PLAN line52's binding drift; a match is no transport proof, ES1 line38), read this session's transcript in memory, counting UTF-16 units and printing only numbers and booleans; no text is saved.

## Destinations
Raw results: session transcript, no copy; pane keeps the page. Appended here, preparation kept: outcome, checks, Q1-Q6 answers, any conflict with ES1-ES8 records' facts and both facts it bars, closing CONDITIONAL line, within 4096. Any stop before answers, retention shortage included: `..._ES9_READ_STOP.md` (this prefix, 512), no partial answers, here only a pointer; a stop after output arrives bars its use as answers, not its receipt. REVIEW unreserved (Z-A132). Charges: 1024 KiB ledger.

## Attempt
EXECUTED 2026-11-09 18:50 JST, gates met; calls 2/2; navigate claims reused false; checks pass, title claims ECMAScript 2025; n 5436 UTF-16 units; logged inputs match U and T; mid-text loss UNKNOWN. No conflict with ES1-ES8 records' facts. Edition facts (first matching step wins; shared paths named only):
Q1 6.2.9: a byte value is an integer 0 to 255. A Data Block value is a distinct, mutable sequence of 8-bit values, created with a fixed number of bytes, each initially 0; db[i] is notation for its 0-based byte i. A Shared Data Block is a data block several agents can reference at once; its identity is its set of memory locations. Two data blocks are equal only if their location sets are equal, else disjoint. Shared ones can be told apart from Data Blocks; whether the Data Block value facts cover them is not stated.
Q2 6.2.9.1: CreateByteDataBlock throws a RangeError if size exceeds 2^53-1, or if such a block cannot be created; it then sets every byte to 0. 6.2.9.2: CreateSharedByteDataBlock throws a RangeError if the block cannot be created; it sets no byte; it appends per index an INIT WriteSharedMemory event, payload 0. Both kinds: Q1.
Q3 6.2.9.3: CopyDataBlockBytes asserts the two blocks are distinct values and both ranges fit their sizes, then copies count bytes one by one in rising index order: a shared source reads through events and a chosen byte; else it asserts a non-shared target and sets toBlock[toIndex] to fromBlock[fromIndex]. No throw step.
Q4 Derived, 6.2.9: the mutable-sequence definition and db[i] notation give the value last set, given algorithm conventions, the buffer still holding that block and non-shared status (named); no sentence states it.
Q5 6.2.9: Shared Data Block semantics are left to the memory model: the operations here introduce its events (Records defined there), forming a candidate execution the memory model filters; the shared steps also use the surrounding agent's Agent Record.
Q6 6.2.9, .1-.3: no host-defined, implementation-defined, -chosen or -approximated part named. Nondeterministic: a shared source's copied byte (NOTE: non-atomic hardware read). Unclassified: RangeError when creation is impossible.
CONDITIONAL on HES9.
