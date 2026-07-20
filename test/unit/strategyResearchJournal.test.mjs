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
