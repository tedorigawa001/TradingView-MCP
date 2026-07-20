import test from "node:test";
import assert from "node:assert/strict";
import { changeChartState, withTemporaryChartState } from "../../build/chartTransaction.js";

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
