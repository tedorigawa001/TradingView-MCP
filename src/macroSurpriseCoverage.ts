import type { MacroSurpriseEvidenceRecord, MacroSurpriseEventKind } from "./macroSurpriseEvidence.js";
import type { OfficialMacroEvent, OfficialMacroEventArtifact } from "./officialMacroEventSources.js";

const EVENT_KINDS: readonly MacroSurpriseEventKind[] = ["us_cpi", "us_nfp", "fomc_statement"];
const ACTUAL_CAPTURE_WINDOW_MS = 15 * 60_000;

type CoverageBucket = { eligible: number; missing_consensus: number; missing_actual: number; awaiting_actual: number; future: number; before_collection: number };

const emptyBucket = (): CoverageBucket => ({ eligible: 0, missing_consensus: 0, missing_actual: 0, awaiting_actual: 0, future: 0, before_collection: 0 });

function assertArtifacts(artifacts: readonly OfficialMacroEventArtifact[]): Map<string, OfficialMacroEvent> {
  if (artifacts.length !== EVENT_KINDS.length) throw new Error("macro-surprise coverage requires exactly three official event artifacts");
  const kinds = new Set(artifacts.map((artifact) => artifact.event_kind));
  if (kinds.size !== EVENT_KINDS.length || EVENT_KINDS.some((kind) => !kinds.has(kind))) throw new Error("macro-surprise coverage requires one official event artifact for each event kind");
  const events = new Map<string, OfficialMacroEvent>();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object" || artifact.schema_version !== "1.0" || artifact.series !== "official_us_macro_release_events" || artifact.evidence_tier !== "official_revised_history" || !Array.isArray(artifact.events) || !Array.isArray(artifact.scheduled_future_releases) || !artifact.coverage || !Array.isArray(artifact.coverage.coverage_issues)) throw new Error("macro-surprise coverage artifact contract is invalid");
    if (artifact.coverage.coverage_issues.length > 0) throw new Error("macro-surprise coverage artifact has unresolved official release-history gaps");
    for (const event of [...artifact.events, ...artifact.scheduled_future_releases]) {
      if (event.event_kind !== artifact.event_kind || events.has(event.event_id)) throw new Error("macro-surprise coverage official events are ambiguous");
      events.set(event.event_id, event);
    }
  }
  return events;
}

/**
 * Separates releases that predate local collection from releases missed after collection began.
 * A historical official artifact never upgrades an unobserved historical forecast into forward
 * evidence; this report is only a readiness and operations view of the first-seen store.
 */
export function assessMacroSurpriseCoverage(input: {
  artifacts: readonly OfficialMacroEventArtifact[];
  records: readonly MacroSurpriseEvidenceRecord[];
  asOf: Date;
}) {
  if (!Number.isFinite(input.asOf.getTime())) throw new Error("macro-surprise coverage as_of is invalid");
  const officialEvents = assertArtifacts(input.artifacts);
  const byEvent = new Map<string, MacroSurpriseEvidenceRecord[]>();
  for (const record of input.records) {
    const event = officialEvents.get(record.event_id);
    if (!event || event.event_kind !== record.event_kind || event.occurred_at !== record.occurred_at) throw new Error(`macro-surprise evidence ${record.event_id} does not exist in official event artifacts`);
    const rows = byEvent.get(record.event_id) ?? [];
    rows.push(record);
    byEvent.set(record.event_id, rows);
  }
  const collectionStartedAt = input.records.map((record) => record.first_seen_at).sort()[0] ?? null;
  const asOfMs = input.asOf.getTime();
  const byEventKind = Object.fromEntries(EVENT_KINDS.map((kind) => [kind, emptyBucket()])) as Record<MacroSurpriseEventKind, CoverageBucket>;
  let eligibleEvents = 0;
  let missingForwardConsensus = 0;
  let missingForwardActual = 0;
  let eventsBeforeCollection = 0;
  let awaitingActual = 0;
  let futureEvents = 0;

  for (const event of officialEvents.values()) {
    const bucket = byEventKind[event.event_kind];
    const releaseMs = Date.parse(event.occurred_at);
    if (releaseMs > asOfMs) { bucket.future += 1; futureEvents += 1; continue; }
    if (collectionStartedAt === null || event.occurred_at < collectionStartedAt) { bucket.before_collection += 1; eventsBeforeCollection += 1; continue; }
    const rows = byEvent.get(event.event_id) ?? [];
    const consensus = rows.some((record) => record.role === "consensus" && record.first_seen_at < event.occurred_at);
    const actual = rows.some((record) => record.role === "actual" && record.first_seen_at >= event.occurred_at && Date.parse(record.first_seen_at) <= releaseMs + ACTUAL_CAPTURE_WINDOW_MS);
    if (!consensus) { bucket.missing_consensus += 1; missingForwardConsensus += 1; }
    if (actual) {
      if (consensus) { bucket.eligible += 1; eligibleEvents += 1; }
      continue;
    }
    if (asOfMs <= releaseMs + ACTUAL_CAPTURE_WINDOW_MS) { bucket.awaiting_actual += 1; awaitingActual += 1; }
    else { bucket.missing_actual += 1; missingForwardActual += 1; }
  }

  return {
    schema_version: "1.0" as const,
    series: "macro_surprise_forward_coverage" as const,
    contract_id: "us_macro_surprise_evidence_v1" as const,
    as_of: input.asOf.toISOString(),
    collection_started_at: collectionStartedAt,
    eligible_events: eligibleEvents,
    missing_forward_consensus: missingForwardConsensus,
    missing_forward_actual: missingForwardActual,
    awaiting_actual: awaitingActual,
    future_events: futureEvents,
    events_before_collection: eventsBeforeCollection,
    by_event_kind: byEventKind,
    readiness: collectionStartedAt === null
      ? "not_collecting_no_forward_evidence"
      : missingForwardConsensus > 0 || missingForwardActual > 0
        ? "blocked_forward_evidence_gap"
        : "collecting_without_known_forward_gap",
  };
}
