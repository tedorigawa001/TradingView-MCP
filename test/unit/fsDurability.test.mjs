import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
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
  await writeFile(paths[0], "file 0\n");   // already there, identical
  // Another writer puts other bytes at the third destination after it was found free and staged. The second was linked
  // before it and is removed again; the first, found identical, was not written by this run and stays.
  const takeThird = async () => { await writeFile(paths[2], "theirs\n"); return "file 2\n"; };
  await assert.rejects(() => publishImmutableFiles(paths, bodies({ 2: takeThird }), "test set"),
    (error) => error.message === `test set path ${paths[2]} was taken by a different file while the files were published; nothing was written (${paths[1]} was linked and removed again)`);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, "utf8").catch(() => null))), ["file 0\n", null, "theirs\n", null]);
  assert.deepEqual(await staging(), []);
  // A file found identical that changes before the set is complete stops it the same way.
  const changing = await publishSet(["a.json", "b.json"]);
  await writeFile(changing.paths[0], "file 0\n");
  const changeFirst = async () => { await writeFile(changing.paths[0], "file 0, changed\n"); return "file 1\n"; };
  await assert.rejects(() => publishImmutableFiles(changing.paths, changing.bodies({ 1: changeFirst }), "test set"),
    (error) => error.message === `test set path ${changing.paths[0]} changed after it was found identical; nothing was written (${changing.paths[1]} was linked and removed again)`);
  assert.equal(await absent(changing.paths[1]), true);
  // Taken by the same bytes, it is identical.
  const same = await publishSet(["a.json", "b.json"]);
  const sameBytes = async () => { await writeFile(same.paths[1], "file 1\n"); return "file 1\n"; };
  assert.deepEqual(await publishImmutableFiles(same.paths, same.bodies({ 1: sameBytes }), "test set"), { published: true, results: ["created", "identical"] });
});

test("publishImmutableFiles links the first destination last, and removes what it linked when a link is refused", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("needs POSIX permissions and a non-root user"); return; }
  const base = await mkdtemp(join(tmpdir(), "tv-mcp-publish-order-"));
  const [open, closed] = [join(base, "open"), join(base, "closed")];
  await mkdir(open); await mkdir(closed);
  t.after(async () => { await chmod(closed, 0o700).catch(() => undefined); await rm(base, { recursive: true, force: true }); });
  // The first destination is in a directory that refuses new entries by the time the files are linked: the others,
  // linked before it, are removed again.
  const paths = [join(closed, "set.part01.json"), join(open, "set.part02.json"), join(open, "set.part03.json")];
  const bytesOf = async (index) => { if (index === 2) await chmod(closed, 0o500); return `part ${index + 1}\n`; };
  await assert.rejects(() => publishImmutableFiles(paths, bytesOf, "test set"), (error) => /EACCES|permission denied/i.test(error.message)
    && error.message.endsWith(`; nothing was written (${paths[1]}, ${paths[2]} were linked and removed again)`));
  assert.deepEqual(await Promise.all(paths.map(absent)), [true, true, true]);
  assert.deepEqual((await readdir(open)).filter((name) => name.startsWith(".publish-")), []);
});

test("publishImmutableFiles removes the staging directories that killed runs of the same stem left, and no others", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-stale-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A process that has ended: its pid is free (and, for the test's few milliseconds, not reused).
  const ended = spawn(process.execPath, ["-e", ""]);
  await once(ended, "exit");
  const names = {
    dead: `.publish-set-${ended.pid}-abc123`, live: `.publish-set-${process.pid}-def456`, old: `.publish-set-${process.pid}-ghi789`,
    otherStem: `.publish-other-${ended.pid}-jkl012`, otherShape: `.publish-set-${ended.pid}-mno3456`, single: ".publish-pqr678",
  };
  for (const name of Object.values(names)) { await mkdir(join(directory, name)); await writeFile(join(directory, name, "0"), "staged\n"); }
  const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await utimes(join(directory, names.old), dayAgo, dayAgo);
  const result = await publishImmutableFiles([join(directory, "set.part01.json")], async () => "part 1\n", "test set", { stem: "set" });
  assert.deepEqual(result, { published: true, results: ["created"] });
  assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith(".publish-")).sort(),
    [names.live, names.otherShape, names.otherStem, names.single].sort());
});

test("publishImmutableFiles stopped by SIGTERM while it stages removes its staging and ends by the signal", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX signals"); return; }
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-publish-signal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const module = new URL("../../build/fsDurability.js", import.meta.url).href;
  const paths = [join(directory, "set.part01.json"), join(directory, "set.part02.json")];
  const script = `const { publishImmutableFiles } = await import(${JSON.stringify(module)});
    await publishImmutableFiles(${JSON.stringify(paths)}, async (index) => {
      if (index === 1) { process.stdout.write("staged\\n"); await new Promise(() => setInterval(() => {}, 1000)); }
      return "part " + (index + 1) + "\\n";
    }, "test set", { stem: "set" });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  await once(child.stdout, "data");
  assert.equal((await readdir(directory)).filter((name) => name.startsWith(`.publish-set-${child.pid}-`)).length, 1);
  child.kill("SIGTERM");
  const [code, signal] = await once(child, "exit");
  assert.deepEqual([code, signal], [null, "SIGTERM"]);
  assert.deepEqual(await readdir(directory), []);
});
