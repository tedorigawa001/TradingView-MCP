import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog } from "../../build/firstSeenStore.js";

// BACKLOG 102-05: a batch is checked against every invariant the reader enforces before any of it is written.
const record = (sequence, firstSeenAt, observationDate = "2026-07-20") =>
  ({ sequence, observation_date: observationDate, first_seen_at: firstSeenAt });

async function newLog(t, maxFileBytes = 10_000) {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-first-seen-appendable-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AppendOnlyFirstSeenLog(join(directory, "data.jsonl"), "test", (value) => value, { maxFileBytes, maxRecordBytes: 1_000 });
}

test("an append that keeps the sequence and the first-seen clock passes, equal stamps included", async (t) => {
  const log = await newLog(t);
  const existing = [record(1, "2026-07-21T00:00:00.000Z"), record(2, "2026-07-22T00:00:00.000Z")];
  await log.assertAppendableUnlocked(existing, [record(3, "2026-07-22T00:00:00.000Z"), record(4, "2026-07-23T00:00:00.000Z")]);
  await log.assertAppendableUnlocked([], [record(1, "2026-07-21T00:00:00.000Z")]);
  await log.assertAppendableUnlocked(existing, []);
});

test("an append that would leave the log unreadable is refused", async (t) => {
  const log = await newLog(t);
  const existing = [record(1, "2026-07-21T00:00:00.000Z"), record(2, "2026-07-22T00:00:00.000Z")];
  await assert.rejects(() => log.assertAppendableUnlocked(existing, [record(3, "2026-07-21T12:00:00.000Z")]),
    /test first-seen clock moved backwards/, "before the last record held");
  await assert.rejects(() => log.assertAppendableUnlocked(existing,
    [record(3, "2026-07-23T12:00:00.000Z"), record(4, "2026-07-23T06:00:00.000Z")]), /clock moved backwards/, "within the batch");
  await assert.rejects(() => log.assertAppendableUnlocked(existing, [record(4, "2026-07-23T00:00:00.000Z")]), /break the sequence at 4/);
  await assert.rejects(() => log.assertAppendableUnlocked([], [record(2, "2026-07-23T00:00:00.000Z")]), /break the sequence at 2/);
  await assert.rejects(() => log.assertAppendableUnlocked(existing, [record(3, "2026-07-23T00:00:00.000Z", "2026-07-24")]),
    /observation_date is after first_seen_at/);
});

test("a batch beyond the file limit is refused before any of it is written", async (t) => {
  const log = await newLog(t, 200);
  const batch = [record(1, "2026-07-21T00:00:00.000Z"), record(2, "2026-07-22T00:00:00.000Z"), record(3, "2026-07-23T00:00:00.000Z")];
  await assert.rejects(() => log.assertAppendableUnlocked([], batch), /history file is too large/);
  await log.assertAppendableUnlocked([], batch.slice(0, 2));
});
