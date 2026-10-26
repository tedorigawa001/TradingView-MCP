// Fixed unsigned lifecycle harness. No body/callback/clock/key/signer is accepted.
const base = process.env.NATIVE_BAR_B3BA_ISOLATED_TEST === "1" ? "../../build/b3ba-validation/" : "../../build/";
const { enrollUnsignedCheckpointOracleForHarness } = await import(new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url));
export const enrollUnsignedCheckpointOracle = (originalOwnerGrant, mode = "unavailable") =>
  enrollUnsignedCheckpointOracleForHarness(originalOwnerGrant, { schema: "native-bar-unsigned-checkpoint-oracle-v1", mode });
