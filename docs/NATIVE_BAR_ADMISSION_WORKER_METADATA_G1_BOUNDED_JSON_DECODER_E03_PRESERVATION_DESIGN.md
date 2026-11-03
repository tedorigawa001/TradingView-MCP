# A1-A4 Preservation Design
DESIGN_ONLY, approved 2026-11-04 JST; baselinef1217df3c826bc3011e606ec7ebb4c73e8cc6e34. Existing documents only. Dot PAUSED; judgment/notification/mail and existing limits unchanged. No runtime or acquisition grant.

## Binding And Domain
[Parent](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_E03_PROOF_DESIGN.md) SHA-256: ebdcdbbd8ead08fca7ac07ea4318b4b4c5306a7be6036373668c9aa97f2de057. A1-A4 and source aliases retain that binding. A5-A7/E05/E06 stay open.
One response, all event prefixes: n/q are cumulative committed value-node/key reservations. Partition reserved keys into mapped M and pending P. P means key reserved but property-value node not reserved; unreserved token bytes are not q. Contents/aliases never merge logical slots.

## Preservation Obligations
A1: only legal serial grammar events may commit growth after all required guards pass. Denied events add no partial tuple; prior commitments remain. Invalid calls cannot advance grammar; no speculative siblings.
A2: mapped keys inject into distinct committed logical value-node IDs, once. Equal bytes/shared backing do not merge IDs. No overwrite, recovery, terminal resume or reservation replay. The mapping is mathematical, not a runtime registry.
A3: each open object has at most one pending key; legal close requires none. No next key before the previous property has its node. Open objects are a subset of the depth-bounded container stack.
A4: each logical edge/index family needs its own injective mapping and pending bound, at most one entry/open container. No unproved family inherits J; J is not a combined-family cap. Copies, temporary shift slots, allocation counts/bytes require other evidence.

## Cases To Establish, Not Execute
- Initial prefix: n=q=0, empty correspondence.
- Key commit: no existing pending key in that object; q and pending grow once only if guards pass.
- Property-value node commit: reserve a distinct node; move its key from pending to mapped without changing q.
- Descent/scalar/array value: maintain correspondence; root/array nodes need no key. Combined guards must pass before that event commits.
- Object close: no pending key; do not discard cumulative mapped keys with live storage.
- Duplicate/incomplete/malformed key or value: unreserved parts add nothing; existing reservations remain. A terminal failure admits no later sibling.
- Denied node/depth/key guard: no new event tuple; a previously reserved key may remain pending.
- Yield/resume: no repeated reservation or mapping; logical identities survive.
- Refusal/cancel/cleanup: freeze last legal-prefix correspondence. No new q/n or refund. Cleanup does not resume grammar.

## Conditional Conclusion And Gates
While parsing, q=|M|+|P|, |M|<=n, |P|<=openObjects<=Dcap; hence q<=n+Dcap<=16384+32=16416. After termination use the frozen witness and constant Dcap, not current live depth0.
Each case needs pre/post invariants, owner/domain, source clause and proof. Missing uniqueness, pending or failure bounds leave it OPEN. Capacity does not prove this mapping. No E03/E05/E06 closure or host fact follows. Models, implementation and parser-policy adoption need separate approval.

## Retention
Cap524288/guard352 unchanged. Approved6656 from unallocated7168 ->512: design3584/review2048/integration512/stop512. Review physical metadata768/R1 640/R2 640 includes headings. REVIEW/STOP absent; old charges/reservations frozen, no refund or old spare reuse.
Charge D3558/L399; current C459430/U63994; includes this record. No runtime grant.
