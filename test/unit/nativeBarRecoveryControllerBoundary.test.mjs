import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createSyntheticNativeBarRecoveryController, inspectSyntheticNativeBarRecovery } from "../../build/nativeBarRecoveryController.js";

test("R-B controller construction and forged connections perform no IO or authority reconstruction", () => {
  const c = createSyntheticNativeBarRecoveryController();
  for (const value of [{}, { root: "/must-not-open", sealed: true }, { controller_scope_verified: true }]) {
    assert.throws(() => c.connect(value), /admission/); assert.throws(() => inspectSyntheticNativeBarRecovery(value), /connection/);
  }
  c.close(); c.close(); assert.throws(() => c.connect({}), /controller_unavailable/);
});
test("the optional v5 reader refuses an absent backend without a fallback or root creation", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-read-loader-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "loader.mjs"); copyFileSync(new URL("../../build/nativeBarFs.js", import.meta.url), file);
  const api = await import(pathToFileURL(file));
  assert.throws(() => api.openSyntheticNativeBarRecoveryReader(join(dir, "missing")), /recovery_read_unavailable/);
  assert.equal(existsSync(join(dir, "missing")), false);
});
test("R-B admission refuses unsupported platforms before opening any root", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    Object.defineProperty(process,'platform',{value:'linux'});
    const {createSyntheticNativeBarRecoveryController}=await import(${JSON.stringify(new URL("../../build/nativeBarRecoveryController.js", import.meta.url).href)});
    try{createSyntheticNativeBarRecoveryController().admit('/must-not-open',[{source_path:'captures/2026-10-24/00000000-0000-4000-8000-000000000201.json',bytes:Buffer.from('invented')}]);process.exit(2)}
    catch(e){if(!e.message.includes('recovery_read_unavailable'))throw e}
  `], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
});
test("R-B remains disconnected from production/MCP and has no mutation or legacy execution adapter", () => {
  for (const file of ["server.ts", "index.ts", "nativeBarHistory.ts", "nativeBarMaintenance.ts", "nativeBarQuarantine.ts", "nativeBarAccess.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8"), /nativeBarRecoveryController\.js|openSyntheticNativeBarRecoveryReader/);
  }
  const source = readFileSync(new URL("../../src/nativeBarRecoveryController.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']node:fs|fsDurability|nativeBarQuarantine\.js|takeNativeWriterLock|execution_available:\s*true/);
  assert.doesNotMatch(source, /\.(?:writeFile|appendFile|mkdir|rename|unlink|publish|stage|purge|move|removeOwn)\s*\(/);
  const native = readFileSync(new URL("../../native/native_bar_fs/native_bar_read.inc", import.meta.url), "utf8");
  assert.doesNotMatch(native, /\b(?:unlinkat|renameatx_np|mkdirat|fchmod|fchown|fsync|ftruncate|write|pwrite)\s*\(/);
  assert.doesNotMatch(native, /O_(?:CREAT|WRONLY|RDWR|TRUNC)/);
});
