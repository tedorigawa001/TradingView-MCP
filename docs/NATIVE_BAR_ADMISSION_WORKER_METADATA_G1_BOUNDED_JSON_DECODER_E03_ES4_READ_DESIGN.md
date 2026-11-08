# ES4 Read Plan: Numeric Types In ECMA-262 16.0
2026-11-08 JST. DOCUMENTARY plan; nothing opened, read, run or qualified. Baseline HEAD e2ae1cd944b5b484cb7ec5a7ea2a8b152f282995. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Step 3 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md), fourth ES grant, for [REP](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md) line30's Float64 exactness and Number arithmetic; aliases as in PLAN; ES1 and ES2 mean [ES1's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md) and [ES2's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES2_READ_DESIGN.md) designs. Q1-Q6 here are ES4's. User decisions 2026-11-08: this clause without its BigInt children, not the first-sent Number Objects; HES4 (below); the built-in browser; funding 9984.

## Locator
User-supplied with a `_gl` query; chosen without it, as the scope question showed: `https://262.ecma-international.org/16.0/index.html#sec-numeric-types`. Label, title and host as at ES1 line8.

## Calls, one attempt, none now
1. `mcp__Claude_Browser__navigate` with that URL; its result is handled as at ES1 line11.
2. `mcp__Claude_Browser__javascript_tool`, `javascript_exec`, exactly:
```
await (async () => {
  const ok = document.readyState !== "loading" || await new Promise(r => { addEventListener("DOMContentLoaded", () => r(true)); setTimeout(() => r(false), 30000); });
  const e = document.getElementById("sec-numeric-types"), parts = [], omitted = [];
  for (const c of e ? e.children : []) {
    const h = c.querySelector(":scope > h1")?.innerText ?? "";
    if (h.includes("BigInt")) omitted.push([h, c.innerText.length]); else parts.push(c.innerText);
  }
  const t = parts.join("\n");
  return { url: location.href.split("#")[0], title: document.title, ok, found: !!e, omitted, n: t.length, tail: t.slice(-64), text: t.length <= 60000 ? t : null };
})()
```
It only reads (may add a listener and timer) and returns check fields, kept children's text and each omitted child's heading and length.

## Checks; any failure STOPs, no retry
- PLAN lines 50-52 and ES1 line23 apply; ES2 lines 29-30, 6.1.6.2 for 23.2.1-23.2.3.

## Questions
Answers in ES1 line27's form.
- Q1: Number value set: which integers are exact, up to what bound; zeros and NaN (REP line30)?
- Q2: Number::add, subtract, multiply, divide, remainder (PE lines 42-48): what result is stated, exact or rounded?
- Q3: Which rounding rule and overflow result are stated?
- Q4: Number::lessThan and Number::equal on integers: any conversion or rounding?
- Q5: Which Number operations convert operands to 32-bit integers?
- Q6: Which host-defined, implementation-defined or -approximated parts are named?

A missing answer stays UNKNOWN; ES1 line35's limits apply. Expected elsewhere, unread: operators, notation, ToNumber and other conversions, Number and Math objects, zero fill (Data Blocks).

## Correspondence use, decided now
User decision 2026-11-08, before the read, for [CORR](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_CORRESPONDENCE_DESIGN.md) line8's reasons: ES4 facts are used only under HES4, an assumption: for each Q1-Q6 fact REPORT records, the runtime labelled 24.18.0 behaves as that fact states. HES4 is OPEN and not evidence: no ES4 fact is combined with release or tag facts under it (PLAN line19); a claim resting on it is CONDITIONAL on HES4; REPORT's facts stay edition facts; CORR line21 holds for it as for HES1. It also assumes REPORT's records match the text, which only the reading session checks, and inherits the attempt's stated limits. REPORT ends CONDITIONAL on HES4, not with PLAN line41's STOP (CORR line22). A stop before answers leaves HES4 covering nothing. A claim on ES1-ES4 facts rests on each read's assumption; that they saw the same page is UNKNOWN.

## Unknowns
ES2 line47's, and: n counts UTF-16 units; url or ok cannot show a reload.

## Records and gates
As at ES2 line50, under this file's prefix.

## Next, not approved
The grants expected above and step 4's ER slice, each with its own locator, funding and approvals (PLAN lines 49-50); each ES grant also needs a correspondence decision (CORR line22).

## Retention
Reserve9984 from F60544 ->50560: design4608/report3584/stop512/integration1280 (ledger and backlog growth). Saving a review needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
