import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFirstSeenSources, getUnifiedFirstSeenCoverage } from "../../build/firstSeenCollection.js";
import { firstSeenHeartbeatRun, parseCollectionCliArguments } from "../../build/collectionCli.js";
import { CotClient } from "../../build/cot.js";
import { CotFirstSeenStore } from "../../build/cotFirstSeenHistory.js";
import { FirstSeenCollectionHeartbeatStore } from "../../build/firstSeenCollectionHeartbeat.js";
import { runCollectionHealthCli } from "../../build/collectionHealthCli.js";

test("collection CLI parses explicit symbols, environment defaults, and bounded weeks", () => {
  assert.deepEqual(
    parseCollectionCliArguments(["collect", "--cot-symbol", "OANDA:XAUUSD", "--cot-weeks", "12"], {}),
    { command: "collect", cotSymbols: ["OANDA:XAUUSD"], cotWeeks: 12 },
  );
  assert.deepEqual(
    parseCollectionCliArguments(["coverage"], { TRADINGVIEW_MCP_COLLECTION_COT_SYMBOLS: "OANDA:EURUSD, OANDA:XAUUSD" }),
    { command: "coverage", cotSymbols: ["OANDA:EURUSD", "OANDA:XAUUSD"], cotWeeks: 52 },
  );
  assert.throws(() => parseCollectionCliArguments(["collect", "--cot-weeks", "53"], {}), /1 to 52/);
  assert.throws(() => parseCollectionCliArguments(["collect", "--cot-symbol", "OANDA:XAUUSD", "--cot-symbol", "OANDA:XAUUSD"], {}), /duplicates/);
});

test("collection continues after an individual source failure and returns coverage", async () => {
  const observed = [];
  const coverage = {
    observed_at: "2026-07-26T00:00:00.000Z",
    status: "complete",
    cot: { records: 1, series: [] },
    real_yield: { records: 1, dates: 1, revisions: 0, earliest_date: "2026-07-25", latest_date: "2026-07-25", first_collected_at: "2026-07-26T00:00:00.000Z" },
    futures_open_interest: { records: 1, series: [] },
    policy_rates: { records: 0, currencies: {} },
    policy_rate_collection_heartbeats: { records: 0, earliest_collected_at: null, latest_collected_at: null, chart_indexes: [], complete_currency_runs: 0 },
  };
  const result = await collectFirstSeenSources({
    cot: { getHistory: async (symbol) => {
      if (symbol === "OANDA:EURUSD") throw new Error("CFTC unavailable");
      return { observations: [{ report_date: "2026-07-21", available_at: "2026-07-26T00:00:00.000Z" }] };
    } },
    realYield: { getLatest: async () => ({ observation_date: "2026-07-25", available_at: "2026-07-26T00:00:00.000Z", quality_issues: [] }) },
    cmeGoldOpenInterest: { getLatestGoldOpenInterest: async () => ({
      observation_date: "2026-07-24", open_interest: 376079, report_status: "final",
      source: "cme_daily_bulletin", source_detail: "GC_FUT", observed_at: "2026-07-26T00:00:00.000Z",
    }) },
    futuresOpenInterest: { observeMany: async (items) => {
      observed.push(...items);
      return { recorded: [{}], unchanged: 0, revisions: 0 };
    } },
    cotSymbols: ["OANDA:EURUSD", "OANDA:XAUUSD"],
    cotWeeks: 52,
    coverage: async () => coverage,
  });
  assert.equal(result.status, "partial");
  assert.equal(result.cot[0].status, "error");
  assert.deepEqual(result.cot[1], { symbol: "OANDA:XAUUSD", status: "complete", observations: 1 });
  assert.equal(result.real_yield.status, "complete");
  assert.deepEqual(result.cme_gold_open_interest, {
    status: "complete", observation_date: "2026-07-24", open_interest: 376079, report_status: "final",
    first_seen: { recorded: 1, unchanged: 0, revisions: 0 },
  });
  assert.deepEqual(observed, [{
    futures_symbol: "COMEX_DL:GC1!", scope: "all_months_aggregated", observation_date: "2026-07-24",
    open_interest: 376079, source: "cme_daily_bulletin", source_detail: "GC_FUT", report_status: "final", observed_at: "2026-07-26T00:00:00.000Z",
  }]);
  assert.equal(result.coverage, coverage);
});

test("unified coverage remains inspectable when one local log is unavailable", async () => {
  const coverage = await getUnifiedFirstSeenCoverage({
    cot: { coverage: async () => ({ records: 1, series: [] }) },
    realYield: { coverage: async () => { throw new Error("unsafe permissions"); } },
    futuresOpenInterest: { coverage: async () => ({ records: 0, series: [] }) },
    policyRates: { coverage: async () => ({ records: 0, currencies: {} }) },
    policyRateHeartbeats: { coverage: async () => ({ records: 0, earliest_collected_at: null, latest_collected_at: null, chart_indexes: [], complete_currency_runs: 0 }) },
    now: new Date("2026-07-26T00:00:00.000Z"),
  });
  assert.equal(coverage.status, "partial");
  assert.deepEqual(coverage.real_yield, { error: "unsafe permissions" });
  assert.equal(coverage.cot.records, 1);
  assert.equal(coverage.policy_rates.records, 0);
  assert.equal(coverage.policy_rate_collection_heartbeats.records, 0);
});

const completeCoverage = () => ({
  observed_at: "2026-07-26T00:00:00.000Z",
  status: "complete",
  cot: { records: 1, series: [] },
  real_yield: { records: 1, dates: 1, revisions: 0, earliest_date: "2026-07-25", latest_date: "2026-07-25", first_collected_at: "2026-07-26T00:00:00.000Z" },
  futures_open_interest: { records: 1, series: [] },
  policy_rates: { records: 0, currencies: {} },
  policy_rate_collection_heartbeats: { records: 0, earliest_collected_at: null, latest_collected_at: null, chart_indexes: [], complete_currency_runs: 0 },
});
const goldOpenInterest = { getLatestGoldOpenInterest: async () => ({
  observation_date: "2026-07-24", open_interest: 376079, report_status: "final",
  source: "cme_daily_bulletin", source_detail: "GC_FUT", observed_at: "2026-07-26T00:00:00.000Z",
}) };
const futuresStore = { observeMany: async () => ({ recorded: [{}], unchanged: 0, revisions: 0 }) };

test("a fetch that was not recorded as first seen is an error, not a complete source (BACKLOG 102-07)", async () => {
  const run = (cotObservations, realYield) => collectFirstSeenSources({
    cot: { getHistory: async () => ({ observations: cotObservations }) },
    realYield: { getLatest: async () => realYield },
    cmeGoldOpenInterest: goldOpenInterest, futuresOpenInterest: futuresStore,
    cotSymbols: ["OANDA:XAUUSD"], cotWeeks: 52, coverage: async () => completeCoverage(),
  });
  const recorded = { observation_date: "2026-07-25", available_at: "2026-07-26T00:00:00.000Z", value_status: "valid", quality_issues: [] };
  const ok = await run([{ available_at: "2026-07-26T00:00:00.000Z" }], recorded);
  assert.deepEqual([ok.status, ok.cot[0].status, ok.real_yield.status], ["complete", "complete", "complete"]);
  // COT: the client keeps the fetched rows when its store fails and leaves available_at null.
  const cot = await run([{ available_at: "2026-07-26T00:00:00.000Z" }, { available_at: null }], recorded);
  assert.deepEqual([cot.status, cot.cot[0].status], ["partial", "error"]);
  assert.match(cot.cot[0].error, /1 of 2 COT observations were fetched but not recorded as first seen/);
  // Real yield: the client reports its store failure as a first_seen_* quality issue.
  for (const issue of ["first_seen_persistence_failed", "first_seen_auxiliary_persistence_failed", "first_seen_persistence_disabled"]) {
    const result = await run([{ available_at: "2026-07-26T00:00:00.000Z" }], { ...recorded, quality_issues: ["stale_observation", issue] });
    assert.deepEqual([result.status, result.real_yield.status], ["partial", "error"], issue);
    assert.match(result.real_yield.error, new RegExp(`not recorded as first seen: ${issue}`));
  }
  // No first-seen time without a store failure (a missing latest value) is no new evidence either.
  const missing = await run([{ available_at: "2026-07-26T00:00:00.000Z" }], { ...recorded, available_at: null, value_status: "missing" });
  assert.deepEqual([missing.status, missing.real_yield.status], ["partial", "error"]);
  assert.match(missing.real_yield.error, /no first-seen time \(value missing\)/);
});

test("a real COT store that cannot write makes the run partial, its heartbeat partial, and the health check notify (102-07)", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "first-seen-save-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A CFTC stand-in and a COT store under a regular file, so every append fails while the fetch succeeds.
  const server = http.createServer((_req, res) => res.end(JSON.stringify([{ market_and_exchange_names: "EURO FX - CME",
    cftc_contract_market_code: "099741", report_date_as_yyyy_mm_dd: "2026-07-07T00:00:00.000", open_interest_all: "100",
    dealer_positions_long_all: "20", dealer_positions_short_all: "30", asset_mgr_positions_long: "40", asset_mgr_positions_short: "10",
    lev_money_positions_long: "5", lev_money_positions_short: "8", other_rept_positions_long: "1", other_rept_positions_short: "2" }])));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await writeFile(join(dir, "blocker"), "");
  const cot = new CotClient(`http://127.0.0.1:${server.address().port}`, 15_000, new CotFirstSeenStore(join(dir, "blocker", "cot.jsonl")));
  const fetched = await cot.getHistory("OANDA:EURUSD", 1);
  assert.equal(fetched.observations[0].available_at, null, "the client still returns the fetch, without a first-seen time");
  const result = await collectFirstSeenSources({
    cot, realYield: { getLatest: async () => ({ observation_date: "2026-07-25", available_at: "2026-07-26T00:00:00.000Z", value_status: "valid", quality_issues: [] }) },
    cmeGoldOpenInterest: goldOpenInterest, futuresOpenInterest: futuresStore,
    cotSymbols: ["OANDA:EURUSD"], cotWeeks: 1, coverage: async () => completeCoverage(),
  });
  assert.deepEqual([result.status, result.cot[0].status], ["partial", "error"]);
  // The heartbeat the CLI records, and what the health check makes of it.
  const heartbeatPath = join(dir, "heartbeats.jsonl");
  await new FirstSeenCollectionHeartbeatStore(heartbeatPath).recordRun(firstSeenHeartbeatRun(result, ["OANDA:EURUSD"]));
  const saved = process.env.TRADINGVIEW_MCP_FIRST_SEEN_COLLECTION_HEARTBEAT_PATH;
  process.env.TRADINGVIEW_MCP_FIRST_SEEN_COLLECTION_HEARTBEAT_PATH = heartbeatPath;
  t.after(() => { if (saved === undefined) delete process.env.TRADINGVIEW_MCP_FIRST_SEEN_COLLECTION_HEARTBEAT_PATH; else process.env.TRADINGVIEW_MCP_FIRST_SEEN_COLLECTION_HEARTBEAT_PATH = saved; });
  const output = [], notifications = [];
  const code = await runCollectionHealthCli(["--scope", "first-seen", "--notify"], {
    notify: async (message) => { notifications.push(message); }, notificationsSupported: true,
    writeOutput: (message) => output.push(message), writeError: (message) => output.push(message),
  });
  const health = JSON.parse(output.join(""));
  assert.equal(code, 1);
  assert.ok(health.issues.some((issue) => issue.code === "first_seen_collection_partial"), JSON.stringify(health.issues));
  assert.equal(notifications.length, 1, "the partial run is notified");
});
