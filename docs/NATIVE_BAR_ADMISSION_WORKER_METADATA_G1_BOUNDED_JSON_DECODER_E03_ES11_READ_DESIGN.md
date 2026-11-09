# ES11 Read Plan: Agents In ECMA-262 16.0
2026-11-09 JST. DOCUMENTARY plan; nothing opened, read, run or qualified. Baseline HEAD 700345e36c3de786a1baef1937a2ec84e6ebaa4a. Replaces the DRAFT_BLOCKED text of 700345e, keeping its funding and questions. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
Step 3 of [PLAN](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md), eleventh ES grant, for the same-byte-order premise of the [G2 chain](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_R3_G2_CHAIN_DESIGN.md) D1 and open list (lines 18, 27): ES8 record line 17 records that an absent byte order is the surrounding agent's [[LittleEndian]]; aliases as in PLAN; ES1 and ES6 mean [ES1's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md) and [ES6's](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES6_READ_DESIGN.md) designs; ESk record is the ESk read report under this prefix. Q1-Q6 here are ES11's. User decisions 2026-11-09: this whole clause, cap 100000, stated in the chosen option; a new read, not a follow-up (PLAN line50); HES11 (below); the built-in browser, rechecked per line 44; funding 12032, approved with the draft.

## Locator
User-supplied with a `_gl` query, dropped, user forewarned: `https://262.ecma-international.org/16.0/index.html#sec-agents`. Label, title and host as at ES1 line8.

## Calls, one attempt, none now
1. `mcp__Claude_Browser__navigate` with that URL; its result is handled as at ES1 line11.
2. `mcp__Claude_Browser__javascript_tool`, `javascript_exec`, exactly:
```
await (async () => {
  const ok = document.readyState !== "loading" || await new Promise(r => { addEventListener("DOMContentLoaded", () => r(true)); setTimeout(() => r(false), 30000); });
  const e = document.getElementById("sec-agents"), t = e ? e.innerText : "";
  return { url: location.href.split("#")[0], title: document.title, ok, found: !!e, n: t.length, tail: t.slice(-64), text: t.length <= 100000 ? t : null };
})()
```
It only reads, may add a listener and timer, and returns only clause and check fields (PLAN line50).

## Checks; any failure STOPs, no retry
- PLAN lines 50-52 and ES1 line23 apply.
- ES1 line24's checks, for this locator; also text's length is n, and n 0 STOPs.

## Questions
Answers in ES1 line27's form, step keywords verbatim; consequences of steps or definitions are marked derived and cite only the read text, plus ES8 record line 17 for Q5.
- Q1: What are [[LittleEndian]]'s type, meaning and selection or initialization rules?
- Q2: Must its value stay constant, and over which lifetime?
- Q3: Is it per agent, per agent cluster or per implementation, and what is said of different agents? From this clause only; a rule elsewhere stays UNKNOWN.
- Q4: What identifies the surrounding agent, and which outside definitions does that need, named only?
- Q5: Derived, with ES8 record line 17: what byte-order equality between a store and a later read follows, on which premises? Named, never discharged here: both calls omit isLittleEndian (typed-array steps, unread) and run in one agent (a code obligation).
- Q6: Which host-defined, implementation-defined, -chosen or -approximated parts are named?

A missing answer stays UNKNOWN; ES1 line35's limits apply; no [[LittleEndian]] value, constancy or cross-agent equality is inferred from silence, and no platform test is made. Not covered here: cluster rules outside this clause, the memory model, binary64 encoding, Data Block mutation, detach, alias exclusion, G0, G1, G3, arena sizes. ES1-ES10 records' facts stay under their HES; a conflict with one, derived claims included, bars both.

## Correspondence use, decided now
User decision 2026-11-09, before the read: as at ES6 line38, reading ES11, HES11 and ES1-ES11 for ES6, HES6 and ES1-ES6. HES11 is OPEN and not evidence and covers no unread clause; REPORT ends CONDITIONAL on HES11; no host conformance or G2 closure follows.

## Unknowns
ES1 line38's, and: 100000 is a cap, not a known limit; a long result may arrive cut and STOP; n counts UTF-16 units; url or ok cannot show a reload.

## Records and gates
As at ES6 line44, under this file's prefix: REPORT holds preparation and outcome; a stop before answers goes to STOP with a pointer in REPORT, no partial answers. Fresh tool checks before call 1 confirm both browser tools are exposed.

## Next, not approved
As at ES6 line47.

## Draft history
The 700345e draft left locator, scope, route, exact request and correspondence UNSET (no browser tools then). The user set all but the request, which follows ES6's. The 255c217 ledger charged the draft (design 4833, integration 642) before 700345e added it, so measured consumption matched the ledger only from 700345e on.

## Retention
Reserve12032 from F85888 ->73856, approved with the draft: design5120/report5120/stop512/integration1280 (ledger and backlog growth). Saving a review needs approval and new allocation (Z-A132). No truncation, borrowing, refund or transfer.
