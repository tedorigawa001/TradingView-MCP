import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ResearchCollectionHeartbeatStore,
  resolveResearchCollectionHeartbeatPath,
} from "../../build/researchCollectionHeartbeat.js";

const HYPOTHESES = [
  { hypothesis_id: "xauusd-15m-bearish-fvg", status: "complete", events: 0, recorded: false },
  { hypothesis_id: "eurusd-us10y-nonconfirmation", status: "complete", events: 0, recorded: false },
];
const store = async () => new ResearchCollectionHeartbeatStore(join(await mkdtemp(join(tmpdir(), "rch-")), "h.jsonl"));

test("a run that observed nothing is still recorded, which is the whole point", async () => {
  const heartbeat = await store();
  const first = await heartbeat.recordRun({
    observed_at: "2026-08-15T01:00:00.000Z", hypotheses: HYPOTHESES, chart_restored: true,
  });
  assert.equal(first.sequence, 1);
  assert.equal(first.observation_date, "2026-08-15");

  // A second quiet run an hour later. The evidence file would have gained
  // nothing from either; continuity is only visible here.
  const second = await heartbeat.recordRun({
    observed_at: "2026-08-15T02:00:00.000Z", hypotheses: HYPOTHESES, chart_restored: true,
  });
  assert.equal(second.sequence, 2);

  const coverage = await heartbeat.coverage(new Date("2026-08-15T05:00:00.000Z"));
  assert.equal(coverage.records, 2);
  assert.equal(coverage.maximum_gap_hours, 1);
  assert.equal(coverage.latest_run_age_hours, 3);
  assert.equal(coverage.chart_restoration_failures, 0);
  assert.deepEqual(coverage.by_hypothesis["xauusd-15m-bearish-fvg"], { attempts: 2, recorded: 0, events: 0 });
});

test("a stalled collector shows as an age no quiet run can produce", async () => {
  const heartbeat = await store();
  await heartbeat.recordRun({ observed_at: "2026-08-11T12:30:00.000Z", hypotheses: HYPOTHESES, chart_restored: true });
  // The gap that prompted this: four days of silence on an hourly job.
  const coverage = await heartbeat.coverage(new Date("2026-08-15T01:58:00.000Z"));
  assert.ok(coverage.latest_run_age_hours > 24, `expected a visible stall, got ${coverage.latest_run_age_hours}`);
  assert.equal(coverage.records, 1);
});

test("a failed chart restoration is counted rather than averaged away", async () => {
  const heartbeat = await store();
  await heartbeat.recordRun({ observed_at: "2026-08-15T01:00:00.000Z", hypotheses: HYPOTHESES, chart_restored: true });
  await heartbeat.recordRun({ observed_at: "2026-08-15T02:00:00.000Z", hypotheses: HYPOTHESES, chart_restored: false });
  const coverage = await heartbeat.coverage(new Date("2026-08-15T02:30:00.000Z"));
  assert.equal(coverage.chart_restoration_failures, 1);
});

test("a heartbeat that names no hypothesis, or a non-canonical time, is refused", async () => {
  const heartbeat = await store();
  await assert.rejects(() => heartbeat.recordRun({
    observed_at: "2026-08-15T01:00:00.000Z", hypotheses: [], chart_restored: true,
  }), /must name the hypotheses/);
  await assert.rejects(() => heartbeat.recordRun({
    observed_at: "2026-08-15T01:00:00Z", hypotheses: HYPOTHESES, chart_restored: true,
  }), /canonical timestamp/);
  await assert.rejects(() => heartbeat.recordRun({
    observed_at: "2026-08-15T01:00:00.000Z", chart_restored: true,
    hypotheses: [HYPOTHESES[0], HYPOTHESES[0]],
  }), /duplicate/);
});

test("the path is overridable and defaults beside the other first-seen stores", () => {
  assert.match(resolveResearchCollectionHeartbeatPath(undefined), /research-collection-heartbeats\.jsonl$/);
  assert.equal(resolveResearchCollectionHeartbeatPath("/tmp/x.jsonl"), "/tmp/x.jsonl");
});
