import assert from "node:assert/strict";
import test from "node:test";
import { assessMacroSurpriseCoverage } from "../../build/macroSurpriseCoverage.js";
import { parseMacroSurpriseCoverageCliArguments } from "../../build/macroSurpriseCoverageCli.js";

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
