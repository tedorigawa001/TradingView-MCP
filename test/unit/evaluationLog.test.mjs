import { posixModeEnforced } from "../../build/fsDurability.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, lstat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppendOnlyEvaluationLog } from "../../build/evaluationLog.js";
import { appendOwnerOnly } from "../../build/researchCollectionCli.js";

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
  if (posixModeEnforced()) assert.equal((await lstat(path)).mode & 0o777, 0o600);
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

test("a symbolic link given as the evaluation log or the research collection output is refused, naming the file it leads to, and that file is taken (BACKLOG 103-11 review)",
  { skip: process.platform === "win32" ? "making a symbolic link needs a privilege on Windows" : false }, async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "tv-mcp-linked-output-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "real"), { mode: 0o700 });
  await mkdir(join(dir, "out"), { mode: 0o700 });
  const refusal = (label, link, real) => `${label} path must be a regular file, not a symbolic link: ${link} is a symbolic link, which is not followed here; give the path of the file it leads to, ${real}, instead`;
  // The research collection output: refused before anything is read or appended, then appended to by its own path.
  const output = join(dir, "real", "research.jsonl"), linkedOutput = join(dir, "out", "research.jsonl");
  await writeFile(output, "", { mode: 0o600 });
  await symlink(output, linkedOutput);
  await assert.rejects(() => appendOwnerOnly(linkedOutput, { hypothesis_id: "linked", primary_available_events: 1 }), (error) => error.message === refusal("research collection output", linkedOutput, output));
  assert.equal(await readFile(output, "utf8"), "");
  assert.equal(await appendOwnerOnly(output, { hypothesis_id: "linked", primary_available_events: 1 }), true);
  // The evaluation log, read through a link (as evaluate --log would): refused, naming the file; read by its own path.
  const log = join(dir, "real", "eval.jsonl"), linkedLog = join(dir, "out", "eval.jsonl");
  await new AppendOnlyEvaluationLog(log).append({ schema_version: "1.0", snapshot_id: SNAPSHOT_ID, kind: "snapshot", payload: {} });
  await symlink(log, linkedLog);
  await assert.rejects(() => new AppendOnlyEvaluationLog(linkedLog).readAll(), (error) => error.message === refusal("evaluation log", linkedLog, log));
  assert.equal((await new AppendOnlyEvaluationLog(log).readAll()).length, 1);
});
