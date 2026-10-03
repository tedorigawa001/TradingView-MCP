import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isCliEntrypoint } from "../../build/cliEntrypoint.js";

// BACKLOG 102-01: npm installs a bin as a symlink, so argv[1] is the link while import.meta.url is the file it points
// to. Comparing the strings made a linked CLI exit 0 without doing anything, even on an argument it rejects directly.
async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), "cli-entry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
/** A symlink, or null on Windows without the privilege to make one; elsewhere a failure is a failure. */
async function linkTo(target, path, type = "file") {
  try { await symlink(target, path, type); return path; }
  catch (error) { if (process.platform === "win32" && (error.code === "EPERM" || error.code === "EACCES")) return null; throw error; }
}
/** The parent environment without anything that names a store, an endpoint or a credential, and a throwaway home. */
function isolatedEnv(dir) {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(TRADINGVIEW_MCP|TV_MCP|TV_CDP|OANDA)|^(HOME|USERPROFILE|LOCALAPPDATA)$/i.test(key)));
  return { ...env, HOME: dir, USERPROFILE: dir, LOCALAPPDATA: dir };
}

test("isCliEntrypoint compares real paths as node resolves the script: the script, a link to it, the name without .js", async (t) => {
  const dir = await scratch(t);
  const script = join(dir, "cli.js"), other = join(dir, "other.js"), sameName = join(dir, "sub", "cli.js");
  await mkdir(join(dir, "sub"));
  await writeFile(script, ""); await writeFile(other, ""); await writeFile(sameName, "");
  const url = pathToFileURL(script).href;
  assert.equal(isCliEntrypoint(url, script), true);
  assert.equal(isCliEntrypoint(url, join(dir, "cli")), true, "`node dir/cli` runs dir/cli.js");
  assert.equal(isCliEntrypoint(url, other), false);
  assert.equal(isCliEntrypoint(url, sameName), false, "a file of the same name elsewhere is not this one");
  assert.equal(isCliEntrypoint(url, undefined), false, "node -e, or an import from another script");
  assert.equal(isCliEntrypoint(url, ""), false);
  assert.equal(isCliEntrypoint(url, "--bogus"), false);
  assert.equal(isCliEntrypoint(url, join(dir, "missing.js")), false);
  assert.throws(() => isCliEntrypoint(script, script), "a path passed as the module URL is a programming error, not a no");
  const link = await linkTo(script, join(dir, "tradingview-mcp-bin"));
  if (!link) { t.diagnostic("symlinks unavailable on this Windows runner; the link case is covered on the others"); return; }
  assert.equal(isCliEntrypoint(url, link), true, "an npm-style link to the script is the entry point");
});

test("the linked collection and health bins run: they reject a bad argument as directly, do real work, and stay quiet when imported", async (t) => {
  const dir = await scratch(t);
  // Neither CLI builds a store before rejecting an argument; the environment holds no store, endpoint or credential.
  const env = isolatedEnv(dir);
  const run = (args) => promisify(execFile)(process.execPath, args, { env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }), (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
  for (const [file, bin, message] of [
    ["collectionCli.js", "tradingview-mcp-collect-first-seen", /first-seen collection failed: unknown argument: --bogus/],
    ["collectionHealthCli.js", "tradingview-mcp-health", /collection health check failed: .*--bogus/],
  ]) {
    const target = new URL(`../../build/${file}`, import.meta.url);
    for (const path of [fileURLToPath(target), fileURLToPath(target).replace(/\.js$/, "")]) {
      const direct = await run([path, "--bogus"]);
      assert.deepEqual([direct.code, message.test(direct.stderr)], [1, true], `${path}: ${direct.stderr}`);
    }
    // With -e, argv[1] is the first argument after "--": no script, so not the entry point, even when that argument
    // is the CLI's own path.
    for (const first of ["--bogus", fileURLToPath(target)]) {
      const imported = await run(["--input-type=module", "-e", `await import(${JSON.stringify(target.href)});`, "--", first, "--bogus"]);
      assert.deepEqual([imported.code, imported.stdout, imported.stderr], [0, "", ""], `${file} imported with ${first}`);
    }
    if (bin === "tradingview-mcp-health") {
      // Real work, directly: with an empty home every first-seen heartbeat is missing, so the result is stale.
      const checked = await run([fileURLToPath(target), "--scope", "first-seen"]);
      assert.equal(checked.code, 1, checked.stderr);
      assert.deepEqual([JSON.parse(checked.stdout).scope, JSON.parse(checked.stdout).status], ["first-seen", "stale"]);
    }
    const link = await linkTo(target, join(dir, bin));
    if (!link) { t.diagnostic(`symlinks unavailable on this Windows runner; ${bin} through a link is covered on the others`); continue; }
    const linked = await run([link, "--bogus"]);
    assert.deepEqual([linked.code, message.test(linked.stderr)], [1, true], `${bin} through a link: ${JSON.stringify(linked)}`);
    if (bin === "tradingview-mcp-health") {
      // Real work through the link: with an empty home every first-seen heartbeat is missing, so the result is stale.
      const checked = await run([link, "--scope", "first-seen"]);
      assert.equal(checked.code, 1, checked.stderr);
      assert.deepEqual([JSON.parse(checked.stdout).scope, JSON.parse(checked.stdout).status], ["first-seen", "stale"]);
    }
  }
});

test("through a linked directory the bins run under --preserve-symlinks and --preserve-symlinks-main too", async (t) => {
  // Through a file link node cannot load a module whose path it preserves (its relative imports miss), so this uses a
  // link to the whole build directory: a junction on Windows, which needs no privilege.
  const dir = await scratch(t);
  const env = isolatedEnv(dir);
  const builds = await linkTo(fileURLToPath(new URL("../../build", import.meta.url)), join(dir, "build-link"), "junction");
  if (!builds) { t.diagnostic("directory links unavailable here"); return; }
  // Both flags together leave node unable to find the package's dependencies from the linked path, before any guard.
  for (const flags of [[], ["--preserve-symlinks-main"], ["--preserve-symlinks"]]) {
    const result = await promisify(execFile)(process.execPath, [...flags, join(builds, "collectionCli.js"), "--bogus"], { env })
      .then(() => ({ code: 0, stderr: "" }), (error) => ({ code: error.code, stderr: error.stderr }));
    assert.deepEqual([result.code, /unknown argument: --bogus/.test(result.stderr)], [1, true], `${flags.join(" ")}: ${result.stderr}`);
  }
});

test("every CLI decides its entry point through isCliEntrypoint, and none compares argv[1] itself again", async () => {
  const root = new URL("../../", import.meta.url);
  const src = new URL("src/", root);
  const offenders = [];
  for (const name of (await readdir(src)).filter((n) => n.endsWith(".ts") && n !== "cliEntrypoint.ts")) {
    if (/process\.argv(?!\.slice\(2\)|\[2\])/.test(await readFile(new URL(name, src), "utf8"))) offenders.push(name);
  }
  assert.deepEqual(offenders, [], "use isCliEntrypoint(import.meta.url) from cliEntrypoint.ts");
  // Every bin and every `node build/X.js` script runs only as the entry point; index and the migrations run on import.
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const targets = new Set([...Object.values(pkg.bin), ...Object.values(pkg.scripts)].flatMap((command) =>
    [...command.matchAll(/(?:^|\s)build\/(\w+)\.js\b/g)].map((match) => match[1])));
  const unconditional = new Set(["index", "migrateFuturesOiDatesCli", "migrateFuturesOiCmeCleanupCli"]);
  assert.ok(targets.size > 20, `${targets.size} targets`);
  const unguarded = [];
  for (const name of targets) {
    if (unconditional.has(name)) continue;
    if (!/^if \(isCliEntrypoint\(import\.meta\.url\)\)/m.test(await readFile(new URL(`${name}.ts`, src), "utf8"))) unguarded.push(name);
  }
  assert.deepEqual(unguarded, []);
  // The add-on's scripts compare real paths too.
  for (const name of ["build.mjs", "replay.mjs"]) {
    const text = await readFile(new URL(`bookmap-addon/${name}`, root), "utf8");
    assert.match(text, /realpathSync\(resolve\(process\.argv\[1\]\)\) === realpathSync\(fileURLToPath\(import\.meta\.url\)\)/, name);
    assert.match(text, /^if \(isEntrypoint\(\)\) \{/m, `${name} uses it`);
    assert.doesNotMatch(text, /(?<!realpathSync\()resolve\(process\.argv\[1\]\) *===|=== *resolve\(process\.argv\[1\]\)/,
      `${name} compares argv[1] only by real path`);
  }
});
