import { runFalsificationAudit, type FalsificationAuditResult } from "./falsificationAudit.js";
import {
  computeFeatureOutcomeRelationships,
  type FeatureOutcomeRelationshipsInput,
} from "./featureOutcomeRelationships.js";
import type { SyntheticNullModel } from "./syntheticNullSeries.js";

type FeatureStudyDefinition = Omit<FeatureOutcomeRelationshipsInput, "bars" | "symbol" | "timeframe">;

export interface FeatureOutcomeFalsificationAuditInput {
  audit: {
    model: SyntheticNullModel;
    replications: number;
    firstSeed?: number;
    bars: number;
    timeframeMinutes: number;
    volatility?: number;
    nominalAlpha: number;
  };
  study: FeatureStudyDefinition & { timeframe: string };
}

export interface FeatureOutcomeFalsificationAuditResult {
  schemaVersion: "1.0";
  methodologyVersion: "feature_outcome_falsification_audit_v1";
  candidateRule: {
    horizon: 1;
    evidence: "non_overlapping_newey_west_bonferroni_exploratory_eligibility";
    selection: "any_predeclared_feature_bucket";
  };
  audit: FalsificationAuditResult;
}

type CandidateInference = { exploratoryEligible: boolean; minimumObservationsMet: boolean };

function candidateInferences(result: ReturnType<typeof computeFeatureOutcomeRelationships>): CandidateInference[] {
  return Object.values(result.byFeature).flatMap((buckets) => Object.values(buckets).flatMap((bucket) => {
    const horizon = bucket.horizons["1"];
    const inference = horizon?.nonOverlappingForwardReturn.candidateInference;
    return inference === undefined ? [] : [inference];
  }));
}

export function runFeatureOutcomeFalsificationAudit(
  input: FeatureOutcomeFalsificationAuditInput,
): FeatureOutcomeFalsificationAuditResult {
  if (!input.study.horizons.includes(1)) {
    throw new Error("feature-outcome falsification audit requires horizon 1 for its candidate rule");
  }
  const audit = runFalsificationAudit({
    ...input.audit,
    runStudy: (bars) => computeFeatureOutcomeRelationships({
      ...input.study,
      bars,
      symbol: "SYNTH:FEATURE_OUTCOME",
    }),
    isCandidate: (result) => candidateInferences(result).some((inference) => inference.exploratoryEligible),
    evaluate: (result) => {
      const inferences = candidateInferences(result);
      if (!inferences.some((inference) => inference.minimumObservationsMet)) return "not_evaluable";
      return inferences.some((inference) => inference.exploratoryEligible) ? "candidate" : "non_candidate";
    },
  });
  return {
    schemaVersion: "1.0",
    methodologyVersion: "feature_outcome_falsification_audit_v1",
    candidateRule: {
      horizon: 1,
      evidence: "non_overlapping_newey_west_bonferroni_exploratory_eligibility",
      selection: "any_predeclared_feature_bucket",
    },
    audit,
  };
}
