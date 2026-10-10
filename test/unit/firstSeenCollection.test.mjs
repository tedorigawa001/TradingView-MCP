import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFirstSeenSources, getUnifiedFirstSeenCoverage } from "../../build/firstSeenCollection.js";
import { firstSeenHeartbeatRun, parseCollectionCliArguments } from "../../build/collectionCli.js";
import { CotClient } from "../../build/cot.js";
import { CotFirstSeenStore } from "../../build/cotFirstSeenHistory.js";
import { FirstSeenCollectionHeartbeatStore } from "../../build/firstSeenCollectionHeartbeat.js";
import { runCollectionHealthCli } from "../../build/collectionHealthCli.js";
import { TreasuryRealYieldClient } from "../../build/realYield.js";
import { RealYieldFirstSeenStore } from "../../build/realYieldHistory.js";

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
  // Real yield: the client reports its store failure as a quality issue; each gets its own message.
  for (const [issue, availableAt, message] of [
    ["first_seen_persistence_failed", null, /^real-yield 2026-07-25 was fetched but its first-seen record failed to save$/],
    ["first_seen_auxiliary_persistence_failed", "2026-07-26T00:00:00.000Z", /^real-yield previous-year revision rows were fetched but failed to save$/],
    ["first_seen_persistence_disabled", null, /^real-yield first-seen store is disabled$/],
  ]) {
    const result = await run([{ available_at: "2026-07-26T00:00:00.000Z" }],
      { ...recorded, available_at: availableAt, quality_issues: ["stale_observation", issue] });
    assert.deepEqual([result.status, result.real_yield.status], ["partial", "error"], issue);
    assert.match(result.real_yield.error, message);
  }
  // A missing latest value is no new evidence either, though nothing failed to write; its message says to check the feed.
  const missing = await run([{ available_at: "2026-07-26T00:00:00.000Z" }], { ...recorded, available_at: null, value_status: "missing" });
  assert.deepEqual([missing.status, missing.real_yield.status], ["partial", "error"]);
  assert.match(missing.real_yield.error, /^the latest Treasury 10-year value for 2026-07-25 is missing, so no first-seen record was made; check the feed$/);
  // A previous-year revision scan that failed in January leaves last year's revisions unchecked: an error too, though the
  // latest value was recorded, with its cause when the client gave one (BACKLOG 102-31).
  const unscanned = await run([{ available_at: "2026-07-26T00:00:00.000Z" }],
    { ...recorded, quality_issues: ["previous_year_revision_scan_failed"], quality_issue_details: { previous_year_revision_scan_failed: "Treasury request failed with HTTP 503" } });
  assert.deepEqual([unscanned.status, unscanned.real_yield.status], ["partial", "error"]);
  assert.equal(unscanned.real_yield.error,
    "real-yield previous-year revision scan failed, so last year's revisions were not checked: Treasury request failed with HTTP 503");
  // It does not hide that the latest value itself was not recorded.
  const both = await run([{ available_at: "2026-07-26T00:00:00.000Z" }],
    { ...recorded, available_at: null, value_status: "missing", quality_issues: ["previous_year_revision_scan_failed"] });
  assert.equal(both.real_yield.error, "the latest Treasury 10-year value for 2026-07-25 is missing, so no first-seen record was made; check the feed; " +
    "real-yield previous-year revision scan failed, so last year's revisions were not checked");
  // A quality issue that is not about persistence leaves a recorded value complete.
  const stale = await run([{ available_at: "2026-07-26T00:00:00.000Z" }], { ...recorded, quality_issues: ["stale_observation", "publication_time_unavailable"] });
  assert.deepEqual([stale.status, stale.real_yield.status], ["complete", "complete"]);
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
  // The log says why: the store's own error, here making its directory under a file (BACKLOG 102-30).
  assert.match(fetched.first_seen_error, /\b(EEXIST|ENOTDIR|ENOENT)\b/);
  assert.equal(result.cot[0].error, `1 of 1 COT observations were fetched but not recorded as first seen: ${fetched.first_seen_error}`);
  // The heartbeat the CLI records, and what the health check makes of it.
  const heartbeatPath = join(dir, "heartbeats.jsonl");
  const heartbeat = await new FirstSeenCollectionHeartbeatStore(heartbeatPath).recordRun(firstSeenHeartbeatRun(result, ["OANDA:EURUSD"]));
  assert.deepEqual([heartbeat.status, heartbeat.cot_complete, heartbeat.real_yield_status, heartbeat.cme_gold_open_interest_status],
    ["partial", 0, "complete", "complete"]);
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

test("a real real-yield store that cannot write makes that source an error in the run and its heartbeat (102-07)", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "first-seen-save-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A Treasury stand-in with one valid row from three days ago, and a store under a regular file.
  const date = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"
    xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <updated>${new Date().toISOString()}</updated><entry><updated>2099-01-01T00:00:00Z</updated><content type="application/xml"><m:properties>
    <d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE><d:TC_10YEAR m:type="Edm.Double">2.01</d:TC_10YEAR>
    </m:properties></content></entry></feed>`;
  const server = http.createServer((_req, res) => res.end(xml));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await writeFile(join(dir, "blocker"), "");
  const realYield = new TreasuryRealYieldClient(`http://127.0.0.1:${server.address().port}`, 15_000,
    new RealYieldFirstSeenStore(join(dir, "blocker", "real-yield.jsonl")));
  const result = await collectFirstSeenSources({
    cot: { getHistory: async () => ({ observations: [{ available_at: "2026-07-26T00:00:00.000Z" }] }) },
    realYield, cmeGoldOpenInterest: goldOpenInterest, futuresOpenInterest: futuresStore,
    cotSymbols: ["OANDA:XAUUSD"], cotWeeks: 52, coverage: async () => completeCoverage(),
  });
  assert.deepEqual([result.status, result.real_yield.status], ["partial", "error"]);
  // The log says why: the store's own error (BACKLOG 102-30).
  assert.match(result.real_yield.error,
    new RegExp(`^real-yield ${date} was fetched but its first-seen record failed to save: .*(EEXIST|ENOTDIR|ENOENT)`));
  const heartbeat = await new FirstSeenCollectionHeartbeatStore(join(dir, "heartbeats.jsonl"))
    .recordRun(firstSeenHeartbeatRun(result, ["OANDA:XAUUSD"]));
  assert.deepEqual([heartbeat.status, heartbeat.cot_complete, heartbeat.real_yield_status], ["partial", 1, "error"]);
});

// A Treasury feed with one valid 10-year row from three days ago.
const treasuryFeed = () => {
  const date = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"
    xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <updated>${new Date().toISOString()}</updated><entry><updated>2099-01-01T00:00:00Z</updated><content type="application/xml"><m:properties>
    <d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE><d:TC_10YEAR m:type="Edm.Double">2.01</d:TC_10YEAR>
    </m:properties></content></entry></feed>`;
};

// BACKLOG 102-30 follow-up: the store wraps a lock it could not take ("unable to acquire … history lock") around the
// filesystem's error, so the cause chain is what says why; a disk that is full, a permission or an I/O error each shows.
test("a store that cannot take its lock reports the filesystem's error through the chain, for COT and real yield", async (t) => {
  const fsp = createRequire(import.meta.url)("node:fs/promises");
  const realOpen = fsp.open;
  const server = http.createServer((req, res) => res.end(!req.url.includes("field_tdr_date_value") ? JSON.stringify([{ market_and_exchange_names: "EURO FX - CME",
    cftc_contract_market_code: "099741", report_date_as_yyyy_mm_dd: "2026-07-07T00:00:00.000", open_interest_all: "100",
    dealer_positions_long_all: "20", dealer_positions_short_all: "30" }]) : treasuryFeed()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const code of ["ENOSPC", "EACCES", "EIO"]) {
    const dir = await mkdtemp(join(tmpdir(), "first-seen-lock-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    fsp.open = async (path, ...rest) => {
      if (String(path).endsWith(".lock")) throw Object.assign(new Error(`${code}: injected, open '${path}'`), { code });
      return realOpen(path, ...rest);
    };
    syncBuiltinESMExports();
    try {
      const cot = new CotClient(base, 15_000, new CotFirstSeenStore(join(dir, "cot.jsonl")));
      const realYield = new TreasuryRealYieldClient(base, 15_000, new RealYieldFirstSeenStore(join(dir, "real-yield.jsonl")));
      const fetched = await cot.getHistory("OANDA:EURUSD", 1);
      assert.match(fetched.first_seen_error, new RegExp(`unable to acquire .*lock: ${code}: injected`), code);
      const result = await collectFirstSeenSources({
        cot, realYield, cmeGoldOpenInterest: goldOpenInterest, futuresOpenInterest: futuresStore,
        cotSymbols: ["OANDA:EURUSD"], cotWeeks: 1, coverage: async () => completeCoverage(),
      });
      assert.match(result.cot[0].error, new RegExp(`not recorded as first seen: unable to acquire .*lock: ${code}: injected`), code);
      assert.match(result.real_yield.error, new RegExp(`failed to save: unable to acquire .*lock: ${code}: injected`), code);
    } finally {
      fsp.open = realOpen;
      syncBuiltinESMExports();
    }
  }
});

test("a January run whose previous-year scan fails makes the real-yield source an error and the run partial (102-31)", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "first-seen-scan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // The current year's feed has a row; last year's request fails.
  const server = http.createServer((req, res) => {
    const year = new URL(req.url, "http://localhost").searchParams.get("field_tdr_date_value");
    if (year === "2025") { res.statusCode = 503; res.end("down"); return; }
    res.end(`<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
      <updated>2026-01-14T20:00:00Z</updated><entry><updated>2099-01-01T00:00:00Z</updated><content type="application/xml"><m:properties>
      <d:NEW_DATE m:type="Edm.DateTime">2026-01-14T00:00:00</d:NEW_DATE><d:TC_10YEAR m:type="Edm.Double">1.80</d:TC_10YEAR>
      </m:properties></content></entry></feed>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new TreasuryRealYieldClient(`http://127.0.0.1:${server.address().port}`, 15_000,
    new RealYieldFirstSeenStore(join(dir, "real-yield.jsonl")), () => new Date("2026-01-15T01:00:00.000Z"));
  const result = await collectFirstSeenSources({
    cot: { getHistory: async () => ({ observations: [{ available_at: "2026-07-26T00:00:00.000Z" }] }) },
    realYield: { getLatest: () => client.getLatest(new Date("2026-01-15T12:00:00.000Z")) },
    cmeGoldOpenInterest: goldOpenInterest, futuresOpenInterest: futuresStore,
    cotSymbols: ["OANDA:XAUUSD"], cotWeeks: 52, coverage: async () => completeCoverage(),
  });
  assert.deepEqual([result.status, result.real_yield.status], ["partial", "error"]);
  assert.match(result.real_yield.error, /^real-yield previous-year revision scan failed, so last year's revisions were not checked: .*503/);
  const heartbeat = await new FirstSeenCollectionHeartbeatStore(join(dir, "heartbeats.jsonl")).recordRun(firstSeenHeartbeatRun(result, ["OANDA:XAUUSD"]));
  assert.deepEqual([heartbeat.status, heartbeat.real_yield_status], ["partial", "error"]);
});
