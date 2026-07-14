import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppendOnlyEvaluationLog } from "../../build/evaluationLog.js";
import { EvaluationPipeline } from "../../build/evaluationPipeline.js";

const realYieldContext = (overrides = {}) => ({
  schema_version: "1.1",
  status: "partial",
  series: "US_TREASURY_PAR_REAL_CMT_10Y",
  source: "us_treasury",
  unit: "percent_per_annum_bond_equivalent",
  as_of: "2026-07-01T12:00:00.000Z",
  observation_date: "2026-06-30",
  value: 2.1,
  value_status: "valid",
  observed_at: "2026-07-01T10:00:00.000Z",
  available_at: "2026-07-01T10:00:00.000Z",
  available_at_basis: "local_first_seen",
  first_seen_at: "2026-07-01T10:00:00.000Z",
  history_sequence: 1,
  point_in_time_status: "observed_first_seen",
  ...overrides,
});

test("EvaluationPipeline links snapshot, features, and outcome by snapshot_id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-pipeline-"));
  const path = join(dir, "evaluation.jsonl");
  const pipeline = new EvaluationPipeline(new AppendOnlyEvaluationLog(path));
  const id = "c9c11947-fafa-4cfb-bf9b-4fb369eaa2cc";
  await pipeline.recordSnapshot({ snapshot_id: id, status: "partial" });
  await pipeline.recordFeatures(id, { atr: 0.01 });
  await pipeline.recordOutcome(id, { label: "up", horizon_bars: 12 });
  const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map((row) => row.kind), ["snapshot", "features", "outcome"]);
  assert.ok(rows.every((row) => row.snapshot_id === id));
});

test("EvaluationPipeline enriches a snapshot at request_completed_at without mutating its input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-pipeline-"));
  const path = join(dir, "evaluation.jsonl");
  const calls = [];
  const pipeline = new EvaluationPipeline(new AppendOnlyEvaluationLog(path), {
    realYield: {
      async getAsOf(asOf) {
        calls.push(asOf.toISOString());
        return realYieldContext();
      },
    },
  });
  const snapshot = {
    snapshot_id: "c9c11947-fafa-4cfb-bf9b-4fb369eaa2cc",
    request_completed_at: "2026-07-01T12:00:00.000Z",
    evaluation_context: { policy_version: "1.0" },
  };
  const entry = await pipeline.recordSnapshot(snapshot);
  assert.deepEqual(calls, ["2026-07-01T12:00:00.000Z"]);
  assert.equal(snapshot.evaluation_context.real_yield_10y, undefined);
  assert.deepEqual(entry.payload.evaluation_context, {
    policy_version: "1.0",
    as_of: "2026-07-01T12:00:00.000Z",
    as_of_basis: "request_completed_at",
    real_yield_10y: realYieldContext(),
  });
});

test("EvaluationPipeline keeps unavailable point-in-time evidence instead of substituting a value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-pipeline-"));
  const pipeline = new EvaluationPipeline(new AppendOnlyEvaluationLog(join(dir, "evaluation.jsonl")), {
    realYield: { async getAsOf() {
      return realYieldContext({
        status: "unavailable",
        observation_date: null,
        value: null,
        value_status: "unavailable",
        observed_at: null,
        available_at: null,
        available_at_basis: "unavailable",
        first_seen_at: null,
        history_sequence: null,
        point_in_time_status: "blocked",
      });
    } },
  });
  const entry = await pipeline.recordSnapshot({
    snapshot_id: "c9c11947-fafa-4cfb-bf9b-4fb369eaa2cc",
    request_completed_at: "2026-07-01T12:00:00.000Z",
  });
  assert.equal(entry.payload.evaluation_context.real_yield_10y.value, null);
  assert.equal(entry.payload.evaluation_context.real_yield_10y.point_in_time_status, "blocked");
});

test("EvaluationPipeline rejects unsafe evaluation cutoffs and reserved context collisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-pipeline-"));
  let calls = 0;
  const provider = { async getAsOf() { calls += 1; return {}; } };
  const id = "c9c11947-fafa-4cfb-bf9b-4fb369eaa2cc";
  await assert.rejects(
    () => new EvaluationPipeline(new AppendOnlyEvaluationLog(join(dir, "missing.jsonl")), { realYield: provider })
      .recordSnapshot({ snapshot_id: id }),
    /request_completed_at is required/,
  );
  await assert.rejects(
    () => new EvaluationPipeline(new AppendOnlyEvaluationLog(join(dir, "future.jsonl")), {
      realYield: provider,
      asOf: new Date("2026-07-02T00:00:00.000Z"),
    }).recordSnapshot({ snapshot_id: id, request_completed_at: "2026-07-01T00:00:00.000Z" }),
    /must not be later/,
  );
  await assert.rejects(
    () => new EvaluationPipeline(new AppendOnlyEvaluationLog(join(dir, "reserved.jsonl")), { realYield: provider })
      .recordSnapshot({
        snapshot_id: id,
        request_completed_at: "2026-07-01T00:00:00.000Z",
        evaluation_context: { real_yield_10y: { value: 99 } },
      }),
    /is reserved/,
  );
  assert.equal(calls, 0);
});

test("EvaluationPipeline rejects inconsistent provider evidence without writing a log record", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-pipeline-"));
  const id = "c9c11947-fafa-4cfb-bf9b-4fb369eaa2cc";
  const snapshot = { snapshot_id: id, request_completed_at: "2026-07-01T12:00:00.000Z" };
  for (const [name, context, pattern] of [
    ["blocked-value", realYieldContext({ status: "unavailable", point_in_time_status: "blocked" }), /must not contain/],
    ["future-available", realYieldContext({ available_at: "2026-07-01T13:00:00.000Z", first_seen_at: "2026-07-01T13:00:00.000Z", observed_at: "2026-07-01T13:00:00.000Z" }), /later than as_of/],
    ["wrong-cutoff", realYieldContext({ as_of: "2026-07-01T11:00:00.000Z" }), /mismatched as_of/],
    ["invalid-date", realYieldContext({ observation_date: "2026-02-30" }), /observation_date/],
    ["before-observation", realYieldContext({ observation_date: "2026-07-01", available_at: "2026-06-30T23:00:00.000Z", first_seen_at: "2026-06-30T23:00:00.000Z", observed_at: "2026-06-30T23:00:00.000Z" }), /observation_date/],
    ["wrong-observed", realYieldContext({ observed_at: "2026-07-01T09:59:59.000Z" }), /inconsistent/],
  ]) {
    const path = join(dir, `${name}.jsonl`);
    const pipeline = new EvaluationPipeline(new AppendOnlyEvaluationLog(path), {
      realYield: { async getAsOf() { return context; } },
    });
    await assert.rejects(() => pipeline.recordSnapshot(snapshot), pattern);
    await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
  }
  const failedPath = join(dir, "provider-error.jsonl");
  const failed = new EvaluationPipeline(new AppendOnlyEvaluationLog(failedPath), {
    realYield: { async getAsOf() { throw new Error("history corrupt"); } },
  });
  await assert.rejects(() => failed.recordSnapshot(snapshot), /history corrupt/);
  await assert.rejects(() => readFile(failedPath, "utf8"), /ENOENT/);
});
