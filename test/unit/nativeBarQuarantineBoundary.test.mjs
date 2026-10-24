import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

test("slice D remains disconnected from MCP, recording, classification and jobs", () => {
  for (const file of ["server.ts", "index.ts", "nativeBarHistory.ts", "nativeBarMaintenance.ts", "nativeBarTransactions.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8"), /["']\.\/nativeBarQuarantine\.js["']|openSyntheticNativeBarQuarantineIo/);
  }
  const source = readFileSync(new URL("../../src/nativeBarQuarantine.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from "node:fs|fsDurability|execution_available:\s*true|\.purge\(/);
  const native = readFileSync(new URL("../../native/native_bar_fs/native_bar_quarantine.inc", import.meta.url), "utf8");
  assert.doesNotMatch(native, /unlinkat\s*\(|\brename\s*\(|\bopen\s*\(/);
});
test("an absent optional quarantine backend creates nothing and never substitutes pathname mutation", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "quarantine-loader-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const loader = join(directory, "loader.mjs"); copyFileSync(new URL("../../build/nativeBarFs.js", import.meta.url), loader);
  const api = await import(pathToFileURL(loader)), root = join(directory, "missing");
  assert.throws(() => api.openSyntheticNativeBarQuarantineIo(root, 600000, { ownerDead: async () => true }), /quarantine_unavailable/);
  assert.equal(existsSync(root), false);
});
test("unsupported platforms cannot open the synthetic quarantine protocol", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    Object.defineProperty(process,'platform',{value:'linux'});
    const api=await import(${JSON.stringify(new URL("../../build/nativeBarFs.js", import.meta.url).href)});
    try{api.openSyntheticNativeBarQuarantineIo('/never-open',600000,{ownerDead:async()=>true});process.exit(2)}catch(e){if(!e.message.includes('quarantine_unavailable'))throw e}
  `], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
});
