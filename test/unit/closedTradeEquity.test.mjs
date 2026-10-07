import assert from "node:assert/strict";
import test from "node:test";
import { closedTradeEquityDrawdown, sequenceEquityDrawdown } from "../../build/closedTradeEquity.js";

// BACKLOG 102-18: closed-trade equity is realized in exit order, not entry or ledger order.
test("closed-trade drawdown follows exit order, so overlapping holds report the drawdown that happened", () => {
  // X (-60) closes first, Z (+60) next, Y (-60) last, though Y was entered before Z: -60, 0, -60.
  const trades = [{ profit: -60, exitTime: 2 }, { profit: -60, exitTime: 5 }, { profit: 60, exitTime: 4 }];
  assert.equal(closedTradeEquityDrawdown(trades), 60);
  assert.equal(sequenceEquityDrawdown(trades.map((trade) => trade.profit)), 120, "entry order: -60, -120, -60");
  // The ledger's order changes nothing.
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    assert.equal(closedTradeEquityDrawdown(order.map((index) => trades[index])), 60, order.join(","));
  }
});

test("trades closing at the same time realize together, whatever their ledger order", () => {
  assert.equal(closedTradeEquityDrawdown([{ profit: -50, exitTime: 3 }, { profit: 50, exitTime: 3 }]), 0);
  assert.equal(closedTradeEquityDrawdown([{ profit: 50, exitTime: 3 }, { profit: -50, exitTime: 3 }]), 0);
  assert.equal(sequenceEquityDrawdown([-50, 50]), 50, "one after the other, the loss would show");
  assert.equal(closedTradeEquityDrawdown([{ profit: 50, exitTime: 1 }, { profit: -50, exitTime: 2 }, { profit: -30, exitTime: 2 }]), 80);
});

test("non-overlapping trades give the plain running drawdown, and a missing exit time gives none", () => {
  const profits = [100, -50, 80, -20, -70];
  assert.equal(closedTradeEquityDrawdown(profits.map((profit, index) => ({ profit, exitTime: index + 1 }))), 90);
  assert.equal(sequenceEquityDrawdown(profits), 90);
  assert.equal(closedTradeEquityDrawdown([]), 0);
  assert.equal(closedTradeEquityDrawdown([{ profit: 1, exitTime: 1 }, { profit: -1, exitTime: null }]), null);
  assert.equal(closedTradeEquityDrawdown([{ profit: 1, exitTime: Number.NaN }]), null);
});
