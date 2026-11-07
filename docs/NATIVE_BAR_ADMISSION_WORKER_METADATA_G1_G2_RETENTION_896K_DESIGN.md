# G1/G2 Retention Ceiling: 896 KiB
APPROVED documentation/allocation only, 2026-11-07 JST. Baseline 7e4a382fe0e393fbb5cfa308e0b80a05b787e668. Prospective retained-audit-document authority, not runtime or source qualification. User approved the raise and its width on 2026-11-07.

## Baseline And Frozen History
Baseline cap786432, consumed745192, allocated-unspent39480, unallocated1408, guard352 sum to786432. Measure as the [prior ceiling](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_G2_RETENTION_768K_DESIGN.md) last states: all series documents plus BACKLOG above 996441+2183.
Raise only the whole-series ceiling to917504 UTF-8 bytes (896 KiB), increase131072, the same as the last two raises. Preserve section budgets, read limits, runtime/response-body limits, all charges/reservations and guard352. Old cap statements, ledgers and review pins stay historical, not rewritten.
No shortening, deletion, relocation or splitting refunds consumption. TAG433's1518-byte report and recorded sub-cap breach stay; this increase neither authorizes nor cures them. Wholly unspent TAG433 review2048/stop512 and aux reserve512 stay where they are; no exception is made or needed. No old reservation is restored.

## New Reservation Only
Fund only this ceiling change from the increase:
| Purpose | Bytes |
|---|---:|
| Change design/record | 4096 |
| BACKLOG/prior-ledger integration | 1024 |
| Total | 5120 |
| Increase left unallocated | 125952 |

Add untouched old1408: unallocated127360. Before document charges allocated-unspent39480+5120=44600; 745192+44600+127360+352=917504.
Review and STOP are unreserved; saving either needs new allocation.

## Recording And Actual Charges
Create this DESIGN plus BACKLOG and prior 768K-ledger links only. All positive parent growth charges this stage's integration1024. This document is now the current ledger: later sections here charge their own stage, not this design. Measure actual UTF-8 bytes including links and the charge line. No hidden log, truncation, borrowing or silent expansion on shortage.

## Approval Boundaries
Added capacity closes no premise, gate or finding and adopts nothing. Dot stays PAUSED; judgment/notification/mail and trading conditions unchanged. No implementation, parse/model/test, real port/clock/timer/build/child/native/fixture/signature/data work, MCP registration or production activation. Each later reservation, review saving, commit and push still needs its own approval.
Charge D2574/L547; current C748313/U41479; cap917504/guard352/unallocated127360. Includes this line; prior charges unchanged.

## Adoption Package Reservation
Approved13312 from F127360 ->114048: design12288/integration1024; review/STOP not reserved; before charges U54791. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ADOPTION_PACKAGE_DESIGN.md). Nothing adopted; premises OPEN.
Charge D12262/L559; current C761134/U41970/F114048.
Act review fix: Parts 3, 6; Context cells; ZA5 marker; row reach. D+22/L+110; current C761266/U41838/F114048.

## Host Evidence Plan Reservation
Approved9216 from F114048 ->104832: design8192/integration1024; review/STOP not reserved; before charges U51054. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_HOST_EVIDENCE_PLAN_DESIGN.md). No read, search, probe or execution; premises OPEN.
Charge D7809/L611; current C769686/U42634/F104832.

## Parser Policy Exception Reservation
Approved3584 from F104832 ->101248: design3072/integration512; review/STOP not reserved; before charges U46218. [record](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_POLICY_EXCEPTION_DESIGN.md). User decision; nothing run.
Charge D3071/L509; current C773266/U42638/F101248.
