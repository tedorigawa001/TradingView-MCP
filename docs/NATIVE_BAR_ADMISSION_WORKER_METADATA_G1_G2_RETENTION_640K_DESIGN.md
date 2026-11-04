# G1/G2 Retention Ceiling: 640 KiB
APPROVED documentation/allocation only on 2026-11-04 JST. Baselinef5b3f82cc04b7735523324b9b8b322c310aac729. This changes the retained-audit-document ceiling prospectively, not runtime limits or historical observations.

## Baseline And Scope
Baseline cap524288, consumed459430, allocated-unspent63994, unallocated512, guard352 sum to524288. Sources at that commit: [prior ceiling](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_G2_RETENTION_512K_DESIGN.md) and [latest charge](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_PRESERVATION_DESIGN.md). The latter's SHA-256 is 4af7841d441fcaa2897bf729a8ccd864f38101c39c9cabee45826e98cc8c0bed.
Raise only the whole-series retained-document ceiling to655360 UTF-8 bytes (640 KiB), increase131072. Supersede the current ceiling, not prior section budgets, read limits or operational rules. Response-body524288 is an unrelated domain and stays unchanged.
Old caps, dated ledgers, review statuses, evidence gaps and charges remain frozen. No reductions, rewritten wording, deletion or relocation refund consumption. TAG433's1518-byte report and recorded sub-cap breach remain; expansion does not authorize, erase or cure that breach. npm read remains unexecuted with review funding unresolved; no old reservation is restored.

## New Reservation
From the increase reserve only:
| Purpose | Bytes |
|---|---:|
| Change design/record | 4096 |
| Independent review/fixes | 2048 |
| Parent/BACKLOG integration | 1024 |
| Refusal/stop | 1024 |
| Total | 8192 |
| Increase left unallocated | 122880 |

Add prior unallocated512: new unallocated123392. Before document charges, allocated-unspent63994+8192=72186; consumed459430+72186+guard352+123392=655360.
Keep every existing reservation, including pending review and stop funding. The proposed10752 transfer from old reservations is NOT applied; no donor budget is frozen or reduced.
A1-A3 case-table design/allocation is NOT authorized here. Its proposed11264 would require separate approval; if later allocated without other changes, unallocated123392-11264=112128. Neither figure is permission to spend.

## Recording And Boundaries
Create this DESIGN only, plus BACKLOG and prior-ceiling links. All positive parent growth charges this stage's integration1024, not old spare capacity. DESIGN4096, REVIEW2048, STOP1024 use this filename prefix with the corresponding suffix. REVIEW/STOP remain absent.
Future REVIEW physical caps: metadata512/R1 768/R2 768, including headings, identifiers and links. Each section and file must fit. Review funding is for attributable review evidence/fixes, not disguised design expansion. Stop on shortage; no truncation, borrowing, hidden logs or implicit reallocation.
Independent review, saving its result, commit/push, future allocation and A1-A3 documentation need separate approval. No parser-policy waiver, implementation/adoption, source/dependency acquisition, parse/model/test, real port/clock/timer/build/child/native/fixture/signature/data operation, MCP registration or production activation.
Dot stays PAUSED. Judgment/notification/mail and trading conditions do not change. Added document capacity proves no A1-A4, E03/E05/E06, D01-D08/B01-B08/G2 or host/runtime qualification.
Charge D3387/L551; current C463368/U68248; cap655360/guard352/unallocated123392. Includes this line; prior charges unchanged.

## A1-A3 Case-Table Reservation
[plan](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_A1_A3_CASE_DESIGN.md): approved11264 from unallocated123392 ->112128; design6144/review3072/integration1024/stop1024; old reservations unchanged; docs only.

## Legal-Event/Guard Mapping Reservation
[plan](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_EVENT_GUARD_MAPPING_DESIGN.md): approved14336 from unallocated112128 ->97792; design8192/review4096/integration1024/stop1024; old reservations unchanged; docs only.

[mapping review](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_EVENT_GUARD_MAPPING_REVIEW.md) saved within existing review4096/integration1024; no reallocation.

## Key/Uniqueness/Value State Reservation
[plan](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_KEY_VALUE_STATE_DESIGN.md): approved14336 from unallocated97792 ->83456; design8192/review4096/integration1024/stop1024; old reservations unchanged; docs only.

## Uniqueness/Index Prerequisite Reservation
[plan](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_UNIQUENESS_INDEX_PREREQUISITE_DESIGN.md): approved14336 from unallocated83456 ->69120; design8192/review4096/integration1024/stop1024; old reservations unchanged; docs only.

## Index-Order Comparison Reservation
[plan](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_INDEX_ORDER_SELECTION_DESIGN.md): approved16384 from unallocated69120 ->52736; design10240/review4096/integration1024/stop1024; old reservations unchanged; docs only.

## B Colon/Input Boundary Reservation
[plan](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_COLON_INPUT_BOUNDARY_DESIGN.md): approved16384 from unallocated52736 ->36352; design10240/review4096/integration1024/stop1024; old reservations unchanged; docs only.

## Index Reference Target Reservation
[plan](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_INDEX_REFERENCE_TARGET_DESIGN.md): approved16384 from unallocated36352 ->19968; design10240/review4096/integration1024/stop1024; old reservations unchanged; docs only.

## Index Representation/Reflection Reservation
[plan](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_INDEX_REPRESENTATION_REFLECTION_DESIGN.md): approved16384 from unallocated19968 ->3584; design10240/review4096/integration1024/stop1024; old reservations unchanged; docs only.

## Prospective Ceiling Extension: 768 KiB
[design](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_G2_RETENTION_768K_DESIGN.md): approved ceiling786432 and reservation8192 from increase131072; unallocated126464 before charges; old reservations/guard352/history stay. No next-design allocation or runtime grant.
