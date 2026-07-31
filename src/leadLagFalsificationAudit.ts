import { computeLeadLagRelationships, type LeadLagFold } from "./leadLagRelationships.js";
import { runPairedFalsificationAudit, type FalsificationAuditResult } from "./falsificationAudit.js";

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

/**
 * Audits the complete lead/lag candidate rule on factor-null pairs. The generator keeps
 * contemporaneous dependence while containing no lagged predictability; the study then applies
 * its fixed circular-shift calibration independently inside every replication.
 */
export function runLeadLagFalsificationAudit(input: LeadLagFalsificationAuditInput): FalsificationAuditResult {
  return runPairedFalsificationAudit({
    ...input,
    runStudy: (primaryBars, referenceBars) => computeLeadLagRelationships({
      primaryBars,
      referenceBars,
      primarySymbol: "SYNTHETIC:PRIMARY",
      referenceSymbol: "SYNTHETIC:REFERENCE",
      timeframe: String(input.timeframeMinutes),
      maxLagBars: input.maxLagBars,
      minimumObservations: input.minimumObservations,
      confidenceLevel: input.confidenceLevel,
      configurationTrials: input.configurationTrials,
      folds: input.folds,
      empiricalNullCalibration: true,
    }),
    isCandidate: (result) => result.byLag.some((lag) => lag.inference.candidateEligible),
  });
}
