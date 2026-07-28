import test from "node:test";
import assert from "node:assert/strict";
import { collectPolicyRates, parsePolicyRateCollectionCliArguments } from "../../build/policyRateCollectionCli.js";

test("policy-rate collection requires explicit chart switching consent", () => {
  assert.throws(() => parsePolicyRateCollectionCliArguments([], {}), /chart switching is disabled/);
  assert.deepEqual(parsePolicyRateCollectionCliArguments(["--confirm-chart-switch", "--chart-index", "1"], {}), { chartIndex: 1, confirmChartSwitch: true });
});

test("policy-rate collection serializes chart changes, persists all currencies, and restores the chart", async () => {
  const state = { symbol: "OANDA:EURUSD", resolution: "15" };
  const saved = [];
  const tv = {
    getChartContext: async () => ({ charts: [{ index: 0, ...state, studies: [] }] }),
    setSymbol: async (symbol) => {
      if (symbol.startsWith("ECONOMICS:") && state.resolution !== "1D") throw new Error("economic symbols require daily resolution");
      state.symbol = symbol;
      return { bars: 300 };
    },
    setResolution: async (resolution) => ((state.resolution = resolution), { bars: 300 }),
    getOhlcv: async () => {
      if (state.symbol.startsWith("ECONOMICS:") && state.resolution !== "1D") throw new Error("economic symbols require daily resolution");
      return ({ symbol: state.symbol, resolution: state.resolution, bars: [
      { timeIso: "2026-06-01T00:00:00.000Z", close: 4 },
      { timeIso: "2026-06-17T00:00:00.000Z", close: 3.75 },
      { timeIso: "2026-06-30T00:00:00.000Z", close: 3.75 },
      ] });
    },
  };
  const result = await collectPolicyRates(tv, { observeMany: async (items) => (saved.push(...items), { recorded: items, unchanged: 0, revisions: 0 }) }, 0, new Date("2026-07-01T12:00:00.000Z"), { acquire: async () => async () => {} });
  assert.equal(result.status, "complete");
  assert.equal(saved.length, 8);
  assert.deepEqual(saved.map((item) => item.currency), ["USD", "EUR", "JPY", "GBP", "AUD", "NZD", "CAD", "CHF"]);
  assert.deepEqual(state, { symbol: "OANDA:EURUSD", resolution: "15" });
});
