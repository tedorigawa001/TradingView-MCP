import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MacroSurpriseEvidenceStore, MacroSurpriseRawArchive } from "../../build/macroSurpriseEvidence.js";
import { collectOfficialMacroActuals, parseOfficialCpiAllItemsYoyActual, parseOfficialFomcTargetRateMidpointActual, parseOfficialNfpTotalNonfarmChangeActual } from "../../build/officialMacroActualSources.js";
import { parseOfficialMacroActualCollectionCliArguments } from "../../build/officialMacroActualCollectionCli.js";

test("official macro actual parsers select the fixed CPI, NFP, and FOMC metrics", () => {
  assert.equal(parseOfficialCpiAllItemsYoyActual("Over the last 12 months, the all items index increased 3.8 percent before seasonal adjustment."), 3.8);
  assert.equal(parseOfficialNfpTotalNonfarmChangeActual("Total nonfarm payroll employment edged down by 92,000 in February."), -92);
  assert.equal(parseOfficialNfpTotalNonfarmChangeActual("Total nonfarm payroll employment was unchanged."), 0);
  assert.throws(() => parseOfficialNfpTotalNonfarmChangeActual("Total nonfarm payroll employment changed little."), /did not contain/);
  assert.equal(parseOfficialFomcTargetRateMidpointActual("The Committee decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent."), 3.625);
  assert.throws(() => parseOfficialCpiAllItemsYoyActual("monthly CPI increased 0.3 percent"), /all-items year-over-year/);
});

test("official actual collector only records a source document within the release capture window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "macro-actual-"));
  const now = new Date("2026-08-13T12:31:00.000Z");
  const store = new MacroSurpriseEvidenceStore(join(directory, "evidence.jsonl"), () => now);
  const archive = new MacroSurpriseRawArchive(join(directory, "raw"));
  const event = { event_id: "us_nfp:2026-08-13", event_kind: "us_nfp", occurred_at: "2026-08-13T12:30:00.000Z", source_url: "https://www.bls.gov/news.release/archives/empsit_08132026.htm", raw_sha256: `sha256:${"a".repeat(64)}` };
  const response = { ok: true, status: 200, url: event.source_url, headers: { get: () => null }, text: async () => "Total nonfarm payroll employment increased by 172,000 in July." };
  const result = await collectOfficialMacroActuals({ events: [event], store, archive, now, fetch: async () => response });
  assert.equal(result.recorded, 1);
  const late = await collectOfficialMacroActuals({ events: [event], store, archive, now: new Date("2026-08-13T12:45:00.001Z"), fetch: async () => response });
  assert.deepEqual(late, { eligible_events: 0, recorded: 0, unchanged: 0, revisions: 0 });
});

test("official actual collector rejects an artifact that claims a non-official host before fetching it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "macro-actual-"));
  const now = new Date("2026-08-13T12:31:00.000Z");
  const store = new MacroSurpriseEvidenceStore(join(directory, "evidence.jsonl"), () => now);
  const archive = new MacroSurpriseRawArchive(join(directory, "raw"));
  const forged = { event_id: "us_nfp:2026-08-13", event_kind: "us_nfp", occurred_at: "2026-08-13T12:30:00.000Z", source_url: "https://example.test/not-bls", raw_sha256: `sha256:${"a".repeat(64)}` };
  let fetchCalls = 0;
  await assert.rejects(() => collectOfficialMacroActuals({ events: [forged], store, archive, now, fetch: async () => { fetchCalls += 1; throw new Error("must not fetch"); } }), /official source provenance/);
  assert.equal(fetchCalls, 0);
});

test("official actual CLI requires all event artifacts and external-fetch confirmation", () => {
  assert.throws(() => parseOfficialMacroActualCollectionCliArguments(["--events", "cpi.json"]), /exactly three/);
  assert.deepEqual(parseOfficialMacroActualCollectionCliArguments(["--events", "cpi.json", "--events", "nfp.json", "--events", "fomc.json", "--confirm-external-fetch"]), { eventPaths: ["cpi.json", "nfp.json", "fomc.json"], confirmed: true });
});
