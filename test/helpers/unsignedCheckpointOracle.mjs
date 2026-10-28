// Fixed unsigned lifecycle harness. No body/callback/clock/key/signer is accepted.
const cc1Mode = process.env.NATIVE_BAR_B3CC_MODE;
if (cc1Mode !== undefined && (!["normal", "ubsan"].includes(cc1Mode)
  || ["NATIVE_BAR_B2B_ISOLATED_TEST", "NATIVE_BAR_B3BA_ISOLATED_TEST", "NATIVE_BAR_B3BB_ISOLATED_TEST", "NATIVE_BAR_B3BC_ISOLATED_TEST", "NATIVE_BAR_B3CA_ISOLATED_TEST"]
    .some((key) => process.env[key] === "1"))) throw Error("b3cc_test_mode_refused");
const base = cc1Mode !== undefined ? `../../build/b3cc-validation/${cc1Mode}/`
  : process.env.NATIVE_BAR_B3BC_ISOLATED_TEST === "1" ? "../../build/b3bc-validation/" : process.env.NATIVE_BAR_B3BB_ISOLATED_TEST === "1" ? "../../build/b3bb-validation/" : process.env.NATIVE_BAR_B3BA_ISOLATED_TEST === "1" ? "../../build/b3ba-validation/" : "../../build/";
const { enrollUnsignedCheckpointOracleForHarness } = await import(new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url));
export const enrollUnsignedCheckpointOracle = (originalOwnerGrant, mode = "unavailable") =>
  enrollUnsignedCheckpointOracleForHarness(originalOwnerGrant, { schema: "native-bar-unsigned-checkpoint-oracle-v1", mode });
