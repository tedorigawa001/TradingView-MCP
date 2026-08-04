import assert from "node:assert/strict";
import test from "node:test";
import {
  generateFactorNullPair,
  generateIndependentNullPair,
  generateSyntheticNullSeries,
} from "../../build/syntheticNullSeries.js";

test("independent null pairs share a clock without reusing either leg's random path", () => {
  const pair = generateIndependentNullPair({ model: "bid_ask_bounce", bars: 300, seed: 7, timeframeMinutes: 60 });
  assert.deepEqual(pair.primary.map((bar) => bar.time), pair.reference.map((bar) => bar.time));
  assert.notDeepEqual(pair.primary.map((bar) => bar.close), pair.reference.map((bar) => bar.close));
});

const base = { bars: 4000, seed: 7, timeframeMinutes: 1440, startTimeMs: Date.UTC(2006, 0, 2) };

const logReturns = (bars) => bars.slice(1).map((bar, index) => Math.log(bar.close / bars[index].close));

// A single seed estimates a lag-1 autocorrelation with a standard error near 1/sqrt(bars), so any
// fixed-seed threshold tight enough to be meaningful is also tight enough to fail by luck. Averaging
// over seeds tests the model instead of the draw, and shrinks the error by sqrt(seeds).
const SEEDS = 20;
const AUDIT_BARS = 2000;
const NOISE_BOUND = 4 / Math.sqrt(SEEDS * AUDIT_BARS);

function meanAutocorrelationAcrossSeeds(model, transform = (value) => value) {
  let total = 0;
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const bars = generateSyntheticNullSeries({ ...base, model, bars: AUDIT_BARS, seed });
    total += autocorrelation(logReturns(bars).map(transform), 1);
  }
  return total / SEEDS;
}

function autocorrelation(values, lag) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < values.length; index += 1) {
    variance += (values[index] - mean) ** 2;
    if (index + lag < values.length) covariance += (values[index] - mean) * (values[index + lag] - mean);
  }
  return covariance / variance;
}

function correlation(a, b) {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let covariance = 0, varianceA = 0, varianceB = 0;
  for (let index = 0; index < a.length; index += 1) {
    covariance += (a[index] - meanA) * (b[index] - meanB);
    varianceA += (a[index] - meanA) ** 2;
    varianceB += (b[index] - meanB) ** 2;
  }
  return covariance / Math.sqrt(varianceA * varianceB);
}

test("synthetic null series is reproducible from its seed and changes with it", () => {
  const first = generateSyntheticNullSeries({ ...base, model: "white_noise" });
  const again = generateSyntheticNullSeries({ ...base, model: "white_noise" });
  const other = generateSyntheticNullSeries({ ...base, model: "white_noise", seed: 8 });
  // A candidate rate is only evidence if the run behind it can be reproduced exactly.
  assert.deepEqual(first, again);
  assert.notDeepEqual(first.map((bar) => bar.close), other.map((bar) => bar.close));
});

test("synthetic null bars satisfy the OHLC relations every study tool validates", () => {
  for (const model of ["white_noise", "regime_switching_volatility", "bid_ask_bounce"]) {
    const bars = generateSyntheticNullSeries({ ...base, model, bars: 500 });
    assert.equal(bars.length, 500);
    for (const [index, bar] of bars.entries()) {
      assert.ok(bar.low <= bar.high, `${model} bar ${index} inverted range`);
      assert.ok(bar.open >= bar.low && bar.open <= bar.high, `${model} bar ${index} open outside range`);
      assert.ok(bar.close >= bar.low && bar.close <= bar.high, `${model} bar ${index} close outside range`);
      assert.ok(Number.isFinite(bar.close) && bar.close > 0);
      assert.equal(bar.timeIso, new Date(bar.time * 1000).toISOString());
      assert.equal(bar.forming, undefined, "a null series has no live edge, so no bar is forming");
      if (index > 0) assert.equal(bar.time - bars[index - 1].time, 1440 * 60, "bars must be evenly spaced");
    }
  }
});

test("white noise leaves simple returns at zero and creates no autocorrelation", () => {
  const bars = generateSyntheticNullSeries({ ...base, model: "white_noise" });
  // The price is the martingale, so it is the SIMPLE return that has mean zero. Log returns sit at
  // minus half the step variance by construction, and asserting they are centred on zero would be
  // asserting the wrong contract.
  const simple = bars.slice(1).map((bar, index) => bar.close / bars[index].close - 1);
  const mean = simple.reduce((sum, value) => sum + value, 0) / simple.length;
  const sd = Math.sqrt(simple.reduce((sum, value) => sum + (value - mean) ** 2, 0) / simple.length);
  assert.ok(Math.abs(mean) < 3 * sd / Math.sqrt(simple.length), `simple return mean ${mean} is not within noise of zero`);
  const directional = meanAutocorrelationAcrossSeeds("white_noise");
  assert.ok(Math.abs(directional) < NOISE_BOUND,
    `white noise lag-1 autocorrelation ${directional.toFixed(5)} exceeds the ${NOISE_BOUND.toFixed(5)} noise bound`);
});

test("regime switching clusters variance without adding drift", () => {
  const clustered = logReturns(generateSyntheticNullSeries({ ...base, model: "regime_switching_volatility" }));
  const flat = logReturns(generateSyntheticNullSeries({ ...base, model: "white_noise" }));
  const magnitudeMemory = (returns) => autocorrelation(returns.map(Math.abs), 1);
  // Clustering is a local property, so it shows as memory in the size of returns, not as a
  // difference between arbitrary halves. Contrasting against white noise is what makes this a test
  // of the model rather than of the estimator.
  assert.ok(magnitudeMemory(clustered) > 0.1,
    `clustered |return| autocorrelation ${magnitudeMemory(clustered)} is too weak to strain a fold`);
  assert.ok(magnitudeMemory(flat) < 0.05,
    `white noise should carry no magnitude memory, got ${magnitudeMemory(flat)}`);
  // Clustered variance must not turn into a directional edge. The Ito term is what keeps that true
  // for the simple returns the studies measure, and this assertion guards the log-return side:
  // whatever the volatility state does, one return must not predict the sign of the next. Averaged
  // over seeds so it measures the model rather than one draw.
  const directional = meanAutocorrelationAcrossSeeds("regime_switching_volatility");
  assert.ok(Math.abs(directional) < NOISE_BOUND,
    `clustered variance created a directional edge: lag-1 autocorrelation ${directional.toFixed(5)} exceeds ${NOISE_BOUND.toFixed(5)}`);
});

test("forward simple returns stay at zero in every volatility state", () => {
  // The contract the audited studies rely on: they score an outcome as close_end / close_signal - 1,
  // so it is the SIMPLE return that must be unpredictable. Bucketing by the volatility the signal bar
  // could already see is the exact attack: without the Ito term, high past volatility implies a
  // higher expected simple return, and a feature detecting it would score as a real edge.
  // Windows do not overlap, so the observations are independent and the bound below is a real
  // standard error rather than an optimistic one. Twelve seeds put the surviving noise near 0.07%,
  // while the version without the Ito term separated the quintiles by about 0.25% here, roughly the
  // size of the genuine five-day drift measured on XAUUSD. 0.15% sits between the two with margin.
  for (const model of ["white_noise", "regime_switching_volatility"]) {
    const differences = [];
    const overalls = [];
    for (let seed = 11; seed <= 22; seed += 1) {
      const bars = generateSyntheticNullSeries({ ...base, model, bars: 20000, seed });
      const rows = [];
      for (let index = 20; index + 5 < bars.length; index += 5) {
        rows.push({
          volatility: Math.max(...bars.slice(index - 20, index).map((bar) => bar.high / bar.low - 1)),
          forward: bars[index + 5].close / bars[index].close - 1,
        });
      }
      const sorted = [...rows].sort((a, b) => a.volatility - b.volatility);
      const quintile = Math.floor(sorted.length / 5);
      const mean = (list) => list.reduce((sum, row) => sum + row.forward, 0) / list.length;
      differences.push(mean(sorted.slice(-quintile)) - mean(sorted.slice(0, quintile)));
      overalls.push(mean(rows));
    }
    const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const difference = average(differences);
    const overall = average(overalls);
    assert.ok(Math.abs(overall) < 0.0008, `${model} overall five-bar drift ${(overall * 100).toFixed(4)}%`);
    assert.ok(Math.abs(difference) < 0.0015,
      `${model} conditions on past volatility: violent minus calm ${(difference * 100).toFixed(4)}%`);
  }
});

test("bid-ask bounce reverses returns without making anything tradable", () => {
  const returns = logReturns(generateSyntheticNullSeries({
    ...base, model: "bid_ask_bounce", volatility: 0.004, halfSpread: 0.002,
  }));
  // A reversal study reading this would find a real negative autocorrelation that lives entirely
  // inside the spread. The audit exists to see whether the pipeline calls that a candidate.
  assert.ok(autocorrelation(returns, 1) < -0.15, "the bounce must show as negative lag-1 autocorrelation");
});

test("factor null rho is the contemporaneous correlation, sign and all", () => {
  // A signed loading shared by both legs turned rho = -0.7 into +0.49 and any magnitude above one
  // into exactly +1. rho now means what its name says.
  for (const rho of [-0.7, 0, 0.7]) {
    const { primary, reference } = generateFactorNullPair({ ...base, model: "white_noise", rho });
    const measured = correlation(logReturns(primary), logReturns(reference));
    assert.ok(Math.abs(measured - rho) < 0.05, `rho ${rho} measured as ${measured.toFixed(3)}`);
  }
  const { primary, reference } = generateFactorNullPair({ ...base, model: "white_noise", rho: 0.7 });
  const p = logReturns(primary);
  const r = logReturns(reference);
  for (const lag of [1, 2, 3]) {
    const lagged = correlation(p.slice(lag), r.slice(0, r.length - lag));
    assert.ok(Math.abs(lagged) < 0.06, `lag ${lag} correlation ${lagged} would plant a lead that does not exist`);
  }
});

test("synthetic null series rejects inputs it cannot generate honestly", () => {
  assert.throws(() => generateSyntheticNullSeries({ ...base, model: "white_noise", bars: 1 }), /bars must be an integer/);
  assert.throws(() => generateSyntheticNullSeries({ ...base, model: "white_noise", seed: -1 }), /seed must be an integer from 0 to 4294967295/);
  assert.throws(() => generateSyntheticNullSeries({ ...base, model: "white_noise", volatility: 0 }), /volatility must be greater than zero/);
  // A start time that is not on a bar boundary would produce timestamps no chart could ever return.
  assert.throws(() => generateSyntheticNullSeries({
    ...base, model: "white_noise", startTimeMs: Date.UTC(2006, 0, 2) + 60_000,
  }), /whole number of bars/);
  assert.throws(() => generateFactorNullPair({ ...base, model: "white_noise", rho: 1.2 }), /rho must be between -1 and 1/);
  // A seed wider than the generator state would silently repeat a series already counted.
  assert.throws(() => generateSyntheticNullSeries({ ...base, model: "white_noise", seed: 0x1_0000_0000 }), /seed must be an integer from 0 to 4294967295/);
});

test("extremes stay positive at the top of the accepted volatility range", () => {
  // The linear (1 - wick) form went negative here: white noise at the maximum volatility produced a
  // negative low around bar 4730 of seed 0, which is a bar no downstream validator would accept.
  for (const seed of [0, 1, 2]) {
    const bars = generateSyntheticNullSeries({ ...base, model: "white_noise", bars: 4000, seed, volatility: 0.5 });
    for (const [index, bar] of bars.entries()) {
      assert.ok(bar.low > 0, `seed ${seed} bar ${index} has a non-positive low ${bar.low}`);
      assert.ok(bar.low <= bar.high && bar.open >= bar.low && bar.close <= bar.high);
    }
  }
});

test("a series that would underflow to a zero price is refused rather than emitted", () => {
  // At the maximum volatility the Ito term removes about 0.125 of log price per bar, so a long
  // enough series reaches exactly zero in float64. Seed 0 did so at bar 6360, and a zero OHLC breaks
  // every study downstream, so the generator has to say it cannot represent this rather than pretend.
  assert.throws(() => generateSyntheticNullSeries({
    ...base, model: "white_noise", bars: 20000, seed: 0, volatility: 0.5,
  }), /price reached 0 at bar \d+: reduce volatility or bars/);
});

test("an unknown model is refused instead of silently producing white noise", () => {
  // The audit prints the model name beside the candidate rate, so a name that reached no branch and
  // fell through to plain noise would mislabel the process behind every number.
  assert.throws(() => generateSyntheticNullSeries({ ...base, model: "unknown" }),
    /model must be one of white_noise, regime_switching_volatility, bid_ask_bounce/);
  assert.throws(() => generateSyntheticNullSeries({ ...base, model: undefined }), /model must be one of/);
});

test("factor null pairs generate every declared marginal model", () => {
  const explicit = generateFactorNullPair({ ...base, model: "white_noise", bars: 200 });
  const implicit = generateFactorNullPair({ ...base, bars: 200 });
  assert.deepEqual(explicit.primary, implicit.primary);
  for (const model of ["regime_switching_volatility", "bid_ask_bounce"]) {
    const pair = generateFactorNullPair({ ...base, model, bars: 1000, rho: 0.7 });
    assert.equal(pair.primary.length, 1000);
    assert.equal(pair.reference.length, 1000);
  }
});

test("factor clustered-volatility pairs share the volatility state", () => {
  const pair = generateFactorNullPair({ ...base, model: "regime_switching_volatility", bars: 4000, rho: 0.7 });
  const primaryMagnitude = logReturns(pair.primary).map(Math.abs);
  const referenceMagnitude = logReturns(pair.reference).map(Math.abs);
  const contemporaneousMagnitudeCorrelation = correlation(primaryMagnitude, referenceMagnitude);
  assert.ok(contemporaneousMagnitudeCorrelation > 0.2,
    `shared volatility state is too weak: ${contemporaneousMagnitudeCorrelation}`);

  // Shared volatility must not itself plant a directional lead. Averaging fixed seeds separates the
  // model contract from the deliberately wide sampling noise that makes the old candidate gate fail.
  for (const lag of [1, 2, 3]) {
    let total = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const draw = generateFactorNullPair({ ...base, model: "regime_switching_volatility", bars: 2000, seed, rho: 0.7 });
      const primary = logReturns(draw.primary);
      const reference = logReturns(draw.reference);
      total += correlation(primary.slice(lag), reference.slice(0, reference.length - lag));
    }
    assert.ok(Math.abs(total / 20) < 0.02, `shared volatility planted average lag-${lag} correlation ${total / 20}`);
  }
});

test("a weekly series generates from defaults alone", () => {
  // A fixed calendar default is not a whole number of weekly bars since the epoch, so this used to
  // throw for a timeframe the validator accepts.
  const weekly = generateSyntheticNullSeries({ model: "white_noise", bars: 300, seed: 3, timeframeMinutes: 10080 });
  assert.equal(weekly.length, 300);
  assert.equal(weekly[1].time - weekly[0].time, 10080 * 60);
});
