import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FuturesOpenInterestFirstSeenStore,
  resolveFuturesOpenInterestHistoryPath,
} from "../../build/futuresOpenInterestHistory.js";

const newStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-futures-oi-"));
  const path = join(directory, "history.jsonl");
  return { store: new FuturesOpenInterestFirstSeenStore(path), path, directory };
};

const observation = (overrides = {}) => ({
  futures_symbol: "COMEX_DL:GC1!",
  scope: "all_months_aggregated",
  observation_date: "2026-07-21",
  open_interest: 383317,
  source: "tradingview_chart_indicator",
  observed_at: "2026-07-23T00:00:00.000Z",
  ...overrides,
});

test("futures open interest store writes owner-only and keeps only changed values", async () => {
  const { store, path } = await newStore();
  const first = await store.observeMany([observation()]);
  assert.equal(first.recorded.length, 1);
  assert.equal(first.recorded[0].sequence, 1);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);

  // Re-reading an unchanged series is the normal case and must not grow the log.
  const again = await store.observeMany([observation({ observed_at: "2026-07-24T00:00:00.000Z" })]);
  assert.equal(again.recorded.length, 0);
  assert.equal(again.unchanged, 1);
  assert.equal(again.revisions, 0);

  // A preliminary value later corrected is exactly what has to be kept.
  const revised = await store.observeMany([observation({
    open_interest: 383900, observed_at: "2026-07-24T12:00:00.000Z",
  })]);
  assert.equal(revised.recorded.length, 1);
  assert.equal(revised.revisions, 1);
  assert.equal(revised.recorded[0].sequence, 2);
});

test("futures open interest as-of read never returns a value observed later", async () => {
  const { store } = await newStore();
  await store.observeMany([
    observation({ observation_date: "2026-07-20", open_interest: 100, observed_at: "2026-07-22T00:00:00.000Z" }),
    observation({ observation_date: "2026-07-21", open_interest: 200, observed_at: "2026-07-23T00:00:00.000Z" }),
  ]);
  await store.observeMany([observation({
    observation_date: "2026-07-20", open_interest: 111, observed_at: "2026-07-24T00:00:00.000Z",
  })]);

  const early = await store.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "all_months_aggregated",
    asOf: new Date("2026-07-22T12:00:00.000Z"),
  });
  // Only the first observation existed at that moment; the 07-21 reading came a day later.
  assert.deepEqual(early.map((row) => [row.observation_date, row.open_interest]), [["2026-07-20", 100]]);

  const late = await store.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "all_months_aggregated",
    asOf: new Date("2026-07-25T00:00:00.000Z"),
  });
  // After the revision the same date reads 111, not the original 100.
  assert.deepEqual(late.map((row) => [row.observation_date, row.open_interest]),
    [["2026-07-20", 111], ["2026-07-21", 200]]);
});

test("futures open interest keeps front month and aggregated scopes apart", async () => {
  const { store } = await newStore();
  await store.observeMany([
    observation({ scope: "front_month", open_interest: 173687 }),
    observation({ scope: "all_months_aggregated", open_interest: 383317 }),
  ]);
  const front = await store.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "front_month", asOf: new Date("2026-07-25T00:00:00.000Z"),
  });
  const aggregated = await store.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "all_months_aggregated", asOf: new Date("2026-07-25T00:00:00.000Z"),
  });
  // These are different quantities on the same symbol and must never be merged.
  assert.equal(front[0].open_interest, 173687);
  assert.equal(aggregated[0].open_interest, 383317);
});

test("futures open interest refuses an observation dated after it was seen", async () => {
  const { store } = await newStore();
  await assert.rejects(() => store.observeMany([observation({
    observation_date: "2026-07-25", observed_at: "2026-07-23T00:00:00.000Z",
  })]), /observation_date is after first_seen_at/);
});

test("futures open interest refuses a backwards first-seen clock and duplicate batch keys", async () => {
  const { store } = await newStore();
  await store.observeMany([observation({ observed_at: "2026-07-23T00:00:00.000Z" })]);
  await assert.rejects(() => store.observeMany([observation({
    open_interest: 999, observed_at: "2026-07-22T00:00:00.000Z",
  })]), /first-seen clock moved backwards/);

  await assert.rejects(() => store.observeMany([observation(), observation({ open_interest: 5 })]),
    /duplicate futures open interest observation/);
});

test("futures open interest rejects corrupt lines and a rewritten sequence", async () => {
  const { store, path } = await newStore();
  await store.observeMany([observation()]);
  await writeFile(path, "not json\n", { mode: 0o600 });
  await assert.rejects(() => store.coverage(), /invalid futures open interest history JSON/);

  const { store: second, path: secondPath } = await newStore();
  await second.observeMany([observation()]);
  // A log whose sequence was rewritten cannot be trusted to be append-only.
  await writeFile(secondPath, `${JSON.stringify({
    schema_version: "1.0", sequence: 7, futures_symbol: "COMEX_DL:GC1!", scope: "all_months_aggregated",
    observation_date: "2026-07-21", open_interest: 1, source: "x", source_detail: null,
    first_seen_at: "2026-07-23T00:00:00.000Z",
  })}\n`, { mode: 0o600 });
  await assert.rejects(() => second.coverage(), /non-contiguous futures open interest sequence/);
});

test("futures open interest coverage reports what has actually been collected", async () => {
  const { store } = await newStore();
  await store.observeMany([
    observation({ observation_date: "2026-07-20", open_interest: 100, observed_at: "2026-07-22T00:00:00.000Z" }),
    observation({ observation_date: "2026-07-21", open_interest: 200, observed_at: "2026-07-22T00:00:00.000Z" }),
  ]);
  await store.observeMany([observation({
    observation_date: "2026-07-20", open_interest: 111, observed_at: "2026-07-24T00:00:00.000Z",
  })]);
  const coverage = await store.coverage();
  assert.equal(coverage.records, 3);
  assert.equal(coverage.series.length, 1);
  assert.equal(coverage.series[0].dates, 2);
  assert.equal(coverage.series[0].revisions, 1);
  assert.equal(coverage.series[0].earliest_date, "2026-07-20");
  assert.equal(coverage.series[0].latest_date, "2026-07-21");
  assert.equal(coverage.series[0].first_collected_at, "2026-07-22T00:00:00.000Z");
});

test("futures open interest history path falls back to the per-user directory", () => {
  assert.equal(resolveFuturesOpenInterestHistoryPath("  /tmp/custom.jsonl "), "/tmp/custom.jsonl");
  assert.match(resolveFuturesOpenInterestHistoryPath(""), /futures-open-interest-first-seen\.jsonl$/);
});
