# ES5 Read Record
2026-11-08 JST. PREPARED_UNEXECUTED; calls 0/2, one attempt; nothing adopted. Baseline 1981554.
Plan: [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES5_READ_DESIGN.md), reviewed; aliases as there. Pending, separately: this record's review and approval; execution approval acknowledging the design's Unknowns.

## Request
1. `mcp__Claude_Browser__navigate` `{"url":U}`; U is the URL on design line 8.
2. `mcp__Claude_Browser__javascript_tool` `{"action":"javascript_exec","text":T}`; T is design lines 14-18 joined by LF, no final LF: 441 bytes, SHA-256 0419cf7d4021bca12b080cc4cf3a231dcdd0e4c76681e7fa158ffc505bee6180.
No tabId or force; each call uses the then-fronted pane tab. Before call 1: design line 44's gates (ES1 line42), whose tool and capacity checks make no browser call. PLAN lines 49-52 and the design's rules and stops apply; any stop ends the attempt. The length and tail checks, and checks that the logged navigate input url equals U and the logged javascript_exec input has T's SHA-256 (a mismatch is PLAN line52's binding drift; a match is no transport proof, ES1 line38), read this session's transcript in memory, counting UTF-16 units and printing only numbers and booleans; no text is saved.

## Destinations
Raw results: session transcript, no copy; pane keeps the page. Appended here, preparation kept: outcome, checks, Q1-Q6 answers, closing CONDITIONAL line, within 3584. Any stop before answers, retention shortage included: `..._ES5_READ_STOP.md` (this prefix, 512), no partial answers, here only a pointer; a stop after output arrives bars its use as answers, not its receipt. REVIEW unreserved (Z-A132). Charges: 896 KiB ledger.

## Attempt
EXECUTED 22:29 JST, gates met; calls 2/2; navigate claims reused false; checks pass, title claims ECMAScript 2025; n 5749 UTF-16 units; logged inputs match U and T; mid-text loss UNKNOWN. Edition facts:
Q1 5.2.5: four kinds: mathematical values (arbitrary reals, the default), extended ones (adding +inf and -inf), Numbers (binary64) and BigInts; an unmarked value is mathematical, a subscript F marks a Number. An integer is a mathematical value in the integers, unless stated otherwise. Conversions are explicit: F(x) (symbols in ASCII), the Number value for x, from a plain or extended mathematical value, is defined in 6.1.6.1 (ES4 line17 for reals); R(x) is the mathematical value of a Number or BigInt x.
Q2 5.2.5: numeric operators, comparisons included, follow operand type: the usual mathematical operation on mathematical values, the extended-real one (indeterminate forms not defined) on extended ones, the IEEE 754-2019 one on Numbers; no rounding of results on mathematical values is stated.
Q3 5.2.5: abs(x) is -x if x < 0, else x. floor(x) is the largest integer not above x (NOTE: x - (x modulo 1)). truncate(x) rounds toward zero: -floor(-x) if x < 0, else floor(x). x modulo y, for finite non-zero y, is the k with y's sign or zero, abs(k) < abs(y), and x - k an integer multiple of y.
Q4 5.2.5: no: operators on mixed types (e.g. a Number and a mathematical value) are not defined, an editorial error; min, max, abs, floor and truncate are likewise not defined for Numbers or BigInts.
Q5 5.2.5: R(x) is 0 for both zeros, not defined for non-finite x; the extended mathematical value maps the infinities to +inf and -inf, not defined for NaN; F(x) here: UNKNOWN. In intervals, one type each, -0F < +0F and NaN never belongs.
Q6 5.2.5: no host-defined, implementation-defined or -approximated part is named.
CONDITIONAL on HES5.
