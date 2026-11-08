# ES2 Read Plan: TypedArray Objects In ECMA-262 16.0
2026-11-08 JST. DOCUMENTARY plan; nothing opened, read, run or qualified. Baseline HEAD 94508a4f5c6d7a1316364eb0b44fd3f9ad8ec48a. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Step 3 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md), second ES grant, for [REP](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md) line30's row and the view rules of lines 20-23; aliases as in PLAN; ES1 means [its design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md). Q1-Q6 here are ES2's. User decisions 2026-11-08: the clause without its %TypedArray% children; HES2 (below); the built-in browser; funding 9216.

## Locator
User-supplied with the `_gl` analytics query; chosen without it, as the scope question showed: `https://262.ecma-international.org/16.0/index.html#sec-typedarray-objects`. Label, title and host as at ES1 line8.

## Calls, one attempt, none now
1. `mcp__Claude_Browser__navigate` with that URL; its result is handled as at ES1 line11.
2. `mcp__Claude_Browser__javascript_tool`, `javascript_exec`, exactly:
```
await (async () => {
  const ok = document.readyState !== "loading" || await new Promise(r => { addEventListener("DOMContentLoaded", () => r(true)); setTimeout(() => r(false), 30000); });
  const e = document.getElementById("sec-typedarray-objects"), parts = [], omitted = [];
  for (const c of e ? e.children : []) {
    const h = c.querySelector(":scope > h1")?.innerText ?? "";
    if (h.includes("%TypedArray%")) omitted.push([h, c.innerText.length]); else parts.push(c.innerText);
  }
  const t = parts.join("\n");
  return { url: location.href.split("#")[0], title: document.title, ok, found: !!e, omitted, n: t.length, tail: t.slice(-64), text: t.length <= 60000 ? t : null };
})()
```
It only reads, adds a listener and timer, and returns check fields and kept children's text; an omitted child gives only heading and length.

## Checks; any failure STOPs, no retry
- PLAN lines 50-52 and ES1 line23 apply.
- ES1 line24's checks, for this locator; also text's length is n.
- omitted is recorded as returned (expected 23.2.1-23.2.3; another non-empty list is no stop); an empty one, or n 0, STOPs. Omitted text stays unreturned.

## Questions
Answers in ES1 line27's form.
- Q1: For Float64Array and Uint8Array: element type, element size and conversion operation (REP lines 22-23).
- Q2: A view on an existing ArrayBuffer with byteOffset and length: stated coercions and failures (e.g. alignment to element size, detached, out of range); any outside operation or user code?
- Q3: Does that view on a fixed-length buffer have a fixed length, or can it track the buffer's length?
- Q4: Does creating that view allocate, copy or detach a buffer?
- Q5: Element get and set: operations named; any coercion, reentry or user code stated (REP line30)?
- Q6: Which host-defined operations are named?

A missing answer stays UNKNOWN; ES1 line35's limits apply. Expected elsewhere, unread: element get and set semantics (TypedArray exotic objects), Float64 exactness and Number arithmetic (Number), zero fill (Data Blocks).

## Correspondence use, decided now
User decision 2026-11-08, before the read, for [CORR](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_CORRESPONDENCE_DESIGN.md) line8's reasons: ES2 facts are used only under HES2, an assumption: for each Q1-Q6 fact REPORT records, the runtime labelled 24.18.0 behaves as that fact states. HES2 is OPEN and not evidence: no ES2 fact is combined with release or tag facts under it (PLAN line19); a claim resting on it is CONDITIONAL on HES2; REPORT's facts stay edition facts; CORR line21 holds for it as for HES1. It also assumes REPORT's records match the text, which only the reading session checks, and inherits the attempt's stated limits. REPORT ends CONDITIONAL on HES2, not with PLAN line41's STOP (CORR line22). A stop before answers leaves HES2 covering nothing. A claim on ES1 and ES2 facts rests on HES1 and HES2; that both reads saw the same page is UNKNOWN.

## Unknowns
ES1 line38's, and: 60000 is a cap, not a known limit; joined element children's text may differ from the clause's rendering, loose text dropped; whether navigate reloads a page the pane holds.

## Records and gates
Records share this file's prefix (PLAN line53): REPORT (prepared request, outcome, answers, closing CONDITIONAL line); STOP (reason and state of a stop before answers). Gates before the call as at ES1 line42.

## Next, not approved
The grants expected above and step 4's ER slice, each with its own locator, funding and approvals (PLAN lines 49-50); each ES grant also needs a correspondence decision (CORR line22).

## Retention
Reserve9216 from F79232 ->70016: design5120/report2560/stop512/integration1024 (ledger and backlog growth). Saving a review needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
