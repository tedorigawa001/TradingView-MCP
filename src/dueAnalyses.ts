import type {
  AnalysisJournalDefinition,
  AnalysisJournalEntry,
  AnalysisJournalOutcome,
} from "./analysisJournal.js";

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
      skipped.push({ analysisId: definition.analysisId, reason: "terminal_evaluation_exists" });
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

  candidates.sort((left, right) => {
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
