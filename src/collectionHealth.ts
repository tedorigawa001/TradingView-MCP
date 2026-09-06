import { isCanonicalTimestamp } from "./firstSeenStore.js";

export type CollectionHealthIssue = {
  code:
    | "policy_rate_collection_missing"
    | "policy_rate_collection_stale"
    | "first_seen_collection_missing"
    | "first_seen_collection_stale"
    | "first_seen_collection_partial"
    | "research_collection_missing"
    | "research_collection_stale";
  collector: "policy_rate" | "first_seen" | "research";
  age: number | null;
  threshold: number;
  unit: "business_days" | "hours" | "scheduled_runs";
};

export type CollectionHealthScope = "all" | "policy-rate" | "first-seen" | "research";

export type CollectionHealthResult = {
  checked_at: string;
  scope: CollectionHealthScope;
  status: "healthy" | "stale";
  should_notify: boolean;
  thresholds: {
    max_policy_rate_age_business_days: number;
    max_research_age_hours: number;
  };
  policy_rate: { latest_collected_at: string | null; latest_run_age_business_days: number | null } | null;
  research: { latest_collected_at: string | null; latest_run_age_hours: number | null } | null;
  first_seen: { latest_collected_at: string | null; latest_run_status: "complete" | "partial" | null; latest_expected_run_at: string; latest_run_meets_schedule: boolean } | null;
  issues: CollectionHealthIssue[];
};

type CollectionHealthInput = {
  scope?: CollectionHealthScope;
  checkedAt: string;
  maxPolicyRateAgeBusinessDays: number;
  maxResearchAgeHours: number;
  policyRate: NonNullable<CollectionHealthResult["policy_rate"]>;
  research: NonNullable<CollectionHealthResult["research"]>;
  firstSeen: NonNullable<CollectionHealthResult["first_seen"]>;
};

function assertThreshold(value: number, integer: boolean): void {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error("collection health threshold must be a non-negative number");
  }
}

function assertCoverageAge(age: number | null, latest: string | null): void {
  if (age === null) {
    if (latest !== null) throw new Error("collection health age is missing for a recorded heartbeat");
    return;
  }
  if (!Number.isFinite(age) || age < 0) throw new Error("collection health age must be a non-negative number");
  if (latest === null || !isCanonicalTimestamp(latest)) throw new Error("collection health latest heartbeat must be canonical");
}

export function evaluateCollectionHealth(input: CollectionHealthInput): CollectionHealthResult {
  const scope = input.scope ?? "all";
  if (!isCanonicalTimestamp(input.checkedAt)) throw new Error("collection health checked_at must be canonical");
  assertThreshold(input.maxPolicyRateAgeBusinessDays, true);
  assertThreshold(input.maxResearchAgeHours, false);
  const checkPolicyRate = scope === "all" || scope === "policy-rate";
  const checkResearch = scope === "all" || scope === "research";
  const checkFirstSeen = scope === "all" || scope === "first-seen";
  if (checkPolicyRate) assertCoverageAge(input.policyRate.latest_run_age_business_days, input.policyRate.latest_collected_at);
  if (checkResearch) assertCoverageAge(input.research.latest_run_age_hours, input.research.latest_collected_at);
  if (checkFirstSeen) {
    if (!isCanonicalTimestamp(input.firstSeen.latest_expected_run_at)) throw new Error("first-seen expected run must be canonical");
    if (input.firstSeen.latest_collected_at !== null && !isCanonicalTimestamp(input.firstSeen.latest_collected_at)) throw new Error("first-seen latest heartbeat must be canonical");
  }

  const issues: CollectionHealthIssue[] = [];
  const policyAge = input.policyRate.latest_run_age_business_days;
  if (checkPolicyRate && policyAge === null) {
    issues.push({ code: "policy_rate_collection_missing", collector: "policy_rate", age: null, threshold: input.maxPolicyRateAgeBusinessDays, unit: "business_days" });
  } else if (checkPolicyRate && policyAge !== null && policyAge > input.maxPolicyRateAgeBusinessDays) {
    issues.push({ code: "policy_rate_collection_stale", collector: "policy_rate", age: policyAge, threshold: input.maxPolicyRateAgeBusinessDays, unit: "business_days" });
  }

  const researchAge = input.research.latest_run_age_hours;
  if (checkResearch && researchAge === null) {
    issues.push({ code: "research_collection_missing", collector: "research", age: null, threshold: input.maxResearchAgeHours, unit: "hours" });
  } else if (checkResearch && researchAge !== null && researchAge > input.maxResearchAgeHours) {
    issues.push({ code: "research_collection_stale", collector: "research", age: researchAge, threshold: input.maxResearchAgeHours, unit: "hours" });
  }

  if (checkFirstSeen && input.firstSeen.latest_collected_at === null) {
    issues.push({ code: "first_seen_collection_missing", collector: "first_seen", age: null, threshold: 0, unit: "scheduled_runs" });
  } else if (checkFirstSeen && !input.firstSeen.latest_run_meets_schedule) {
    issues.push({ code: "first_seen_collection_stale", collector: "first_seen", age: 1, threshold: 0, unit: "scheduled_runs" });
  }
  if (checkFirstSeen && input.firstSeen.latest_run_status === "partial") {
    issues.push({ code: "first_seen_collection_partial", collector: "first_seen", age: 1, threshold: 0, unit: "scheduled_runs" });
  }

  return {
    checked_at: input.checkedAt,
    scope,
    status: issues.length === 0 ? "healthy" : "stale",
    should_notify: issues.length > 0,
    thresholds: {
      max_policy_rate_age_business_days: input.maxPolicyRateAgeBusinessDays,
      max_research_age_hours: input.maxResearchAgeHours,
    },
    policy_rate: checkPolicyRate ? input.policyRate : null,
    research: checkResearch ? input.research : null,
    first_seen: checkFirstSeen ? input.firstSeen : null,
    issues,
  };
}

export function collectionHealthNotification(result: CollectionHealthResult): string {
  if (!result.should_notify) return "";
  const names = result.issues.map((issue) => issue.collector === "policy_rate" ? "policy-rate" : issue.collector === "first_seen" ? "first-seen" : "research");
  return `Collection heartbeat unhealthy: ${[...new Set(names)].join(", ")}. Inspect collector and scheduler logs; CDP-dependent collectors also require TradingView debugging.`;
}
