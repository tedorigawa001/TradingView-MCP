# ES2 Read Record
2026-11-08 JST. PREPARED_UNEXECUTED; calls 0/2, one attempt; nothing adopted. Baseline 275afdf.
Plan: [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES2_READ_DESIGN.md), reviewed; aliases as there. Pending, separately: this record's review and approval; execution approval acknowledging the design's Unknowns.

## Request
1. `mcp__Claude_Browser__navigate` `{"url":U}`; U is the URL on design line 8.
2. `mcp__Claude_Browser__javascript_tool` `{"action":"javascript_exec","text":T}`; T is design lines 14-23 joined by LF, no final LF: 688 bytes, SHA-256 2316d12f3681096da0fa10f63e503f86ee5cc2a5b5c1acc2e3a434dbeed20b64.
No tabId or force; each call uses the then-fronted pane tab. Before call 1: design line 50's gates (ES1 line42), whose tool and capacity checks make no browser call. PLAN lines 49-52 and the design's rules and stops apply; any stop ends the attempt.

## Destinations
Raw results: session transcript, no copy; pane keeps the page. Appended here, preparation kept: outcome, checks, omitted list, Q1-Q6 answers, closing CONDITIONAL line, within 2560. Any stop before answers, retention shortage included: `..._ES2_READ_STOP.md` (this prefix, 512), no partial answers, here only a pointer; a stop after output arrives bars its use as answers, not its receipt. REVIEW unreserved (Z-A132). Charges: 896 KiB ledger.

## Attempt
EXECUTED 18:15 JST, gates met; calls 2/2; new pane; checks pass, title claims ECMAScript 2025; n 18586 UTF-16 units; mid-text loss UNKNOWN. Omitted as returned: 23.2.1 The %TypedArray% Intrinsic Object 772; 23.2.2 Properties of the %TypedArray% Intrinsic Object 3348; 23.2.3 Properties of the %TypedArray% Prototype Object 38354. Edition facts:
Q1 Table 73 (23.2): Uint8Array UINT8, size 1, ToUint8; Float64Array FLOAT64, size 8, no conversion listed.
Q2 23.2.5.1: TypeError sans new; first AllocateTypedArray (GetPrototypeFromConstructor, TypedArrayCreate). 23.2.5.1.3: ToIndex on byteOffset, RangeError if no element-size multiple; ToIndex on a given length; then TypeError if detached; RangeError past the byte length (fixed buffer, length absent: also a non-multiple one). User code UNKNOWN.
Q3 23.2.5.1.3: fixed-length buffer, fixed lengths; only an absent length on a non-fixed buffer tracks (AUTO).
Q4 Steps of 23.2.5.1.1 sans length and of 23.2.5.1.3 allocate, copy or detach no buffer.
Q5 No indexed get or set named; other paths use Set, GetValueFromBuffer, SetValueInBuffer. Element coercion, reentry, user code UNKNOWN.
Q6 None named.
CONDITIONAL on HES2.
