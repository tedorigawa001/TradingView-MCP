import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnalysisJournalStore,
  AnalysisDefinitionConflictError,
  analysisDefinitionHash,
} from "../../build/analysisJournal.js";

const definition = (analysisId, confidence = 0.8) => ({
  analysisId,
  symbol: "OANDA:USDJPY",
  timeframe: "240",
  chartIndex: 0,
  pineId: "USER;8f868f366873411aa46bd30872711544",
  pineVersion: "2.0",
  studyId: "overlay2",
  analyzedAt: "2026-07-16T01:00:00.000Z",
  expiresAt: "2026-07-16T05:00:00.000Z",
  bias: "bullish",
  entryLow: 162.1,
  entryHigh: 162.2,
  confirmation: 162.3,
  invalidation: 161.95,
  stop: 161.9,
  targets: [162.6],
  confidence,
  note: "journal test",
  analysisSymbol: "OANDA:USDJPY",
  analysisTimeframe: "240",
  snapshotId: "67fa3a10-fdf7-47ac-a4f7-9a3047545930",
  strategyVersion: "Bushido-2026.07",
});

const outcome = (label, status, evidenceThrough, evaluatedAt = "2026-07-16T06:00:00.000Z") => ({
  status,
  outcome: label,
  evaluatedAt,
  evidenceTimeframe: "15",
  evidenceThrough,
  result: { status, outcome: label },
});

test("AnalysisJournalStore persists definitions idempotently with owner-only permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const path = join(directory, "private", "journal.jsonl");
  const store = new AnalysisJournalStore(path);
  const value = definition("USDJPY-20260716-0100");

  const first = await store.recordAnalysis(value);
  const second = await store.recordAnalysis(value);
  assert.equal(first.recorded, true);
  assert.equal(second.recorded, false);
  assert.equal(second.idempotent, true);
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(directory, "private"))).mode & 0o777, 0o700);

  await assert.rejects(store.recordAnalysis({ ...value, confidence: 0.4 }), (err) => {
    assert.ok(err instanceof AnalysisDefinitionConflictError);
    assert.equal(err.code, "analysis_id_definition_conflict");
    return true;
  });
  await assert.rejects(
    store.recordAnalysis({
      ...value,
      snapshotId: "1318dd8e-299b-4e9b-bf5b-c8b1f8b807ad",
    }),
    AnalysisDefinitionConflictError,
  );
});

test("analysis definition hashing remains compatible with legacy context-free records", () => {
  const {
    analysisSymbol: _analysisSymbol,
    analysisTimeframe: _analysisTimeframe,
    snapshotId: _snapshotId,
    strategyVersion: _strategyVersion,
    ...legacy
  } = definition("USDJPY-legacy");
  const oldCanonical = {
    analysisId: legacy.analysisId,
    symbol: legacy.symbol,
    timeframe: legacy.timeframe,
    analyzedAt: legacy.analyzedAt,
    expiresAt: legacy.expiresAt,
    bias: legacy.bias,
    entryLow: legacy.entryLow,
    entryHigh: legacy.entryHigh,
    confirmation: legacy.confirmation,
    invalidation: legacy.invalidation,
    stop: legacy.stop,
    targets: legacy.targets,
    confidence: legacy.confidence,
    note: legacy.note,
  };
  const legacyHash = createHash("sha256").update(JSON.stringify(oldCanonical)).digest("hex");
  assert.equal(analysisDefinitionHash(legacy), legacyHash);
});

test("AnalysisJournalStore permits one idempotent path-metrics enrichment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const value = definition("USDJPY-enrichment");
  await store.recordAnalysis(value);
  const base = outcome("target_before_stop", "complete", "2026-07-16T03:00:00.000Z");
  await store.recordOutcome(value.analysisId, analysisDefinitionHash(value), base);
  const enriched = {
    ...base,
    evaluatedAt: "2026-07-16T09:00:00.000Z",
    result: {
      ...base.result,
      performance: { methodologyVersion: "1.0", structuralRiskPrice: 0.25, grossRealizedR: 1.8 },
    },
  };
  const enrichment = await store.recordOutcome(value.analysisId, analysisDefinitionHash(value), enriched);
  const repeated = await store.recordOutcome(value.analysisId, analysisDefinitionHash(value), enriched);
  assert.equal(enrichment.recorded, true);
  assert.equal(repeated.recorded, false);
  assert.equal(repeated.idempotent, true);
  const listed = await store.list({ analysisId: value.analysisId });
  assert.equal(listed.analyses[0].outcomeCount, 2);
  assert.equal(listed.analyses[0].latestOutcome.payload.result.performance.grossRealizedR, 1.8);
});

test("AnalysisJournalStore links a verified alert set idempotently and rejects replacements", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const value = definition("USDJPY-alerts");
  await store.recordAnalysis(value);
  const alerts = [
    {
      kind: "confirmation",
      alertId: 101,
      ownershipName: "BUSHIDO-MCP:0123456789abcdef:confirmation",
      operator: "cross_up",
      level: 162.3,
      expiration: "2026-07-16T05:00:00.000Z",
    },
    {
      kind: "invalidation",
      alertId: 102,
      ownershipName: "BUSHIDO-MCP:0123456789abcdef:invalidation",
      operator: "cross_down",
      level: 161.95,
      expiration: "2026-07-16T05:00:00.000Z",
    },
  ];
  const first = await store.recordAlertSet(value.analysisId, analysisDefinitionHash(value), alerts);
  const repeated = await store.recordAlertSet(value.analysisId, analysisDefinitionHash(value), [...alerts].reverse());
  assert.equal(first.recorded, true);
  assert.equal(repeated.recorded, false);
  assert.equal(repeated.idempotent, true);
  const listed = await store.list({ analysisId: value.analysisId });
  assert.equal(listed.analyses[0].alertLinkCount, 1);
  assert.equal(listed.analyses[0].latestAlertLink.kind, "alerts_created");
  await assert.rejects(
    store.recordAlertSet(value.analysisId, analysisDefinitionHash(value), [{ ...alerts[0], alertId: 999 }]),
    /conflicting alert linkage/,
  );
});

test("AnalysisJournalStore keeps completed outcomes monotonic and calibrates only target versus stop", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const win = definition("USDJPY-win", 0.8);
  const loss = definition("USDJPY-loss", 0.2);
  const ambiguous = definition("USDJPY-ambiguous", 0.5);
  for (const value of [win, loss, ambiguous]) await store.recordAnalysis(value);

  await store.recordOutcome(
    win.analysisId,
    analysisDefinitionHash(win),
    outcome("awaiting_terminal", "ongoing", "2026-07-16T02:00:00.000Z"),
  );
  const completed = await store.recordOutcome(
    win.analysisId,
    analysisDefinitionHash(win),
    outcome("target_before_stop", "complete", "2026-07-16T03:00:00.000Z"),
  );
  const completedRetry = await store.recordOutcome(
    win.analysisId,
    analysisDefinitionHash(win),
    outcome(
      "target_before_stop",
      "complete",
      "2026-07-16T03:00:00.000Z",
      "2026-07-16T08:00:00.000Z",
    ),
  );
  assert.equal(completed.recorded, true);
  assert.equal(completedRetry.recorded, false);
  assert.equal(completedRetry.idempotent, true);
  await store.recordOutcome(
    win.analysisId,
    analysisDefinitionHash(win),
    outcome("awaiting_terminal", "ongoing", "2026-07-16T04:00:00.000Z", "2026-07-16T07:00:00.000Z"),
  );
  await store.recordOutcome(
    loss.analysisId,
    analysisDefinitionHash(loss),
    outcome("stop_before_target", "complete", "2026-07-16T03:30:00.000Z"),
  );
  await store.recordOutcome(
    ambiguous.analysisId,
    analysisDefinitionHash(ambiguous),
    outcome("terminal_order_unknown", "ambiguous", "2026-07-16T03:15:00.000Z"),
  );

  const listed = await store.list({ analysisId: win.analysisId });
  assert.equal(listed.analyses[0].latestOutcome.payload.outcome, "target_before_stop");
  assert.equal(listed.analyses[0].outcomeCount, 3);

  const calibration = await store.calibration({ bins: 2 });
  assert.equal(calibration.population, 3);
  assert.equal(calibration.included, 2);
  assert.equal(calibration.excluded.terminal_order_unknown, 1);
  assert.ok(Math.abs(calibration.calibration.brier_score - 0.04) < 1e-12);

  await assert.rejects(
    store.recordOutcome(
      win.analysisId,
      analysisDefinitionHash(win),
      outcome("stop_before_target", "complete", "2026-07-16T03:00:00.000Z"),
    ),
    /conflicting terminal outcomes/,
  );
});

test("AnalysisJournalStore fails closed for a symlink journal path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const target = join(directory, "target.jsonl");
  const path = join(directory, "journal.jsonl");
  await symlink(target, path);
  const store = new AnalysisJournalStore(path);
  await assert.rejects(store.recordAnalysis(definition("USDJPY-symlink")), /regular file/);
});

test("AnalysisJournalStore rejects a structurally valid outcome with a mismatched definition", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const path = join(directory, "journal", "events.jsonl");
  const store = new AnalysisJournalStore(path);
  const value = definition("USDJPY-mismatch");
  await store.recordAnalysis(value);
  await appendFile(path, `${JSON.stringify({
    schema_version: "1.0",
    event_id: "55555555-5555-4555-8555-555555555555",
    sequence: 2,
    recorded_at: "2026-07-16T06:00:00.000Z",
    kind: "outcome_evaluated",
    analysis_id: value.analysisId,
    definition_hash: "0".repeat(64),
    payload: outcome("target_before_stop", "complete", "2026-07-16T03:00:00.000Z"),
  })}\n`, "utf8");
  await assert.rejects(store.list(), /orphaned or mismatched analysis outcome/);
});

test("AnalysisJournalStore safely reclaims an old lock whose owner process no longer exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const parent = join(directory, "private");
  const path = join(parent, "journal.jsonl");
  const lockPath = `${path}.lock`;
  await mkdir(parent, { mode: 0o700 });
  await writeFile(lockPath, "66666666-6666-4666-8666-666666666666 99999999\n", { mode: 0o600 });
  const old = new Date(Date.now() - 120_000);
  await utimes(lockPath, old, old);

  const result = await new AnalysisJournalStore(path).recordAnalysis(definition("USDJPY-stale-lock"));
  assert.equal(result.recorded, true);
  await assert.rejects(stat(lockPath), { code: "ENOENT" });
});

test("AnalysisJournalStore preserves a live-owner lock and identifies its path on timeout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const path = join(directory, "journal.jsonl");
  const lockPath = `${path}.lock`;
  await writeFile(
    lockPath,
    `77777777-7777-4777-8777-777777777777 ${process.pid}\n`,
    { mode: 0o600 },
  );
  const old = new Date(Date.now() - 120_000);
  await utimes(lockPath, old, old);

  await assert.rejects(
    new AnalysisJournalStore(path).recordAnalysis(definition("USDJPY-live-lock")),
    (err) => {
      assert.match(err.message, /timed out acquiring analysis journal lock/);
      assert.ok(err.message.includes(lockPath));
      return true;
    },
  );
  assert.equal((await stat(lockPath)).isFile(), true);
});
