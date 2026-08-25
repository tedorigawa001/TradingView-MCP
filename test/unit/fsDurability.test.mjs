import assert from "node:assert/strict";
import test from "node:test";
import { lstat, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noFollowFlag, openExclusiveFile, posixModeEnforced, syncDirectoryEntry } from "../../build/fsDurability.js";

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
