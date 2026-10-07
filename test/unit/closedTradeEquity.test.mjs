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

test("exits at the same time and price are one fill; at different prices in one bar, losses come first", () => {
  // A pyramided position closed at once: two entries, one exit price, realized together whatever the ledger order.
  for (const order of [[0, 1], [1, 0]]) {
    const fill = [{ profit: -20, exitTime: 3, exitPrice: 1.1 }, { profit: 30, exitTime: 3, exitPrice: 1.1 }];
    assert.equal(closedTradeEquityDrawdown(order.map((index) => fill[index])), 0, order.join(","));
  }
  // A stop and a target filled in one bar at a peak of 100: whichever filled first, equity fell 80.
  const bar = [{ profit: 100, exitTime: 1, exitPrice: 1 }, { profit: 80, exitTime: 2, exitPrice: 1.2 }, { profit: -80, exitTime: 2, exitPrice: 0.9 }];
  assert.equal(closedTradeEquityDrawdown(bar), 80);
  assert.equal(closedTradeEquityDrawdown([bar[0], bar[2], bar[1]]), 80);
  // Exits without a price cannot be shown to share a fill, so they stand apart too.
  assert.equal(closedTradeEquityDrawdown([{ profit: 50, exitTime: 3 }, { profit: -50, exitTime: 3 }]), 50);
  assert.equal(closedTradeEquityDrawdown([{ profit: 50, exitTime: 1 }, { profit: -50, exitTime: 2, exitPrice: 1 }, { profit: -30, exitTime: 2, exitPrice: 1 }]), 80);
  // Losses first is the deepest fall at that moment, not a maximum over every order: gains first would have raised the
  // peak to 100 before the later -10, a drawdown of 110.
  assert.equal(closedTradeEquityDrawdown([{ profit: 100, exitTime: 1, exitPrice: 2 }, { profit: -100, exitTime: 1, exitPrice: 1 }, { profit: -10, exitTime: 2, exitPrice: 1 }]), 100);
  assert.equal(sequenceEquityDrawdown([100, -100, -10]), 110);
  // The order is by profit, not price: for a short the lower price is the gain, and still the loss comes first.
  assert.equal(closedTradeEquityDrawdown([{ profit: 100, exitTime: 1, exitPrice: 1 }, { profit: -100, exitTime: 1, exitPrice: 2 }, { profit: -10, exitTime: 2, exitPrice: 1 }]), 100);
  // A NaN price is no price: such exits stand apart rather than share a fill.
  assert.equal(closedTradeEquityDrawdown([{ profit: 50, exitTime: 3, exitPrice: Number.NaN }, { profit: -50, exitTime: 3, exitPrice: Number.NaN }]), 50);
});

test("non-overlapping trades give the plain running drawdown, and a missing exit time gives none", () => {
  const profits = [100, -50, 80, -20, -70];
  assert.equal(closedTradeEquityDrawdown(profits.map((profit, index) => ({ profit, exitTime: index + 1 }))), 90);
  assert.equal(sequenceEquityDrawdown(profits), 90);
  assert.equal(closedTradeEquityDrawdown([]), 0);
  assert.equal(closedTradeEquityDrawdown([{ profit: 1, exitTime: 1 }, { profit: -1, exitTime: null }]), null);
  assert.equal(closedTradeEquityDrawdown([{ profit: 1, exitTime: Number.NaN }]), null);
});
