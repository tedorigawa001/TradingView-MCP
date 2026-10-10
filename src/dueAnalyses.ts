import type {
  AnalysisJournalDefinition,
  AnalysisJournalEntry,
  AnalysisJournalOutcome,
} from "./analysisJournal.js";
import { normalizeResolution } from "./analysisOverlay.js";
import { isLegacyUncoveredComplete, recordedProof } from "./analysisOutcomeEvidence.js";

export type JournalAnalysisRecord = {
  definition: AnalysisJournalEntry & { payload: AnalysisJournalDefinition };
  latestOutcome: (AnalysisJournalEntry & { payload: AnalysisJournalOutcome }) | null;
  outcomeCount: number;
};

export type DueAnalysisCandidate = {
  analysisId: string;
  definitionHash: string;
  definition: AnalysisJournalDefinition;
  latestOutcome: AnalysisJournalOutcome | null;
  reason: "expired_without_terminal" | "non_terminal_recheck" | "active_without_evaluation" | "legacy_complete_recheck";
};

export function selectDueAnalyses(
  analyses: JournalAnalysisRecord[],
  options: { now?: Date; includeActive?: boolean; limit?: number; evaluationTimeframe?: string; includeFixed?: boolean } = {},
) {
  const nowMs = (options.now ?? new Date()).getTime();
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("due analysis limit must be between 1 and 50");
  }
  const candidates: DueAnalysisCandidate[] = [];
  const skipped: Array<{ analysisId: string; reason: string }> = [];
  let legacyCompleteWithoutCoverage = 0;

  for (const item of analyses) {
    const definition = item.definition.payload;
    const latest = item.latestOutcome?.payload ?? null;
    if (definition.bias === "neutral") {
      skipped.push({ analysisId: definition.analysisId, reason: "neutral_analysis" });
      continue;
    }
    if (latest !== null && isLegacyUncoveredComplete(latest, definition.expiresAt)) {
      // An earlier version closed a result with no terminal by the clock alone, even when its history stopped short of
      // the expiry (BACKLOG 102-04). The journal now ranks such a record below any later evaluation and lets one replace
      // it (BACKLOG 102-32), so it is rechecked; once anything is recorded after it, it is no longer the latest and is not
      // picked again. It goes last, after the due analyses and the evaluated results that stayed open.
      legacyCompleteWithoutCoverage += 1;
      candidates.push({
        analysisId: definition.analysisId,
        definitionHash: item.definition.definition_hash,
        definition,
        latestOutcome: latest,
        reason: "legacy_complete_recheck",
      });
      continue;
    }
    if (latest?.status === "complete") {
      skipped.push({ analysisId: definition.analysisId, reason: "terminal_evaluation_exists" });
      continue;
    }
    // An ambiguous or gapped result whose history already reached the expiry comes out the same on every recheck with
    // the same bars, so it is named instead of switching the chart for it on every call. A recheck on another timeframe
    // than its record (evaluation_timeframe, or else the analysis timeframe) can change it: shorter bars may order an
    // ambiguous bar, longer ones may cover bars without trades. includeFixed rechecks it anyway, for bars that changed
    // with the chart's session or adjustment settings or a backfill.
    if (options.includeFixed !== true && latest !== null &&
      (latest.status === "ambiguous" || latest.outcome === "gap_in_evaluation_window") &&
      typeof recordedProof(latest) === "string" &&
      normalizeResolution(options.evaluationTimeframe ?? definition.timeframe) === normalizeResolution(latest.evidenceTimeframe)) {
      skipped.push({ analysisId: definition.analysisId, reason: "open_result_fixed_for_timeframe" });
      continue;
    }
    const expiryMs = definition.expiresAt === null ? null : Date.parse(definition.expiresAt);
    const expired = expiryMs !== null && expiryMs <= nowMs;
    if (latest !== null) {
      candidates.push({
        analysisId: definition.analysisId,
        definitionHash: item.definition.definition_hash,
        definition,
        latestOutcome: latest,
        reason: "non_terminal_recheck",
      });
      continue;
    }
    if (expired) {
      candidates.push({
        analysisId: definition.analysisId,
        definitionHash: item.definition.definition_hash,
        definition,
        latestOutcome: null,
        reason: "expired_without_terminal",
      });
      continue;
    }
    if (options.includeActive === true) {
      candidates.push({
        analysisId: definition.analysisId,
        definitionHash: item.definition.definition_hash,
        definition,
        latestOutcome: null,
        reason: "active_without_evaluation",
      });
    } else {
      skipped.push({ analysisId: definition.analysisId, reason: "active_not_due" });
    }
  }

  // Results that were evaluated and stayed open (ambiguous, a gap, a short or stopped history, history not reaching back)
  // go last: they may never resolve, and with the oldest expiries they would otherwise take every slot from the analyses
  // that just became due (BACKLOG 102-04). They go in the order their current result was first recorded, since a recheck
  // that finds the same result records nothing (rotating them fairly is BACKLOG 102-34). The rest go by expiry, so an
  // analysis whose window has closed but has no final evaluation comes before one still active.
  // Legacy completes come after those (BACKLOG 102-32): they are old, and one whose recheck keeps failing records nothing
  // and keeps its place, so it should block neither the due analyses nor the other open results.
  const group = (candidate: DueAnalysisCandidate) => candidate.reason === "legacy_complete_recheck" ? 2
    : candidate.latestOutcome !== null && candidate.latestOutcome.status !== "ongoing" ? 1 : 0;
  candidates.sort((left, right) => {
    const leftGroup = group(left), rightGroup = group(right);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    const leftOpen = leftGroup > 0;
    if (leftOpen) {
      const byEvaluation = Date.parse(left.latestOutcome!.evaluatedAt) - Date.parse(right.latestOutcome!.evaluatedAt);
      if (byEvaluation !== 0) return byEvaluation;
    }
    const leftExpiry = left.definition.expiresAt === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(left.definition.expiresAt);
    const rightExpiry = right.definition.expiresAt === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(right.definition.expiresAt);
    return leftExpiry - rightExpiry ||
      Date.parse(left.definition.analyzedAt) - Date.parse(right.definition.analyzedAt) ||
      left.analysisId.localeCompare(right.analysisId);
  });
  return {
    candidates: candidates.slice(0, limit),
    skipped,
    truncated: candidates.length > limit,
    eligible: candidates.length,
    legacyCompleteWithoutCoverage,
  };
}
