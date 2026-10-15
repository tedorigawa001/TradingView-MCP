import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readdirSync, readFileSync, rmdirSync, unlinkSync, type BigIntStats, type Stats } from "node:fs";
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

/** A staging directory or publish lock older than this is removed by the next run of the same stem, whatever its pid. */
const STALE_STAGING_MS = 24 * 60 * 60 * 1000;

/** The stem in a staging directory's name: the characters a file name can safely carry, at most 64 of them. */
const stagingStem = (stem: string) => stem.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "files";

/** Whether a process with this id exists: signal 0 checks without sending anything (EPERM: it exists, as another user). */
function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Whether a directory found by its name is one this user's publishImmutableFiles made: owned by the user, mode 0700. */
function ownStaging(entry: Stats): boolean {
  if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
  if (typeof process.getuid === "function" && entry.uid !== process.getuid()) return false;
  return !posixModeEnforced() || (entry.mode & 0o777) === 0o700;
}

/**
 * Removes a staging directory the way it was filled: its top-level regular files named by a number, then the
 * directory itself if that left it empty. Anything else in it stays, and so does the directory; nothing is removed
 * recursively. Synchronous, so a signal handler can use it.
 */
function removeStagingSync(path: string): void {
  let names: string[];
  try { names = readdirSync(path); } catch { return; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try { if (lstatSync(join(path, name)).isFile()) unlinkSync(join(path, name)); } catch { /* left in place */ }
  }
  try { rmdirSync(path); } catch { /* not empty, or gone: left in place */ }
}

/**
 * Removes, from `directory`, the staging directories `.publish-<stem>-<pid>-XXXXXX` that publishImmutableFiles runs of the
 * same stem left behind when they were killed (BACKLOG 103-10 review 2): those whose process is gone, and those older
 * than a day, and only those that are this user's (owner and mode 0700), and only their numbered files
 * (removeStagingSync). A directory of a live run of the same stem, of another stem, of another shape, or of another
 * owner or mode is never touched (BACKLOG 103-10 review 3).
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
    if (entry === null || !ownStaging(entry)) continue;
    if (processAlive(Number(match[1])) && Date.now() - entry.mtimeMs < STALE_STAGING_MS) continue;
    removeStagingSync(path);
  }
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

/** Removes the publish lock at `path` if it is still the one holding `token`; synchronous, for a signal handler too. */
function releasePublishLockSync(path: string, token: string): void {
  try {
    const descriptor = openSync(path, constants.O_RDONLY | noFollowFlag());
    let contents: string, opened: Stats;
    try { opened = fstatSync(descriptor); contents = readFileSync(descriptor, "utf8"); } finally { closeSync(descriptor); }
    const current = lstatSync(path);
    if (opened.isFile() && current.ino === opened.ino && current.dev === opened.dev && contents.startsWith(`${token} `)) unlinkSync(path);
  } catch { /* gone, or not ours: left as it is */ }
}

/**
 * Takes the lock a publishImmutableFiles run holds for its whole run, `.publish-<stem>.lock` beside its first
 * destination (BACKLOG 103-10 review 3), so that two runs for the same files never interleave. A lock of this user
 * whose process is gone, or older than a day, is removed and taken; one of a live run refuses this run.
 */
async function takePublishLock(path: string, label: string): Promise<string> {
  const token = randomUUID();
  for (let attempt = 1; ; attempt += 1) {
    const taken = await attemptLockFile(path, `${label} lock`, `${token} ${process.pid}\n`);
    if (taken.taken) return token;
    const held = taken.held;
    if (held && (!held.isFile() || held.isSymbolicLink())) throw new Error(`${label} lock path is unsafe: ${path}; nothing was written`);
    let owner: number | null = null;
    if (held) {
      if (typeof process.getuid === "function" && held.uid !== process.getuid()) throw new Error(`${label} lock is another user's: ${path}; nothing was written`);
      let contents = "", opened: Stats | null = null;
      try {
        const handle = await open(path, constants.O_RDONLY | noFollowFlag());
        try { opened = await handle.stat(); contents = await handle.readFile("utf8"); } finally { await handle.close(); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const parsed = /^[0-9a-f-]{36} (\d+)\n$/i.exec(contents)?.[1];
      owner = parsed === undefined ? null : Number(parsed);
      const stale = opened !== null && opened.ino === held.ino && ((owner !== null && !processAlive(owner)) || Date.now() - held.mtimeMs > STALE_STAGING_MS);
      if (stale && attempt < 5) {
        const current = await lstat(path).catch(() => null);
        if (current && current.ino === held.ino && current.dev === held.dev) await unlink(path).catch(() => undefined);
        continue;
      }
      if (opened === null && attempt < 5) continue;   // gone since it was found: look again
    } else if (attempt < 5) {
      // Gone, or being deleted (Windows): look again shortly.
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    throw new Error(`another ${label} of the same files is running${owner === null ? "" : ` (process ${owner})`}: ${path}; nothing was written`);
  }
}

/**
 * Publishes several new immutable files together, all of them or none (BACKLOG 103-10 review): publishImmutableFile for
 * a set, on the same primitives. The run holds `.publish-<stem>.lock` beside the first destination throughout
 * (takePublishLock), so two runs for the same files do not interleave. The bytes of each destination are asked for in
 * turn, so only one file's bytes are held at once. A destination already holding exactly those bytes is "identical"
 * (synced as publishImmutableFile syncs it); one holding other bytes, or anything but a regular file, is "different"; a
 * symbolic link there is refused. The bytes of a new destination are written to a staging file and synced, in a
 * directory `.publish-<stem>-<pid>-XXXXXX` beside it; a run first removes such directories that runs of the same stem
 * left when they were killed (removeStaleStagings). Nothing is linked into place before every destination is staged or
 * found identical: when bytesOf fails, or a destination is "different", the staging files are removed and nothing is
 * written. Once one destination is "different", only destinations that already exist are still compared, so that every
 * different one is returned.
 *
 * Then the staged files are linked to their destinations, the first destination last: the others are linked and their
 * directories synced, the destinations found identical are checked to be so still, and only then is the first one
 * linked and synced, so the first destination there means the set was whole when it was written. A step that fails (a
 * destination taken meanwhile by other bytes, a denied or full directory, a failed sync) removes again what this run
 * linked: the first destination first, its directory synced, then the others in the reverse of their order, each only
 * while it is still the file this run staged; and nothing at all when the first destination is there and is not this
 * run's, since its set is whole. The error says what was removed, what was already gone, what another file had
 * replaced, and what could not be removed. A SIGINT or SIGTERM during the run does the same and removes its staging
 * and its lock; it then takes its usual course, or, when the host has its own listener, the run ends with an error that
 * it was interrupted. A crash or power loss while linking can still leave some destinations without the first.
 * `observe`, for tests, is called before each link and each sync of the link phase (a throw fails that step) and after
 * each unlink of a removal.
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
  const directories = [...new Set(targets.map((item) => item.directory))];
  const lockPath = join(targets[0].directory, `.publish-${stem}.lock`);
  const token = await takePublishLock(lockPath, label);
  const stagings = new Map<string, string>();
  const staged: (string | null)[] = [];
  /** Each staged file's identity, kept from when it was written: the removal checks a destination against it even after a
   * signal has removed the staging. */
  const stagedIds = new Map<number, BigIntStats>();
  const results: ("created" | "identical" | null)[] = [];
  const identical = new Map<number, string>();
  const different: string[] = [];
  const created: { index: number; destination: string; target: string; file: string }[] = [];
  type Removal = { removed: string[]; gone: string[]; replaced: string[]; failed: string[]; kept: string[] };
  const removals: Removal = { removed: [], gone: [], replaced: [], failed: [], kept: [] };
  const sameFile = (left: BigIntStats, right: BigIntStats | undefined) => right !== undefined && left.dev === right.dev && left.ino === right.ino;
  const lstatOrNull = (path: string) => { try { return lstatSync(path, { bigint: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } };
  /**
   * Removes again what this run linked: the first destination first, then the rest in reverse. Nothing when the first
   * destination is there and is not this run's file. Synchronous, so a signal handler can use it.
   */
  const removeCreated = () => {
    const entries = created.splice(0);
    if (entries.length === 0) return;
    const first = entries.find((entry) => entry.index === 0);
    try {
      const placedFirst = lstatOrNull(targets[0].target);
      if (placedFirst !== null && (first === undefined || !sameFile(placedFirst, stagedIds.get(0)))) {
        removals.kept.push(...entries.map((entry) => entry.destination));
        return;
      }
    } catch {
      removals.kept.push(...entries.map((entry) => entry.destination));
      return;
    }
    const order = first ? [first, ...entries.filter((entry) => entry !== first).reverse()] : [...entries].reverse();
    for (const { index, destination, target } of order) {
      try {
        const placed = lstatOrNull(target);
        if (placed === null) removals.gone.push(destination);
        else {
          if (!sameFile(placed, stagedIds.get(index))) removals.replaced.push(destination);
          else { unlinkSync(target); removals.removed.push(destination); observe("unlink", destination); }
        }
      } catch { removals.failed.push(destination); }
      if (index === 0) { try { syncDirectorySync(targets[0].directory); } catch { /* the removal stands; its sync is a best effort */ } }
    }
  };
  const describeRemovals = () => {
    const list = (items: string[]) => `${items.join(", ")} ${items.length === 1 ? "was" : "were"}`;
    const notes = [
      ...(removals.removed.length ? [`${list(removals.removed)} linked and removed again`] : []),
      ...(removals.gone.filter((item) => !removals.removed.includes(item)).length
        ? [`${list(removals.gone.filter((item) => !removals.removed.includes(item)))} already gone`] : []),
      ...(removals.replaced.length ? [`${list(removals.replaced)} replaced by another file, left alone`] : []),
    ];
    const outcome = removals.failed.length > 0 ? `${list(removals.failed)} written and could not be removed`
      : removals.kept.length > 0 ? `${list(removals.kept)} written and left in place, since ${targets[0].destination} is there and is not this run's file`
        : "nothing was written";
    return `${outcome}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
  };
  let interrupted = false;
  const stillRunning = () => { if (interrupted) throw new Error(`${label} was interrupted`); };
  const cleanUpSync = () => {
    for (const staging of stagings.values()) removeStagingSync(staging);
    releasePublishLockSync(lockPath, token);
  };
  const onSignal = (signal: NodeJS.Signals) => {
    interrupted = true;
    removeCreated();
    cleanUpSync();
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);
  try {
    try {
      await removeStaleStagings(targets[0].directory, stem);
      for (const directory of directories.slice(1)) await removeStaleStagings(directory, stem);
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
        if (staging === undefined) { staging = await mkdtemp(join(directory, `.publish-${stem}-${process.pid}-`)); stagings.set(directory, staging); }
        const file = join(staging, String(index));
        const handle = await openExclusiveFile(file, label);
        try { await handle.writeFile(bytes); await handle.sync(); stagedIds.set(index, await handle.stat({ bigint: true })); } finally { await handle.close(); }
        staged[index] = file;
      }
      stillRunning();
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
        const entry = { index, destination, target, file };
        created.push(entry);
        let linked = false;
        try {
          observe("link", destination);
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
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
    cleanUpSync();
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
