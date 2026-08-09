import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MacroSurpriseEvidenceStore, MacroSurpriseRawArchive } from "../../build/macroSurpriseEvidence.js";
import { collectTradingEconomicsMacroConsensus, parseTradingEconomicsConsensusSnapshot, validateTradingEconomicsMacroConsensusMappings } from "../../build/tradingEconomicsMacroConsensus.js";
import { parseTradingEconomicsMacroConsensusCliArguments } from "../../build/tradingEconomicsMacroConsensusCli.js";

const mappings = [
  { event_kind: "us_cpi", calendar_id: "101", metric_id: "us_cpi_all_items_yoy_percent", unit: "percent" },
  { event_kind: "us_nfp", calendar_id: "102", metric_id: "us_nfp_total_nonfarm_change_thousands", unit: "thousands" },
  { event_kind: "fomc_statement", calendar_id: "103", metric_id: "fomc_target_rate_midpoint_percent", unit: "percent" },
];
const event = { event_id: "us_nfp:2026-08-13", event_kind: "us_nfp", occurred_at: "2026-08-13T12:30:00.000Z", source_url: "https://www.bls.gov/news.release/empsit.htm", raw_sha256: `sha256:${"a".repeat(64)}` };

test("Trading Economics mapping is explicit, complete, and metric-bound", () => {
  assert.doesNotThrow(() => validateTradingEconomicsMacroConsensusMappings(mappings));
  assert.throws(() => validateTradingEconomicsMacroConsensusMappings([...mappings.slice(0, 2), { ...mappings[2], calendar_id: "102" }]), /distinct/);
  assert.throws(() => validateTradingEconomicsMacroConsensusMappings(mappings.slice(0, 2)), /exactly/);
});

test("Trading Economics parser binds a forecast to its exact official release and rejects late or mismatched rows", () => {
  const ready = parseTradingEconomicsConsensusSnapshot(JSON.stringify([{ CalendarId: "102", Date: "2026-08-13T12:30:00", Forecast: "95K", Actual: null, Unit: "K" }]), event, mappings[1]);
  assert.deepEqual(ready, { status: "ready", value: 95 });
  const missing = parseTradingEconomicsConsensusSnapshot(JSON.stringify([{ CalendarId: "102", Date: "2026-08-13T12:31:00", Forecast: "95K", Actual: null, Unit: "K" }]), event, mappings[1]);
  assert.deepEqual(missing, { status: "missing", reason: "calendar_id_or_release_time_not_present" });
  const late = parseTradingEconomicsConsensusSnapshot(JSON.stringify([{ CalendarId: "102", Date: "2026-08-13T12:30:00", Forecast: "95K", Actual: "110K", Unit: "K" }]), event, mappings[1]);
  assert.deepEqual(late, { status: "late", reason: "actual_was_already_present" });
  assert.throws(() => parseTradingEconomicsConsensusSnapshot(JSON.stringify([{ CalendarId: "102", Date: "2026-08-13T12:30:00", Forecast: "95", Actual: null, Unit: "%" }]), event, mappings[1]), /unit did not match thousands/);
});

test("collector never stores the API key in raw evidence metadata or accepts a released calendar row as consensus", async () => {
  const directory = await mkdtemp(join(tmpdir(), "te-macro-"));
  const now = new Date("2026-08-13T12:00:00.000Z");
  const store = new MacroSurpriseEvidenceStore(join(directory, "evidence.jsonl"), () => now);
  const archive = new MacroSurpriseRawArchive(join(directory, "raw"));
  const response = { ok: true, status: 200, url: "https://api.tradingeconomics.com/calendar/country/united%20states/2026-08-13/2026-08-13", headers: { get: () => null }, text: async () => JSON.stringify([{ CalendarId: "102", Date: "2026-08-13T12:30:00", Forecast: "95K", Actual: null, Unit: "K" }]) };
  const result = await collectTradingEconomicsMacroConsensus({ apiKey: "secret-not-to-record", mappings, events: [event], store, archive, now, fetch: async () => response });
  assert.equal(result.recorded, 1);
  const eligible = await store.getEligible(event.event_id, new Date("2026-08-13T12:15:00.000Z"));
  assert.deepEqual(eligible, { status: "blocked", blockers: ["no_actual_first_seen_in_release_capture_window"] });
});

test("collector CLI requires explicit source artifacts, mapping, and external-fetch confirmation", () => {
  assert.throws(() => parseTradingEconomicsMacroConsensusCliArguments(["--events", "cpi.json", "--mapping", "mapping.json"]), /exactly three/);
  assert.deepEqual(parseTradingEconomicsMacroConsensusCliArguments([
    "--events", "cpi.json", "--events", "nfp.json", "--events", "fomc.json", "--mapping", "mapping.json", "--confirm-external-fetch",
  ]), { eventPaths: ["cpi.json", "nfp.json", "fomc.json"], mappingPath: "mapping.json", confirmed: true });
});
