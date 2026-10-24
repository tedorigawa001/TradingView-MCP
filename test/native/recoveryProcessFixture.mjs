import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { canonical } from "../../build/nativeBarEvidence.js";
import { createSyntheticNativeBarRecoveryController, inspectSyntheticNativeBarRecovery } from "../../build/nativeBarRecoveryController.js";

// Setup of invented inputs/layout/reserve remains explicit test scaffolding, never a runtime initializer.
export function fixture(t, count = 1, setupHelper) {
  const base = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "native-bar-fs-synthetic-")); fs.chmodSync(base, 0o700);
  fs.writeFileSync(join(base, ".native-bar-fs-synthetic"), "synthetic-fixture-v1\n", { mode: 0o600 });
  const root = join(base, "store"); fs.mkdirSync(root, { mode: 0o700 });
  fs.writeFileSync(join(root, "policy.json"), '{"schema":"native-bar-synthetic-quarantine-recovery-profile-v5"}', { mode: 0o600 });
  fs.mkdirSync(join(root, "captures/2026-10-25"), { recursive: true, mode: 0o700 });
  const inputs = Array.from({ length: count }, (_, i) => ({ source_path: `captures/2026-10-25/00000000-0000-4000-8000-${String(301 + i).padStart(12, "0")}.json`, bytes: Buffer.from(`invented R-D input ${i}\n`) }));
  for (const input of inputs) fs.writeFileSync(join(root, input.source_path), input.bytes, { mode: 0o600 });
  const controller = createSyntheticNativeBarRecoveryController(), processes = [];
  t.after(async () => { try { for (const p of processes) await p.close(); } finally { controller.close(); fs.rmSync(base, { recursive: true, force: true }); } });
  const admission = controller.admit(root, inputs), helper = setupHelper ?? join(base, "reserve-setup");
  if (!setupHelper) {
    const compiled = spawnSync("/usr/bin/xcrun", ["clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror", fileURLToPath(new URL("./recoveryReserveFixture.cc", import.meta.url)), "-o", helper], { encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr);
  }
  assert.equal(spawnSync(helper, [root, admission.plan.layout.reserve_path, admission.capacity.peak_bytes]).status, 0);
  for (const path of admission.plan.layout.directories) fs.mkdirSync(join(root, path), { recursive: true, mode: 0o700 });
  const original = controller.prepareOriginal(admission.admission), layout = original.plan.layout;
  fs.writeFileSync(join(root, `maintenance/${layout.maintenance_id}.manifest/${layout.chunk_id}.json`), canonical(original.manifest), { mode: 0o600 });
  fs.writeFileSync(join(root, `maintenance/${layout.maintenance_id}.json`), canonical(original), { mode: 0o600 });
  controller.sealOriginal(admission.admission);
  return { base, root, controller, original, inputs, admission, processes, setupHelper: helper,
    inspect: () => inspectSyntheticNativeBarRecovery(controller.connect(admission.admission)),
    async open(options, initial = false) {
      const mod = await import("../../build/nativeBarRecoveryProcess.js");
      const p = await mod[initial ? "createSyntheticNativeBarInitialProcess" : "createSyntheticNativeBarRecoveryProcess"](controller.connectExecutionForSyntheticTest(admission.admission), options);
      processes.push(p); return p;
    } };
}
