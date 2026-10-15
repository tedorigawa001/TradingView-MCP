import { createHash } from "node:crypto";
import { constants, createReadStream, lstatSync, rmSync, unlinkSync, type Stats } from "node:fs";
import { link, lstat, mkdtemp, open, readdir, readFile, realpath, rm, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";

/**
 * Persist a newly-created directory entry where the host exposes directory
 * fsync. Windows cannot open directories through Node's fs API, while the file
 * handle itself is still synced by each caller before reaching this helper.
 */
/**
 * O_NOFOLLOW where the host defines it, and zero where it does not.
 *
 * Node does not define O_NOFOLLOW on Windows, so `constants.O_RDONLY |
 * constants.O_NOFOLLOW` evaluates there to `O_RDONLY | undefined`, which
 * JavaScript reduces to plain O_RDONLY. The symlink protection disappears with
 * no error raised and nothing in the call site admitting it. This changes what
 * no platform does - it gives the loss a name, so it is visible at every call
 * and a test can hold it in place.
 */
export function noFollowFlag(platform = process.platform): number {
  return platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
}

/**
 * Whether a stat mode can be read as an access decision on this host.
 *
 * Windows has no POSIX mode. Node synthesises one from the read-only attribute,
 * so `mode & 0o077` there describes nothing and rejecting on it refuses every
 * directory the process itself just created - which is exactly what happened:
 * about 150 tests failed on windows-latest for directories that were fine.
 *
 * Returning false is not a relaxation of the Unix checks, which are untouched.
 * It says the question cannot be asked here. On Windows access is an NTFS ACL
 * matter this process cannot evaluate, which is why the security review
 * requires evidence to sit under an owner-restricted profile and records that
 * as a residual risk rather than an equivalent guarantee.
 */
export function posixModeEnforced(platform = process.platform): boolean {
  return platform !== "win32";
}

/**
 * Refuse a path that is a symbolic link, on every platform.
 *
 * O_NOFOLLOW does this on POSIX and does not exist on Windows, so a store that
 * relied on the flag alone followed links there silently. Checking explicitly
 * keeps the guarantee instead of documenting its loss.
 *
 * This is a check and then an open, so a replacement between the two is a
 * residual local same-user race - the same one the security review already
 * records for the Bookmap reader. It is narrower than O_NOFOLLOW, which is why
 * the flag is still passed wherever the host has it.
 */
export async function assertNotSymbolicLink(path: string, label: string): Promise<void> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} path must be a regular file, not a symbolic link`);
}

/**
 * Create a new owner-only file without following an existing symbolic link.
 *
 * O_EXCL alone does not reject a dangling symlink on Windows. Keep the explicit
 * lstat check and the host O_NOFOLLOW flag together so every exclusive-create
 * call site has the same fail-closed behavior.
 */
export async function openExclusiveFile(path: string, label: string): Promise<FileHandle> {
  await assertNotSymbolicLink(path, label);
  return open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(), 0o600);
}

/**
 * Whether creating, opening or inspecting a lock file may have failed because Windows is still deleting it (BACKLOG
 * 102-39). Windows can keep a deleted file's name while a handle to it is open, the deleting one or another, and
 * meanwhile refuses to create or open a file under that name with ERROR_ACCESS_DENIED, which Node reports as EPERM.
 * The same code also means a real denial, which is why attemptLockFile looks at the path before reading it as a lock
 * being released. Off Windows it keeps its meaning.
 */
export function lockBeingReleased(error: unknown, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && (error as NodeJS.ErrnoException | null)?.code === "EPERM";
}

/**
 * What one attempt of a lock loop at its lock file found (see attemptLockFile). Unless it is `taken`, the caller waits,
 * within its deadline, and names `refusal` as the cause if the deadline passes.
 */
export type LockFileAttempt =
  | { taken: true }
  | { taken: false; held: Stats | null; refusal: NodeJS.ErrnoException | null };

/**
 * One attempt of a lock loop to take its lock file: create it exclusively and write `contents` to it (BACKLOG 102-39).
 * Unless it is `taken`, `held` is the lstat of a lock file found there, for the caller to check (unsafe path, stale
 * owner), and `refusal` the Windows EPERM met on the way: at the create while a lock file is there, or at the lstat,
 * when the lock file found cannot even be inspected and `held` is null as it is being deleted.
 *
 * A create refused with no lock file there may have met a deletion that finished in between, so it is tried again
 * once; refused again with still no lock file, the refusal is real and is thrown. A lock gone between EEXIST and the
 * lstat is tried again once at once; gone again, the attempt comes back with neither, to be waited on like the rest.
 * If writing the new lock fails, it is removed, if it is still the one created here, and the error thrown: a lock file
 * left behind would be waited on, and a failed write is no sign of another owner.
 */
export async function attemptLockFile(path: string, label: string, contents: string): Promise<LockFileAttempt> {
  let refusedWithoutLock = false;
  let vanished = false;
  while (true) {
    let handle: FileHandle;
    try {
      handle = await openExclusiveFile(path, label);
    } catch (error) {
      const refused = lockBeingReleased(error);
      if (!refused && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        return { taken: false, held: await lstat(path), refusal: refused ? error as NodeJS.ErrnoException : null };
      } catch (inspectError) {
        if (lockBeingReleased(inspectError)) {
          return { taken: false, held: null, refusal: inspectError as NodeJS.ErrnoException };
        }
        if ((inspectError as NodeJS.ErrnoException).code !== "ENOENT") throw inspectError;
      }
      if (refused) {
        if (refusedWithoutLock) throw error;
        refusedWithoutLock = true;
      } else {
        if (vanished) return { taken: false, held: null, refusal: null };
        vanished = true;
      }
      continue;
    }
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
    } catch (error) {
      const created = await handle.stat().catch(() => null);
      await handle.close().catch(() => undefined);
      // A write stalled long enough for another process to reclaim the lock must not take that process's lock away.
      const current = await lstat(path).catch(() => null);
      if (created && current && current.ino === created.ino && current.dev === created.dev) {
        await unlink(path).catch(() => undefined);
      }
      throw error;
    }
    return { taken: true };
  }
}

export async function syncDirectoryEntry(directory: string, platform = process.platform): Promise<void> {
  if (platform === "win32") return;
  const handle = await open(directory, constants.O_RDONLY | noFollowFlag(platform));
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Syncs an append-only journal file and, where the host allows it, its directory, before an identical retry is
 * acknowledged: an earlier append may have written its complete bytes and then failed either fsync. Each path must be
 * a regular file or directory, not a symbolic link, the same one when opened, owned by the current user and, where
 * POSIX modes are enforced, owner-only. Windows cannot open directories, so there only the file is synced.
 */
export async function syncJournalForRetry(filePath: string, label: string, platform = process.platform): Promise<void> {
  const paths = [{ path: filePath, directory: false }];
  if (platform !== "win32") paths.push({ path: dirname(filePath), directory: true });
  for (const { path, directory } of paths) {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !(directory ? before.isDirectory() : before.isFile())) {
      throw new Error(`${label} retry sync path has unsafe file type`);
    }
    const handle = await open(path, (directory ? constants.O_RDONLY : constants.O_RDWR)
      | noFollowFlag(platform) | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = await handle.stat();
      if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.dev !== before.dev || stat.ino !== before.ino) {
        throw new Error(`${label} retry sync path changed while opening`);
      }
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error(`${label} retry sync path must be owned by the current user`);
      }
      if (posixModeEnforced(platform) && (stat.mode & 0o077) !== 0) {
        throw new Error(`${label} retry sync permissions must be owner-only`);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

/**
 * Publishes `body` at `destination` as a new file and never replaces one already there (BACKLOG 102-25). The file is
 * written and synced in a fresh directory beside the destination and hard-linked into place, which fails if the name
 * is taken, so the destination never holds a partial file and a run that fails before the link leaves whatever was
 * there as it was; one whose directory sync fails after the link reports the failure with the new file in place. When
 * the name is taken, before staging or when the link finds it taken, the file there is compared with `body`:
 * "identical" when it holds the same bytes, "different" otherwise, both left as they are for the caller to judge, and
 * a symbolic link there is refused rather than followed. "identical" is reported only once the file and its directory
 * entry are synced as a new one's are, since the file may be one an earlier run linked into place before its directory
 * sync failed, or one written without a sync; a sync that fails is thrown. Windows flushes neither a directory nor a
 * file opened only for reading, so there "identical" syncs nothing. The destination's directory is resolved first, so
 * it may itself be reached through a symbolic link (/tmp on macOS), as it could be when the file was simply written.
 * The staging directory is removed when the run ends, as a best effort that never changes the result: a run killed
 * meanwhile, or a removal that fails (Windows refuses to delete a file another process holds open), leaves a
 * `.publish-*` directory beside the destination.
 */
export async function publishImmutableFile(
  destination: string,
  body: string | Buffer,
  label: string,
): Promise<"created" | "identical" | "different"> {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  // The destination must name a file: resolving the directory would otherwise turn "name/" into a file "name", and "",
  // "." or ".." into a look at a directory.
  const name = basename(destination);
  if (name === "" || name === "." || name === ".." || destination.endsWith(sep) || destination.endsWith("/")) {
    throw new Error(`${label} path must name a file: ${JSON.stringify(destination)}`);
  }
  const directory = await realpath(dirname(destination));
  const target = join(directory, basename(destination));
  // A re-run that finds its file needs no staging, so it can confirm evidence in a directory made read-only.
  const found = await settleExistingFile(target, directory, bytes, label);
  if (found !== null) return found;
  const staging = await mkdtemp(join(directory, ".publish-"));
  try {
    const staged = join(staging, "file");
    const handle = await openExclusiveFile(staged, label);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    for (let attempt = 1; ; attempt += 1) {
      try {
        await link(staged, target);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const settled = await settleExistingFile(target, directory, bytes, label);
        if (settled !== null) return settled;
        // Gone again between the link and the look: once is a removal racing this run, twice is a path in flux.
        if (attempt === 2) throw new Error(`${label} path kept changing while it was being published; nothing was published`);
      }
    }
    await syncDirectoryEntry(directory);
    return "created";
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

/** A staging directory of publishImmutableFiles older than this is removed by the next run of the same stem, whatever its pid. */
const STALE_STAGING_MS = 24 * 60 * 60 * 1000;

/** The stem in a staging directory's name: the characters a file name can safely carry, at most 64 of them. */
const stagingStem = (stem: string) => stem.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "files";

/** Whether a process with this id exists: signal 0 checks without sending anything (EPERM: it exists, as another user). */
function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * Removes, from `directory`, the staging directories `.publish-<stem>-<pid>-XXXXXX` that publishImmutableFiles runs of the
 * same stem left behind when they were killed (BACKLOG 103-10 review 2): those whose process is gone, and those older
 * than a day. A directory of a live run of the same stem, of another stem, or of any other name is never touched.
 */
async function removeStaleStagings(directory: string, stem: string): Promise<void> {
  const pattern = new RegExp(`^\\.publish-${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)-[A-Za-z0-9]{6}$`);
  let names: string[];
  try { names = await readdir(directory); } catch { return; }
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    const path = join(directory, name);
    const entry = await lstat(path).catch(() => null);
    if (!entry?.isDirectory()) continue;
    if (processAlive(Number(match[1])) && Date.now() - entry.mtimeMs < STALE_STAGING_MS) continue;
    await rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Publishes several new immutable files together, all of them or none (BACKLOG 103-10 review): publishImmutableFile for
 * a set, on the same primitives. The bytes of each destination are asked for in turn, so only one file's bytes are held
 * at once. A destination already holding exactly those bytes is "identical" (synced as publishImmutableFile syncs it);
 * one holding other bytes, or anything but a regular file, is "different"; a symbolic link there is refused. The bytes
 * of a new destination are written to a staging file and synced, in a directory `.publish-<stem>-<pid>-XXXXXX` beside
 * it; a run first removes such directories that runs of the same stem left when they were killed (removeStaleStagings).
 * Nothing is linked into place before every destination is staged or found identical: when bytesOf fails, or a
 * destination is "different", the staging files are removed and nothing is written. Once one destination is
 * "different", only destinations that already exist are still compared, so that every different one is returned.
 *
 * Then the staged files are linked to their destinations, the first destination last: the others are linked and their
 * directories synced, the destinations found identical are checked to be so still, and only then is the first one
 * linked and synced, so the first destination there means the set was whole when it was written. A link that fails (a
 * destination taken meanwhile by other bytes, a denied or full directory) removes again every file this run linked,
 * each checked to be the staged file, and the error says so; destinations found identical were not written by it. A
 * SIGINT or SIGTERM during the run removes what it linked and its staging directories, then takes its usual course.
 * A crash or power loss while linking can still leave some destinations without the first. The staging directories
 * are removed when the run ends, as a best effort.
 */
export async function publishImmutableFiles(
  destinations: readonly string[],
  bytesOf: (index: number) => Promise<string | Buffer>,
  label: string,
  options: { stem?: string } = {},
): Promise<{ published: true; results: ("created" | "identical")[] } | { published: false; different: string[] }> {
  const targets: { destination: string; directory: string; target: string }[] = [];
  for (const destination of destinations) {
    const name = basename(destination);
    if (name === "" || name === "." || name === ".." || destination.endsWith(sep) || destination.endsWith("/")) {
      throw new Error(`${label} path must name a file: ${JSON.stringify(destination)}`);
    }
    const directory = await realpath(dirname(destination));
    targets.push({ destination, directory, target: join(directory, name) });
  }
  if (new Set(targets.map((item) => item.target)).size !== targets.length) throw new Error(`${label} paths must be distinct`);
  const stem = stagingStem(options.stem ?? basename(destinations[0] ?? "files").replace(/\.[^.]*$/, ""));
  const directories = [...new Set(targets.map((item) => item.directory))];
  for (const directory of directories) await removeStaleStagings(directory, stem);
  const stagings = new Map<string, string>();
  const staged: (string | null)[] = [];
  const results: ("created" | "identical" | null)[] = [];
  const identical = new Map<number, string>();
  const different: string[] = [];
  const created: { destination: string; target: string; file: string }[] = [];
  /** Unlinks what this run linked, each only while it is still the staged file; synchronous, so a signal handler can use it. */
  const unlinkCreated = () => {
    const removed: string[] = [], left: string[] = [];
    for (const { destination, target, file } of created.splice(0)) {
      try {
        const [placed, ours] = [lstatSync(target), lstatSync(file)];
        if (placed.dev === ours.dev && placed.ino === ours.ino) { unlinkSync(target); removed.push(destination); } else left.push(destination);
      } catch { left.push(destination); }
    }
    return { removed, left };
  };
  const onSignal = (signal: NodeJS.Signals) => {
    unlinkCreated();
    for (const staging of stagings.values()) { try { rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ } }
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);
  try {
    try {
      for (const [index, { destination, directory, target }] of targets.entries()) {
        staged.push(null); results.push(null);
        let entry: Stats | null;
        try { entry = await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; entry = null; }
        if (entry?.isSymbolicLink()) throw new Error(`${label} path must be a regular file, not a symbolic link: ${destination}`);
        if (different.length > 0 && entry === null) continue;
        const raw = await bytesOf(index);
        const bytes = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
        const found = entry === null ? null : await settleExistingFile(target, directory, bytes, label);
        if (found === "different") { different.push(destination); continue; }
        if (found === "identical") { results[index] = "identical"; identical.set(index, createHash("sha256").update(bytes).digest("hex")); continue; }
        if (different.length > 0) continue;
        let staging = stagings.get(directory);
        if (staging === undefined) { staging = await mkdtemp(join(directory, `.publish-${stem}-${process.pid}-`)); stagings.set(directory, staging); }
        const file = join(staging, String(index));
        const handle = await openExclusiveFile(file, label);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        staged[index] = file;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.endsWith("nothing was written") ? message : `${message}; nothing was written`, { cause: error });
    }
    if (different.length > 0) return { published: false, different };
    const linkOne = async (index: number) => {
      const { destination, directory, target } = targets[index], file = staged[index]!;
      for (let attempt = 1; ; attempt += 1) {
        try {
          await link(file, target);
          created.push({ destination, target, file }); results[index] = "created";
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const settled = await settleExistingFile(target, directory, await readFile(file), label);
          if (settled === "identical") { results[index] = "identical"; return; }
          if (settled === "different") throw new Error(`${label} path ${destination} was taken by a different file while the files were published`);
          if (attempt === 2) throw new Error(`${label} path ${destination} kept changing while it was being published`);
        }
      }
    };
    try {
      for (const [index, file] of staged.entries()) if (index > 0 && file !== null) await linkOne(index);
      for (const directory of directories) await syncDirectoryEntry(directory);
      for (const [index, digest] of identical) {
        const { destination, target } = targets[index];
        const entry = await lstat(target).catch(() => null);
        if (!entry?.isFile() || await fileDigest(target) !== digest) throw new Error(`${label} path ${destination} changed after it was found identical`);
      }
      if (staged[0] !== null && staged[0] !== undefined) {
        await linkOne(0);
        await syncDirectoryEntry(targets[0].directory);
      }
    } catch (error) {
      const { removed, left } = unlinkCreated();
      for (const directory of directories) await syncDirectoryEntry(directory).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      const verb = (list: string[]) => (list.length === 1 ? "was" : "were");
      const outcome = left.length > 0 ? `${left.join(", ")} ${verb(left)} written and could not be removed` : "nothing was written";
      throw new Error(`${message}; ${outcome}${removed.length > 0 ? ` (${removed.join(", ")} ${verb(removed)} linked and removed again)` : ""}`, { cause: error });
    }
    return { published: true, results: results as ("created" | "identical")[] };
  } finally {
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
    for (const staging of stagings.values()) await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

/**
 * What is already at `path`: null when nothing is, "different" when it is not a regular file holding exactly `bytes`,
 * and "identical" once it and its directory entry are synced. The file is opened without blocking (a FIFO swapped in
 * after the lstat must not hang the run) and checked to be the file the lstat saw. It is opened only for reading, which
 * Windows cannot flush (FlushFileBuffers needs a handle open for writing), so there it is left as syncDirectoryEntry
 * leaves a directory.
 */
async function settleExistingFile(
  path: string,
  directory: string,
  bytes: Buffer,
  label: string,
  platform = process.platform,
): Promise<"identical" | "different" | null> {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (entry.isSymbolicLink()) throw new Error(`${label} path must be a regular file, not a symbolic link`);
  if (!entry.isFile() || entry.size !== bytes.length) return "different";
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | noFollowFlag(platform) | (platform === "win32" ? 0 : constants.O_NONBLOCK));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    // A symbolic link swapped in after the lstat, refused by O_NOFOLLOW.
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new Error(`${label} path changed while it was being compared; nothing was published`);
    throw error;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== entry.ino || opened.dev !== entry.dev) {
      throw new Error(`${label} path changed while it was being compared; nothing was published`);
    }
    if (!(await handle.readFile()).equals(bytes)) return "different";
    if (platform !== "win32") await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectoryEntry(directory, platform);
  return "identical";
}

/**
 * Refuses to append to a JSONL file whose last line has no newline (BACKLOG 102-08). A reader that trims the text takes
 * such a line as a whole record, but an append joins the next record onto it ("}{") and every later read of the file
 * fails, while the append itself reported success. The line may also be the cut-off end of an earlier write, which
 * only someone looking at the file can settle, so nothing is written, the file is left as it is, and the error names
 * the file and how to settle it. `handle` must be open for reading as well as appending (O_RDWR | O_APPEND, or "a+"),
 * and `size` is its size from fstat.
 */
export async function assertAppendableJsonl(handle: FileHandle, size: number, label: string, path: string): Promise<void> {
  if (size === 0) return;
  const last = Buffer.alloc(1);
  const { bytesRead } = await handle.read(last, 0, 1, size - 1);
  if (bytesRead !== 1 || last[0] !== 0x0a) {
    throw new Error(`${label} file does not end with a newline, so its last line may be incomplete; nothing was appended: ${path}. ` +
      "If that line is a complete record, end it with a newline; if it was cut off, remove it.");
  }
}
