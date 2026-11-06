# Composite Route: Z At Key And Object Close, W At Post-Colon
2026-11-06 JST. DOCUMENTARY; records a user direction. No model run, test, implementation, clause adoption, route selection or host qualification. Baseline HEAD 9c51747eb0703056783e7783de927c6eb80c8c54. RUN1/RESUME01 STOP and no-retry stay. All premises stay OPEN.

## Scope
Follows [ZPHASE](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ZPHASE_PROOF_DESIGN.md), whose line 20 noted this composite and whose Scope defines the aliases used here; "amendment n" is its list. Also [ZEXIT](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ZEXIT_PROOF_DESIGN.md) for E0-E7, and [TRACE](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_C4_C5_TIMING_TRACE_DESIGN.md) for Dk and T1-T6. I8/S28/Z-A84 and model165 are line references; CB3/ZA2 are IDs. Z-A is unadopted text.

## Decision
User decision 2026-11-06: further proof work follows the composite (not Route29's W+H, still uncompared), a fixed assignment by boundary: Z at key close and object close, W at post-colon. This is a direction. It adopts no clause or row, closes no premise and is not a selection under Route72-75; those approvals stay separate (Z-A132). Order B (ORD21) is assumed, not adopted; policy B (TRACE43) stays. A boundary whose proof fails switches to nothing automatically (Route29-30, Z-A124); that needs a new decision.

## Assignment
| Boundary | Route | Why this one | Cost taken |
|---|---|---|---|
| Key close | Z: lookup settles before release | CB rows are post-colon only, so W would need new rows equivalent to CB0-CB11 (TRACE38). The effect is read-only comparison (ZPHASE line16). CP-U decides inside Dk in T1-T6, meeting policy B without using its wait | Authority gap; amendments 2-5 |
| Post-colon | W: release, then Idx once real input exists | CB0, CB3, BND42 and BND54 already read this way, while Z strains them (ZPHASE line17). A valid document has a later byte here (boundary review line12) | WcarryAcrossWait, post-colon half; N1-N3; amendments 2, 4 |
| Object close | Z: close consumed, S28 retirement before release | A root close has no guaranteed later byte, so plain W fails (ZEXIT line32); a nested close could wait, but one rule covers both. S28 names READY/YIELDED, with exhaustion OPEN (BND56, ORD45). It would use key close's candidate phase row and a pending-close representation (amendment 6), not H's held byte | Z-B, closeWitness; amendments 2-4 and 6 |

Paper reasoning only; nothing is measured. W at key close, Z at post-colon and H at object close are not chosen, and not refuted.

## Why the split is well formed
Conditional on order B with task first (ORD21, ZA1, KVS15, ORD37, S28), one key at a time, and CB3 as Idx's only driver (premise below). Each claim still needs proof in its stage.
- X1 Exclusive: at exact end at most one of lookup (R2), Idx (R4 with IdxPending) and retirement is pending. IdxPending has a pending key, so no key start or legal close is reachable (KVS16, KVS19, G5). The route follows from saved grammar and phase evidence, so there is no runtime choice or fallback, and release never holds a Z task beside an Idx binding. Unknown evidence blocks (E7).
- X2 No index prefix across a wait: Idx starts only with real input and keeps it unconsumed (CB3, BND42), and exit requires exact end (E6, Z-A84). So Idx can yield midway but not wait; at NEED_INPUT + IdxPending no index mutation (IR2 on, RR35) has begun for this key. On this route that empties "completed index prefix" in proof line17. Shape only: model165. IR0's checks from before the colon (RR33-34) cross the wait; a change needs RR42's bridge.
- X3 Z reads a settled index: CB4 settles Idx before CP-V, so before any next key or close (KVS27, G5). Lookup and retirement never meet an earlier key's partial shift.
- X4 No new kind of carry: a unique key at R3 already carries key and decision across a wait on every route (KVS15, TRACE33). R4 adds the phase and owed work, not a new kind of storage. Liability and lifetime still need proof.

This removes the post-colon strain, not memory: each task still overlaps one private input (Route47, CB3, TRACE33), and no fit is claimed.

## Exact-end entry under the composite
Merges ZEXIT's Z and W columns; E3 splits by boundary.
| ZEXIT row | Composite | Also assumes |
|---|---|---|
| E0 empty | Eligible. An Idx binding stays, no pulse (CB6); no Z task can be pending, since each settled before the last release | WcarryAcrossWait if bound |
| E1, E2 | Eligible, as ZEXIT | Zphase if a lookup or retirement just settled; closeWitness after retirement; R3 carry at R3 |
| E3 key close | Not eligible: lookup first (ZA2, if narrowed: N2) | Zphase |
| E3 post-colon | Eligible: release with the binding, then NEED_INPUT + IdxPending (CB0). Next nonempty delivery: CB2, then CB3. Whitespace is real input, so Idx runs first and consumed whitespace with Idx pending is unreachable | WcarryAcrossWait |
| E4 | Not eligible: retirement first (S28, Z-A82), then E1 or E5 | Zphase, closeWitness |
| E5 | Eligible after retirement and pop | Zphase, closeWitness; not HheldClose |
| E6, E7 | As ZEXIT | None new |

## Text still owed
Under this direction amendment 1 would take its second branch: CB0, CB3, BND42 and BND54 stay unamended, and post-colon leaves Z. Unamended is not sufficient:
- N1, new: fuel ending on a final colon, and the promotion and release that follow, put READY/YIELDED at exact end with IdxPending, which has no row (boundary review line11, E3); CB0 starts after that boundary. Needed: an exit-only row with no Idx, as CB6 treats an empty delivery's READY. Plain W needs it too.
- N2: Z-A must be narrowed before any adoption. Idx is literally "runnable without future bytes" (Z-A29), so it needs a defined route-deferred category, not the future-byte one (Z-A30, Route18). Z-A35, Z-A70, Z-A82 and ZA2-3 lose Idx. Z-A24 says settlement is not composite policy, so the composite needs its own row.
- N3, new: policy B covers CP-U only (TRACE43). A resource failure in Idx now surfaces at a later delivery, and no criterion addresses that.
- Amendments 2-6 stay as ZPHASE lists them. Amendment 2 is a gate: zero-byte lookup, retirement and exit must fall outside "inputless" (BND56, ORD14, ZEXIT gap 5), or Z and every exit fail.

## Premises and gaps
| Item | Use here | Status |
|---|---|---|
| Zphase | Key close and object close only | OPEN, narrowed; Idx's progress and measure duties stay under CB3 (BND41, ZPHASE line78) |
| Zexit | Every exit; E3 at post-colon only | OPEN; ZEXIT gap 4 not needed, other gaps stay |
| WcarryAcrossWait | Post-colon half of proof item 3 and R3's carry; key-close lookup half unused | OPEN |
| Real-input rule: CB3 as Idx's only driver | Post-colon, X1-X3 | OPEN as a source fact (boundary review line8, RR56); BND stays a candidate (BND7) |
| HheldClose | Not used | OPEN, not refuted |
| ownedKeys, knownAck, serialDriver | Everywhere | OPEN |
| closeWitness | Object close | OPEN |
| Policy B | Met at Dk; T4-T6 waits not exercised at key close; cancel before lookup ends stays (TRACE33) | Criterion; suitability, release/owner failure and wait lifetime stay open (TRACE43) |

## Model and RUN2
Read by hand. V1 has one route flag (model88, model165), so the composite is not a mode and RUN2 says nothing about it. Testing it needs an unfunded V2 with its own exact-hash approval; none is requested.

## Next stages, not approved
- WcarryAcrossWait post-colon and R3 carry: CB0-CB11 correspondence, N1, N3, boundary matrix, lifetime manifest. Estimate design10240/integration1024.
- Amendments 2-6, N2 and Z-B. Estimate design12288/integration1024.

F13824 covers the first and leaves 2560, short of the second by 10752.

## Retention
Reserve9216 from F23040 ->13824: design8192/integration1024, after moving 20992 of unspent reservations. Ledger line101's exception also covers 768K line8, 512K lines27, 65. Review and STOP are unreserved; saving either needs new allocation. Ledger and backlog growth, including the move's record, charges integration1024; actual charges are in the ledger. No truncation, borrowing, refund or further transfer.
