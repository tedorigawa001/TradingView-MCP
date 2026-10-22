import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, link, readdir, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { posixModeEnforced, publishImmutableFile, readRegularFile, releaseLockFileSync, syncDirectoryEntry } from "./fsDurability.js";
import { canonical, nativeBarId } from "./nativeBarEvidence.js";

const run = promisify(execFile);
// Keyed by object identity, sized above the store's 30,000-entry bound so a full store never thrashes it.
const aclCache = new Map<string, string>();
const ACL_CACHE_LIMIT = 65536;
const aclKey = (st: BigIntStats) => `${st.dev}:${st.ino}`;
const aclStamp = (st: BigIntStats) => `${st.ctimeNs}:${st.mode}:${st.uid}:${st.gid}`;

type AclListing = { plus: boolean; lines: string[] };
/** One bounded `ls -lde` without a shell; each header must end with exactly one requested operand. */
async function listAcls(operands: string[], cwd?: string): Promise<Map<string, AclListing>> {
  let stdout: string;
  try { ({ stdout } = await run("/bin/ls", ["-lde", "--", ...operands], { cwd, encoding: "utf8", timeout: 10000,
    maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } })); }
  catch { throw new Error("acl_unverified: cannot inspect macOS ACL"); }
  const listed = new Map<string, AclListing>();
  let current: AclListing | null = null;
  for (const line of stdout.trimEnd().split("\n")) {
    if (/^\s/.test(line)) {
      if (!current) throw new Error("acl_unverified: unexpected metadata format");
      current.lines.push(line); continue;
    }
    const name = operands.find((o) => line.endsWith(` ${o}`));
    if (!/^[d-][rwxStTs-]{9}[+@ ]/.test(line) || !name || listed.has(name)) throw new Error("acl_unverified: unexpected metadata format");
    current = { plus: line[10] === "+", lines: [] };
    listed.set(name, current);
  }
  if (listed.size !== operands.length) throw new Error("acl_unverified: unexpected metadata format");
  return listed;
}
function assertDenyOnly(acl: AclListing) {
  if (acl.plus && !acl.lines.length) throw new Error("acl_unverified: missing ACL entries");
  for (const line of acl.lines) {
    if (!/^\s*\d+: \S+(?: inherited)? deny [a-z_,]+$/.test(line)) {
      throw new Error("unsafe_acl: allow or unrecognized ACL entry; permissions are never repaired");
    }
  }
}
async function rememberAcl(path: string, before: BigIntStats) {
  const after = await lstat(path, { bigint: true });
  if (after.dev !== before.dev || after.ino !== before.ino || after.mode !== before.mode
    || after.uid !== before.uid || after.gid !== before.gid) throw new Error("acl_target_changed_during_inspection");
  // Directory entry churn changes ctime too: the parsed ACL is a snapshot, but must not be cached in that case.
  if (after.ctimeNs !== before.ctimeNs) return;
  aclCache.delete(aclKey(before));
  if (aclCache.size >= ACL_CACHE_LIMIT) aclCache.delete(aclCache.keys().next().value!);
  aclCache.set(aclKey(before), aclStamp(before));
}

/** macOS mode bits do not include ACL grants. Accept only absent ACLs or parsed deny-only ACLs. */
export async function assertNativeBarAcl(path: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const before = await lstat(path, { bigint: true });
  if (aclCache.get(aclKey(before)) === aclStamp(before)) return;
  assertDenyOnly((await listAcls([path])).get(path)!);
  await rememberAcl(path, before);
}

/** Checks many plain-named files of one directory with one listing per 256 names instead of one process per file. */
export async function primeNativeBarAcls(directory: string, names: string[]): Promise<void> {
  if (process.platform !== "darwin") return;
  const pending: { name: string; before: BigIntStats }[] = [];
  for (const name of names) {
    // Anything else keeps the single-path check, so a listed name can never be ambiguous.
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(name)) continue;
    const before = await lstat(join(directory, name), { bigint: true }).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
    if (before && aclCache.get(aclKey(before)) !== aclStamp(before)) pending.push({ name, before });
  }
  for (let i = 0; i < pending.length; i += 256) {
    const chunk = pending.slice(i, i + 256), listed = await listAcls(chunk.map((c) => c.name), directory);
    for (const { name, before } of chunk) {
      assertDenyOnly(listed.get(name)!);
      await rememberAcl(join(directory, name), before);
    }
  }
}

type Owner = { pid: number; token: string; boot?: string | null; start?: string | null };
type Incarnation = { boot: string | null; start: string | null };
let ownIncarnation: Promise<Incarnation> | null = null;
// Identities are compared only for equality, so a short digest keeps every owner file within the 128-byte lock limit.
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);

async function bootSession(): Promise<string | null> {
  try {
    const value = process.platform === "darwin"
      ? (await run("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8", timeout: 3000, maxBuffer: 4096 })).stdout
      : process.platform === "linux" ? (await readRegularFile("/proc/sys/kernel/random/boot_id", "boot session", 4096)).toString("utf8") : "";
    const id = value.trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? digest(id) : null;
  } catch { return null; }
}

/**
 * Start identities of the PIDs that exist now, or null when they cannot be read. Our own PID is always included, so
 * an unusable source reads as "unknown", never as "every other owner has exited".
 */
async function startTimes(pids: number[]): Promise<Map<number, string> | null> {
  const wanted = [...new Set([process.pid, ...pids])], found = new Map<number, string>();
  if (process.platform === "linux") {
    for (const pid of wanted) {
      try {
        // Field 22, start time in clock ticks since boot; unlike a wall-clock rendering it survives clock steps.
        const stat = (await readRegularFile(`/proc/${pid}/stat`, "process start", 4096)).toString("utf8"), ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
        if (/^\d+$/.test(ticks ?? "")) found.set(pid, digest(ticks));
      } catch (e) { if (!["ENOENT", "ESRCH"].includes((e as NodeJS.ErrnoException).code ?? "")) return null; }
    }
  } else if (process.platform === "darwin") {
    let stdout = "";
    // A fixed zone and locale keep one process's rendering identical in every MCP server that reads it.
    try { ({ stdout } = await run("/bin/ps", ["-o", "pid=,lstart=", "-p", wanted.join(",")], { encoding: "utf8", timeout: 3000,
      maxBuffer: 65536, env: { ...process.env, LC_ALL: "C", TZ: "UTC0" } })); }
    catch (e) { const out = (e as { stdout?: unknown }).stdout; stdout = typeof out === "string" ? out : ""; }
    for (const line of stdout.split("\n")) {
      const match = /^\s*(\d+)\s+(\S.*\S)\s*$/.exec(line);
      if (match) found.set(Number(match[1]), digest(match[2].replace(/\s+/g, " ")));
    }
  } else return null;
  return found.has(process.pid) ? found : null;
}

function incarnation() {
  ownIncarnation ??= (async () => ({ boot: await bootSession(), start: (await startTimes([]))?.get(process.pid) ?? null }))();
  return ownIncarnation;
}

/** Owner files are `{pid,token}` (earlier builds) or `{boot,pid,start,token}`, each optionally with the named extra keys. */
function parseOwner(text: string, extra: string[] = []): (Owner & Record<string, unknown>) | null {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || canonical(value) !== text) return null;
  const keys = Object.keys(value).sort().join(), modern = keys === ["boot", "pid", "start", "token", ...extra].sort().join();
  if (!modern && keys !== ["pid", "token", ...extra].sort().join()) return null;
  if (!Number.isSafeInteger(value.pid) || value.pid < 1 || !nativeBarId.safeParse(value.token).success) return null;
  if (modern && ![value.boot, value.start].every((v) => v === null || (typeof v === "string" && /^[0-9a-f]{12}$/.test(v)))) return null;
  return value;
}

const deadOwners = new Set<string>();
/**
 * Dead means proven gone: ESRCH, another boot session, or a different process now holding that PID. A suspended
 * process, permission denial, unreadable start identity or an earlier-build owner on a reused PID stays alive.
 */
async function ownersDead(owners: Owner[]): Promise<boolean[]> {
  const me = await incarnation();
  const verdicts = owners.map((o): boolean | null => {
    if (deadOwners.has(canonical(o)) || (o.boot && me.boot && o.boot !== me.boot)) return true;
    try { process.kill(o.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") return true; }
    return o.start ? null : false;
  });
  const starts = verdicts.includes(null) ? await startTimes(owners.filter((_, i) => verdicts[i] === null).map((o) => o.pid)) : null;
  return owners.map((o, i) => {
    const dead = verdicts[i] ?? (starts !== null && starts.get(o.pid) !== o.start);
    if (dead) {
      if (deadOwners.size >= 4096) deadOwners.clear();
      deadOwners.add(canonical(o));
    }
    return dead;
  });
}

async function ownerBody(token: string) {
  const me = await incarnation();
  return { boot: me.boot, pid: process.pid, start: me.start, token };
}

async function lockOwner(path: string) {
  const st = await lstat(path).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
  if (!st) return null;
  if (!st.isFile() || st.uid !== process.getuid!() || (posixModeEnforced() && (st.mode & 0o077) !== 0) || st.size > 256) throw new Error("unsafe_writer_lock");
  const bytes = await readRegularFile(path, "native writer lock", 256), owner = parseOwner(bytes.toString("utf8"));
  return { st, bytes, dead: owner ? (await ownersDead([owner]))[0] : false };
}

function releaseOwnOrAbsent(path: string, body: string) {
  try { lstatSync(path); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; throw e; }
  return releaseLockFileSync(path, (s) => s === body);
}
/** Runs cleanup after a failure without letting a cleanup failure hide the original error. */
function rethrowAfter(error: unknown, cleanup: () => void): never {
  try { cleanup(); }
  catch (failure) { throw new Error(`${(error as Error).message}; also ${(failure as Error).message}`, { cause: error }); }
  throw error;
}

/** Lamport bakery ordering serializes stale-file takeovers as well as ordinary acquisitions. */
async function enterWriterQueue(directory: string, validate: (path: string) => Promise<void>, waitMs: number) {
  const id = randomUUID(), owner = await ownerBody(id), body = canonical(owner);
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
    const claims: { id: string; owner: Owner }[] = [];
    for (const name of names) {
      const match = /^\.writer-claim-([0-9a-f-]{36})\.json$/.exec(name);
      if (!match || match[1] === id || !nativeBarId.safeParse(match[1]).success) continue;
      const path = join(directory, name);
      let bytes: Buffer;
      try { await validate(path); bytes = await readRegularFile(path, "native writer claim", 256); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
      const other = parseOwner(bytes.toString("utf8"));
      if (!other || other.token !== match[1]) throw new Error("writer_claim_corrupt");
      claims.push({ id: match[1], owner: other });
    }
    // Dead claims are skipped, never renamed or deleted here; they stay until an exact cleanup decision.
    const dead = await ownersDead(claims.map((c) => c.owner));
    const contenders: { id: string; ticket: number | null }[] = [];
    for (const [i, c] of claims.entries()) {
      if (dead[i]) continue;
      const numbered = join(directory, `.writer-ticket-${c.id}.json`);
      let ticket: number | null = null;
      try {
        await validate(numbered);
        const b = await readRegularFile(numbered, "native writer ticket", 256), n = parseOwner(b.toString("utf8"), ["ticket"]);
        if (!n) throw new Error("writer_ticket_corrupt");
        const { ticket: value, ...rest } = n;
        if (canonical(rest) !== canonical(c.owner) || !Number.isSafeInteger(value) || (value as number) < 1) throw new Error("writer_ticket_corrupt");
        ticket = value as number;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      contenders.push({ id: c.id, ticket });
    }
    return contenders;
  };
  await validate(claim);
  if (await publishImmutableFile(claim, body, "native writer claim") !== "created") throw new Error("writer_claim_conflict");
  try {
    const others = await scan(), ticket = Math.max(0, ...others.map((c) => c.ticket ?? 0)) + 1;
    // Release reads at most 128 bytes, so a larger body could never be removed by its owner.
    if (!Number.isSafeInteger(ticket) || Buffer.byteLength(canonical({ ...owner, ticket })) > 128) throw new Error("writer_ticket_exhausted");
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
  } catch (e) { rethrowAfter(e, leave); }
}

/** Retire, never unlink, a proven-dead coordination file. Unexpected replacements remain recoverable. */
async function retireDead(path: string) {
  const judged = await lockOwner(path);
  if (!judged?.dead) return false;
  const retired = join(dirname(path), `.writer-retired-${randomUUID()}.lock`);
  await rename(path, retired);
  const moved = await lockOwner(retired);
  if (!moved || moved.st.dev !== judged.st.dev || moved.st.ino !== judged.st.ino || !moved.bytes.equals(judged.bytes) || !moved.dead) {
    const restored = await link(retired, path).then(() => true, () => false);
    throw new Error(restored ? "writer_lock_changed: retired entry preserved; no collection"
      : `writer_lock_displaced: an unexpected live entry is preserved as ${basename(retired)}; stop every MCP server before recording`);
  }
  await syncDirectoryEntry(dirname(path));
  return true;
}

/** Atomic whole-file publication; age never authorizes takeover, including the takeover marker. */
async function takeWriterFile(directory: string, validate: (path: string) => Promise<void>, waitMs: number) {
  const path = join(directory, ".writer.lock"), marker = join(directory, ".writer.takeover");
  const token = canonical(await ownerBody(randomUUID())), started = performance.now();
  // Waiting on a live owner is bounded by waitMs; only repeated takeovers are bounded by count.
  for (let takeovers = 0; takeovers < 16;) {
    await validate(path); await validate(marker);
    const gate = await lockOwner(marker);
    if (gate?.dead) { await retireDead(marker); takeovers++; continue; }
    if (!gate && await publishImmutableFile(path, token, "native bar writer") === "created") {
      if (!(await lockOwner(marker))) return { release: () => releaseLockFileSync(path, (s) => s === token) };
      if (!releaseLockFileSync(path, (s) => s === token)) throw new Error("store_lock_release_failed");
    } else if (!gate && (await lockOwner(path))?.dead) {
      if (await publishImmutableFile(marker, token, "native bar writer takeover") === "created") {
        const releaseMarker = () => { if (!releaseLockFileSync(marker, (s) => s === token)) throw new Error("store_takeover_release_failed"); };
        try { await retireDead(path); } catch (e) { rethrowAfter(e, releaseMarker); }
        releaseMarker(); takeovers++;
        continue;
      }
    }
    if (performance.now() - started >= waitMs) throw new Error("store_lock_busy: live or unknown owner; charts not touched");
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("store_lock_busy: coordination files kept changing; charts not touched");
}

/** `release` reports success; it never throws, so a failed release cannot hide what the locked work already did. */
export async function takeNativeWriterLock(directory: string, validate: (path: string) => Promise<void>, waitMs: number) {
  if (!posixModeEnforced()) throw new Error("private_access_unverified: writer coordination requires verified POSIX access");
  const started = performance.now(), leave = await enterWriterQueue(directory, validate, waitMs);
  try {
    const lock = await takeWriterFile(directory, validate, Math.max(0, waitMs - (performance.now() - started)));
    return { release: () => {
      let released = false;
      try { released = lock.release(); } catch { /* reported as false */ }
      try { leave(); } catch { released = false; }
      return released;
    } };
  } catch (e) { rethrowAfter(e, leave); }
}
