import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

test("optional reader refuses a missing backend without opening or initializing a data root", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "native-read-loader-")); t.after(() => rmSync(temp, { recursive: true, force: true }));
  const file = join(temp, "loader.mjs"); copyFileSync(new URL("../../build/nativeBarFs.js", import.meta.url), file);
  const api = await import(pathToFileURL(file)); assert.equal(api.nativeBarFsAvailability().available, false);
  assert.throws(() => api.openSyntheticNativeBarReader(join(temp, "missing")), /native_bar_read_unavailable/);
});
test("unsupported platform refuses the optional reader before loading any backend", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    Object.defineProperty(process, 'platform', {value:'linux'});
    const api = await import(${JSON.stringify(new URL("../../build/nativeBarFs.js", import.meta.url).href)});
    try { api.openSyntheticNativeBarReader('/must-not-be-opened'); process.exit(2); }
    catch (e) { if(!e.message.includes('native_bar_read_unavailable')) throw e; }
  `], { encoding: "utf8" }); assert.equal(child.status, 0, child.stderr);
});
test("read-only native extension remains absent from MCP/history integration and binary publication", () => {
  for (const file of ["server.ts", "index.ts", "nativeBarHistory.ts", "nativeBarMaintenance.ts", "nativeBarTransactions.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8"), /openSyntheticNativeBarReader|nativeBarFs[.]js/);
  }
  const native = readFileSync(new URL("../../native/native_bar_fs/native_bar_read.inc", import.meta.url), "utf8");
  assert.doesNotMatch(native, /\b(?:unlinkat|renameatx_np|mkdirat|fchmod|fchown|fsync|ftruncate|write|pwrite)\s*\(/);
  assert.doesNotMatch(native, /O_(?:CREAT|WRONLY|RDWR|TRUNC)/);
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(pkg.files, ["build/**/*.js"]);
});
test("closing a native inventory releases vector storage before a retained JS handle is collected", () => {
  const native = readFileSync(new URL("../../native/native_bar_fs/native_bar_read.inc", import.meta.url), "utf8");
  const release = native.match(/void release\(\) noexcept \{([^}]+)\}/)?.[1];
  // clear() destroys entries but retains their vector allocation until GC.
  assert.match(release ?? "", /std::vector<ReadEntry>\(\)\.swap\(entries\)/);
});
