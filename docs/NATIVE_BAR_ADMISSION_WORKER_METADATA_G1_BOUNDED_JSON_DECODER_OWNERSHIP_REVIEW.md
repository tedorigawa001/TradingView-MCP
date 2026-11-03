# Ownership Contract Review
Design: [ownership](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_OWNERSHIP_DESIGN.md) at 7d1757b, SHA-256 0f9c154223eb8051.
Two independent read-only reviews by the reviewing session (R1 semantics, R2 quantities); docs only, no code/tests/effects. Findings are open; the design is unchanged.
Caps metadata1024/R1 1536/R2 1536; file 1649/4096 from the ownership review reserve.

## Review 1
Needs fix.
P2 L37/L39: no operation drives bounded release after REFUSED/CANCELLED. Input/state rejects every call there, L27 limits advance-driven release to READY/YIELDED and L39 forbids a new controller, so cancel during COPY_PENDING can leave the source lease and private input pinned, or force unbounded release inside the cancel/refusal call (D05).
P3 L19/L44: with serial calls and a single finish call, the pre-commit cancellation windows are unreachable; name the window or remove it.
P3 L7/L43-44: the receiver is bound neither at begin nor at finish, so a result could reach a receiver of another purpose/attempt (D08).
P3 L12/L17: an unqualified, shared or raw handle is neither clearly REFUSED nor a state-preserving contract error; a caller could re-offer objects for one sequence indefinitely.

## Review 2
PASS with P3.
P3 L13/L24-25: tokens split across deliveries must move into carry before input release; views into private input are not banned and carry has no size (numeric128, UTF-8 3, escape state, key text up to 65536).
P3 L31-32: coexisting source backings are counted but not bounded in number (see the capacity review).
P3 L19: "pre-commit cancellation" should name the handoff commit.

## Reconciliation Link

[revision](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_RECONCILIATION_DESIGN.md): approved design reconciliation; findings stay open pending re-review; no execution grant.
