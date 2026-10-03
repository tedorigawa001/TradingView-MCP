import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
/** A symlink, or null where the platform will not make one (Windows without the privilege). */
async function linkTo(target, path) {
  try { await symlink(target, path, "file"); return path; }
  catch (error) { if (error.code === "EPERM" || error.code === "EACCES") return null; throw error; }
}

test("isCliEntrypoint compares real paths: the script itself or a link to it, never another file or no script", async (t) => {
  const dir = await scratch(t);
  const script = join(dir, "cli.js"), other = join(dir, "other.js");
  await writeFile(script, ""); await writeFile(other, "");
  const url = pathToFileURL(script).href;
  assert.equal(isCliEntrypoint(url, script), true);
  assert.equal(isCliEntrypoint(url, other), false);
  assert.equal(isCliEntrypoint(url, undefined), false, "node -e, or an import from another script");
  assert.equal(isCliEntrypoint(url, ""), false);
  assert.equal(isCliEntrypoint(url, join(dir, "missing.js")), false);
  const link = await linkTo(script, join(dir, "tradingview-mcp-bin"));
  if (!link) { t.diagnostic("symlinks unavailable here; the link case is covered on the other platforms"); return; }
  assert.equal(isCliEntrypoint(url, link), true, "an npm-style link to the script is the entry point");
});

test("the linked collection and health bins run: they reject a bad argument as directly, and stay quiet when imported", async (t) => {
  const dir = await scratch(t);
  // A throwaway home: neither CLI reaches its stores before rejecting the argument, and none of the real ones is used.
  const env = { ...process.env, HOME: dir, USERPROFILE: dir };
  const run = (args) => promisify(execFile)(process.execPath, args, { env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }), (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
  for (const [file, bin, message] of [
    ["collectionCli.js", "tradingview-mcp-collect-first-seen", /first-seen collection failed: unknown argument: --bogus/],
    ["collectionHealthCli.js", "tradingview-mcp-health", /collection health check failed: .*--bogus/],
  ]) {
    const target = new URL(`../../build/${file}`, import.meta.url);
    const direct = await run([fileURLToPath(target), "--bogus"]);
    assert.deepEqual([direct.code, message.test(direct.stderr)], [1, true], `${file} direct: ${direct.stderr}`);
    // With -e, argv[1] is the first argument after "--", here "--bogus": no script, so not the entry point.
    const imported = await run(["--input-type=module", "-e", `await import(${JSON.stringify(target.href)});`, "--", "--bogus"]);
    assert.deepEqual([imported.code, imported.stdout, imported.stderr], [0, "", ""], `${file} imported`);
    const link = await linkTo(target, join(dir, bin));
    if (!link) { t.diagnostic(`symlinks unavailable here; ${bin} through a link is covered on the other platforms`); continue; }
    const linked = await run([link, "--bogus"]);
    assert.deepEqual([linked.code, message.test(linked.stderr)], [1, true], `${bin} through a link: ${JSON.stringify(linked)}`);
  }
});

test("no CLI decides its entry point by comparing argv[1] as a string or by file name again", async () => {
  const src = new URL("../../src/", import.meta.url);
  const offenders = [];
  for (const name of (await readdir(src)).filter((n) => n.endsWith(".ts"))) {
    const text = await readFile(new URL(name, src), "utf8");
    if (/pathToFileURL\(process\.argv\[1\]\)|process\.argv\[1\]\??\.endsWith\(/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], "use isCliEntrypoint(import.meta.url) from cliEntrypoint.ts");
});
