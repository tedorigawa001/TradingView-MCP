// BACKLOG 102-39: Windows refuses to create or open a lock file it is still deleting, with EPERM. Every lock loop must
// wait on that as on a lock that is held, sleeping and within its deadline, while a refusal with no lock file there,
// a refusal off Windows and a failed write of its own lock still fail. The faults are injected into node:fs/promises,
// whose live bindings the stores read; the platform, the clock and the sleeps are the test's.
import test from "node:test";
import assert from "node:assert/strict";
import { constants, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog } from "../../build/firstSeenStore.js";
import { AnalysisJournalStore } from "../../build/analysisJournal.js";
import { AppendOnlyEvaluationLog } from "../../build/evaluationLog.js";
import { StrategyResearchJournalStore } from "../../build/strategyResearchJournal.js";
import { MacroSurpriseEvidenceStore } from "../../build/macroSurpriseEvidence.js";
import { ChartOperationLock } from "../../build/chartOperationLock.js";
import { lockBeingReleased } from "../../build/fsDurability.js";

const fsp = createRequire(import.meta.url)("node:fs/promises");
const real = { open: fsp.open, lstat: fsp.lstat, unlink: fsp.unlink };
/**
 * Faults for one lock path, each list taken in order: `create` for its exclusive create, `inspect` for the lstat that
 * follows a create that failed, `read` for opening it to read, `reread` for an lstat that follows such an open (a
 * stale lock's reclaim checking it is still the one it read), and `write` for writing a lock just created, after
 * `onWrite` runs. `after` runs after each injected fault; `calls` counts the creates and reads of the path. The plan
 * also records whether the new lock was synced, and whether the lock was unlinked while a handle to it was still open,
 * which on Windows keeps the deleted name taken.
 */
let plan = null;
const fault = (code) => Object.assign(new Error(`${code}: injected`), { code });
async function inject(kind) {
  const code = plan[kind].shift();
  if (!code) return;
  await plan.after?.(kind);
  throw fault(code);
}
fsp.open = async (path, flags, ...rest) => {
  if (!plan || String(path) !== plan.path) return real.open(path, flags, ...rest);
  const exclusive = typeof flags === "number" && (flags & constants.O_EXCL) !== 0;
  plan.calls[exclusive ? "create" : "read"] += 1;
  let handle;
  try {
    await inject(exclusive ? "create" : "read");
    handle = await real.open(path, flags, ...rest);
  } catch (error) {
    if (exclusive) plan.armed = true;
    throw error;
  }
  const owner = plan;
  owner.open += 1;
  const close = handle.close.bind(handle);
  let closed = false;
  handle.close = async () => {
    if (!closed) { closed = true; owner.open -= 1; }
    return close();
  };
  if (!exclusive) plan.opened = true;
  if (exclusive) {
    const sync = handle.sync.bind(handle);
    handle.sync = async () => { owner.synced = true; return sync(); };
  }
  if (exclusive && plan.write.length > 0) {
    const code = plan.write.shift();
    handle.writeFile = async () => { await owner.onWrite?.(); throw fault(code); };
  }
  return handle;
};
fsp.unlink = async (path, ...rest) => {
  if (plan && String(path) === plan.path && plan.open > 0) plan.unlinkedWhileOpen = true;
  return real.unlink(path, ...rest);
};
fsp.lstat = async (path, ...rest) => {
  if (plan && String(path) === plan.path) {
    if (plan.armed) {
      plan.armed = false;
      await inject("inspect");
    } else if (plan.opened) {
      plan.opened = false;
      await inject("reread");
    }
  }
  return real.lstat(path, ...rest);
};
syncBuiltinESMExports();

// The clock both deadlines read, which a test moves on to end a wait, and the lock loops' sleeps, counted.
const realNow = { date: Date.now, performance: performance.now.bind(performance) };
const realSetTimeout = globalThis.setTimeout;
let offset = 0;
let sleeps = 0;
Date.now = () => realNow.date() + offset;
performance.now = () => realNow.performance() + offset;
globalThis.setTimeout = (callback, ms, ...rest) => {
  if (ms >= 20 && ms <= 80) {
    sleeps += 1;
    plan?.onSleep?.();
  }
  return realSetTimeout(callback, ms, ...rest);
};
const passDeadlines = () => { offset += 3_600_000; };

// Windows is simulated by turning POSIX checks off, which is safe; another platform cannot be simulated on Windows,
// where it would turn POSIX mode checks on against Windows files. Tests meant for any platform run on the real one.
const here = process.platform;
async function onPlatform(platform, run) {
  const actual = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  plan = null;
  offset = 0;
  try {
    return await run((path) => {
      plan = {
        path, create: [], inspect: [], read: [], reread: [], write: [], calls: { create: 0, read: 0 },
        open: 0, synced: false, unlinkedWhileOpen: false,
      };
      sleeps = 0;
      return plan;
    });
  } finally {
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
const reclaiming = ["analysis journal", "strategy research journal", "chart operation lock"];
const heldBy = (pid) => `00000000-0000-4000-8000-000000000000 ${pid}\n`;
const codeOf = (error) => (error.cause ?? error).code;
// A lock held by this process, dated past the clock's jump so no lock reads it as stale once the deadlines pass.
async function heldPastTheJump(path) {
  await writeFile(path, heldBy(process.pid), { mode: 0o600 });
  const later = new Date(Date.now() + 2 * 3_600_000);
  await utimes(path, later, later);
}

async function setUp(t, name) {
  const dir = await mkdtemp(join(tmpdir(), "lock-release-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const [path, acquire] = locks[name](dir);
  // Each store sets up its directory on a first acquisition, with no faults.
  await acquire().then((release) => release());
  return [path, acquire];
}

test("on Windows EPERM alone is read as a lock file being deleted", () => {
  assert.equal(lockBeingReleased(fault("EPERM"), "win32"), true);
  for (const platform of ["darwin", "linux"]) assert.equal(lockBeingReleased(fault("EPERM"), platform), false, platform);
  for (const code of ["EACCES", "EEXIST", "ENOENT", "EBUSY", undefined]) {
    assert.equal(lockBeingReleased(fault(code), "win32"), false, String(code));
  }
  assert.equal(lockBeingReleased(null, "win32"), false);
});

test("on Windows every lock sleeps through a lock file being deleted, at its create and while it is held", async (t) => {
  for (const name of Object.keys(locks)) {
    // Created and inspected while the previous owner's lock is being deleted, twice.
    await onPlatform("win32", async (faults) => {
      const [path, acquire] = await setUp(t, name);
      faults(path).create.push("EPERM", "EPERM");
      plan.inspect.push("EPERM", "EPERM");
      const release = await acquire();
      assert.deepEqual([plan.create, plan.inspect], [[], []], name);
      assert.ok(sleeps >= 2, `${name} slept ${sleeps} times`);
      plan = null;
      await release();
    });
    // Held when the create runs, then refused while its deletion completes.
    await onPlatform("win32", async (faults) => {
      const [path, acquire] = await setUp(t, name);
      await writeFile(path, heldBy(process.pid), { mode: 0o600 });
      const kind = name === "macro-surprise evidence" ? "read" : "inspect";
      faults(path)[kind].push("EPERM", "EPERM");
      plan.after = async () => { if (plan[kind].length === 0) await real.unlink(path); };
      const release = await acquire();
      assert.deepEqual(plan[kind], [], name);
      assert.ok(sleeps >= 2, `${name} slept ${sleeps} times`);
      plan = null;
      await release();
    });
  }
});

test("a create refused with no lock file there is tried again once, then fails as a real denial", async (t) => {
  for (const name of Object.keys(locks)) {
    await onPlatform("win32", async (faults) => {
      const [path, acquire] = await setUp(t, name);
      // Once: a deletion that finished in between.
      faults(path).create.push("EPERM");
      const release = await acquire();
      assert.deepEqual([plan.calls.create, sleeps], [2, 0], name);
      plan = null;
      await release();
      // Twice with no lock to blame: a denial, thrown at once.
      faults(path).create.push("EPERM", "EPERM", "EPERM");
      await assert.rejects(acquire(), (error) => codeOf(error) === "EPERM", name);
      assert.deepEqual([plan.calls.create, sleeps], [2, 0], name);
    });
  }
});

test("off Windows EPERM still fails at once", { skip: here === "win32" && "another platform cannot be simulated on Windows" }, async (t) => {
  for (const name of Object.keys(locks)) {
    await onPlatform(here, async (faults) => {
      const [path, acquire] = await setUp(t, name);
      faults(path).create.push("EPERM");
      await assert.rejects(acquire(), (error) => codeOf(error) === "EPERM", name);
      assert.equal(plan.calls.create, 1, name);
    });
  }
});

test("a lock file refused for good ends in the lock's own timeout, which names the refusal", async (t) => {
  for (const name of Object.keys(locks)) {
    // The deadline passes during an attempt, or during a sleep.
    for (const when of ["after", "onSleep"]) {
      await onPlatform("win32", async (faults) => {
        const [path, acquire] = await setUp(t, name);
        faults(path).create.push(...Array(1_000).fill("EPERM"));
        plan.inspect.push(...Array(1_000).fill("EPERM"));
        plan[when] = () => { if (sleeps === 3) passDeadlines(); };
        await assert.rejects(acquire(), (error) => /timed out/.test(error.message) && error.cause?.code === "EPERM", `${name} ${when}`);
        assert.ok(sleeps >= 3 && plan.calls.create < 50, `${name} ${when}: ${sleeps} sleeps, ${plan.calls.create} creates`);
      });
    }
  }
});

test("a stale lock that vanishes while it is reclaimed is looked at again; one refused is waited for", async (t) => {
  const staleLock = async (path) => {
    // Left by a process that no longer runs, and old enough to reclaim.
    const stale = new Date(Date.now() - 11 * 60_000);
    await writeFile(path, heldBy(2147483646), { mode: 0o600 });
    await utimes(path, stale, stale);
  };
  for (const name of reclaiming) {
    for (const [platform, code] of [[here, "ENOENT"], ["win32", "EPERM"]]) {
      // At the open that reads it, or at the check after reading it.
      for (const at of ["read", "reread"]) {
        await onPlatform(platform, async (faults) => {
          const [path, acquire] = await setUp(t, name);
          await staleLock(path);
          faults(path)[at].push(code);
          const release = await acquire();
          assert.deepEqual(plan[at], [], `${name} ${code} at ${at}`);
          // A lock being deleted is waited for; one that vanished is looked at again at once.
          assert.equal(sleeps >= 1, code === "EPERM", `${name} ${code} at ${at}: ${sleeps} sleeps`);
          assert.equal(plan.unlinkedWhileOpen, false, `${name}: the stale lock was unlinked with a handle open`);
          plan = null;
          await release();
        });
      }
    }
  }
  // Refused for good, a reclaim (or the macro-surprise lock's inspection of a held lock) waits within the deadline
  // instead of retrying at once, and its timeout names the refusal.
  for (const name of [...reclaiming, "macro-surprise evidence"]) {
    await onPlatform("win32", async (faults) => {
      const [path, acquire] = await setUp(t, name);
      if (name === "macro-surprise evidence") await writeFile(path, heldBy(process.pid), { mode: 0o600 });
      else await staleLock(path);
      faults(path).read.push(...Array(1_000).fill("EPERM"));
      plan.after = () => { if (sleeps === 3) passDeadlines(); };
      await assert.rejects(acquire(), (error) => /timed out/.test(error.message) && error.cause?.code === "EPERM", name);
      assert.ok(sleeps >= 3 && plan.calls.read < 50, `${name}: ${sleeps} sleeps, ${plan.calls.read} reads`);
    });
  }
});

test("a lock that failed to be written is removed and fails at once, on any platform", async (t) => {
  for (const name of Object.keys(locks)) {
    for (const platform of new Set([here, "win32"])) {
      await onPlatform(platform, async (faults) => {
        const [path, acquire] = await setUp(t, name);
        faults(path).write.push("EPERM");
        await assert.rejects(acquire(), (error) => codeOf(error) === "EPERM", `${name} on ${platform}`);
        assert.deepEqual([existsSync(path), sleeps, plan.unlinkedWhileOpen], [false, 0, false], `${name} on ${platform}`);
      });
    }
    // A write stalled while another process reclaimed the lock and took it: that lock is left alone.
    await onPlatform(here, async (faults) => {
      const [path, acquire] = await setUp(t, name);
      faults(path).write.push("EIO");
      plan.onWrite = async () => {
        await real.unlink(path);
        await writeFile(path, heldBy(process.pid), { mode: 0o600 });
      };
      await assert.rejects(acquire(), (error) => codeOf(error) === "EIO", name);
      assert.equal(await readFile(path, "utf8"), heldBy(process.pid), name);
    });
  }
});

test("a lock just created is synced, and released without a handle open, even after its file vanished", async (t) => {
  for (const name of Object.keys(locks)) {
    await onPlatform(here, async (faults) => {
      const [path, acquire] = await setUp(t, name);
      faults(path);
      const release = await acquire();
      assert.equal(plan.synced, true, name);
      await release();
      assert.deepEqual([existsSync(path), plan.unlinkedWhileOpen], [false, false], name);
      // Released after its file was removed, the lock lets go quietly.
      const vanishing = await acquire();
      await real.unlink(path);
      await vanishing();
    });
  }
});

test("a lock that keeps vanishing between the create and the look is tried again once at once, then waited for", async (t) => {
  for (const name of Object.keys(locks)) {
    await onPlatform(here, async (faults) => {
      const [path, acquire] = await setUp(t, name);
      await writeFile(path, heldBy(process.pid), { mode: 0o600 });
      // Gone once: tried again at once.
      faults(path).inspect.push("ENOENT");
      plan.after = () => real.unlink(path);
      const release = await acquire();
      assert.deepEqual([plan.calls.create, sleeps], [2, 0], name);
      plan = null;
      await release();
      // Gone every time: waited for, within the deadline.
      await writeFile(path, heldBy(process.pid), { mode: 0o600 });
      faults(path).inspect.push(...Array(1_000).fill("ENOENT"));
      plan.onSleep = () => { if (sleeps === 3) passDeadlines(); };
      await assert.rejects(acquire(), /timed out/, name);
      assert.ok(sleeps >= 3 && plan.calls.create < 50, `${name}: ${sleeps} sleeps, ${plan.calls.create} creates`);
    });
  }
});

test("a held lock whose create Windows refuses names that refusal, and only the last attempt's refusal counts", async (t) => {
  for (const name of Object.keys(locks)) {
    // Created while the lock file is there, refused each time: waited for, and the refusal named.
    await onPlatform("win32", async (faults) => {
      const [path, acquire] = await setUp(t, name);
      await heldPastTheJump(path);
      faults(path).create.push(...Array(1_000).fill("EPERM"));
      plan.onSleep = () => { if (sleeps === 3) passDeadlines(); };
      await assert.rejects(acquire(), (error) => /timed out/.test(error.message) && error.cause?.code === "EPERM", name);
    });
    // Refused once, then simply held: the timeout no longer blames the refusal.
    await onPlatform("win32", async (faults) => {
      const [path, acquire] = await setUp(t, name);
      await heldPastTheJump(path);
      faults(path).inspect.push("EPERM");
      plan.onSleep = () => { if (sleeps === 3) passDeadlines(); };
      await assert.rejects(acquire(), (error) => /timed out/.test(error.message) && error.cause === undefined, name);
    });
  }
});

test("a macro-surprise lock that vanishes while it is inspected is tried again at once, on any platform", async (t) => {
  await onPlatform(here, async (faults) => {
    const [path, acquire] = await setUp(t, "macro-surprise evidence");
    await writeFile(path, heldBy(process.pid), { mode: 0o600 });
    faults(path).read.push("ENOENT");
    // Removed for real once the inspection has been told it was.
    plan.after = () => real.unlink(path);
    const release = await acquire();
    assert.deepEqual([plan.read, sleeps], [[], 0]);
    plan = null;
    await release();
  });
});
