import test from "node:test";
import assert from "node:assert/strict";
import { computeCrossAssetShockStates } from "../../build/crossAssetShockState.js";

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const STEP_SECONDS = 15 * 60;

function observations({ final = "confirmed" } = {}) {
  const start = Date.UTC(2026, 0, 2, 13, 45) / 1_000;
  const rows = [];
  for (let week = 0; week < 13; week += 1) {
    const time = start + week * WEEK_SECONDS;
    const seed = week < 12;
    const targetReturn = seed ? 0.0001 : 0.005;
    const contextReturn = seed ? 0.0001 : 0.005;
    const signs = seed ? { dxy: -1, us_yield: -1, xauusd: 1 }
      : final === "conflict"
      ? { dxy: 1, us_yield: -1, xauusd: 1 }
      : final === "target_only"
        ? { dxy: 0.01, us_yield: 0.01, xauusd: 0.01 }
        : final === "partial"
          ? { dxy: -1, us_yield: 0.01, xauusd: 0.01 }
          : { dxy: -1, us_yield: -1, xauusd: 1 };
    rows.push({ time, timeIso: new Date(time * 1_000).toISOString(), target_fx: 100, dxy: 100, us_yield: 100, xauusd: 100 });
    rows.push({
      time: time + STEP_SECONDS,
      timeIso: new Date((time + STEP_SECONDS) * 1_000).toISOString(),
      target_fx: 100 * (1 + targetReturn),
      dxy: 100 * (1 + contextReturn * signs.dxy),
      us_yield: 100 * (1 + contextReturn * signs.us_yield),
      xauusd: 100 * (1 + contextReturn * signs.xauusd),
    });
  }
  return rows;
}

test("cross-asset shock states require a prior same-slot baseline and classify confirmation", () => {
  const result = computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: observations() });
  assert.equal(result.contract.contract_id, "cross_asset_shock_state_v1");
  assert.equal(result.quality.insufficient_baseline_returns, 12);
  assert.equal(result.states.at(-1).state, "cross_asset_confirmed");
  assert.equal(result.states.at(-1).context.dxy.direction, "confirming");
  assert.equal(result.states.at(-1).context.xauusd.direction, "confirming");
});

test("cross-asset shock states distinguish target-only, partial, and conflicting context", () => {
  assert.equal(computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: observations({ final: "target_only" }) }).states.at(-1).state, "target_only");
  assert.equal(computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: observations({ final: "partial" }) }).states.at(-1).state, "partial_confirmation");
  const conflict = computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: observations({ final: "conflict" }) }).states.at(-1);
  assert.equal(conflict.state, "cross_asset_conflict");
  assert.equal(conflict.context.dxy.direction, "conflicting");
});

test("cross-asset shock states use exactly the twelve most recent same-slot returns", () => {
  const rows = observations();
  const oldTime = rows[0].time - WEEK_SECONDS;
  rows.unshift(
    { time: oldTime, timeIso: new Date(oldTime * 1_000).toISOString(), target_fx: 100, dxy: 100, us_yield: 100, xauusd: 100 },
    { time: oldTime + STEP_SECONDS, timeIso: new Date((oldTime + STEP_SECONDS) * 1_000).toISOString(), target_fx: 102, dxy: 98, us_yield: 98, xauusd: 102 },
  );
  const final = computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: rows }).states.at(-1);
  assert.equal(final.state, "cross_asset_confirmed");
  assert.ok(final.target_score > 40, "the old 200 bps return must be outside the fixed 12-week baseline");
});

test("cross-asset shock states do not calculate returns across a missing bar interval", () => {
  const rows = observations();
  rows.splice(2, 1);
  const result = computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: rows });
  assert.equal(result.quality.non_contiguous_input_intervals, 12);
  assert.equal(result.states.at(-1).state, "insufficient_baseline");
});

test("cross-asset shock states reject a duplicate or unsupported target binding", () => {
  const rows = observations();
  assert.throws(() => computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:GBPUSD", observations: rows }), /target symbol is unsupported/);
  rows.push({ ...rows.at(-1) });
  assert.throws(() => computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: rows }), /timestamps must be strictly increasing/);
  const offGrid = observations();
  offGrid[0] = { ...offGrid[0], time: offGrid[0].time + 1 };
  assert.throws(() => computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: offGrid }), /timeframe grid/);
});

test("the baseline slot is the weekday as well as the clock time", () => {
  // Same time of day, a different weekday. The contract standardises against the last twelve returns
  // in the same UTC weekday and slot, so these must not feed the Friday baseline: pooled together
  // they would supply it twelve times over and the final bar would be scored against them.
  const rows = observations();
  const start = rows[0].time;
  const other = [];
  for (let week = 0; week < 12; week += 1) {
    // One day earlier, so the clock slot matches and the weekday does not.
    const time = start + week * WEEK_SECONDS - 24 * 60 * 60;
    other.push(
      { time, timeIso: new Date(time * 1_000).toISOString(), target_fx: 100, dxy: 100, us_yield: 100, xauusd: 100 },
      { time: time + STEP_SECONDS, timeIso: new Date((time + STEP_SECONDS) * 1_000).toISOString(),
        target_fx: 105, dxy: 95, us_yield: 95, xauusd: 105 },
    );
  }
  const merged = [...rows, ...other].sort((left, right) => left.time - right.time);
  const result = computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: merged });

  // The Thursday rows carry their own slot and so start with no baseline of their own.
  assert.equal(result.quality.insufficient_baseline_returns, 24);
  const final = result.states.at(-1);
  assert.equal(final.state, "cross_asset_confirmed");
  // Scored against the twelve quiet Friday returns, not against the loud Thursday ones. Pooling the
  // weekdays would put 500 bps moves in the baseline and leave this score far below the threshold.
  assert.ok(final.target_score > 40, `weekday pooling would flatten this score, got ${final.target_score}`);
});

test("a slot whose baseline never moved is unevaluable rather than infinitely shocked", () => {
  // Twelve identical prior returns give a root-mean-square of zero, and a score is a division by it.
  // Left alone that is Infinity, which clears any threshold and would report a certain shock on the
  // strength of a baseline that contains no information at all.
  const rows = [];
  const start = Date.UTC(2026, 0, 2, 13, 45) / 1_000;
  for (let week = 0; week < 13; week += 1) {
    const time = start + week * WEEK_SECONDS;
    const moved = week === 12;
    rows.push({ time, timeIso: new Date(time * 1_000).toISOString(), target_fx: 100, dxy: 100, us_yield: 100, xauusd: 100 });
    rows.push({
      time: time + STEP_SECONDS, timeIso: new Date((time + STEP_SECONDS) * 1_000).toISOString(),
      target_fx: moved ? 100.5 : 100, dxy: moved ? 99.5 : 100,
      us_yield: moved ? 99.5 : 100, xauusd: moved ? 100.5 : 100,
    });
  }
  const result = computeCrossAssetShockStates({ timeframe: "15", targetSymbol: "OANDA:EURUSD", observations: rows });
  const final = result.states.at(-1);
  assert.equal(final.state, "insufficient_baseline");
  assert.equal(final.target_score, undefined, "a state with no usable baseline must not carry a score");
  assert.equal(final.context.dxy.score, null);
  assert.equal(final.context.dxy.direction, "not_evaluable");
  // Every bar here is either seeding the baseline or sitting on a zero one.
  assert.equal(result.state_counts.insufficient_baseline, 13);
  assert.equal(result.state_counts.cross_asset_confirmed, 0);
});
