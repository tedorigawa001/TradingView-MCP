import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readdirSync, readSync, rmdirSync, unlinkSync, type BigIntStats, type Stats } from "node:fs";
import { link, lstat, mkdtemp, open, readdir, readFile, realpath, rename, unlink } from "node:fs/promises";
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
 * O_NONBLOCK where the host has it, and zero on Windows (BACKLOG 103-11). A read-only open of a FIFO waits for a writer;
 * with this flag it returns at once, so the regular-file check after it can refuse the FIFO instead of hanging the
 * reader (and any lock it holds) forever. It changes nothing for a regular file.
 */
export function nonBlockingFlag(platform = process.platform): number {
  return platform === "win32" ? 0 : (constants.O_NONBLOCK ?? 0);
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
 * Refuses to publish into `directory`, already resolved by realpath, when another user could swap what a run stages
 * there (BACKLOG 103-11): one group- or other-writable without the sticky bit, or owned by neither this user nor root.
 * There another user can rename a run's staging directory aside and put a symbolic link in its place, through which the
 * run would write, link and remove files elsewhere. POSIX only: Windows has no owner or mode here (posixModeEnforced).
 */
export async function assertPublishDirectory(directory: string, label: string, platform = process.platform): Promise<void> {
  if (!posixModeEnforced(platform)) return;
  const entry = await lstat(directory);
  if (!entry.isDirectory()) throw new Error(`${label} directory is not a directory: ${directory}; nothing was written`);
  if ((entry.mode & 0o022) !== 0 && (entry.mode & 0o1000) === 0) {
    throw new Error(`${label} will not publish into ${directory}: other users can write to it and it has no sticky bit, so they could swap the files `
      + "being published; use a directory only you can write to (chmod go-w), or one with the sticky bit set (as /tmp); nothing was written");
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined && entry.uid !== uid && entry.uid !== 0) {
    throw new Error(`${label} will not publish into ${directory}: it is owned by another user (uid ${entry.uid}), who could swap the files being `
      + "published; use a directory you own; nothing was written");
  }
}

/**
 * The identity of a staging directory mkdtemp just made (BACKLOG 103-11), taken at once: it must be this user's own
 * staging directory (ownStaging), or it was swapped before it was looked at and nothing is staged in it. `suffix` ends
 * the message where the caller adds nothing to it.
 */
async function stagingIdentity(path: string, label: string, suffix = ""): Promise<BigIntStats> {
  const entry = await lstat(path, { bigint: true });
  if (!ownStaging(entry)) throw new Error(`${label} staging directory ${path} was replaced as soon as it was made${suffix}`);
  return entry;
}

/** Throws unless `path` is still the staging directory `expected`: checked before each staged open and each link (BACKLOG 103-11). */
function assertStagingSync(path: string, expected: BigIntStats, label: string, suffix = ""): void {
  let entry: BigIntStats | undefined;
  try { entry = lstatSync(path, { bigint: true }); } catch { /* gone: refused below */ }
  if (entry === undefined || !entry.isDirectory() || !sameEntry(entry, expected)) throw new Error(`${label} staging directory ${path} was replaced while the files were published${suffix}`);
}

/** Throws unless `path` is still the regular file `expected` this run staged: checked before it is linked (BACKLOG 103-11). */
function assertStagedFileSync(path: string, expected: BigIntStats | undefined, label: string, suffix = ""): void {
  let entry: BigIntStats | undefined;
  try { entry = lstatSync(path, { bigint: true }); } catch { /* gone: refused below */ }
  if (expected === undefined || entry === undefined || !entry.isFile() || !sameEntry(entry, expected)) throw new Error(`${label} staged file ${path} was replaced while the files were published${suffix}`);
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
 * it may itself be reached through a symbolic link (/tmp on macOS), as it could be when the file was simply written;
 * the resolved directory must be one no other user can swap the staging in (assertPublishDirectory, BACKLOG 103-11).
 * The staging directory's identity is kept from when it was made and checked before the file is staged in it and
 * before the link, and the staged file before the link. The staging is removed when the run ends, the file this run
 * staged only, then the directory if empty (removeStagingSync), as a best effort that never changes the result: a run
 * killed meanwhile, or a removal that fails (Windows refuses to delete a file another process holds open), leaves a
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
  await assertPublishDirectory(directory, label);
  const target = join(directory, basename(destination));
  // A re-run that finds its file needs no staging, so it can confirm evidence in a directory made read-only.
  const found = await settleExistingFile(target, directory, bytes, label);
  if (found !== null) return found;
  const staging = await mkdtemp(join(directory, ".publish-"));
  const unwritten = "; nothing was written";
  const stagingId = await stagingIdentity(staging, label, unwritten);
  const stagedIds: BigIntStats[] = [];
  try {
    const staged = join(staging, "file");
    assertStagingSync(staging, stagingId, label, unwritten);
    const handle = await openExclusiveFile(staged, label);
    try { stagedIds.push(await handle.stat({ bigint: true })); await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    for (let attempt = 1; ; attempt += 1) {
      try {
        assertStagingSync(staging, stagingId, label, unwritten);
        assertStagedFileSync(staged, stagedIds[0], label, unwritten);
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
    removeStagingSync(staging, stagingId, stagedIds);
  }
}

/** A staging directory, publish lock or leftover of a takeover older than this is removed by a later run, whatever its pid. */
const STALE_STAGING_MS = 24 * 60 * 60 * 1000;
/** A publish lock naming no process (empty or cut short) is taken over once it is this old (BACKLOG 103-10 review 4). */
const OWNERLESS_LOCK_GRACE_MS = 60 * 1000;
/** A takeover marker is held for the few steps of one takeover; one this old belongs to a run that stopped (review 5). */
const STALE_TAKEOVER_MS = 30 * 1000;
/** The pause before a lock or marker is looked at again. */
const LOCK_RETRY_MS = 25;
/** The signals during which a publish removes what it did before it ends (BACKLOG 103-10 review 2, 4). */
const PUBLISH_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const TEMPORARY_LOCK = /^\.[0-9a-f-]{36}\.publish-lock-new$/;
const LOCK_TOMBSTONE = /^\.[0-9a-f-]{36}\.publish-lock-stale$/;

/** The stem in a staging directory's name: the characters a file name can safely carry, at most 64 of them. */
const stagingStem = (stem: string) => stem.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "files";

/**
 * The names of the publish lock of a set whose first destination is named `first` and of its takeover marker (BACKLOG
 * 103-10 review 4, 5): that exact name, unchanged, so the file system's own sameness of names (case, Unicode
 * normalisation) applies to the lock as it does to the file. A name too long for them is refused rather than hashed,
 * since a hash would lose that sameness.
 */
function publishLockNames(first: string, label: string): { lock: string; takeover: string } {
  const lock = `.${first}.publish-lock`, takeover = `${lock}.takeover`;
  if (Buffer.byteLength(takeover, "utf8") > 255) {
    throw new Error(`${label} cannot name its lock after ${first}: the name is too long by ${Buffer.byteLength(takeover, "utf8") - 255} bytes; choose a shorter name; nothing was written`);
  }
  return { lock, takeover };
}

/** A short hash of the first destination's exact name: it ties staging directories to the set the lock is for (review 5). */
const setTag = (first: string) => createHash("sha256").update(first, "utf8").digest("hex").slice(0, 8);

/** Waits `ms` milliseconds synchronously (a signal handler, or a release in `finally`, cannot await). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether a process with this id exists: signal 0 checks without sending anything (EPERM: it exists, as another user). */
function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * Whether an entry found by its name is a staging directory this user's publishImmutableFiles made: a directory (not a
 * link) owned by the user, mode 0700. Windows has neither owner nor mode here, so any directory passes there; that is
 * why a staging directory is removed there only when its process is known to be gone, never by age alone.
 */
function ownStaging(entry: Stats | BigIntStats): boolean {
  if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
  if (typeof process.getuid === "function" && Number(entry.uid) !== process.getuid()) return false;
  return !posixModeEnforced() || (Number(entry.mode) & 0o777) === 0o700;
}

const sameEntry = (left: Stats | BigIntStats, right: Stats | BigIntStats) => String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);

/**
 * Removes a staging directory the way it was filled, then the directory itself if that left it empty. Anything else in
 * it stays, and so does the directory; nothing is removed recursively. The directory must still be `expected` (its
 * identity when it was made or judged) before it is read and before each file goes. With `staged`, the identities of
 * the files this run created in it, only those files go (BACKLOG 103-11), so a run whose staging was swapped for a link
 * to another directory never removes a file it did not make; without it (a killed run's staging, judged by
 * removeStaleStagings), its top-level regular files named by a number go. Synchronous, so a signal handler can use it.
 */
function removeStagingSync(path: string, expected: BigIntStats, staged?: readonly BigIntStats[]): void {
  const still = () => { try { const now = lstatSync(path, { bigint: true }); return now.isDirectory() && sameEntry(now, expected); } catch { return false; } };
  if (!still()) return;
  let names: string[];
  try { names = readdirSync(path); } catch { return; }
  for (const name of names) {
    if ((staged === undefined && !/^\d+$/.test(name)) || !still()) continue;
    try {
      const entry = lstatSync(join(path, name), { bigint: true });
      if (entry.isFile() && (staged === undefined || staged.some((id) => sameEntry(entry, id)))) unlinkSync(join(path, name));
    } catch { /* left in place */ }
  }
  if (still()) { try { rmdirSync(path); } catch { /* not empty, or gone: left in place */ } }
}

/** Whether a directory holds nothing but numbered regular files: all a staging directory ever holds. */
async function onlyStagedFiles(path: string): Promise<boolean> {
  let names: string[];
  try { names = await readdir(path); } catch { return false; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) return false;
    if (!(await lstat(join(path, name)).catch(() => null))?.isFile()) return false;
  }
  return true;
}

/**
 * Removes, from `directory`, what killed publishImmutableFiles runs of the same set left (BACKLOG 103-10 review 2-5):
 * staging directories `.publish-<stem>-<tag>-<pid>-XXXXXX`, the tag a hash of the first destination's exact name, so
 * only runs the same lock covers are looked at, whose process is gone, or older than a day (off Windows only), and
 * only this user's (ownStaging) holding nothing but numbered files. Each is first renamed to a fresh name of the same
 * shape with pid 0 (no process), so the name it is worked on can no longer be swapped for a link to elsewhere; the
 * renamed entry must still be the directory that was judged, and only its numbered files go (removeStagingSync). A
 * directory of a live run, of another set, of another shape, owner or mode, or holding anything else, is never touched.
 * This user's temporary locks (`.<uuid>.publish-lock-new`) and lock tombstones (`.<uuid>.publish-lock-stale`) that a run
 * killed in the middle of taking a lock left are removed too: those naming a process that is gone (or none, a minute
 * on), and any a day old. Another user's, one too large to be a lock, or one that cannot be read is left unread (readLockSync).
 */
async function removeStaleStagings(directory: string, stem: string, tag: string): Promise<void> {
  const pattern = new RegExp(`^\\.publish-${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-${tag}-(\\d+)-[A-Za-z0-9]{6}$`);
  let names: string[];
  try { names = await readdir(directory); } catch { return; }
  for (const name of names) {
    const path = join(directory, name);
    if (TEMPORARY_LOCK.test(name) || LOCK_TOMBSTONE.test(name)) {
      // A killed run's: the process it names is gone (or it names none, a minute on), or it is a day old. One naming a
      // live process may be a lock another run is moving, and stays.
      const held = readLockSync(path);
      if (held !== null && staleOwned(held, STALE_STAGING_MS).stale) {
        const current = await lstat(path).catch(() => null);
        if (current !== null && sameEntry(current, held.stat)) await unlink(path).catch(() => undefined);
      }
      continue;
    }
    const match = pattern.exec(name);
    if (!match) continue;
    const entry = await lstat(path, { bigint: true }).catch(() => null);
    if (entry === null || !ownStaging(entry)) continue;
    const pid = Number(match[1]);
    if (processAlive(pid) && (process.platform === "win32" || Date.now() - Number(entry.mtimeMs) < STALE_STAGING_MS)) continue;
    if (!(await onlyStagedFiles(path))) continue;
    const moved = join(directory, `.publish-${stem}-${tag}-0-${randomUUID().replace(/-/g, "").slice(0, 6)}`);
    try { await rename(path, moved); } catch { continue; }
    const now = await lstat(moved, { bigint: true }).catch(() => null);
    if (now === null || !ownStaging(now) || !sameEntry(now, entry)) {
      // Not the directory judged (swapped meanwhile): put back as it was, and leave it.
      await rename(moved, path).catch(() => undefined);
      continue;
    }
    removeStagingSync(moved, now);
  }
}

/** The most a publish lock or takeover marker holds: `<uuid> <pid>\n` is under 60 bytes, so a larger file is no lock of this program's (BACKLOG 103-11). */
const LOCK_MAX_BYTES = 128;

/**
 * Opens a file as settleExistingFile does: without following a link or waiting on a FIFO, and only a regular file.
 * null when nothing, or not a regular file, is there, or it cannot be opened for another reason; `refused` (the code,
 * with the lstat of the regular file there) when access to it is denied, other than for a Windows deletion in progress
 * (lockBeingReleased), which is looked at again as before.
 */
function openRegularSync(path: string): { descriptor: number; stat: Stats } | { refused: string; stat: Stats } | null {
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_RDONLY | noFollowFlag() | nonBlockingFlag()); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if ((code !== "EACCES" && code !== "EPERM") || lockBeingReleased(error)) return null;
    try { const entry = lstatSync(path); return entry.isFile() ? { refused: code, stat: entry } : null; } catch { return null; }
  }
  try {
    const stat = fstatSync(descriptor);
    if (stat.isFile()) return { descriptor, stat };
  } catch { /* closed below and taken as nothing there */ }
  closeSync(descriptor);
  return null;
}

/**
 * What is at a publish lock's (or marker's, temporary lock's, tombstone's) path (BACKLOG 103-11): null when nothing, or
 * not a regular file, is there; `foreign` (why, with its identity, and nothing read) when it is another user's (where
 * the host has owners), larger than any lock (LOCK_MAX_BYTES), or cannot be opened, all judged from fstat before a byte
 * is read; otherwise its contents, at most LOCK_MAX_BYTES of them, and its identity. Never throws.
 */
function inspectLockSync(path: string): { contents: string; stat: Stats } | { foreign: string; stat: Stats } | null {
  const opened = openRegularSync(path);
  if (opened === null) return null;
  if ("refused" in opened) return { foreign: `it cannot be opened: ${opened.refused}`, stat: opened.stat };
  const { descriptor, stat } = opened;
  try {
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return { foreign: `it is owned by another user (uid ${stat.uid})`, stat };
    if (stat.size > LOCK_MAX_BYTES) return { foreign: `it holds ${stat.size} bytes, more than a lock does`, stat };
    const buffer = Buffer.alloc(LOCK_MAX_BYTES + 1);
    let length = 0;
    for (let read = -1; read !== 0 && length < buffer.length;) { read = readSync(descriptor, buffer, length, buffer.length - length, length); length += read; }
    if (length > LOCK_MAX_BYTES) return { foreign: "it grew past what a lock holds", stat };
    return { contents: buffer.subarray(0, length).toString("utf8"), stat };
  } catch {
    return null;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * A publish lock's (or marker's) contents and identity, or null when nothing there is a lock of this user's: nothing,
 * not a regular file, another user's, too large, or unreadable (inspectLockSync). Never throws.
 */
function readLockSync(path: string): { contents: string; stat: Stats } | null {
  const found = inspectLockSync(path);
  return found !== null && "contents" in found ? found : null;
}

/** The SHA-256 of the regular file at `path`, opened as settleExistingFile opens one; null when it is not that file. */
async function fileDigest(path: string, platform = process.platform): Promise<string | null> {
  const entry = await lstat(path).catch(() => null);
  if (!entry?.isFile()) return null;
  let handle: FileHandle;
  try { handle = await open(path, constants.O_RDONLY | noFollowFlag(platform) | (platform === "win32" ? 0 : constants.O_NONBLOCK)); } catch { return null; }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== entry.ino || opened.dev !== entry.dev) return null;
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

/** fsync of a directory, synchronous for a signal handler; Windows cannot open a directory, as syncDirectoryEntry says. */
function syncDirectorySync(directory: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(directory, constants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

type PublishLock = { path: string; token: string };
/** A publish lock that could not be created for want of write access: the run may only confirm what is there. */
class PublishLockDenied extends Error { constructor(readonly code: string, message: string) { super(message); } }

/** Whether a lock or marker read from disk is stale: its process gone, naming no process for a minute, or `maxAgeMs` old. */
function staleOwned(held: { contents: string; stat: Stats }, maxAgeMs: number): { stale: boolean; owner: number | null } {
  const parsed = /^[0-9a-f-]{36} (\d+)\n$/i.exec(held.contents)?.[1];
  const owner = parsed === undefined ? null : Number(parsed);
  const age = Date.now() - held.stat.mtimeMs;
  return { owner, stale: (owner !== null && !processAlive(owner)) || (owner === null && age > Math.min(OWNERLESS_LOCK_GRACE_MS, maxAgeMs)) || age > maxAgeMs };
}

/**
 * Puts `<token> <pid>` at `path`, whole: written to a temporary file, synced, then linked into place. true when it was
 * placed; false when something is there already (or, on Windows, a file there is being deleted). A temporary file that
 * cannot be written or synced is removed, and the run ends saying that nothing was written; a placed file whose
 * directory cannot be synced is given up again. Write access denied to the directory is PublishLockDenied.
 */
async function placeOwned(path: string, token: string, label: string): Promise<boolean> {
  const directory = dirname(path);
  const temporary = join(directory, `.${randomUUID()}.publish-lock-new`);
  let handle: FileHandle;
  try { handle = await openExclusiveFile(temporary, `${label} lock`); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (lockBeingReleased(error)) return false;   // a name being deleted (Windows): looked at again, as one that is there
    if (code === "EACCES" || code === "EROFS" || code === "EPERM") throw new PublishLockDenied(code, `${label} cannot take its lock in ${directory} (${code})`);
    throw error;
  }
  try {
    try { await handle.writeFile(`${token} ${process.pid}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw new Error(`${label} could not write its lock ${path} (${(error as Error).message}); nothing was written`, { cause: error });
  }
  let placed = false;
  try {
    await link(temporary, path);
    placed = true;
    await syncDirectoryEntry(directory);
    return true;
  } catch (error) {
    if (placed) {
      releaseOwnedSync(path, token);
      throw new Error(`${label} could not sync its lock ${path} (${(error as Error).message}); nothing was written`, { cause: error });
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST" || lockBeingReleased(error)) return false;
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/**
 * Removes a stale lock or marker atomically: renamed to a unique tombstone, which must then still be the very file that
 * was judged (same identity, contents and age) before it is removed; anything else is put back where it was.
 */
async function removeStaleOwned(path: string, judged: { contents: string; stat: Stats }, label: string, why: string): Promise<void> {
  const tombstone = join(dirname(path), `.${randomUUID()}.publish-lock-stale`);
  try { await rename(path, tombstone); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(`${label} lock ${path} is stale (${why}) but could not be removed: ${(error as Error).message}; nothing was written`, { cause: error });
  }
  const moved = readLockSync(tombstone);
  if (moved !== null && sameEntry(moved.stat, judged.stat) && moved.contents === judged.contents && moved.stat.mtimeMs === judged.stat.mtimeMs) {
    await unlink(tombstone).catch(() => undefined);
    return;
  }
  await link(tombstone, path).catch(() => undefined);
  await unlink(tombstone).catch(() => undefined);
}

/** The holder of a lock or marker, for messages. */
const ownerText = (owner: number | null) => (owner === null ? "it names no process" : `process ${owner} is gone`);

/**
 * Takes the lock of a publishImmutableFiles run (BACKLOG 103-10 review 3-5) at `path`. The lock is placed whole
 * (placeOwned). A lock there is another run's unless it is stale: its process gone, or naming no process and a minute
 * old, or a day old. A stale lock is taken over only under the takeover marker `<lock>.takeover`, which one run at a
 * time holds while it reads the lock again, judges it, removes it atomically (removeStaleOwned) and places its own; a
 * run that finds the marker held waits briefly and reads the lock again, so no run ever moves another's live lock. A
 * marker whose process is gone, or 30 seconds old, is removed the same way. A lock path that is not a regular file is
 * refused, and so is another user's lock or marker, or one larger than any lock, without reading it (BACKLOG 103-11);
 * write access denied to the directory is PublishLockDenied, for the caller to confirm instead.
 */
async function takePublishLock(path: string, markerPath: string, label: string): Promise<PublishLock> {
  const token = randomUUID();
  for (let attempt = 1; attempt <= 80; attempt += 1) {
    if (await placeOwned(path, token, label)) return { path, token };
    // Another user's lock, or a file no lock could be, is refused before a byte of it is read (BACKLOG 103-11).
    const held = inspectLockSync(path);
    if (held === null) {
      if ((await lstat(path).catch(() => null))?.isFile() === false) throw new Error(`${label} lock path is not a regular file: ${path}; nothing was written`);
      await sleep(LOCK_RETRY_MS);   // gone since, or being deleted (Windows): look again shortly
      continue;
    }
    if (typeof process.getuid === "function" && held.stat.uid !== process.getuid()) throw new Error(`${label} lock is another user's: ${path}; nothing was written`);
    if ("foreign" in held) throw new Error(`${label} lock path holds a file that is not a lock (${held.foreign}): ${path}; nothing was written`);
    const { stale, owner } = staleOwned(held, STALE_STAGING_MS);
    if (!stale) throw new Error(`another ${label} of the same files is running${owner === null ? " (its lock names no process yet)" : ` (process ${owner})`}: ${path}; nothing was written`);
    const markerToken = randomUUID();
    if (!(await placeOwned(markerPath, markerToken, label))) {
      // A marker only this user's runs place: another user's, or a file no marker could be, is refused unread.
      const found = inspectLockSync(markerPath);
      if (found !== null && "foreign" in found) throw new Error(`${label} takeover marker path holds a file that is not this user's marker (${found.foreign}): ${markerPath}; nothing was written`);
      const marker = found;
      if (marker !== null) {
        const judged = staleOwned(marker, STALE_TAKEOVER_MS);
        if (judged.stale) await removeStaleOwned(markerPath, marker, label, ownerText(judged.owner));
      }
      await sleep(LOCK_RETRY_MS);   // another run is taking the lock over: look at the lock again
      continue;
    }
    try {
      // Under the marker: the lock is read again, and only the stale lock just read is removed.
      const again = readLockSync(path);
      if (again === null || !sameEntry(again.stat, held.stat) || again.contents !== held.contents) continue;
      await removeStaleOwned(path, again, label, ownerText(owner));
      if (await placeOwned(path, token, label)) return { path, token };
    } finally {
      releaseOwnedSync(markerPath, markerToken);
    }
  }
  throw new Error(`${label} could not take its lock ${path}: it kept changing; nothing was written`);
}

/** The tombstone in this directory, if any, that holds `token`: a lock of this run another run is moving (review 5). */
function tombstoneHoldingSync(directory: string, token: string): string | null {
  let names: string[];
  try { names = readdirSync(directory); } catch { return null; }
  for (const name of names) {
    if (!LOCK_TOMBSTONE.test(name)) continue;
    try { if (readLockSync(join(directory, name))?.contents.startsWith(`${token} `)) return join(directory, name); } catch { /* gone */ }
  }
  return null;
}

/**
 * Whether `lock` is still this run's: its file there holds this run's token (opened as settleExistingFile opens one).
 * A lock briefly moved to a tombstone by another run, which puts it back, is waited for a few times.
 */
function lockStillOursSync(lock: PublishLock): boolean {
  for (let look = 1; look <= 8; look += 1) {
    try { if (readLockSync(lock.path)?.contents.startsWith(`${lock.token} `)) return true; } catch { /* looked at again below */ }
    if (tombstoneHoldingSync(dirname(lock.path), lock.token) === null) return false;
    sleepSync(LOCK_RETRY_MS);
  }
  return false;
}

/** Removes the lock or marker at `path` if it is still the one holding `token`; synchronous, for a signal handler too. */
function releaseOwnedSync(path: string, token: string): void {
  for (let look = 1; look <= 8; look += 1) {
    try {
      const held = readLockSync(path);
      if (held !== null && held.contents.startsWith(`${token} `)) {
        if (sameEntry(lstatSync(path), held.stat)) unlinkSync(path);
        return;
      }
    } catch { return; }
    // Moved to a tombstone by another run, which will put it back: wait for that, and in the end remove the tombstone, so
    // that a released lock is never put back.
    const tombstone = tombstoneHoldingSync(dirname(path), token);
    if (tombstone === null) return;
    if (look < 8) { sleepSync(LOCK_RETRY_MS); continue; }
    try { unlinkSync(tombstone); } catch { /* gone */ }
  }
  try { const held = readLockSync(path); if (held?.contents.startsWith(`${token} `) && sameEntry(lstatSync(path), held.stat)) unlinkSync(path); } catch { /* gone */ }
}

/** Removes the publish lock if it is still this run's; synchronous, for a signal handler too. */
function releasePublishLockSync(lock: PublishLock): void {
  releaseOwnedSync(lock.path, lock.token);
}

/** lockStillOursSync, waiting without blocking: another run in this process may be the one putting the lock back. */
async function lockStillOurs(lock: PublishLock): Promise<boolean> {
  for (let look = 1; look <= 8; look += 1) {
    try { if (readLockSync(lock.path)?.contents.startsWith(`${lock.token} `)) return true; } catch { /* looked at again below */ }
    if (tombstoneHoldingSync(dirname(lock.path), lock.token) === null) return false;
    await sleep(LOCK_RETRY_MS);
  }
  return false;
}

/** releasePublishLockSync, waiting without blocking for a lock another run is putting back. */
async function releasePublishLock(lock: PublishLock): Promise<void> {
  for (let look = 1; look <= 8; look += 1) {
    const held = (() => { try { return readLockSync(lock.path); } catch { return null; } })();
    if (held !== null && held.contents.startsWith(`${lock.token} `)) break;
    const tombstone = tombstoneHoldingSync(dirname(lock.path), lock.token);
    if (tombstone === null) return;
    if (look < 8) { await sleep(LOCK_RETRY_MS); continue; }
    // Still moved away: the tombstone goes, so that a released lock is never put back.
    try { unlinkSync(tombstone); } catch { /* gone */ }
  }
  releaseOwnedSync(lock.path, lock.token);
}

/**
 * Confirms, without writing anything, that every destination already holds exactly its bytes: the run of a set whose
 * directory denies it its lock (a directory made read-only for evidence, as publishImmutableFile allows). All
 * identical is a success; a destination missing refuses the run; one with other bytes is "different".
 */
async function confirmImmutableFiles(targets: { destination: string; directory: string; target: string }[], bytesOf: (index: number) => Promise<string | Buffer>,
  label: string, denied: PublishLockDenied): Promise<{ published: true; results: "identical"[] } | { published: false; different: string[] }> {
  const different: string[] = [];
  for (const [index, { destination, directory, target }] of targets.entries()) {
    const entry = await lstat(target).catch(() => null);
    if (entry?.isSymbolicLink()) throw new Error(`${label} path must be a regular file, not a symbolic link: ${destination}; nothing was written`);
    if (entry === null) throw new Error(`${denied.message}, and ${destination} is not there to be confirmed; nothing was written`);
    const raw = await bytesOf(index);
    const found = await settleExistingFile(target, directory, typeof raw === "string" ? Buffer.from(raw, "utf8") : raw, label);
    if (found === null) throw new Error(`${denied.message}, and ${destination} is not there to be confirmed; nothing was written`);
    if (found === "different") different.push(destination);
  }
  return different.length > 0 ? { published: false, different } : { published: true, results: targets.map(() => "identical" as const) };
}

/**
 * Publishes several new immutable files together, all of them or none (BACKLOG 103-10 review): publishImmutableFile for
 * a set, on the same primitives. The run holds a lock beside the first destination throughout, `.<its exact name>.publish-lock`
 * (takePublishLock; a name too long for it is refused), so two runs for the same files do not interleave; it checks
 * the lock is still its own before the link phase, before it links the first destination and before it removes
 * anything. Where the directory denies it the lock, it only confirms that every
 * destination is already identical (confirmImmutableFiles). The bytes of each destination are asked for in turn, so
 * only one file's bytes are held at once. A destination already holding exactly those bytes is "identical" (synced as
 * publishImmutableFile syncs it); one holding other bytes, or anything but a regular file, is "different"; a symbolic
 * link there is refused. The bytes of a new destination are written to a staging file and synced, in a directory
 * `.publish-<stem>-<tag>-<pid>-XXXXXX` beside it, the tag a hash of the first destination's exact name; a run first
 * removes what killed runs of the same set left (removeStaleStagings). Every destination's resolved directory must be
 * one no other user can swap the staging in (assertPublishDirectory), and each staging's identity is kept from when it
 * was made: it is checked before each staged file is created and after, and with the staged file before each link, and
 * only the files this run created there are ever removed from it (BACKLOG 103-11). Nothing is linked into place before every destination is staged or found identical: when
 * bytesOf fails, or a destination is "different", the staging files are removed and nothing is written. Once one
 * destination is "different", only destinations that already exist are still compared, so that every different one is
 * returned.
 *
 * Then the staged files are linked to their destinations, the first destination last: the others are linked and their
 * directories synced, the destinations found identical are checked to be so still, and only then is the first one
 * linked and synced, so the first destination there means the set was whole when it was written. A step that fails (a
 * destination taken meanwhile by other bytes, a denied or full directory, a failed sync) removes again what this run
 * linked: the first destination first, with its directory synced, then the others in the reverse of their order, each
 * only while it is still the file this run staged. When the first destination cannot be removed, or its directory not
 * synced, nothing else is: the set stays whole. Nothing is removed at all when the first destination is there and is
 * not this run's, or when the lock is no longer this run's. The error says what was removed, already gone, replaced by
 * another file, or left. A SIGINT, SIGTERM or SIGHUP removes the staging files first (so a link still in flight fails),
 * then what was linked, then the lock; it then takes its usual course, or, when the host has its own listener, the run
 * ends with an error that it was interrupted. A crash or power loss while linking can still leave some destinations
 * without the first. `observe`, for tests, is called before each link, each directory sync and each unlink of a removal;
 * a throw fails that step.
 */
export async function publishImmutableFiles(
  destinations: readonly string[],
  bytesOf: (index: number) => Promise<string | Buffer>,
  label: string,
  options: { stem?: string; observe?: (step: "link" | "sync" | "unlink", path: string) => void } = {},
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
  if (targets.length === 0) return { published: true, results: [] };
  if (new Set(targets.map((item) => item.target)).size !== targets.length) throw new Error(`${label} paths must be distinct`);
  const observe = options.observe ?? (() => undefined);
  const stem = stagingStem(options.stem ?? basename(destinations[0]).replace(/\.[^.]*$/, ""));
  const first = basename(targets[0].target), tag = setTag(first);
  const directories = [...new Set(targets.map((item) => item.directory))];
  // Every destination's directory, resolved: none may let another user swap the staging (BACKLOG 103-11).
  for (const directory of directories) await assertPublishDirectory(directory, label);
  const names = publishLockNames(first, label);
  let lock: PublishLock;
  try { lock = await takePublishLock(join(targets[0].directory, names.lock), join(targets[0].directory, names.takeover), label); } catch (error) {
    if (error instanceof PublishLockDenied) return confirmImmutableFiles(targets, bytesOf, label, error);
    throw error;
  }
  const lockTakenOver = () => new Error(`${label} lock ${lock.path} was taken over`);
  /** Each directory's staging, with its identity from when mkdtemp made it: checked before each staged open and each
   * link, and before anything in it is removed (BACKLOG 103-11). */
  const stagings = new Map<string, { path: string; id: BigIntStats }>();
  const staged: (string | null)[] = [];
  /** Each staged file's identity, kept from when it was created: a removal checks a destination against it even after a
   * signal has removed the staging, and the staging's removal removes only these files. */
  const stagedIds = new Map<number, BigIntStats>();
  const results: ("created" | "identical" | null)[] = [];
  const identical = new Map<number, string>();
  const different: string[] = [];
  const created: { index: number; destination: string; target: string }[] = [];
  const removals = { removed: [] as string[], gone: [] as string[], replaced: [] as string[], failed: [] as string[], kept: [] as string[], keptBecause: "", stopped: "", stoppedWhole: false };
  const sameAsStaged = (placed: BigIntStats, index: number) => { const ours = stagedIds.get(index); return ours !== undefined && placed.dev === ours.dev && placed.ino === ours.ino; };
  const lstatOrNull = (path: string) => { try { return lstatSync(path, { bigint: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } };
  /** The entries that are this run's files where they were linked: what a removal left behind is reported from these. */
  const linkedOf = (entries: typeof created) => entries.filter(({ index, target }) => { try { const placed = lstatOrNull(target); return placed !== null && sameAsStaged(placed, index); } catch { return true; } });
  /**
   * Removes again what this run linked: the first destination first, with its directory synced, then the rest in
   * reverse. When the first cannot be removed or synced, nothing more is. Nothing at all when the first destination is
   * there and is not this run's file, or the lock is no longer this run's. Synchronous, so a signal handler can use it.
   */
  const removeCreated = () => {
    const entries = created.splice(0);
    if (entries.length === 0) return;
    const keep = (because: string) => { removals.kept.push(...linkedOf(entries).map((entry) => entry.destination)); removals.keptBecause ||= because; };
    if (!lockStillOursSync(lock)) { keep(`since the lock ${lock.path} is no longer this run's`); return; }
    const first = entries.find((entry) => entry.index === 0);
    try {
      const placedFirst = lstatOrNull(targets[0].target);
      if (placedFirst !== null && (first === undefined || !sameAsStaged(placedFirst, 0))) { keep(`since ${targets[0].destination} is there and is not this run's file`); return; }
    } catch (error) {
      keep(`since it could not be told whether ${targets[0].destination} is this run's file (${(error as Error).message})`);
      return;
    }
    const order = first ? [first, ...entries.filter((entry) => entry !== first).reverse()] : [...entries].reverse();
    for (const [position, { index, destination, target }] of order.entries()) {
      const rest = order.slice(position + 1);
      try {
        const placed = lstatOrNull(target);
        if (placed === null) removals.gone.push(destination);
        else if (!sameAsStaged(placed, index)) removals.replaced.push(destination);
        else { observe("unlink", destination); unlinkSync(target); removals.removed.push(destination); }
      } catch (error) {
        if (index === 0) {
          // A first destination that stays means a whole set: the others stay with it.
          removals.stopped = `removing ${destination} failed (${(error as Error).message})`;
          removals.stoppedWhole = true;
          removals.kept.push(destination, ...linkedOf(rest).map((entry) => entry.destination));
          return;
        }
        removals.failed.push(destination);
      }
      if (index === 0 && removals.removed.includes(destination)) {
        try { observe("sync", targets[0].directory); syncDirectorySync(targets[0].directory); } catch (error) {
          removals.stopped = `${destination} was unlinked but syncing its directory failed (${(error as Error).message})`;
          removals.kept.push(...linkedOf(rest).map((entry) => entry.destination));
          return;
        }
      }
    }
  };
  const describeRemovals = () => {
    const list = (items: string[]) => `${items.join(", ")} ${items.length === 1 ? "was" : "were"}`;
    const gone = removals.gone.filter((item) => !removals.removed.includes(item));
    const notes = [
      ...(removals.removed.length ? [`${list(removals.removed)} linked and removed again`] : []),
      ...(gone.length ? [`${list(gone)} already gone`] : []),
      ...(removals.replaced.length ? [`${list(removals.replaced)} replaced by another file, left alone`] : []),
      ...(removals.failed.length ? [`${list(removals.failed)} written and could not be removed`] : []),
    ];
    const outcome = removals.stopped
      ? `${removals.stoppedWhole ? "the set stays published" : "the removal stopped"}: ${removals.stopped}, so ${removals.kept.length ? `${list(removals.kept)} left in place` : "nothing else was removed"}`
      : removals.kept.length > 0 ? `${list(removals.kept)} written and left in place, ${removals.keptBecause}`
        : removals.failed.length > 0 ? "not everything written could be removed" : "nothing was written";
    return `${outcome}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
  };
  let interrupted = false;
  const stillRunning = () => { if (interrupted) throw new Error(`${label} was interrupted`); };
  const removeStagings = () => { for (const { path, id } of stagings.values()) removeStagingSync(path, id, [...stagedIds.values()]); };
  const onSignal = (signal: NodeJS.Signals) => {
    interrupted = true;
    // The staging files go first: a link still in flight then fails, rather than land after the removal looked.
    removeStagings();
    removeCreated();
    releasePublishLockSync(lock);
    for (const name of PUBLISH_SIGNALS) process.removeListener(name, onSignal);
    if (process.listenerCount(signal) === 0) {
      try { process.kill(process.pid, signal); } catch { process.exit(1); }   // a signal the host cannot send itself (SIGHUP on Windows)
    }
  };
  for (const name of PUBLISH_SIGNALS) process.prependListener(name, onSignal);
  try {
    try {
      // A takeover marker left by a killed run: removed once its process is gone (or it is 30 seconds old).
      const marker = readLockSync(join(targets[0].directory, names.takeover));
      if (marker !== null && staleOwned(marker, STALE_TAKEOVER_MS).stale) {
        await removeStaleOwned(join(targets[0].directory, names.takeover), marker, label, "a takeover marker left behind").catch(() => undefined);
      }
      await removeStaleStagings(targets[0].directory, stem, tag);
      for (const directory of directories.slice(1)) await removeStaleStagings(directory, stem, tag);
      for (const [index, { destination, directory, target }] of targets.entries()) {
        stillRunning();
        staged.push(null); results.push(null);
        let entry: Stats | null;
        try { entry = await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; entry = null; }
        if (entry?.isSymbolicLink()) throw new Error(`${label} path must be a regular file, not a symbolic link: ${destination}`);
        if (different.length > 0 && entry === null) continue;
        const raw = await bytesOf(index);
        stillRunning();
        const bytes = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
        const found = entry === null ? null : await settleExistingFile(target, directory, bytes, label);
        if (found === "different") { different.push(destination); continue; }
        if (found === "identical") { results[index] = "identical"; identical.set(index, createHash("sha256").update(bytes).digest("hex")); continue; }
        if (different.length > 0) continue;
        let staging = stagings.get(directory);
        if (staging === undefined) {
          const path = await mkdtemp(join(directory, `.publish-${stem}-${tag}-${process.pid}-`));
          staging = { path, id: await stagingIdentity(path, label) };
          stagings.set(directory, staging);
        }
        const file = join(staging.path, String(index));
        // The staging is used by its name, so it must still be the directory made, before the file is created in it and
        // after (the file then is where it was created); the file's identity is kept before anything is written to it.
        assertStagingSync(staging.path, staging.id, label);
        const handle = await openExclusiveFile(file, label);
        try { stagedIds.set(index, await handle.stat({ bigint: true })); await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        assertStagingSync(staging.path, staging.id, label);
        assertStagedFileSync(file, stagedIds.get(index), label);
        staged[index] = file;
      }
      stillRunning();
      if (different.length === 0 && !(await lockStillOurs(lock))) throw lockTakenOver();
    } catch (error) {
      if (interrupted) throw new Error(`${label} was interrupted; ${describeRemovals()}`, { cause: error });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.endsWith("nothing was written") ? message : `${message}; nothing was written`, { cause: error });
    }
    if (different.length > 0) return { published: false, different };
    const linkOne = async (index: number) => {
      const { destination, directory, target } = targets[index], file = staged[index]!;
      for (let attempt = 1; ; attempt += 1) {
        // Recorded before the link, so that a signal while it is in flight removes it too; dropped when it fails.
        const entry = { index, destination, target };
        created.push(entry);
        let linked = false;
        try {
          observe("link", destination);
          // What is linked is the file this run staged, in the staging it made (BACKLOG 103-11): a staging swapped for a
          // link to another directory would otherwise hand that directory's file of the same name to the destination.
          const staging = stagings.get(directory)!;
          assertStagingSync(staging.path, staging.id, label);
          assertStagedFileSync(file, stagedIds.get(index), label);
          await link(file, target);
          linked = true;
          stillRunning();
          results[index] = "created";
          return;
        } catch (error) {
          const at = created.indexOf(entry);
          // Not linked: nothing to remove. Linked after a signal's removal already ran: kept for the removal that follows.
          if (!linked && at >= 0) created.splice(at, 1);
          if (linked && at < 0) created.push(entry);
          if (interrupted || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const settled = await settleExistingFile(target, directory, await readFile(file), label);
          stillRunning();
          if (settled === "identical") { results[index] = "identical"; return; }
          if (settled === "different") throw new Error(`${label} path ${destination} was taken by a different file while the files were published`);
          if (attempt === 2) throw new Error(`${label} path ${destination} kept changing while it was being published`);
        }
      }
    };
    const sync = async (directory: string) => { observe("sync", directory); await syncDirectoryEntry(directory); stillRunning(); };
    try {
      for (const [index, file] of staged.entries()) if (index > 0 && file !== null) await linkOne(index);
      for (const directory of directories) await sync(directory);
      for (const [index, digest] of identical) {
        const { destination, target } = targets[index];
        const found = await fileDigest(target);
        stillRunning();
        if (found !== digest) throw new Error(`${label} path ${destination} changed after it was found identical`);
      }
      if (staged[0] !== null && staged[0] !== undefined) {
        if (!(await lockStillOurs(lock))) throw lockTakenOver();
        await linkOne(0);
        await sync(targets[0].directory);
      }
      stillRunning();
    } catch (error) {
      removeCreated();
      for (const directory of directories) await syncDirectoryEntry(directory).catch(() => undefined);
      if (interrupted) throw new Error(`${label} was interrupted; ${describeRemovals()}`, { cause: error });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}; ${describeRemovals()}`, { cause: error });
    }
    return { published: true, results: results as ("created" | "identical")[] };
  } finally {
    for (const name of PUBLISH_SIGNALS) process.removeListener(name, onSignal);
    removeStagings();
    await releasePublishLock(lock);
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
