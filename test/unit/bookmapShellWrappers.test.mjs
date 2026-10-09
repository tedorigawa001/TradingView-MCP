// BACKLOG 102-26: the earlier shell scripts compiled their own, smaller, source set, so without the Bookmap SDK the
// build left out FlowSweepReplay, which the engine test uses, and the tests failed to compile. They now only run the
// Node scripts. Each is run from a copy in a temporary tree, with a `node` that records its arguments and JDK tools
// that record being called, so nothing is built and the repository's bookmap-addon/dist is never touched.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADDON = new URL("../../bookmap-addon/", import.meta.url);

async function recordingTool(directory, name, record) {
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\n`);
  await chmod(path, 0o755);
}

for (const [script, target] of [["build.sh", "build.mjs"], ["test.sh", "test.mjs"]]) {
  test(`bookmap-addon/${script} runs ${target} and compiles nothing itself`, { skip: process.platform === "win32" && "the shell scripts are for macOS and Linux" }, async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "bookmap-wrapper-")));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, "bin");
    const jdk = join(root, "jdk", "bin");
    await mkdir(join(root, "bookmap-addon"));
    await mkdir(bin);
    await mkdir(jdk, { recursive: true });
    const copy = join(root, "bookmap-addon", script);
    await copyFile(new URL(script, ADDON), copy);
    await chmod(copy, 0o755);
    const nodeArguments = join(root, "node-arguments");
    await recordingTool(bin, "node", nodeArguments);
    // JDK tools both where JAVA_21_HOME points and on PATH, so a script that compiled anything would be seen.
    for (const tool of ["javac", "java", "jar", "javap"]) {
      await recordingTool(jdk, tool, join(root, `called-${tool}`));
      await recordingTool(bin, tool, join(root, `called-${tool}`));
    }
    const run = spawnSync(copy, ["--extra"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, JAVA_21_HOME: join(root, "jdk"), BOOKMAP_HOME: join(root, "no-bookmap") },
    });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    assert.deepEqual((await readFile(nodeArguments, "utf8")).split("\n").filter(Boolean), [join(root, "bookmap-addon", target), "--extra"]);
    for (const tool of ["javac", "java", "jar", "javap"]) {
      await assert.rejects(readFile(join(root, `called-${tool}`)), { code: "ENOENT" }, `${script} called ${tool}`);
    }
  });
}
