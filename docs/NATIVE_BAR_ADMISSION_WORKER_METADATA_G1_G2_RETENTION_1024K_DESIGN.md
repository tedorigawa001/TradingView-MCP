# G1/G2 Retention Ceiling: 1024 KiB
APPROVED documentation/allocation only, 2026-11-09 JST. Baseline bdce399dadb4ae72c9743d7e4d99a40321c2ad0f. Prospective retained-audit-document authority, not runtime or source qualification. User approved the raise and its width on 2026-11-09.

## Baseline And Frozen History
Baseline cap917504, consumed861383, allocated-unspent54105, unallocated1664, guard352 sum to917504. Measure as the [prior ceiling](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_G2_RETENTION_896K_DESIGN.md) last states: all series documents plus BACKLOG above 996441+2183.
Raise only the whole-series ceiling to1048576 UTF-8 bytes (1024 KiB), increase131072, the same as the last three raises. Preserve section budgets, read limits, runtime/response-body limits, all charges/reservations and guard352. Old cap statements, ledgers and review pins stay historical, not rewritten.
No shortening, deletion, relocation or splitting refunds consumption. TAG433's1518-byte report and recorded sub-cap breach stay; this increase neither authorizes nor cures them. Unspent reserves, such as TAG433 review2048/stop512, aux reserve512, the R3 proof's review4096/stop1024 and ES1-ES7's stop512 each, all unused, stay reserved to their own stages within U and are not transferred; any later approved charge to them is recorded here. No old reservation is restored.

## New Reservation Only
Fund only this ceiling change from the increase:
| Purpose | Bytes |
|---|---:|
| Change design/record | 4096 |
| BACKLOG/prior-ledger integration | 1024 |
| Total | 5120 |
| Increase left unallocated | 125952 |

Add untouched old1664: unallocated127616. Before document charges allocated-unspent54105+5120=59225; 861383+59225+127616+352=1048576.
Review and STOP are unreserved; saving either needs new allocation.

## Recording And Actual Charges
Create this DESIGN plus BACKLOG and prior 896K-ledger links only. All positive parent growth charges this stage's integration1024. This document is now the current ledger: later sections here charge their own stage, not this design. Measure actual UTF-8 bytes including links and the charge line. No hidden log, truncation, borrowing or silent expansion on shortage.

## Approval Boundaries
Added capacity closes no premise, gate or finding and adopts nothing. Dot stays PAUSED; judgment/notification/mail and trading conditions unchanged. No implementation, parse/model/test, real port/clock/timer/build/child/native/fixture/signature/data work, MCP registration or production activation. Each later reservation, review saving, commit and push still needs its own approval.
Charge D2732/L553; current C864668/U55940; cap1048576/guard352/unallocated127616. Includes this line; prior charges unchanged.
