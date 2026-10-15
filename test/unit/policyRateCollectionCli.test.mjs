import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPolicyRates, parsePolicyRateCollectionCliArguments, PolicyRateHeartbeatError, printPolicyRateCollection } from "../../build/policyRateCollectionCli.js";
import { PolicyRateCollectionHeartbeatStore } from "../../build/policyRateCollectionHeartbeat.js";

test("policy-rate collection requires explicit chart switching consent", () => {
  assert.throws(() => parsePolicyRateCollectionCliArguments([], {}), /chart switching is disabled/);
  assert.deepEqual(parsePolicyRateCollectionCliArguments(["--confirm-chart-switch", "--chart-index", "1"], {}), { chartIndex: 1, confirmChartSwitch: true });
});

test("policy-rate collection serializes chart changes, persists all currencies, and restores the chart", async () => {
  const state = { symbol: "OANDA:EURUSD", resolution: "15" };
  const saved = [];
  const heartbeats = [];
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
  const result = await collectPolicyRates(tv, { observeMany: async (items) => (saved.push(...items), { recorded: items, unchanged: 0, revisions: 0 }) }, { recordRun: async (run) => (heartbeats.push(run), { sequence: 1, first_seen_at: run.observed_at }) }, 0, new Date("2026-07-01T12:00:00.000Z"), { acquire: async () => async () => {} });
  assert.equal(result.status, "complete");
  assert.equal(saved.length, 8);
  assert.deepEqual(saved.map((item) => item.currency), ["USD", "EUR", "JPY", "GBP", "AUD", "NZD", "CAD", "CHF"]);
  assert.equal(heartbeats.length, 1);
  assert.equal(heartbeats[0].currencies.length, 8);
  assert.deepEqual(result.heartbeat, { sequence: 1, recorded_at: "2026-07-01T12:00:00.000Z" });
  assert.deepEqual(state, { symbol: "OANDA:EURUSD", resolution: "15" });
});

test("a run whose heartbeat is refused still prints its result, with heartbeat null, and fails with the heartbeat's error (BACKLOG 102-36 review)", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-heartbeat-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const heartbeatPath = join(directory, "policy-rate-collection-heartbeats.jsonl");
  const heartbeats = new PolicyRateCollectionHeartbeatStore(heartbeatPath);
  const state = { symbol: "OANDA:EURUSD", resolution: "15" };
  const tv = {
    getChartContext: async () => ({ charts: [{ index: 0, ...state, studies: [] }] }),
    setSymbol: async (symbol) => ((state.symbol = symbol), { bars: 300 }),
    setResolution: async (resolution) => ((state.resolution = resolution), { bars: 300 }),
    getOhlcv: async () => ({ symbol: state.symbol, resolution: state.resolution, bars: [{ timeIso: "2026-06-01T00:00:00.000Z", close: 4 }, { timeIso: "2026-06-17T00:00:00.000Z", close: 3.75 },
      { timeIso: "2026-06-30T00:00:00.000Z", close: 3.75 }] }),
  };
  const saved = [];
  const store = { observeMany: async (items) => (saved.push(...items), { recorded: items, unchanged: 0, revisions: 0 }) };
  let released = 0;
  const lock = { acquire: async () => async () => { released += 1; } };
  const lines = [];
  const write = (line) => lines.push(line);
  await printPolicyRateCollection(() => collectPolicyRates(tv, store, heartbeats, 0, new Date("2026-07-01T12:00:00.000Z"), lock), write);
  assert.deepEqual(JSON.parse(lines[0]).heartbeat, { sequence: 1, recorded_at: "2026-07-01T12:00:00.000Z" });
  // A run that took its time before the latest heartbeat: its values are written, its heartbeat is refused.
  const before = await readFile(heartbeatPath);
  const run = () => collectPolicyRates(tv, store, heartbeats, 0, new Date("2026-07-01T11:59:59.999Z"), lock);
  await assert.rejects(run, (error) => error instanceof PolicyRateHeartbeatError && /policy-rate collection heartbeat first-seen clock moved backwards/.test(error.message)
    && error.result.heartbeat === null && error.result.first_seen.recorded === 8 && error.result.observations.length === 8);
  await assert.rejects(() => printPolicyRateCollection(run, write), /policy-rate collection heartbeat first-seen clock moved backwards/);
  assert.equal(lines.length, 2);
  const printed = JSON.parse(lines[1]);
  assert.deepEqual(Object.keys(printed), ["observed_at", "status", "observations", "first_seen", "heartbeat"]);
  assert.deepEqual([printed.observed_at, printed.status, printed.first_seen, printed.heartbeat], ["2026-07-01T11:59:59.999Z", "complete", { recorded: 8, unchanged: 0, revisions: 0 }, null]);
  assert.equal(saved.length, 24);
  assert.deepEqual(await readFile(heartbeatPath), before);
  assert.deepEqual([state, released], [{ symbol: "OANDA:EURUSD", resolution: "15" }, 3]);
  // Any other failure prints nothing.
  await assert.rejects(() => printPolicyRateCollection(async () => { throw new Error("chart failed"); }, write), /chart failed/);
  assert.equal(lines.length, 2);
});
