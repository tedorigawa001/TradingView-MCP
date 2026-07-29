import { collectOfficialPolicyRateHistory, OFFICIAL_POLICY_RATE_SOURCES } from "./officialPolicyRateSources.js";
import { collectBoJPolicyDecisionHistory } from "./bojPolicyDecisionCollection.js";
import { OfficialPolicyRateHistoryStore, resolvePolicyRateOfficialHistoryPath } from "./policyRateOfficialHistory.js";

type OfficialPolicyRateCollectionSource = keyof typeof OFFICIAL_POLICY_RATE_SOURCES | "boj_mpm_policy_decisions";

export function parseOfficialPolicyRateCollectionCliArguments(argv: string[]): { sourceId: OfficialPolicyRateCollectionSource; confirmed: boolean } {
  let sourceId: OfficialPolicyRateCollectionSource = "ecb_deposit_facility";
  let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") {
      const value = argv[++index];
      if (value === undefined || (!(value in OFFICIAL_POLICY_RATE_SOURCES) && value !== "boj_mpm_policy_decisions")) throw new Error(`unsupported official policy-rate source ${value ?? ""}`);
      sourceId = value as OfficialPolicyRateCollectionSource;
    } else if (argv[index] === "--confirm-exploratory-import") confirmed = true;
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (!confirmed) throw new Error("official policy-rate import requires --confirm-exploratory-import");
  return { sourceId, confirmed };
}

async function main() {
  const args = parseOfficialPolicyRateCollectionCliArguments(process.argv.slice(2));
  const store = new OfficialPolicyRateHistoryStore(resolvePolicyRateOfficialHistoryPath());
  const result = args.sourceId === "boj_mpm_policy_decisions"
    ? await collectBoJPolicyDecisionHistory({ store })
    : await collectOfficialPolicyRateHistory({ sourceId: args.sourceId, store });
  process.stdout.write(`${JSON.stringify({ ...result, evidence_tier: "exploratory_revised_history", eligibility: "exploratory_only" })}\n`);
}

if (process.argv[1]?.endsWith("officialPolicyRateCollectionCli.js")) {
  main().catch((error) => {
    process.stderr.write(`official policy-rate collection failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
