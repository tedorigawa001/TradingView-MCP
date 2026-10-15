import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { collectionHealthNotification, evaluateCollectionHealth } from "../../build/collectionHealth.js";
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

test("a latest heartbeat stamped after the check is reported as clock_ahead, and the check is stale and notifies (BACKLOG 102-36 review)", () => {
  const checkedAt = "2026-09-07T02:15:00.000Z", twoHoursAhead = "2026-09-07T04:15:00.000Z";
  const base = { checkedAt, maxPolicyRateAgeBusinessDays: 0, maxResearchAgeHours: 2 };
  // Each reads as fresh: an age of 0 business days, a negative age, a run that meets the schedule. Each log refuses every
  // later heartbeat until the clock reaches the stamp, so without the check nothing would be noticed until then.
  const ahead = evaluateCollectionHealth({
    ...base,
    policyRate: { latest_collected_at: twoHoursAhead, latest_run_age_business_days: 0, latest_in_future: true },
    research: { latest_collected_at: twoHoursAhead, latest_run_age_hours: -2, latest_in_future: true },
    firstSeen: { ...freshFirstSeen, latest_collected_at: twoHoursAhead, latest_expected_run_at: "2026-09-07T01:30:00.000Z", latest_in_future: true },
  });
  assert.deepEqual([ahead.status, ahead.should_notify], ["stale", true]);
  assert.deepEqual(ahead.issues, [
    { code: "policy_rate_clock_ahead", collector: "policy_rate", age: -2, threshold: 0, unit: "hours" },
    { code: "research_clock_ahead", collector: "research", age: -2, threshold: 0, unit: "hours" },
    { code: "first_seen_clock_ahead", collector: "first_seen", age: -2, threshold: 0, unit: "hours" },
  ]);
  assert.deepEqual([ahead.policy_rate.latest_in_future, ahead.research.latest_in_future, ahead.first_seen.latest_in_future], [true, true, true]);
  assert.equal(collectionHealthNotification(ahead), "Collection heartbeat unhealthy: policy-rate, research, first-seen. Inspect collector and scheduler logs; "
    + "CDP-dependent collectors also require TradingView debugging. A heartbeat is stamped after the check: check the system clock.");
  // A partial first-seen run is still reported beside it.
  const partial = evaluateCollectionHealth({ ...base, scope: "first-seen", policyRate: { latest_collected_at: null, latest_run_age_business_days: null }, research: { latest_collected_at: null, latest_run_age_hours: null },
    firstSeen: { ...ahead.first_seen, latest_run_status: "partial" } });
  assert.deepEqual(partial.issues.map((issue) => issue.code), ["first_seen_clock_ahead", "first_seen_collection_partial"]);
  // The normal notification is unchanged.
  const stale = evaluateCollectionHealth({ ...base, scope: "research", policyRate: { latest_collected_at: null, latest_run_age_business_days: null },
    research: { latest_collected_at: "2026-09-06T23:00:00.000Z", latest_run_age_hours: 3.25, latest_in_future: false }, firstSeen: freshFirstSeen });
  assert.equal(collectionHealthNotification(stale), "Collection heartbeat unhealthy: research. Inspect collector and scheduler logs; CDP-dependent collectors also require TradingView debugging.");
  // A heartbeat written while the check waited for its log is stamped after checked_at but is not ahead: its negative age,
  // which the check used to refuse, is healthy.
  const waited = evaluateCollectionHealth({ ...base, scope: "research", policyRate: { latest_collected_at: null, latest_run_age_business_days: null },
    research: { latest_collected_at: "2026-09-07T02:15:40.000Z", latest_run_age_hours: -0.01, latest_in_future: false }, firstSeen: freshFirstSeen });
  assert.deepEqual([waited.status, waited.issues], ["healthy", []]);
  // A negative age needs a heartbeat stamped after checked_at, and latest_in_future one stamped after checked_at.
  assert.throws(() => evaluateCollectionHealth({ ...base, scope: "research", policyRate: { latest_collected_at: null, latest_run_age_business_days: null },
    research: { latest_collected_at: "2026-09-07T02:14:00.000Z", latest_run_age_hours: -0.02 }, firstSeen: freshFirstSeen }), /age must be a non-negative number/);
  assert.throws(() => evaluateCollectionHealth({ ...base, policyRate: { latest_collected_at: "2026-09-07T01:45:00.000Z", latest_run_age_business_days: 0, latest_in_future: true },
    research: ahead.research, firstSeen: freshFirstSeen }), /latest_in_future needs a latest heartbeat stamped after checked_at/);
  assert.throws(() => evaluateCollectionHealth({ ...base, scope: "first-seen", policyRate: ahead.policy_rate, research: ahead.research,
    firstSeen: { ...freshFirstSeen, latest_in_future: "yes" } }), /latest_in_future must be a boolean/);
  // The daily FX history collection, by its latest daily run.
  const fx = evaluateCollectionHealth({ ...base, scope: "fx-history", policyRate: ahead.policy_rate, research: ahead.research, firstSeen: freshFirstSeen, fxHistory: [
    { instrument: "EUR_USD", latest_run_at: "2026-09-07T03:15:00.000Z", window_opens_at: "2026-09-03T21:15:00.000Z", window_closes_at: "2026-09-04T12:00:00.000Z", latest_window_met: false, latest_in_future: true },
    { instrument: "USD_JPY", latest_run_at: "2026-09-03T23:30:00.000Z", window_opens_at: "2026-09-03T21:15:00.000Z", window_closes_at: "2026-09-04T12:00:00.000Z", latest_window_met: true, latest_in_future: false },
  ] });
  assert.deepEqual(fx.issues, [{ code: "fx_history_clock_ahead", collector: "fx_history", instrument: "EUR_USD", age: -1, threshold: 0, unit: "hours" }]);
  assert.match(collectionHealthNotification(fx), /^Collection heartbeat unhealthy: fx-history EUR_USD\..*check the system clock\.$/);
  // However little ahead a heartbeat the stores report is, its age is not shown as 0.
  const seconds = evaluateCollectionHealth({ ...base, scope: "research", policyRate: { latest_collected_at: null, latest_run_age_business_days: null },
    research: { latest_collected_at: "2026-09-07T02:15:05.000Z", latest_run_age_hours: 0, latest_in_future: true }, firstSeen: freshFirstSeen });
  assert.deepEqual(seconds.issues.map((issue) => [issue.code, issue.age]), [["research_clock_ahead", -0.01]]);
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

  // BACKLOG 103-5: the daily FX history run, twice on Monday to Friday mornings JST, and its check after each deadline.
  const fxDaily = await readFile(new URL("../../docs/launchd/com.tradingview-mcp.fx-history-daily-collection.plist.example", import.meta.url), "utf8");
  const fxHealth = await readFile(new URL("../../docs/launchd/com.tradingview-mcp.collection-health-fx-history.plist.example", import.meta.url), "utf8");
  assert.doesNotMatch(fxDaily, /WorkingDirectory|OANDA_FX_HISTORY_ACCESS_TOKEN<\/key>/);
  // It runs the Keychain wrapper the guide shows, which runs the daily CLI; the token stays out of the plist.
  assert.match(fxDaily, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/Users\/YOUR_USERNAME\/bin\/tradingview-mcp-fx-daily<\/string>/);
  const guide = await readFile(new URL("../../docs/FX_HISTORY_DAILY.md", import.meta.url), "utf8");
  assert.match(guide, /# ~\/bin\/tradingview-mcp-fx-daily \(chmod 700\)/);
  assert.match(guide, /exec \/ABSOLUTE\/PATH\/TO\/node \/ABSOLUTE\/PATH\/TO\/node_modules\/bushido-tradingview-mcp\/build\/fxHistoryDailyCli\.js "\$@"/);
  assert.match(fxDaily, /<string>--confirm-external-fetch<\/string>/);
  assert.equal((fxDaily.match(/<key>Weekday<\/key>/g) ?? []).length, 10);
  assert.doesNotMatch(fxHealth, /WorkingDirectory/);
  assert.match(fxHealth, /<string>--scope<\/string>\s*<string>fx-history<\/string>/);
  assert.equal((fxHealth.match(/<key>Weekday<\/key>/g) ?? []).length, 5);
  const instruments = (text) => [...text.matchAll(/<string>--instrument<\/string><string>(\w+)<\/string>/g)].map((match) => match[1]);
  assert.deepEqual(instruments(fxHealth), instruments(fxDaily));
});

test("launchd examples hold placeholders, not a real home directory, Node install or checkout", async () => {
  const directory = new URL("../../docs/launchd/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".plist.example"));
  assert.equal(names.length, 11);
  for (const name of names) {
    const text = await readFile(new URL(name, directory), "utf8");
    const paths = [...text.matchAll(/<string>(\/[^<]*)<\/string>/g)].map((match) => match[1]);
    assert.ok(paths.length > 0, name);
    for (const path of paths) assert.match(path, /^\/(ABSOLUTE\/PATH\/TO|Users\/YOUR_USERNAME)\//, `${name}: ${path}`);
  }
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
