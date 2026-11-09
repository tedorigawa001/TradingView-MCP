# ES8 Read Plan: ArrayBuffer Abstract Operations In ECMA-262 16.0
2026-11-09 JST. DOCUMENTARY plan; nothing opened, read, run or qualified. Baseline HEAD 98a55b19f390bb76de61534a7811f99e10cc7cb0. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Step 3 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md), eighth ES grant, for the buffer side of [REP](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md) line30's element get and set and the store/readback, bounds and detach asserts of the [R3 proof](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_R3_INTEGER_PROOF_DESIGN.md)'s G2 bridge, beyond ES1's record lines 19-20; aliases as in PLAN; ES1 and ES6 mean [ES1's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md) and [ES6's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES6_READ_DESIGN.md) designs. Q1-Q6 here are ES8's. User decisions 2026-11-09: this whole clause, cap 100000; a new read, not ES1's retry, follow-up or output reuse (PLAN line50); HES8 (below); the built-in browser; funding 11008.

## Locator
User-supplied for 17.0 with a `_gl` query; on the note that ES1-ES7 read 16.0 and ES1 line24 expects 2025, the user chose 16.0 with the same fragment, `_gl` dropped as forewarned: `https://262.ecma-international.org/16.0/index.html#sec-abstract-operations-for-arraybuffer-objects`. Label, title and host as at ES1 line8.

## Calls, one attempt, none now
1. `mcp__Claude_Browser__navigate` with that URL; its result is handled as at ES1 line11.
2. `mcp__Claude_Browser__javascript_tool`, `javascript_exec`, exactly:
```
await (async () => {
  const ok = document.readyState !== "loading" || await new Promise(r => { addEventListener("DOMContentLoaded", () => r(true)); setTimeout(() => r(false), 30000); });
  const e = document.getElementById("sec-abstract-operations-for-arraybuffer-objects"), t = e ? e.innerText : "";
  return { url: location.href.split("#")[0], title: document.title, ok, found: !!e, n: t.length, tail: t.slice(-64), text: t.length <= 100000 ? t : null };
})()
```
It only reads, may add a listener and timer, and returns only clause and check fields (PLAN line50).

## Checks; any failure STOPs, no retry
- PLAN lines 50-52 and ES1 line23 apply.
- ES1 line24's checks, for this locator; also text's length is n, and n 0 STOPs.

## Questions
Answers in ES1 line27's form; consequences of steps, from the read text alone, are marked derived.
- Q1: NumericToRawBytes for FLOAT64 and UINT8: which bytes, by which conversion and in which order; how is a NaN encoded?
- Q2: RawBytesToNumeric for FLOAT64 and UINT8: what value do the bytes give, NaN and -0 included where stated?
- Q3: GetValueFromBuffer and SetValueInBuffer on a non-shared buffer: what do they assert, read and write, and which byte order applies when none is given? Derived: does the Number passed for FLOAT64 or UINT8 read back as stored, and on which outside facts, named, not stated?
- Q4: Which of IsUnsignedElementType, IsUnclampedIntegerElementType, IsBigIntElementType and IsNoTearConfiguration hold for FLOAT64 and UINT8 (any order argument), and what do they decide within this clause?
- Q5: Which steps of the four operations in Q1-Q3 can throw or reach a conversion?
- Q6: Which host-defined, implementation-defined, -chosen or -approximated parts are named?

A missing answer stays UNKNOWN; ES1 line35's limits apply. Not covered here: the element-type table and the conversions it names, IsSharedArrayBuffer, Data Blocks, their zero fill and copying, the agent's byte order record, the memory model, typed-array element access. ES1-ES7 records' facts stay under their HES; a conflict with one bars both.

## Correspondence use, decided now
User decision 2026-11-09, before the read: as at ES6 line38, reading ES8, HES8 and ES1-ES8 for ES6, HES6 and ES1-ES6. HES8 is OPEN and not evidence; REPORT ends CONDITIONAL on HES8.

## Unknowns
ES1 line38's, and: 100000 is a cap, not a known limit; a long result may arrive cut and STOP; n counts UTF-16 units; url or ok cannot show a reload; 16.0's fragment is unchecked; found false STOPs.

## Records and gates
As at ES6 line44, under this file's prefix.

## Next, not approved
As at ES6 line47.

## Retention
Reserve11008 from F127616 ->116608: design4608/report4608/stop512/integration1280 (ledger and backlog growth). Saving a review needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
