import type {
  AnalysisJournalDefinition,
  AnalysisJournalEntry,
  AnalysisJournalOutcome,
} from "./analysisJournal.js";
import { historyCoversExpiry } from "./analysisOutcome.js";

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
  reason: "expired_without_terminal" | "non_terminal_recheck" | "active_without_evaluation";
};

/** The outcomes that close an analysis without a terminal event, final only once the history reached its expiry. */
const WITHOUT_TERMINAL = new Set(["no_terminal_event", "not_activated", "expired_without_confirmation"]);

/**
 * Whether a recorded outcome's own evidence shows history through the expiry. A record from this version names the
 * proof the evaluation used (evidence.expiryCoveredBy: a closed bar or a forming bar past the expiry); an older one is
 * judged by its last closed bar (see historyCoversExpiry).
 */
function recordCoversExpiry(outcome: AnalysisJournalOutcome, expiresAt: string | null): boolean {
  const evidence = outcome.result.evidence;
  if (typeof evidence === "object" && evidence !== null && "expiryCoveredBy" in evidence) {
    const coveredBy = (evidence as { expiryCoveredBy: unknown }).expiryCoveredBy;
    return coveredBy === "closed_bar" || coveredBy === "forming_bar";
  }
  const closedThrough = typeof evidence === "object" && evidence !== null && typeof (evidence as { closedThrough?: unknown }).closedThrough === "string"
    ? (evidence as { closedThrough: string }).closedThrough
    : null;
  try {
    return historyCoversExpiry(closedThrough, outcome.evidenceTimeframe, expiresAt);
  } catch {
    return false;
  }
}

export function selectDueAnalyses(
  analyses: JournalAnalysisRecord[],
  options: { now?: Date; includeActive?: boolean; limit?: number } = {},
) {
  const nowMs = (options.now ?? new Date()).getTime();
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("due analysis limit must be between 1 and 50");
  }
  const candidates: DueAnalysisCandidate[] = [];
  const skipped: Array<{ analysisId: string; reason: string }> = [];

  for (const item of analyses) {
    const definition = item.definition.payload;
    const latest = item.latestOutcome?.payload ?? null;
    if (definition.bias === "neutral") {
      skipped.push({ analysisId: definition.analysisId, reason: "neutral_analysis" });
      continue;
    }
    if (latest?.status === "complete") {
      // An earlier version closed a result with no terminal by the clock alone, even when its history stopped short of
      // the expiry (BACKLOG 102-04). Such a record is named, not rechecked: the append-only journal cannot replace it (a
      // terminal found later conflicts, an equal result is a duplicate, an incomplete one ranks below it), so it would be
      // selected on every call and crowd out the analyses that are due. Repairing them is BACKLOG 102-32.
      skipped.push({
        analysisId: definition.analysisId,
        reason: WITHOUT_TERMINAL.has(latest.outcome) && !recordCoversExpiry(latest, definition.expiresAt)
          ? "legacy_complete_without_coverage" : "terminal_evaluation_exists",
      });
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

  // Results already evaluated after their expiry and still open (a gap, a short or stopped history, an ambiguous bar) go
  // last, least recently evaluated first: they may stay open, and with the oldest expiries they would otherwise take
  // every slot from the analyses that just became due (BACKLOG 102-04). The rest go by expiry, so an analysis whose
  // window has closed but has no evaluation since comes before one still active.
  const evaluatedAfterExpiry = (candidate: DueAnalysisCandidate) => candidate.latestOutcome !== null &&
    candidate.definition.expiresAt !== null &&
    Date.parse(candidate.latestOutcome.evaluatedAt) >= Date.parse(candidate.definition.expiresAt);
  candidates.sort((left, right) => {
    const leftOpen = evaluatedAfterExpiry(left), rightOpen = evaluatedAfterExpiry(right);
    if (leftOpen !== rightOpen) return leftOpen ? 1 : -1;
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
  };
}
