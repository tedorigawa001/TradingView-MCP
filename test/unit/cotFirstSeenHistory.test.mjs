import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CotFirstSeenStore } from "../../build/cotFirstSeenHistory.js";
import { CotClient } from "../../build/cot.js";

const version = (overrides = {}) => ({
  symbol: "OANDA:EURUSD",
  observation_date: "2026-07-21",
  value: { open_interest: 800061, positions: [{ group: "lev_money", net: -56671 }] },
  observed_at: "2026-07-24T19:30:00.000Z",
  ...overrides,
});

test("CotFirstSeenStore retains the original observation and appends revisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-cot-first-seen-"));
  const path = join(dir, "history.jsonl");
  const store = new CotFirstSeenStore(path);
  const first = (await store.observeMany([version()]))[0];
  const same = (await store.observeMany([version({ observed_at: "2026-07-25T19:30:00.000Z" })]))[0];
  const revised = (await store.observeMany([version({ value: { open_interest: 800062 }, observed_at: "2026-07-26T19:30:00.000Z" })]))[0];
  assert.equal(same.sequence, first.sequence);
  assert.equal(revised.sequence, 2);
  assert.equal(first.first_seen_at, "2026-07-24T19:30:00.000Z");
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 2);
  assert.deepEqual(await store.coverage(), {
    records: 2,
    series: [{
      symbol: "OANDA:EURUSD",
      dates: 1,
      revisions: 1,
      earliest_date: "2026-07-21",
      latest_date: "2026-07-21",
      first_collected_at: "2026-07-24T19:30:00.000Z",
    }],
  });
});

test("CotFirstSeenStore rejects duplicate dates and clock regression", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-cot-first-seen-"));
  const store = new CotFirstSeenStore(join(dir, "history.jsonl"));
  await assert.rejects(() => store.observeMany([version(), version()]), /duplicate/);
  await store.observeMany([version()]);
  await assert.rejects(() => store.observeMany([version({ value: { revised: true }, observed_at: "2026-07-23T19:30:00.000Z" })]), /clock moved backwards/);
});

// BACKLOG 102-29: a run takes its observation time before it waits for the lock, so another process (the MCP server)
// may append, with a later time, while it waits. Only a version that will be appended has to be later than the log's
// last; one already recorded unchanged is returned as it is, whatever time the run took.
test("CotFirstSeenStore returns versions already recorded even when another writer appended later meanwhile", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-cot-first-seen-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "history.jsonl");
  const collection = new CotFirstSeenStore(path);
  const recorded = await collection.observeMany([version(), version({ symbol: "OANDA:XAUUSD" })]);
  // Another process records a different series with a later time.
  await new CotFirstSeenStore(path).observeMany([version({ symbol: "OANDA:USDJPY", observed_at: "2026-07-24T20:00:00.000Z" })]);
  // The run, with its earlier time, finds both of its versions unchanged.
  const again = await collection.observeMany([version({ observed_at: "2026-07-24T19:45:00.000Z" }),
    version({ symbol: "OANDA:XAUUSD", observed_at: "2026-07-24T19:45:00.000Z" })]);
  assert.deepEqual(again, recorded);
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 3, "nothing was appended");
  // A version that would be appended with a time before the log's last is still refused, and nothing of the batch is
  // written, the unchanged one included.
  await assert.rejects(() => collection.observeMany([version({ observed_at: "2026-07-24T19:45:00.000Z" }),
    version({ symbol: "OANDA:XAUUSD", value: { revised: true }, observed_at: "2026-07-24T19:45:00.000Z" })]), /clock moved backwards/);
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 3);
  // Nor when the refused version comes after one that could be appended: the check runs before any append.
  await assert.rejects(() => collection.observeMany([version({ symbol: "OANDA:XAUUSD", value: { revised: true }, observed_at: "2026-07-24T20:30:00.000Z" }),
    version({ value: { revised: true }, observed_at: "2026-07-24T19:45:00.000Z" })]), /clock moved backwards/);
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 3);
  // At or after the log's last time, a revision is appended.
  const revised = await collection.observeMany([version({ symbol: "OANDA:XAUUSD", value: { revised: true }, observed_at: "2026-07-24T20:00:00.000Z" })]);
  assert.equal(revised[0].sequence, 4);
});

test("a COT fetch whose rows are all recorded keeps their first-seen times when the server wrote later meanwhile (102-29)", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-cot-first-seen-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = http.createServer((_req, res) => res.end(JSON.stringify([{
    market_and_exchange_names: "EURO FX", cftc_contract_market_code: "099741", report_date_as_yyyy_mm_dd: "2026-07-07",
    open_interest_all: "100", dealer_positions_long_all: "20", dealer_positions_short_all: "30",
  }])));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const path = join(dir, "cot.jsonl");
  const client = new CotClient(`http://127.0.0.1:${server.address().port}`, 15_000, new CotFirstSeenStore(path));
  const first = await client.getHistory("OANDA:EURUSD", 1);
  assert.match(first.observations[0].available_at, /^\d{4}-/);
  // The server records another series an hour ahead of this run's clock.
  await new CotFirstSeenStore(path).observeMany([version({ symbol: "OANDA:USDJPY", observed_at: new Date(Date.now() + 3_600_000).toISOString() })]);
  const again = await client.getHistory("OANDA:EURUSD", 1);
  assert.equal(again.first_seen_error, null);
  assert.equal(again.observations[0].available_at, first.observations[0].available_at);
});
