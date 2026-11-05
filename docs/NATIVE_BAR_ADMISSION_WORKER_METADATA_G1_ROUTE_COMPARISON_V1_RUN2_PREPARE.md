# RUN2 Preparation
2026-11-05 JST. NOT_EXECUTED; RUN2 attempts0; execution approval NONE.
After RUN1_RESUME01 the user chose a file-reading executor: retyping cannot meet exact-payload approval and the model's gate cannot detect a body typo.
Sibling _RUN2_RUNNER.mjs, 1152 bytes, SHA-256 850a109aa16ee7c9d1eea78d2949bb816727d02f6acc03edb7459ae1653ac998. It reads retained model/wrapper/input, requires payload 5681f90ed3a2e40e2d7d2d7635dd698b58dbd53c142d22481d91a2d2fd53e808 before evaluating, and accepts one text output.
This replaces functions.exec and uses vm, departing at least from RUN1_PREPARE 35-36 and both stops; it needs explicit approval.
Launch: node v24.18.0 by absolute path, SHA-256 ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a; env PATH/HOME/TMPDIR only; --permission with fs read of those four files. Network is not restricted; neither runner nor payload uses it.
Only dummy payloads exercised: success, hash refusal, bad output, code-generation block, timeout, denied write/read/spawn. Real payload not evaluated.
One attempt, no retry. A valid record needs exit0, stderr exactly the wire hash line, a matching hash and a final encoder line; REPORT is assembled from the wire bytes. Anything else stops. Exit0 is not a model pass.
Eight premises=true remain model assumptions. Compare with FIX_REVIEW line 32: a mismatch is a model-or-trace defect candidate, recorded as is, no reinterpretation or rerun. No route selection.
Two independent runner reviews: no P1/P2; nothing executed.
