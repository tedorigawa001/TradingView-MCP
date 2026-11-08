# ES5 Read Plan: Mathematical Operations In ECMA-262 16.0
2026-11-08 JST. DOCUMENTARY plan; nothing opened, read, run or qualified. Baseline HEAD b1c4bcc2e05a6b3ee589586d3bc06876e2c82ebe. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Step 3 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md), fifth ES grant, for [REP](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md) line30's Number arithmetic, via the notation ES4 line16 leaves outside; aliases as in PLAN; ES1 and ES4 mean [ES1's design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md) and [ES4's record](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES4_READ_REPORT.md). Q1-Q6 here are ES5's. User decisions 2026-11-08: the whole clause, cap 60000; HES5 (below); the built-in browser; funding 9984.

## Locator
User-supplied with a `_gl` query; chosen without it, as the scope question showed: `https://262.ecma-international.org/16.0/index.html#sec-mathematical-operations`. Label, title and host as at ES1 line8.

## Calls, one attempt, none now
1. `mcp__Claude_Browser__navigate` with that URL; its result is handled as at ES1 line11.
2. `mcp__Claude_Browser__javascript_tool`, `javascript_exec`, exactly:
```
await (async () => {
  const ok = document.readyState !== "loading" || await new Promise(r => { addEventListener("DOMContentLoaded", () => r(true)); setTimeout(() => r(false), 30000); });
  const e = document.getElementById("sec-mathematical-operations"), t = e ? e.innerText : "";
  return { url: location.href.split("#")[0], title: document.title, ok, found: !!e, n: t.length, tail: t.slice(-64), text: t.length <= 60000 ? t : null };
})()
```
It only reads, may add a listener and timer, and returns only clause and check fields (PLAN line50).

## Checks; any failure STOPs, no retry
- PLAN lines 50-52 and ES1 line23 apply.
- ES1 line24's checks, for this locator; also text's length is n, and n 0 STOPs.

## Questions
Answers in ES1 line27's form.
- Q1: What are mathematical values and integers; how are the real-value and Number-value notations defined; how do they relate to ES4 line17's rule (REP line30)?
- Q2: How are operations and comparisons on mathematical values stated; any rounding?
- Q3: How are truncate, floor, abs and modulo defined?
- Q4: May Numbers and mathematical values mix in an operation or comparison?
- Q5: What do the notations give for zeros, NaN and the infinities?
- Q6: Which host-defined, implementation-defined or -approximated parts are named?

A missing answer stays UNKNOWN; ES1 line35's limits apply. Expected elsewhere, unread: operators, ToNumber and other conversions, Number and Math objects, zero fill (Data Blocks). Not covered: ES4 line16's zero-case results and negation.

## Correspondence use, decided now
User decision 2026-11-08, before the read, for [CORR](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_CORRESPONDENCE_DESIGN.md) line8's reasons: ES5 facts are used only under HES5, an assumption: for each Q1-Q6 fact REPORT records, the runtime labelled 24.18.0 behaves as that fact states. HES5 is OPEN and not evidence: no ES5 fact is combined with release or tag facts under it (PLAN line19); a claim resting on it is CONDITIONAL on HES5; REPORT's facts stay edition facts; CORR line21 holds for it as for HES1. It also assumes REPORT's records match the text, which only the reading session checks, and inherits the attempt's stated limits. REPORT ends CONDITIONAL on HES5, not with PLAN line41's STOP (CORR line22). A stop before answers leaves HES5 covering nothing. A claim on ES1-ES5 facts rests on each read's assumption; that they saw the same page is UNKNOWN.

## Unknowns
ES1 line38's, and: 60000 is a cap, not a known limit; n counts UTF-16 units; url or ok cannot show a reload.

## Records and gates
Records share this file's prefix (PLAN line53): REPORT (prepared request, outcome, answers, closing CONDITIONAL line); STOP (reason and state of a stop before answers). Gates as at ES1 line42.

## Next, not approved
The grants expected above and step 4's ER slice, each with its own locator, funding and approvals (PLAN lines 49-50); each ES grant also needs a correspondence decision (CORR line22).

## Retention
Reserve9984 from F50560 ->40576: design4608/report3584/stop512/integration1280 (ledger and backlog growth). Saving a review needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
