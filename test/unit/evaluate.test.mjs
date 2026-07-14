import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvaluateArgs, runEvaluate } from "../../build/evaluate.js";
import { RealYieldFirstSeenStore } from "../../build/realYieldHistory.js";

test("evaluation CLI requires a log and snapshot path", () => {
  assert.deepEqual(parseEvaluateArgs(["--log", "log.jsonl", "--snapshot", "snapshot.json"]), { log: "log.jsonl", snapshot: "snapshot.json" });
  assert.throws(() => parseEvaluateArgs(["--log", "log.jsonl"]), /required/);
  assert.throws(() => parseEvaluateArgs(["--log", "a", "--snapshot", "b", "--wat", "c"]), /unknown option/);
  assert.throws(() => parseEvaluateArgs(["--log", "a", "--log", "b", "--snapshot", "c"]), /duplicate option/);
});

test("evaluation CLI records only the real-yield version first seen by the cutoff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-evaluate-"));
  await chmod(dir, 0o700);
  const historyPath = join(dir, "real-yield.jsonl");
  const history = new RealYieldFirstSeenStore(historyPath);
  await history.observe({
    series: "US_TREASURY_PAR_REAL_CMT_10Y",
    observation_date: "2026-06-29",
    value: 2.0,
    observed_at: "2026-07-01T10:00:00.000Z",
    source_updated_at_raw: null,
    observed_feed_year: 2026,
  });
  await history.observe({
    series: "US_TREASURY_PAR_REAL_CMT_10Y",
    observation_date: "2026-06-29",
    value: 2.2,
    observed_at: "2026-07-01T14:00:00.000Z",
    source_updated_at_raw: null,
    observed_feed_year: 2026,
  });
  const snapshotPath = join(dir, "snapshot.json");
  const logPath = join(dir, "evaluation.jsonl");
  await writeFile(snapshotPath, JSON.stringify({
    snapshot_id: "c9c11947-fafa-4cfb-bf9b-4fb369eaa2cc",
    request_completed_at: "2026-07-01T12:00:00.000Z",
  }));
  await runEvaluate(["--log", logPath, "--snapshot", snapshotPath, "--real-yield-history", historyPath]);
  const row = JSON.parse((await readFile(logPath, "utf8")).trim());
  assert.equal(row.payload.evaluation_context.real_yield_10y.value, 2.0);
  assert.equal(row.payload.evaluation_context.real_yield_10y.first_seen_at, "2026-07-01T10:00:00.000Z");
});

test("evaluation CLI accepts a conservative explicit cutoff and rejects non-canonical timestamps", async () => {
  assert.deepEqual(
    parseEvaluateArgs(["--log", "log", "--snapshot", "snapshot", "--as-of", "2026-07-01T00:00:00.000Z"])["as-of"],
    "2026-07-01T00:00:00.000Z",
  );
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-evaluate-"));
  const snapshotPath = join(dir, "snapshot.json");
  await writeFile(snapshotPath, JSON.stringify({ snapshot_id: "c9c11947-fafa-4cfb-bf9b-4fb369eaa2cc" }));
  await assert.rejects(
    () => runEvaluate(["--log", join(dir, "log.jsonl"), "--snapshot", snapshotPath, "--as-of", "2026-07-01"]),
    /canonical ISO-8601/,
  );
});
