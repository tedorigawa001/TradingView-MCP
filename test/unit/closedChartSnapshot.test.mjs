import test from "node:test";
import assert from "node:assert/strict";
import { buildClosedChartSnapshot } from "../../build/closedChartSnapshot.js";

const cutoff = new Date("2026-10-21T12:00:00Z");
const initial = { layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
  { index: 0, symbol: "PEPPERSTONE:MXNJPY", resolution: "240", studies: [{ id: "a", name: "MA" }] },
  { index: 1, symbol: "OANDA:XAUUSD", resolution: "1D", studies: [{ id: "b", name: "MA" }] },
] };
const options = { targets: initial.charts.map((c) => ({ chartIndex: c.index, symbol: c.symbol,
  expectedTimeframe: c.resolution })), confirm: true, count: 201, recentCount: 40 };
function fixture(hooks = {}) {
  const context = structuredClone(initial), calls = [], changes = [];
  let quoteCalls = 0, replay = false;
  const tv = {
    async getChartContext() { return structuredClone(context); },
    async getReplayStatus() { return { available: true, started: replay, toolbarVisible: false }; },
    async setResolution(tf, index) {
      changes.push([index, tf]);
      const pane = context.charts[index];
      if (hooks.failRestore && tf === initial.charts[index].resolution && pane.resolution !== tf) throw new Error("restore failed");
      pane.resolution = tf; context.activeChartIndex = index;
      if (hooks.note === tf) return { note: "timeout" };
      return {};
    },
    async getOhlcv(count, index) {
      const pane = context.charts[index]; calls.push([index, pane.resolution]);
      if (hooks.failRead === pane.resolution) throw new Error("read failed");
      const step = pane.resolution === "1D" ? 86400 : Number(pane.resolution) * 60;
      const result = { symbol: pane.symbol, resolution: pane.resolution, count, bars: Array.from({ length: count }, (_, i) => {
        const time = cutoff.getTime() / 1000 - (count - 1 - i) * step;
        return { time, timeIso: new Date(time * 1000).toISOString(), open: 100 + i, high: 101 + i,
          low: 99 + i, close: 100 + i, volume: 1, forming: i === count - 1 };
      }) };
      if (hooks.drift && pane.resolution === "15") hooks.drift(context);
      if (hooks.replayDuringRead && pane.resolution === "15") replay = true;
      if (hooks.mismatch && pane.resolution === "15") result.symbol = "FX:OTHER";
      if (hooks.afterRead) hooks.afterRead(result);
      return result;
    },
  };
  const quotes = async () => {
    quoteCalls++;
    if (hooks.quoteError) throw new Error("quote unavailable");
    if (hooks.quoteDrift) hooks.quoteDrift(context);
    return { status: hooks.quoteWait ? "wait" : "ready", observed_at: "2026-10-21T12:00:02Z" };
  };
  return { tv, quotes, context, calls, changes, quoteCount: () => quoteCalls };
}
const run = (f, patch = {}, clock = () => cutoff) => buildClosedChartSnapshot(f.tv, f.quotes, { ...options, ...patch }, clock);

test("batch shares one cutoff, returns bounded confirmed OHLC and restores every pane and selection", async () => {
  const f = fixture(); let tick = cutoff.getTime();
  const r = await run(f, {}, () => new Date(tick++));
  assert.equal(r.status, "complete"); assert.equal(r.restoration.verified, true);
  assert.deepEqual(f.context, initial); assert.equal(f.quoteCount(), 1);
  assert.equal(r.price_basis, "unknown"); assert.equal(r.candidateEligible, false);
  assert.deepEqual(f.changes, [[0,"15"],[0,"60"],[0,"240"],[1,"15"],[1,"60"],[1,"1D"],[0,"15"],[0,"240"]]);
  for (const p of r.panes) for (const s of [p.original, ...p.series]) {
    assert.equal(s.as_of, r.as_of); assert.equal(s.close, 299); assert.equal(s.history.closed_bars_used, 200);
    assert.equal(s.recent_closed_bars.length, 40);
    assert.equal(s.recent_closed_bars.at(-1).confirmed_at, cutoff.toISOString());
    assert.ok(s.observed_at >= r.as_of);
    assert.equal(s.recent_closed_bars.at(-1).close, 299);
  }
  assert.notEqual(r.execution.observed_at, r.as_of);
});

test("preview reads neither OHLC nor quotes and never changes selection", async () => {
  const f = fixture(); const r = await run(f, { confirm: false });
  assert.equal(r.status, "confirmation_required"); assert.deepEqual(f.calls, []);
  assert.deepEqual(f.changes, []); assert.equal(f.quoteCount(), 0);
});

test("initial active, unavailable or unreadable Replay refuses acquisition before any mutation", async () => {
  for (const state of ["active", "unavailable", "throws"]) {
    const f = fixture();
    f.tv.getReplayStatus = async () => {
      if (state === "throws") throw new Error("Replay transport failure");
      return { available: state !== "unavailable", started: state === "active", toolbarVisible: false };
    };
    await assert.rejects(run(f), /Replay/);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.changes, []); assert.equal(f.quoteCount(), 0);
  }
});

test("validates exact listing, selected target and limits before mutations", async () => {
  for (const patch of [{ targets: [] }, { targets: [options.targets[0], options.targets[0]] },
    { targets: [{ ...options.targets[0], symbol: "MXNJPY" }] },
    { targets: [{ ...options.targets[0], symbol: "OANDA:MXNJPY" }] },
    { targets: [options.targets[1]] }, { timeframes: ["15", "15"] }, { timeframes: ["1M"] },
    { count: 1 }, { count: 1001 }, { recentCount: 201 }]) {
    const f = fixture(); await assert.rejects(run(f, patch));
    assert.deepEqual(f.changes, []); assert.deepEqual(f.calls, []); assert.equal(f.quoteCount(), 0);
  }
});

test("manual changes in any pane, Study IDs or selection block evidence without overwriting the edit", async () => {
  for (const drift of [
    (c) => { c.charts[0].symbol = "OANDA:USDJPY"; },
    (c) => { c.charts[1].resolution = "30"; },
    (c) => { c.charts[1].studies.push({ id: "manual", name: "Manual" }); },
    (c) => { c.activeChartIndex = 1; },
  ]) {
    const f = fixture({ drift }); const r = await run(f);
    assert.equal(r.status, "blocked"); assert.deepEqual(r.panes, []); assert.equal(f.quoteCount(), 0);
    assert.deepEqual(f.changes, [[0, "15"]]); assert.equal(r.restoration.verified, false);
  }
});

test("read failures restore the touched pane and stop the rest of the batch", async () => {
  const f = fixture({ failRead: "60" }); const r = await run(f);
  assert.equal(r.status, "partial"); assert.equal(r.restoration.verified, true);
  assert.deepEqual(f.context, initial); assert.equal(r.panes.length, 1);
  assert.deepEqual(f.changes, [[0,"15"],[0,"60"],[0,"240"]]);
});

test("restore failure stops all later reads and quotes and discards collected evidence", async () => {
  const f = fixture({ failRestore: true }); const r = await run(f);
  assert.equal(r.status, "blocked"); assert.equal(r.restoration.verified, false);
  assert.deepEqual(r.panes, []); assert.equal(f.quoteCount(), 0);
  assert.ok(f.calls.every(([index]) => index === 0));
});

test("readiness timeouts never produce evidence; restore timeout stays blocked", async () => {
  for (const note of ["15", "240"]) {
    const f = fixture({ note }); const r = await run(f);
    assert.equal(r.status, note === "15" ? "partial" : "blocked");
    assert.equal(r.restoration.verified, note === "15");
    assert.ok(!f.calls.some(([, tf]) => tf === "15") || note === "240");
  }
});

test("Replay beginning during a read permits only restoring owned state, then blocks evidence", async () => {
  const f = fixture({ replayDuringRead: true }); const r = await run(f);
  assert.equal(r.status, "blocked"); assert.equal(r.restoration.verified, true);
  assert.deepEqual(f.context, initial); assert.deepEqual(f.changes, [[0,"15"],[0,"240"]]);
  assert.equal(f.quoteCount(), 0); assert.deepEqual(r.panes, []);
});

test("mismatched OHLC is not exposed and the original layout is restored", async () => {
  const f = fixture({ mismatch: true }); const r = await run(f);
  assert.equal(r.status, "partial"); assert.deepEqual(f.context, initial);
  assert.deepEqual(r.panes[0].series, []);
});

test("a transient Replay status exception blocks all evidence even if later reads recover", async () => {
  const f = fixture(); const original = f.tv.getReplayStatus;
  let failed = false;
  f.tv.getReplayStatus = async () => {
    if (!failed && f.calls.some(([, tf]) => tf === "15")) {
      failed = true; throw new Error("temporary Replay transport failure");
    }
    return original();
  };
  const r = await run(f);
  assert.equal(r.status, "blocked"); assert.deepEqual(r.panes, []);
  assert.equal(f.quoteCount(), 0); assert.deepEqual(f.context, initial);
});

test("selection round-trip timeout still restores its owned timeframe before blocking evidence", async () => {
  const f = fixture(); const original = f.tv.setResolution;
  f.tv.setResolution = async (tf, index) => {
    const result = await original(tf, index);
    if (index === 0 && tf === "15" && f.calls.some(([i]) => i === 1)) return { note: "selection timeout" };
    return result;
  };
  const r = await run(f);
  assert.equal(r.status, "blocked"); assert.deepEqual(r.panes, []);
  assert.equal(f.quoteCount(), 0); assert.deepEqual(f.context, initial);
});

test("quote failure/wait leaves confirmed evidence partial; drift while quoting invalidates it", async () => {
  for (const hooks of [{ quoteError: true }, { quoteWait: true }, { quoteDrift: (c) => { c.charts[1].studies = []; } }]) {
    const f = fixture(hooks); const r = await run(f);
    assert.equal(r.status, hooks.quoteDrift ? "blocked" : "partial");
    assert.equal(r.panes.length, hooks.quoteDrift ? 0 : 2);
  }
});

test("future bars and forming suffix never enter returned confirmed OHLC", async () => {
  const f = fixture({ afterRead: (r) => {
    r.bars.at(-1).high = r.bars.at(-1).close = 9999;
    const time = r.bars.at(-1).time + 86400;
    r.bars.push({ ...r.bars.at(-1), time, timeIso: new Date(time * 1000).toISOString() });
  } });
  const r = await run(f); assert.equal(r.status, "complete");
  assert.ok(r.panes.every((p) => p.series.every((s) => s.close === 299 && s.recent_closed_bars.at(-1).close === 299)));
});
