import { posixModeEnforced } from "../../build/fsDurability.js";
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealYieldFirstSeenStore } from "../../build/realYieldHistory.js";
import { AppendOnlyFirstSeenLog } from "../../build/firstSeenStore.js";

const SERIES = "US_TREASURY_PAR_REAL_CMT_10Y";
const version = (overrides = {}) => ({
  series: SERIES,
  observation_date: "2026-07-13",
  value: 2.01,
  observed_at: "2026-07-14T01:00:00.000Z",
  source_updated_at_raw: "2026-07-14T00:30:00Z",
  observed_feed_year: 2026,
  ...overrides,
});

test("RealYieldFirstSeenStore persists one version with owner-only permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-"));
  const path = join(dir, "history.jsonl");
  const store = new RealYieldFirstSeenStore(path);
  const first = await store.observe(version());
  assert.equal(first.first_seen_at, "2026-07-14T01:00:00.000Z");
  assert.equal(first.unit, "percent_per_annum_bond_equivalent");
  assert.equal(first.source, "us_treasury");
  if (posixModeEnforced()) assert.equal((await lstat(path)).mode & 0o777, 0o600);
  if (posixModeEnforced()) assert.equal((await lstat(dir)).mode & 0o777, 0o700);

  const restarted = new RealYieldFirstSeenStore(path);
  const same = await restarted.observe(version({ observed_at: "2026-07-14T02:00:00.000Z" }));
  assert.equal(same.first_seen_at, first.first_seen_at);
  const sameAfterClockRegression = await restarted.observe(version({ observed_at: "2026-07-13T23:00:00.000Z" }));
  assert.equal(sameAfterClockRegression.first_seen_at, first.first_seen_at);
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
});

test("RealYieldFirstSeenStore retains revisions and selects only versions available as of the cutoff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-"));
  const store = new RealYieldFirstSeenStore(join(dir, "history.jsonl"));
  await store.observe(version());
  await store.observe(version({ value: 2.05, observed_at: "2026-07-15T01:00:00.000Z" }));
  assert.equal((await store.getAsOf(new Date("2026-07-14T23:59:59.000Z"))).value, 2.01);
  assert.equal((await store.getAsOf(new Date("2026-07-15T01:00:00.000Z"))).value, 2.05);
  await store.observe(version({ value: 2.01, observed_at: "2026-07-16T01:00:00.000Z" }));
  const reverted = await store.getAsOf(new Date("2026-07-16T01:00:00.000Z"));
  assert.equal(reverted.value, 2.01, "a revision that returns to an earlier value is still a new version");
  assert.equal(reverted.sequence, 3);
  assert.equal(await store.getAsOf(new Date("2026-07-14T00:59:59.000Z")), null);
  assert.deepEqual(await store.coverage(), {
    records: 3,
    dates: 1,
    revisions: 2,
    earliest_date: "2026-07-13",
    latest_date: "2026-07-13",
    first_collected_at: "2026-07-14T01:00:00.000Z",
  });
});

test("RealYieldFirstSeenStore uses sequence when revisions share a timestamp", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-"));
  const store = new RealYieldFirstSeenStore(join(dir, "history.jsonl"));
  await store.observe(version());
  await store.observe(version({ value: 2.05 }));
  const current = await store.getAsOf(new Date("2026-07-14T01:00:00.000Z"));
  assert.equal(current.value, 2.05);
  assert.equal(current.sequence, 2);
});

test("RealYieldFirstSeenStore serializes concurrent observations deterministically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-"));
  const path = join(dir, "history.jsonl");
  const stores = [new RealYieldFirstSeenStore(path), new RealYieldFirstSeenStore(path)];
  const records = await Promise.all(Array.from({ length: 100 }, (_, index) => stores[index % 2].observe(version())));
  assert.ok(records.every((record) => record.first_seen_at === "2026-07-14T01:00:00.000Z"));
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
});

/**
 * These two tests prove the queue by making the follower fail without it, and the only
 * failure available is the lock deadline. Raising the production budget from 2s to 30s
 * silently removed that: both kept passing with the per-path queue reverted, pinning
 * nothing. They now bind the budget explicitly instead of inheriting whatever it is.
 */
const LOCK_BUDGET_MS = 200;
const HOLD_MS = 600;
function withLockBudget(t) {
  const previous = process.env.TV_MCP_HISTORY_LOCK_WAIT_MS;
  process.env.TV_MCP_HISTORY_LOCK_WAIT_MS = String(LOCK_BUDGET_MS);
  t.after(() => {
    if (previous === undefined) delete process.env.TV_MCP_HISTORY_LOCK_WAIT_MS;
    else process.env.TV_MCP_HISTORY_LOCK_WAIT_MS = previous;
  });
}

test("first-seen logs sharing a path queue before starting the file-lock deadline", async (t) => {
  withLockBudget(t);
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-first-seen-path-queue-"));
  const path = join(dir, "history.jsonl");
  const limits = { maxFileBytes: 1024, maxRecordBytes: 512 };
  const first = new AppendOnlyFirstSeenLog(path, "path-queue", (value) => value, limits);
  const second = new AppendOnlyFirstSeenLog(path, "path-queue", (value) => value, limits);
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });

  const slow = first.serialize(async () => {
    markStarted();
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
  });
  await started;
  const follower = second.serialize(async () => "acquired-after-predecessor");

  assert.equal(await follower, "acquired-after-predecessor");
  await slow;
});

test("two spellings of one path share the queue, because they share the lock", async (t) => {
  withLockBudget(t);
  // The lock lives at `${filePath}.lock`, and the filesystem resolves both spellings to the
  // same lock file. Keying the queue on the raw string would give these two logs separate
  // queues, put them back in a race for that one lock, and lose the follower to the 2 s
  // deadline while the predecessor still holds it.
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-first-seen-path-key-"));
  const path = join(dir, "history.jsonl");
  const sameFileOtherSpelling = `${dir}/./history.jsonl`;
  const limits = { maxFileBytes: 1024, maxRecordBytes: 512 };
  const first = new AppendOnlyFirstSeenLog(path, "path-key", (value) => value, limits);
  const second = new AppendOnlyFirstSeenLog(sameFileOtherSpelling, "path-key", (value) => value, limits);
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });

  const slow = first.serialize(async () => {
    markStarted();
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
  });
  await started;
  const follower = second.serialize(async () => "acquired-after-predecessor");

  assert.equal(await follower, "acquired-after-predecessor");
  await slow;
});

test("RealYieldFirstSeenStore never releases a replacement lock owned by another process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-lock-"));
  const path = join(dir, "history.jsonl");
  const lockPath = `${path}.lock`;
  const store = new RealYieldFirstSeenStore(path);
  const release = await store.acquireFileLock();
  await unlink(lockPath);
  await writeFile(lockPath, "replacement-token 999\n", { mode: 0o600 });
  await assert.rejects(() => release(), /ownership was lost/);
  assert.ok((await lstat(lockPath)).isFile(), "a replacement lock must remain in place");
  await unlink(lockPath);
});

test("RealYieldFirstSeenStore rejects clock regression, corruption and unsafe paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-"));
  const path = join(dir, "history.jsonl");
  const store = new RealYieldFirstSeenStore(path);
  await store.observe(version());
  await assert.rejects(
    () => store.observe(version({ observation_date: "2026-07-14", observed_at: "2026-07-13T23:00:00.000Z" })),
    /observation_date is after first_seen_at/,
  );
  await writeFile(path, "{broken\n", { mode: 0o600 });
  await assert.rejects(() => store.getAsOf(new Date("2026-07-15T00:00:00.000Z")), /invalid.*JSON/);

  const symlinkPath = join(dir, "linked.jsonl");
  await symlink(path, symlinkPath);
  await assert.rejects(() => new RealYieldFirstSeenStore(symlinkPath).observe(version()), /regular file/);

  // A group- and world-writable directory is refused where the host has POSIX
  // modes. Windows has none, so chmod does nothing there and the store cannot
  // ask the question - asserting the rejection unconditionally was asserting
  // the platform.
  if (posixModeEnforced()) {
    const broadDir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-mode-"));
    await chmod(broadDir, 0o777);
    const modeStore = new RealYieldFirstSeenStore(join(broadDir, "history.jsonl"));
    await assert.rejects(() => modeStore.observe(version()), /permissions/);
    assert.equal((await lstat(broadDir)).mode & 0o777, 0o777, "existing directory permissions must not be changed");
  }
});

test("RealYieldFirstSeenStore rejects semantically corrupt history ordering", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-corrupt-"));
  const path = join(dir, "history.jsonl");
  const store = new RealYieldFirstSeenStore(path);
  await store.observe(version());
  await store.observe(version({ value: 2.05, observed_at: "2026-07-15T01:00:00.000Z" }));
  const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
  rows[1].sequence = 1;
  await writeFile(path, `${rows.map(JSON.stringify).join("\n")}\n`, { mode: 0o600 });
  await assert.rejects(() => store.getAsOf(new Date("2026-07-16T00:00:00.000Z")), /non-contiguous.*sequence/);

  rows[1].sequence = 2;
  rows[1].first_seen_at = "2026-07-13T01:00:00.000Z";
  rows[1].observation_date = "2026-07-12";
  await writeFile(path, `${rows.map(JSON.stringify).join("\n")}\n`, { mode: 0o600 });
  await assert.rejects(() => store.getAsOf(new Date("2026-07-16T00:00:00.000Z")), /first_seen_at moved backwards/);
});
