import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { takeNativeWriterLockWithIo, takeNativeWriterLock } from "../../build/nativeBarAccess.js";
import { canonical } from "../../build/nativeBarEvidence.js";

function memoryIo(initial = []) {
  const files = new Map(initial);
  return { files, check() {}, async names() { return [...files.keys()]; },
    async read(name) { const body = files.get(name); return body === undefined ? null : Buffer.from(body); },
    async publish(name, body) { if (files.has(name)) return "exists"; files.set(name, body); return "created"; },
    removeOwn(name, body, absentOk) { if (!files.has(name)) return !!absentOk;
      if (files.get(name) !== body) return false; files.delete(name); return true; },
    async retireDead() { throw new Error("unexpected_retirement"); },
  };
}
test("shared writer engine releases its exact synthetic in-memory queue and preserves side entries", async () => {
  const io = memoryIo([["unknown", "preserve"]]), lock = await takeNativeWriterLockWithIo(io, 50);
  assert.equal(io.files.size, 4); assert.equal(lock.release(), true); assert.deepEqual([...io.files], [["unknown", "preserve"]]);
});
test("shared writer engine preserves the original error and never substitutes a pathname backend", async () => {
  const io = memoryIo(); io.names = async () => { throw Error("fixture_scan_failed"); };
  await assert.rejects(takeNativeWriterLockWithIo(io, 50), /fixture_scan_failed/); assert.equal(io.files.size, 0);
});
test("permission-denied process evidence blocks rather than proving an owner dead", async () => {
  const id = "01234567-89ab-4cde-8fab-0123456789ab", body = canonical({ pid: 424242, token: id });
  const io = memoryIo([[".writer.lock", body]]), kill = process.kill;
  process.kill = (pid, signal) => { if (pid === 424242) throw Object.assign(Error("denied"), { code: "EPERM" }); return kill(pid, signal); };
  try { await assert.rejects(takeNativeWriterLockWithIo(io, 20), /store_lock_busy/); }
  finally { process.kill = kill; }
  assert.deepEqual([...io.files], [[".writer.lock", body]]);
});
test("missing optional coordination backend refuses without creating a data root", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "native-coordination-loader-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "loader.mjs"); copyFileSync(new URL("../../build/nativeBarFs.js", import.meta.url), path);
  const api = await import(pathToFileURL(path)); assert.throws(() => api.openSyntheticNativeBarCoordination(join(dir, "missing")), /coordination_unavailable/);
});
test("slice C is not registered, enabled, or attached to recording/replay and exposes no data mutation entry", () => {
  for (const file of ["server.ts", "index.ts", "nativeBarHistory.ts", "nativeBarMaintenance.ts", "nativeBarTransactions.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8"), /nativeBarMaintenanceExecution|openSyntheticNativeBarCoordination/);
  }
  const source = readFileSync(new URL("../../src/nativeBarMaintenanceExecution.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /execution_available:\s*true|openSyntheticNativeBarFs|takeNativeWriterLock\(/);
  const native = readFileSync(new URL("../../native/native_bar_fs/native_bar_writer.inc", import.meta.url), "utf8");
  assert.doesNotMatch(native, /captures\/|receipts\/|mkdirat\s*\(|open\s*\(/);
});
test("the old pathname adapter retains its independent lock permission check", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "writer-legacy-private-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const body = canonical({ pid: process.pid, token: "01234567-89ab-4cde-8fab-0123456789ab" });
  writeFileSync(join(dir, ".writer.lock"), body, { mode: 0o644 });
  // Windows refuses earlier: the store cannot verify POSIX private access there.
  await assert.rejects(takeNativeWriterLock(dir, async () => {}, 20), process.platform === "win32" ? /private_access_unverified/ : /unsafe_writer_lock/);
  assert.deepEqual(readdirSync(dir), [".writer.lock"]); assert.equal(readFileSync(join(dir, ".writer.lock"), "utf8"), body);
});
test("unsupported platforms refuse coordination without a loader or pathname fallback", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    Object.defineProperty(process,'platform',{value:'linux'});
    const api=await import(${JSON.stringify(new URL("../../build/nativeBarFs.js", import.meta.url).href)});
    try{api.openSyntheticNativeBarCoordination('/never-open');process.exit(2)}catch(e){if(!e.message.includes('coordination_unavailable'))throw e}
  `], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
});
