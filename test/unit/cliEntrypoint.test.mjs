import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isCliEntrypoint } from "../../build/cliEntrypoint.js";
import { isEntrypoint as isAddonEntrypoint } from "../../bookmap-addon/entrypoint.mjs";

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
  assert.equal(isCliEntrypoint(url, "-"), false, "node - reads stdin: no script, whatever a file named - is");
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

test("code from stdin (node -) that imports a CLI does not run it, even with a file named - linking to it", async (t) => {
  const dir = await scratch(t);
  const target = new URL("../../build/collectionCli.js", import.meta.url);
  if (!(await linkTo(fileURLToPath(target), join(dir, "-")))) { t.diagnostic("symlinks unavailable on this Windows runner"); return; }
  const child = execFile(process.execPath, ["--input-type=module", "-", "--bogus"], { cwd: dir, env: isolatedEnv(dir) });
  child.stdin.end(`await import(${JSON.stringify(target.href)});`);
  const result = await new Promise((done) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
});

test("bookmap-addon's isEntrypoint: by real path, and never for -e/-p code or stdin, which would start the build", async (t) => {
  const dir = await scratch(t);
  const script = join(dir, "build.mjs"), other = join(dir, "other.mjs");
  await writeFile(script, ""); await writeFile(other, "");
  const url = pathToFileURL(script).href;
  assert.equal(isAddonEntrypoint(url, script, []), true);
  assert.equal(isAddonEntrypoint(url, other, []), false);
  assert.equal(isAddonEntrypoint(url, undefined, []), false);
  assert.equal(isAddonEntrypoint(url, join(dir, "missing.mjs"), []), false);
  for (const execArgv of [["-e", "code"], ["--input-type=module", "-e", "code"], ["-p", "code"], ["-pe", "code"], ["--eval=code"], ["--print", "code"]]) {
    assert.equal(isAddonEntrypoint(url, script, execArgv), false, `${execArgv.join(" ")} with the script's own path after --`);
  }
  assert.equal(isAddonEntrypoint(url, "-", []), false, "node - reads stdin");
  const link = await linkTo(script, join(dir, "build-link.mjs"));
  if (!link) { t.diagnostic("symlinks unavailable on this Windows runner"); return; }
  assert.equal(isAddonEntrypoint(url, link, []), true);
  assert.equal(isAddonEntrypoint(url, link, ["-e", "code"]), false, "the reported case: a link to it after -e");
  // node - with a file named - in the working directory that links to the script: still stdin, not the script.
  await linkTo(script, join(dir, "-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try { assert.equal(isAddonEntrypoint(url, "-", []), false); } finally { process.chdir(cwd); }
});

test("the add-on scripts' own entry checks (the defaults): replay runs directly and through a link, build stays put on import", async (t) => {
  const dir = await scratch(t);
  const env = isolatedEnv(dir);
  const run = (args, options = {}) => new Promise((done) => {
    const child = execFile(process.execPath, args, { env, ...options }, (error, stdout, stderr) =>
      done({ code: error ? error.code : 0, stdout, stderr }));
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
  });
  // replay.mjs reads argv itself; with no arguments it stops at its usage error, before reading or building anything.
  const replay = fileURLToPath(new URL("../../bookmap-addon/replay.mjs", import.meta.url));
  const usage = /usage: node bookmap-addon\/replay\.mjs CONFIG\.json RAW\.jsonl/;
  const direct = await run([replay]);
  assert.deepEqual([direct.code, usage.test(direct.stderr)], [1, true], direct.stderr);
  const linkedReplay = await linkTo(replay, join(dir, "replay-link.mjs"));
  if (linkedReplay) {
    const linked = await run([linkedReplay]);
    assert.deepEqual([linked.code, usage.test(linked.stderr)], [1, true], linked.stderr);
  }
  // build.mjs deletes and rebuilds bookmap-addon/dist under its own root, so a copy works only inside the scratch
  // directory. Imported from -e code given a link to it, or from stdin with a - link in the working directory, it must
  // not build: nothing is printed and nothing appears beside it.
  const copy = join(dir, "x", "bookmap-addon");
  await mkdir(copy, { recursive: true });
  for (const name of ["build.mjs", "entrypoint.mjs"]) {
    await copyFile(fileURLToPath(new URL(`../../bookmap-addon/${name}`, import.meta.url)), join(copy, name));
  }
  const build = join(copy, "build.mjs");
  const importBuild = `await import(${JSON.stringify(pathToFileURL(build).href)});`;
  const link = await linkTo(build, join(dir, "build-link.mjs"));
  if (link) {
    const evaluated = await run(["--input-type=module", "-e", importBuild, "--", link]);
    assert.deepEqual([evaluated.code, evaluated.stdout, evaluated.stderr], [0, "", ""], "-e with a link to build.mjs");
    const work = join(dir, "work");
    await mkdir(work);
    await linkTo(build, join(work, "-"));
    const piped = await run(["--input-type=module", "-"], { cwd: work, stdin: importBuild });
    assert.deepEqual([piped.code, piped.stdout, piped.stderr], [0, "", ""], "stdin with a - link to build.mjs");
  }
  assert.deepEqual((await readdir(copy)).sort(), ["build.mjs", "entrypoint.mjs"], "no dist was made beside the copy");
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
  // The add-on's scripts decide through their shared isEntrypoint, and read no argv[1] themselves.
  for (const name of ["build.mjs", "replay.mjs"]) {
    const text = await readFile(new URL(`bookmap-addon/${name}`, root), "utf8");
    assert.match(text, /^import \{ isEntrypoint \} from ["']\.\/entrypoint\.mjs["'];$/m, name);
    assert.match(text, /^if \(isEntrypoint\(import\.meta\.url\)\) \{/m, `${name} uses it`);
    assert.doesNotMatch(text, /process\.argv(?!\.slice\(2\)|\[2\])/, `${name} reads argv[1] only through it`);
  }
});
