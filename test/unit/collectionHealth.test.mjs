import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateCollectionHealth } from "../../build/collectionHealth.js";
import { parseCollectionHealthCliArguments, runCollectionHealthCli } from "../../build/collectionHealthCli.js";

const freshFirstSeen = {
  latest_collected_at: "2026-09-04T13:30:00.000Z",
  latest_run_status: "complete",
  latest_expected_run_at: "2026-09-04T13:30:00.000Z",
  latest_run_meets_schedule: true,
};

test("collection health stays quiet while both CDP-dependent heartbeats are fresh", () => {
  const result = evaluateCollectionHealth({
    checkedAt: "2026-09-07T02:15:00.000Z",
    maxPolicyRateAgeBusinessDays: 0,
    maxResearchAgeHours: 2,
    policyRate: { latest_collected_at: "2026-09-07T01:45:00.000Z", latest_run_age_business_days: 0 },
    research: { latest_collected_at: "2026-09-07T01:00:00.000Z", latest_run_age_hours: 1.25 },
    firstSeen: freshFirstSeen,
  });

  assert.equal(result.status, "healthy");
  assert.deepEqual(result.issues, []);
  assert.equal(result.should_notify, false);
});

test("collection health reports each stale CDP-dependent collector", () => {
  const result = evaluateCollectionHealth({
    checkedAt: "2026-09-07T02:15:00.000Z",
    maxPolicyRateAgeBusinessDays: 0,
    maxResearchAgeHours: 2,
    policyRate: { latest_collected_at: "2026-09-04T01:45:00.000Z", latest_run_age_business_days: 1 },
    research: { latest_collected_at: "2026-09-06T23:00:00.000Z", latest_run_age_hours: 3.25 },
    firstSeen: freshFirstSeen,
  });

  assert.equal(result.status, "stale");
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "policy_rate_collection_stale",
    "research_collection_stale",
  ]);
  assert.equal(result.should_notify, true);
});

test("collection health fails closed when a heartbeat has never been recorded", () => {
  const result = evaluateCollectionHealth({
    checkedAt: "2026-09-07T02:15:00.000Z",
    maxPolicyRateAgeBusinessDays: 0,
    maxResearchAgeHours: 2,
    policyRate: { latest_collected_at: null, latest_run_age_business_days: null },
    research: { latest_collected_at: null, latest_run_age_hours: null },
    firstSeen: { ...freshFirstSeen, latest_collected_at: null, latest_run_status: null, latest_run_meets_schedule: false },
  });

  assert.equal(result.status, "stale");
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "policy_rate_collection_missing",
    "research_collection_missing",
    "first_seen_collection_missing",
  ]);
  assert.equal(result.should_notify, true);
});

test("collection health rejects nonsensical thresholds and ages", () => {
  const valid = {
    checkedAt: "2026-09-07T02:15:00.000Z",
    maxPolicyRateAgeBusinessDays: 0,
    maxResearchAgeHours: 2,
    policyRate: { latest_collected_at: "2026-09-07T01:45:00.000Z", latest_run_age_business_days: 0 },
    research: { latest_collected_at: "2026-09-07T01:00:00.000Z", latest_run_age_hours: 1.25 },
    firstSeen: freshFirstSeen,
  };
  assert.throws(() => evaluateCollectionHealth({ ...valid, maxResearchAgeHours: -1 }), /threshold/);
  assert.throws(() => evaluateCollectionHealth({ ...valid, research: { ...valid.research, latest_run_age_hours: -1 } }), /age/);
});

test("collection health CLI keeps strict defaults and accepts explicit thresholds", () => {
  assert.deepEqual(parseCollectionHealthCliArguments([]), {
    scope: "all",
    maxPolicyRateAgeBusinessDays: 0,
    maxResearchAgeHours: 2,
    notify: false,
  });
  assert.deepEqual(parseCollectionHealthCliArguments([
    "--scope", "research",
    "--max-policy-rate-age-business-days", "1",
    "--max-research-age-hours", "3.5",
    "--notify",
  ]), {
    scope: "research",
    maxPolicyRateAgeBusinessDays: 1,
    maxResearchAgeHours: 3.5,
    notify: true,
  });
  assert.throws(() => parseCollectionHealthCliArguments(["--max-policy-rate-age-business-days", "0.5"]), /integer/);
  assert.throws(() => parseCollectionHealthCliArguments(["--scope", "unknown"]), /scope/);
  assert.throws(() => parseCollectionHealthCliArguments(["--unknown"]), /unknown argument/);
});

test("collection health scopes ignore an unselected collector", () => {
  const base = {
    checkedAt: "2026-09-07T02:15:00.000Z",
    maxPolicyRateAgeBusinessDays: 0,
    maxResearchAgeHours: 2,
    policyRate: { latest_collected_at: null, latest_run_age_business_days: null },
    research: { latest_collected_at: null, latest_run_age_hours: null },
    firstSeen: freshFirstSeen,
  };
  const research = evaluateCollectionHealth({
    ...base,
    scope: "research",
    research: { latest_collected_at: "2026-09-07T01:00:00.000Z", latest_run_age_hours: 1.25 },
  });
  assert.equal(research.status, "healthy");
  assert.equal(research.policy_rate, null);

  const policyRate = evaluateCollectionHealth({
    ...base,
    scope: "policy-rate",
    policyRate: { latest_collected_at: "2026-09-07T01:45:00.000Z", latest_run_age_business_days: 0 },
  });
  assert.equal(policyRate.status, "healthy");
  assert.equal(policyRate.research, null);
});

test("collection health rejects a missed or partial first-seen scheduled run", () => {
  const base = {
    scope: "first-seen",
    checkedAt: "2026-09-04T14:15:00.000Z",
    maxPolicyRateAgeBusinessDays: 0,
    maxResearchAgeHours: 2,
    policyRate: { latest_collected_at: null, latest_run_age_business_days: null },
    research: { latest_collected_at: null, latest_run_age_hours: null },
  };
  const stale = evaluateCollectionHealth({ ...base, firstSeen: { ...freshFirstSeen, latest_run_meets_schedule: false } });
  assert.deepEqual(stale.issues.map((issue) => issue.code), ["first_seen_collection_stale"]);
  const partial = evaluateCollectionHealth({ ...base, firstSeen: { ...freshFirstSeen, latest_run_status: "partial" } });
  assert.deepEqual(partial.issues.map((issue) => issue.code), ["first_seen_collection_partial"]);
});

test("launchd health monitors are repository-location independent and cover weekends", async () => {
  const research = await readFile(new URL("../../docs/launchd/com.tradingview-mcp.collection-health-research.plist.example", import.meta.url), "utf8");
  const policyRate = await readFile(new URL("../../docs/launchd/com.tradingview-mcp.collection-health-policy-rate.plist.example", import.meta.url), "utf8");
  const firstSeen = await readFile(new URL("../../docs/launchd/com.tradingview-mcp.collection-health-first-seen.plist.example", import.meta.url), "utf8");
  const firstSeenCollector = await readFile(new URL("../../docs/launchd/com.tradingview-mcp.first-seen-collection.plist.example", import.meta.url), "utf8");

  assert.doesNotMatch(research, /WorkingDirectory/);
  assert.match(research, /<string>--scope<\/string>\s*<string>research<\/string>/);
  assert.match(research, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
  assert.doesNotMatch(research, /GitHub\/TradingView-MCP/);

  assert.doesNotMatch(policyRate, /WorkingDirectory/);
  assert.match(policyRate, /<string>--scope<\/string>\s*<string>policy-rate<\/string>/);
  assert.equal((policyRate.match(/<key>Weekday<\/key>/g) ?? []).length, 5);
  assert.doesNotMatch(policyRate, /GitHub\/TradingView-MCP/);

  assert.doesNotMatch(firstSeen, /WorkingDirectory/);
  assert.match(firstSeen, /<string>--scope<\/string>\s*<string>first-seen<\/string>/);
  assert.equal((firstSeen.match(/<key>Weekday<\/key>/g) ?? []).length, 10);
  assert.doesNotMatch(firstSeen, /GitHub\/TradingView-MCP/);

  assert.doesNotMatch(firstSeenCollector, /WorkingDirectory/);
  assert.match(firstSeenCollector, /node_modules\/bushido-tradingview-mcp\/build\/collectionCli\.js/);
});

test("collection health CLI delivers stale and failure notifications but stays quiet when healthy", async () => {
  const notifications = [];
  const output = [];
  const errors = [];
  const healthy = {
    checked_at: "2026-09-07T02:15:00.000Z", scope: "research", status: "healthy", should_notify: false,
    thresholds: { max_policy_rate_age_business_days: 0, max_research_age_hours: 2 },
    policy_rate: null,
    research: { latest_collected_at: "2026-09-07T01:00:00.000Z", latest_run_age_hours: 1.25 },
    first_seen: null,
    issues: [],
  };
  const dependencies = {
    notificationsSupported: true,
    notify: async (message) => notifications.push(message),
    writeOutput: (message) => output.push(message),
    writeError: (message) => errors.push(message),
  };

  assert.equal(await runCollectionHealthCli(["--scope", "research", "--notify"], {
    ...dependencies, checkHealth: async () => healthy,
  }), 0);
  assert.deepEqual(notifications, []);

  assert.equal(await runCollectionHealthCli(["--scope", "research", "--notify"], {
    ...dependencies,
    checkHealth: async () => ({
      ...healthy, status: "stale", should_notify: true,
      issues: [{ code: "research_collection_stale", collector: "research", age: 3, threshold: 2, unit: "hours" }],
    }),
  }), 1);
  assert.match(notifications[0], /research/);

  assert.equal(await runCollectionHealthCli(["--scope", "research", "--notify"], {
    ...dependencies, checkHealth: async () => { throw new Error("synthetic health failure"); },
  }), 1);
  assert.match(notifications[1], /check failed/i);
  assert.match(errors[0], /synthetic health failure/);
});
