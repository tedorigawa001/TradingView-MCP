# ES7 Read Record
2026-11-09 JST. PREPARED_UNEXECUTED; calls 0/2, one attempt; nothing adopted. Baseline 1c6b05f.
Plan: [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES7_READ_DESIGN.md), reviewed; aliases as there. Pending, separately: this record's review and approval; execution approval acknowledging the design's Unknowns.

## Request
1. `mcp__Claude_Browser__navigate` `{"url":U}`; U is the URL on design line 8.
2. `mcp__Claude_Browser__javascript_tool` `{"action":"javascript_exec","text":T}`; T is design lines 14-23 joined by LF, no final LF: 683 bytes, SHA-256 e5963349099eb7797704891446c48dd90288f830354cc72693a8cda18ed503e7.
No tabId or force; each call uses the then-fronted pane tab. Before call 1: design line 48's gates (ES6 line44, ES1 line42), whose tool and capacity checks make no browser call. PLAN lines 49-52 and the design's rules and stops apply; any stop ends the attempt. The length and tail checks, and checks that the logged navigate input url equals U and the logged javascript_exec input has T's SHA-256 (a mismatch is PLAN line52's binding drift; a match is no transport proof, ES1 line38), read this session's transcript in memory, counting UTF-16 units and printing only numbers and booleans; no text is saved.

## Destinations
Raw results: session transcript, no copy; pane keeps the page. Appended here, preparation kept: outcome, checks, omitted list, Q1-Q6 answers, any conflict with ES1-ES6 records' facts and both facts it bars, closing CONDITIONAL line, within 4096. Any stop before answers, retention shortage included: `..._ES7_READ_STOP.md` (this prefix, 512), no partial answers, here only a pointer; a stop after output arrives bars its use as answers, not its receipt. REVIEW unreserved (Z-A132). Charges: 896 KiB ledger.

## Attempt
EXECUTED 2026-11-09 11:09 JST, gates met; calls 2/2; navigate claims reused false; checks pass, title claims ECMAScript 2025; n 20303 UTF-16 units; logged inputs match U and T; mid-text loss UNKNOWN. Omitted as returned: 7.1.13-16: ToBigInt 855, StringToBigInt 846, ToBigInt64 532, ToBigUint64 462. No conflict with ES1-ES6 records' facts. Edition facts (F, R, inf: symbols in ASCII; first matching step wins; Table 13 types are disjoint):
Q1 7.1.1: ToPrimitive returns a non-Object as is; for an Object, GetMethod of %Symbol.toPrimitive%, and if defined, Call with a preferredType hint: a non-Object result returns, an Object throws TypeError; else OrdinaryToPrimitive, NUMBER if no type. 7.1.1.1: STRING tries "toString" then "valueOf", else the reverse; each is Get, then Called if callable; the first non-Object result returns, else TypeError. Derived: a Number reaches no Get, GetMethod or Call.
Q2 7.1.3: ToNumeric: ToPrimitive with NUMBER; a BigInt returns, else ToNumber. 7.1.4: ToNumber returns a Number as is; Symbol or BigInt TypeError; undefined NaN; null, false +0; true F(1); String via StringToNumber (7.1.4.1.1), NaN if unparsed; Object via ToPrimitive with NUMBER, then ToNumber. Derived: a Number gets no Q1 step or throw from either.
Q3 7.1.5: ToIntegerOrInfinity: ToNumber; NaN and both zeros give 0; infinities keep sign; else truncate(R(number)); NOTE: F of it is never -0. 7.1.22: ToIndex: that integer, RangeError unless 0 to 2^53-1 inclusive. Derived: NaN gives index 0; infinities throw.
Q4 7.1.7: ToUint32: ToNumber; non-finite or a zero gives +0; else F(truncate(R(number)) modulo 2^32); NOTE: idempotent. 7.1.11: ToUint8 likewise with 2^8. Derived: past ToNumber, no clamp or throw; out-of-range values reduce modulo.
Q5 7.1.17: a Number's ToString is Number::toString(argument, 10). 7.1.19: ToPropertyKey: ToPrimitive with STRING; a Symbol returns, else ! ToString. 7.1.21: CanonicalNumericIndexString of a String: "-0" gives -0; else n = ! ToNumber of it, returned if ! ToString(n) equals it, else undefined.
Q6 7.1.4.1.3: RoundMVResult: up to 20 significant digits give F(n); else an implementation-defined pick: digits after the 20th zeroed, or that value incremented at the 20th. No host-defined or -approximated part named.
CONDITIONAL on HES7.
