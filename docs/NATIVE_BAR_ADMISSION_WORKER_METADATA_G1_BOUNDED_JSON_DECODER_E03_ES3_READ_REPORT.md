# ES3 Read Record
2026-11-08 JST. PREPARED_UNEXECUTED; calls 0/2, one attempt; nothing adopted. Baseline c0b1c48.
Plan: [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES3_READ_DESIGN.md), reviewed; aliases as there. Pending, separately: this record's review and approval; execution approval acknowledging the design's Unknowns.

## Request
1. `mcp__Claude_Browser__navigate` `{"url":U}`; U is the URL on design line 8.
2. `mcp__Claude_Browser__javascript_tool` `{"action":"javascript_exec","text":T}`; T is design lines 14-18 joined by LF, no final LF: 443 bytes, SHA-256 b3fa1d22184da727f62f155e182b9657adaa8846fd738c8d1ce253d6bfc3ffab.
No tabId or force; each call uses the then-fronted pane tab. Before call 1: design line 44's gates (ES1 line42), whose tool and capacity checks make no browser call. PLAN lines 49-52 and the design's rules and stops apply; any stop ends the attempt. The length and tail checks, and a SHA-256 check of the logged javascript_exec input against T (a mismatch is PLAN line52's binding drift; a match is no transport proof, ES1 line38), read this session's transcript in memory, counting UTF-16 units and printing only numbers and booleans; no text is saved.

## Destinations
Raw results: session transcript, no copy; pane keeps the page. Appended here, preparation kept: outcome, checks, Q1-Q6 answers, closing CONDITIONAL line, within 3072. Any stop before answers, retention shortage included: `..._ES3_READ_STOP.md` (this prefix, 512), no partial answers, here only a pointer; a stop after output arrives bars its use as answers, not its receipt. REVIEW unreserved (Z-A132). Charges: 896 KiB ledger.

## Attempt
EXECUTED 19:51 JST, gates met; calls 2/2; navigate claims reused false; checks pass, title claims ECMAScript 2025; n 14241 UTF-16 units; logged input matches T; mid-text loss UNKNOWN. Edition facts:
Q1 10.4.5.5: a key CanonicalNumericIndexString maps to a Number returns TypedArrayGetElement directly, no prototype lookup; others OrdinaryGet. 10.4.5.17: invalid index gives undefined, else GetValueFromBuffer. That path has no ? step; CanonicalNumericIndexString's mapping, user code UNKNOWN.
Q2 10.4.5.6: that key, Receiver O: ? TypedArraySetElement, true; other Receiver: true if invalid, else OrdinarySet. 10.4.5.18: ToNumber (ToBigInt if BIGINT) first, may throw; then IsValidIntegerIndex; valid: SetValueInBuffer; invalid: no write, no error (NOTE). User code, reentry in ToNumber UNKNOWN.
Q3 10.4.5.2-7: only String keys; any CanonicalNumericIndexString result but undefined takes the element path, non-integral or -0 too, then invalid; others and Symbols go ordinary.
Q4 10.4.5.16: invalid if detached, non-integral, -0 or negative, out of bounds, or not below length. 10.4.5.13-14: non-AUTO length is [[ArrayLength]]; out of bounds if detached or ByteOffset or ByteOffset+length*size exceeds the buffer byte length.
Q5 10.4.5.17-18: byte index = index*size + ByteOffset; GetValueFromBuffer and SetValueInBuffer, UNORDERED, no byte order argument.
Q6 None named.
CONDITIONAL on HES3.
