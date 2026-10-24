import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("R-A imports pure record helpers only and cannot perform filesystem/native/clock effects", () => {
  const source = readFileSync(new URL("../../src/nativeBarRecovery.ts", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
    ["zod", "./nativeBarEvidence.js", "./nativeBarTransactions.js"]);
  assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(|\bprocess\.|Date\.now\(|performance\.|hrtime|randomUUID|execution_available:\s*true/);
  assert.doesNotMatch(source, /\.(writeFile|appendFile|mkdir|rename|unlink|purge|stage|quarantine)\s*\(/);
});
test("R-A is not connected to existing stores, native handles, MCP, jobs or quarantine execution", () => {
  for (const name of ["server.ts", "index.ts", "nativeBarHistory.ts", "nativeBarMaintenance.ts", "nativeBarTransactions.ts",
    "nativeBarFs.ts", "nativeBarAccess.ts", "nativeBarQuarantine.ts"]) {
    const source = readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /nativeBarRecovery\.js|planNativeBarRecovery|native-bar-synthetic-quarantine-recovery-profile-v5/);
  }
});
