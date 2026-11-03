# Capacity/Work Review
Design: [capacity/work](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_CAPACITY_WORK_DESIGN.md) at 7d1757b, SHA-256 6841cb817a4fb063.
Two independent read-only reviews by the reviewing session (R1 semantics, R2 quantities); docs only, no code/tests/effects. Findings are open; the design is unchanged.
Caps metadata1024/R1 1536/R2 1536; file 1820/4096 from the capacity/work review reserve.

## Review 1
Needs fix.
P2 L54: cleanup runs in steps <=Ws (Wc is 2048 steps), but no terminal-state operation drives them; cleanup above one step breaks the bound or stays pending. Same root cause as the ownership P2.
P3 L55: unresolved decoder cleanup after DONE conflicts with ownership L43-44 (release before commit) and L39 (unconfirmed release blocks publication).
P3 L16-17: Rbase and Oretained are undefined; zero would drop root-retained hashes, outcomes and projection rows.
P3 L7/L13: page(U) holds only for one paged pool; per-string pages can reach about N*1024 = 16 MiB.
P3 L30/L46: Wf=Ws=4096 cannot release more than about 4096 retained lookup records at finish unless records are released at object close.

## Review 2
Needs fix.
P2 L30: with linear key lookup, one root object of 256 keys x 2042 bytes (524033 <= B, 257 nodes) needs 32640 x 2042 = 66650880 byte comparisons, about 3.97 x Wn; a sorted index needs about 0.44 x Wn in total. Name the lookup and its per-object bound.
P2 L7/L13-14: page() over totals assumes one pool per record type; per-allocation padding gives up to 16383 x 1024 = 16776192 bytes for strings and about 8.4 MB for per-object tables.
P3 L18: producer-held source backings have no bound; 1024 deliveries x 8-64 KiB = 8-64 MiB.
P3 L15: projection is UNSET here, but M caps it at 1048576 (2B) and UTF-16 strings can add 2B; link or exclude both.

## Reconciliation Link

[revision](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_RECONCILIATION_DESIGN.md): approved design reconciliation; findings stay open pending re-review; no execution grant.

## Later Re-review Status

[record](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_RECONCILIATION_REVIEW.md): later documentary assessment; mapped clauses addressed, runtime qualification open; original review preserved.
