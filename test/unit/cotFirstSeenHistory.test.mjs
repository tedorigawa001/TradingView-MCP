import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CotFirstSeenStore } from "../../build/cotFirstSeenHistory.js";

const version = (overrides = {}) => ({
  symbol: "OANDA:EURUSD",
  observation_date: "2026-07-21",
  value: { open_interest: 800061, positions: [{ group: "lev_money", net: -56671 }] },
  observed_at: "2026-07-24T19:30:00.000Z",
  ...overrides,
});

test("CotFirstSeenStore retains the original observation and appends revisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-cot-first-seen-"));
  const path = join(dir, "history.jsonl");
  const store = new CotFirstSeenStore(path);
  const first = (await store.observeMany([version()]))[0];
  const same = (await store.observeMany([version({ observed_at: "2026-07-25T19:30:00.000Z" })]))[0];
  const revised = (await store.observeMany([version({ value: { open_interest: 800062 }, observed_at: "2026-07-26T19:30:00.000Z" })]))[0];
  assert.equal(same.sequence, first.sequence);
  assert.equal(revised.sequence, 2);
  assert.equal(first.first_seen_at, "2026-07-24T19:30:00.000Z");
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 2);
});

test("CotFirstSeenStore rejects duplicate dates and clock regression", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-cot-first-seen-"));
  const store = new CotFirstSeenStore(join(dir, "history.jsonl"));
  await assert.rejects(() => store.observeMany([version(), version()]), /duplicate/);
  await store.observeMany([version()]);
  await assert.rejects(() => store.observeMany([version({ value: { revised: true }, observed_at: "2026-07-23T19:30:00.000Z" })]), /clock moved backwards/);
});
