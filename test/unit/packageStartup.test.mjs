import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectArtifact, sha } from "../../scripts/package-verifier-core.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));

test("the server loads from the extracted npm package", async (t) => {
  const work = mkdtempSync(join(tmpdir(), "tradingview-package-startup-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));

  // npm test supplies the CLI path on every platform, including Windows.
  const npmCli = process.env.npm_execpath ?? (process.platform === "win32"
    ? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : undefined);
  const packed = JSON.parse(execFileSync(npmCli ? process.execPath : "npm", [
    ...(npmCli ? [npmCli] : []),
    "pack", ".", "--json", "--offline", "--ignore-scripts", "--workspaces=false", "--update-notifier=false",
    "--pack-destination", work, "--cache", join(work, "cache"),
  ], { cwd: repo, encoding: "utf8", timeout: 30_000 }));
  assert.equal(packed.length, 1);

  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const expected = new Map(["package.json", "README.md", "LICENSE", ...pkg.files].map((file) => {
    const bytes = readFileSync(join(repo, file));
    return [`package/${file}`, { bytes: bytes.length, sha256: sha(bytes) }];
  }));
  const { raw, entries } = await inspectArtifact(readFileSync(join(work, packed[0].filename)), expected);
  for (const [name, { start, size }] of entries) {
    const path = join(work, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, raw.subarray(start, start + size));
  }

  symlinkSync(join(repo, "node_modules"), join(work, "node_modules"),
    process.platform === "win32" ? "junction" : "dir");
  const { createServer } = await import(pathToFileURL(join(work, "package", "build", "server.js")).href);
  assert.equal(typeof createServer, "function");
});
