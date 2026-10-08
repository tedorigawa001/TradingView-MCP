import { constants, type Stats } from "node:fs";
import { link, lstat, mkdtemp, open, rm, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

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
 * Publishes `body` at `destination` as a new file and never replaces one already there (BACKLOG 102-25). The file is
 * written and synced in a fresh directory beside the destination and hard-linked into place, which fails if the name
 * is taken, so the destination never holds a partial file and a failed run leaves whatever was there as it was; the
 * staging directory is removed either way. When the name is taken, the file there is compared with `body`:
 * "identical" when it holds the same bytes, "different" otherwise, both left as they are for the caller to judge.
 * A symbolic link there is refused rather than followed.
 */
export async function publishImmutableFile(
  destination: string,
  body: string | Buffer,
  label: string,
): Promise<"created" | "identical" | "different"> {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const directory = dirname(destination);
  const staging = await mkdtemp(join(directory, ".publish-"));
  try {
    const staged = join(staging, "file");
    const handle = await openExclusiveFile(staged, label);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try {
      await link(staged, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return await holdsExactly(destination, bytes, label) ? "identical" : "different";
    }
    await syncDirectoryEntry(directory);
    return "created";
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function holdsExactly(path: string, bytes: Buffer, label: string): Promise<boolean> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) throw new Error(`${label} path must be a regular file, not a symbolic link`);
  if (!entry.isFile() || entry.size !== bytes.length) return false;
  const handle = await open(path, constants.O_RDONLY | noFollowFlag());
  try {
    return (await handle.readFile()).equals(bytes);
  } finally {
    await handle.close();
  }
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
