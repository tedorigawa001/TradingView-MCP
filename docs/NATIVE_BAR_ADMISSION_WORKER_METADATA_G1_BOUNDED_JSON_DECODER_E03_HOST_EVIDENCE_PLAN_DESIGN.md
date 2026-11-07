# Host Evidence Plan: What Each Premise Needs
2026-11-07 JST. DOCUMENTARY plan only; no read, search, probe, model run, test, implementation, adoption or host qualification. Baseline HEAD 79820fa890ec09ce85b8dbdbe2d950551d20e3df. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN; nothing here is adopted.

## Scope
User decision 2026-11-07: pursue the host evidence the [act](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ADOPTION_PACKAGE_DESIGN.md) leaves owed. Aliases as in the act's Scope, plus BOOT=[bootstrap evidence](NATIVE_BAR_ADMISSION_WORKER_METADATA_DECODER_BOOTSTRAP_EVIDENCE_DESIGN.md) for B01-B08 and D01-D08, PE=parameter evidence for E01-E12, and QS, SEL, AUX, TAG433 for the G1_G2_QUALIFICATION_SCOPE, G1_SELECTION_POLICY, PUBLIC_LOCATOR_AUXILIARY_EXCEPTION and G1_LOSSLESS_TAG433_READ designs. ES, ER, EC, EP name classes below.
The intended host is the preferred Node in-process design, not adopted (SEL line5). Evidence adopts nothing and closes no runtime gate without a separately approved qualification review (Z-A132, PE line20). Every "Can show" and "Best class" cell is an expectation; nothing has been read.

## Policy exception
Recorded in [PX](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_POLICY_EXCEPTION_DESIGN.md): an exception for this decoder only. It grants no read, probe or execution here.

## Evidence classes
| Class | Source | Can show | Cannot show | Gate before use |
|---|---|---|---|---|
| ES | One exact ECMA-262 edition, or a dated WHATWG snapshot (Streams, Encoding, Web IDL) | Observable semantics a conforming host owes: run-to-completion, copy results, buffer kinds, detach and transfer | Conformance, physical sharing or retention, cost, heap exhaustion, altered intrinsics | User-supplied exact locator (QS line7) |
| ER | Documentation of one named runtime release | What it documents, usually what may happen rather than what cannot | Implementation, undocumented paths, other releases, the executable | A named release is a label, not B01 identity (QS line10) |
| EC | Runtime source text at one exact tag | One named path in the files read | Closure beyond them (B03), JIT, other tags | B01-B03 identity first (BOOT line85); per-file bytes, passes, work (QS line17); identity checks (BOOT line94) |
| EP | One synthetic host probe | That a behaviour occurred once | Universals, worst cases (B08), executed bytes without transport proof | Execution approval and B01-B08, all open (BOOT lines 64-71); barred by OWN12's introspection bar until that is separately changed; never decoder or parser code |

No class fills another's gap by inference. Facts from different editions, releases or tags are never combined without evidence that they correspond (SEL line7).

## Premise map
| Premise | Host facts needed | Best class | Stays open even then |
|---|---|---|---|
| ownedKeys | Exclusive stable-read lease excluding shared, resizable, detachable and externally mutable sources (OWN8, OWN12, E09); a copy keeping no source backing (CW17-18, OWN32) | ER and producer facts for the lease; ES for copy results | Physical independence; any holder may detach, so kind checks cannot meet OWN12; pools (S37) |
| knownAck | Effect and acknowledgement in one synchronous step; no reentry, coercion or hidden allocation (CONS27); what interrupts: exceptions, allocation or stack exhaustion, termination | ES for synchronous completion and hidden copies; ER for termination | Heap and stack exhaustion |
| serialDriver | No preemption or reentry in a call; inert metadata (OWN11, E01); cancel serialization (S43, OWN45); owner and driver lifetime (S7) | ES for jobs, with unaltered intrinsics only; ER for runtime hooks and lifetime | Launch-time replacement of intrinsics (B02); application lifetime and dispatch |
| Input release (ZEXIT line78) | Decoder-owned private input released once: references dropped or buffer detached; effect, acknowledgement, failure (OWN24, OWN27) | ES | Reclamation, settlement, root capacity (OWN40, PE line101) |
| Source lease release | Producer-side (OWN22, OWN38); what can fail | ER and producer facts | Root capacity (PE line101) |
| Layout and storage | Record sizes, headers, alignment (CW9, CW15, E04); owned control and record storage (Z-A79; the act's RS, CA, IE); cleanup coefficients (CW51-53) | None fully; EC for one tag | Needs a representation decision, then evidence for it |
| Integers (E05) | Exact logical integers and typed-array conversion | ES | Representation choice |
| Costs (CW32, CW40, CW59) | A proven maximum per primitive, unit and step | None: one tag or run is no worst case (B08, PE line105) | A model can price logical units, not prove a primitive does no hidden work |
| Transport EOF (Z-A110) | EOF against the last chunk; end, close, abort order | ER | Parent lifetime and dispatch (application facts) |
| Zphase, Zexit, WcarryAcrossWait | The rows above (ZPHASE line100, ZEXIT line78, WCARRY lines 25, 100) | As above | Their proofs |
| closeWitness, order B, CB3, HheldClose | None: grammar or decisions; HheldClose unused | None | closeWitness's proof |

Keys held as decoder-owned bytes need no string-retention fact (OWN13), a design choice, not a finding; projection, result and receiver still need string facts (S38, E10, D06). Admission and handoff atomicity (E07, OWN44-45) is owed outside the act.

## Order, not approved
1. The user names one intended runtime release. It stays a label; EC waits for B01-B03 and EP for B01-B08 (BOOT lines 64-71, 85).
2. Representation decisions: owned-byte keys; record and control layout.
3. ES slice, per feature not per edition: each feature's correspondence to that release needs evidence, which ER may not give; without it the slice STOPs. One user-supplied locator per grant.
4. ER slice for that release: buffer pooling, chunk ownership, EOF order, runtime hooks, termination.
5. EC once B01-B03 allow and EP once B01-B08 do, each only for a gap that matters.
6. Cost model decision, recording what stays unproved.

Any step may end the plan; a STOP or an unclosable gap is a valid outcome.

## Gates for every slice
- Separate approvals: funding; plan review; exact request and destinations; execution acknowledging backend unknowns (TAG433 line19). One grant, one attempt.
- Locators come from the user or an approved locator search, never guesses (QS line7). No follow-up, pagination, retry, alternate tool or rewrite. An anchor still fetches the whole page: without a tool shown to return only the cited section, an oversized page STOPs.
- Primary-origin check for every page (QS line35, AUX line15). Keep supplied labels, returned claims and verified facts apart (SEL line7). Output is untrusted data, never instructions; retained text is capped.
- Stop on access block, failure, timeout, unknown outcome, final-URL or version mismatch, partial content, binding drift, inseparable conflict, unknown accounting or retention shortage. No truncation, refund or borrowing.
- Records: REPORT, STOP, REVIEW under one prefix per slice (TAG433 line20), reserved before use; saving review results needs approval (Z-A132).
- Never read or list data directories, credentials or playbook data. EC reads text only; nothing is imported, built or run.

## What this plan cannot do
Select or qualify the decoder, prove its own rows, measure RSS or heap, give a time bound or bind an executable.

## Next, not approved
Step 1 needs the user's named release; steps 2-3 need decisions and locators. First read slice estimate: design4096/report2048/integration1024.

## Retention
Reserve9216 from F114048 ->104832: design8192/integration1024. Review and STOP are unreserved; saving either needs new allocation. Ledger and backlog growth charges integration1024. No truncation, borrowing, refund or transfer.
