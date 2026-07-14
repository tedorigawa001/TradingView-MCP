import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, lstat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppendOnlyEvaluationLog } from "../../build/evaluationLog.js";

const SNAPSHOT_ID = "c9c11947-fafa-4cfb-bf9b-4fb369eaa2cc";

test("AppendOnlyEvaluationLog writes newline-delimited records with owner-only permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-eval-"));
  const path = join(dir, "snapshots.jsonl");
  const log = new AppendOnlyEvaluationLog(path);
  await log.append({ schema_version: "1.0", snapshot_id: SNAPSHOT_ID, kind: "snapshot", payload: { status: "partial" } });
  await log.append({ schema_version: "1.0", snapshot_id: SNAPSHOT_ID, kind: "features", payload: { atr: 0.01 } });
  const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].kind, "features");
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal((await log.readBySnapshotId(SNAPSHOT_ID)).length, 2);
});

test("AppendOnlyEvaluationLog rejects unsafe records and symlink paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-eval-"));
  const path = join(dir, "snapshots.jsonl");
  const log = new AppendOnlyEvaluationLog(path);
  await assert.rejects(() => log.append({ schema_version: "1.0", snapshot_id: "not-a-uuid", kind: "snapshot", payload: {} }), /UUID/);
  await symlink(join(dir, "target"), path);
  await assert.rejects(() => log.append({ schema_version: "1.0", snapshot_id: SNAPSHOT_ID, kind: "snapshot", payload: {} }), /regular file/);
});

test("AppendOnlyEvaluationLog permits only one snapshot record per snapshot_id across instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-eval-"));
  const path = join(dir, "snapshots.jsonl");
  const logs = [new AppendOnlyEvaluationLog(path), new AppendOnlyEvaluationLog(path)];
  const results = await Promise.allSettled(logs.map((log) => log.append({
    schema_version: "1.0",
    snapshot_id: SNAPSHOT_ID,
    kind: "snapshot",
    payload: { status: "partial" },
  })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
});
