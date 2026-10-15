import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { constants } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noFollowFlag, openExclusiveFile, posixModeEnforced, publishImmutableFiles, syncDirectoryEntry } from "../../build/fsDurability.js";

test("directory durability remains available on Unix and is an explicit no-op on Windows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-durability-"));
  await syncDirectoryEntry(directory, process.platform);
  await assert.doesNotReject(syncDirectoryEntry("Z:\\path-that-must-not-be-opened", "win32"));
});

test("O_NOFOLLOW is passed where the host has it and is zero where it does not", () => {
  // This branch returns a constant of the HOST, not of the platform being asked
  // about, so it can only answer what the host defines. Windows defines nothing,
  // which is the premise the helper rests on, so that is what is asserted there.
  if (process.platform === "win32") {
    assert.equal(constants.O_NOFOLLOW, undefined, "Windows is expected not to define O_NOFOLLOW");
  } else {
    assert.ok(constants.O_NOFOLLOW > 0, "a POSIX host must define O_NOFOLLOW for the rest to mean anything");
    assert.equal(noFollowFlag("darwin"), constants.O_NOFOLLOW);
    assert.equal(noFollowFlag("linux"), constants.O_NOFOLLOW);
  }

  // Zero on Windows, deliberately. Node does not define O_NOFOLLOW there, so the
  // previous `constants.O_RDONLY | constants.O_NOFOLLOW` reduced to O_RDONLY and
  // the symlink protection vanished silently. It still vanishes - it cannot do
  // otherwise - but now it says so, and a change of mind has to fail here first.
  assert.equal(noFollowFlag("win32"), 0);

  // Combining is what call sites do, so pin that the combination is untouched
  // off Windows and is a plain open flag on it.
  if (process.platform !== "win32") {
    assert.equal(constants.O_RDONLY | noFollowFlag("darwin"), constants.O_RDONLY | constants.O_NOFOLLOW);
  }
  assert.equal(constants.O_RDONLY | noFollowFlag("win32"), constants.O_RDONLY);
});

test("no evidence store passes O_NOFOLLOW unconditionally any more", async () => {
  // The helper is only worth having if nothing bypasses it. A new call site
  // written the old way would compile and pass every other test.
  const directory = new URL("../../src/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".ts") && name !== "fsDurability.ts");
  const offenders = [];
  for (const name of files) {
    const source = await readFile(new URL(name, directory), "utf8");
    if (source.includes("constants.O_NOFOLLOW")) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `these still use constants.O_NOFOLLOW directly: ${offenders.join(", ")}`);
});

test("all exclusive file creation goes through the shared symlink guard", async () => {
  const directory = new URL("../../src/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".ts") && name !== "fsDurability.ts");
  const offenders = [];
  for (const name of files) {
    const source = await readFile(new URL(name, directory), "utf8");
    if (source.includes("O_EXCL")) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `exclusive create bypasses openExclusiveFile: ${offenders.join(", ")}`);
});

test("openExclusiveFile creates once and explicitly refuses existing and dangling symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-exclusive-"));

  const createdPath = join(directory, "created.lock");
  const created = await openExclusiveFile(createdPath, "test exclusive file");
  try {
    await created.writeFile("owner\n", "utf8");
  } finally {
    await created.close();
  }
  assert.equal((await lstat(createdPath)).isFile(), true);

  await assert.rejects(
    openExclusiveFile(createdPath, "test exclusive file"),
    (error) => error?.code === "EEXIST",
  );

  const existingTarget = join(directory, "existing-target");
  await writeFile(existingTarget, "unchanged", "utf8");
  const existingLink = join(directory, "existing-link");
  await symlink(existingTarget, existingLink);
  await assert.rejects(
    openExclusiveFile(existingLink, "test existing symlink"),
    /test existing symlink path must be a regular file, not a symbolic link/,
  );
  assert.equal(await readFile(existingTarget, "utf8"), "unchanged");

  const missingTarget = join(directory, "missing-target");
  const danglingLink = join(directory, "dangling-link");
  await symlink(missingTarget, danglingLink);
  await assert.rejects(
    openExclusiveFile(danglingLink, "test dangling symlink"),
    /test dangling symlink path must be a regular file, not a symbolic link/,
  );
  await assert.rejects(lstat(missingTarget), (error) => error?.code === "ENOENT");
});

test("POSIX mode is enforced where it means something and not where it does not", () => {
  // Unix keeps every check it had. A group-readable directory is still refused.
  const loose = { mode: 0o755 };
  assert.equal(posixModeEnforced("darwin") && (loose.mode & 0o077) !== 0, true);
  assert.equal(posixModeEnforced("linux") && (loose.mode & 0o077) !== 0, true);

  // Windows has no POSIX mode; Node synthesises one from the read-only
  // attribute. Reading it as an access decision refused every directory the
  // process had just created, which is how CI went red for about 150 tests.
  // This does not weaken the Unix checks - it declines to ask a question the
  // platform cannot answer, and the security review carries the residual risk.
  assert.equal(posixModeEnforced("win32"), false);
  assert.equal(posixModeEnforced("win32") && (loose.mode & 0o077) !== 0, false);

  // An owner-only directory is acceptable everywhere, so the guard cannot be
  // mistaken for one that simply passes.
  const strict = { mode: 0o700 };
  assert.equal(posixModeEnforced("darwin") && (strict.mode & 0o077) !== 0, false);
});

test("no store reads a stat mode without asking whether the host has one", async () => {
  const directory = new URL("../../src/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".ts") && name !== "fsDurability.ts");
  const offenders = [];
  for (const name of files) {
    for (const line of (await readFile(new URL(name, directory), "utf8")).split("\n")) {
      if (line.includes("& 0o077") && !line.includes("posixModeEnforced")) offenders.push(`${name}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `unguarded mode checks:\n${offenders.join("\n")}`);
});

// BACKLOG 103-10 review: several immutable files, all of them or none.
async function publishSet(names) {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-set-"));
  const paths = names.map((name) => join(directory, name));
  const asked = [];
  const bodies = (overrides = {}) => async (index) => { asked.push(index); if (overrides[index]) return overrides[index](); return `file ${index}\n`; };
  const staging = async () => (await readdir(directory)).filter((name) => name.startsWith(".publish-"));
  return { directory, paths, asked, bodies, staging };
}
const absent = async (path) => (await lstat(path).catch((error) => (error.code === "ENOENT" ? null : Promise.reject(error)))) === null;

test("publishImmutableFiles writes every file once, then finds each identical", async () => {
  const { paths, asked, bodies, staging } = await publishSet(["a.json", "b.json", "c.json"]);
  assert.deepEqual(await publishImmutableFiles(paths, bodies(), "test set"), { published: true, results: ["created", "created", "created"] });
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, "utf8"))), ["file 0\n", "file 1\n", "file 2\n"]);
  assert.deepEqual(asked, [0, 1, 2], "each file's bytes are asked for once");
  assert.deepEqual(await publishImmutableFiles(paths, bodies(), "test set"), { published: true, results: ["identical", "identical", "identical"] });
  assert.deepEqual(await staging(), []);
  await assert.rejects(() => publishImmutableFiles([paths[0], paths[0]], bodies(), "test set"), /test set paths must be distinct/);
  await assert.rejects(() => publishImmutableFiles([`${paths[0]}/`], bodies(), "test set"), /test set path must name a file/);
});

test("publishImmutableFiles writes nothing when a later file fails to build or an existing one differs", async () => {
  const { paths, asked, bodies, staging } = await publishSet(["a.json", "b.json", "c.json", "d.json", "e.json"]);
  // The third fails after the first two were staged: nothing is linked, and the staging is gone.
  await assert.rejects(() => publishImmutableFiles(paths, bodies({ 2: async () => { throw new Error("page 3 is missing"); } }), "test set"), /page 3 is missing/);
  assert.deepEqual(await Promise.all(paths.map(absent)), [true, true, true, true, true]);
  assert.deepEqual(await staging(), []);
  // Other bytes at the second and fifth, a directory at the fourth: each is named, the first is not created, and once
  // one differs only what already exists is still built, to be compared (the third is not).
  await writeFile(paths[1], "other\n");
  await mkdir(paths[3]);
  await writeFile(paths[4], "other\n");
  asked.length = 0;
  assert.deepEqual(await publishImmutableFiles(paths, bodies(), "test set"), { published: false, different: [paths[1], paths[3], paths[4]] });
  assert.deepEqual([await absent(paths[0]), await absent(paths[2])], [true, true]);
  assert.deepEqual(asked, [0, 1, 3, 4]);
  assert.equal(await readFile(paths[1], "utf8"), "other\n");
  assert.deepEqual(await staging(), []);
  // A symbolic link is refused, not followed.
  const linked = await publishSet(["a.json", "b.json"]);
  await symlink(join(linked.directory, "elsewhere"), linked.paths[1]);
  await assert.rejects(() => publishImmutableFiles(linked.paths, linked.bodies(), "test set"), /test set path must be a regular file, not a symbolic link/);
  assert.equal(await absent(linked.paths[0]), true);
  assert.deepEqual(await linked.staging(), []);
});

test("publishImmutableFiles removes what it linked when a destination is taken while it links, and says which those were", async () => {
  const { paths, bodies, staging } = await publishSet(["a.json", "b.json", "c.json", "d.json"]);
  // Another writer puts other bytes at the third destination after it was found free and staged. The second was linked
  // before it and is removed again; the first is linked last, so it was never linked.
  const takeThird = (set) => async () => { await writeFile(set.paths[2], "theirs\n"); return "file 2\n"; };
  await assert.rejects(() => publishImmutableFiles(paths, bodies({ 2: takeThird({ paths }) }), "test set"),
    (error) => error.message === `test set path ${paths[2]} was taken by a different file while the files were published; nothing was written (${paths[1]} was linked and removed again)`);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, "utf8").catch(() => null))), [null, null, "theirs\n", null]);
  assert.deepEqual(await staging(), []);
  // With the first destination already there, and not this run's, nothing is removed: a first destination there means
  // a whole set, so its parts are never taken away.
  const kept = await publishSet(["a.json", "b.json", "c.json", "d.json"]);
  await writeFile(kept.paths[0], "file 0\n");
  await assert.rejects(() => publishImmutableFiles(kept.paths, kept.bodies({ 2: takeThird(kept) }), "test set"),
    (error) => error.message === `test set path ${kept.paths[2]} was taken by a different file while the files were published; ${kept.paths[1]} was written and left in place, since ${kept.paths[0]} is there and is not this run's file`);
  assert.deepEqual(await Promise.all(kept.paths.map((path) => readFile(path, "utf8").catch(() => null))), ["file 0\n", "file 1\n", "theirs\n", null]);
  assert.deepEqual(await kept.staging(), []);
  // A file found identical that changes before the set is complete stops it.
  const changing = await publishSet(["a.json", "b.json", "c.json"]);
  await writeFile(changing.paths[1], "file 1\n");
  const changeSecond = async () => { await writeFile(changing.paths[1], "file 1, changed\n"); return "file 2\n"; };
  await assert.rejects(() => publishImmutableFiles(changing.paths, changing.bodies({ 2: changeSecond }), "test set"),
    (error) => error.message === `test set path ${changing.paths[1]} changed after it was found identical; nothing was written (${changing.paths[2]} was linked and removed again)`);
  assert.deepEqual([await absent(changing.paths[0]), await absent(changing.paths[2])], [true, true]);
  // Taken by the same bytes, it is identical.
  const same = await publishSet(["a.json", "b.json"]);
  const sameBytes = async () => { await writeFile(same.paths[1], "file 1\n"); return "file 1\n"; };
  assert.deepEqual(await publishImmutableFiles(same.paths, same.bodies({ 1: sameBytes }), "test set"), { published: true, results: ["created", "identical"] });
});

test("publishImmutableFiles removes the first destination first, then the rest in reverse, when a step after its link fails", async () => {
  const { paths, bodies, staging } = await publishSet(["p1.json", "p2.json", "p3.json", "p4.json"]);
  const events = [];
  const name = (path) => path.slice(-7, -5);
  // The sync after the first destination is linked fails, as an EIO would.
  let failed = false;
  const observe = (step, path) => {
    if (step === "sync" && events.includes("link p1") && !failed) { failed = true; throw new Error("EIO: injected at the last sync"); }
    if (step !== "sync") events.push(`${step} ${name(path)}`);
  };
  await assert.rejects(() => publishImmutableFiles(paths, bodies(), "test set", { observe }),
    (error) => error.message === `EIO: injected at the last sync; nothing was written (${[paths[0], paths[3], paths[2], paths[1]].join(", ")} were linked and removed again)`);
  assert.deepEqual(events, ["link p2", "link p3", "link p4", "link p1", "unlink p1", "unlink p4", "unlink p3", "unlink p2"]);
  assert.deepEqual(await Promise.all(paths.map(absent)), [true, true, true, true]);
  assert.deepEqual(await staging(), []);
});

test("publishImmutableFiles links the first destination last, and removes what it linked when a link is refused", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("needs POSIX permissions and a non-root user"); return; }
  const base = await mkdtemp(join(tmpdir(), "tv-mcp-publish-order-"));
  const [open, closed] = [join(base, "open"), join(base, "closed")];
  await mkdir(open); await mkdir(closed);
  t.after(async () => { await chmod(closed, 0o700).catch(() => undefined); await rm(base, { recursive: true, force: true }); });
  // The first destination is in a directory that refuses new entries by the time the files are linked: the others,
  // linked before it, are removed again, the last linked first.
  const paths = [join(closed, "set.part01.json"), join(open, "set.part02.json"), join(open, "set.part03.json")];
  const bytesOf = async (index) => { if (index === 2) await chmod(closed, 0o500); return `part ${index + 1}\n`; };
  await assert.rejects(() => publishImmutableFiles(paths, bytesOf, "test set"), (error) => /EACCES|permission denied/i.test(error.message)
    && error.message.endsWith(`; nothing was written (${paths[2]}, ${paths[1]} were linked and removed again)`));
  assert.deepEqual(await Promise.all(paths.map(absent)), [true, true, true]);
  assert.deepEqual((await readdir(open)).filter((name) => name.startsWith(".publish-")), []);
});

test("publishImmutableFiles removes only this user's staging that killed runs of the same stem left, and only its numbered files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-stale-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A process that has ended: its pid is free (and, for the test's few milliseconds, not reused).
  const ended = spawn(process.execPath, ["-e", ""]);
  await once(ended, "exit");
  const names = {
    dead: `.publish-set-${ended.pid}-abc123`, live: `.publish-set-${process.pid}-def456`, old: `.publish-set-${process.pid}-ghi789`,
    otherStem: `.publish-other-${ended.pid}-jkl012`, otherShape: `.publish-set-${ended.pid}-mno3456`, single: ".publish-pqr678",
    foreignMode: `.publish-set-${ended.pid}-stu901`, foreignFile: `.publish-set-${ended.pid}-vwx234`, foreignEntry: `.publish-set-${ended.pid}-yza567`,
  };
  for (const name of Object.values(names)) { await mkdir(join(directory, name), { mode: 0o700 }); await writeFile(join(directory, name, "0"), "staged\n"); }
  const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await utimes(join(directory, names.old), dayAgo, dayAgo);
  // Shaped like a staging directory, but not one: another mode, a file it never writes, a numbered directory.
  await chmod(join(directory, names.foreignMode), 0o755);
  await writeFile(join(directory, names.foreignFile, "notes.txt"), "mine\n");
  await mkdir(join(directory, names.foreignEntry, "1"));
  const result = await publishImmutableFiles([join(directory, "set.part01.json")], async () => "part 1\n", "test set", { stem: "set" });
  assert.deepEqual(result, { published: true, results: ["created"] });
  // A stale directory is renamed (to pid 0, no process) before it is worked on; what it holds that a staging directory
  // never does stays, under that name.
  const kept = [names.live, names.otherShape, names.otherStem, names.single];
  if (process.platform !== "win32") kept.push(names.foreignMode);
  const left = (await readdir(directory)).filter((name) => name.startsWith(".publish-"));
  assert.deepEqual(left.filter((name) => !name.startsWith(".publish-set-0-")).sort(), kept.sort());
  const renamed = left.filter((name) => /^\.publish-set-0-[0-9a-f]{6}$/.test(name));
  assert.deepEqual((await Promise.all(renamed.map((name) => readdir(join(directory, name))))).map((names) => names.join()).sort(), ["1", "notes.txt"]);
  if (process.platform !== "win32") assert.deepEqual(await readdir(join(directory, names.foreignMode)), ["0"]);
});

/** A child process running publishImmutableFiles with `script`'s body; resolves with it and its first line of output. */
async function publishingChild(script) {
  const module = new URL("../../build/fsDurability.js", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `const { publishImmutableFiles } = await import(${JSON.stringify(module)});\n${script}`],
    { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  const line = async () => { while (!output.includes("\n")) await once(child.stdout, "data"); return output.split("\n")[0]; };
  return { child, line, output: () => output };
}

test("publishImmutableFiles stopped by SIGTERM while it stages removes its staging and its lock, and ends by the signal", { timeout: 60_000 }, async (t) => {
  if (process.platform === "win32") { t.skip("POSIX signals"); return; }
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-signal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = [join(directory, "set.part01.json"), join(directory, "set.part02.json")];
  const { child, line } = await publishingChild(`await publishImmutableFiles(${JSON.stringify(paths)}, async (index) => {
      if (index === 1) { process.stdout.write("staged\\n"); await new Promise(() => setInterval(() => {}, 1000)); }
      return "part " + (index + 1) + "\\n";
    }, "test set", { stem: "set" });`);
  assert.equal(await line(), "staged");
  const during = await readdir(directory);
  assert.deepEqual([during.filter((name) => name.startsWith(".publish-set-")).length, during.includes(".set.part01.json.publish-lock")], [1, true], "its staging and its lock");
  child.kill("SIGTERM");
  const [code, signal] = await once(child, "exit");
  assert.deepEqual([code, signal], [null, "SIGTERM"]);
  assert.deepEqual(await readdir(directory), []);
});

test("two publishes of the same files do not interleave: the second is refused while the first runs, and takes over after it is stopped or killed", { timeout: 60_000 }, async (t) => {
  if (process.platform === "win32") { t.skip("POSIX signals"); return; }
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-concurrent-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = [join(directory, "set.part01.json"), join(directory, "set.part02.json"), join(directory, "set.part03.json")];
  const body = async (index) => `part ${index + 1}\n`;
  const holding = () => publishingChild(`await publishImmutableFiles(${JSON.stringify(paths)}, async (index) => {
      if (index === 2) { process.stdout.write("staged\\n"); await new Promise(() => setInterval(() => {}, 1000)); }
      return "part " + (index + 1) + "\\n";
    }, "test set", { stem: "set" });`);
  // A first run holds the lock while it stages: a second is refused, writing nothing.
  const first = await holding();
  t.after(() => first.child.kill("SIGKILL"));
  assert.equal(await first.line(), "staged");
  await assert.rejects(() => publishImmutableFiles(paths, body, "test set", { stem: "set" }),
    new RegExp(`another test set of the same files is running \\(process ${first.child.pid}\\): .*\\.set\\.part01\\.json\\.publish-lock; nothing was written`));
  // Stopped, it removes its staging and its lock: the second run then writes the set.
  first.child.kill("SIGTERM");
  await once(first.child, "exit");
  assert.deepEqual(await publishImmutableFiles(paths, body, "test set", { stem: "set" }), { published: true, results: ["created", "created", "created"] });
  // Killed outright, a run leaves its lock and its staging: the next run removes both and goes on.
  for (const path of paths) await rm(path);
  const killed = await holding();
  t.after(() => killed.child.kill("SIGKILL"));
  assert.equal(await killed.line(), "staged");
  killed.child.kill("SIGKILL");
  await once(killed.child, "exit");
  const left = await readdir(directory);
  assert.deepEqual([left.includes(".set.part01.json.publish-lock"), left.some((name) => name.startsWith(`.publish-set-${killed.child.pid}-`))], [true, true]);
  assert.deepEqual(await publishImmutableFiles(paths, body, "test set", { stem: "set" }), { published: true, results: ["created", "created", "created"] });
  assert.deepEqual((await readdir(directory)).sort(), ["set.part01.json", "set.part02.json", "set.part03.json"]);
});

test("publishImmutableFiles interrupted where the host keeps its own signal listener ends with an error that it was, and writes nothing", { timeout: 60_000 }, async (t) => {
  if (process.platform === "win32") { t.skip("POSIX signals"); return; }
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const staged = [join(directory, "a.part01.json"), join(directory, "a.part02.json")];
  const linking = [join(directory, "b.part01.json"), join(directory, "b.part02.json"), join(directory, "b.part03.json")];
  const run = await publishingChild(`process.on("SIGTERM", () => {});
    const outcome = async (run) => { try { return JSON.stringify(await run()); } catch (error) { return error.message; } };
    const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
    // Interrupted while it stages.
    process.stdout.write(await outcome(() => publishImmutableFiles(${JSON.stringify(staged)}, async (index) => {
      if (index === 1) { process.kill(process.pid, "SIGTERM"); await pause(); }
      return "part " + (index + 1) + "\\n";
    }, "test set", { stem: "a" })) + "\\n");
    // Interrupted while it links: the signal arrives during the second link.
    let signalled = false;
    process.stdout.write(await outcome(() => publishImmutableFiles(${JSON.stringify(linking)}, async (index) => "part " + (index + 1) + "\\n", "test set", {
      stem: "b", observe: (step) => { if (step === "link" && !signalled) { signalled = true; } else if (step === "link") { process.kill(process.pid, "SIGTERM"); } },
    })) + "\\n");
    process.exit(0);`);
  const [code] = await once(run.child, "close");
  assert.equal(code, 0);
  const [whileStaging, whileLinking] = run.output().trim().split("\n");
  assert.equal(whileStaging, "test set was interrupted; nothing was written");
  assert.match(whileLinking, /^test set was interrupted; nothing was written/);
  // Neither left a part, a staging directory or a lock.
  assert.deepEqual(await readdir(directory), []);
});

// BACKLOG 103-10 review 4.

test("a signal while the first destination's link is in flight leaves no first destination without its set", { timeout: 120_000 }, async (t) => {
  if (process.platform === "win32") { t.skip("POSIX signals"); return; }
  // Four slow jobs fill the default thread pool, so the link queued right after the signal waits behind them: the
  // signal's removal runs first. It removes the staging files before it looks, so the queued link fails.
  for (let run = 0; run < 8; run += 1) {
    const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-inflight-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const paths = [1, 2, 3, 4].map((n) => join(directory, `set.part0${n}.json`));
    const { child } = await publishingChild(`const { pbkdf2 } = await import("node:crypto");
      await publishImmutableFiles(${JSON.stringify(paths)}, async (index) => "part " + (index + 1) + "\\n", "test set", { stem: "set", observe: (step, path) => {
        if (step === "link" && path === ${JSON.stringify(paths[0])}) {
          for (let i = 0; i < 4; i += 1) pbkdf2("x", "y", 40000, 64, "sha512", () => {});
          process.kill(process.pid, "SIGTERM");
        }
      } });`);
    t.after(() => child.kill("SIGKILL"));
    const [, signal] = await once(child, "close");
    assert.equal(signal, "SIGTERM");
    assert.deepEqual(await readdir(directory), [], `run ${run + 1}`);
  }
});

test("of two runs that find the same stale lock, only one takes it: the other's mistaken rename is put back", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-takeover-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ended = spawn(process.execPath, ["-e", ""]);
  await once(ended, "exit");
  // The first run's rename of the stale lock waits until the second has judged it stale too; the second's rename then
  // waits until the first has made its own lock, and so moves that one away instead (only real calls are reordered).
  const module = new URL("../../build/fsDurability.js", import.meta.url).href;
  const paths = [join(directory, "set.part01.json"), join(directory, "set.part02.json")];
  const lock = join(directory, ".set.part01.json.publish-lock");
  const stale = `${randomUUID()} ${ended.pid}\n`;
  await writeFile(lock, stale, { mode: 0o600 });
  const script = `import { createRequire, syncBuiltinESMExports } from "node:module";
    import { readFileSync } from "node:fs";
    const require = createRequire(import.meta.url), fsp = require("fs/promises"), realRename = fsp.rename;
    const lock = ${JSON.stringify(lock)}, stale = ${JSON.stringify(stale)};
    let renames = 0, releaseFirst;
    const bothJudged = new Promise((resolve) => { releaseFirst = resolve; });
    fsp.rename = async (from, to) => {
      const ofLock = String(from).endsWith("/.set.part01.json.publish-lock");   // the lock, by its real path
      if (ofLock && ++renames === 1) await bothJudged;
      else if (ofLock && renames === 2) {
        releaseFirst();
        for (let i = 0; i < 400; i += 1) { try { if (readFileSync(lock, "utf8") !== stale) break; } catch {} await new Promise((r) => setTimeout(r, 5)); }
      }
      return realRename(from, to);
    };
    syncBuiltinESMExports();
    const { publishImmutableFiles } = await import(${JSON.stringify(module)});
    let inside = 0, most = 0;
    const run = () => publishImmutableFiles(${JSON.stringify(paths)}, async (index) => {
      if (index === 0) { inside += 1; most = Math.max(most, inside); await new Promise((r) => setTimeout(r, 200)); inside -= 1; }
      return "part " + (index + 1) + "\\n";
    }, "test set", { stem: "set" }).then((result) => JSON.stringify(result), (error) => error.message);
    const outcomes = await Promise.all([run(), run()]);
    process.stdout.write(JSON.stringify({ outcomes, most, renames }) + "\\n");`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill("SIGKILL"));
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  await once(child, "close");
  const { outcomes, most, renames } = JSON.parse(output);
  assert.equal(renames >= 2, true, `both runs judged the lock stale and renamed what was there: ${output}`);
  assert.equal(most, 1, "only one run was ever inside the lock");
  assert.deepEqual(outcomes.filter((outcome) => outcome.startsWith("{")), [JSON.stringify({ published: true, results: ["created", "created"] })]);
  assert.equal(outcomes.filter((outcome) => /^another test set of the same files is running \(process \d+\): .*; nothing was written$/.test(outcome)).length, 1);
  assert.deepEqual((await readdir(directory)).sort(), ["set.part01.json", "set.part02.json"]);
});

test("a run whose lock was taken over, or replaced by a FIFO, stops before it links anything", { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-token-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = [join(directory, "set.part01.json"), join(directory, "set.part02.json")];
  const lock = join(directory, ".set.part01.json.publish-lock");
  const theirs = `${randomUUID()} ${process.pid}\n`;
  const takeOver = async (index) => { if (index === 1) { await rm(lock); await writeFile(lock, theirs, { mode: 0o600 }); } return `part ${index + 1}\n`; };
  await assert.rejects(() => publishImmutableFiles(paths, takeOver, "test set"), new RegExp(`test set lock .*\\.set\\.part01\\.json\\.publish-lock was taken over; nothing was written$`));
  assert.deepEqual([await absent(paths[0]), await absent(paths[1]), await readFile(lock, "utf8")], [true, true, theirs], "the other run's lock is left as it is");
  await rm(lock);
  if (process.platform === "win32") return;
  // A FIFO at the lock path neither blocks the run nor passes for its lock.
  const fifo = async (index) => { if (index === 1) { await rm(lock); execFileSync("/usr/bin/mkfifo", [lock]); } return `part ${index + 1}\n`; };
  await assert.rejects(() => publishImmutableFiles(paths, fifo, "test set"), /was taken over; nothing was written$/);
  assert.deepEqual([await absent(paths[0]), (await lstat(lock)).isFIFO()], [true, true]);
  await rm(lock);
  // Found at the start, it is refused.
  execFileSync("/usr/bin/mkfifo", [lock]);
  await assert.rejects(() => publishImmutableFiles(paths, async (index) => `part ${index + 1}\n`, "test set"), /test set lock path is not a regular file: .*; nothing was written$/);
});

test("when the first destination cannot be removed, or its directory not synced, the removal stops and the set stays whole", async () => {
  const unlinkFails = await publishSet(["p1.json", "p2.json", "p3.json"]);
  let linkedFirst = false;
  const failUnlink = (step, path) => {
    if (step === "link" && path === unlinkFails.paths[0]) linkedFirst = true;
    else if (step === "sync" && linkedFirst) { linkedFirst = false; throw new Error("EIO: injected at the last sync"); }
    else if (step === "unlink" && path === unlinkFails.paths[0]) throw new Error("EPERM: injected at the removal");
  };
  await assert.rejects(() => publishImmutableFiles(unlinkFails.paths, unlinkFails.bodies(), "test set", { observe: failUnlink }),
    (error) => error.message === `EIO: injected at the last sync; the set stays published: removing ${unlinkFails.paths[0]} failed (EPERM: injected at the removal), so `
      + `${[unlinkFails.paths[0], unlinkFails.paths[2], unlinkFails.paths[1]].join(", ")} were left in place`);
  assert.deepEqual(await Promise.all(unlinkFails.paths.map(absent)), [false, false, false]);
  const syncFails = await publishSet(["p1.json", "p2.json", "p3.json"]);
  let syncs = 0, firstLinked = false;
  const failSyncs = (step, path) => {
    if (step === "link" && path === syncFails.paths[0]) firstLinked = true;
    else if (step === "sync" && firstLinked && ++syncs <= 2) throw new Error(`EIO: injected at sync ${syncs}`);
  };
  await assert.rejects(() => publishImmutableFiles(syncFails.paths, syncFails.bodies(), "test set", { observe: failSyncs }),
    (error) => error.message === `EIO: injected at sync 1; the removal stopped: ${syncFails.paths[0]} was unlinked but syncing its directory failed (EIO: injected at sync 2), so `
      + `${[syncFails.paths[2], syncFails.paths[1]].join(", ")} were left in place (${syncFails.paths[0]} was linked and removed again)`);
  assert.deepEqual(await Promise.all(syncFails.paths.map(absent)), [true, false, false]);
});

test("the lock is named by the first destination's exact name: other names do not share it, and a long name is hashed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-lockname-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const parts = (stem) => [1, 2].map((n) => join(directory, `${stem}.part0${n}.json`));
  // "FX export" and "FX_export" make the same staging stem, but are other files: their exports run side by side.
  let locks;
  const first = publishImmutableFiles(parts("FX export"), async (index) => {
    if (index === 0) { locks = (await readdir(directory)).filter((name) => name.endsWith(".publish-lock")); await new Promise((r) => setTimeout(r, 150)); }
    return `a ${index}\n`;
  }, "test set", { stem: "FX export" });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(await publishImmutableFiles(parts("FX_export"), async (index) => `b ${index}\n`, "test set", { stem: "FX_export" }), { published: true, results: ["created", "created"] });
  assert.deepEqual(await first, { published: true, results: ["created", "created"] });
  assert.deepEqual(locks, [".FX export.part01.json.publish-lock"]);
  // Where the file system takes two names for one file, they take one lock too.
  const nfc = "デ".normalize("NFC"), nfd = "デ".normalize("NFD");
  await writeFile(join(directory, `${nfc}.probe`), "");
  if (!(await absent(join(directory, `${nfd}.probe`)))) {
    const slow = publishImmutableFiles(parts(nfc), async (index) => { if (index === 0) await new Promise((r) => setTimeout(r, 150)); return `c ${index}\n`; }, "test set");
    await new Promise((r) => setTimeout(r, 30));
    await assert.rejects(() => publishImmutableFiles(parts(nfd), async (index) => `c ${index}\n`, "test set"), /another test set of the same files is running/);
    assert.deepEqual(await slow, { published: true, results: ["created", "created"] });
  }
  // A name whose lock would be longer than a file name may be is hashed.
  const long = `${"x".repeat(236)}.part01.json`;
  let hashed;
  await publishImmutableFiles([join(directory, long)], async () => {
    hashed = (await readdir(directory)).filter((name) => name.endsWith(".publish-lock"));
    return "long\n";
  }, "test set");
  assert.deepEqual(hashed, [`.${createHash("sha256").update(long).digest("hex")}.publish-lock`]);
});

test("a re-run over a whole set in a directory that denies the lock confirms it without writing", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("needs POSIX permissions and a non-root user"); return; }
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-readonly-"));
  t.after(async () => { await chmod(directory, 0o700); await rm(directory, { recursive: true, force: true }); });
  const paths = [1, 2, 3].map((n) => join(directory, `set.part0${n}.json`));
  for (const [index, path] of paths.entries()) await writeFile(path, `part ${index + 1}\n`);
  await chmod(directory, 0o555);
  const body = async (index) => `part ${index + 1}\n`;
  assert.deepEqual(await publishImmutableFiles(paths, body, "test set"), { published: true, results: ["identical", "identical", "identical"] });
  assert.deepEqual(await publishImmutableFiles(paths, async (index) => (index === 1 ? "other\n" : body(index)), "test set"), { published: false, different: [paths[1]] });
  await chmod(directory, 0o700); await rm(paths[2]); await chmod(directory, 0o555);
  const missing = paths[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await assert.rejects(() => publishImmutableFiles(paths, body, "test set"),
    new RegExp(`test set cannot take its lock in .* \\(EACCES\\), and ${missing} is not there to be confirmed; nothing was written$`));
  assert.deepEqual((await readdir(directory)).sort(), ["set.part01.json", "set.part02.json"]);
});

test("a lock that names no process is another run's for a minute, then taken over", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-ownerless-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = [join(directory, "set.part01.json"), join(directory, "set.part02.json")];
  const lock = join(directory, ".set.part01.json.publish-lock");
  const body = async (index) => `part ${index + 1}\n`;
  for (const contents of ["", `${randomUUID()} `]) {
    await writeFile(lock, contents, { mode: 0o600 });
    await assert.rejects(() => publishImmutableFiles(paths, body, "test set"), /another test set of the same files is running \(its lock names no process yet\): .*; nothing was written$/);
    const twoMinutesAgo = new Date(Date.now() - 120_000);
    await utimes(lock, twoMinutesAgo, twoMinutesAgo);
    assert.deepEqual((await publishImmutableFiles(paths, body, "test set")).published, true);
    assert.deepEqual((await readdir(directory)).sort(), ["set.part01.json", "set.part02.json"]);
  }
});
