import test from "node:test";
import assert from "node:assert/strict";
import { loadRequiredHistory, parseResearchCollectionCliArguments } from "../../build/researchCollectionCli.js";

test("research collection CLI requires an explicit chart-switch confirmation", () => {
  assert.throws(() => parseResearchCollectionCliArguments([], {}), /chart switching is disabled/);
  assert.deepEqual(
    parseResearchCollectionCliArguments(["--confirm-chart-switch", "--output-path", "/tmp/research.jsonl"], {}),
    { confirmChartSwitch: true, outputPath: "/tmp/research.jsonl" },
  );
});

test("research collection loads only the missing history and reports its coverage", async () => {
  let available = 300;
  const calls = [];
  const tv = {
    getOhlcv: async (count, chartIndex) => ({ symbol: "OANDA:EURUSD", resolution: "50", chartIndex, bars: Array.from({ length: Math.min(count, available) }, (_, index) => ({ timeIso: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z` })) }),
    loadMoreHistory: async ({ count, chartIndex }) => { calls.push({ count, chartIndex }); available += count; return { added: count, moreAvailable: true }; },
  };
  const result = await loadRequiredHistory(tv, 1, 500);
  assert.deepEqual(calls, [{ count: 200, chartIndex: 1 }]);
  assert.deepEqual(result.coverage, { chartIndex: 1, requiredBars: 500, initialBars: 300, loadedBars: 200, finalBars: 500, sufficient: true, moreAvailable: true });
});

test("research collection reports an already sufficient chart without loading more history", async () => {
  const tv = {
    getOhlcv: async (count, chartIndex) => ({ symbol: "OANDA:EURUSD", resolution: "50", chartIndex, bars: Array.from({ length: count }, (_, index) => ({ timeIso: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z` })) }),
    loadMoreHistory: async () => { throw new Error("must not load"); },
  };
  const result = await loadRequiredHistory(tv, 0, 500);
  assert.equal(result.coverage.sufficient, true);
  assert.equal(result.coverage.loadedBars, 0);
});
