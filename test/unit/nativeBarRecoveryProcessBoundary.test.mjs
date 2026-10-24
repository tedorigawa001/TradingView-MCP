import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { RECOVERY_CHANNEL_LIMIT, recoveryFrame, decodeRecoveryFrame, inheritedRecoveryChannel } from "../../build/nativeBarRecoveryChannel.js";
import { createSyntheticNativeBarInitialProcess, createSyntheticNativeBarRecoveryProcess, prepareSyntheticNativeBarWorkerRetirement } from "../../build/nativeBarRecoveryProcess.js";

test("R-D private channel frames preserve bounded canonical structured messages", () => {
  const value = { nonce: "test-only", id: 1, operation: "alive", args: [] }, frame = recoveryFrame(value);
  assert.equal(frame.readUInt32BE(), frame.length - 4); assert.deepEqual(decodeRecoveryFrame(frame.subarray(4)), value);
});
test("R-D private channel decoder rejects duplicate keys, invalid UTF-8 and noncanonical messages", () => {
  for (const bytes of [Buffer.from('{"id":1,"id":1}'), Buffer.from('{ "id":1}'), Buffer.from([0xff]), Buffer.alloc(0)]) {
    assert.throws(() => decodeRecoveryFrame(bytes));
  }
  assert.throws(() => recoveryFrame({ oversized: "x".repeat(RECOVERY_CHANNEL_LIMIT) }), /ipc_limit/);
});
test("R-D private channel decoding is bounded before recursive canonical comparison", () => {
  const deep = Buffer.from("[".repeat(80) + "0" + "]".repeat(80));
  assert.throws(() => decodeRecoveryFrame(deep), /ipc_depth/);
  assert.throws(() => decodeRecoveryFrame(Buffer.alloc(RECOVERY_CHANNEL_LIMIT + 1, 32)), /ipc_limit/);
});
test("R-D root paths and disk/JSON flags cannot mint process or retirement authority", async () => {
  for (const value of [{}, { root: "/must-not-open", original_sealed: true }, { execution_available: true }]) {
    await assert.rejects(createSyntheticNativeBarInitialProcess(value), /execution_owner_required/);
    await assert.rejects(createSyntheticNativeBarRecoveryProcess(value), /execution_owner_required/);
    await assert.rejects(prepareSyntheticNativeBarWorkerRetirement(value, process.pid), /execution_owner_required/);
  }
});
test("R-D synchronous owner bridge refuses an ordinary process without its inherited IPC descriptor", () => {
  assert.throws(() => inheritedRecoveryChannel("test-only", process.ppid), /inherited_channel_required/);
});
test("R-D worker has no CLI/environment admission and ordinary invocation performs no work", () => {
  const worker = fileURLToPath(new URL("../../build/nativeBarRecoveryWorker.js", import.meta.url));
  const result = spawnSync(process.execPath, [worker, "/must-not-open"], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "");
  assert.doesNotMatch(readFileSync(new URL("../../src/nativeBarRecoveryWorker.ts", import.meta.url), "utf8"), /process\.(?:env|argv)|node:fs|JSON\.parse/);
});
test("R-D remains disconnected from MCP, normal startup and production history/maintenance", () => {
  for (const file of ["server.ts", "index.ts", "nativeBarHistory.ts", "nativeBarMaintenance.ts", "nativeBarQuarantine.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8"), /nativeBarRecovery(?:Process|Worker|Channel)\.js/);
  }
  const channel = readFileSync(new URL("../../src/nativeBarRecoveryChannel.ts", import.meta.url), "utf8");
  assert.doesNotMatch(channel, /\b(?:openSync|unlinkSync|writeFileSync|renameSync|mkdirSync)\b/);
});
