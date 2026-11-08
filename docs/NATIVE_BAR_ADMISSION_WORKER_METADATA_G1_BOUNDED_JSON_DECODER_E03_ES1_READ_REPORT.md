# ES1 Read Record
2026-11-08 JST. PREPARED_UNEXECUTED; calls 0/2, one attempt; nothing adopted. Baseline 6f2c0c2.
Plan: [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md), reviewed; aliases as there. Pending, separately: this record's review and approval; execution approval acknowledging the design's Unknowns.

## Request
1. `mcp__Claude_Browser__navigate` `{"url":U}`; U is the URL on design line 8.
2. `mcp__Claude_Browser__javascript_tool` `{"action":"javascript_exec","text":T}`; T is design lines 14-18 joined by LF, no final LF: 425 bytes, SHA-256 0fb772379b7ffc50843258fb3609031c368099495cd65fe84b48fdce93244aea.
No tabId or force; each call uses the then-fronted pane tab. Before call 1: design line 42 gates, whose tool and capacity checks make no browser call. PLAN lines 49-52 and the design's rules and stops apply; any stop ends the attempt.

## Destinations
Raw results: session transcript, no copy; pane keeps the page. Appended here, preparation kept: outcome, checks, Q1-Q6 answers, closing STOP, within 2048. Any stop before answers, retention shortage included: `..._ES1_READ_STOP.md` (this prefix, 512), no partial answers, here only a pointer. REVIEW unreserved (Z-A132). Charges: 896 KiB ledger.

## Attempt
EXECUTED 12:12-12:13 JST, gates met; calls 2/2; checks pass, title claims ECMAScript 2025; mid-text loss UNKNOWN. Edition facts:
Q1 25.1.3.1/.7/.9: without maxByteLength, fixed-length.
Q2 25.1.4.1: TypeError sans new; ToIndex on length and (25.1.3.7) maxByteLength. 25.1.3.1: RangeError over or unallocatable max; OrdinaryCreateFromConstructor, CreateByteDataBlock may throw.
Q3 Not in text: UNKNOWN.
Q4 DetachArrayBuffer (25.1.3.5): detach key must match, undefined unless embedder-set; transfer, transferToFixedLength detach keyless ones.
Q5 25.1.3.14-18: binary64 or unsigned bytes, order as asked, else agent's; takes Number; no throw; Uint8 conversion outside.
Q6 HostResizeArrayBuffer (25.1.3.8); must not detach.
STOP: 24.18.0 correspondence UNKNOWN (PLAN line41).
