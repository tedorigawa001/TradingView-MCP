import { z } from "zod";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable().default(null);
export const researchEvidenceManifestSchema = z.object({
  data_sha256: digest,
  code_sha256: digest,
  runner_sha256: digest,
  candidate_rule_sha256: digest,
  parameters_sha256: digest,
  environment_sha256: digest,
}).strict();

export const researchEvidenceComparisonSchema = z.object({
  previous: researchEvidenceManifestSchema,
  current: researchEvidenceManifestSchema,
}).strict();

const checks = {
  data_sha256: ["verify_source_coverage_and_point_in_time", "rerun_results"],
  code_sha256: ["run_regression_tests", "reproduce_previous_ledger", "review_statistical_calibration_impact"],
  runner_sha256: ["run_regression_tests", "reproduce_previous_ledger", "review_statistical_calibration_impact"],
  candidate_rule_sha256: ["recalibrate_candidate_gate", "reassess_selection_bias", "use_separate_contract"],
  parameters_sha256: ["rerun_results", "reassess_selection_bias", "review_statistical_calibration_impact"],
  environment_sha256: ["reproduce_previous_ledger", "run_regression_tests"],
} as const;

export function compareResearchEvidence(input: unknown) {
  const { previous, current } = researchEvidenceComparisonSchema.parse(input);
  const fields = (Object.keys(checks) as (keyof typeof checks)[]).map((field) => {
    const before = previous[field], after = current[field];
    const status = before === null || after === null ? "unknown" : before === after ? "match" : "changed";
    return { field, previous: before, current: after, status,
      required_checks: status === "changed" ? [...checks[field]]
        : status === "unknown" ? ["supply_and_verify_missing_evidence"] : [] };
  });
  const changed = fields.filter((f) => f.status === "changed").map((f) => f.field);
  const unknown = fields.filter((f) => f.status === "unknown").map((f) => f.field);
  return {
    contract: "declared_research_evidence_comparison_v1",
    evidence_source: "caller_supplied_not_independently_verified",
    status: unknown.length ? "incomplete" : changed.length ? "changed" : "matching_declarations",
    changed_fields: changed, unknown_fields: unknown, fields,
    revalidation: changed.length ? "required" : unknown.length ? "undetermined" : "no_change_identified",
    required_checks: [...new Set(fields.flatMap((f) => f.required_checks))],
    compatibility_proven: false,
    statistical_calibration: "not_assessed",
    candidateEligible: false,
    limitations: ["hash_equality_is_not_source_authentication_or_reproducibility",
      "missing_on_both_sides_is_unknown_not_equal", "scope_of_each_digest_is_caller_defined",
      "matching_declarations_do_not_prove_unused_oos_or_statistical_validity",
      "no_files_read_no_code_executed_no_results_recomputed"],
  };
}
