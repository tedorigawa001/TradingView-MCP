import {
  normalizeResolution,
  validateAnalysisPayload,
  type AnalysisOverlayPayload,
} from "./analysisOverlay.js";

export type TradePlanEvent = {
  name: string;
  eventAt: string;
  importance: "low" | "medium" | "high";
  country?: string;
};

export type TradePlanValidationInput = AnalysisOverlayPayload & {
  symbol: string;
  timeframe: string;
  currentPrice: number;
  marketObservedAt: string;
  estimatedRoundTripCostPrice: number;
  minimumRiskReward: number;
  maxMarketAgeSeconds: number;
  events: TradePlanEvent[];
  eventBlackoutBeforeMinutes: number;
  eventBlackoutAfterMinutes: number;
  minimumEventImportance: "medium" | "high";
};

export type TradePlanIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  suggestedFix?: string;
  details?: Record<string, unknown>;
};

function issueFromAnalysisError(error: unknown): TradePlanIssue {
  const message = error instanceof Error ? error.message : String(error);
  const mappings: Array<[RegExp, string, string]> = [
    [/analyzed_at cannot/, "analysis_time_in_future", "Use an analysis timestamp observed at or before validation time."],
    [/analyzed_at must/, "analysis_time_invalid", "Supply a canonical ISO-8601 analysis timestamp."],
    [/entry_low must/, "entry_zone_invalid", "Set entry_low less than or equal to entry_high."],
    [/stop and invalidation|stop must be/, "stop_or_invalidation_direction_invalid", "Move Stop and Invalidation to the valid side of the entry zone and keep Stop beyond Invalidation."],
    [/targets must be strictly/, "targets_not_monotonic", "Order targets from nearest to farthest in the trade direction."],
    [/targets must be/, "targets_direction_invalid", "Move all targets beyond the entry zone in the trade direction."],
    [/confirmation must be/, "confirmation_direction_invalid", "Move Confirmation beyond the entry zone in the trade direction."],
    [/expires_at must be later/, "expiry_invalid", "Set expires_at later than analyzed_at."],
    [/expires_at must/, "expiry_invalid", "Supply a canonical ISO-8601 expiry timestamp."],
    [/price levels/, "price_level_invalid", "Supply finite positive price levels."],
  ];
  const match = mappings.find(([pattern]) => pattern.test(message));
  return {
    code: match?.[1] ?? "analysis_contract_invalid",
    severity: "error",
    message,
    suggestedFix: match?.[2] ?? "Correct the analysis definition and validate it again.",
  };
}

function addCurrentPriceIssues(input: TradePlanValidationInput, issues: TradePlanIssue[]) {
  if (input.bias === "neutral") {
    issues.push({
      code: "neutral_plan_has_no_trade_direction",
      severity: "error",
      message: "A neutral analysis does not define a directional trade plan.",
      suggestedFix: "Keep the analysis neutral without applying a trade plan, or provide a directional scenario.",
    });
    return;
  }

  const bullish = input.bias === "bullish";
  const stopCrossed = bullish ? input.currentPrice <= input.stop : input.currentPrice >= input.stop;
  const invalidated = bullish
    ? input.currentPrice <= input.invalidation
    : input.currentPrice >= input.invalidation;
  const confirmationPassed = input.confirmation !== undefined && (bullish
    ? input.currentPrice >= input.confirmation
    : input.currentPrice <= input.confirmation);
  const entryPassed = bullish
    ? input.currentPrice > input.entryHigh
    : input.currentPrice < input.entryLow;

  if (stopCrossed) {
    issues.push({
      code: "stop_already_at_or_beyond",
      severity: "error",
      message: "The observed market price is already at or beyond the proposed Stop.",
      suggestedFix: "Create a new analysis from fresh market evidence instead of moving the old Stop.",
    });
  } else if (invalidated) {
    issues.push({
      code: "invalidation_already_at_or_beyond",
      severity: "error",
      message: "The observed market price is already at or beyond the proposed Invalidation level.",
      suggestedFix: "Create a new analysis from fresh market evidence.",
    });
  }
  if (confirmationPassed) {
    issues.push({
      code: "confirmation_already_at_or_beyond",
      severity: "error",
      message: "The observed market price is already at or beyond the proposed Confirmation level.",
      suggestedFix: "Re-observe the market and define a new plan; this validator does not infer whether the level was crossed historically.",
    });
  } else if (entryPassed) {
    issues.push({
      code: "entry_zone_currently_passed",
      severity: "warning",
      message: "The observed market price is beyond the proposed Entry zone but has not reached Confirmation.",
      suggestedFix: "Confirm that a pending-entry workflow is still intended before applying the plan.",
    });
  }
}

function addEvidenceIssues(input: TradePlanValidationInput, now: Date, issues: TradePlanIssue[]) {
  const observedAt = new Date(input.marketObservedAt);
  const ageSeconds = (now.getTime() - observedAt.getTime()) / 1_000;
  if (ageSeconds < -5) {
    issues.push({
      code: "market_observation_in_future",
      severity: "error",
      message: "The market observation timestamp is more than five seconds in the future.",
      suggestedFix: "Correct clock skew or acquire a new market observation.",
      details: { ageSeconds },
    });
  } else if (ageSeconds > input.maxMarketAgeSeconds) {
    issues.push({
      code: "market_data_stale",
      severity: "error",
      message: "The supplied market observation is older than the permitted evidence age.",
      suggestedFix: "Acquire a fresh market snapshot and validate the plan again.",
      details: { ageSeconds, maxMarketAgeSeconds: input.maxMarketAgeSeconds },
    });
  }

  const importanceRank = { low: 0, medium: 1, high: 2 } as const;
  const threshold = importanceRank[input.minimumEventImportance];
  for (const event of input.events) {
    if (importanceRank[event.importance] < threshold) continue;
    const minutesUntilEvent = (new Date(event.eventAt).getTime() - now.getTime()) / 60_000;
    if (
      minutesUntilEvent >= -input.eventBlackoutAfterMinutes
      && minutesUntilEvent <= input.eventBlackoutBeforeMinutes
    ) {
      issues.push({
        code: "event_blackout_active",
        severity: "error",
        message: `The trade plan is inside the blackout window for ${event.name}.`,
        suggestedFix: "Wait until the configured post-event blackout has elapsed, then refresh all market evidence.",
        details: {
          event: event.name,
          eventAt: event.eventAt,
          importance: event.importance,
          country: event.country,
          minutesUntilEvent,
        },
      });
    }
  }
  return { observedAt: observedAt.toISOString(), ageSeconds };
}

export function validateTradePlan(input: TradePlanValidationInput, now = new Date()) {
  const issues: TradePlanIssue[] = [];
  let analysisContractValid = true;
  try {
    const validation = validateAnalysisPayload(input, now);
    if (validation.stale) {
      issues.push({
        code: "analysis_expired",
        severity: "error",
        message: "The proposed analysis has expired.",
        suggestedFix: "Create a new analysis from fresh evidence instead of extending the expired plan.",
        details: { expiresAt: input.expiresAt },
      });
    }
  } catch (error) {
    analysisContractValid = false;
    issues.push(issueFromAnalysisError(error));
  }

  const evidence = addEvidenceIssues(input, now, issues);
  if (analysisContractValid) addCurrentPriceIssues(input, issues);

  let metrics: Record<string, number | null> | null = null;
  if (analysisContractValid && input.bias !== "neutral") {
    const entryReference = (input.entryLow + input.entryHigh) / 2;
    const grossRisk = Math.abs(entryReference - input.stop);
    const grossRewardToTarget1 = Math.abs(input.targets[0] - entryReference);
    const netRewardToTarget1 = Math.max(
      0,
      grossRewardToTarget1 - input.estimatedRoundTripCostPrice,
    );
    const effectiveRisk = grossRisk + input.estimatedRoundTripCostPrice;
    const grossRiskRewardToTarget1 = grossRisk > 0 ? grossRewardToTarget1 / grossRisk : null;
    const netRiskRewardToTarget1 = effectiveRisk > 0 ? netRewardToTarget1 / effectiveRisk : null;
    metrics = {
      entryReference,
      grossRisk,
      grossRewardToTarget1,
      grossRiskRewardToTarget1,
      estimatedRoundTripCostPrice: input.estimatedRoundTripCostPrice,
      effectiveRisk,
      netRewardToTarget1,
      netRiskRewardToTarget1,
    };
    if (netRiskRewardToTarget1 === null || netRiskRewardToTarget1 < input.minimumRiskReward) {
      issues.push({
        code: "cost_adjusted_rr_below_minimum",
        severity: "error",
        message: "Cost-adjusted Target 1 risk/reward is below the required minimum.",
        suggestedFix: "Reject the plan or redesign its entry, stop, and target from new market evidence.",
        details: {
          minimumRiskReward: input.minimumRiskReward,
          observedRiskReward: netRiskRewardToTarget1,
        },
      });
    }
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    schemaVersion: "1.0",
    status: hasErrors ? "blocked" : issues.length > 0 ? "warning" : "valid",
    evaluatedAt: now.toISOString(),
    symbol: input.symbol.toUpperCase(),
    timeframe: normalizeResolution(input.timeframe),
    analysisId: input.analysisId,
    issues,
    metrics,
    evidence: {
      currentPrice: input.currentPrice,
      marketObservedAt: evidence.observedAt,
      marketAgeSeconds: evidence.ageSeconds,
      maxMarketAgeSeconds: input.maxMarketAgeSeconds,
      eventsEvaluated: input.events.length,
      minimumEventImportance: input.minimumEventImportance,
      eventBlackoutBeforeMinutes: input.eventBlackoutBeforeMinutes,
      eventBlackoutAfterMinutes: input.eventBlackoutAfterMinutes,
      minimumRiskReward: input.minimumRiskReward,
    },
    assumptions: [
      "The supplied round-trip cost is expressed in the instrument's price units.",
      "Current-price checks use only the supplied observation and do not infer historical crossings.",
      "Event blackouts are evaluated against the validator's current time.",
      "This validates a plan definition; it does not prove execution, fills, or profitability.",
    ],
  };
}
