# ES6 Read Plan: The Number Type In ECMA-262 16.0
2026-11-08 JST. DOCUMENTARY plan; nothing opened, read, run or qualified. Baseline HEAD 53b4d87fd7af06760e717b162d31f8ff310e1102. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Step 3 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md), sixth ES grant, for [REP](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md) line30's Number arithmetic: the zero-case and negation results ES4 line16 leaves out; aliases as in PLAN; ES1 and ES4 mean [ES1's design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md) and [ES4's record](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES4_READ_REPORT.md). Q1-Q6 here are ES6's. User decisions 2026-11-08: the whole clause, cap 60000; a new read, not ES4's retry, follow-up or output reuse (PLAN line50); HES6 (below); the built-in browser; funding 9984.

## Locator
User-supplied with a `_gl` query, dropped, user forewarned: `https://262.ecma-international.org/16.0/index.html#sec-ecmascript-language-types-number-type`. Label, title and host as at ES1 line8.

## Calls, one attempt, none now
1. `mcp__Claude_Browser__navigate` with that URL; its result is handled as at ES1 line11.
2. `mcp__Claude_Browser__javascript_tool`, `javascript_exec`, exactly:
```
await (async () => {
  const ok = document.readyState !== "loading" || await new Promise(r => { addEventListener("DOMContentLoaded", () => r(true)); setTimeout(() => r(false), 30000); });
  const e = document.getElementById("sec-ecmascript-language-types-number-type"), t = e ? e.innerText : "";
  return { url: location.href.split("#")[0], title: document.title, ok, found: !!e, n: t.length, tail: t.slice(-64), text: t.length <= 60000 ? t : null };
})()
```
It only reads, may add a listener and timer, and returns only clause and check fields (PLAN line50).

## Checks; any failure STOPs, no retry
- PLAN lines 50-52 and ES1 line23 apply.
- ES1 line24's checks, for this locator; also text's length is n, and n 0 STOPs.

## Questions
Answers in ES1 line27's form.
- Q1: Add and multiply (ES4 line16's .7, .4): signed results for a zero operand, and for finite addends summing to zero?
- Q2: What do subtract (.8) and negation give, zeros included?
- Q3: Divide and remainder (.5, .6): signed results for a zero dividend or divisor?
- Q4: Which of these, past NaN, infinity and zero cases, end in F of the real result?
- Q5: What is the Number value for 0 and infinities?
- Q6: Which host-defined, implementation-defined or -approximated parts named beyond ES4 line20?

A missing answer stays UNKNOWN; ES1 line35's limits apply. Elsewhere, unread: operators, conversions, Number and Math objects, Data Blocks' zero fill. ES4's facts stay under HES4; a conflict bars both.

## Correspondence use, decided now
User decision 2026-11-08, before the read, for [CORR](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_CORRESPONDENCE_DESIGN.md) line8's reasons: ES6 facts are used only under HES6, an assumption: for each Q1-Q6 fact REPORT records, the runtime labelled 24.18.0 behaves as that fact states. HES6 is OPEN and not evidence: no ES6 fact is combined with release or tag facts under it (PLAN line19); a claim resting on it is CONDITIONAL on HES6; REPORT's facts stay edition facts; CORR line21 holds for it as for HES1. It also assumes REPORT's records match the text, which only the reading session checks, and inherits the attempt's stated limits. REPORT ends CONDITIONAL on HES6, not with PLAN line41's STOP (CORR line22). A stop before answers leaves HES6 covering nothing. A claim on ES1-ES6 facts rests on each read's assumption; that they saw the same page is UNKNOWN.

## Unknowns
ES1 line38's, and: 60000 is a cap, not a known limit; n counts UTF-16 units; url or ok cannot show a reload.

## Records and gates
Records share this file's prefix (PLAN line53): REPORT (prepared request, outcome, answers, closing CONDITIONAL line); STOP (reason and state of a stop before answers). Gates as at ES1 line42.

## Next, not approved
Later grants and step 4's ER slice each need their own locator, funding and approvals (PLAN lines 49-50), and each ES grant a correspondence decision (CORR line22).

## Retention
Reserve9984 from F40576 ->30592: design4608/report3584/stop512/integration1280 (ledger and backlog growth). Saving a review needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
