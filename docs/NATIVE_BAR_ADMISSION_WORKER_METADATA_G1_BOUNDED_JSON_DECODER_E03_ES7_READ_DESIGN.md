# ES7 Read Plan: Type Conversion In ECMA-262 16.0
2026-11-09 JST. DOCUMENTARY plan; nothing opened, read, run or qualified. Baseline HEAD c00d597a5f6d18f831fa816ed6d771f073babe85. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Step 3 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md), seventh ES grant, for [REP](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md) line30's coercion steps, and the conversions the G0 bridge of the [R3 proof](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_R3_INTEGER_PROOF_DESIGN.md) bars and G2 uses; aliases as in PLAN; ES1, ES2 and ES6 mean [ES1's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md), [ES2's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES2_READ_DESIGN.md) and [ES6's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES6_READ_DESIGN.md) designs. Q1-Q6 here are ES7's. User decisions 2026-11-09: this clause without its BigInt children, as the numeric types read omitted them, cap 100000; a new read, not a follow-up (PLAN line50); HES7 (below); the built-in browser; funding 10496.

## Locator
User-supplied with a `_gl` query, dropped, user forewarned: `https://262.ecma-international.org/16.0/index.html#sec-type-conversion`. Label, title and host as at ES1 line8.

## Calls, one attempt, none now
1. `mcp__Claude_Browser__navigate` with that URL; its result is handled as at ES1 line11.
2. `mcp__Claude_Browser__javascript_tool`, `javascript_exec`, exactly:
```
await (async () => {
  const ok = document.readyState !== "loading" || await new Promise(r => { addEventListener("DOMContentLoaded", () => r(true)); setTimeout(() => r(false), 30000); });
  const e = document.getElementById("sec-type-conversion"), parts = [], omitted = [];
  for (const c of e ? e.children : []) {
    const h = c.querySelector(":scope > h1")?.innerText ?? "";
    if (/Big(Int|Uint)/.test(h)) omitted.push([h, c.innerText.length]); else parts.push(c.innerText);
  }
  const t = parts.join("\n");
  return { url: location.href.split("#")[0], title: document.title, ok, found: !!e, omitted, n: t.length, tail: t.slice(-64), text: t.length <= 100000 ? t : null };
})()
```
It only reads (may add a listener and timer) and returns check fields, kept children's text and each omitted child's heading and length.

## Checks; any failure STOPs, no retry
- PLAN lines 50-52 and ES1 line23 apply; ES2 lines 29-30, with ToBigInt, StringToBigInt, ToBigInt64 and ToBigUint64 as the expected omitted list.

## Questions
Answers in ES1 line27's form; consequences of steps, from the read text alone, are marked derived.
- Q1: ToPrimitive and OrdinaryToPrimitive: which steps Get, GetMethod or Call which methods, in what order, and what do they give for a Number?
- Q2: ToNumeric and ToNumber: result per type; which cases reach ToPrimitive or throw?
- Q3: ToIntegerOrInfinity and ToIndex: results for NaN, zeros, fractions, negatives, infinities and values above 2^53-1; which throw?
- Q4: ToUint32 (REP line17's alternative) and ToUint8: results for NaN, zeros, fractions, negatives and out-of-range values?
- Q5: ToString on a Number, ToPropertyKey and CanonicalNumericIndexString: what rule makes a key canonical, and what does "-0" give?
- Q6: Which host-defined, implementation-defined or -approximated parts are named?

A missing answer stays UNKNOWN; ES1 line35's limits apply. Not covered here: operators, literals, 7.2's tests, property access, Number::toString's steps, raw-byte conversion, Number and Math objects, Data Blocks' zero fill. ES1-ES6 records' facts stay under their HES; a conflict with one bars both.

## Correspondence use, decided now
User decision 2026-11-09, before the read: as at ES6 line38, reading ES7, HES7 and ES1-ES7 for ES6, HES6 and ES1-ES6. HES7 is OPEN and not evidence; REPORT ends CONDITIONAL on HES7.

## Unknowns
ES2 line47's, with 100000 as its cap, and: a long result may arrive cut and STOP; n counts UTF-16 units; url or ok cannot show a reload.

## Records and gates
As at ES6 line44, under this file's prefix.

## Next, not approved
As at ES6 line47. F1664 left funds no grant of this size.

## Retention
Reserve10496 from F12160 ->1664: design4608/report4096/stop512/integration1280 (ledger and backlog growth). Saving a review needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
