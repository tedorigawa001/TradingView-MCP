import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { backtestLedgerSchema, readBacktestLedgerFile, summarizeBacktestLedger } from "./backtestLedger.js";
import { generateResearchEvidence } from "./researchEvidenceGeneration.js";

const digest = (body: string | Buffer) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
const path = z.string().min(1).max(4096).refine(isAbsolute);
export const researchReproductionSchema = z.object({
  task: z.literal("backtest_ledger_summary_v1"),
  ledger_file: path,
  parameters_file: path,
  expected_result_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  dependency_lockfile: path.optional(),
}).strict();

/** Recompute a stored ledger summary, not the strategy that produced its trades. */
export async function reproduceResearch(input: unknown) {
  const config = researchReproductionSchema.parse(input);
  const evidenceInput = {
    data: [{ id: "ledger", path: config.ledger_file }],
    parameters: [{ id: "summary_request", path: config.parameters_file }],
    code: [{ id: "ledger_summary", path: fileURLToPath(new URL("./backtestLedger.js", import.meta.url)) }],
    runner: [{ id: "reproduction", path: fileURLToPath(import.meta.url) }],
    dependency_lockfile: config.dependency_lockfile,
  };
  const before = await generateResearchEvidence(evidenceInput);
  const ledgerBytes = await readBacktestLedgerFile(config.ledger_file);
  const parameterBytes = await readBacktestLedgerFile(config.parameters_file);
  for (const [axis, bytes] of [["data", ledgerBytes], ["parameters", parameterBytes]] as const) {
    if (before.files.find(file => file.axis === axis)?.sha256 !== digest(bytes)) {
      throw new Error("reproduction input changed before execution");
    }
  }
  const ledger = backtestLedgerSchema.parse(JSON.parse(ledgerBytes.toString("utf8")));
  // The request retains its expected artifact_id: never silently rebind changed data.
  const result = summarizeBacktestLedger(ledger, JSON.parse(parameterBytes.toString("utf8")));
  const actual = digest(JSON.stringify(result));
  const after = await generateResearchEvidence(evidenceInput);
  if (JSON.stringify(before.manifest) !== JSON.stringify(after.manifest)) {
    throw new Error("reproduction evidence changed during execution");
  }
  return {
    contract: "ledger_summary_reproduction_v1",
    task: config.task,
    status: actual === config.expected_result_sha256 ? "reproduced" : "mismatch",
    expected_result_sha256: config.expected_result_sha256,
    actual_result_sha256: actual,
    result_hash_recipe: "sha256_of_utf8_JSON.stringify_summarizeBacktestLedger_output",
    evidence_before: before, evidence_after: after,
    candidateEligible: false, oos_execution_authorized: false,
    limitations: ["stored_trade_summary_only_not_strategy_backtest",
      "expected_result_is_caller_supplied_not_preregistered",
      "no_research_usage_journal_written_local_verification_only",
      "entrypoint_files_not_complete_transitive_dependency_or_loaded_module_proof",
      "hash_match_does_not_prove_correctness_or_statistical_validity"],
  };
}
