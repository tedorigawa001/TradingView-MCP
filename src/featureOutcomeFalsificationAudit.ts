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
  methodologyVersion: "feature_outcome_falsification_audit_v2";
  candidateRule: {
    horizon: 1;
    evidence: "non_overlapping_newey_west_bonferroni_and_empirical_null_candidate_eligibility";
    empiricalNullMethodology: "feature_outcome_empirical_null_circular_moving_block_v2";
    empiricalNullIterations: 1_000;
    selection: "any_predeclared_feature_bucket";
  };
  audit: FalsificationAuditResult;
}

type CandidateInference = {
  candidateEligible: boolean;
  minimumObservationsMet: boolean;
  empiricalNullCalibration?: { status: "available" | "insufficient_sample" };
};

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
  const candidateAlpha = 1 - (input.study.confidenceLevel ?? 0.95);
  if (Math.abs(input.audit.nominalAlpha - candidateAlpha) > Number.EPSILON * 4) {
    throw new Error(
      `feature-outcome falsification audit nominal alpha must equal 1 - confidence level (${candidateAlpha})`,
    );
  }
  const audit = runFalsificationAudit({
    ...input.audit,
    runStudy: (bars) => computeFeatureOutcomeRelationships({
      ...input.study,
      bars,
      symbol: "SYNTH:FEATURE_OUTCOME",
      empiricalNullCalibration: true,
    }),
    isCandidate: (result) => candidateInferences(result).some((inference) => inference.candidateEligible),
    evaluate: (result) => {
      const inferences = candidateInferences(result);
      const evaluable = inferences.some((inference) =>
        inference.minimumObservationsMet && inference.empiricalNullCalibration?.status === "available");
      if (!evaluable) return "not_evaluable";
      return inferences.some((inference) => inference.candidateEligible) ? "candidate" : "non_candidate";
    },
  });
  return {
    schemaVersion: "1.0",
    methodologyVersion: "feature_outcome_falsification_audit_v2",
    candidateRule: {
      horizon: 1,
      evidence: "non_overlapping_newey_west_bonferroni_and_empirical_null_candidate_eligibility",
      empiricalNullMethodology: "feature_outcome_empirical_null_circular_moving_block_v2",
      empiricalNullIterations: 1_000,
      selection: "any_predeclared_feature_bucket",
    },
    audit,
  };
}
