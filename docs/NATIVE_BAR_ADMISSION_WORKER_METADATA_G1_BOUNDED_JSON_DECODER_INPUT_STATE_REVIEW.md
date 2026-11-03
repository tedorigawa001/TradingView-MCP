# Input/State Revision Review
Design: [contract](NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_INPUT_STATE_DESIGN.md).
Base74d2c2a; docs only; no code/tests/effects.
Old=98638ab535fdae220ce473066a741590baee61ad73d1040514defbac2cd2f7d2
New=8f06f4250f56516c2ee847b1c93dbb0b22e5998a370d3ef9f09b620784e37269
Fixes: tail-only; invalid calls; terminal destinations.
Post-review C357694/U34658; bytes1613/2048.
Caps: metadata512; R1/R2 768 each; all labels count.

## Review 1
Round1 01a1a0d7-ac33-76d0-b88f-8b4816568313; SHA=fc6e5bc95dc33843c92f4a56c39850ab518540c23cd4e719c6f23f631a86f68b
No actionable findings. Checked root-completion latching, same-delivery tail handling across yields, delivery boundaries, explicit EOF, and empty-input transitions.
Round2 01a1a0da-affe-7f70-b501-a32defc3076e; SHA=New
PASS (partial design): tail-only spans deliveries/yields; EOF requires drained, complete object; invalid calls preserve state; terminals cannot restart.

## Review 2
Round1 01a1a0d7-ac56-7373-8b70-b9b7f16b34d2; SHA=fc6e5bc95dc33843c92f4a56c39850ab518540c23cd4e719c6f23f631a86f68b
P2 L10/L19: Cancellation has no defined destination state. Thus, whether later advance, acceptDelivery, or finish calls are invalid remains unspecified; "no terminal restart" only helps if cancellation is explicitly terminal. Define cancellation as terminal, with no resumption or result transfer.
Round2 01a1a0da-b00f-7221-99a2-ec8a46499938; SHA=New
PASS: L19 resolves cancellation/refusal P2. L11 preserves bindings/input/position; L5-19 bar terminal input/resume/retransfer. L2,6,23 grant no execution authority.
