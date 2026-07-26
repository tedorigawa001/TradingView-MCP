import test from "node:test";
import assert from "node:assert/strict";
import { collectFirstSeenSources, getUnifiedFirstSeenCoverage } from "../../build/firstSeenCollection.js";
import { parseCollectionCliArguments } from "../../build/collectionCli.js";

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
  const coverage = {
    observed_at: "2026-07-26T00:00:00.000Z",
    status: "complete",
    cot: { records: 1, series: [] },
    real_yield: { records: 1, dates: 1, revisions: 0, earliest_date: "2026-07-25", latest_date: "2026-07-25", first_collected_at: "2026-07-26T00:00:00.000Z" },
    futures_open_interest: { records: 1, series: [] },
  };
  const result = await collectFirstSeenSources({
    cot: { getHistory: async (symbol) => {
      if (symbol === "OANDA:EURUSD") throw new Error("CFTC unavailable");
      return { observations: [{ report_date: "2026-07-21" }] };
    } },
    realYield: { getLatest: async () => ({ observation_date: "2026-07-25", available_at: "2026-07-26T00:00:00.000Z" }) },
    cmeGoldOpenInterest: { getLatestGoldOpenInterest: async () => ({ observation_date: "2026-07-24", open_interest: 376079, report_status: "final" }) },
    cotSymbols: ["OANDA:EURUSD", "OANDA:XAUUSD"],
    cotWeeks: 52,
    coverage: async () => coverage,
  });
  assert.equal(result.status, "partial");
  assert.equal(result.cot[0].status, "error");
  assert.deepEqual(result.cot[1], { symbol: "OANDA:XAUUSD", status: "complete", observations: 1 });
  assert.equal(result.real_yield.status, "complete");
  assert.deepEqual(result.cme_gold_open_interest, { status: "complete", observation_date: "2026-07-24", open_interest: 376079, report_status: "final" });
  assert.equal(result.coverage, coverage);
});

test("unified coverage remains inspectable when one local log is unavailable", async () => {
  const coverage = await getUnifiedFirstSeenCoverage({
    cot: { coverage: async () => ({ records: 1, series: [] }) },
    realYield: { coverage: async () => { throw new Error("unsafe permissions"); } },
    futuresOpenInterest: { coverage: async () => ({ records: 0, series: [] }) },
    now: new Date("2026-07-26T00:00:00.000Z"),
  });
  assert.equal(coverage.status, "partial");
  assert.deepEqual(coverage.real_yield, { error: "unsafe permissions" });
  assert.equal(coverage.cot.records, 1);
});
