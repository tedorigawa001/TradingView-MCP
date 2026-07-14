import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealYieldFirstSeenStore } from "../../build/realYieldHistory.js";

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
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal((await lstat(dir)).mode & 0o777, 0o700);

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

  const broadDir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-mode-"));
  await chmod(broadDir, 0o777);
  const modeStore = new RealYieldFirstSeenStore(join(broadDir, "history.jsonl"));
  await assert.rejects(() => modeStore.observe(version()), /permissions/);
  assert.equal((await lstat(broadDir)).mode & 0o777, 0o777, "existing directory permissions must not be changed");
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
