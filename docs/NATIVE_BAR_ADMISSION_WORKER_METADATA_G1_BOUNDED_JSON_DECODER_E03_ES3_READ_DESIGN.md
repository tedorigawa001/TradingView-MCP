# ES3 Read Plan: TypedArray Exotic Objects In ECMA-262 16.0
2026-11-08 JST. DOCUMENTARY plan; nothing opened, read, run or qualified. Baseline HEAD 4e81eb533200c19d1d29879c74f86a1754b99b06. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Step 3 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md), third ES grant, for [REP](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md) line30's element get and set; aliases as in PLAN; ES1 means [its design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md). Q1-Q6 here are ES3's. User decisions 2026-11-08: the whole clause, cap 60000; HES3 (below); the built-in browser; funding 9472.

## Locator
User-supplied with a `_gl` query; chosen without it, as the scope question showed: `https://262.ecma-international.org/16.0/index.html#sec-typedarray-exotic-objects`. Label, title and host as at ES1 line8.

## Calls, one attempt, none now
1. `mcp__Claude_Browser__navigate` with that URL; its result is handled as at ES1 line11.
2. `mcp__Claude_Browser__javascript_tool`, `javascript_exec`, exactly:
```
await (async () => {
  const ok = document.readyState !== "loading" || await new Promise(r => { addEventListener("DOMContentLoaded", () => r(true)); setTimeout(() => r(false), 30000); });
  const e = document.getElementById("sec-typedarray-exotic-objects"), t = e ? e.innerText : "";
  return { url: location.href.split("#")[0], title: document.title, ok, found: !!e, n: t.length, tail: t.slice(-64), text: t.length <= 60000 ? t : null };
})()
```
It only reads, may add a listener and timer, and returns only the clause and check fields (PLAN line50).

## Checks; any failure STOPs, no retry
- PLAN lines 50-52 and ES1 line23 apply.
- ES1 line24's checks, for this locator; also text's length is n, and n 0 STOPs.

## Questions
Answers in ES1 line27's form.
- Q1: [[Get]] at an integer index: operations run; prototype chain consulted; any coercion, reentry or user code stated (REP line30)?
- Q2: [[Set]] there: any value conversion, by what, and its order relative to any index check; user code or reentry; effect at an invalid index?
- Q3: Which keys count as integer indices (numeric strings, non-integers, -0), and which go to ordinary handling?
- Q4: What makes an index invalid; how are length and bounds found on a fixed-length buffer (REP line30)?
- Q5: Element read and write in the buffer: index to byte position, operations, memory order, byte order?
- Q6: Which host-defined operations are named?

A missing answer stays UNKNOWN; ES1 line35's limits apply. Expected elsewhere, unread: ToNumber and other conversions, Float64 exactness and Number arithmetic (Number), zero fill (Data Blocks).

## Correspondence use, decided now
User decision 2026-11-08, before the read, for [CORR](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_CORRESPONDENCE_DESIGN.md) line8's reasons: ES3 facts are used only under HES3, an assumption: for each Q1-Q6 fact REPORT records, the runtime labelled 24.18.0 behaves as that fact states. HES3 is OPEN and not evidence: no ES3 fact is combined with release or tag facts under it (PLAN line19); a claim resting on it is CONDITIONAL on HES3; REPORT's facts stay edition facts; CORR line21 holds for it as for HES1. It also assumes REPORT's records match the text, which only the reading session checks, and inherits the attempt's stated limits. REPORT ends CONDITIONAL on HES3, not with PLAN line41's STOP (CORR line22). A stop before answers leaves HES3 covering nothing. A claim on ES1-ES3 facts rests on each read's assumption; that they saw the same page is UNKNOWN.

## Unknowns
ES1 line38's, and: 60000 is a cap, not a known limit; n counts UTF-16 units; navigate may not reload a page the pane holds, which url or ok cannot show.

## Records and gates
Records share this file's prefix (PLAN line53): REPORT (prepared request, outcome, answers, closing CONDITIONAL line); STOP (reason and state of a stop before answers). Gates before the call as at ES1 line42.

## Next, not approved
The grants expected above and step 4's ER slice, each with its own locator, funding and approvals (PLAN lines 49-50); each ES grant also needs a correspondence decision (CORR line22).

## Retention
Reserve9472 from F70016 ->60544: design4608/report3072/stop512/integration1280 (ledger and backlog growth). Saving a review needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
