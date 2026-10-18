import { isCanonicalTimestamp } from "./firstSeenStore.js";

export type CollectionHealthIssue = {
  code:
    | "policy_rate_collection_missing"
    | "policy_rate_collection_stale"
    | "first_seen_collection_missing"
    | "first_seen_collection_stale"
    | "first_seen_collection_partial"
    | "research_collection_missing"
    | "research_collection_stale"
    | "fx_history_collection_missing"
    | "fx_history_collection_stale"
    | "policy_rate_clock_ahead"
    | "first_seen_clock_ahead"
    | "research_clock_ahead"
    | "fx_history_clock_ahead";
  collector: "policy_rate" | "first_seen" | "research" | "fx_history";
  /** The instrument, for the FX history collector only. */
  instrument?: string;
  /** For fx_history_clock_ahead, the trigger of the run stamped ahead: a manual run blocks the daily runs too (BACKLOG 103-11). */
  trigger?: "daily" | "manual";
  /**
   * For a `_clock_ahead` issue, the latest heartbeat's age in hours at checked_at: negative, since it is stamped later,
   * rounded away from zero to the next 0.01 hour.
   */
  age: number | null;
  threshold: number;
  unit: "business_days" | "hours" | "scheduled_runs";
};

/** "all" covers the three collectors every setup runs; the daily FX history collection is checked only by its own scope. */
export type CollectionHealthScope = "all" | "policy-rate" | "first-seen" | "research" | "fx-history";
/**
 * latest_run_at is the latest daily run; latest_recorded_run_at and latest_recorded_trigger the latest run of either
 * trigger, which the run log orders every run after; latest_in_future: that run is stamped after the check read the run
 * log (see stampedAhead). Without latest_recorded_run_at, latest_run_at is taken for it.
 */
export type FxHistoryHealth = {
  instrument: string; latest_run_at: string | null; window_opens_at: string; window_closes_at: string; latest_window_met: boolean; latest_in_future: boolean;
  latest_recorded_run_at?: string | null; latest_recorded_trigger?: "daily" | "manual" | null;
};

export type CollectionHealthResult = {
  checked_at: string;
  scope: CollectionHealthScope;
  status: "healthy" | "stale";
  should_notify: boolean;
  thresholds: {
    max_policy_rate_age_business_days: number;
    max_research_age_hours: number;
  };
  /** latest_in_future, in each collector: its latest heartbeat is stamped after the check read it (see stampedAhead). */
  policy_rate: { latest_collected_at: string | null; latest_run_age_business_days: number | null; latest_in_future: boolean } | null;
  research: { latest_collected_at: string | null; latest_run_age_hours: number | null; latest_in_future: boolean } | null;
  first_seen: { latest_collected_at: string | null; latest_run_status: "complete" | "partial" | null; latest_expected_run_at: string; latest_run_meets_schedule: boolean; latest_in_future: boolean } | null;
  fx_history: FxHistoryHealth[] | null;
  issues: CollectionHealthIssue[];
};

/** How far past the read of its log a heartbeat must be stamped to count as ahead of the clock (BACKLOG 102-36 review). */
export const CLOCK_AHEAD_TOLERANCE_MS = 60_000;

/**
 * Whether a heartbeat stamped `stamp` was stamped ahead of the clock that read it (BACKLOG 102-36 review): later than
 * `asOf`, and more than CLOCK_AHEAD_TOLERANCE_MS (a minute) later than `readAt`, the moment its log was read. A record
 * that was read had already been written, so its stamp can be later than the read only when the clock that stamped it
 * ran ahead (and has since been set back) or the reader's clock was set back. Each heartbeat log refuses a heartbeat
 * stamped before its latest one, so until the clock reaches that stamp every later run fails to record, while the stamp
 * itself reads as fresh. A heartbeat stamped after `asOf` but before the read was written while the check waited for
 * the log, and is not ahead; nor is one less than a minute ahead, a skew that holds off no scheduled run (the most
 * frequent is hourly).
 */
export function stampedAhead(stamp: string, asOf: Date, readAt: number): boolean {
  const at = Date.parse(stamp);
  return at > asOf.getTime() && at - readAt > CLOCK_AHEAD_TOLERANCE_MS;
}

type CollectionHealthInput = {
  scope?: CollectionHealthScope;
  checkedAt: string;
  maxPolicyRateAgeBusinessDays: number;
  maxResearchAgeHours: number;
  policyRate: NonNullable<CollectionHealthResult["policy_rate"]>;
  research: NonNullable<CollectionHealthResult["research"]>;
  firstSeen: NonNullable<CollectionHealthResult["first_seen"]>;
  fxHistory?: FxHistoryHealth[];
};

function assertThreshold(value: number, integer: boolean): void {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error("collection health threshold must be a non-negative number");
  }
}

/** Whether a canonical latest heartbeat is stamped after checked_at; its age at checked_at is then below zero. */
const after = (latest: string | null, checkedAt: string) => latest !== null && isCanonicalTimestamp(latest) && latest > checkedAt;

function assertCoverageAge(age: number | null, latest: string | null, checkedAt: string): void {
  if (age === null) {
    if (latest !== null) throw new Error("collection health age is missing for a recorded heartbeat");
    return;
  }
  // A heartbeat stamped after checked_at has a negative age: one written while the check waited for its log, or one
  // stamped ahead, which is reported as clock_ahead (BACKLOG 102-36 review). Any other negative age is refused.
  if (!Number.isFinite(age) || (age < 0 && !after(latest, checkedAt))) throw new Error("collection health age must be a non-negative number");
  if (latest === null || !isCanonicalTimestamp(latest)) throw new Error("collection health latest heartbeat must be canonical");
}

/** latest_in_future, when set, must name a latest heartbeat stamped after checked_at. */
function assertInFuture(value: unknown, latest: string | null, checkedAt: string): void {
  if (value !== undefined && typeof value !== "boolean") throw new Error("collection health latest_in_future must be a boolean");
  if (value === true && !after(latest, checkedAt)) throw new Error("collection health latest_in_future needs a latest heartbeat stamped after checked_at");
}

/**
 * The latest heartbeat's age in hours at checked_at, for a clock_ahead issue: negative, how far ahead it is rounded up
 * to the next 0.01 hour (36 seconds), so never shown as 0.
 */
const hoursBefore = (checkedAt: string, latest: string) => -Math.max(1, Math.ceil((Date.parse(latest) - Date.parse(checkedAt)) / 36_000)) / 100;

/** The FX history run the log orders the others after: the latest of either trigger, or the latest daily run when not given. */
const latestRecorded = (row: FxHistoryHealth) => (row.latest_recorded_run_at === undefined ? row.latest_run_at : row.latest_recorded_run_at);

export function evaluateCollectionHealth(input: CollectionHealthInput): CollectionHealthResult {
  const scope = input.scope ?? "all";
  if (!isCanonicalTimestamp(input.checkedAt)) throw new Error("collection health checked_at must be canonical");
  assertThreshold(input.maxPolicyRateAgeBusinessDays, true);
  assertThreshold(input.maxResearchAgeHours, false);
  const checkPolicyRate = scope === "all" || scope === "policy-rate";
  const checkResearch = scope === "all" || scope === "research";
  const checkFirstSeen = scope === "all" || scope === "first-seen";
  const checkFxHistory = scope === "fx-history";
  if (checkFxHistory) {
    if (!input.fxHistory?.length) throw new Error("the fx-history scope needs at least one instrument");
    for (const row of input.fxHistory) {
      if (!isCanonicalTimestamp(row.window_opens_at) || !isCanonicalTimestamp(row.window_closes_at)) throw new Error("FX history window must be canonical");
      if (row.latest_run_at !== null && !isCanonicalTimestamp(row.latest_run_at)) throw new Error("FX history latest run must be canonical");
      if (row.latest_recorded_run_at !== undefined && row.latest_recorded_run_at !== null && !isCanonicalTimestamp(row.latest_recorded_run_at)) throw new Error("FX history latest recorded run must be canonical");
      if (row.latest_recorded_trigger !== undefined && row.latest_recorded_trigger !== null && row.latest_recorded_trigger !== "daily" && row.latest_recorded_trigger !== "manual") throw new Error("FX history latest recorded trigger must be daily or manual");
      assertInFuture(row.latest_in_future, latestRecorded(row), input.checkedAt);
    }
  }
  if (checkPolicyRate) {
    assertCoverageAge(input.policyRate.latest_run_age_business_days, input.policyRate.latest_collected_at, input.checkedAt);
    assertInFuture(input.policyRate.latest_in_future, input.policyRate.latest_collected_at, input.checkedAt);
  }
  if (checkResearch) {
    assertCoverageAge(input.research.latest_run_age_hours, input.research.latest_collected_at, input.checkedAt);
    assertInFuture(input.research.latest_in_future, input.research.latest_collected_at, input.checkedAt);
  }
  if (checkFirstSeen) {
    if (!isCanonicalTimestamp(input.firstSeen.latest_expected_run_at)) throw new Error("first-seen expected run must be canonical");
    if (input.firstSeen.latest_collected_at !== null && !isCanonicalTimestamp(input.firstSeen.latest_collected_at)) throw new Error("first-seen latest heartbeat must be canonical");
    assertInFuture(input.firstSeen.latest_in_future, input.firstSeen.latest_collected_at, input.checkedAt);
  }

  // A latest heartbeat stamped ahead of the clock reads as fresh, while its log refuses every later heartbeat until the
  // clock reaches it (BACKLOG 102-36 review): it is reported as <collector>_clock_ahead, in place of the age checks it passes.
  const issues: CollectionHealthIssue[] = [];
  const ahead = (collector: CollectionHealthIssue["collector"], latest: string | null, instrument?: string): CollectionHealthIssue =>
    ({ code: `${collector}_clock_ahead`, collector, ...(instrument === undefined ? {} : { instrument }), age: hoursBefore(input.checkedAt, latest!), threshold: 0, unit: "hours" });
  const policyAge = input.policyRate.latest_run_age_business_days;
  if (checkPolicyRate && policyAge === null) {
    issues.push({ code: "policy_rate_collection_missing", collector: "policy_rate", age: null, threshold: input.maxPolicyRateAgeBusinessDays, unit: "business_days" });
  } else if (checkPolicyRate && input.policyRate.latest_in_future === true) {
    issues.push(ahead("policy_rate", input.policyRate.latest_collected_at));
  } else if (checkPolicyRate && policyAge !== null && policyAge > input.maxPolicyRateAgeBusinessDays) {
    issues.push({ code: "policy_rate_collection_stale", collector: "policy_rate", age: policyAge, threshold: input.maxPolicyRateAgeBusinessDays, unit: "business_days" });
  }

  const researchAge = input.research.latest_run_age_hours;
  if (checkResearch && researchAge === null) {
    issues.push({ code: "research_collection_missing", collector: "research", age: null, threshold: input.maxResearchAgeHours, unit: "hours" });
  } else if (checkResearch && input.research.latest_in_future === true) {
    issues.push(ahead("research", input.research.latest_collected_at));
  } else if (checkResearch && researchAge !== null && researchAge > input.maxResearchAgeHours) {
    issues.push({ code: "research_collection_stale", collector: "research", age: researchAge, threshold: input.maxResearchAgeHours, unit: "hours" });
  }

  if (checkFirstSeen && input.firstSeen.latest_collected_at === null) {
    issues.push({ code: "first_seen_collection_missing", collector: "first_seen", age: null, threshold: 0, unit: "scheduled_runs" });
  } else if (checkFirstSeen && input.firstSeen.latest_in_future === true) {
    issues.push(ahead("first_seen", input.firstSeen.latest_collected_at));
  } else if (checkFirstSeen && !input.firstSeen.latest_run_meets_schedule) {
    issues.push({ code: "first_seen_collection_stale", collector: "first_seen", age: 1, threshold: 0, unit: "scheduled_runs" });
  }
  if (checkFirstSeen && input.firstSeen.latest_run_status === "partial") {
    issues.push({ code: "first_seen_collection_partial", collector: "first_seen", age: 1, threshold: 0, unit: "scheduled_runs" });
  }
  // The daily FX history collection needs a run in the latest window, covering the session before it (BACKLOG 103-5). A
  // run of either trigger stamped ahead holds off every later one, so it is reported first, with its trigger: a manual
  // one may stand before any daily run at all (BACKLOG 103-11).
  if (checkFxHistory) for (const row of input.fxHistory!) {
    if (row.latest_in_future === true) {
      issues.push({ ...ahead("fx_history", latestRecorded(row), row.instrument), ...(row.latest_recorded_trigger ? { trigger: row.latest_recorded_trigger } : {}) });
    } else if (row.latest_run_at === null) issues.push({ code: "fx_history_collection_missing", collector: "fx_history", instrument: row.instrument, age: null, threshold: 0, unit: "scheduled_runs" });
    else if (!row.latest_window_met) issues.push({ code: "fx_history_collection_stale", collector: "fx_history", instrument: row.instrument, age: 1, threshold: 0, unit: "scheduled_runs" });
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
    fx_history: checkFxHistory ? input.fxHistory! : null,
    issues,
  };
}

/**
 * The tradingview-mcp-repair-first-seen stores a `_clock_ahead` issue's collector writes with the clock that stamped its
 * heartbeat (BACKLOG 103-11 review): its heartbeat and every data log its run appends to, each with whether --apply needs
 * --force there. The first-seen collection writes COT, real-yield and CME gold open-interest first-seen records; the
 * policy-rate collection writes policy-rate first-seen records; the research collection writes only its heartbeat among
 * the logs that refuse a backward stamp; an FX history run, its run log, manifest and page checkpoints (one store).
 */
export function clockAheadRepairStores(issue: CollectionHealthIssue): { store: string; force: boolean }[] {
  switch (issue.collector) {
    case "first_seen": return [{ store: "first-seen-heartbeat", force: false }, { store: "cot", force: false }, { store: "real-yield", force: true }, { store: "futures-open-interest", force: false }];
    case "policy_rate": return [{ store: "policy-rate-heartbeat", force: false }, { store: "policy-rate", force: false }];
    case "fx_history": return [{ store: `fx-history --instrument ${issue.instrument}`, force: true }];
    default: return [{ store: "research-heartbeat", force: false }];
  }
}

/**
 * The notification for an unhealthy check. A record stamped ahead keeps holding its log off after the clock is set
 * right, until the clock reaches it, so the notification names the repair of every store the collector wrote with that
 * clock: a dry run of each first (one with nothing ahead says so and changes nothing), then --apply, with --force where
 * the store needs it (BACKLOG 103-11).
 */
export function collectionHealthNotification(result: CollectionHealthResult): string {
  if (!result.should_notify) return "";
  const names = result.issues.map((issue) => issue.collector === "policy_rate" ? "policy-rate" : issue.collector === "first_seen" ? "first-seen"
    : issue.collector === "fx_history" ? `fx-history ${issue.instrument}` : "research");
  const stores = new Map<string, boolean>();
  for (const issue of result.issues) if (issue.code.endsWith("_clock_ahead")) for (const { store, force } of clockAheadRepairStores(issue)) stores.set(store, force);
  const listed = [...stores.keys()].map((store) => `--store ${store}`).join(", ");
  const forced = [...stores].filter(([, force]) => force).map(([store]) => `--store ${store}`);
  const force = forced.length === 0 ? "" : ` (with --apply --force for ${forced.join(", ")}, whose sequences files elsewhere may cite)`;
  // An FX history run log holds collection runs, not heartbeats (BACKLOG 103-11 review).
  const ahead = result.issues.filter((issue) => issue.code.endsWith("_clock_ahead"));
  const stamped = ahead.every((issue) => issue.collector === "fx_history") ? "A collection run is" : ahead.some((issue) => issue.collector === "fx_history") ? "A heartbeat or collection run is" : "A heartbeat is";
  const clock = stores.size === 0 ? "" : ` ${stamped} stamped after the check: check the system clock. Setting it right does not clear the block;`
    + ` once it is right, run tradingview-mcp-repair-first-seen with each of ${listed} (a dry run; a store with nothing ahead says so), then again with --apply${force}.`;
  return `Collection heartbeat unhealthy: ${[...new Set(names)].join(", ")}. Inspect collector and scheduler logs; CDP-dependent collectors also require TradingView debugging.${clock}`;
}
