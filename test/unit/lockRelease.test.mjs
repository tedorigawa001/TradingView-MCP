// BACKLOG 102-39: Windows refuses to create, open or inspect a lock file it is still deleting, with EPERM or EACCES.
// Every lock loop must wait on that as on a lock that is held, and only on Windows. The faults are injected into
// node:fs/promises, whose live bindings the stores read, and the platform is set per test.
import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog } from "../../build/firstSeenStore.js";
import { AnalysisJournalStore } from "../../build/analysisJournal.js";
import { AppendOnlyEvaluationLog } from "../../build/evaluationLog.js";
import { StrategyResearchJournalStore } from "../../build/strategyResearchJournal.js";
import { MacroSurpriseEvidenceStore } from "../../build/macroSurpriseEvidence.js";
import { ChartOperationLock } from "../../build/chartOperationLock.js";
import { inspectLockFile, lockBeingReleased } from "../../build/fsDurability.js";

const fsp = createRequire(import.meta.url)("node:fs/promises");
const real = { open: fsp.open, lstat: fsp.lstat, unlink: fsp.unlink };
/**
 * Faults for one lock path, each list taken in order: `create` for its exclusive create, `inspect` for an lstat that
 * follows a create finding the lock taken, `read` for opening it to read, and `reread` for an lstat that follows such
 * an open (a stale lock's reclaim checking it is still the one it read). When `inspect` runs out, the held lock is
 * removed, as the deletion Windows was finishing completes.
 */
let plan = null;
const fault = (code) => Object.assign(new Error(`${code}: injected`), { code });
fsp.open = async (path, flags, ...rest) => {
  if (plan && String(path) === plan.path) {
    const exclusive = typeof flags === "number" && (flags & constants.O_EXCL) !== 0;
    const code = (exclusive ? plan.create : plan.read).shift();
    if (code) throw fault(code);
    try {
      const handle = await real.open(path, flags, ...rest);
      if (!exclusive) plan.opened = true;
      return handle;
    } catch (error) {
      if (exclusive && error.code === "EEXIST") plan.armed = true;
      throw error;
    }
  }
  return real.open(path, flags, ...rest);
};
fsp.lstat = async (path, ...rest) => {
  if (plan?.armed && String(path) === plan.path && plan.inspect.length > 0) {
    plan.armed = false;
    const code = plan.inspect.shift();
    if (plan.inspect.length === 0) await real.unlink(path);
    throw fault(code);
  }
  if (plan?.opened && String(path) === plan.path && (plan.reread ?? []).length > 0) {
    plan.opened = false;
    throw fault(plan.reread.shift());
  }
  return real.lstat(path, ...rest);
};
syncBuiltinESMExports();

// Windows is simulated elsewhere by turning POSIX checks off, which is safe; another platform cannot be simulated on
// Windows, where it would turn POSIX mode checks on against Windows files. Tests for any platform run on the real one.
const here = process.platform;
async function onPlatform(platform, run) {
  const actual = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try { return await run(); } finally {
    Object.defineProperty(process, "platform", { value: actual, configurable: true });
    plan = null;
  }
}

const locks = {
  "first-seen log": (dir) => [`${dir}/log.jsonl.lock`, () => new AppendOnlyFirstSeenLog(`${dir}/log.jsonl`, "test", (x) => x, { maxFileBytes: 10_000, maxRecordBytes: 1_000 }).acquireFileLock()],
  "analysis journal": (dir) => [`${dir}/journal.jsonl.lock`, () => new AnalysisJournalStore(`${dir}/journal.jsonl`).acquireLock()],
  "evaluation log": (dir) => [`${dir}/evaluations.jsonl.lock`, () => new AppendOnlyEvaluationLog(`${dir}/evaluations.jsonl`).acquireLock()],
  "strategy research journal": (dir) => [`${dir}/research.jsonl.lock`, () => new StrategyResearchJournalStore(`${dir}/research.jsonl`).acquireLock()],
  "macro-surprise evidence": (dir) => [`${dir}/evidence.jsonl.lock`, () => new MacroSurpriseEvidenceStore(`${dir}/evidence.jsonl`).acquireLock()],
  "chart operation lock": (dir) => [`${dir}/chart.lock`, () => new ChartOperationLock(`${dir}/chart.lock`).acquire()],
};

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "lock-release-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("Windows codes for a file being deleted are told apart from the same codes elsewhere", async (t) => {
  for (const code of ["EPERM", "EACCES"]) {
    assert.equal(lockBeingReleased(fault(code), "win32"), true, code);
    assert.equal(lockBeingReleased(fault(code), "darwin"), false, code);
    assert.equal(lockBeingReleased(fault(code), "linux"), false, code);
  }
  for (const code of ["EEXIST", "ENOENT", "EBUSY", undefined]) assert.equal(lockBeingReleased(fault(code), "win32"), false, String(code));
  assert.equal(lockBeingReleased(null, "win32"), false);
  const dir = await directory(t);
  assert.equal(await inspectLockFile(`${dir}/absent.lock`), "gone");
  await writeFile(`${dir}/held.lock`, "x");
  assert.equal((await inspectLockFile(`${dir}/held.lock`)).isFile(), true);
});

test("on Windows every lock waits through a lock being deleted, at its create and at its inspection", async (t) => {
  for (const [name, setUp] of Object.entries(locks)) {
    // The create itself is refused while the previous owner's lock is being deleted.
    await onPlatform("win32", async () => {
      const [path, acquire] = setUp(await directory(t));
      plan = { path, create: ["EPERM", "EACCES", "EPERM"], inspect: [], read: [] };
      const release = await acquire();
      assert.deepEqual(plan.create, [], name);
      plan = null;
      await release();
    });
    // The lock is held when the create runs, and inspecting it is refused while its deletion completes.
    await onPlatform("win32", async () => {
      const [path, acquire] = setUp(await directory(t));
      await acquire().then((release) => release());
      await writeFile(path, `00000000-0000-4000-8000-000000000000 ${process.pid}\n`, { mode: 0o600 });
      plan = { path, create: [], inspect: ["EPERM", "EACCES"], read: [] };
      if (name === "macro-surprise evidence") Object.assign(plan, { inspect: [], read: ["EPERM"], create: [] });
      const pending = acquire();
      if (name === "macro-surprise evidence") setTimeout(() => real.unlink(path), 60);
      const release = await pending;
      assert.deepEqual([plan.inspect, plan.read], [[], []], name);
      plan = null;
      await release();
    });
  }
});

test("off Windows the same codes still fail at once", { skip: here === "win32" && "another platform cannot be simulated on Windows" }, async (t) => {
  for (const [name, setUp] of Object.entries(locks)) {
    await onPlatform(here, async () => {
      const [path, acquire] = setUp(await directory(t));
      plan = { path, create: ["EPERM"], inspect: [], read: [] };
      await assert.rejects(acquire(), (error) => (error.cause ?? error).code === "EPERM", name);
    });
  }
});

test("a lock that stays unavailable on Windows still ends in the lock's own timeout", async (t) => {
  await onPlatform("win32", async () => {
    const dir = await directory(t);
    const log = new AppendOnlyFirstSeenLog(`${dir}/log.jsonl`, "test", (x) => x, { maxFileBytes: 10_000, maxRecordBytes: 1_000 });
    plan = { path: `${dir}/log.jsonl.lock`, create: Array(10_000).fill("EPERM"), inspect: [], read: [] };
    await assert.rejects(log.acquireFileLock(150), { code: "HISTORY_LOCK_TIMEOUT" });
  });
});

test("a macro-surprise lock that vanishes while it is inspected is tried again, on any platform", async (t) => {
  await onPlatform(here, async () => {
    const [path, acquire] = locks["macro-surprise evidence"](await directory(t));
    await acquire().then((release) => release());
    await writeFile(path, `00000000-0000-4000-8000-000000000000 ${process.pid}\n`, { mode: 0o600 });
    plan = { path, create: [], inspect: [], read: ["ENOENT"] };
    const pending = acquire();
    setTimeout(() => real.unlink(path), 60);
    const release = await pending;
    assert.deepEqual(plan.read, []);
    plan = null;
    await release();
  });
});

test("a stale lock that vanishes, or is being deleted, while it is reclaimed is looked at again", async (t) => {
  const stale = new Date(Date.now() - 11 * 60_000);
  const reclaiming = {
    "analysis journal": locks["analysis journal"],
    "strategy research journal": locks["strategy research journal"],
    "chart operation lock": locks["chart operation lock"],
  };
  for (const [name, setUp] of Object.entries(reclaiming)) {
    // ENOENT anywhere; EPERM only on Windows, where it means the file is being deleted.
    for (const [platform, code] of [[here, "ENOENT"], ["win32", "EPERM"]]) {
      await onPlatform(platform, async () => {
        const [path, acquire] = setUp(await directory(t));
        await acquire().then((release) => release());
        // A lock left by a process that no longer runs, old enough to reclaim.
        // At the open that reads it, or at the check after reading it.
        for (const at of ["read", "reread"]) {
          await writeFile(path, "00000000-0000-4000-8000-000000000000 2147483646\n", { mode: 0o600 });
          await utimes(path, stale, stale);
          plan = { path, create: [], inspect: [], read: [], reread: [], [at]: [code] };
          const release = await acquire();
          assert.deepEqual(plan[at], [], `${name} ${code} at ${at}`);
          plan = null;
          await release();
        }
      });
    }
  }
});
