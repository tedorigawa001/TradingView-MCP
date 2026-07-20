import { createHash } from "node:crypto";
import type { PineSourceAudit } from "./pineAudit.js";

export interface ResearchProtocolWindow {
  windowId: string;
  population: "in_sample" | "out_of_sample";
  from: string;
  to: string;
}

export interface ResearchProtocolDefinition {
  pineId: string;
  pineVersion: string;
  pineKind: string | null;
  candidateIds: string[];
  windows: ResearchProtocolWindow[];
  minimumTrades: number;
  observedTrades: number | null;
  costs: {
    spreadPips: number | null;
    slippagePipsPerSide: number | null;
    commissionPerRoundTrip: number | null;
  };
  closedBarsOnly: boolean;
  restartDiffChecked: boolean;
  definitionFrozenAt: string;
  definitionLastChangedAt: string;
  oosFirstViewedAt: string | null;
}

export interface ResearchProtocolIssue {
  code: string;
  severity: "blocked" | "warning";
  category: "data_leakage" | "sample" | "costs" | "pine" | "multiplicity" | "time";
  message: string;
}

const timestamp = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return parsed;
};

const overlap = (left: { fromMs: number; toMs: number }, right: { fromMs: number; toMs: number }): boolean =>
  left.fromMs < right.toMs && right.fromMs < left.toMs;

export function validateResearchProtocol(
  definition: ResearchProtocolDefinition,
  audit: PineSourceAudit,
  evaluatedAt = new Date().toISOString(),
) {
  const evaluatedAtMs = timestamp(evaluatedAt, "evaluated_at");
  const frozenAt = timestamp(definition.definitionFrozenAt, "definition_frozen_at");
  const changedAt = timestamp(definition.definitionLastChangedAt, "definition_last_changed_at");
  const oosViewedAt = definition.oosFirstViewedAt === null
    ? null
    : timestamp(definition.oosFirstViewedAt, "oos_first_viewed_at");
  const windows = definition.windows.map((window) => {
    const from = timestamp(window.from, `${window.windowId}.from`);
    const to = timestamp(window.to, `${window.windowId}.to`);
    if (from >= to) throw new Error(`${window.windowId} must end after it starts`);
    return { ...window, fromMs: from, toMs: to };
  });
  const issues: ResearchProtocolIssue[] = [];
  const add = (issue: ResearchProtocolIssue) => issues.push(issue);

  if (definition.pineKind !== "strategy") {
    add({ code: "pine_is_not_strategy", severity: "blocked", category: "pine", message: "The resolved Pine script is not a strategy." });
  }
  if (!definition.closedBarsOnly) {
    add({ code: "forming_bars_included", severity: "blocked", category: "data_leakage", message: "Research evidence must exclude forming bars." });
  }
  if (!definition.restartDiffChecked) {
    add({ code: "restart_difference_not_checked", severity: "warning", category: "pine", message: "A restart/reload difference check has not been recorded." });
  }
  for (const finding of audit.findings) {
    add({ code: `pine_${finding.code}`, severity: "warning", category: "pine", message: finding.message });
  }

  const inSample = windows.filter((window) => window.population === "in_sample");
  const outOfSample = windows.filter((window) => window.population === "out_of_sample");
  if (inSample.length === 0 || outOfSample.length === 0) {
    add({ code: "is_or_oos_window_missing", severity: "blocked", category: "data_leakage", message: "At least one in-sample and one out-of-sample window are required." });
  }
  if (windows.some((window) => window.toMs > evaluatedAtMs)) {
    add({ code: "future_window", severity: "blocked", category: "time", message: "A research window ends in the future relative to evaluated_at." });
  }
  if (inSample.some((train) => outOfSample.some((test) => overlap(train, test)))) {
    add({ code: "is_oos_overlap", severity: "blocked", category: "data_leakage", message: "In-sample and out-of-sample windows overlap." });
  }
  if (outOfSample.some((left, index) => outOfSample.slice(index + 1).some((right) => overlap(left, right)))) {
    add({ code: "oos_windows_overlap", severity: "blocked", category: "data_leakage", message: "Out-of-sample windows overlap and would double-count evidence." });
  }

  if (new Set(definition.candidateIds).size !== definition.candidateIds.length) {
    add({ code: "duplicate_candidates", severity: "blocked", category: "multiplicity", message: "Candidate identifiers must be unique." });
  }
  if (new Set(definition.windows.map((window) => window.windowId)).size !== definition.windows.length) {
    add({ code: "duplicate_window_ids", severity: "blocked", category: "data_leakage", message: "Research window identifiers must be unique." });
  }
  if (definition.candidateIds.length > 8) {
    add({ code: "too_many_candidates", severity: "blocked", category: "multiplicity", message: "More than eight candidates exceeds the bounded research protocol." });
  } else if (definition.candidateIds.length > 4) {
    add({ code: "multiple_testing_pressure", severity: "warning", category: "multiplicity", message: "More than four candidates increases researcher degrees of freedom." });
  }

  if (definition.minimumTrades < 30) {
    add({ code: "low_minimum_trade_count", severity: "warning", category: "sample", message: "The planned minimum is below 30 trades and is suitable only for exploratory evidence." });
  }
  if (definition.observedTrades === null) {
    add({ code: "trade_count_not_observed", severity: "warning", category: "sample", message: "Observed trade count is not available yet." });
  } else if (definition.observedTrades < definition.minimumTrades) {
    add({ code: "minimum_trade_count_not_met", severity: "blocked", category: "sample", message: "Observed trades do not meet the predeclared minimum." });
  }

  const costValues = Object.values(definition.costs);
  if (costValues.some((value) => value === null)) {
    add({ code: "cost_assumptions_incomplete", severity: "blocked", category: "costs", message: "Spread, slippage, and commission assumptions must all be explicit." });
  } else if (costValues.every((value) => value === 0)) {
    add({ code: "zero_cost_assumption", severity: "warning", category: "costs", message: "All explicit trading-cost assumptions are zero." });
  }

  if (changedAt > frozenAt) {
    add({ code: "definition_changed_after_freeze", severity: "blocked", category: "data_leakage", message: "The research definition changed after the protocol was frozen." });
  }
  if (oosViewedAt !== null && frozenAt > oosViewedAt) {
    add({ code: "definition_frozen_after_oos_access", severity: "blocked", category: "data_leakage", message: "The protocol was frozen only after OOS evidence had been viewed." });
  }
  if (oosViewedAt !== null && changedAt > oosViewedAt) {
    add({ code: "definition_changed_after_oos_access", severity: "blocked", category: "data_leakage", message: "The research definition changed after OOS evidence had been viewed." });
  }
  if (frozenAt > evaluatedAtMs || changedAt > evaluatedAtMs || (oosViewedAt !== null && oosViewedAt > evaluatedAtMs)) {
    add({ code: "future_protocol_timestamp", severity: "blocked", category: "time", message: "A protocol lifecycle timestamp is in the future." });
  }

  const normalized = {
    ...definition,
    candidateIds: [...definition.candidateIds],
    windows: definition.windows.map((window) => ({ ...window })),
  };
  const protocolId = `sha256:${createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex")}`;
  const blocked = issues.filter((issue) => issue.severity === "blocked");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "research_protocol_v1" as const,
    protocolId,
    evaluatedAt,
    status: blocked.length > 0 ? "blocked" as const : warnings.length > 0 ? "warning" as const : "ready" as const,
    adoptionEligible: blocked.length === 0 && warnings.length === 0,
    definition: normalized,
    sourceAudit: audit,
    counts: { blocked: blocked.length, warnings: warnings.length },
    issues,
  };
}
