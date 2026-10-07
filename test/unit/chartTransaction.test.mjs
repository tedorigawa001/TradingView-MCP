import test from "node:test";
import assert from "node:assert/strict";
import { assertChartState, changeChartState, withTemporaryChartState } from "../../build/chartTransaction.js";

function fakeCharts() {
  const charts = [
    { index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] },
    { index: 1, symbol: "OANDA:XAUUSD", resolution: "60", studies: [] },
  ];
  const api = {
    getChartContext: async () => ({ layoutName: "two", activeChartIndex: 0, chartsCount: 2, charts }),
    setSymbol: async (symbol, chartIndex) => {
      charts[chartIndex].symbol = symbol;
      return { symbol, resolution: charts[chartIndex].resolution, changed: true, bars: 100 };
    },
    setResolution: async (resolution, chartIndex) => {
      charts[chartIndex].resolution = resolution;
      return { symbol: charts[chartIndex].symbol, resolution, changed: true, bars: 100 };
    },
  };
  return { charts, api };
}

test("changeChartState changes only the explicitly selected pane", async () => {
  const { charts, api } = fakeCharts();
  const result = await changeChartState(api, 1, { symbol: "OANDA:EURUSD", resolution: "15" });
  assert.deepEqual([charts[0].symbol, charts[0].resolution], ["OANDA:USDJPY", "240"]);
  assert.deepEqual([charts[1].symbol, charts[1].resolution], ["OANDA:EURUSD", "15"]);
  assert.equal(result.changed, true);
  assert.equal(result.bars, 100);
});

test("changeChartState rolls the selected pane back after a partial failure", async () => {
  const { charts, api } = fakeCharts();
  api.setResolution = async (resolution, chartIndex) => {
    if (resolution === "15") throw new Error("unsupported timeframe");
    charts[chartIndex].resolution = resolution;
    return { symbol: charts[chartIndex].symbol, resolution, changed: true, bars: 100 };
  };
  await assert.rejects(
    changeChartState(api, 1, { symbol: "OANDA:EURUSD", resolution: "15" }),
    /unsupported timeframe/,
  );
  assert.deepEqual([charts[1].symbol, charts[1].resolution], ["OANDA:XAUUSD", "60"]);
  assert.deepEqual([charts[0].symbol, charts[0].resolution], ["OANDA:USDJPY", "240"]);
});

test("withTemporaryChartState restores after operation failure and reports restore failure", async () => {
  const { charts, api } = fakeCharts();
  const failed = await withTemporaryChartState(
    api,
    1,
    { symbol: "OANDA:EURUSD", resolution: "15" },
    async () => { throw new Error("evidence failed"); },
  );
  assert.match(failed.operationError.message, /evidence failed/);
  assert.equal(failed.restored, true);
  assert.deepEqual([charts[1].symbol, charts[1].resolution], ["OANDA:XAUUSD", "60"]);

  const originalSetSymbol = api.setSymbol;
  api.setSymbol = async (symbol, chartIndex) => {
    if (symbol === "OANDA:XAUUSD") throw new Error("restore failed");
    return originalSetSymbol(symbol, chartIndex);
  };
  const restoreFailed = await withTemporaryChartState(
    api,
    1,
    { symbol: "OANDA:EURUSD" },
    async () => "ok",
  );
  assert.equal(restoreFailed.value, "ok");
  assert.equal(restoreFailed.restored, false);
  assert.match(restoreFailed.restoreError.message, /restore failed/);
});

// BACKLOG 102-21: TradingView resolves a symbol requested without its exchange to a default one.
function resolvingCharts(resolve = (symbol) => (symbol.includes(":") ? symbol : `OANDA:${symbol.toUpperCase()}`)) {
  const { charts, api } = fakeCharts();
  const calls = [];
  api.setSymbol = async (symbol, chartIndex) => {
    calls.push(symbol);
    charts[chartIndex].symbol = resolve(symbol);
    return { symbol: charts[chartIndex].symbol, resolution: charts[chartIndex].resolution, changed: true, bars: 100 };
  };
  return { charts, api, calls };
}

test("a change the user asks for takes a symbol without its exchange, bound to the one it resolves to", async () => {
  const { charts, api, calls } = resolvingCharts();
  const result = await changeChartState(api, 1, { symbol: "eurusd", resolution: "15" }, { exchangeOptional: true });
  assert.deepEqual(result.current, { symbol: "OANDA:EURUSD", resolution: "15" });
  assert.deepEqual([charts[1].symbol, charts[1].resolution], ["OANDA:EURUSD", "15"]);
  assert.deepEqual(calls, ["eurusd"]);
  // A chart already showing that ticker is left alone.
  const again = await changeChartState(api, 1, { symbol: "EURUSD" }, { exchangeOptional: true });
  assert.equal(again.changed, false);
  assert.deepEqual(calls, ["eurusd"]);
});

test("a symbol resolved to another instrument, or off the exchange it names, is refused and rolled back", async () => {
  for (const [requested, resolved] of [
    ["EURUSD", "OANDA:EURJPY"],
    ["EURUSD", "OANDA:EURUSD.P"],
    ["USD", "OANDA:EURUSD"],
    ["FX:EURUSD", "OANDA:EURUSD"],
  ]) {
    const { charts, api, calls } = resolvingCharts((symbol) => (symbol === requested ? resolved : symbol));
    await assert.rejects(
      changeChartState(api, 1, { symbol: requested, resolution: "15" }, { exchangeOptional: true }),
      new RegExp(`did not verify: requested ${requested}, chart shows ${resolved.replace(".", "\\.")}`),
      requested,
    );
    assert.deepEqual([charts[1].symbol, charts[1].resolution], ["OANDA:XAUUSD", "60"], requested);
    assert.deepEqual(calls, [requested, "OANDA:XAUUSD"], requested);
  }
});

test("a research binding still needs the exact symbol it names", async () => {
  const { charts, api } = resolvingCharts();
  await assert.rejects(changeChartState(api, 1, { symbol: "EURUSD" }), /did not verify/);
  assert.equal(charts[1].symbol, "OANDA:XAUUSD");
  const temporary = await withTemporaryChartState(api, 1, { symbol: "EURUSD" }, async () => "ran");
  assert.equal(temporary.value, null);
  assert.match(String(temporary.operationError), /did not verify/);
  assert.equal(temporary.restored, true);
  assert.equal(charts[1].symbol, "OANDA:XAUUSD");
  // A chart showing that ticker on some exchange does not satisfy a binding to the bare name.
  charts[1].symbol = "OANDA:EURUSD";
  await assert.rejects(assertChartState(api, 1, { symbol: "EURUSD", resolution: "60" }), /does not match expected EURUSD/);
});
