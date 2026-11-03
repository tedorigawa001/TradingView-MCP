# Counter Contract Review
Design: [counter](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_COUNTER_DESIGN.md) at 7d1757b, SHA-256 5ff04c00634cc543.
Two independent read-only reviews by the reviewing session (R1 semantics, R2 quantities); docs only, no code/tests/effects. Findings are open; the design is unchanged.
Caps metadata1024/R1 1024/R2 1024; file 1422/3072 from the counter review reserve.

## Review 1
PASS with P3.
P3 L12: the parent batch check names no ledger and does not say whether receipt was already charged; double counting could refuse an exact-fit batch.
P3 L31 vs L17/L19: guards run before grammar; a node needs a legal value start (L17), but a key slot is reserved at any quoted key start (L19), so `{"a"{` at depth32 could misreport depth/key exhaustion or reserve a fictitious slot. The B/C work, capacity and ownership guards are not placed in the order.

## Review 2
Needs fix.
P2 L25-26: scalar65536 and numeric128 are not stated as per-token or per-response; {"a":40KiB,"b":40KiB} passes one reading and refuses the other, so exact/one-past cases cannot be written.
P3 L29: charge key comparisons per compared byte (one can scan 65536 bytes), as C does.
P3 L7: checked arithmetic covers addition only; C's products and page rounding need it too, and the integer type/maximum is unstated.
P3 L31: the guard order omits the B/C work, step, capacity, cleanup and ownership guards.

## Reconciliation Link

[revision](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_RECONCILIATION_DESIGN.md): approved design reconciliation; findings stay open pending re-review; no execution grant.
