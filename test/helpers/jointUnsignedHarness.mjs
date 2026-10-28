import { describeUnsignedAcceptanceRun, describeUnsignedHarnessArguments } from "./jointUnsignedAcceptanceContracts.mjs";

export function inspectUnsignedHarness(args) { return describeUnsignedHarnessArguments(args); }
export async function executeUnsignedHarness() {
  // Deliberately sealed in C-C1a. No argument, environment flag, plan or receipt is execution consent.
  throw Error("cc1a_execution_not_approved");
}

// Unwired connection code for later review. No exported function calls it in C-C1a.
// C-C1b must supply the original live supervisor, independent observer, trace/resource checks and safe teardown first.
async function connectOriginalUnsignedCase(request, mode, caseId, binding, envelope) {
  const plan = describeUnsignedAcceptanceRun(request), c = plan.cases.find((c) => c.mode === mode && c.case_id === caseId);
  if (!c || process.env.NATIVE_BAR_B3CC_MODE !== mode) throw Error("cc1a_mode_binding");
  const base = mode === "normal" ? "../../build/b3cc-validation/normal/" : "../../build/b3cc-validation/ubsan/";
  const joint = await import(new URL(`${base}nativeBarAdmissionJointReader.js`, import.meta.url));
  const { createPublicKey } = await import("node:crypto");
  const helper = c.owner === "fixed_memory" ? await import("./fixedMemoryCheckpointOracle.mjs") : await import("./unsignedCheckpointOracle.mjs");
  const key = createPublicKey({ key: Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex"), type: "spki", format: "der" });
  const code = (e) => e instanceof Error && typeof e.message === "string" && e.message.length <= 96
    && /^(?:(?:b2[ab]|b3(?:ba|bb|ca|cb))_[a-z_]+|cc1a_[a-z_]+)$/.test(e.message) ? e.message : "cc1a_unexpected_error";
  let bootstrap, owner, reader, query, primary = null, diagnostic = null;
  const cleanup_errors = [];
  try {
    bootstrap = joint.createSyntheticAdmissionJointBootstrap(binding, key, envelope);
    owner = c.owner === "fixed_memory" ? helper.enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment,
      { sequence: "1", tip_hash: binding.registration.pins.enrollment_hash }) : helper.enrollUnsignedCheckpointOracle(bootstrap.ownerEnrollment, c.owner);
    reader = joint.enrollSyntheticAdmissionJointReader(bootstrap.jointReaderEnrollment); query = reader.beginJointRead();
    try { await reader.run(query); primary = "cc1a_unexpected_joint_success"; } catch (e) { primary = code(e); }
  } catch (e) { primary ??= code(e); }
  finally {
    if (query) try { diagnostic = reader.release(query); } catch (e) { cleanup_errors.push({ phase: "query_release", code: code(e) }); }
    for (const [phase, handle] of [["reader_close", reader], ["owner_close", owner], ["bootstrap_close", bootstrap]])
      if (handle) try { handle.close(); } catch (e) { cleanup_errors.push({ phase, code: code(e) }); }
  }
  return Object.freeze({ primary, diagnostic, cleanup_errors: Object.freeze(cleanup_errors), acceptance: "not_assessed" });
}
