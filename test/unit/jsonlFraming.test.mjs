import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalysisJournalStore } from "../../build/analysisJournal.js";
import { AppendOnlyEvaluationLog } from "../../build/evaluationLog.js";
import { AppendOnlyFirstSeenLog } from "../../build/firstSeenStore.js";
import { FuturesOpenInterestFirstSeenStore } from "../../build/futuresOpenInterestHistory.js";
import { MacroSurpriseEvidenceStore } from "../../build/macroSurpriseEvidence.js";
import { appendOwnerOnly } from "../../build/researchCollectionCli.js";
import { StrategyResearchJournalStore } from "../../build/strategyResearchJournal.js";

// BACKLOG 102-08: a JSONL file whose last line has no newline reads, but an append would join the next record onto it
// ("}{") and every later read would fail. Each store refuses the append and leaves the file as it is.
const unframed = /does not end with a newline, so its last line may be incomplete; nothing was appended/;

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-jsonl-framing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** Drops the file's final newline, as a write cut off before it would leave it, and returns the bytes left. */
async function dropFinalNewline(path) {
  const text = await readFile(path, "utf8");
  assert.ok(text.endsWith("\n"));
  await writeFile(path, text.slice(0, -1), { mode: 0o600 });
  return readFile(path);
}

test("the shared first-seen log, and a store on it, refuse to append after a line without its newline", async (t) => {
  const directory = await scratch(t);
  const log = new AppendOnlyFirstSeenLog(join(directory, "log.jsonl"), "test", (value) => value, { maxFileBytes: 10_000, maxRecordBytes: 1_000 });
  await log.appendUnlocked({ sequence: 1, observation_date: "2026-07-20", first_seen_at: "2026-07-21T00:00:00.000Z" });
  const before = await dropFinalNewline(join(directory, "log.jsonl"));
  // The refusal names the file and how to settle it.
  await assert.rejects(() => log.appendUnlocked({ sequence: 2, observation_date: "2026-07-21", first_seen_at: "2026-07-22T00:00:00.000Z" }),
    (error) => error.message.startsWith("test history file does not end with a newline") &&
      error.message.includes(join(directory, "log.jsonl")) && /end it with a newline; if it was cut off, remove it/.test(error.message));
  assert.deepEqual(await readFile(join(directory, "log.jsonl")), before);
  assert.equal((await log.readAllUnlocked()).length, 1, "the file still reads");

  const path = join(directory, "oi.jsonl");
  const store = new FuturesOpenInterestFirstSeenStore(path);
  const observation = (date, observedAt) => ({ futures_symbol: "COMEX_DL:GC1!", scope: "all_months_aggregated", observation_date: date,
    open_interest: 383317, source: "tradingview_chart_indicator", observed_at: observedAt });
  await store.observeMany([observation("2026-07-21", "2026-07-23T00:00:00.000Z")]);
  const oiBefore = await dropFinalNewline(path);
  await assert.rejects(() => store.observeMany([observation("2026-07-22", "2026-07-24T00:00:00.000Z")]), unframed);
  assert.deepEqual(await readFile(path), oiBefore);
  assert.equal((await store.records()).length, 1);
});

test("the analysis journal refuses to append after a line without its newline", async (t) => {
  const path = join(await scratch(t), "journal.jsonl");
  const store = new AnalysisJournalStore(path);
  const definition = (analysisId) => ({ analysisId, symbol: "OANDA:USDJPY", timeframe: "240", chartIndex: 0,
    pineId: "USER;8f868f366873411aa46bd30872711544", pineVersion: "2.0", studyId: "overlay2", analyzedAt: "2026-07-16T01:00:00.000Z",
    expiresAt: "2026-07-16T05:00:00.000Z", bias: "bullish", entryLow: 162.1, entryHigh: 162.2, confirmation: 162.3, invalidation: 161.95,
    stop: 161.9, targets: [162.6], confidence: 0.8, note: "framing test" });
  await store.recordAnalysis(definition("USDJPY-framing-1"));
  const before = await dropFinalNewline(path);
  await assert.rejects(() => store.recordAnalysis(definition("USDJPY-framing-2")), unframed);
  assert.deepEqual(await readFile(path), before);
  assert.equal((await store.list()).analyses.length, 1);
});

test("the evaluation log refuses to append after a line without its newline", async (t) => {
  const path = join(await scratch(t), "evaluation.jsonl");
  const log = new AppendOnlyEvaluationLog(path);
  const snapshotId = "67fa3a10-fdf7-47ac-a4f7-9a3047545930";
  await log.append({ schema_version: "1.0", snapshot_id: snapshotId, kind: "snapshot", payload: { status: "partial" } });
  const before = await dropFinalNewline(path);
  await assert.rejects(() => log.append({ schema_version: "1.0", snapshot_id: snapshotId, kind: "features", payload: { atr: 0.01 } }), unframed);
  assert.deepEqual(await readFile(path), before);
  assert.equal((await log.readBySnapshotId(snapshotId)).length, 1);
});

test("the strategy research journal refuses to append after a line without its newline", async (t) => {
  const path = join(await scratch(t), "research.jsonl");
  const store = new StrategyResearchJournalStore(path);
  const hypothesis = (hypothesisId) => ({ hypothesisId, title: "Next-bar continuation reduces false entries",
    thesis: "A close beyond the signal candle should improve downside-adjusted expectancy.", parentExperimentId: null,
    evaluationContract: { population: "in_sample", primaryMetric: "expectancy", minimumTrades: 30, symbols: ["OANDA:USDJPY"],
      timeframes: ["240"], minimumProfitFactor: 1.2, maximumDrawdownPercent: 0.01 } });
  await store.registerHypothesis(hypothesis("framing-first"));
  const before = await dropFinalNewline(path);
  await assert.rejects(() => store.registerHypothesis(hypothesis("framing-second")), unframed);
  assert.deepEqual(await readFile(path), before);
  assert.equal((await store.registerHypothesis(hypothesis("framing-first"))).idempotent, true, "the file still reads");
});

test("the macro-surprise evidence log refuses to append after a line without its newline", async (t) => {
  const path = join(await scratch(t), "evidence.jsonl");
  let now = new Date("2026-08-07T12:00:00.000Z");
  const store = new MacroSurpriseEvidenceStore(path, () => now);
  const consensus = { event_id: "us_nfp:2026-08-07", event_kind: "us_nfp", occurred_at: "2026-08-07T12:30:00.000Z",
    metric_id: "us_nfp_total_nonfarm_change_thousands", role: "consensus", value: 75, source_id: "licensed_calendar",
    source_url: "https://calendar.example.test/nfp", raw_sha256: `sha256:${"a".repeat(64)}` };
  await store.observe(consensus);
  const before = await dropFinalNewline(path);
  now = new Date("2026-08-07T12:31:00.000Z");
  await assert.rejects(() => store.observe({ ...consensus, role: "actual", value: 110, source_id: "bls_official",
    source_url: "https://www.bls.gov/news.release/archives/empsit_08072026.htm" }), unframed);
  assert.deepEqual(await readFile(path), before);
  assert.equal((await store.list()).length, 1);
});

test("the research collection output refuses to append after a line without its newline", async (t) => {
  const path = join(await scratch(t), "collection.jsonl");
  assert.equal(await appendOwnerOnly(path, { hypothesis_id: "framing", primary_available_events: 1 }), true);
  const before = await dropFinalNewline(path);
  await assert.rejects(() => appendOwnerOnly(path, { hypothesis_id: "framing", primary_available_events: 2 }), unframed);
  assert.deepEqual(await readFile(path), before);
});

test("an append goes on after a file that ends in a newline, a CRLF one, or only a newline", async (t) => {
  // Without these the check could refuse every non-empty file and the refusal tests would still pass.
  const directory = await scratch(t);
  const record = (sequence) => ({ sequence, observation_date: "2026-07-20", first_seen_at: `2026-07-2${sequence}T00:00:00.000Z` });
  const log = (name) => new AppendOnlyFirstSeenLog(join(directory, name), "test", (value) => value, { maxFileBytes: 10_000, maxRecordBytes: 1_000 });
  const healthy = log("healthy.jsonl");
  await healthy.appendUnlocked(record(1));
  await healthy.appendUnlocked(record(2));
  assert.equal((await healthy.readAllUnlocked()).length, 2);
  await writeFile(join(directory, "crlf.jsonl"), `${JSON.stringify(record(1))}\r\n`, { mode: 0o600 });
  await log("crlf.jsonl").appendUnlocked(record(2));
  assert.equal((await readFile(join(directory, "crlf.jsonl"), "utf8")).split("\n").length, 3);
  await writeFile(join(directory, "newline.jsonl"), "\n", { mode: 0o600 });
  await log("newline.jsonl").appendUnlocked(record(1));
  assert.equal(await readFile(join(directory, "newline.jsonl"), "utf8"), `\n${JSON.stringify(record(1))}\n`);
  // The research collection output, which no other test appends to twice, takes a second, larger row.
  const output = join(directory, "collection.jsonl");
  assert.equal(await appendOwnerOnly(output, { hypothesis_id: "framing", primary_available_events: 1 }), true);
  assert.equal(await appendOwnerOnly(output, { hypothesis_id: "framing", primary_available_events: 2 }), true);
  assert.equal((await readFile(output, "utf8")).trim().split("\n").length, 2);
});
