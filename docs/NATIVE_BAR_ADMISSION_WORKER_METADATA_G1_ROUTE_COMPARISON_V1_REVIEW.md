# Route Comparison V1: Static Review
2026-11-05 JST. BLOCKED; all findings OPEN; draft unsaved.
Baseline72098351797e33f04d8a30959653475e968f9f3d.
Draft10389 ASCII bytes; SHA-256
e2ae49d9c49c034f53f266257a450b08c2bd16d76360fbb16aae227e86b665cd.
Two independent text reviews; no invocation/import/model run or runtime grant.
No source/RESULT saved. Final source needs fresh review and execution approval.
Dot PAUSED; judgment/notification/mail unchanged.

## Review 1: Archimedes
Static-only; not executed.
P1: step phase4 sets NEED_INPUT/WAIT_EOF, but the !terminal/!blocked/!left
branch overwrites it with YIELDED. At fuel1 the state-commit phase repeats
until B:steps. The tail control therefore cannot reach its intended V:tail.
P1: CONTROL_FAILED drops the run verdict/code/diagnostic suffix, obscuring
the underlying bound failure.
P1: Output-size fallback drops completed counts/coverage, metrics and the
original stop; runs/total/notRun alone do not preserve outcome accounting.
P2: mark/fault pairing omits task kind/remaining work, phase, ownership and
delivery position. Equal hit tuples do not establish equal fault progress.
Require semantic checkpoint equivalence, otherwise NOT_COMPARABLE.

## Review 2: Singer
Static-only; no execution or filesystem access.
BLOCKER: draft10389 exceeds source8192 by2197; no oversized source retained.
High: assumptions is a name list without supplied true/false/unknown gates;
missing model premises must be distinct from conditional comparison.
High: binding only compares a constant string. External head/document/source
readback remains a future gate. Mismatch lacks explicit binding-stop and
notRun1156 accounting; separate invocation approval still required.
Medium: only run is exception-wrapped; setup/comparison/aggregation/final
serialization can escape without a bounded report. Output-size check follows
serialization, not a reservation preventing that allocation.
Controls are narrow: the tail detector trusts decoder-owned root.
No runtime qualification established.
