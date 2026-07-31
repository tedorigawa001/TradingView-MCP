import { computeLeadLagRelationships, type LeadLagFold } from "./leadLagRelationships.js";
import { runPairedFalsificationAudit, type FalsificationAuditResult } from "./falsificationAudit.js";
import { canonicalDefinitionHash, canonicalJson, type CanonicalJson } from "./canonicalDefinition.js";

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
}

export type LeadLagFalsificationAuditResult = FalsificationAuditResult & {
  /**
   * The complete resolved configuration and its hash. FalsificationAuditResult already pins the
   * generation side, but the study contract - above all the fold boundaries - lived only in the
   * caller. Fold choice alone moved an otherwise identical run between 0.75 and 2.00 percent, so a
   * rate quoted without it cannot be reproduced or checked.
   */
  auditDefinition: {
    runner: "lead_lag_falsification_audit_v1";
    input: CanonicalJson;
    inputHash: string;
  };
};

/**
 * Audits the complete lead/lag candidate rule on factor-null pairs. The generator keeps
 * contemporaneous dependence while containing no lagged predictability; the study then applies
 * its fixed circular-shift calibration independently inside every replication.
 */
export function runLeadLagFalsificationAudit(input: LeadLagFalsificationAuditInput): LeadLagFalsificationAuditResult {
  const study = {
    maxLagBars: input.maxLagBars,
    minimumObservations: input.minimumObservations,
    confidenceLevel: input.confidenceLevel,
    configurationTrials: input.configurationTrials,
    folds: input.folds.map((fold) => ({ foldId: fold.foldId, from: fold.from, to: fold.to })),
    empiricalNullCalibration: true as const,
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
    isCandidate: (result) => result.byLag.some((lag) => lag.inference.candidateEligible),
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
    },
    study,
    decision: { nominalAlpha: audit.nominalAlpha },
  });
  return {
    ...audit,
    auditDefinition: {
      runner: "lead_lag_falsification_audit_v1",
      input: definition,
      inputHash: canonicalDefinitionHash(definition),
    },
  };
}
