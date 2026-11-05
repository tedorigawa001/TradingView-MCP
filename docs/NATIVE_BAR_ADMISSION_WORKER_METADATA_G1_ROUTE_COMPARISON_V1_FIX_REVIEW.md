# Route Comparison V1 Fix: Static Review
2026-11-05 JST. STATIC_ONLY; model runs0, no import/evaluation/test/build.
Baseline72098351797e33f04d8a30959653475e968f9f3d; eight design pins unchanged.
[model](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_ROUTE_COMPARISON_V1.mjs):
19635 ASCII bytes, cap20480; SHA-256 1bbca98e80a80838bcf867a202c5e8be9228c5b5214148bedc13ce944c4c0441.
New review cap6144: metadata1024/review1 2048/review2 2048/disposition1024.
Old REVIEW/STOP preserved. RESULT/new STOP absent; no execution/adoption grant.
24 cases x4 deliveries x3 fuel x2 widths x2 routes plus4 controls; no added runs.
Dot PAUSED; judgment/notification/mail unchanged.

## Review 1: Planck
Independent text review; no execution or edits.
Initial P2 findings:
1. Case19 finish checkpoints were not compared: Z could probe while close
work remained, WH after completion. Require semantic checkpoint matching.
2. Observer popped on byte consumption and ignored close effect: premature
retirement/pop could escape detection. Separate pending close/retirement.
3. Terminal rejection, YIELDED finish preservation and single handoff were
not covered by the fixed plan's existing probes.
Corrections reviewed: READY and YIELDED checkpoints compare phase, progress,
ownership/delivery and remaining work; observer independently counts close
retirement and requires consumed delimiter plus exact completion before pop.
Charged finish/advance rejection probes and handoff count were added within
existing runs; no cap/case increase.
Second review found absent YIELDED probes could compare equal as "none" and
receive PASS_CONDITIONAL. Missing probe now returns NOT_COMPARABLE with its
known checkpoint retained. Final static confirmation: missing READY hit or YIELDED probe remains
NOT_COMPARABLE; pair matching cannot promote it to PASS_CONDITIONAL.
No remaining blocker found in reviewed scope; not executed.

## Review 2: Aquinas
Independent text review; no execution or edits.
Initial review found no actionable accounting/cap/binding/control/report issue.
Re-review after close/probe changes confirmed:
- Probes charge existing per-run/global limits before acting, without reset.
- Completed outcomes, failed-control detail and first-stop preservation remain.
- Observer/checkpoint state does not enter the wire; structural bound stays
below4096 bytes.
- Binding/premise gates precede all attempts; no added I/O/import/clock/timer
or external mutation.
External trusted readback and exact-source/invocation approval are separate,
unverified gates. Final confirmation: the missing-probe return preserves hit/tail and records
verdict4 without absent metrics. No new accounting/bounds issue; not executed.

## Disposition
Prior REVIEW A1-A4: exhaustion states preserved; failed-control code/verdict
retained; fixed-schema output keeps all case counts/first stop; fault and
finish checkpoints include phase/owner/delivery/remaining work.
Prior B1-B4: source fits new cap; premises explicitly true/false/unknown;
binding mismatch stops with all1156 NOT_RUN; bounded encoding/accounting
replace the lossy output fallback. External readback is NOT authenticated
inside the model and remains required before execution approval.
Report envelope<=3648 bytes (header1280 + case rows1536 + aggregate384 +
stop192 + diagnostic256), versus result4096. Probes/caps are logical bounds,
not host heap/time/GC guarantees. No model behavior was tested; no winner or
runtime qualification. Final source/receipt/wrapper must be frozen/read back
and separately approved for any execution.
