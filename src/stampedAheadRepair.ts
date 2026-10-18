import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, unlinkSync, type Stats } from "node:fs";
import { lstat, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { lockOwnerSync, openExclusiveFile, posixModeEnforced, readRegularFile, syncDirectoryEntry } from "./fsDurability.js";

/**
 * The repair of a first-seen log's records stamped ahead of the clock (BACKLOG 103-11), for any store whose append
 * refuses a record stamped before its latest: AppendOnlyFirstSeenLog's stores and the macro-surprise evidence store.
 * The store supplies how it reads and validates its log, how it would read a rewritten one, and one attempt at its lock;
 * the rest is here, the same for every store. Nothing here appends.
 */

/** A record of such a log: its position and its first-seen stamp, which never decreases along the log. */
export type StampedRecord = { sequence: number; first_seen_at: string };

/** What a store supplies: its log, read and validated as the store reads it, raw bytes included; and its lock. */
export type StampedAheadSource<T extends StampedRecord> = {
  readonly label: string;
  readonly path: string;
  /** The store's lock file, for a message about one a killed run left. */
  readonly lockPath: string;
  /**
   * How old a lock naming no process must be before the store's own writer takes it over (the macro-surprise store's
   * rule; its tryLock takes it over the same way). A store without one never takes a lock over, and names its process.
   */
  readonly lockStaleMs?: number;
  /** The log as the store reads it, with every check: its records, each record's own line as decoded, the raw bytes, its identity (null when there is no log). */
  read(): Promise<{ records: T[]; lines: string[]; raw: Buffer; identity: Stats | null }>;
  /** A file at `path` read as the log would be, with every check. */
  readBack(path: string): Promise<T[]>;
  /** One attempt at the store's lock, never waiting: its synchronous release, or null when another holds it. */
  tryLock(): Promise<{ releaseSync(): void } | null>;
};

/**
 * What a store's lock file shows of its holder (BACKLOG 103-11 review): `held`, it names a process that is running;
 * `gone`, it names a process that is not, so a run killed while it held the lock left it; `stale`, it names no process
 * and is older than the store's own takeover age (lockStaleMs), so the store's next writer takes it over; `unknown`, it
 * names no process and is younger than that, or the store takes no lock over, so whether its holder still runs cannot be
 * told: it is never called a killed run's.
 */
export type StampedAheadLockState = { path: string; pid: number | null; state: "held" | "gone" | "stale" | "unknown"; staleMs: number | null };

/** The state of a source's lock file (StampedAheadLockState), or null when nothing there is a lock of this user's. */
export function stampedAheadLockState(source: Pick<StampedAheadSource<StampedRecord>, "lockPath" | "lockStaleMs">): StampedAheadLockState | null {
  const owner = lockOwnerSync(source.lockPath);
  if (owner === null) return null;
  const staleMs = source.lockStaleMs ?? null;
  if (owner.pid !== null) return { path: source.lockPath, pid: owner.pid, state: owner.alive ? "held" : "gone", staleMs };
  return { path: source.lockPath, pid: null, state: staleMs !== null && Date.now() - owner.mtimeMs > staleMs ? "stale" : "unknown", staleMs };
}

/**
 * A log as a repair found it: every record, each record's line, the raw bytes and where each record's line starts in
 * them, the file's identity (null when there is no log), and `keep`, how many records stay: the records from `keep` on
 * are moved (planStampedAhead sets it to the tail stamped ahead; a caller may move more, never fewer). `leftovers` are
 * what an interrupted repair of this log may have left beside it: temporary files, sidecars whose every record the log
 * still holds, and a lock whose holder is gone or stale (never one whose holder cannot be told). `earlierSidecars` are
 * the other sidecars beside it, those of earlier repairs, whose records the log no longer holds.
 */
export type StampedAheadPlan<T extends StampedRecord> = {
  readonly label: string; readonly path: string; readonly records: readonly T[]; readonly lines: readonly string[];
  readonly raw: Buffer; readonly starts: readonly number[]; readonly identity: Stats | null; readonly keep: number;
  readonly leftovers: { temporaries: string[]; sidecars: string[]; staleLock: StampedAheadLockState | null };
  readonly earlierSidecars: string[];
};

/** What tradingview-mcp-repair-first-seen does with a store's log: its source, a plan of it, and moving the tail out. */
export type StampedAheadRepair<T extends StampedRecord> = StampedAheadSource<T> & {
  plan(now: Date, toleranceMs: number): Promise<StampedAheadPlan<T>>;
  apply(plan: StampedAheadPlan<T>, now: Date, interrupted?: () => boolean): Promise<StampedAheadApplied>;
};

/** What an apply did: the sidecar holding the tail (written now, or one an interrupted repair wrote), the records kept, and the leftovers removed. */
export type StampedAheadApplied = { sidecar: string; reused: boolean; kept: number; removedTemporaries: string[] };

/** A repair stopped by a signal at a point where it could stop cleanly: nothing in the log was changed. */
export class StampedAheadInterrupted extends Error {}

/** The first name a repair's sidecar takes: `<log>.ahead-<now, ISO 8601 basic>.jsonl`, with no colon, so Windows takes it too. */
export const stampedAheadSidecarPath = (path: string, now: Date) => `${path}.ahead-${now.toISOString().replace(/[-:]/g, "")}.jsonl`;
const sidecarName = (path: string) => new RegExp(`^${basename(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.ahead-[0-9TZ.]+(?:-\\d+)?\\.jsonl$`);
const temporaryName = (path: string) => new RegExp(`^\\.${basename(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.repair-[0-9a-f-]{36}\\.tmp$`);

/** The lines of `bytes`, each with its newline, for comparing records byte for byte. */
const linesOf = (bytes: Buffer) => { const out: string[] = []; let from = 0; for (let index = 0; index < bytes.length; index += 1) if (bytes[index] === 0x0a) { out.push(bytes.subarray(from, index + 1).toString("latin1")); from = index + 1; } return out; };

/** This user's regular files beside `path` whose names match `pattern`. */
function filesBeside(path: string, pattern: RegExp): string[] {
  let names: string[];
  try { names = readdirSync(dirname(path)); } catch { return []; }
  return names.filter((name) => pattern.test(name)).map((name) => join(dirname(path), name)).filter((file) => {
    try {
      const entry = lstatSync(file);
      return entry.isFile() && (typeof process.getuid !== "function" || entry.uid === process.getuid());
    } catch { return false; }
  }).sort();
}

/**
 * Reads the log as its store does, with every check, and finds the tail of records whose first-seen stamp is more than
 * `toleranceMs` after `now`. Stamps never decrease in a log that reads, so that is a tail; it is checked all the same. The
 * log must be framed exactly as its store writes it, judged on its raw bytes: each record on a line of its own ending in
 * a newline, nothing else, so the kept records and the tail can be cut at a newline byte and written back byte for byte
 * (BACKLOG 103-11 review: a record holding bytes that are not UTF-8 came back changed when rewritten from its decoded
 * text). It also notes what an interrupted repair may have left: temporary files, sidecars whose every record the log
 * still holds (an earlier repair's sidecar holds records the log no longer does: it is listed apart), and a lock whose
 * holder is gone, or stale by the store's own rule (stampedAheadLockState). Takes no lock: read under the store's lock
 * for an apply, or alone for a dry run.
 */
export async function planStampedAhead<T extends StampedRecord>(source: StampedAheadSource<T>, now: Date, toleranceMs: number): Promise<StampedAheadPlan<T>> {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(toleranceMs) || toleranceMs < 0) throw new Error(`${source.label} repair needs a valid time and tolerance`);
  const { records, lines, raw, identity } = await source.read();
  const starts = [0];
  for (let index = 0; index < raw.length; index += 1) if (raw[index] === 0x0a) starts.push(index + 1);
  const framed = identity === null || (raw.length === 0 ? lines.length === 0
    : raw[raw.length - 1] === 0x0a && starts.length - 1 === lines.length && lines.every((line, index) => raw.subarray(starts[index], starts[index + 1] - 1).toString("utf8") === line));
  if (!framed) {
    throw new Error(`${source.label} history is not framed as the store writes it (one record per line, each ending in a newline, nothing else): `
      + `${source.path}; settle it by hand; nothing in it was changed`);
  }
  const ahead = (record: T) => Date.parse(record.first_seen_at) - now.getTime() > toleranceMs;
  let keep = records.length;
  while (keep > 0 && ahead(records[keep - 1])) keep -= 1;
  if (records.slice(0, keep).some(ahead)) throw new Error(`${source.label} history holds records stamped ahead that are not its tail: ${source.path}; nothing in it was changed`);
  const lock = stampedAheadLockState(source);
  // A sidecar whose every record the log still holds is an interrupted repair's copy of a tail; one larger than the log,
  // or holding a record the log does not, is an earlier repair's (BACKLOG 103-11 review).
  const logLines = new Set(linesOf(raw));
  const sidecars: string[] = [], earlierSidecars: string[] = [];
  for (const file of filesBeside(source.path, sidecarName(source.path))) {
    let bytes: Buffer | null = null;
    try { bytes = await readRegularFile(file, `${source.label} sidecar`, raw.length); } catch { /* larger than the log, or not a file to read */ }
    const held = bytes !== null && bytes.length > 0 && bytes[bytes.length - 1] === 0x0a && linesOf(bytes).every((line) => logLines.has(line));
    (held ? sidecars : earlierSidecars).push(file);
  }
  return {
    label: source.label, path: source.path, records, lines, raw, starts, identity, keep,
    leftovers: { temporaries: filesBeside(source.path, temporaryName(source.path)), sidecars,
      staleLock: lock !== null && (lock.state === "gone" || lock.state === "stale") ? lock : null },
    earlierSidecars,
  };
}

/**
 * With the store's lock held and a plan made under that same hold, moves the tail stamped ahead out of the log. The
 * log must still be the file that was read (identity, size, mtime) before anything is written and before the rename.
 * Temporary files an interrupted repair left are removed first (under the lock no other repair can be writing one). A
 * sidecar an interrupted repair left that already holds exactly the tail's bytes is used as the tail's sidecar, so
 * running again after a kill writes no second copy; one holding some of the tail's records but not exactly them is
 * refused, to be looked at. Otherwise the tail's bytes go to a new sidecar `<log>.ahead-<now>.jsonl` (`-2`, `-3` ...
 * when the name is taken; exclusive create, owner-only 0600, synced with its directory entry). The kept bytes go to a new
 * file beside the log, with the log's mode, synced, which must read back as the store reads it, the kept records with
 * their sequences from 1; it is renamed over the log and the directory synced. The raw bytes are cut at a newline, so
 * every kept and moved record is written back byte for byte. `interrupted` is asked before each step that writes: a
 * signal there stops the repair, removing what it wrote, with nothing in the log changed. Anything that fails before the
 * rename removes what this repair wrote and says nothing in the log was changed. Windows has no POSIX mode or directory
 * sync, as appendUnlocked has none there.
 */
export async function applyStampedAhead<T extends StampedRecord>(source: StampedAheadSource<T>, plan: StampedAheadPlan<T>, now: Date,
  interrupted: () => boolean = () => false): Promise<StampedAheadApplied> {
  const identity = plan.identity;
  const unchangedNote = `nothing in ${source.path} was changed`;
  if (plan.path !== source.path || identity === null || plan.keep >= plan.records.length) throw new Error(`${source.label} repair has nothing stamped ahead to move: ${unchangedNote}`);
  const directory = dirname(source.path);
  const unchanged = async () => {
    const current = await lstat(source.path).catch(() => null);
    return current !== null && current.isFile() && current.dev === identity.dev && current.ino === identity.ino && current.size === identity.size && current.mtimeMs === identity.mtimeMs;
  };
  const cut = plan.starts[plan.keep];
  const keptBytes = plan.raw.subarray(0, cut), tailBytes = plan.raw.subarray(cut);
  const written: { path: string; stat: Stats }[] = [];
  const writeNew = async (path: string, bytes: Buffer, mode: number) => {
    const handle = await openExclusiveFile(path, `${source.label} repair`);
    try {
      written.push({ path, stat: await handle.stat() });
      await handle.writeFile(bytes);
      if (posixModeEnforced()) await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
  };
  const removeWritten = async () => {
    for (const { path, stat } of written.splice(0)) {
      const current = await lstat(path).catch(() => null);
      if (current !== null && current.dev === stat.dev && current.ino === stat.ino) await unlink(path).catch(() => undefined);
    }
  };
  const checkpoint = () => { if (interrupted()) throw new StampedAheadInterrupted(`${source.label} repair was interrupted`); };
  const removedTemporaries: string[] = [];
  let sidecar = "", reused = false, renamed = false;
  try {
    if (!(await unchanged())) throw new Error(`${source.label} history changed after the repair read it`);
    for (const temporary of filesBeside(source.path, temporaryName(source.path))) {
      try { unlinkSync(temporary); removedTemporaries.push(temporary); } catch { /* left */ }
    }
    const tailLines = new Set(linesOf(tailBytes));
    for (const existing of filesBeside(source.path, sidecarName(source.path))) {
      const bytes = await readRegularFile(existing, `${source.label} sidecar`);
      if (bytes.equals(tailBytes)) { sidecar = existing; reused = true; break; }
      if (linesOf(bytes).some((line) => tailLines.has(line))) {
        throw new Error(`the sidecar ${existing}, which an interrupted repair may have left, holds some of the records stamped ahead but not exactly them; look at it and move it aside, then run the repair again`);
      }
    }
    checkpoint();
    if (!reused) {
      for (let attempt = 1; ; attempt += 1) {
        const name = attempt === 1 ? stampedAheadSidecarPath(source.path, now) : stampedAheadSidecarPath(source.path, now).replace(/\.jsonl$/, `-${attempt}.jsonl`);
        try { await writeNew(name, tailBytes, 0o600); sidecar = name; break; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 20) throw error;
        }
      }
      await syncDirectoryEntry(directory);
    }
    checkpoint();
    const temporary = join(directory, `.${basename(source.path)}.repair-${randomUUID()}.tmp`);
    await writeNew(temporary, keptBytes, identity.mode & 0o777);
    const rewritten = await source.readBack(temporary);
    if (rewritten.length !== plan.keep || rewritten.at(-1)?.sequence !== plan.records[plan.keep - 1]?.sequence) throw new Error(`${source.label} history rewritten without its tail does not read back as its kept records`);
    checkpoint();
    if (!(await unchanged())) throw new Error(`${source.label} history changed after the repair read it`);
    await rename(temporary, source.path);
    renamed = true;
    written.splice(written.findIndex((item) => item.path === temporary), 1);
    await syncDirectoryEntry(directory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (renamed) throw new Error(`${source.label} history ${source.path} was rewritten without its records stamped ahead, which are in ${sidecar}, but syncing its directory failed (${message})`, { cause: error });
    await removeWritten();
    if (error instanceof StampedAheadInterrupted) throw new StampedAheadInterrupted(`${message}: ${unchangedNote}`, { cause: error });
    throw new Error(`${source.label} repair failed (${message}): ${unchangedNote}`, { cause: error });
  }
  const kept = await source.read();
  return { sidecar, reused, kept: kept.records.length, removedTemporaries };
}

/** A source's StampedAheadRepair. */
export function stampedAheadRepairOf<T extends StampedRecord>(source: StampedAheadSource<T>): StampedAheadRepair<T> {
  return {
    ...source,
    read: () => source.read(),
    readBack: (path) => source.readBack(path),
    tryLock: () => source.tryLock(),
    plan: (now, toleranceMs) => planStampedAhead(source, now, toleranceMs),
    apply: (plan, now, interrupted) => applyStampedAhead(source, plan, now, interrupted),
  };
}
