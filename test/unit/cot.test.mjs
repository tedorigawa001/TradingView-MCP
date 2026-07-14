import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { CotClient, computeCotPositioningFeatures, cotFreshness } from "../../build/cot.js";

test("CotClient maps TFF positions and rejects unsupported symbols", async (t) => {
  const server = http.createServer((_req, res) => res.end(JSON.stringify([{ market_and_exchange_names: "EURO FX - CME", cftc_contract_market_code: "099741", report_date_as_yyyy_mm_dd: "2026-07-07T00:00:00.000", open_interest_all: "100", dealer_positions_long_all: "20", dealer_positions_short_all: "30", asset_mgr_positions_long: "40", asset_mgr_positions_short: "10", lev_money_positions_long: "5", lev_money_positions_short: "8", other_rept_positions_long: "1", other_rept_positions_short: "2" }])));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new CotClient(`http://127.0.0.1:${server.address().port}`);
  const result = await client.getLatest("OANDA:EURUSD");
  assert.equal(result.open_interest, 100);
  assert.deepEqual(result.positions[0], { group: "dealer", long: 20, short: 30, net: -10 });
  await assert.rejects(() => client.getLatest("OANDA:BTCUSD"), /mapping/);
});

test("CotClient filters by contract code and returns descending history", async (t) => {
  let requestedUrl = null;
  const server = http.createServer((req, res) => {
    requestedUrl = new URL(req.url, "http://localhost");
    res.end(JSON.stringify([
    { market_and_exchange_names: "EURO FX cross", cftc_contract_market_code: "299741", report_date_as_yyyy_mm_dd: "2026-07-07", dealer_positions_long_all: "99", dealer_positions_short_all: "1" },
    { market_and_exchange_names: "EURO FX", cftc_contract_market_code: "099741", report_date_as_yyyy_mm_dd: "2026-06-30", dealer_positions_long_all: "10", dealer_positions_short_all: "4" },
    { market_and_exchange_names: "EURO FX", cftc_contract_market_code: "099741", report_date_as_yyyy_mm_dd: "2026-07-07", dealer_positions_long_all: "5", dealer_positions_short_all: "8" },
    ]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new CotClient(`http://127.0.0.1:${server.address().port}`);
  const result = await client.getHistory("OANDA:EURUSD", 2);
  assert.deepEqual(result.observations.map((row) => row.report_date), ["2026-07-07", "2026-06-30"]);
  assert.equal(result.observations[0].positions[0].net, -3);
  assert.equal(result.observations[1].positions[0].net, 6);
  assert.equal(requestedUrl.searchParams.get("$limit"), "250");
  assert.equal(requestedUrl.searchParams.get("$where"), "cftc_contract_market_code='099741'");
});

test("CotClient shares raw COT rows between latest and history requests", async (t) => {
  let calls = 0;
  const server = http.createServer((_req, res) => { calls += 1; res.end(JSON.stringify([
    { market_and_exchange_names: "EURO FX", cftc_contract_market_code: "099741", report_date_as_yyyy_mm_dd: "2026-07-07", open_interest_all: "1", dealer_positions_long_all: "1", dealer_positions_short_all: "1" },
    { market_and_exchange_names: "EURO FX", cftc_contract_market_code: "099741", report_date_as_yyyy_mm_dd: "2026-06-30", open_interest_all: "1", dealer_positions_long_all: "1", dealer_positions_short_all: "1" },
  ])); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new CotClient(`http://127.0.0.1:${server.address().port}`);
  assert.equal((await client.getLatest("OANDA:EURUSD")).cache_status, "miss");
  assert.equal((await client.getHistory("OANDA:EURUSD", 2)).cache_status, "hit");
  assert.equal(calls, 1);
});

test("CotClient validates history weeks and rejects incomplete history", async (t) => {
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls += 1;
    res.end(JSON.stringify([{ market_and_exchange_names: "EURO FX", cftc_contract_market_code: "099741", report_date_as_yyyy_mm_dd: "2026-07-07" }]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new CotClient(`http://127.0.0.1:${server.address().port}`);
  await assert.rejects(() => client.getHistory("OANDA:EURUSD", 0), /integer from 1 to 52/);
  await assert.rejects(() => client.getHistory("OANDA:EURUSD", 52.5), /integer from 1 to 52/);
  assert.equal(calls, 0, "invalid periods must fail before network access");
  await assert.rejects(() => client.getHistory("OANDA:EURUSD", 2), /only 1 are available/);
  assert.equal(calls, 1);
});

test("CotClient retries 5xx responses and spaces uncached market requests", async (t) => {
  const requestTimes = [];
  let euroCalls = 0;
  const server = http.createServer((req, res) => {
    requestTimes.push(Date.now());
    const where = new URL(req.url, "http://localhost").searchParams.get("$where");
    if (where?.includes("099741") && euroCalls++ === 0) {
      res.statusCode = 503;
      res.end("temporary failure");
      return;
    }
    const code = where?.includes("097741") ? "097741" : "099741";
    res.end(JSON.stringify([{
      market_and_exchange_names: code === "097741" ? "JAPANESE YEN" : "EURO FX",
      cftc_contract_market_code: code,
      report_date_as_yyyy_mm_dd: "2026-07-07",
    }]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new CotClient(`http://127.0.0.1:${server.address().port}`);
  const firstRequestStartedAt = Date.now();
  await client.getLatest("OANDA:EURUSD");
  await client.getLatest("OANDA:USDJPY");
  assert.equal(requestTimes.length, 3);
  assert.ok(requestTimes[2] - firstRequestStartedAt >= 240, "separate uncached markets should be rate-spaced");
});

test("CotClient rejects duplicate report dates for the same contract", async (t) => {
  const row = {
    market_and_exchange_names: "EURO FX",
    cftc_contract_market_code: "099741",
    report_date_as_yyyy_mm_dd: "2026-07-07",
  };
  const server = http.createServer((_req, res) => res.end(JSON.stringify([
    row,
    { ...row, report_date_as_yyyy_mm_dd: "2026-07-07T00:00:00.000" },
  ])));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new CotClient(`http://127.0.0.1:${server.address().port}`);
  await assert.rejects(() => client.getLatest("OANDA:EURUSD"), /duplicate COT report date/);
});

test("CotClient maps all Disaggregated position groups with their official field names", async (t) => {
  const server = http.createServer((_req, res) => res.end(JSON.stringify([{
    market_and_exchange_names: "GOLD - COMEX",
    cftc_contract_market_code: "088691",
    report_date_as_yyyy_mm_dd: "2026-07-07",
    open_interest_all: "1000",
    prod_merc_positions_long: "100",
    prod_merc_positions_short: "80",
    swap_positions_long_all: "200",
    swap__positions_short_all: "240",
    m_money_positions_long_all: "300",
    m_money_positions_short_all: "250",
    other_rept_positions_long: "50",
    other_rept_positions_short: "60",
  }])));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await new CotClient(`http://127.0.0.1:${server.address().port}`).getLatest("OANDA:XAUUSD");
  assert.deepEqual(result.positions.map(({ group, net }) => ({ group, net })), [
    { group: "prod_merc", net: 20 },
    { group: "swap", net: -40 },
    { group: "m_money", net: 50 },
    { group: "other_rept", net: -10 },
  ]);
});

test("computeCotPositioningFeatures normalizes net positions without mixing groups", () => {
  const latestDate = Date.UTC(2026, 6, 7);
  const observations = Array.from({ length: 157 }, (_, index) => ({
    symbol: "OANDA:EURUSD",
    report_type: "TFF futures only",
    market: "EURO FX",
    report_date: new Date(latestDate - index * 7 * 86_400_000).toISOString().slice(0, 10),
    available_at: null,
    open_interest: 200,
    positions: [
      { group: "dealer", long: null, short: null, net: 155 - index },
      { group: "asset_mgr", long: null, short: null, net: index - 155 },
    ],
  }));
  const features = computeCotPositioningFeatures(observations);
  const dealer = features.groups.find((group) => group.group === "dealer");
  const assetManager = features.groups.find((group) => group.group === "asset_mgr");
  assert.equal(dealer.net_open_interest_ratio, 0.775);
  assert.equal(dealer.net_change_from_previous_report, 1);
  assert.ok(Math.abs(dealer.net_oi_ratio_change_from_previous_report - 0.005) < 1e-12);
  assert.equal(dealer.percentile_3y, 100, "the current observation is excluded from its reference set");
  assert.equal(assetManager.percentile_3y, 0, "each trader group must use its own historical distribution");
  assert.equal(dealer.reference_count, 156);
  assert.equal(dealer.previous_report_status, "regular");
  assert.equal(features.point_in_time_status, "blocked");
});

test("computeCotPositioningFeatures fails closed for zero OI and incomplete lookback", () => {
  const features = computeCotPositioningFeatures([
    {
      symbol: "OANDA:EURUSD",
      report_type: "TFF futures only",
      market: "EURO FX",
      report_date: "2026-07-07",
      available_at: null,
      open_interest: 0,
      positions: [{ group: "dealer", long: 20, short: 10, net: 10 }],
    },
  ]);
  assert.equal(features.groups[0].net_open_interest_ratio, null);
  assert.equal(features.groups[0].net_change_from_previous_report, null);
  assert.equal(features.groups[0].net_oi_ratio_change_from_previous_report, null);
  assert.equal(features.groups[0].percentile_3y, null);
  assert.equal(features.groups[0].reference_count, 0);
  assert.equal(features.groups[0].percentile_status, "unavailable_current_ratio");
});

test("computeCotPositioningFeatures reverses Japanese Yen futures for USDJPY", () => {
  const base = {
    symbol: "OANDA:USDJPY",
    report_type: "TFF futures only",
    market: "JAPANESE YEN",
    available_at: null,
    open_interest: 100,
    target_direction_multiplier: -1,
    proxy_scope: "direct_base_asset",
  };
  const features = computeCotPositioningFeatures([
    { ...base, report_date: "2026-07-07", positions: [{ group: "dealer", long: 20, short: 10, net: 10 }] },
    { ...base, report_date: "2026-06-30", positions: [{ group: "dealer", long: 15, short: 10, net: 5 }] },
  ]);
  const dealer = features.groups[0];
  assert.equal(dealer.net_open_interest_ratio, 0.1, "raw contract direction remains auditable");
  assert.equal(dealer.target_oriented_net_open_interest_ratio, -0.1);
  assert.equal(dealer.net_oi_ratio_change_from_previous_report, 0.05);
  assert.equal(dealer.target_oriented_ratio_change_from_previous_report, -0.05);
  assert.equal(dealer.percentile_basis, "target_oriented_net_open_interest_ratio");
});

test("computeCotPositioningFeatures uses mid-rank at the 150-reference boundary", () => {
  const latestDate = Date.UTC(2026, 6, 7);
  const makeObservation = (reportDate) => ({
    symbol: "OANDA:EURUSD",
    report_type: "TFF futures only",
    market: "EURO FX",
    report_date: reportDate,
    available_at: null,
    open_interest: 100,
    positions: [{ group: "dealer", long: 20, short: 10, net: 10 }],
  });
  const current = makeObservation("2026-07-07");
  const references = [
    ...Array.from({ length: 149 }, (_, index) =>
      makeObservation(new Date(latestDate - (index + 1) * 7 * 86_400_000).toISOString().slice(0, 10)),
    ),
    makeObservation("2023-07-07"),
  ];
  const complete = computeCotPositioningFeatures([current, ...references]).groups[0];
  assert.equal(complete.reference_count, 150);
  assert.equal(complete.percentile_3y, 50);
  assert.equal(complete.percentile_status, "available");
  const insufficient = computeCotPositioningFeatures([current, ...references.slice(1)]).groups[0];
  assert.equal(insufficient.reference_count, 149);
  assert.equal(insufficient.percentile_3y, null);
  assert.equal(insufficient.percentile_status, "insufficient_history");
});

test("computeCotPositioningFeatures clamps a leap-day three-year cutoff", () => {
  const latestDate = Date.UTC(2024, 1, 29);
  const makeObservation = (reportDate) => ({
    symbol: "OANDA:EURUSD",
    report_type: "TFF futures only",
    market: "EURO FX",
    report_date: reportDate,
    available_at: null,
    open_interest: 100,
    positions: [{ group: "dealer", long: 20, short: 10, net: 10 }],
  });
  const references = Array.from({ length: 150 }, (_, index) =>
    makeObservation(new Date(latestDate - (index + 1) * 7 * 86_400_000).toISOString().slice(0, 10)),
  );
  const dealer = computeCotPositioningFeatures([
    makeObservation("2024-02-29"),
    ...references,
    makeObservation("2021-02-28"),
  ]).groups[0];
  assert.equal(dealer.reference_start, "2021-02-28");
  assert.equal(dealer.reference_count, 151);
});

test("computeCotPositioningFeatures flags irregular report gaps without interpolation", () => {
  const makeObservation = (reportDate, net) => ({
    symbol: "OANDA:EURUSD",
    report_type: "TFF futures only",
    market: "EURO FX",
    report_date: reportDate,
    available_at: null,
    open_interest: 100,
    positions: [{ group: "dealer", long: null, short: null, net }],
  });
  const dealer = computeCotPositioningFeatures([
    makeObservation("2026-07-14", 10),
    makeObservation("2026-06-30", 5),
  ]).groups[0];
  assert.equal(dealer.report_gap_days, 14);
  assert.equal(dealer.previous_report_status, "irregular_gap");
  assert.equal(dealer.net_change_from_previous_report, 5);
});

test("cotFreshness never infers freshness without a report date", () => {
  assert.equal(cotFreshness("2026-07-01T00:00:00.000", new Date("2026-07-11T00:00:00.000Z")).status, "fresh");
  assert.equal(cotFreshness("2026-02-30", new Date("2026-03-01T00:00:00.000Z")).status, "unavailable");
  assert.equal(cotFreshness("2026-07-15", new Date("2026-07-14T00:00:00.000Z")).status, "unavailable");
  assert.equal(cotFreshness(null).status, "unavailable");
});
