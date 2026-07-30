import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FuturesOpenInterestFirstSeenStore,
  futuresSessionObservationDate,
  resolveFuturesOpenInterestHistoryPath,
  resolveFuturesOpenInterestV2HistoryPath,
  resolveLegacyFuturesOpenInterestHistoryPath,
} from "../../build/futuresOpenInterestHistory.js";
import { migrateFuturesOpenInterestDates } from "../../build/futuresOpenInterestMigration.js";
import { migrateFuturesOpenInterestCmeCleanup } from "../../build/futuresOpenInterestCmeCleanupMigration.js";

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

test("futures open interest retains preliminary and final status even when the value is unchanged", async () => {
  const { store } = await newStore();
  await store.observeMany([observation({ report_status: "preliminary" })]);
  const final = await store.observeMany([observation({ report_status: "final", observed_at: "2026-07-24T12:00:00.000Z" })]);
  assert.equal(final.recorded.length, 1);
  assert.equal(final.revisions, 1);
  const preliminary = await store.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "all_months_aggregated", asOf: new Date("2026-07-23T12:00:00.000Z"),
  });
  const settled = await store.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "all_months_aggregated", asOf: new Date("2026-07-25T00:00:00.000Z"),
  });
  assert.equal(preliminary[0].report_status, "preliminary");
  assert.equal(settled[0].report_status, "final");
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

test("futures open interest keeps an exchange aggregate separate from a chart-built basket", async () => {
  const { store } = await newStore();
  await store.observeMany([
    observation({ open_interest: 379963, source: "tradingview_chart_indicator", source_detail: "gc_basket_12_contracts" }),
    observation({ open_interest: 383368, source: "cme_daily_bulletin", source_detail: "GC_FUT" }),
  ]);
  const exchange = await store.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "all_months_aggregated",
    source: "cme_daily_bulletin", sourceDetail: "GC_FUT", asOf: new Date("2026-07-25T00:00:00.000Z"),
  });
  const chart = await store.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "all_months_aggregated",
    source: "tradingview_chart_indicator", sourceDetail: "gc_basket_12_contracts", asOf: new Date("2026-07-25T00:00:00.000Z"),
  });
  assert.equal(exchange[0].open_interest, 383368);
  assert.equal(chart[0].open_interest, 379963);
  const coverage = await store.coverage();
  assert.equal(coverage.series.length, 2);
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

test("futures OI date migration preserves first-seen history while shifting session dates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-futures-oi-migration-"));
  const source = new FuturesOpenInterestFirstSeenStore(join(directory, "legacy.jsonl"));
  const destination = new FuturesOpenInterestFirstSeenStore(join(directory, "v2.jsonl"));
  await source.observeMany([observation({
    observation_date: "2026-07-19", open_interest: 100, observed_at: "2026-07-21T00:00:00.000Z",
  })]);
  await source.observeMany([observation({
    observation_date: "2026-07-19", open_interest: 110, observed_at: "2026-07-22T00:00:00.000Z",
  })]);

  assert.deepEqual(await migrateFuturesOpenInterestDates({ source, destination }), {
    source_records: 2, migrated: 2, unchanged: 0, revisions: 1,
  });
  assert.deepEqual(await destination.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "all_months_aggregated", asOf: new Date("2026-07-23T00:00:00.000Z"),
  }), [{ observation_date: "2026-07-20", open_interest: 110, report_status: null, first_seen_at: "2026-07-22T00:00:00.000Z" }]);
  assert.deepEqual(await migrateFuturesOpenInterestDates({ source, destination }), {
    source_records: 2, migrated: 0, unchanged: 2, revisions: 0,
  });
});

test("futures OI CME cleanup migration removes only the known malformed parser record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-futures-oi-cme-cleanup-"));
  const source = new FuturesOpenInterestFirstSeenStore(join(directory, "v2.jsonl"));
  const destination = new FuturesOpenInterestFirstSeenStore(join(directory, "v3.jsonl"));
  await source.observeMany([observation({ open_interest: 379963, observed_at: "2026-07-25T00:00:00.000Z" })]);
  await source.observeMany([observation({
    observation_date: "2026-07-24", open_interest: 12136, source: "cme_daily_bulletin", source_detail: "GC_FUT",
    observed_at: "2026-07-26T22:43:36.668Z",
  })]);
  await source.observeMany([observation({
    observation_date: "2026-07-24", open_interest: 376079, source: "cme_daily_bulletin", source_detail: "GC_FUT",
    observed_at: "2026-07-26T22:50:20.177Z",
  })]);
  assert.deepEqual(await migrateFuturesOpenInterestCmeCleanup({ source, destination }), {
    source_records: 3, migrated: 2, unchanged: 0, revisions: 0, discarded_malformed_cme_records: 1,
  });
  const official = await destination.getSeriesAsOf({
    futuresSymbol: "COMEX_DL:GC1!", scope: "all_months_aggregated", source: "cme_daily_bulletin", sourceDetail: "GC_FUT",
    asOf: new Date("2026-07-27T00:00:00.000Z"),
  });
  assert.deepEqual(official, [{ observation_date: "2026-07-24", open_interest: 376079, report_status: null, first_seen_at: "2026-07-26T22:50:20.177Z" }]);
});

test("futures open interest history path falls back to the per-user directory", () => {
  assert.equal(resolveFuturesOpenInterestHistoryPath("  /tmp/custom.jsonl "), "/tmp/custom.jsonl");
  assert.match(resolveFuturesOpenInterestHistoryPath(""), /futures-open-interest-first-seen-v3\.jsonl$/);
  assert.match(resolveFuturesOpenInterestV2HistoryPath(""), /futures-open-interest-first-seen-v2\.jsonl$/);
  assert.match(resolveLegacyFuturesOpenInterestHistoryPath(""), /futures-open-interest-first-seen\.jsonl$/);
});

test("futures session observation date resolves the exchange trading date under both US offsets", () => {
  // EDT: the session opens 18:00 ET = 22:00 UTC on the previous calendar day. The bar stamped
  // Thursday evening is Friday's trading date, which is why the log used to hold no Fridays.
  assert.equal(futuresSessionObservationDate("2026-07-23T22:00:00.000Z"), "2026-07-24");
  // EST: the same 18:00 ET open lands at 23:00 UTC.
  assert.equal(futuresSessionObservationDate("2026-01-15T23:00:00.000Z"), "2026-01-16");
  // Sunday evening opens Monday's trading date; a Sunday date in the log is the old defect.
  assert.equal(futuresSessionObservationDate("2025-07-27T22:00:00.000Z"), "2025-07-28");
});

test("futures session observation date accepts only the two CME evening open hours", () => {
  // 17:00 CT is 22:00 UTC under CDT and 23:00 UTC under CST. Nothing else can be shifted a day and
  // still name the right session, and the store's observation_date <= first_seen_at check cannot
  // see a date that is early by a day, so every other stamping convention must fail closed.
  const rejected = /does not open a CME evening session/;
  assert.throws(() => futuresSessionObservationDate("2026-07-24T00:00:00.000Z"), rejected);
  assert.throws(() => futuresSessionObservationDate("2026-07-24T11:59:59.000Z"), rejected);
  assert.throws(() => futuresSessionObservationDate("2026-07-24T12:00:00.000Z"), rejected);
  // A feed stamping the bar an hour before the CME open is the case a "sometime in the evening"
  // check would have waved through while shifting it to the wrong trading date.
  assert.throws(() => futuresSessionObservationDate("2026-07-24T21:00:00.000Z"), rejected);
  assert.equal(futuresSessionObservationDate("2026-07-24T22:00:00.000Z"), "2026-07-25");
  assert.equal(futuresSessionObservationDate("2026-07-24T23:00:00.000Z"), "2026-07-25");
  assert.throws(() => futuresSessionObservationDate("2026-07-24"), /canonical timestamp/);
});
