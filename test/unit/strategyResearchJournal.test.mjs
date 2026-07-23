import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StrategyResearchJournalStore } from "../../build/strategyResearchJournal.js";

const hash = (letter) => `sha256:${letter.repeat(64)}`;

function hypothesis(overrides = {}) {
  return {
    hypothesisId: "next-bar-confirmation",
    title: "Next-bar continuation reduces false entries",
    thesis: "A close beyond the signal candle should improve downside-adjusted expectancy.",
    parentExperimentId: null,
    evaluationContract: {
      population: "in_sample",
      primaryMetric: "expectancy",
      minimumTrades: 30,
      symbols: ["OANDA:USDJPY"],
      timeframes: ["240"],
      minimumProfitFactor: 1.2,
      maximumDrawdownPercent: 0.01,
    },
    ...overrides,
  };
}

function experiment(overrides = {}) {
  return {
    experimentId: hash("a"),
    hypothesisId: "next-bar-confirmation",
    parentExperimentId: null,
    population: "in_sample",
    methodologyVersion: "1.0",
    symbol: "OANDA:USDJPY",
    timeframe: "240",
    baseline: {
      pineId: "USER;aaaaaaaa",
      pineVersion: "3.0",
      ledgerId: hash("b"),
      metrics: { totalTrades: 72, expectancy: 115.09, profitFactor: 1.459 },
    },
    candidate: {
      pineId: "USER;aaaaaaaa",
      pineVersion: "3.0",
      ledgerId: hash("c"),
      metrics: { totalTrades: 37, expectancy: 6.41, profitFactor: 1.021 },
    },
    conditionsMatched: true,
    minimumTradesMet: true,
    decision: "rejected",
    note: "Drawdown improved but expectancy collapsed.",
    ...overrides,
  };
}

test("strategy research journal binds immutable hypotheses and multiple exact evidence sets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strategy-research-"));
  const file = join(directory, "journal.jsonl");
  const store = new StrategyResearchJournalStore(file);
  const first = await store.registerHypothesis(hypothesis());
  assert.equal(first.recorded, true);
  assert.equal((await store.registerHypothesis(hypothesis())).idempotent, true);
  await assert.rejects(
    () => store.registerHypothesis(hypothesis({ thesis: "different" })),
    /different definition/,
  );

  const recorded = await store.recordExperiment(experiment());
  assert.equal(recorded.recorded, true);
  assert.match(recorded.entry.evidence_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await store.recordExperiment(experiment())).idempotent, true);
  const second = await store.recordExperiment(experiment({
    candidate: { ...experiment().candidate, ledgerId: hash("d") },
  }));
  assert.notEqual(second.entry.evidence_hash, recorded.entry.evidence_hash);

  const comparison = await store.compare([
    { experimentId: hash("a"), evidenceHash: recorded.entry.evidence_hash },
    { experimentId: hash("a"), evidenceHash: second.entry.evidence_hash },
  ]);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.experiments.length, 2);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await readFile(file, "utf8")).trim().split("\n").length, 3);
});

test("strategy research journal rejects orphaned experiments, unknown metrics, and symlink paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strategy-research-unsafe-"));
  const file = join(directory, "journal.jsonl");
  const store = new StrategyResearchJournalStore(file);
  await assert.rejects(() => store.recordExperiment(experiment()), /not registered/);
  await store.registerHypothesis(hypothesis());
  await assert.rejects(
    () => store.recordExperiment(experiment({ baseline: { ...experiment().baseline, metrics: { magicScore: 1 } } })),
    /unsupported research metric/,
  );
  const target = join(directory, "target.jsonl");
  await symlink(target, join(directory, "link.jsonl"));
  const linked = new StrategyResearchJournalStore(join(directory, "link.jsonl"));
  await assert.rejects(() => linked.registerHypothesis(hypothesis()), /regular file/);
});

test("strategy research journal keeps event-study hypotheses and computed evidence separate from strategy metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "event-research-"));
  const store = new StrategyResearchJournalStore(join(directory, "journal.jsonl"));
  const eventHypothesis = { hypothesisId: "handoff-gbpusd", title: "NY handoff exhaustion", thesis: "A failed handoff may reverse.", evaluationContract: { population: "out_of_sample", primaryMetric: "meanDirectionalReturn", primaryHorizonBars: 4, minimumEvents: 20, symbols: ["OANDA:GBPUSD"], timeframes: ["60"] } };
  await store.registerEventHypothesis(eventHypothesis);
  assert.equal((await store.registerEventHypothesis(eventHypothesis)).idempotent, true);
  const recorded = await store.recordEventStudy({ studyId: hash("a"), hypothesisId: "handoff-gbpusd", population: "out_of_sample", methodologyVersion: "session_exhaustion_handoff_event_study_v1", symbol: "OANDA:GBPUSD", timeframe: "60", conditionType: "session_exhaustion_handoff", definitionHash: hash("b"), source: { chartIndex: 1, requestedBars: 5000, returnedBars: 5000, from: "2026-01-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" }, sampleEvents: 19, minimumEvents: 20, outcomes: [{ branch: "exhaustion_down", horizonBars: 4, events: 13, meanDirectionalReturn: 0.001, medianDirectionalReturn: 0.001, positiveRate: 0.6, targetHitRate: 0.5 }], qualityIssues: ["minimum_event_count_not_met"], minimumEventsMet: false, decision: "inconclusive", note: "Too few events." });
  assert.match(recorded.entry.evidence_hash, /^sha256:/);
  assert.equal((await store.listEventStudies("handoff-gbpusd")).length, 1);
  const second = await store.recordEventStudy({ ...recorded.entry.payload, studyId: hash("c"), source: { ...recorded.entry.payload.source, to: "2026-07-02T00:00:00.000Z" } });
  const comparison = await store.compareEventStudies([{ studyId: hash("a"), evidenceHash: recorded.entry.evidence_hash }, { studyId: hash("c"), evidenceHash: second.entry.evidence_hash }]);
  assert.equal(comparison.comparable, true);
  await assert.rejects(() => store.recordEventStudy({ ...recorded.entry.payload, studyId: hash("d"), hypothesisId: "missing" }), /not registered/);
  await assert.rejects(() => store.registerEventHypothesis({ ...eventHypothesis, thesis: "different" }), /different definition/);
  const incompatible = await store.recordEventStudy({ ...recorded.entry.payload, studyId: hash("e"), definitionHash: hash("f") });
  const mismatch = await store.compareEventStudies([{ studyId: hash("a"), evidenceHash: recorded.entry.evidence_hash }, { studyId: hash("e"), evidenceHash: incompatible.entry.evidence_hash }]);
  assert.equal(mismatch.comparable, false);
  assert.ok(mismatch.incompatibilities.includes("condition_definition"));
});
