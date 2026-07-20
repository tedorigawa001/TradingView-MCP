import { createHash } from "node:crypto";
import { normalizeResolution, type AnalysisOverlayState } from "./analysisOverlay.js";
import type { Alert } from "./tradingview.js";

export type AnalysisAlertKind = "confirmation" | "invalidation" | "target_1";
export type PriceAlertOperator = "cross_up" | "cross_down";

export type AnalysisAlertPlan = {
  kind: AnalysisAlertKind;
  ownershipName: string;
  symbol: string;
  resolution: string;
  operator: PriceAlertOperator;
  level: number;
  expiration: string;
  message: string;
};

export type ExistingAlertMatch = {
  plan: AnalysisAlertPlan;
  status: "missing" | "exact" | "conflict";
  alert: Alert | null;
  mismatches: string[];
};

function ownershipToken(analysisId: string): string {
  return createHash("sha256").update(analysisId, "utf8").digest("hex").slice(0, 16);
}

export function analysisAlertOwnershipName(analysisId: string, kind: AnalysisAlertKind): string {
  return `BUSHIDO-MCP:${ownershipToken(analysisId)}:${kind}`;
}

export function buildAnalysisAlertPlans(
  analysis: AnalysisOverlayState,
  symbol: string,
  timeframe: string,
  now = new Date(),
): AnalysisAlertPlan[] {
  if (analysis.bias === "neutral") throw new Error("neutral analyses do not have directional alert semantics");
  if (analysis.expiresAt === null) throw new Error("analysis expires_at is required for bounded monitoring alerts");
  const expirationMs = Date.parse(analysis.expiresAt);
  if (!Number.isFinite(expirationMs) || expirationMs <= now.getTime()) {
    throw new Error("analysis expires_at must be in the future");
  }
  if (analysis.targets.length === 0) throw new Error("analysis Target 1 is required");

  const bullish = analysis.bias === "bullish";
  const definitions: Array<{ kind: AnalysisAlertKind; level: number | null; operator: PriceAlertOperator }> = [
    { kind: "confirmation", level: analysis.confirmation, operator: bullish ? "cross_up" : "cross_down" },
    { kind: "invalidation", level: analysis.invalidation, operator: bullish ? "cross_down" : "cross_up" },
    { kind: "target_1", level: analysis.targets[0], operator: bullish ? "cross_up" : "cross_down" },
  ];
  return definitions
    .filter((definition): definition is typeof definition & { level: number } => definition.level !== null)
    .map((definition) => ({
      kind: definition.kind,
      ownershipName: analysisAlertOwnershipName(analysis.analysisId, definition.kind),
      symbol: symbol.toUpperCase(),
      resolution: normalizeResolution(timeframe),
      operator: definition.operator,
      level: definition.level,
      expiration: new Date(expirationMs).toISOString(),
      message: `Bushido ${definition.kind} ${symbol.toUpperCase()} @ ${definition.level}`,
    }));
}

function conditionShape(alert: Alert): { operator: unknown; level: unknown } {
  const condition = alert.condition;
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) {
    return { operator: null, level: null };
  }
  const object = condition as Record<string, unknown>;
  const series = Array.isArray(object.series) ? object.series : [];
  const valueSeries = series.find((item) =>
    item !== null && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).type === "value");
  return {
    operator: object.type,
    level: valueSeries && typeof valueSeries === "object"
      ? (valueSeries as Record<string, unknown>).value
      : null,
  };
}

export function matchExistingAnalysisAlerts(
  plans: AnalysisAlertPlan[],
  alerts: Alert[],
): ExistingAlertMatch[] {
  return plans.map((plan) => {
    const candidates = alerts.filter((alert) => alert.name === plan.ownershipName);
    if (candidates.length === 0) return { plan, status: "missing", alert: null, mismatches: [] };
    if (candidates.length > 1) {
      return {
        plan,
        status: "conflict",
        alert: null,
        mismatches: ["multiple_owned_alerts_with_same_name"],
      };
    }
    const alert = candidates[0];
    const condition = conditionShape(alert);
    const mismatches: string[] = [];
    if (alert.symbol.toUpperCase() !== plan.symbol) mismatches.push("symbol");
    if (alert.resolution === null || normalizeResolution(alert.resolution) !== plan.resolution) mismatches.push("resolution");
    if (condition.operator !== plan.operator) mismatches.push("operator");
    if (typeof condition.level !== "number" || condition.level !== plan.level) mismatches.push("level");
    if (!alert.active) mismatches.push("active");
    if (alert.expiration === null || Math.abs(Date.parse(String(alert.expiration)) - Date.parse(plan.expiration)) > 1_000) {
      mismatches.push("expiration");
    }
    return { plan, status: mismatches.length === 0 ? "exact" : "conflict", alert, mismatches };
  });
}
