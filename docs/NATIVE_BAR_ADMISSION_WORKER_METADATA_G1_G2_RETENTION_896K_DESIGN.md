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
Plan review fix: EP also waits for OWN12. D+44/L+97, plan stage; current C773407/U42497/F101248.

## Release Label And Representation Reservation
Approved9216 from F101248 ->92032: design8192/integration1024; review/STOP not reserved; before charges U51713. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_RELEASE_REPRESENTATION_DESIGN.md). User decisions; no evidence read, nothing run.
Charge D8172/L646; current C782225/U42895/F92032.

## ES1 Read Reservation
Approved7680 from F92032 ->84352: design4096/report2048/stop512/integration1024; review not reserved; before charges U50575. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_READ_DESIGN.md). Plan only; nothing opened, read or run.
Charge D4084/L579; current C786888/U45912/F84352.
REPORT prepared, unexecuted: R1263/2048, L+78; current C788229/U44571/F84352.
ES1 read executed, closing STOP: R+784 to R2047/2048, L+327; current C789340/U43460/F84352.

## ES1 Correspondence Reservation
Approved5120 from F84352 ->79232: design4096/integration1024; review/STOP not reserved; before charges U48580. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES1_CORRESPONDENCE_DESIGN.md). User decision; no evidence read, nothing run.
Charge D4040/L587; current C793967/U43953/F79232.

## ES2 Read Reservation
Approved9216 from F79232 ->70016: design5120/report2560/stop512/integration1024; review not reserved; before charges U53169. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES2_READ_DESIGN.md). Plan only; nothing opened, read or run.
Charge D5083/L618; current C799668/U47468/F70016.
REPORT prepared, unexecuted: R1374/2560, L+78; current C801120/U46016/F70016.
ES2 read executed, closing CONDITIONAL: R+1180 to R2554/2560, L+322; current C802622/U44514/F70016.

## ES3 Read Reservation
Approved9472 from F70016 ->60544: design4608/report3072/stop512/integration1280; review not reserved; before charges U53986. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES3_READ_DESIGN.md). Plan only; nothing opened, read or run.
Charge D4593/L602; current C807817/U48791/F60544.
REPORT prepared, unexecuted: R1664/3072, L+78; current C809559/U47049/F60544.
ES3 read executed, closing CONDITIONAL: R+1403 to R3067/3072, L+322; current C811284/U45324/F60544.

## ES4 Read Reservation
Approved9984 from F60544 ->50560: design4608/report3584/stop512/integration1280; review not reserved; before charges U55308. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES4_READ_DESIGN.md). Plan only; nothing opened, read or run.
Charge D4575/L615; current C816474/U50118/F50560.
REPORT prepared, unexecuted: R1690/3584, L+78; current C818242/U48350/F50560.
ES4 read executed, closing CONDITIONAL: R+1831 to R3521/3584, L+322; current C820395/U46197/F50560.

## ES5 Read Reservation
Approved9984 from F50560 ->40576: design4608/report3584/stop512/integration1280; review not reserved; before charges U56181. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES5_READ_DESIGN.md). Plan only; nothing opened, read or run.
Charge D4601/L600; current C825596/U50980/F40576.
REPORT prepared, unexecuted: R1706/3584, L+78; current C827380/U49196/F40576.
ES5 read executed, closing CONDITIONAL: R+1858 to R3564/3584, L+322; current C829560/U47016/F40576.

## ES6 Read Reservation
Approved9984 from F40576 ->30592: design4608/report3584/stop512/integration1280; review not reserved; before charges U57000. [design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_ES6_READ_DESIGN.md). Plan only; nothing opened, read or run.
Charge D4600/L588; current C834748/U51812/F30592.
