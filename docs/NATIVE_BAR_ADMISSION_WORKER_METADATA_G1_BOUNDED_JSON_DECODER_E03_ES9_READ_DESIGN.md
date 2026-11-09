# ES9 Read Plan: Data Blocks In ECMA-262 16.0
2026-11-09 JST. DOCUMENTARY plan; nothing opened, read, run or qualified. Baseline HEAD 0ab927d9758315b6a7ede64f70e731a72a656055. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Step 3 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md), ninth ES grant, for [REP](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md) line29's zero fill and creation failure, and the Data Blocks premise named by [ES8's record](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES8_READ_REPORT.md) line 17; aliases as in PLAN; ES1 and ES6 mean [ES1's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md) and [ES6's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES6_READ_DESIGN.md) designs. Q1-Q6 here are ES9's. User decisions 2026-11-09: this whole clause, cap 100000; a new read, not a follow-up (PLAN line50); HES9 (below); the built-in browser; funding 10496.

## Locator
User-supplied with a `_gl` query, dropped, user forewarned: `https://262.ecma-international.org/16.0/index.html#sec-data-blocks`. Label, title and host as at ES1 line8.

## Calls, one attempt, none now
1. `mcp__Claude_Browser__navigate` with that URL; its result is handled as at ES1 line11.
2. `mcp__Claude_Browser__javascript_tool`, `javascript_exec`, exactly:
```
await (async () => {
  const ok = document.readyState !== "loading" || await new Promise(r => { addEventListener("DOMContentLoaded", () => r(true)); setTimeout(() => r(false), 30000); });
  const e = document.getElementById("sec-data-blocks"), t = e ? e.innerText : "";
  return { url: location.href.split("#")[0], title: document.title, ok, found: !!e, n: t.length, tail: t.slice(-64), text: t.length <= 100000 ? t : null };
})()
```
It only reads, may add a listener and timer, and returns only clause and check fields (PLAN line50).

## Checks; any failure STOPs, no retry
- PLAN lines 50-52 and ES1 line23 apply.
- ES1 line24's checks, for this locator; also text's length is n, and n 0 STOPs.

## Questions
Answers in ES1 line27's form; consequences of steps or definitions, from the read text alone, are marked derived; shared paths and events are named only.
- Q1: What do a Data Block and a Shared Data Block hold, how are their bytes indexed, what values may a byte take, is the size fixed at creation, and may two blocks share bytes?
- Q2: CreateByteDataBlock: initial byte values, and what does it throw, when? CreateSharedByteDataBlock: which steps or events, named only? Does a stated initial value cover both kinds?
- Q3: CopyDataBlockBytes: what does it assert, copy and require of the two blocks?
- Q4: Derived: in a non-shared block, if a step sets db[i] and a later step uses db[i] with no set between, which sentences here give the later value, and on which outside facts, named, not stated (at least algorithm conventions, the buffer still holding that block, non-shared status)? If no sentence here gives it, UNKNOWN.
- Q5: What does this clause leave to the memory model or to other clauses for Shared Data Blocks?
- Q6: Which host-defined, implementation-defined, -chosen or -approximated parts, or nondeterministic choices, are named? Unclassified conditions stay unclassified.

A missing answer stays UNKNOWN; ES1 line35's limits apply. Not covered here: the memory model, agents and the Agent Record, algorithm conventions, binary64 encoding, ArrayBuffer operations, IsSharedArrayBuffer, detach and resize, the element-type table, typed-array element access. ES1-ES8 records' facts stay under their HES; a conflict with one bars both.

## Correspondence use, decided now
User decision 2026-11-09, before the read: as at ES6 line38, reading ES9, HES9 and ES1-ES9 for ES6, HES6 and ES1-ES6. HES9 is OPEN and not evidence; REPORT ends CONDITIONAL on HES9.

## Unknowns
ES1 line38's, and: 100000 is a cap, not a known limit; a long result may arrive cut and STOP; n counts UTF-16 units; url or ok cannot show a reload; found false STOPs.

## Records and gates
As at ES6 line44, under this file's prefix.

## Next, not approved
As at ES6 line47.

## Retention
Reserve10496 from F116608 ->106112: design4608/report4096/stop512/integration1280 (ledger and backlog growth). Saving a review needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
