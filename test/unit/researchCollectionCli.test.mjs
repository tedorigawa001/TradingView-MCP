import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FORWARD_SIGNAL_START, loadRequiredHistory, parseResearchCollectionCliArguments, sourceFor, summarizeResearchCollection } from "../../build/researchCollectionCli.js";

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
  assert.deepEqual(result.coverage, { chartIndex: 1, requiredBars: 500, initialBars: 300, loadedBars: 200, finalBars: 500, sufficient: true, reachBackTo: null, earliestBarAt: "2026-01-01T00:00:00.000Z", reachesBack: null, moreAvailable: true });
});

test("research collection retries a transient empty history request before declaring coverage insufficient", async () => {
  let available = 300;
  let calls = 0;
  const tv = {
    getOhlcv: async (count, chartIndex) => ({ symbol: "OANDA:EURUSD", resolution: "50", chartIndex,
      bars: Array.from({ length: Math.min(count, available) }, (_, index) => ({ timeIso: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z` })) }),
    loadMoreHistory: async ({ count }) => {
      calls += 1;
      if (calls === 1) return { added: 0, moreAvailable: false };
      available += count;
      return { added: count, moreAvailable: true };
    },
  };
  const result = await loadRequiredHistory(tv, 0, 500);
  assert.equal(calls, 2);
  assert.deepEqual(result.coverage, { chartIndex: 0, requiredBars: 500, initialBars: 300, loadedBars: 200, finalBars: 500, sufficient: true, reachBackTo: null, earliestBarAt: "2026-01-01T00:00:00.000Z", reachesBack: null, moreAvailable: true });
});

test("research collection accumulates partial history loads until the requested coverage is reached", async () => {
  let available = 300;
  const tv = {
    getOhlcv: async (count, chartIndex) => ({ symbol: "OANDA:EURUSD", resolution: "15", chartIndex,
      bars: Array.from({ length: Math.min(count, available) }, (_, index) => ({ timeIso: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z` })) }),
    loadMoreHistory: async ({ count }) => {
      const added = Math.min(count, 100);
      available += added;
      return { added, moreAvailable: available < 500 };
    },
  };
  const result = await loadRequiredHistory(tv, 0, 500);
  assert.deepEqual(result.coverage, { chartIndex: 0, requiredBars: 500, initialBars: 300, loadedBars: 200, finalBars: 500, sufficient: true, reachBackTo: null, earliestBarAt: "2026-01-01T00:00:00.000Z", reachesBack: null, moreAvailable: false });
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

test("research collection source evidence retains each collector's requested bar count", () => {
  const history = { bars: [
    { timeIso: "2026-01-01T00:00:00.000Z" },
    { timeIso: "2026-01-01T01:00:00.000Z", forming: true },
    { timeIso: "2026-01-01T02:00:00.000Z" },
  ] };
  assert.deepEqual(sourceFor(history, 1, 1000), {
    chartIndex: 1, requestedBars: 1000, returnedBars: 3, closedBars: 2,
    from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T02:00:00.000Z",
  });
});

test("research collection distinguishes successful transport from partial research evidence", () => {
  const summary = summarizeResearchCollection([
    { status: "complete", value: { status: "partial" } },
    { status: "complete", value: { status: "complete" } },
  ], "/tmp/research.jsonl", 1);
  assert.equal(summary.collection_status, "complete");
  assert.equal(summary.research_status, "partial");
  assert.equal(summary.status, "partial");
});

const BAR_MS = 900_000;
function pagingTv(oldestIso, spacingMs = BAR_MS) {
  // A provider that hands over 300 bars and pages backwards 1000 at a time until it hits its floor.
  let available = 300;
  const floor = 5000;
  const bars = (count) => {
    const n = Math.min(count, available);
    const newest = Date.parse("2026-08-08T00:00:00.000Z");
    return Array.from({ length: n }, (_, i) => ({
      timeIso: new Date(newest - (n - 1 - i) * spacingMs).toISOString(),
      open: 1, high: 1, low: 1, close: 1, volume: 1,
    }));
  };
  return {
    getOhlcv: async (count) => ({ symbol: "OANDA:EURUSD", resolution: "15", count, bars: bars(count) }),
    loadMoreHistory: async (options) => {
      const before = available;
      available = Math.min(floor, available + options.count);
      return { requested: options.count, barsBefore: before, barsAfter: available, added: available - before, earliestTime: 1, moreAvailable: available < floor };
    },
    oldestIso,
  };
}

test("a window that no longer reaches the forward start is refused, not reported as sufficient", async () => {
  // The signal start sits further back than the provider can page to. Counting bars alone would call
  // this sufficient, and the study would then drop its earliest forward signals with nothing saying so.
  const tv = pagingTv();
  const tooOld = "2020-01-01T00:00:00.000Z";
  const result = await loadRequiredHistory(tv, 0, 500, tooOld);
  assert.ok(result.history.bars.length >= 500, "bar count alone is satisfied");
  assert.equal(result.coverage.reachesBack, false);
  assert.equal(result.coverage.sufficient, false, "reach-back failure must fail the coverage gate");
  assert.equal(result.coverage.reachBackTo, tooOld);
  assert.ok(result.coverage.earliestBarAt > tooOld);
});

test("a window that does reach the forward start is sufficient, and keeps paging to get there", async () => {
  const tv = pagingTv();
  // Reachable only after paging well past the 500 bars the count asks for.
  const reachable = new Date(Date.parse("2026-08-08T00:00:00.000Z") - 3000 * BAR_MS).toISOString();
  const result = await loadRequiredHistory(tv, 0, 500, reachable);
  assert.equal(result.coverage.reachesBack, true);
  assert.equal(result.coverage.sufficient, true);
  assert.ok(result.coverage.finalBars > 500, `expected paging beyond the bar count, got ${result.coverage.finalBars}`);
  assert.ok(result.coverage.earliestBarAt <= reachable);
});

test("without a forward start the loader behaves exactly as before", async () => {
  const result = await loadRequiredHistory(pagingTv(), 0, 500);
  assert.equal(result.coverage.reachBackTo, null);
  assert.equal(result.coverage.reachesBack, null);
  assert.equal(result.coverage.sufficient, true);
  assert.equal(result.coverage.finalBars, 500);
});

test("each forward hypothesis names its start once, and the study and the window read the same one", async () => {
  const source = await readFile(new URL("../../src/researchCollectionCli.ts", import.meta.url), "utf8");
  for (const [id, start] of Object.entries(FORWARD_SIGNAL_START)) {
    assert.match(start, /^\d{4}-\d{2}-\d{2}T/);
    // The literal must not reappear anywhere else, or the two uses can drift apart again.
    assert.equal(source.split(`"${start}"`).length - 1, 1, `${id} start appears more than once`);
  }
  assert.equal(source.includes("signalFrom: FORWARD_SIGNAL_START["), true);
});
