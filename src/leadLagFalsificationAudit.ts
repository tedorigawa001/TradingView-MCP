import {
  computeLeadLagRelationships,
  type LeadLagFold,
  type LeadLagNullPolicy,
  type LeadLagReturnStandardization,
} from "./leadLagRelationships.js";
import { runPairedFalsificationAudit, type FalsificationAuditResult } from "./falsificationAudit.js";
import { canonicalDefinitionHash, canonicalJson, type CanonicalJson } from "./canonicalDefinition.js";
import type { PairedSyntheticNullModel } from "./syntheticNullSeries.js";

export interface LeadLagFalsificationAuditInput {
  replications: number;
  firstSeed?: number;
  bars: number;
  timeframeMinutes: number;
  nominalAlpha: number;
  maxLagBars: number;
  minimumObservations: number;
  confidenceLevel: 0.9 | 0.95 | 0.99;
  configurationTrials: number;
  folds: LeadLagFold[];
  rho?: number;
  model?: PairedSyntheticNullModel;
  returnStandardization?: LeadLagReturnStandardization;
  nullPolicy?: LeadLagNullPolicy;
}

export type LeadLagFalsificationAuditResult = FalsificationAuditResult & {
  /**
   * The complete resolved configuration and its hash. FalsificationAuditResult already pins the
   * generation side, but the study contract - above all the fold boundaries - lived only in the
   * caller. Fold choice alone moved an otherwise identical run between 0.75 and 2.00 percent, so a
   * rate quoted without it cannot be reproduced or checked.
   */
  auditDefinition: {
    /**
     * The runner version names what was measured, not which code ran, so it has to move with the
     * null as well as with the statistic. v2 and v3 are the circular shift on raw and standardized
     * returns; v4 and v5 are the block sign flip on the same two. A reader quoting a rate sees this
     * before the hash, and two different nulls sharing one name is how a rate gets misattributed.
     * v6 to v9 are v2 to v5 with a different denominator: a draw on which no positive lag could
     * show the statistical gate is left out of the rate rather than counted as a rejection
     * (BACKLOG 102-15). Rates measured under v2 to v5 stay their own evidence.
     */
    runner:
      | "lead_lag_falsification_audit_v6"
      | "lead_lag_falsification_audit_v7"
      | "lead_lag_falsification_audit_v8"
      | "lead_lag_falsification_audit_v9";
    input: CanonicalJson;
    inputHash: string;
  };
};

type LeadLagAuditStudyResult = Pick<ReturnType<typeof computeLeadLagRelationships>, "byLag" | "empiricalNullCalibration">;

/**
 * Judges one replication (BACKLOG 102-15). A positive lag can show the statistical gate only with a correlation, two
 * folds that each have one, and a complete empirical null. A draw where no positive lag has these is too sparse to
 * judge: it is not evaluable, and counting it as a rejection would pull the rate down whenever data is thin.
 */
export function evaluateLeadLagCandidate(result: LeadLagAuditStudyResult): "candidate" | "non_candidate" | "not_evaluable" {
  const judged = result.empiricalNullCalibration?.status === "complete"
    && result.byLag.some((lag) => lag.lagBars > 0 && lag.correlation !== null && lag.foldStability.evaluableFolds >= 2);
  if (!judged) return "not_evaluable";
  return result.byLag.some((lag) => lag.inference.statisticalGateEligible) ? "candidate" : "non_candidate";
}

/**
 * Audits the complete lead/lag candidate rule on paired nulls. Factor variants keep contemporaneous
 * dependence while containing no lagged predictability; independent variants isolate marginal
 * path effects. The study applies its fixed circular-shift calibration inside every replication.
 */
export function runLeadLagFalsificationAudit(input: LeadLagFalsificationAuditInput): LeadLagFalsificationAuditResult {
  const returnStandardization = input.returnStandardization ?? "causal_prior_20_rms";
  const nullPolicy: LeadLagNullPolicy = input.nullPolicy ?? "circular_shift";
  const study = {
    maxLagBars: input.maxLagBars,
    minimumObservations: input.minimumObservations,
    confidenceLevel: input.confidenceLevel,
    configurationTrials: input.configurationTrials,
    folds: input.folds.map((fold) => ({ foldId: fold.foldId, from: fold.from, to: fold.to })),
    empiricalNullCalibration: true as const,
    returnStandardization,
    nullPolicy,
  };
  const audit = runPairedFalsificationAudit({
    ...input,
    runStudy: (primaryBars, referenceBars) => computeLeadLagRelationships({
      primaryBars,
      referenceBars,
      primarySymbol: "SYNTHETIC:PRIMARY",
      referenceSymbol: "SYNTHETIC:REFERENCE",
      timeframe: String(input.timeframeMinutes),
      ...study,
    }),
    // The public candidate flag is fail-closed while this rule remains miscalibrated. The audit must
    // still measure the underlying statistical gate or every future calibration would report zero by
    // construction and could never demonstrate that the blocker is safe to remove.
    isCandidate: (result) => result.byLag.some((lag) => lag.inference.statisticalGateEligible),
    evaluate: evaluateLeadLagCandidate,
    model: input.model,
  });
  // Built from the audit's own resolved generation values, never the caller shorthand, so an
  // omitted seed or rho is still pinned by the recorded hash.
  const definition = canonicalJson({
    generation: {
      model: audit.model,
      replications: audit.replications,
      firstSeed: audit.firstSeed,
      bars: audit.bars,
      timeframeMinutes: audit.timeframeMinutes,
      volatility: audit.volatility,
      rho: audit.rho ?? null,
      pairStructure: audit.pairStructure ?? null,
    },
    study,
    decision: { nominalAlpha: audit.nominalAlpha, notEvaluableDraws: "excluded_from_rate_denominator" },
  });
  return {
    ...audit,
    auditDefinition: {
      runner: nullPolicy === "block_sign_flip"
        ? (returnStandardization === "causal_prior_20_rms"
            ? "lead_lag_falsification_audit_v9" : "lead_lag_falsification_audit_v8")
        : (returnStandardization === "causal_prior_20_rms"
            ? "lead_lag_falsification_audit_v7" : "lead_lag_falsification_audit_v6"),
      input: definition,
      inputHash: canonicalDefinitionHash(definition),
    },
  };
}
