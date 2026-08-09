import assert from "node:assert/strict";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MacroSurpriseEvidenceStore, MacroSurpriseRawArchive, persistMacroSurpriseObservation } from "../../build/macroSurpriseEvidence.js";

const hash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const consensus = (overrides = {}) => ({ event_id: "us_nfp:2026-08-07", event_kind: "us_nfp", occurred_at: "2026-08-07T12:30:00.000Z", metric_id: "us_nfp_total_nonfarm_change_thousands", role: "consensus", value: 75, source_id: "licensed_calendar", source_url: "https://calendar.example.test/nfp", raw_sha256: hash, ...overrides });
const actual = (overrides = {}) => ({ ...consensus(), role: "actual", value: 110, source_id: "bls_official", source_url: "https://www.bls.gov/news.release/archives/empsit_08072026.htm", ...overrides });

test("macro surprise evidence accepts only a pre-release consensus and promptly captured actual", async () => {
  const directory = await mkdtemp(join(tmpdir(), "macro-surprise-"));
  let now = new Date("2026-08-07T12:00:00.000Z");
  const store = new MacroSurpriseEvidenceStore(join(directory, "evidence.jsonl"), () => now);
  await store.observe(consensus());
  now = new Date("2026-08-07T12:31:00.000Z");
  await store.observe(actual());
  const result = await store.getEligible("us_nfp:2026-08-07", new Date("2026-08-07T13:00:00.000Z"));
  assert.equal(result.status, "ready");
  if (result.status === "ready") assert.equal(result.value.surprise, 35);
});

test("macro surprise evidence refuses post-release forecasts, late actuals, metric drift, and historical backfill", async () => {
  const directory = await mkdtemp(join(tmpdir(), "macro-surprise-"));
  let now = new Date("2026-08-07T12:30:00.000Z");
  const store = new MacroSurpriseEvidenceStore(join(directory, "evidence.jsonl"), () => now);
  await assert.rejects(() => store.observe(consensus()), /consensus was not observed before release/);
  now = new Date("2026-08-07T12:45:00.001Z");
  await assert.rejects(() => store.observe(actual()), /release capture window/);
  await assert.rejects(() => store.observe(consensus({ metric_id: "us_cpi_all_items_yoy_percent" })), /metric for event kind/);
  now = new Date("2026-08-07T12:00:00.000Z");
  await store.observe(consensus());
  const blocked = await store.getEligible("us_nfp:2026-08-07", new Date("2026-08-07T13:00:00.000Z"));
  assert.deepEqual(blocked, { status: "blocked", blockers: ["no_actual_first_seen_in_release_capture_window"] });
  now = new Date("2026-08-07T12:31:00.000Z");
  await store.observe(actual());
  now = new Date("2026-08-07T12:29:00.000Z");
  await assert.rejects(() => store.observe(consensus({ value: 76 })), /clock moved backwards/);
});

test("macro surprise evidence accepts actuals only from the event's official document host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "macro-surprise-"));
  let now = new Date("2026-08-07T12:00:00.000Z");
  const store = new MacroSurpriseEvidenceStore(join(directory, "evidence.jsonl"), () => now);
  await store.observe(consensus());
  now = new Date("2026-08-07T12:31:00.000Z");
  await assert.rejects(() => store.observe(actual({ source_url: "https://calendar.example.test/nfp" })), /official source provenance/);
});

test("macro surprise evidence reclaims a verified stale lock so a crash cannot consume an actual capture window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "macro-surprise-"));
  const path = join(directory, "evidence.jsonl");
  await writeFile(`${path}.lock`, "crashed-owner\n", { mode: 0o600 });
  await utimes(`${path}.lock`, new Date("2026-08-07T11:00:00.000Z"), new Date("2026-08-07T11:00:00.000Z"));
  const store = new MacroSurpriseEvidenceStore(path, () => new Date("2026-08-07T12:00:00.000Z"));
  const result = await store.observe(consensus());
  assert.ok(result.recorded);
});

test("macro surprise persistence archives raw bytes before recording a source-backed value", async () => {
  const directory = await mkdtemp(join(tmpdir(), "macro-surprise-"));
  const archive = new MacroSurpriseRawArchive(join(directory, "raw"));
  const store = new MacroSurpriseEvidenceStore(join(directory, "evidence.jsonl"), () => new Date("2026-08-07T12:00:00.000Z"));
  const result = await persistMacroSurpriseObservation({ archive, store, raw: "provider payload", observation: consensus() });
  assert.equal(result.raw_archive.stored, true);
  assert.match(result.raw_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.ok(result.first_seen.recorded);
});
