import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { lstat, link, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { posixModeEnforced, publishImmutableFile, readRegularFile, releaseLockFileSync, syncDirectoryEntry } from "./fsDurability.js";
import { canonical, nativeBarId } from "./nativeBarEvidence.js";

const run = promisify(execFile);
const aclCache = new Map<string, string>();

/** macOS mode bits do not include ACL grants. Accept only absent ACLs or parsed deny-only ACLs. */
export async function assertNativeBarAcl(path: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const before = await lstat(path, { bigint: true });
  const key = `${before.dev}:${before.ino}:${before.ctimeNs}:${before.mode}:${before.uid}:${before.gid}`;
  if (aclCache.get(path) === key) return;
  let stdout: string;
  try { ({ stdout } = await run("/bin/ls", ["-lde", path], { encoding: "utf8", timeout: 3000, maxBuffer: 65536,
    env: { ...process.env, LC_ALL: "C" } })); }
  catch { throw new Error("acl_unverified: cannot inspect macOS ACL"); }
  const lines = stdout.trimEnd().split("\n"), header = lines.shift()!;
  if (!/^[d-][rwxStTs-]{9}[+@ ]/.test(header)) throw new Error("acl_unverified: unexpected metadata format");
  if (header[10] === "+" && !lines.length) throw new Error("acl_unverified: missing ACL entries");
  for (const line of lines) {
    if (!/^\s*\d+: \S+(?: inherited)? deny [a-z_,]+$/.test(line)) {
      throw new Error("unsafe_acl: allow or unrecognized ACL entry; permissions are never repaired");
    }
  }
  const after = await lstat(path, { bigint: true });
  if (after.dev !== before.dev || after.ino !== before.ino || after.mode !== before.mode
    || after.uid !== before.uid || after.gid !== before.gid) throw new Error("acl_target_changed_during_inspection");
  // Directory entry churn changes ctime too: the parsed ACL is a snapshot, but must not be cached in that case.
  if (after.ctimeNs !== before.ctimeNs) return;
  if (aclCache.size >= 1024) aclCache.clear();
  aclCache.set(path, key);
}

async function lockOwner(path: string) {
  const st = await lstat(path).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
  if (!st) return null;
  if (!st.isFile() || st.uid !== process.getuid!() || (posixModeEnforced() && (st.mode & 0o077) !== 0) || st.size > 128) throw new Error("unsafe_writer_lock");
  const bytes = await readRegularFile(path, "native writer lock", 128);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return { st, bytes, dead: false }; }
  let dead = false;
  if (canonical(value) === bytes.toString("utf8") && Object.keys(value).sort().join() === "pid,token"
    && Number.isSafeInteger(value.pid) && value.pid > 0 && nativeBarId.safeParse(value.token).success) {
    try { process.kill(value.pid, 0); }
    catch (e) { dead = (e as NodeJS.ErrnoException).code === "ESRCH"; }
  }
  return { st, bytes, dead };
}

const processGone = (pid: number) => {
  try { process.kill(pid, 0); return false; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "ESRCH"; }
};
function releaseOwnOrAbsent(path: string, body: string) {
  try { lstatSync(path); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; throw e; }
  return releaseLockFileSync(path, (s) => s === body);
}

/** Lamport bakery ordering serializes stale-file takeovers as well as ordinary acquisitions. */
async function enterWriterQueue(directory: string, validate: (path: string) => Promise<void>, waitMs: number) {
  const id = randomUUID(), owner = { pid: process.pid, token: id }, body = canonical(owner);
  const claim = join(directory, `.writer-claim-${id}.json`), ticketPath = join(directory, `.writer-ticket-${id}.json`);
  let ticketBody: string | null = null;
  const leave = () => {
    const ticketReleased = ticketBody === null || releaseOwnOrAbsent(ticketPath, ticketBody);
    const claimReleased = releaseOwnOrAbsent(claim, body);
    if (!ticketReleased || !claimReleased) throw new Error("writer_queue_release_failed");
  };
  const scan = async () => {
    const names = await readdir(directory);
    if (names.length > 30000) throw new Error("store_entry_limit");
    const contenders: { id: string; ticket: number | null }[] = [];
    for (const name of names) {
      const match = /^\.writer-claim-([0-9a-f-]{36})\.json$/.exec(name);
      if (!match || match[1] === id || !nativeBarId.safeParse(match[1]).success) continue;
      const path = join(directory, name);
      let bytes: Buffer;
      try { await validate(path); bytes = await readRegularFile(path, "native writer claim", 128); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
      const other = JSON.parse(bytes.toString("utf8"));
      if (canonical(other) !== bytes.toString("utf8") || Object.keys(other).sort().join() !== "pid,token"
        || other.token !== match[1] || !Number.isSafeInteger(other.pid) || other.pid < 1) throw new Error("writer_claim_corrupt");
      if (processGone(other.pid)) continue;
      const numbered = join(directory, `.writer-ticket-${match[1]}.json`);
      let ticket: number | null = null;
      try {
        await validate(numbered);
        const b = await readRegularFile(numbered, "native writer ticket", 128), n = JSON.parse(b.toString("utf8"));
        if (canonical(n) !== b.toString("utf8") || Object.keys(n).sort().join() !== "pid,ticket,token"
          || n.pid !== other.pid || n.token !== other.token || !Number.isSafeInteger(n.ticket) || n.ticket < 1) throw new Error("writer_ticket_corrupt");
        ticket = n.ticket;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      contenders.push({ id: match[1], ticket });
    }
    return contenders;
  };
  await validate(claim);
  if (await publishImmutableFile(claim, body, "native writer claim") !== "created") throw new Error("writer_claim_conflict");
  try {
    const others = await scan(), ticket = Math.max(0, ...others.map((c) => c.ticket ?? 0)) + 1;
    if (!Number.isSafeInteger(ticket)) throw new Error("writer_ticket_exhausted");
    ticketBody = canonical({ ...owner, ticket });
    await validate(ticketPath);
    if (await publishImmutableFile(ticketPath, ticketBody, "native writer ticket") !== "created") throw new Error("writer_ticket_conflict");
    const started = performance.now();
    for (;;) {
      const blockers = (await scan()).some((c) => c.ticket === null || c.ticket < ticket || (c.ticket === ticket && c.id < id));
      if (!blockers) return leave;
      if (performance.now() - started >= waitMs) throw new Error("store_lock_busy: active writer queue; charts not touched");
      await new Promise((r) => setTimeout(r, 20));
    }
  } catch (e) { leave(); throw e; }
}

/** Retire, never unlink, a proven-dead coordination file. Unexpected replacements remain recoverable. */
async function retireDead(path: string) {
  const judged = await lockOwner(path);
  if (!judged?.dead) return false;
  const retired = join(dirname(path), `.writer-retired-${randomUUID()}.lock`);
  await rename(path, retired);
  const moved = await lockOwner(retired);
  if (!moved || moved.st.dev !== judged.st.dev || moved.st.ino !== judged.st.ino || !moved.bytes.equals(judged.bytes) || !moved.dead) {
    await link(retired, path).catch(() => undefined);
    throw new Error("writer_lock_changed: retired entry preserved; no collection");
  }
  await syncDirectoryEntry(dirname(path));
  return true;
}

/** Atomic whole-file publication; age never authorizes takeover, including the takeover marker. */
async function takeWriterFile(directory: string, validate: (path: string) => Promise<void>, waitMs: number) {
  const path = join(directory, ".writer.lock"), marker = join(directory, ".writer.takeover");
  const token = canonical({ pid: process.pid, token: randomUUID() }), started = performance.now();
  for (let attempt = 0; attempt < 16; attempt++) {
    await validate(path); await validate(marker);
    const gate = await lockOwner(marker);
    if (gate?.dead) { await retireDead(marker); continue; }
    if (!gate && await publishImmutableFile(path, token, "native bar writer") === "created") {
      if (!(await lockOwner(marker))) return { release: () => releaseLockFileSync(path, (s) => s === token) };
      if (!releaseLockFileSync(path, (s) => s === token)) throw new Error("store_lock_release_failed");
    } else if (!gate && (await lockOwner(path))?.dead) {
      if (await publishImmutableFile(marker, token, "native bar writer takeover") === "created") {
        try { await retireDead(path); }
        finally { if (!releaseLockFileSync(marker, (s) => s === token)) throw new Error("store_takeover_release_failed"); }
        continue;
      }
    }
    if (performance.now() - started >= waitMs) throw new Error("store_lock_busy: live or unknown owner; charts not touched");
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("store_lock_busy: coordination files kept changing; charts not touched");
}

export async function takeNativeWriterLock(directory: string, validate: (path: string) => Promise<void>, waitMs: number) {
  if (!posixModeEnforced()) throw new Error("private_access_unverified: writer coordination requires verified POSIX access");
  const started = performance.now(), leave = await enterWriterQueue(directory, validate, waitMs);
  try {
    const lock = await takeWriterFile(directory, validate, Math.max(0, waitMs - (performance.now() - started)));
    return { release: () => { try { return lock.release(); } finally { leave(); } } };
  } catch (e) { leave(); throw e; }
}
