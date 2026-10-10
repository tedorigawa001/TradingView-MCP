import { posixModeEnforced } from "../../build/fsDurability.js";
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
import { selectDueAnalyses } from "../../build/dueAnalyses.js";
import { buildAnalysisPerformance } from "../../build/analysisPerformance.js";

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
  if (posixModeEnforced()) assert.equal((await stat(path)).mode & 0o777, 0o600);
  if (posixModeEnforced()) assert.equal((await stat(join(directory, "private"))).mode & 0o777, 0o700);

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

// BACKLOG 102-32: an evaluator before 0.1.22 closed a result with no terminal by the clock alone, even when its history
// stopped short of the expiry (05:00 here). Such a record gives way to what is recorded after it.
const legacyComplete = (label = "no_terminal_event") => outcome(label, "complete", "2026-07-16T03:00:00.000Z");
const covered = (label, evidenceThrough = "2026-07-16T03:00:00.000Z") => ({
  ...outcome(label, "complete", evidenceThrough, "2026-07-16T09:00:00.000Z"),
  result: { status: "complete", outcome: label, evidence: { closedThrough: "2026-07-16T05:00:00.000Z", expiryCoveredBy: "closed_bar" } },
});

test("a complete recorded without evidence through the expiry gives way to a later evaluation (BACKLOG 102-32)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const record = async (id, ...outcomes) => {
    const value = definition(id);
    await store.recordAnalysis(value);
    const results = [];
    for (const item of outcomes) results.push(await store.recordOutcome(id, analysisDefinitionHash(value), item));
    return results;
  };
  const latest = async (id) => (await store.list({ analysisId: id })).analyses[0].latestOutcome.payload;
  // A terminal found later does not conflict with it, and becomes the latest.
  const [, hit] = await record("hit-later", legacyComplete(), outcome("target_before_stop", "complete", "2026-07-16T04:00:00.000Z"));
  assert.equal(hit.recorded, true);
  assert.equal((await latest("hit-later")).outcome, "target_before_stop");
  // The same label with evidence through the expiry is no duplicate of it, even with the same evidence time.
  const [, proven] = await record("proven-later", legacyComplete(), covered("no_terminal_event"));
  assert.equal(proven.recorded, true);
  assert.deepEqual((await latest("proven-later")).result.evidence, { closedThrough: "2026-07-16T05:00:00.000Z", expiryCoveredBy: "closed_bar" });
  // An incomplete recheck recorded after it, even with earlier evidence, is the latest.
  await record("short-again", legacyComplete(), outcome("history_ends_before_expiry", "incomplete", "2026-07-16T02:00:00.000Z", "2026-07-16T09:00:00.000Z"));
  assert.equal((await latest("short-again")).outcome, "history_ends_before_expiry");
  // The legacy record itself again is a duplicate of itself; between complete results that are not legacy, nothing
  // changes: a different terminal still conflicts.
  const [, again] = await record("repeat", legacyComplete(), legacyComplete());
  assert.deepEqual([again.recorded, again.idempotent], [false, true]);
  await assert.rejects(store.recordOutcome("hit-later", analysisDefinitionHash(definition("hit-later")),
    outcome("stop_before_target", "complete", "2026-07-16T04:00:00.000Z")), /conflicting terminal outcomes/);
  // A legacy record left alone is still the latest, and counted until it is replaced; a target or stop from before the
  // gap check (no expiryCoveredBy) is counted as it is included.
  await record("left", legacyComplete("not_activated"));
  const calibration = await store.calibration({ bins: 2 });
  assert.deepEqual(calibration.legacy, { completeWithoutCoverage: 2, includedWithoutGapCheck: 1 });
  assert.equal(calibration.included, 1);
  const performance = buildAnalysisPerformance((await store.list({ limit: 500 })).analyses);
  assert.deepEqual(performance.groups[0].legacy, { completeWithoutCoverage: 2, includedWithoutGapCheck: 1 });
});

test("a legacy complete is rechecked once: after a recheck is recorded it is not selected as legacy again (102-32)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const value = definition("legacy");
  await store.recordAnalysis(value);
  await store.recordOutcome("legacy", analysisDefinitionHash(value), legacyComplete());
  const due = async () => selectDueAnalyses((await store.list({ limit: 500 })).analyses, { now: new Date("2026-07-17T00:00:00.000Z") });
  const before = await due();
  assert.deepEqual(before.candidates.map((candidate) => [candidate.analysisId, candidate.reason]), [["legacy", "legacy_complete_recheck"]]);
  assert.equal(before.legacyCompleteWithoutCoverage, 1);
  // The recheck finds the history still short and records that; the legacy record is no longer the latest.
  await store.recordOutcome("legacy", analysisDefinitionHash(value),
    outcome("history_ends_before_expiry", "incomplete", "2026-07-16T03:00:00.000Z", "2026-07-17T00:00:00.000Z"));
  const after = await due();
  assert.deepEqual(after.candidates.map((candidate) => [candidate.analysisId, candidate.reason]), [["legacy", "non_terminal_recheck"]]);
  assert.equal(after.legacyCompleteWithoutCoverage, 0);
  // Once a recheck proves it through the expiry, it is final.
  await store.recordOutcome("legacy", analysisDefinitionHash(value), covered("no_terminal_event", "2026-07-16T05:00:00.000Z"));
  const final = await due();
  assert.deepEqual(final.candidates, []);
  assert.deepEqual(final.skipped, [{ analysisId: "legacy", reason: "terminal_evaluation_exists" }]);
});

// 102-32 review: a legacy complete gives way only to what was recorded after it. Evaluations written before it (an
// ongoing one while the analysis was active, an incomplete one) stay below it, as before, so they do not come back as
// the latest, get counted wrong, or crowd out due analyses.
test("a legacy complete still outranks what was recorded before it, and only later records replace it (102-32 review)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const value = definition("ongoing-then-legacy");
  await store.recordAnalysis(value);
  const hash = analysisDefinitionHash(value);
  await store.recordOutcome("ongoing-then-legacy", hash, outcome("awaiting_entry", "ongoing", "2026-07-16T02:00:00.000Z", "2026-07-16T02:05:00.000Z"));
  await store.recordOutcome("ongoing-then-legacy", hash, legacyComplete("not_activated"));
  const fresh = definition("fresh");
  await store.recordAnalysis({ ...fresh, analyzedAt: "2026-10-08T01:00:00.000Z", expiresAt: "2026-10-09T01:00:00.000Z" });
  const latest = async () => (await store.list({ analysisId: "ongoing-then-legacy" })).analyses[0].latestOutcome.payload;
  assert.equal((await latest()).outcome, "not_activated", "the earlier ongoing record does not come back");
  assert.deepEqual((await store.calibration({ bins: 2 })).legacy, { completeWithoutCoverage: 1, includedWithoutGapCheck: 0 });
  const due = async () => selectDueAnalyses((await store.list({ limit: 500 })).analyses, { now: new Date("2026-10-10T00:00:00.000Z"), limit: 1 });
  const first = await due();
  assert.deepEqual(first.candidates.map((candidate) => candidate.analysisId), ["fresh"], "the fresh due analysis is not crowded out");
  assert.equal(first.legacyCompleteWithoutCoverage, 1);
  // A recheck whose history no longer reaches back (no evidence time) is recorded after it and replaces it, though its
  // evidence is older than the ongoing record's; it is not selected as a legacy record again.
  await store.recordOutcome("ongoing-then-legacy", hash, outcome("history_incomplete", "incomplete", null, "2026-10-10T00:00:00.000Z"));
  assert.equal((await latest()).outcome, "history_incomplete");
  // (The records here were evaluated on 15-minute bars, so the run evaluates on them too.)
  const all = selectDueAnalyses((await store.list({ limit: 500 })).analyses, { now: new Date("2026-10-10T00:00:00.000Z"), evaluationTimeframe: "15" });
  assert.deepEqual(all.candidates.map((candidate) => [candidate.analysisId, candidate.reason]), [["fresh", "expired_without_terminal"]]);
  // A history that does not reach back comes out the same on the same request, so it is named, not picked on every call.
  assert.deepEqual(all.skipped, [{ analysisId: "ongoing-then-legacy", reason: "history_short_fixed_for_request" }]);
  assert.equal(all.legacyCompleteWithoutCoverage, 0);
});

test("legacy completes keep conflicting with each other, and a 0.1.22+ terminal before the expiry is no old record (102-32 review)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const value = definition("two-legacy");
  await store.recordAnalysis(value);
  await store.recordOutcome("two-legacy", analysisDefinitionHash(value), legacyComplete("no_terminal_event"));
  // An older writer's legacy record with another label still conflicts, as before; a terminal found later does not.
  await assert.rejects(store.recordOutcome("two-legacy", analysisDefinitionHash(value), legacyComplete("not_activated")), /conflicting terminal outcomes/);
  // A complete that is not legacy stays final, even when an older writer's legacy record of its label and a later
  // incomplete one follow it.
  const proven = definition("proven-first");
  await store.recordAnalysis(proven);
  for (const item of [covered("no_terminal_event"), outcome("no_terminal_event", "complete", "2026-07-16T03:30:00.000Z"),
    outcome("history_incomplete", "incomplete", null, "2026-10-10T00:00:00.000Z")]) {
    assert.equal((await store.recordOutcome("proven-first", analysisDefinitionHash(proven), item)).recorded, true);
  }
  assert.equal((await store.list({ analysisId: "proven-first" })).analyses[0].latestOutcome.payload.result.evidence.expiryCoveredBy, "closed_bar");
  // A target recorded by 0.1.22 or later before the expiry names no proof (null), and was checked for gaps.
  const checked = definition("checked-hit");
  await store.recordAnalysis(checked);
  await store.recordOutcome("checked-hit", analysisDefinitionHash(checked), { ...outcome("target_before_stop", "complete", "2026-07-16T03:00:00.000Z"),
    result: { status: "complete", outcome: "target_before_stop", evidence: { closedThrough: "2026-07-16T03:00:00.000Z", expiryCoveredBy: null } } });
  assert.deepEqual((await store.calibration({ bins: 2 })).legacy, { completeWithoutCoverage: 1, includedWithoutGapCheck: 0 });
});

// 102-32 re-review: what a legacy complete gives way to, in detail.
test("a legacy complete gives way to records after the last legacy one, best ranked, even when one repeats an earlier record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const add = async (id, items) => {
    const value = definition(id);
    await store.recordAnalysis(value);
    const results = [];
    for (const item of items) results.push(await store.recordOutcome(id, analysisDefinitionHash(value), item));
    return results;
  };
  const latest = async (id) => (await store.list({ analysisId: id })).analyses[0].latestOutcome;
  // A recheck that repeats a record from before the legacy one is recorded, and replaces the legacy record.
  const earlier = outcome("history_incomplete", "incomplete", null, "2026-07-16T02:00:00.000Z");
  const repeat = await add("repeat-earlier", [earlier, legacyComplete("not_activated"), { ...earlier, evaluatedAt: "2026-10-10T00:00:00.000Z" }]);
  assert.equal(repeat[2].recorded, true);
  assert.equal((await latest("repeat-earlier")).payload.outcome, "history_incomplete");
  // After the last of two legacy records: what came after the first one does not count.
  await add("two-legacy", [legacyComplete("not_activated"), outcome("history_ends_before_expiry", "incomplete", "2026-07-16T03:30:00.000Z", "2026-07-17T00:00:00.000Z"),
    outcome("not_activated", "complete", "2026-07-16T03:45:00.000Z", "2026-07-18T00:00:00.000Z")]);
  assert.equal((await latest("two-legacy")).payload.outcome, "not_activated");
  // A recheck after the second one replaces it; what came between the two still does not count.
  const afterSecond = await store.recordOutcome("two-legacy", analysisDefinitionHash(definition("two-legacy")),
    outcome("history_incomplete", "incomplete", null, "2026-10-10T00:00:00.000Z"));
  assert.equal(afterSecond.recorded, true);
  assert.equal((await latest("two-legacy")).payload.outcome, "history_incomplete");
  // Among the records after it, the best ranked wins, not the last written.
  await add("best-after", [legacyComplete(), outcome("history_ends_before_expiry", "incomplete", "2026-07-16T04:00:00.000Z", "2026-07-17T00:00:00.000Z"),
    outcome("history_incomplete", "incomplete", null, "2026-10-10T00:00:00.000Z")]);
  assert.equal((await latest("best-after")).payload.outcome, "history_ends_before_expiry");
  // Among finals, the best ranked wins too.
  await add("best-final", [covered("no_terminal_event", "2026-07-16T05:00:00.000Z"), covered("no_terminal_event", "2026-07-16T04:30:00.000Z")]);
  assert.equal((await latest("best-final")).payload.evidenceThrough, "2026-07-16T05:00:00.000Z");
  // An old record whose last closed bar reaches the expiry is no legacy record: a different terminal still conflicts.
  const coveredOld = { ...outcome("no_terminal_event", "complete", "2026-07-16T05:00:00.000Z"), result: { evidence: { closedThrough: "2026-07-16T05:00:00.000Z" } } };
  await add("covered-old", [coveredOld]);
  await assert.rejects(store.recordOutcome("covered-old", analysisDefinitionHash(definition("covered-old")),
    outcome("target_before_stop", "complete", "2026-07-16T04:00:00.000Z")), /conflicting terminal outcomes/);
});

test("legacy records rechecked into a history that does not reach back do not take every later call (102-32 re-review)", async () => {
  // Four old intraday legacy completes, a limit of 3, and runs on the analysis timeframe (240), as evaluate_due_analyses
  // makes without evaluation_timeframe; each recheck finds the history no longer reaching back.
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const hashes = new Map();
  for (const id of ["old-0", "old-1", "old-2", "old-3"]) {
    const value = definition(id);
    hashes.set(id, analysisDefinitionHash(value));
    await store.recordAnalysis(value);
    await store.recordOutcome(id, hashes.get(id), legacyComplete("not_activated"));
  }
  const run = async (day, record) => {
    const selected = selectDueAnalyses((await store.list({ limit: 500 })).analyses, { now: new Date(`${day}T00:00:00.000Z`), limit: 3 });
    for (const candidate of selected.candidates) {
      await store.recordOutcome(candidate.analysisId, hashes.get(candidate.analysisId), { ...record(candidate.analysisId), evidenceTimeframe: "240", evaluatedAt: `${day}T00:00:00.000Z` });
    }
    return selected.candidates.map((candidate) => [candidate.analysisId, candidate.reason]);
  };
  const short = () => outcome("history_incomplete", "incomplete", null);
  assert.deepEqual(await run("2026-10-10", short), [["old-0", "legacy_complete_recheck"], ["old-1", "legacy_complete_recheck"], ["old-2", "legacy_complete_recheck"]]);
  // A new analysis expires; the next run takes it and the last legacy record, not the three already rechecked.
  const late = { ...definition("late"), analyzedAt: "2026-10-11T01:00:00.000Z", expiresAt: "2026-10-12T01:00:00.000Z" };
  hashes.set("late", analysisDefinitionHash(late));
  await store.recordAnalysis(late);
  const lateOrShort = (id) => id === "late" ? outcome("history_ends_before_expiry", "incomplete", "2026-10-11T20:00:00.000Z") : short();
  assert.deepEqual(await run("2026-10-13", lateOrShort), [["late", "expired_without_terminal"], ["old-3", "legacy_complete_recheck"]]);
  // And the run after that rechecks the new analysis's open result; the four short histories are named.
  const selected = selectDueAnalyses((await store.list({ limit: 500 })).analyses, { now: new Date("2026-10-14T00:00:00.000Z"), limit: 3 });
  assert.deepEqual(selected.candidates.map((candidate) => [candidate.analysisId, candidate.reason]), [["late", "non_terminal_recheck"]]);
  assert.deepEqual(selected.skipped.map((item) => item.reason), Array(4).fill("history_short_fixed_for_request"));
  assert.equal(selected.legacyCompleteWithoutCoverage, 0);
});

// 102-32 third review: due selection compares a run with the latest record, so what a run finds must be able to become
// the latest. A recheck that repeats a record from before the latest is recorded once; a short history found from more
// history than a record asked for is recorded too. Neither loops: the next run with the same request skips it.
test("a short history found on another request is recorded once, so the next run with that request skips it (102-32 third review)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const value = definition("short");
  const hash = analysisDefinitionHash(value);
  await store.recordAnalysis(value);
  await store.recordOutcome("short", hash, legacyComplete("not_activated"));
  const short = (timeframe, requestedBars = 1000, loadMoreBars = 0) => ({
    ...outcome("history_incomplete", "incomplete", null, "2026-10-10T00:00:00.000Z"),
    evidenceTimeframe: timeframe,
    result: { status: "incomplete", outcome: "history_incomplete", source: { requestedBars, returnedBars: requestedBars, loadMoreBars } },
  });
  const record = async (item) => (await store.recordOutcome("short", hash, item)).recorded;
  const due = async (request = {}) => selectDueAnalyses((await store.list({ limit: 500 })).analyses,
    { now: new Date("2026-10-11T00:00:00.000Z"), requestedBars: 1000, loadMoreBars: 0, ...request });
  const reasons = (selected) => [...selected.candidates.map((candidate) => candidate.reason), ...selected.skipped.map((item) => item.reason)];
  // A default run on the analysis timeframe (240), then one on 60: the 60 record is the latest.
  assert.equal(await record(short("240")), true);
  assert.equal(await record(short("60")), true);
  assert.deepEqual(reasons(await due()), ["non_terminal_recheck"]);
  // The next default run repeats the 240 record. It is recorded and becomes the latest, so the run after skips it.
  assert.equal(await record(short("240")), true);
  assert.equal((await store.list({ analysisId: "short" })).analyses[0].latestOutcome.payload.evidenceTimeframe, "240");
  assert.deepEqual(reasons(await due()), ["history_short_fixed_for_request"]);
  assert.equal(await record(short("240")), false, "repeated again, it is a duplicate");
  // A larger load, or more bars: recorded once, then that request (and any smaller one) skips it.
  for (const [request, item] of [[{ loadMoreBars: 2000 }, short("240", 1000, 2000)], [{ requestedBars: 5000 }, short("240", 5000, 0)]]) {
    assert.deepEqual(reasons(await due(request)), ["non_terminal_recheck"], JSON.stringify(request));
    assert.equal(await record(item), true, JSON.stringify(request));
    assert.deepEqual(reasons(await due(request)), ["history_short_fixed_for_request"], JSON.stringify(request));
    assert.equal(await record(item), false);
  }
  // A smaller request repeating the latest is a duplicate of it.
  assert.equal(await record(short("240", 1000, 0)), false);
  // Every recorded result counts: the legacy record, 240, 60, 240 again, the larger load and the larger count.
  assert.equal((await store.list({ analysisId: "short" })).analyses[0].outcomeCount, 6);
});

test("a duplicate is still found among the records after the latest, and a larger request matters only for a short history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analysis-journal-"));
  const store = new AnalysisJournalStore(join(directory, "journal", "events.jsonl"));
  const add = async (id, items) => {
    const value = definition(id);
    await store.recordAnalysis(value);
    const results = [];
    for (const item of items) results.push((await store.recordOutcome(id, analysisDefinitionHash(value), item)).recorded);
    return results;
  };
  // Two legacy records, the earlier one outranking the later (later evidence): the latest is the earlier one, and a
  // recheck that repeats the record between them is still recorded after the last one and replaces it.
  const between = outcome("history_ends_before_expiry", "incomplete", "2026-07-16T03:30:00.000Z", "2026-07-17T00:00:00.000Z");
  assert.deepEqual(await add("outranked-last", [outcome("not_activated", "complete", "2026-07-16T03:45:00.000Z"), between,
    outcome("not_activated", "complete", "2026-07-16T03:00:00.000Z"), { ...between, evaluatedAt: "2026-10-10T00:00:00.000Z" }]), [true, true, true, true]);
  assert.equal((await store.list({ analysisId: "outranked-last" })).analyses[0].latestOutcome.payload.evaluatedAt, "2026-10-10T00:00:00.000Z");
  // Another result from more bars is a duplicate as before: only a short history depends on how much was asked for.
  const ongoing = (requestedBars) => ({ ...outcome("awaiting_entry", "ongoing", "2026-07-16T02:00:00.000Z"),
    result: { status: "ongoing", outcome: "awaiting_entry", source: { requestedBars, loadMoreBars: 0 } } });
  assert.deepEqual(await add("ongoing-more-bars", [ongoing(1000), ongoing(5000)]), [true, false]);
});
