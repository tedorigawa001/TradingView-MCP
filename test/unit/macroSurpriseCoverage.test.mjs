import assert from "node:assert/strict";
import test from "node:test";
import { assessMacroSurpriseCoverage } from "../../build/macroSurpriseCoverage.js";
import { parseMacroSurpriseCoverageCliArguments } from "../../build/macroSurpriseCoverageCli.js";
import { MacroSurpriseEvidenceStore } from "../../build/macroSurpriseEvidence.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raw = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const event = (kind, date, occurredAt) => ({ event_id: `${kind}:${date}`, event_kind: kind, occurred_at: occurredAt, source_url: `https://example.test/${kind}/${date}`, raw_sha256: raw });
const artifact = (kind, events) => ({ schema_version: "1.0", series: "official_us_macro_release_events", evidence_tier: "official_revised_history", retrieved_at: "2026-08-01T00:00:00.000Z", event_kind: kind, events, non_publications: [], scheduled_future_releases: [], source_count: 1, coverage: { requested_from_year: 2026, requested_to_year: 2026, events_by_year: { "2026": events.length }, excused_non_publications_by_year: {}, missing_release_months: [], coverage_issues: [] } });
const row = (eventId, kind, occurredAt, role, firstSeenAt) => ({ schema_version: "1.0", sequence: 1, series: "macro_surprise_evidence", event_id: eventId, event_kind: kind, occurred_at: occurredAt, metric_id: kind === "us_nfp" ? "us_nfp_total_nonfarm_change_thousands" : "us_cpi_all_items_yoy_percent", role, value: 1, source_id: role === "actual" ? "bls_official" : "trading_economics_calendar", source_url: role === "actual" ? "https://www.bls.gov/news.release/archives/empsit_08072026.htm" : "https://api.tradingeconomics.com/calendar/country/united%20states/2026-08-07/2026-08-07", raw_sha256: raw, first_seen_at: firstSeenAt });

test("coverage keeps pre-collection history separate from missed forward evidence", () => {
  const past = event("us_nfp", "2026-08-07", "2026-08-07T12:30:00.000Z");
  const next = event("us_cpi", "2026-08-12", "2026-08-12T12:30:00.000Z");
  const result = assessMacroSurpriseCoverage({
    artifacts: [artifact("us_nfp", [past]), artifact("us_cpi", [next]), artifact("fomc_statement", [])],
    records: [row(past.event_id, past.event_kind, past.occurred_at, "consensus", "2026-08-10T00:00:00.000Z")],
    asOf: new Date("2026-08-13T00:00:00.000Z"),
  });
  assert.equal(result.collection_started_at, "2026-08-10T00:00:00.000Z");
  assert.equal(result.events_before_collection, 1);
  assert.equal(result.missing_forward_consensus, 1);
  assert.equal(result.missing_forward_actual, 1);
  assert.equal(result.eligible_events, 0);
});

test("coverage counts only event-matched pre-release consensus and timely actuals as eligible", () => {
  const release = event("us_nfp", "2026-08-07", "2026-08-07T12:30:00.000Z");
  const actual = { ...row(release.event_id, release.event_kind, release.occurred_at, "actual", "2026-08-07T12:31:00.000Z"), metric_id: "us_nfp_total_nonfarm_change_thousands" };
  const consensus = row(release.event_id, release.event_kind, release.occurred_at, "consensus", "2026-08-07T12:00:00.000Z");
  const result = assessMacroSurpriseCoverage({ artifacts: [artifact("us_nfp", [release]), artifact("us_cpi", []), artifact("fomc_statement", [])], records: [consensus, actual], asOf: new Date("2026-08-07T13:00:00.000Z") });
  assert.equal(result.eligible_events, 1);
  assert.equal(result.missing_forward_consensus, 0);
  assert.equal(result.missing_forward_actual, 0);
  assert.deepEqual(result.by_event_kind.us_nfp, { eligible: 1, missing_consensus: 0, missing_actual: 0, awaiting_actual: 0, future: 0, before_collection: 0 });
});

test("coverage rejects evidence not represented by its official event artifacts", () => {
  const release = event("us_nfp", "2026-08-07", "2026-08-07T12:30:00.000Z");
  assert.throws(() => assessMacroSurpriseCoverage({ artifacts: [artifact("us_nfp", [release]), artifact("us_cpi", []), artifact("fomc_statement", [])], records: [row("us_nfp:2026-08-14", "us_nfp", "2026-08-14T12:30:00.000Z", "consensus", "2026-08-07T12:00:00.000Z")], asOf: new Date("2026-08-08T00:00:00.000Z") }), /does not exist in official event artifacts/);
});

test("coverage retains a scheduled release after its time passes until the artifact is refreshed", () => {
  const release = event("us_nfp", "2026-08-07", "2026-08-07T12:30:00.000Z");
  const prior = event("us_cpi", "2026-08-01", "2026-08-01T12:30:00.000Z");
  const scheduledArtifact = { ...artifact("us_nfp", []), scheduled_future_releases: [release] };
  const result = assessMacroSurpriseCoverage({ artifacts: [scheduledArtifact, artifact("us_cpi", [prior]), artifact("fomc_statement", [])], records: [row(prior.event_id, prior.event_kind, prior.occurred_at, "consensus", "2026-08-01T12:00:00.000Z"), row(prior.event_id, prior.event_kind, prior.occurred_at, "actual", "2026-08-01T12:31:00.000Z")], asOf: new Date("2026-08-08T00:00:00.000Z") });
  assert.equal(result.missing_forward_consensus, 1);
  assert.equal(result.missing_forward_actual, 1);
});

test("coverage CLI requires all three official artifacts and explicit local import confirmation", () => {
  assert.throws(() => parseMacroSurpriseCoverageCliArguments(["--events", "nfp.json", "--confirm-local-import"]), /exactly three/);
  assert.throws(() => parseMacroSurpriseCoverageCliArguments(["--events", "nfp.json", "--events", "cpi.json", "--events", "fomc.json"]), /confirm-local-import/);
  assert.deepEqual(parseMacroSurpriseCoverageCliArguments(["--events", "nfp.json", "--events", "cpi.json", "--events", "fomc.json", "--confirm-local-import", "--out", "coverage.json"]), { eventPaths: ["nfp.json", "cpi.json", "fomc.json"], out: "coverage.json", confirmed: true });
});

// BACKLOG 102-13: the report is a view as of asOf, built only from records first seen by then, as the store's getEligible.
test("coverage counts an actual only from the moment it was first seen, as the store does", async () => {
  const release = event("us_nfp", "2026-08-07", "2026-08-07T12:30:00.000Z");
  let clock = "2026-08-07T12:00:00.000Z";
  const store = new MacroSurpriseEvidenceStore(join(await mkdtemp(join(tmpdir(), "tv-mcp-macro-surprise-")), "evidence.jsonl"), () => new Date(clock));
  const base = { event_id: release.event_id, event_kind: "us_nfp", occurred_at: release.occurred_at, metric_id: "us_nfp_total_nonfarm_change_thousands", raw_sha256: raw };
  await store.observe({ ...base, role: "consensus", value: 150, source_id: "trading_economics_calendar", source_url: "https://api.tradingeconomics.com/calendar/country/united%20states/2026-08-07/2026-08-07" });
  clock = "2026-08-07T12:31:00.000Z";
  await store.observe({ ...base, role: "actual", value: 175, source_id: "bls_official", source_url: "https://www.bls.gov/news.release/archives/empsit_08072026.htm" });
  const records = await store.list();
  const artifacts = [artifact("us_nfp", [release]), artifact("us_cpi", []), artifact("fomc_statement", [])];
  const view = async (asOf) => {
    const result = assessMacroSurpriseCoverage({ artifacts, records, asOf: new Date(asOf) });
    const bucket = Object.entries(result.by_event_kind.us_nfp).filter(([, count]) => count > 0).map(([name]) => name);
    return [bucket, (await store.getEligible(release.event_id, new Date(asOf))).status];
  };
  assert.deepEqual(await view("2026-08-07T12:29:59.999Z"), [["future"], "blocked"]);
  assert.deepEqual(await view("2026-08-07T12:30:00.000Z"), [["awaiting_actual"], "blocked"]);
  assert.deepEqual(await view("2026-08-07T12:30:59.999Z"), [["awaiting_actual"], "blocked"]);
  assert.deepEqual(await view("2026-08-07T12:31:00.000Z"), [["eligible"], "ready"]);
  assert.deepEqual(await view("2026-08-08T00:00:00.000Z"), [["eligible"], "ready"]);
});

test("records first seen after asOf neither start collection nor fill an event", () => {
  const past = event("us_nfp", "2026-08-07", "2026-08-07T12:30:00.000Z");
  const next = event("us_cpi", "2026-08-12", "2026-08-12T12:30:00.000Z");
  const artifacts = [artifact("us_nfp", [past]), artifact("us_cpi", [next]), artifact("fomc_statement", [])];
  const records = [
    row(next.event_id, next.event_kind, next.occurred_at, "consensus", "2026-08-10T00:00:00.000Z"),
    { ...row(next.event_id, next.event_kind, next.occurred_at, "actual", "2026-08-12T12:31:00.000Z"), source_url: "https://www.bls.gov/news.release/archives/cpi_08122026.htm" },
  ];
  // On 2026-08-09 nothing had been collected yet: the past release predates collection and no gap is known.
  const before = assessMacroSurpriseCoverage({ artifacts, records, asOf: new Date("2026-08-09T00:00:00.000Z") });
  assert.deepEqual([before.collection_started_at, before.readiness, before.events_before_collection, before.future_events, before.eligible_events],
    [null, "not_collecting_no_forward_evidence", 1, 1, 0]);
  // Collection starts at the first record seen by asOf, exactly at it.
  const started = assessMacroSurpriseCoverage({ artifacts, records, asOf: new Date("2026-08-10T00:00:00.000Z") });
  assert.deepEqual([started.collection_started_at, started.readiness], ["2026-08-10T00:00:00.000Z", "collecting_without_known_forward_gap"]);
  // At the CPI release the consensus is known and the actual not yet; once seen, the event is eligible.
  const waiting = assessMacroSurpriseCoverage({ artifacts, records, asOf: new Date("2026-08-12T12:30:00.000Z") });
  assert.deepEqual([waiting.awaiting_actual, waiting.eligible_events, waiting.missing_forward_consensus], [1, 0, 0]);
  const eligible = assessMacroSurpriseCoverage({ artifacts, records, asOf: new Date("2026-08-12T12:31:00.000Z") });
  assert.deepEqual([eligible.awaiting_actual, eligible.eligible_events], [0, 1]);
});

test("an actual first seen exactly 15 minutes after the release counts, and the wait ends there", () => {
  const release = event("us_nfp", "2026-08-07", "2026-08-07T12:30:00.000Z");
  const artifacts = [artifact("us_nfp", [release]), artifact("us_cpi", []), artifact("fomc_statement", [])];
  const consensus = row(release.event_id, release.event_kind, release.occurred_at, "consensus", "2026-08-07T12:00:00.000Z");
  const late = row(release.event_id, release.event_kind, release.occurred_at, "actual", "2026-08-07T12:45:00.000Z");
  const bucket = (records, asOf) => Object.entries(assessMacroSurpriseCoverage({ artifacts, records, asOf: new Date(asOf) }).by_event_kind.us_nfp)
    .filter(([, count]) => count > 0).map(([name]) => name);
  assert.deepEqual(bucket([consensus, late], "2026-08-07T12:45:00.000Z"), ["eligible"]);
  assert.deepEqual(bucket([consensus], "2026-08-07T12:45:00.000Z"), ["awaiting_actual"]);
  assert.deepEqual(bucket([consensus], "2026-08-07T12:45:00.001Z"), ["missing_actual"]);
});
