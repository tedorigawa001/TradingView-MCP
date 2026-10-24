import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("R-C cannot reconstruct controller authority from a root, JSON, or a reader ticket", async () => {
  const { createSyntheticNativeBarRecoveryExecution } = await import("../../build/nativeBarRecoveryExecution.js");
  for (const value of [{}, { root: "/must-not-open", approved: true }, { execution_available: true }]) {
    assert.throws(() => createSyntheticNativeBarRecoveryExecution(value), /execution_owner_required/);
  }
});
test("R-C is absent from MCP/production imports and has no pathname mutation or legacy execution fallback", () => {
  for (const name of ["server.ts", "index.ts", "nativeBarHistory.ts", "nativeBarMaintenance.ts", "nativeBarQuarantine.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8"), /nativeBarRecoveryExecution\.js/);
  }
  const source = readFileSync(new URL("../../src/nativeBarRecoveryExecution.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:fs|nativeBarQuarantine\.js|execution_available:\s*true|\.publish\(|\.move\(/);
  const native = readFileSync(new URL("../../native/native_bar_fs/native_bar_recovery.inc", import.meta.url), "utf8");
  assert.doesNotMatch(native, /\b(?:unlinkat|mkdirat|ftruncate)\s*\(|F_PREALLOCATE|O_TRUNC/);
});
