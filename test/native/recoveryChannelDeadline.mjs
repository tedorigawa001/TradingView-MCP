import { inheritedRecoveryChannel } from "../../build/nativeBarRecoveryChannel.js";

// Real inherited socket; only this test process's monotonic clock is accelerated.
process.once("message", ({ nonce, parent, mode }) => {
  const now = performance.now.bind(performance), start = now();
  Object.defineProperty(performance, "now", { value: () => now() + (now() - start) * 10000 });
  try {
    inheritedRecoveryChannel(nonce, parent)("alive", mode === "write" ? ["x".repeat(1048576)] : []);
    process.send({ error: "unexpected_response" }, () => process.disconnect());
  } catch (error) { process.send({ error: error.message }, () => process.disconnect()); }
});
