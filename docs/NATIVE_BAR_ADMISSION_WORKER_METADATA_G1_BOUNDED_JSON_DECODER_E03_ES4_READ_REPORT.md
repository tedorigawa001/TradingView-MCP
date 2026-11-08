# ES4 Read Record
2026-11-08 JST. PREPARED_UNEXECUTED; calls 0/2, one attempt; nothing adopted. Baseline 6614798.
Plan: [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES4_READ_DESIGN.md), reviewed; aliases as there. Pending, separately: this record's review and approval; execution approval acknowledging the design's Unknowns.

## Request
1. `mcp__Claude_Browser__navigate` `{"url":U}`; U is the URL on design line 8.
2. `mcp__Claude_Browser__javascript_tool` `{"action":"javascript_exec","text":T}`; T is design lines 14-23 joined by LF, no final LF: 677 bytes, SHA-256 f9b76014ba25a3de8d963868d2d87fa20665ea93d81997e04489f5dfed566a7e.
No tabId or force; each call uses the then-fronted pane tab. Before call 1: design line 48's gates (ES2 line50, ES1 line42), whose tool and capacity checks make no browser call. PLAN lines 49-52 and the design's rules and stops apply; any stop ends the attempt. The length and tail checks, and a SHA-256 check of the logged javascript_exec input against T (a mismatch is PLAN line52's binding drift; a match is no transport proof, ES1 line38), read this session's transcript in memory, counting UTF-16 units and printing only numbers and booleans; no text is saved.

## Destinations
Raw results: session transcript, no copy; pane keeps the page. Appended here, preparation kept: outcome, checks, omitted list, Q1-Q6 answers, closing CONDITIONAL line, within 3584. Any stop before answers, retention shortage included: `..._ES4_READ_STOP.md` (this prefix, 512), no partial answers, here only a pointer; a stop after output arrives bars its use as answers, not its receipt. REVIEW unreserved (Z-A132). Charges: 896 KiB ledger.

## Attempt
EXECUTED 20:31 JST, gates met; calls 2/2; navigate gave no reuse field; checks pass, title claims ECMAScript 2025; n 24656 UTF-16 units; logged input matches T; mid-text loss UNKNOWN. Omitted as returned: 6.1.6.2 The BigInt Type 7646. Edition facts:
Q1 6.1.6.1: IEEE 754-2019 binary64 values with a single NaN, two infinities, +0 and -0; finite values normalized (m from 2^52 to below 2^53) or denormalized; all integers of magnitude up to 2^53 are stated representable.
Q2 6.1.6.1.4, .5, .7: after cases for NaN, infinities and zeros, multiply, divide and add end by applying F to the real product, quotient or sum (F, real, truncate: notation defined outside). .8: subtract is add of the negation. .6: remainder, after cases for NaN, infinities and zeros, gives F of r = n - d*truncate(n/d) in reals, -0 when r is 0 and n negative. Table 2 (6.1.6) names the operators invoking each; operator evaluation is outside.
Q3 6.1.6.1: the Number value for a real x is the nearest finite Number, -0 removed and 2^1024 and its negative added, ties to an even significand; those two become the infinities, and +0 becomes -0 if x < 0; stated to match roundTiesToEven.
Q4 6.1.6.1.12: lessThan is undefined if either is NaN; after same-value, zero and infinity cases it compares real values. .13: equal is false for NaN, true for the same value or the two zeros, else false. Their steps call no conversion operation and apply no F.
Q5 6.1.6.1.2, .9-.11, .16-.19: bitwiseNOT, the shifts, NumberBitwiseOp and its and/xor/or callers use ToInt32 or ToUint32; shift counts are taken modulo 32.
Q6 6.1.6.1.3: exponentiate is implementation-approximated. 6.1.6.1: telling NaNs apart from outside is implementation-defined; a stored bit pattern need not match the internal one (NOTE). No host-defined operation named.
CONDITIONAL on HES4.
