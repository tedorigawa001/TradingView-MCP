import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateBookmapFlowByReceiptInterval,
  parseBookmapFlowSession,
  preflightBookmapFlowPriceJoin,
} from "../../build/bookmapFlow.js";

function row(event_type, received_at, fields = {}) {
  return JSON.stringify({
    schema_version: "1.1", source: "bookmap", event_type, instrument_alias: "6EQ6.CME@BMD",
    bookmap_time_ns: "1780000000000000001", received_at, ...fields,
  });
}

function session(rows) {
  return parseBookmapFlowSession(`${rows.join("\n")}\n`, "bookmap-flow-6EQ6.CME_BMD-1.jsonl");
}

test("Bookmap receipt aggregation retains an unknown aggressor as unknown rather than sell", () => {
  const parsed = session([
    row("instrument", "2026-08-10T00:00:01.000Z", { symbol: "6EQ6", exchange: "CME", is_full_depth: true, mbo_captured: false, is_crypto: false }),
    row("snapshot_end", "2026-08-10T00:00:02.000Z"),
    row("trade", "2026-08-10T00:00:10.000Z", { aggressor: "buy", size: 3 }),
    row("trade", "2026-08-10T00:00:20.000Z", { aggressor: "unknown", size: 4 }),
    row("depth", "2026-08-10T00:00:30.000Z", { side: "bid", size: 5 }),
  ]);
  const intervals = aggregateBookmapFlowByReceiptInterval(parsed, 60);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].trades, 2);
  assert.equal(intervals[0].unknown_aggressor_trades, 1);
  assert.equal(intervals[0].trade_delta, null);
  assert.equal(intervals[0].depth_updates, 1);
});

test("Bookmap price preflight uses an exact interval-end join and never forward fills", () => {
  const parsed = session([
    row("instrument", "2026-08-10T00:00:01.000Z", { symbol: "6EQ6", exchange: "CME", is_full_depth: true, mbo_captured: false, is_crypto: false }),
    row("snapshot_end", "2026-08-10T00:00:02.000Z"),
    row("trade", "2026-08-10T00:00:10.000Z", { aggressor: "buy", size: 3 }),
  ]);
  const intervals = aggregateBookmapFlowByReceiptInterval(parsed, 60);
  const result = preflightBookmapFlowPriceJoin({
    session: parsed, intervals,
    targetBars: [
      { time: Date.parse("2026-08-10T00:01:00.000Z") / 1_000, timeIso: "2026-08-10T00:01:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: Date.parse("2026-08-10T00:03:00.000Z") / 1_000, timeIso: "2026-08-10T00:03:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ],
    expectedTimeframe: "1", minimumIntervals: 1,
  });
  assert.equal(result.coverage.exact_target_bar_intervals, 1);
  assert.equal(result.coverage.unmatched_intervals, 0);
  assert.equal(result.contract.minimum_target_lag_bars, 1);
  assert.equal(result.status, "complete");

  const noExact = preflightBookmapFlowPriceJoin({
    session: parsed, intervals,
    targetBars: [{ time: Date.parse("2026-08-10T00:02:00.000Z") / 1_000, timeIso: "2026-08-10T00:02:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 }],
    expectedTimeframe: "1", minimumIntervals: 1,
  });
  assert.equal(noExact.coverage.exact_target_bar_intervals, 0);
  assert.ok(noExact.quality_issues.includes("non_exact_target_bar_joins_excluded"));
});

test("legacy Bookmap timestamps are marked unverifiable and malformed receipt timestamps fail closed", () => {
  const legacy = JSON.stringify({ schema_version: "1.0", source: "bookmap", event_type: "instrument", instrument_alias: "6EQ6.CME@BMD", bookmap_time_ns: 1780000000000000001, received_at: "2026-08-10T00:00:00.000Z", is_full_depth: true });
  const parsed = parseBookmapFlowSession(`${legacy}\n`, "bookmap-flow-6EQ6.CME_BMD-2.jsonl");
  assert.ok(parsed.quality_issues.includes("legacy_bookmap_time_precision_unverifiable"));
  const nanosecondReceipt = parseBookmapFlowSession(`${legacy.replace(".000Z", ".123456789Z")}\n`, "bookmap-flow-6EQ6.CME_BMD-3.jsonl");
  assert.ok(nanosecondReceipt.quality_issues.includes("legacy_receipt_timestamp_normalized_to_milliseconds"));
  assert.throws(() => parseBookmapFlowSession(`${legacy.replace("2026-08-10", "not-a-date")}\n`, "bookmap-flow-6EQ6.CME_BMD-4.jsonl"), /ISO UTC/);
});

const INSTRUMENT = { symbol: "6EQ6", exchange: "CME", is_full_depth: true, mbo_captured: false, is_crypto: false };
const bar = (iso) => ({ time: Date.parse(iso) / 1_000, timeIso: iso, open: 1, high: 1, low: 1, close: 1, volume: 1 });
const healthy = (extra = []) => session([
  row("instrument", "2026-08-10T00:00:01.000Z", INSTRUMENT),
  row("snapshot_end", "2026-08-10T00:00:02.000Z"),
  row("trade", "2026-08-10T00:00:10.000Z", { aggressor: "buy", size: 3 }),
  ...extra,
]);

test("a partially known aggressor withholds both sides of the size, not only the delta", () => {
  // The contract computes buy and sell size only when every trade in the interval has a known
  // aggressor. Nulling the delta alone would still publish a buy total that silently omits whatever
  // the unknown trades were, which reads as a real one-sided figure.
  const intervals = aggregateBookmapFlowByReceiptInterval(healthy([
    row("trade", "2026-08-10T00:00:20.000Z", { aggressor: "sell", size: 7 }),
    row("trade", "2026-08-10T00:00:30.000Z", { aggressor: "unknown", size: 4 }),
  ]), 60);
  assert.equal(intervals[0].trades, 3);
  assert.equal(intervals[0].unknown_aggressor_trades, 1);
  assert.equal(intervals[0].buy_size, null, "a partial buy total must not be published");
  assert.equal(intervals[0].sell_size, null, "a partial sell total must not be published");
  assert.equal(intervals[0].trade_delta, null);

  // With every aggressor known the same interval reports all three.
  const known = aggregateBookmapFlowByReceiptInterval(healthy([
    row("trade", "2026-08-10T00:00:20.000Z", { aggressor: "sell", size: 7 }),
  ]), 60);
  assert.equal(known[0].buy_size, 3);
  assert.equal(known[0].sell_size, 7);
  assert.equal(known[0].trade_delta, -4);
});

test("a forming bar is not a join target, because its timestamp is not yet a closed observation", () => {
  const parsed = healthy();
  const intervals = aggregateBookmapFlowByReceiptInterval(parsed, 60);
  const result = preflightBookmapFlowPriceJoin({
    session: parsed, intervals,
    targetBars: [{ ...bar("2026-08-10T00:01:00.000Z"), forming: true }],
    expectedTimeframe: "1", minimumIntervals: 1,
  });
  assert.equal(result.coverage.target_closed_bars, 0);
  assert.equal(result.coverage.exact_target_bar_intervals, 0);
  assert.ok(result.quality_issues.includes("non_exact_target_bar_joins_excluded"));
});

test("every condition the contract calls partial actually makes the preflight partial", () => {
  const join = (parsed, minimumIntervals = 1) => preflightBookmapFlowPriceJoin({
    session: parsed, intervals: aggregateBookmapFlowByReceiptInterval(parsed, 60),
    targetBars: [bar("2026-08-10T00:01:00.000Z")], expectedTimeframe: "1", minimumIntervals,
  });

  assert.equal(join(healthy()).status, "complete");

  // A session that never recorded the initial book snapshot cannot support any depth balance.
  const noSnapshot = session([
    row("instrument", "2026-08-10T00:00:01.000Z", INSTRUMENT),
    row("trade", "2026-08-10T00:00:10.000Z", { aggressor: "buy", size: 3 }),
  ]);
  assert.ok(noSnapshot.quality_issues.includes("snapshot_completion_marker_missing"));
  assert.equal(join(noSnapshot).status, "partial");
  assert.equal(join(noSnapshot).contract.depth_balance, "blocked_until_snapshot_end");

  // Depth and BBO alone carry no aggressor evidence at all.
  const noTrades = session([
    row("instrument", "2026-08-10T00:00:01.000Z", INSTRUMENT),
    row("snapshot_end", "2026-08-10T00:00:02.000Z"),
    row("depth", "2026-08-10T00:00:10.000Z", { side: "bid", size: 5 }),
  ]);
  assert.ok(noTrades.quality_issues.includes("no_trade_events_captured"));
  assert.equal(join(noTrades).status, "partial");

  // #82 forbids carrying a crypto-centric feed over as an FX proxy, so the flag has to bite.
  const crypto = session([
    row("instrument", "2026-08-10T00:00:01.000Z", { ...INSTRUMENT, is_crypto: true }),
    row("snapshot_end", "2026-08-10T00:00:02.000Z"),
    row("trade", "2026-08-10T00:00:10.000Z", { aggressor: "buy", size: 3 }),
  ]);
  assert.ok(crypto.quality_issues.includes("crypto_feed_not_eligible_for_fx_proxy"));
  assert.equal(join(crypto).status, "partial");

  // And too few intervals to preflight anything with.
  const thin = join(healthy(), 500);
  assert.ok(thin.quality_issues.includes("minimum_bookmap_intervals_not_met"));
  assert.equal(thin.status, "partial");
  assert.equal(thin.coverage.minimum_intervals, 500);
});
