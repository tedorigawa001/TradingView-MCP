import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("strategy research journal accepts every condition type the server can record", async () => {
  // The condition type lives in a TypeScript union and again in a runtime whitelist. They have
  // drifted apart before, and the type union alone cannot catch it because writes are validated at
  // runtime, so a new condition would compile and then fail every journal write.
  const directory = await mkdtemp(join(tmpdir(), "condition-types-"));
  const store = new StrategyResearchJournalStore(join(directory, "journal.jsonl"));
  // feature_outcome_relationships is excluded: it carries forward-return metrics rather than
  // directional ones and has its own test.
  const conditionTypes = [
    "session_auction", "session_exhaustion_handoff", "event_aftershock_retest", "failed_breakout",
    "fair_value_gap_retest", "composite_condition", "external_label_event",
  ];
  await store.registerEventHypothesis({
    hypothesisId: "all-condition-types", title: "Every condition type is writable",
    thesis: "Each condition type the server emits must pass runtime validation.",
    evaluationContract: { population: "in_sample", primaryMetric: "meanDirectionalReturn",
      primaryHorizonBars: 5, minimumEvents: 1, symbols: ["OANDA:EURUSD"], timeframes: ["60"] },
  });
  for (const [index, conditionType] of conditionTypes.entries()) {
    const record = {
      studyId: `sha256:${createHash("sha256").update(`study-${index}`).digest("hex")}`,
      hypothesisId: "all-condition-types", population: "in_sample",
      methodologyVersion: "v1", symbol: "OANDA:EURUSD", timeframe: "60", conditionType,
      definitionHash: `sha256:${createHash("sha256").update(`definition-${index}`).digest("hex")}`,
      source: { chartIndex: 0, requestedBars: 100, returnedBars: 100,
        from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" },
      sampleEvents: 5, minimumEvents: 1, outcomes: [{ branch: "b", horizonBars: 5, events: 5,
        meanDirectionalReturn: 0, medianDirectionalReturn: 0, positiveRate: 0.5, targetHitRate: 0.5 }],
      qualityIssues: [], minimumEventsMet: true, decision: "inconclusive", note: "",
    };
    const written = await store.recordEventStudy(record);
    assert.equal(written.recorded, true, `${conditionType} must be writable`);
  }
  assert.equal((await store.listEventStudies("all-condition-types")).length, conditionTypes.length);
});

test("strategy research journal keeps event-study hypotheses and computed evidence separate from strategy metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "event-research-"));
  const store = new StrategyResearchJournalStore(join(directory, "journal.jsonl"));
  const eventHypothesis = { hypothesisId: "handoff-gbpusd", title: "NY handoff exhaustion", thesis: "A failed handoff may reverse.", evaluationContract: { population: "out_of_sample", primaryMetric: "meanDirectionalReturn", primaryHorizonBars: 4, minimumEvents: 20, symbols: ["OANDA:GBPUSD"], timeframes: ["60"] } };
  await store.registerEventHypothesis(eventHypothesis);
  assert.equal((await store.registerEventHypothesis(eventHypothesis)).idempotent, true);
  const legacyRecord = { studyId: hash("a"), hypothesisId: "handoff-gbpusd", population: "out_of_sample", methodologyVersion: "session_exhaustion_handoff_event_study_v1", symbol: "OANDA:GBPUSD", timeframe: "60", conditionType: "session_exhaustion_handoff", definitionHash: hash("b"), source: { chartIndex: 1, requestedBars: 5000, returnedBars: 5000, from: "2026-01-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" }, sampleEvents: 19, minimumEvents: 20, outcomes: [{ branch: "exhaustion_down", horizonBars: 4, events: 13, meanDirectionalReturn: 0.001, medianDirectionalReturn: 0.001, positiveRate: 0.6, targetHitRate: 0.5 }], qualityIssues: ["minimum_event_count_not_met"], minimumEventsMet: false, decision: "inconclusive", note: "Too few events." };
  const recorded = await store.recordEventStudy(legacyRecord);
  assert.match(recorded.entry.evidence_hash, /^sha256:/);
  const expectedLegacyEvidenceHash = `sha256:${createHash("sha256").update(JSON.stringify({
    studyId: legacyRecord.studyId,
    source: legacyRecord.source,
    sampleEvents: legacyRecord.sampleEvents,
    outcomes: legacyRecord.outcomes,
    qualityIssues: legacyRecord.qualityIssues,
    minimumEventsMet: legacyRecord.minimumEventsMet,
  }), "utf8").digest("hex")}`;
  assert.equal(recorded.entry.evidence_hash, expectedLegacyEvidenceHash);
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

test("strategy research journal records feature-outcome evidence without directional-return coercion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "feature-research-"));
  const store = new StrategyResearchJournalStore(join(directory, "journal.jsonl"));
  const hypothesis = {
    hypothesisId: "xauusd-feature-discovery",
    title: "Point-in-time price feature discovery",
    thesis: "Predeclared price features may separate later returns.",
    evaluationContract: {
      population: "out_of_sample",
      primaryMetric: "meanForwardReturn",
      primaryHorizonBars: 4,
      minimumEvents: 100,
      symbols: ["OANDA:XAUUSD"],
      timeframes: ["60"],
    },
  };
  await store.registerEventHypothesis(hypothesis);
  const record = {
    studyId: hash("a"),
    hypothesisId: hypothesis.hypothesisId,
    population: "out_of_sample",
    methodologyVersion: "feature_outcome_relationships_v1",
    symbol: "OANDA:XAUUSD",
    timeframe: "60",
    conditionType: "feature_outcome_relationships",
    definitionHash: hash("b"),
    source: {
      chartIndex: 0,
      requestedBars: 5000,
      returnedBars: 5000,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    },
    sampleEvents: 4900,
    minimumEvents: 100,
    configurationTrials: 18,
    outcomes: [{
      branch: "body_direction:bullish_body",
      horizonBars: 4,
      events: 1600,
      meanForwardReturn: 0.001,
      medianForwardReturn: 0.0005,
      positiveRate: 0.54,
      meanMaxUpside: 0.004,
      meanMaxDownside: 0.003,
    }],
    qualityIssues: [],
    minimumEventsMet: true,
    decision: "inconclusive",
    note: "Discovery evidence only.",
  };
  const recorded = await store.recordEventStudy(record);
  assert.equal((await store.recordEventStudy(record)).idempotent, true);
  assert.equal(recorded.entry.payload.outcomes[0].meanDirectionalReturn, undefined);
  assert.equal(recorded.entry.payload.outcomes[0].meanForwardReturn, 0.001);
  const retriedWithMoreTrials = await store.recordEventStudy({
    ...record,
    configurationTrials: 24,
  });
  assert.notEqual(retriedWithMoreTrials.entry.evidence_hash, recorded.entry.evidence_hash);
  await assert.rejects(
    () => store.recordEventStudy({
      ...record,
      configurationTrials: 0,
    }),
    /invalid event configuration trials/,
  );
  await assert.rejects(
    () => store.recordEventStudy({
      ...record,
      outcomes: [{
        ...record.outcomes[0],
        meanDirectionalReturn: 0.001,
      }],
    }),
    /metrics do not match the condition type/,
  );
});

test("strategy research journal records lag correlations without coercing them into return metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "leadlag-research-"));
  const store = new StrategyResearchJournalStore(join(directory, "journal.jsonl"));
  const hypothesisId = "copper-gold-lead-lag";
  await store.registerEventHypothesis({
    hypothesisId,
    title: "Copper may lead gold",
    thesis: "Industrial demand may move copper before gold on a daily clock.",
    evaluationContract: {
      population: "in_sample",
      primaryMetric: "correlation",
      primaryHorizonBars: 1,
      minimumEvents: 100,
      symbols: ["COMEX_DL:GC1!"],
      timeframes: ["1D"],
    },
  });
  const record = {
    studyId: hash("a"),
    hypothesisId,
    population: "in_sample",
    methodologyVersion: "exact_timestamp_lead_lag_return_correlation_v1",
    symbol: "COMEX_DL:GC1!",
    timeframe: "1D",
    conditionType: "lead_lag_return_correlation",
    definitionHash: hash("b"),
    source: { chartIndex: 1, requestedBars: 5000, returnedBars: 5000,
      from: "2005-07-14T00:00:00.000Z", to: "2026-07-24T00:00:00.000Z" },
    sampleEvents: 4996,
    minimumEvents: 100,
    configurationTrials: 1,
    outcomes: [
      { branch: "reference_leads_primary", horizonBars: 1, events: 4995,
        correlation: -0.0257, correlationIntervalLower: -0.0534, correlationIntervalUpper: 0.002 },
      { branch: "reference_leads_primary", horizonBars: 6, events: 4990,
        correlation: -0.0281, correlationIntervalLower: -0.0558, correlationIntervalUpper: -0.0004 },
    ],
    qualityIssues: ["one_or_more_non_contiguous_bar_intervals"],
    minimumEventsMet: true,
    decision: "inconclusive",
    note: "Only lag 6 excluded zero, and it fails the Bonferroni reference for 21 scanned lags.",
  };
  const recorded = await store.recordEventStudy(record);
  assert.equal(recorded.entry.payload.conditionType, "lead_lag_return_correlation");
  assert.equal(recorded.entry.payload.outcomes[1].correlation, -0.0281);

  // A correlation is not a return, and the two must never be stored in the same field.
  await assert.rejects(() => store.recordEventStudy({
    ...record, studyId: hash("c"),
    outcomes: [{ ...record.outcomes[0], meanDirectionalReturn: 0.001 }],
  }), /metrics do not match the condition type/);
  await assert.rejects(() => store.recordEventStudy({
    ...record, studyId: hash("d"),
    outcomes: [{ ...record.outcomes[0], positiveRate: 0.5 }],
  }), /metrics do not match the condition type/);

  // A value outside [-1, 1] cannot have come from the scan the record claims.
  await assert.rejects(() => store.recordEventStudy({
    ...record, studyId: hash("e"),
    outcomes: [{ ...record.outcomes[0], correlation: 1.4 }],
  }), /correlation is out of range/);

  // A return-metric study must still refuse correlation fields.
  await assert.rejects(() => store.recordEventStudy({
    ...record, studyId: hash("f"), conditionType: "session_auction",
    outcomes: [{ branch: "accepted", horizonBars: 1, events: 10, meanDirectionalReturn: 0.001,
      medianDirectionalReturn: 0.001, positiveRate: 0.5, targetHitRate: 0.4, correlation: 0.2 }],
  }), /metrics do not match the condition type/);
});
