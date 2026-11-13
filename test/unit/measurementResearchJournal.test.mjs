import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import * as research from "../../build/strategyResearchJournal.js";

const digest = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
// Frozen v1 contract, calculated independently from its documented key order and UTF-8 JSON.
const MEASUREMENT_V1_HASH = "sha256:0c94aab4690577ab90ce939741f77e495c1d3194e728939eb04b1d1ec099615e";
const measurement = () => ({
  definitionSchema: "measurement_hypothesis_v1",
  hypothesisId: "quarterly-measurement",
  title: "Quarterly measurement",
  thesis: "A predeclared family of measurements may differ from zero.",
  evaluationContract: {
    population: "in_sample", primaryMetric: "t_statistic", minimumObservations: 30,
    observationUnit: "One non-overlapping calendar quarter per symbol.",
    familyDefinition: "EURUSD and XAUUSD, one two-sided test per symbol; no other tests.",
    decisionRule: "Holm correction across the two tests at family-wise alpha 0.05; otherwise inconclusive.",
    symbols: ["OANDA:EURUSD", "OANDA:XAUUSD"], timeframes: ["61"],
  },
});

async function temporaryJournal(t) {
  const directory = await mkdtemp(join(tmpdir(), "measurement-research-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "journal.jsonl");
  return { file, store: new research.StrategyResearchJournalStore(file) };
}

test("106-4 preserves literal pre-change definition/evidence hashes and legacy journal bytes", async (t) => {
  // Captured using the pre-106-4 implementation, including the old event format without auditDefinition.
  const bytes = await readFile(new URL("../fixtures/research-journal-pre1064.jsonl", import.meta.url));
  const entries = bytes.toString("utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(entries.map((entry) => [entry.definition_hash, entry.evidence_hash]), [
    ["sha256:9be1d7036daf5d6b55a33c05339ea36380beb35c6fa0b2703622fdea25e78de8", null],
    ["sha256:96377b50e6ca10a296cf6a4f1325faff122345ceb6260d451995b5ccfc4073f1", "sha256:86a52b3bd740b3f8c6423fd59e6db7d9c5c639f015a2a07404447dee18ee9dee"],
    ["sha256:64223ce64773f866686e0e197f1bbf6cb11171a1f19191910eb0d85c73bca066", null],
    ["sha256:d6e99196b21fcd55f71eb8d8416a5e0cba01820266870118213570f39511dd42", "sha256:15e376327cef8f82227819e2834e3836e12d3f37026a2d600efe9d91dc7cb22e"],
    ["sha256:3393e536d40e5942c978b45a69bc50d015aca1bdbe33a4e0bb95ebb7fc7ea322", null],
  ]);
  const existing = await temporaryJournal(t);
  const fresh = await temporaryJournal(t);
  await writeFile(existing.file, bytes, { mode: 0o600 });
  const methods = { hypothesis_registered: "registerHypothesis", experiment_recorded: "recordExperiment",
    event_hypothesis_registered: "registerEventHypothesis", event_study_recorded: "recordEventStudy" };
  for (const entry of entries) {
    const replay = await existing.store[methods[entry.kind]](entry.payload);
    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.entry, entry);
    const registered = await fresh.store[methods[entry.kind]](entry.payload);
    assert.equal(registered.entry.definition_hash, entry.definition_hash);
    assert.equal(registered.entry.evidence_hash, entry.evidence_hash);
    assert.deepEqual(registered.entry.payload, entry.payload);
  }
  assert.deepEqual(await readFile(existing.file), bytes);
});

test("106-4 measurement registration needs no trading contract and survives reopen idempotently", async (t) => {
  const { file, store } = await temporaryJournal(t);
  const first = await store.registerMeasurementHypothesis(measurement());
  assert.equal(first.recorded, true);
  assert.equal(first.entry.kind, "measurement_hypothesis_registered");
  assert.equal(first.entry.evidence_hash, null);
  assert.equal(first.entry.definition_hash, MEASUREMENT_V1_HASH);
  assert.deepEqual(first.entry.payload, measurement());
  const bytes = await readFile(file);
  const reopened = new research.StrategyResearchJournalStore(file);
  assert.deepEqual(await reopened.getMeasurementHypothesis(measurement().hypothesisId), first.entry);
  const replay = await reopened.registerMeasurementHypothesis(measurement());
  assert.equal(replay.idempotent, true);
  assert.equal(replay.recorded, false);
  assert.deepEqual(await readFile(file), bytes);
  assert.equal(await reopened.getMeasurementHypothesis("absent"), null);
  // Existing strategy/event consumers must not mistake a measurement for a tradable hypothesis.
  assert.equal(await reopened.findHypothesis("strategy", measurement().hypothesisId), null);
  assert.equal(await reopened.findHypothesis("event", measurement().hypothesisId), null);
  assert.deepEqual(await reopened.listEventStudies(), []);
  const legacy = JSON.parse((await readFile(new URL("../fixtures/research-journal-pre1064.jsonl", import.meta.url), "utf8")).split("\n")[1]);
  await assert.rejects(() => reopened.recordExperiment({ ...legacy.payload, hypothesisId: measurement().hypothesisId }), /not registered/);
});

test("106-4 preserves the frozen measurement v1 row and literal hash across reads and registration", async (t) => {
  // Do not regenerate this fixture from the implementation under test.
  const bytes = await readFile(new URL("../fixtures/measurement-research-v1.jsonl", import.meta.url));
  const entry = JSON.parse(bytes.toString("utf8"));
  assert.equal(entry.definition_hash, MEASUREMENT_V1_HASH);
  assert.equal(digest(entry.payload), MEASUREMENT_V1_HASH);
  const existing = await temporaryJournal(t);
  await writeFile(existing.file, bytes, { mode: 0o600 });
  const reopened = new research.StrategyResearchJournalStore(existing.file);
  assert.deepEqual(await reopened.getMeasurementHypothesis(entry.entity_id), entry);
  const replay = await reopened.registerMeasurementHypothesis(measurement());
  assert.equal(replay.recorded, false);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.entry, entry);
  assert.deepEqual(await readFile(existing.file), bytes);
  const fresh = await temporaryJournal(t);
  const registered = await fresh.store.registerMeasurementHypothesis(measurement());
  assert.equal(registered.entry.definition_hash, MEASUREMENT_V1_HASH);
  assert.deepEqual(registered.entry.payload, entry.payload);
});

test("106-4 normalizes only new measurement keys and market lists; every contract field is hash-bound", async (t) => {
  const { store } = await temporaryJournal(t);
  const input = measurement();
  const first = await store.registerMeasurementHypothesis(input);
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  reordered.evaluationContract = Object.fromEntries(Object.entries(input.evaluationContract).reverse());
  reordered.evaluationContract.symbols = ["oanda:xauusd", "oanda:eurusd", "OANDA:EURUSD"];
  reordered.evaluationContract.timeframes = ["61", "61"];
  assert.equal((await store.registerMeasurementHypothesis(reordered)).idempotent, true);
  for (const [field, value] of Object.entries({ population: "out_of_sample", minimumObservations: 31,
    observationUnit: "One week.", familyDefinition: "A different predeclared family.",
    decisionRule: "Use a different correction.", symbols: ["OANDA:EURUSD"], timeframes: ["60"] })) {
    const changed = { ...input, evaluationContract: { ...input.evaluationContract, [field]: value } };
    await assert.rejects(() => store.registerMeasurementHypothesis(changed), /different definition/, field);
  }
  for (const field of ["title", "thesis"]) {
    await assert.rejects(() => store.registerMeasurementHypothesis({ ...input, [field]: "Different" }), /different definition/);
  }
  assert.deepEqual(await store.getMeasurementHypothesis(input.hypothesisId), first.entry);
});

test("106-4 rejects malformed, coerced, trading and unsupported measurement definitions before append", async (t) => {
  const { file, store } = await temporaryJournal(t);
  const input = measurement();
  await store.registerMeasurementHypothesis(input);
  const before = await readFile(file);
  const invalid = [null, [], { ...input, definitionSchema: "unknown" }, { ...input, hypothesisId: undefined },
    { ...input, parentExperimentId: null }, { ...input, title: "   " }, { ...input, thesis: " " },
    { ...input, evaluationContract: [] }, { ...input, evaluationContract: null }];
  for (const [field, value] of [
    ["population", "unknown"], ["primaryMetric", "profitFactor"], ["primaryMetric", "p_value"],
    ["minimumTrades", 30], ["minimumProfitFactor", null], ["maximumDrawdownPercent", null],
    ["minimumObservations", 0], ["minimumObservations", 100001], ["minimumObservations", "30"],
    ["minimumObservations", 1.5], ["minimumObservations", Infinity],
    ["observationUnit", " "], ["familyDefinition", ""], ["decisionRule", ""],
    ["symbols", []], ["symbols", [null]], ["symbols", ["bad symbol"]], ["symbols", Array(21).fill("X")],
    ["timeframes", []], ["timeframes", [61]], ["timeframes", ["0"]], ["timeframes", Array(21).fill("61")],
  ]) invalid.push({ ...input, evaluationContract: { ...input.evaluationContract, [field]: value } });
  for (const value of invalid) await assert.rejects(() => store.registerMeasurementHypothesis(value));
  await assert.rejects(() => store.getMeasurementHypothesis(undefined), /invalid/);
  assert.deepEqual(await readFile(file), before);
});

for (const field of ["symbols", "timeframes"]) {
  test(`106-4 rejects sparse ${field} before creating or appending a measurement journal`, async (t) => {
    const { file, store } = await temporaryJournal(t);
    const input = measurement();
    const validItem = input.evaluationContract[field][0];
    const sparseLists = [new Array(1), Object.assign(new Array(3), { 0: validItem, 2: validItem })];
    for (const list of sparseLists) {
      await assert.rejects(() => store.registerMeasurementHypothesis({
        ...input, evaluationContract: { ...input.evaluationContract, [field]: list },
      }), new RegExp(`invalid measurement ${field}`));
      await assert.rejects(readFile(file), { code: "ENOENT" });
    }
    const registered = await store.registerMeasurementHypothesis(input);
    const bytes = await readFile(file);
    for (const list of sparseLists) {
      await assert.rejects(() => store.registerMeasurementHypothesis({
        ...input, hypothesisId: "invalid-sparse", evaluationContract: { ...input.evaluationContract, [field]: list },
      }), new RegExp(`invalid measurement ${field}`));
      assert.deepEqual(await readFile(file), bytes);
      assert.deepEqual(await store.getMeasurementHypothesis(input.hypothesisId), registered.entry);
    }
  });
}

test("106-4 detects corrupted measurement hashes and duplicate identities on read", async (t) => {
  const { file, store } = await temporaryJournal(t);
  const { entry } = await store.registerMeasurementHypothesis(measurement());
  const tampered = { ...entry, payload: { ...entry.payload, thesis: "Changed without a new hash" } };
  await writeFile(file, JSON.stringify(tampered) + "\n");
  await assert.rejects(() => store.getMeasurementHypothesis(entry.entity_id), /identity mismatch/);
  await writeFile(file, [entry, { ...entry, sequence: 2, event_id: "00000000-0000-4000-8000-000000000002" }].map(JSON.stringify).join("\n") + "\n");
  await assert.rejects(() => store.getMeasurementHypothesis(entry.entity_id), /duplicate measurement/);
});

test("106-4 measurement default path is separate from the legacy journal and supports a dedicated override", () => {
  assert.equal(research.resolveMeasurementResearchJournalPath(""), join(homedir(), ".tradingview-mcp", "measurement-research-journal.jsonl"));
  assert.notEqual(research.resolveMeasurementResearchJournalPath(""), research.resolveStrategyResearchJournalPath(""));
  assert.equal(research.resolveMeasurementResearchJournalPath(" /tmp/measurement-test.jsonl "), "/tmp/measurement-test.jsonl");
});

test("106-4 shared reader preserves old rows and identities if a caller explicitly uses a mixed journal", async (t) => {
  const { file, store } = await temporaryJournal(t);
  const bytes = await readFile(new URL("../fixtures/research-journal-pre1064.jsonl", import.meta.url));
  await writeFile(file, bytes, { mode: 0o600 });
  const registered = await store.registerMeasurementHypothesis({ ...measurement(), hypothesisId: "legacy-strategy" });
  assert.equal(registered.entry.sequence, 6);
  const after = await readFile(file);
  assert.deepEqual(after.subarray(0, bytes.length), bytes);
  const reopened = new research.StrategyResearchJournalStore(file);
  assert.equal((await reopened.findHypothesis("strategy", "legacy-strategy")).definition_hash,
    "sha256:9be1d7036daf5d6b55a33c05339ea36380beb35c6fa0b2703622fdea25e78de8");
  assert.equal((await reopened.getMeasurementHypothesis("legacy-strategy")).definition_hash, registered.entry.definition_hash);
  assert.equal((await reopened.listEventStudies()).length, 1);
  const rows = bytes.toString().trim().split("\n").map(JSON.parse);
  await assert.rejects(() => reopened.registerHypothesis({ ...rows[0].payload,
    evaluationContract: { ...rows[0].payload.evaluationContract, primaryMetric: "t_statistic" } }), /invalid primary metric/);
  await assert.rejects(() => reopened.registerEventHypothesis({ ...rows[2].payload,
    evaluationContract: { ...rows[2].payload.evaluationContract, primaryMetric: "t_statistic" } }), /invalid event primary metric/);
  assert.deepEqual(await readFile(file), after);
});
