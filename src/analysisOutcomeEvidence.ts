import type { AnalysisJournalOutcome } from "./analysisJournal.js";
import { historyCoversExpiry } from "./analysisOutcome.js";

/** The outcomes that close an analysis without a terminal event, final only once the history reached its expiry. */
export const WITHOUT_TERMINAL = new Set(["no_terminal_event", "not_activated", "expired_without_confirmation"]);

/**
 * The proof of reaching the expiry that a record names (evidence.expiryCoveredBy: a closed bar, or a forming bar past the
 * expiry), null when it names none, or undefined for a record from a version before it was recorded (BACKLOG 102-04),
 * which also predates the check for gaps inside the evaluation window.
 */
export function recordedProof(outcome: AnalysisJournalOutcome): "closed_bar" | "forming_bar" | null | undefined {
  const evidence = outcome.result.evidence;
  if (typeof evidence !== "object" || evidence === null || !("expiryCoveredBy" in evidence)) return undefined;
  const coveredBy = (evidence as { expiryCoveredBy: unknown }).expiryCoveredBy;
  return coveredBy === "closed_bar" || coveredBy === "forming_bar" ? coveredBy : null;
}

/**
 * Whether a recorded outcome's own evidence shows history through the expiry: the proof a record names, or for an older
 * one its last closed bar (see historyCoversExpiry).
 */
export function recordCoversExpiry(outcome: AnalysisJournalOutcome, expiresAt: string | null): boolean {
  const proof = recordedProof(outcome);
  if (proof !== undefined) return proof !== null;
  const evidence = outcome.result.evidence;
  const closedThrough = typeof evidence === "object" && evidence !== null && typeof (evidence as { closedThrough?: unknown }).closedThrough === "string"
    ? (evidence as { closedThrough: string }).closedThrough
    : null;
  try {
    return historyCoversExpiry(closedThrough, outcome.evidenceTimeframe, expiresAt);
  } catch {
    return false;
  }
}

/**
 * A complete result without a terminal event whose own evidence does not reach the expiry: before 0.1.22 the evaluator
 * closed such results by the clock alone (BACKLOG 102-04). It claims what its evidence does not show, so the journal ranks
 * it below every other evaluation of its analysis and lets a later evaluation replace it (BACKLOG 102-32).
 */
export function isLegacyUncoveredComplete(outcome: AnalysisJournalOutcome, expiresAt: string | null): boolean {
  return outcome.status === "complete" && WITHOUT_TERMINAL.has(outcome.outcome) && !recordCoversExpiry(outcome, expiresAt);
}

/**
 * A target or stop result recorded by a version that did not yet look for gaps in the window (no expiryCoveredBy): it may
 * have been decided by a bar after a gap, which its record cannot show. It is counted, not excluded (BACKLOG 102-32).
 */
export function isTerminalWithoutGapCheck(outcome: AnalysisJournalOutcome): boolean {
  return (outcome.outcome === "target_before_stop" || outcome.outcome === "stop_before_target") && recordedProof(outcome) === undefined;
}
