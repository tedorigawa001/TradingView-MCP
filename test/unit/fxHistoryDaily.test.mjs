import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dailyFxHistoryRange, fxDailyCoverage, FxHistoricalRunLog, fxSession, fxTradingDay, latestFxDailyWindow, resolveFxHistoricalRunLogPathFor } from "../../build/fxHistoryRunLog.js";
import { collectOandaM15History, FxHistoricalCheckpointStore, FxHistoricalManifestStore } from "../../build/oandaHistoricalFx.js";
import { runFxHistoryCollection } from "../../build/fxHistoryCollectionCli.js";
import { parseFxHistoryDailyArguments, runFxHistoryDaily } from "../../build/fxHistoryDailyCli.js";
import { checkCollectionHealth, parseCollectionHealthCliArguments } from "../../build/collectionHealthCli.js";
import { collectionHealthNotification, evaluateCollectionHealth } from "../../build/collectionHealth.js";

const iso = (text) => new Date(text).toISOString();
const candle = (time, close = "1.1002") => ({ complete: true, volume: 17, time, mid: { o: "1.1000", h: "1.1004", l: "1.0998", c: close } });
const response = (candles) => new Response(JSON.stringify({ candles }), { status: 200, headers: { "content-type": "application/json" } });
const credentials = { OANDA_FX_HISTORY_ACCOUNT_ID: "001-001-1234567-001", OANDA_FX_HISTORY_ACCESS_TOKEN: "a-valid-token-with-enough-length" };

/** Points the FX history paths into a temporary directory for one test. */
async function withFxPaths(t) {
  const directory = await mkdtemp(join(tmpdir(), "fx-daily-"));
  const saved = { manifest: process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH, archive: process.env.TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH };
  process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH = join(directory, "fx-history-m15-manifest.jsonl");
  process.env.TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH = join(directory, "raw");
  t.after(() => {
    for (const [key, value] of [["TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH", saved.manifest], ["TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH", saved.archive]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  return directory;
}

test("the daily range covers the sessions of the lookback weekdays whole and ends at the last candle closed a minute ago", () => {
  // Sunday 18:30 New York time in winter: the trading day is Monday, the weekday before it Friday.
  const sunday = dailyFxHistoryRange(new Date("2026-01-11T23:37:00Z"), 1);
  assert.deepEqual(sunday, { from: iso("2026-01-08T22:00:00Z"), to: iso("2026-01-11T23:15:00Z"), sessions_covered: ["2026-01-09"] });
  assert.deepEqual(dailyFxHistoryRange(new Date("2026-01-11T23:37:00Z"), 10).sessions_covered,
    ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]);
  assert.equal(dailyFxHistoryRange(new Date("2026-01-11T23:37:00Z"), 10).from, iso("2025-12-28T22:00:00Z"));
  // Summer, and the Sunday the clocks change: the session start follows New York time.
  assert.equal(dailyFxHistoryRange(new Date("2026-07-12T22:00:00Z"), 1).from, iso("2026-07-09T21:00:00Z"));
  assert.equal(dailyFxHistoryRange(new Date("2026-03-09T00:00:00Z"), 1).from, iso("2026-03-05T22:00:00Z"));
  // Friday's session closes at 17:00 New York time; its last candle counts a minute later, and only then is it covered.
  assert.deepEqual(dailyFxHistoryRange(new Date("2026-01-09T22:00:30Z"), 1), { from: iso("2026-01-07T22:00:00Z"), to: iso("2026-01-09T21:30:00Z"), sessions_covered: ["2026-01-08"] });
  assert.deepEqual(dailyFxHistoryRange(new Date("2026-01-09T22:01:00Z"), 1), { from: iso("2026-01-08T22:00:00Z"), to: iso("2026-01-09T21:45:00Z"), sessions_covered: ["2026-01-09"] });
  // A run at a 15-minute boundary does not count on the candle that closed that instant.
  assert.equal(dailyFxHistoryRange(new Date("2026-01-11T23:30:00.300Z"), 1).to, iso("2026-01-11T23:00:00Z"));
  for (const bad of [0, 21, 1.5, Number.NaN]) assert.throws(() => dailyFxHistoryRange(new Date("2026-01-11T23:37:00Z"), bad), /from 1 to 20/);
  // Every page of the range is final a minute before the run, and every session it lists is covered whole.
  for (let t = Date.parse("2026-03-01T00:00:00Z"); t < Date.parse("2026-03-20T00:00:00Z"); t += 7 * 60_000 + 13_000) {
    const range = dailyFxHistoryRange(new Date(t), 3);
    assert.ok(Date.parse(range.to) + 15 * 60_000 + 60_000 <= t && Date.parse(range.to) % (15 * 60_000) === 0 && range.from < range.to);
    assert.equal(Date.parse(range.from), fxSession(range.sessions_covered[0]).start);
    assert.ok(Date.parse(range.to) >= fxSession(range.sessions_covered.at(-1)).end - 15 * 60_000, `${new Date(t).toISOString()}`);
  }
  assert.equal(fxTradingDay(Date.parse("2026-01-12T21:59:59Z")), "2026-01-12");
  assert.equal(fxTradingDay(Date.parse("2026-01-12T22:00:00Z")), "2026-01-13");
});

test("the health window is the latest Monday-to-Friday 08:00 New York deadline, opened at 17:15 the day before", () => {
  const monday = latestFxDailyWindow(new Date("2026-01-12T14:00:00Z"));   // 09:00 EST Monday
  assert.deepEqual([monday.day, new Date(monday.opens_at).toISOString(), new Date(monday.deadline).toISOString()], ["2026-01-12", iso("2026-01-11T22:15:00Z"), iso("2026-01-12T13:00:00Z")]);
  assert.deepEqual(monday.session, fxSession("2026-01-09"));
  assert.equal(latestFxDailyWindow(new Date("2026-01-12T12:59:59Z")).day, "2026-01-09");   // before Monday's deadline: Friday's
  assert.equal(latestFxDailyWindow(new Date("2026-01-10T15:00:00Z")).day, "2026-01-09");   // Saturday
  assert.equal(new Date(latestFxDailyWindow(new Date("2026-07-14T13:00:00Z")).deadline).toISOString(), iso("2026-07-14T12:00:00Z"));   // EDT
  const now = new Date("2026-01-12T14:00:00Z"), session = fxSession("2026-01-09");
  const run = (at, change = {}) => ({ trigger: "daily", retrieved_at: iso(at), requested_from: new Date(session.start).toISOString(), requested_to: iso("2026-01-11T23:15:00Z"), unfinished_pages: 0, ...change });
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z")], now).latest_window_met, true);
  assert.equal(fxDailyCoverage([run("2026-01-11T22:10:00Z")], now).latest_window_met, false, "before the window opened");
  assert.equal(fxDailyCoverage([run("2026-01-12T13:05:00Z")], now).latest_window_met, false, "after the deadline");
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z", { unfinished_pages: 1 })], now).latest_window_met, false);
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z", { requested_from: iso("2026-01-09T00:00:00Z") })], now).latest_window_met, false, "the session is not covered whole");
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z", { requested_to: iso("2026-01-09T21:45:00Z") })], now).latest_window_met, true, "to the session's last candle");
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z", { requested_to: iso("2026-01-09T21:30:00Z") })], now).latest_window_met, false);
  // The last daily run before the deadline is the one that counts, as a forward study reads the log; manual runs do not count.
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z"), run("2026-01-12T04:00:00Z", { unfinished_pages: 1 })], now).latest_window_met, false);
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z"), run("2026-01-12T04:00:00Z", { trigger: "manual", unfinished_pages: 1 })], now).latest_window_met, true);
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z", { trigger: "manual" })], now).latest_run_at, null);
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z"), run("2026-01-12T13:30:00Z", { unfinished_pages: 1 })], now).latest_window_met, true, "a run after the deadline is not read");
  assert.deepEqual(fxDailyCoverage([], now), { latest_run_at: null, window_opens_at: iso("2026-01-11T22:15:00Z"), window_closes_at: iso("2026-01-12T13:00:00Z"), latest_window_met: false,
    latest_in_future: false });
  // The latest daily run stamped ahead of the clock that read the log, after now and after the read, blocks every later
  // run until the clock reaches it (BACKLOG 102-36 review); one written before the read is not ahead. Manual runs do not count.
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z")], now).latest_in_future, false);
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z"), run("2026-01-12T15:00:00Z")], now).latest_in_future, true);
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z"), run("2026-01-12T15:00:00Z")], now, Date.parse("2026-01-12T15:00:01Z")).latest_in_future, false);
  assert.equal(fxDailyCoverage([run("2026-01-11T23:30:00Z"), run("2026-01-12T15:00:00Z", { trigger: "manual" })], now).latest_in_future, false);
});

test("the run log keeps every run, identical content included, beside the instrument's manifest", async (t) => {
  const directory = await withFxPaths(t);
  assert.equal(resolveFxHistoricalRunLogPathFor("EUR_USD"), join(directory, "fx-history-m15-manifest.jsonl.runs"));
  assert.equal(resolveFxHistoricalRunLogPathFor("USD_JPY"), join(directory, "fx-history-m15-manifest.USD_JPY.jsonl.runs"));
  const argv = ["--from", "2026-01-05T00:00:00.000Z", "--to", "2026-01-05T00:30:00.000Z", "--confirm-external-fetch"];
  let fetched = 0;
  const deps = (at) => ({ now: () => new Date(at), fetch: async () => { fetched += 1; return response([candle("2026-01-05T00:00:00.000Z"), candle("2026-01-05T00:15:00.000Z")]); } });
  const first = await runFxHistoryCollection(argv, credentials, deps("2026-02-01T00:00:00.000Z"));
  const second = await runFxHistoryCollection(argv, credentials, deps("2026-02-02T00:00:00.000Z"));
  assert.deepEqual([first.manifest.recorded, second.manifest.recorded, first.run.sequence, second.run.sequence, fetched], [true, false, 1, 2, 1]);
  const runs = await new FxHistoricalRunLog(undefined, "EUR_USD").records();
  assert.deepEqual(runs.map((run) => [run.retrieved_at, run.manifest_recorded, run.resumed_pages, run.normalized_sha256 === first.normalized_sha256]),
    [["2026-02-01T00:00:00.000Z", true, 0, true], ["2026-02-02T00:00:00.000Z", false, 1, true]]);
  assert.deepEqual(Object.keys(runs[0]), ["schema_version", "sequence", "series", "observation_date", "first_seen_at", "instrument", "trigger", "environment", "requested_from",
    "requested_to", "started_at", "retrieved_at", "raw_sha256", "normalized_sha256", "bar_count", "first_bar_at", "last_bar_at", "resumed_pages", "unfinished_pages", "manifest_recorded"]);
  assert.deepEqual([runs[0].trigger, runs[0].started_at], ["manual", "2026-02-01T00:00:00.000Z"]);
  assert.equal((await new FxHistoricalManifestStore(undefined, "EUR_USD").records()).length, 1);
  // A clock behind the latest run is refused before anything is fetched or written.
  const before = fetched;
  await assert.rejects(runFxHistoryCollection(["--from", "2026-01-06T00:00:00.000Z", "--to", "2026-01-06T00:30:00.000Z", "--confirm-external-fetch"], credentials,
    deps("2026-02-01T12:00:00.000Z")), /starts before the latest recorded run finished/);
  assert.equal(fetched, before);
  assert.equal((await new FxHistoricalRunLog(undefined, "EUR_USD").records()).length, 2);
  // Without a run log, a manifest record or checkpoint stamped before the latest one is refused and leaves the files readable (BACKLOG 102-36).
  const manifest = new FxHistoricalManifestStore(undefined, "EUR_USD"), checkpoints = new FxHistoricalCheckpointStore(undefined, "EUR_USD");
  await assert.rejects(collectOandaM15History({ accountId: credentials.OANDA_FX_HISTORY_ACCOUNT_ID, token: credentials.OANDA_FX_HISTORY_ACCESS_TOKEN, from: "2026-01-07T00:00:00.000Z",
    to: "2026-01-07T00:30:00.000Z", instrument: "EUR_USD", store: manifest, checkpoints, now: () => new Date("2026-01-31T00:00:00.000Z"),
    fetch: async () => response([candle("2026-01-07T00:00:00.000Z")]) }), /first-seen clock moved backwards/);
  assert.equal((await manifest.records()).length, 1);
  assert.ok(Array.isArray(await checkpoints.completed("sha256:" + "0".repeat(64))));
  // A page that is not final yet writes no checkpoint, so here the manifest itself refuses, and stays readable.
  const manifestBytes = await readFile(manifest.path);
  await assert.rejects(collectOandaM15History({ accountId: credentials.OANDA_FX_HISTORY_ACCOUNT_ID, token: credentials.OANDA_FX_HISTORY_ACCESS_TOKEN, from: "2026-01-31T23:00:00.000Z",
    to: "2026-01-31T23:30:00.000Z", instrument: "EUR_USD", store: manifest, checkpoints, now: () => new Date("2026-01-31T23:40:00.000Z"),
    fetch: async () => response([candle("2026-01-31T23:00:00.000Z")]) }), /FX history manifest first-seen clock moved backwards/);
  assert.deepEqual(await readFile(manifest.path), manifestBytes);
  // The run log refuses a run finishing before its latest one, and writes nothing.
  const log = new FxHistoricalRunLog(undefined, "EUR_USD"), logBytes = await readFile(resolveFxHistoricalRunLogPathFor("EUR_USD"));
  const [latest] = (await log.records()).slice(-1);
  const { sequence, schema_version, series, observation_date, first_seen_at, instrument, ...input } = latest;
  await assert.rejects(log.append({ ...input, started_at: "2026-02-01T23:00:00.000Z", retrieved_at: "2026-02-01T23:30:00.000Z" }), /finished before the latest recorded run/);
  assert.deepEqual(await readFile(resolveFxHistoricalRunLogPathFor("EUR_USD")), logBytes);
  // A run log of another instrument is refused before anything is fetched, and a log with an unknown field fails closed.
  await assert.rejects(collectOandaM15History({ accountId: credentials.OANDA_FX_HISTORY_ACCOUNT_ID, token: credentials.OANDA_FX_HISTORY_ACCESS_TOKEN,
    from: "2026-01-05T00:00:00.000Z", to: "2026-01-05T00:30:00.000Z", instrument: "EUR_USD", runs: new FxHistoricalRunLog(join(directory, "x.runs"), "USD_JPY"),
    fetch: async () => { throw new Error("no request expected"); } }), /run log is for USD_JPY, not EUR_USD/);
  const path = resolveFxHistoricalRunLogPathFor("EUR_USD"), lines = (await readFile(path, "utf8")).trim().split("\n");
  await writeFile(path, `${JSON.stringify({ ...JSON.parse(lines[0]), token: "x" })}\n`, { mode: 0o600 });
  await assert.rejects(new FxHistoricalRunLog(undefined, "EUR_USD").records(), /fields are not the expected ones/);
});

test("the daily CLI collects each instrument over the computed range, records each run, and reports a failed instrument", async (t) => {
  await withFxPaths(t);
  const now = "2026-01-11T23:37:00.000Z", requested = [];
  const fetch = async (url) => {
    const parsed = new URL(url); requested.push([parsed.pathname.split("/")[5], parsed.searchParams.get("from"), parsed.searchParams.get("to")]);
    if (parsed.pathname.includes("USD_JPY")) return new Response("{}", { status: 400 });
    return response([candle("2026-01-09T21:30:00.000000000Z"), candle("2026-01-09T21:45:00.000000000Z", "1.1003")]);
  };
  const summary = await runFxHistoryDaily(["--instrument", "EUR_USD", "--instrument", "USD_JPY", "--lookback-weekdays", "2", "--confirm-external-fetch"], credentials,
    { now: () => new Date(now), fetch, sleep: async () => {} });
  assert.deepEqual([summary.requested_from, summary.requested_to, summary.sessions_covered, summary.ok], [iso("2026-01-07T22:00:00Z"), iso("2026-01-11T23:15:00Z"), ["2026-01-08", "2026-01-09"], false]);
  assert.deepEqual(requested, [["EUR_USD", summary.requested_from, summary.requested_to], ["USD_JPY", summary.requested_from, summary.requested_to]]);
  assert.deepEqual(summary.results.map((result) => [result.instrument, result.status]), [["EUR_USD", "collected"], ["USD_JPY", "failed"]]);
  assert.match(summary.results[1].error, /HTTP 400/);
  assert.equal(summary.results[0].run_sequence, 1);
  assert.deepEqual((await new FxHistoricalRunLog(undefined, "EUR_USD").records()).map((run) => [run.trigger, run.started_at]), [["daily", now]]);
  assert.equal((await new FxHistoricalRunLog(undefined, "EUR_USD").records()).length, 1);
  assert.equal((await new FxHistoricalRunLog(undefined, "USD_JPY").records()).length, 0);
  assert.deepEqual(parseFxHistoryDailyArguments(["--instrument", "AUD_NZD", "--confirm-external-fetch"]), { instruments: ["AUD_NZD"], lookbackWeekdays: 10, environment: "practice" });
  for (const [argv, pattern] of [
    [["--instrument", "EUR_USD"], /--confirm-external-fetch/],
    [["--confirm-external-fetch"], /at least one --instrument/],
    [["--instrument", "EURUSD", "--confirm-external-fetch"], /instrument must be one of/],
    [["--instrument", "EUR_USD", "--instrument", "EUR_USD", "--confirm-external-fetch"], /named once/],
    [["--instrument", "EUR_USD", "--lookback-weekdays", "21", "--confirm-external-fetch"], /from 1 to 20/],
    [["--instrument", "EUR_USD", "--lookback-weekdays", "01", "--confirm-external-fetch"], /from 1 to 20/],
    [["--instrument", "EUR_USD", "--environment", "demo", "--confirm-external-fetch"], /practice or live/],
  ]) assert.throws(() => parseFxHistoryDailyArguments(argv), pattern, JSON.stringify(argv));
  await assert.rejects(runFxHistoryDaily(["--instrument", "EUR_USD", "--confirm-external-fetch"], {}, {}), /set OANDA_FX_HISTORY_ACCOUNT_ID/);
});

test("the fx-history health scope checks each named instrument's run log against the latest window, and only when asked", async (t) => {
  await withFxPaths(t);
  assert.deepEqual(parseCollectionHealthCliArguments(["--scope", "fx-history", "--instrument", "EUR_USD", "--instrument", "AUD_NZD"]).instruments, ["EUR_USD", "AUD_NZD"]);
  assert.equal("instruments" in parseCollectionHealthCliArguments([]), false);
  assert.throws(() => parseCollectionHealthCliArguments(["--scope", "fx-history"]), /needs at least one --instrument/);
  assert.throws(() => parseCollectionHealthCliArguments(["--instrument", "EUR_USD"]), /belongs to --scope fx-history/);
  assert.throws(() => parseCollectionHealthCliArguments(["--scope", "fx-history", "--instrument", "EUR_USD", "--instrument", "EUR_USD"]), /named once/);
  assert.throws(() => parseCollectionHealthCliArguments(["--scope", "fx-history", "--instrument", "BTC_USD"]), /--instrument must be one of/);
  const session = fxSession("2026-01-09");
  await new FxHistoricalRunLog(undefined, "EUR_USD").append({ trigger: "daily", environment: "practice", requested_from: new Date(session.start).toISOString(), requested_to: iso("2026-01-11T23:15:00Z"),
    started_at: iso("2026-01-11T23:39:00Z"), retrieved_at: iso("2026-01-11T23:40:00Z"), raw_sha256: [`sha256:${"a".repeat(64)}`], normalized_sha256: `sha256:${"b".repeat(64)}`, bar_count: 2,
    first_bar_at: iso("2026-01-09T21:30:00Z"), last_bar_at: iso("2026-01-09T21:45:00Z"), resumed_pages: 0, unfinished_pages: 0, manifest_recorded: true });
  const args = parseCollectionHealthCliArguments(["--scope", "fx-history", "--instrument", "EUR_USD", "--instrument", "USD_JPY"]);
  const monday = await checkCollectionHealth(args, new Date("2026-01-12T14:00:00Z"));
  assert.equal(monday.status, "stale");
  assert.deepEqual(monday.fx_history.map((row) => [row.instrument, row.latest_window_met]), [["EUR_USD", true], ["USD_JPY", false]]);
  assert.deepEqual(monday.issues.map((issue) => [issue.code, issue.instrument]), [["fx_history_collection_missing", "USD_JPY"]]);
  assert.match(collectionHealthNotification(monday), /fx-history USD_JPY/);
  const tuesday = await checkCollectionHealth(parseCollectionHealthCliArguments(["--scope", "fx-history", "--instrument", "EUR_USD"]), new Date("2026-01-13T14:00:00Z"));
  assert.deepEqual(tuesday.issues.map((issue) => [issue.code, issue.instrument]), [["fx_history_collection_stale", "EUR_USD"]]);
  const healthy = await checkCollectionHealth(parseCollectionHealthCliArguments(["--scope", "fx-history", "--instrument", "EUR_USD"]), new Date("2026-01-12T14:00:00Z"));
  assert.deepEqual([healthy.status, healthy.policy_rate, healthy.research, healthy.first_seen], ["healthy", null, null, null]);
  // "all" stays the three collectors every setup runs.
  const all = evaluateCollectionHealth({ checkedAt: "2026-01-12T14:00:00.000Z", maxPolicyRateAgeBusinessDays: 0, maxResearchAgeHours: 2,
    policyRate: { latest_collected_at: "2026-01-12T01:00:00.000Z", latest_run_age_business_days: 0 }, research: { latest_collected_at: "2026-01-12T13:30:00.000Z", latest_run_age_hours: 0.5 },
    firstSeen: { latest_collected_at: "2026-01-12T01:30:00.000Z", latest_run_status: "complete", latest_expected_run_at: "2026-01-12T01:30:00.000Z", latest_run_meets_schedule: true } });
  assert.deepEqual([all.status, all.fx_history], ["healthy", null]);
  assert.throws(() => evaluateCollectionHealth({ ...all, scope: "fx-history", checkedAt: all.checked_at, maxPolicyRateAgeBusinessDays: 0, maxResearchAgeHours: 2,
    policyRate: all.policy_rate, research: all.research, firstSeen: all.first_seen, fxHistory: [] }), /needs at least one instrument/);
  // A daily run stamped by a clock two hours ahead holds off every later run until the clock reaches it: the check
  // reports it as clock_ahead (BACKLOG 102-36 review).
  const ahead = Date.now() + 2 * 3_600_000;
  await new FxHistoricalRunLog(undefined, "GBP_USD").append({ trigger: "daily", environment: "practice", requested_from: new Date(session.start).toISOString(), requested_to: iso("2026-01-11T23:15:00Z"),
    started_at: new Date(ahead - 60_000).toISOString(), retrieved_at: new Date(ahead).toISOString(), raw_sha256: [`sha256:${"a".repeat(64)}`], normalized_sha256: `sha256:${"b".repeat(64)}`, bar_count: 2,
    first_bar_at: iso("2026-01-09T21:30:00Z"), last_bar_at: iso("2026-01-09T21:45:00Z"), resumed_pages: 0, unfinished_pages: 0, manifest_recorded: true });
  const clock = await checkCollectionHealth(parseCollectionHealthCliArguments(["--scope", "fx-history", "--instrument", "GBP_USD", "--instrument", "EUR_USD"]), new Date());
  assert.deepEqual(clock.fx_history.map((row) => [row.instrument, row.latest_in_future]), [["GBP_USD", true], ["EUR_USD", false]]);
  assert.deepEqual(clock.issues.map((issue) => [issue.code, issue.instrument]), [["fx_history_clock_ahead", "GBP_USD"], ["fx_history_collection_stale", "EUR_USD"]]);
  assert.match(collectionHealthNotification(clock), /fx-history GBP_USD, fx-history EUR_USD\..*check the system clock/);
});
