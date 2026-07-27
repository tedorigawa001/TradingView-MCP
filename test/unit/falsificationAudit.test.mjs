import assert from "node:assert/strict";
import test from "node:test";
import {
  runFalsificationAudit,
  runPairedFalsificationAudit,
} from "../../build/falsificationAudit.js";

const base = {
  replications: 200,
  bars: 400,
  timeframeMinutes: 1440,
  nominalAlpha: 0.05,
  runStudy: (bars) => bars,
};

test("falsification audit is reproducible and gives each replication its own seed", () => {
  // Every candidate rate this produces is meant to be quotable, which it is not unless the same
  // inputs return the same seeds.
  const options = { ...base, model: "white_noise", isCandidate: (bars) => bars[0].close > 100 };
  const first = runFalsificationAudit(options);
  const again = runFalsificationAudit(options);
  assert.deepEqual(first.candidateSeeds, again.candidateSeeds);
  assert.equal(first.firstSeed, 1);

  const shifted = runFalsificationAudit({ ...options, firstSeed: 5000 });
  assert.notDeepEqual(shifted.candidateSeeds, first.candidateSeeds);
  // Seeds must be distinct across replications, or the audit counts one series many times.
  assert.equal(new Set(shifted.candidateSeeds).size, shifted.candidateSeeds.length);
  assert.ok(shifted.candidateSeeds.every((seed) => seed >= 5000 && seed < 5000 + base.replications));
});

test("falsification audit recovers a rule of known frequency", () => {
  const never = runFalsificationAudit({ ...base, model: "white_noise", isCandidate: () => false });
  assert.equal(never.candidates, 0);
  assert.equal(never.observedRate, 0);
  assert.equal(never.observedRateInterval.lower, 0);
  assert.equal(never.exceedsNominalAlpha, false);

  const always = runFalsificationAudit({ ...base, model: "white_noise", isCandidate: () => true });
  assert.equal(always.observedRate, 1);
  assert.equal(always.observedRateInterval.upper, 1);
  assert.equal(always.exceedsNominalAlpha, true);

  // A rule that fires on a property of the seed rather than the data has a frequency known in
  // advance, so the counting itself can be checked against something other than more simulation.
  let seen = 0;
  const half = runFalsificationAudit({
    ...base, model: "white_noise",
    isCandidate: () => { seen += 1; return seen % 2 === 0; },
  });
  assert.equal(half.candidates, base.replications / 2);
  assert.equal(half.observedRate, 0.5);
});

test("falsification audit reports a failed replication instead of scoring it as no candidate", () => {
  let call = 0;
  const result = runFalsificationAudit({
    ...base, replications: 20, model: "white_noise",
    runStudy: () => { call += 1; if (call % 4 === 0) throw new Error("study exploded"); return call; },
    isCandidate: () => true,
  });
  // Counting a crash as a non-candidate would quietly lower every rate the audit reports.
  assert.equal(result.failed.length, 5);
  assert.equal(result.completed, 15);
  assert.equal(result.candidates, 15);
  assert.equal(result.observedRate, 1);
  assert.match(result.failed[0].error, /study exploded/);
  assert.ok(result.failed.every((item) => Number.isInteger(item.seed)));
});

test("falsification audit calls an exceedance only when noise cannot explain it", () => {
  // Two candidates in two hundred is above nothing but nowhere near five percent, and a rule that
  // fires slightly above alpha in a small sample must not be reported as miscalibrated.
  let seen = 0;
  const marginal = runFalsificationAudit({
    ...base, model: "white_noise",
    isCandidate: () => { seen += 1; return seen <= 12; },
  });
  assert.equal(marginal.observedRate, 0.06);
  assert.ok(marginal.observedRateInterval.lower < 0.05, "0.06 in 200 draws cannot be distinguished from 0.05");
  assert.equal(marginal.exceedsNominalAlpha, false);

  let other = 0;
  const clear = runFalsificationAudit({
    ...base, model: "white_noise",
    isCandidate: () => { other += 1; return other <= 60; },
  });
  assert.equal(clear.observedRate, 0.3);
  assert.equal(clear.exceedsNominalAlpha, true);
});

test("falsification audit passes the requested null model through to the data", () => {
  const seenModels = [];
  for (const model of ["white_noise", "regime_switching_volatility", "bid_ask_bounce"]) {
    const result = runFalsificationAudit({
      ...base, replications: 5, model,
      isCandidate: (bars) => { seenModels.push(bars.length); return false; },
    });
    assert.equal(result.model, model, "the reported model names the process that produced the data");
    assert.equal(result.failed.length, 0);
  }
  assert.equal(seenModels.length, 15);
  assert.ok(seenModels.every((length) => length === base.bars));
});

test("paired falsification audit hands both legs of one draw to the study", () => {
  const widths = [];
  const result = runPairedFalsificationAudit({
    ...base, replications: 10, rho: 0.5,
    runStudy: (primary, reference) => {
      widths.push([primary.length, reference.length]);
      // Both legs must come from the same draw, or a lead/lag audit would be comparing two
      // unrelated series and could never see the shared factor it is meant to hold constant.
      assert.equal(primary[0].timeIso, reference[0].timeIso);
      return primary[0].close - reference[0].close;
    },
    isCandidate: (difference) => difference > 0,
  });
  assert.equal(result.model, "factor_null_pair");
  assert.equal(result.completed, 10);
  assert.ok(widths.every(([p, r]) => p === base.bars && r === base.bars));
});

test("falsification audit refuses inputs that would make its rate meaningless", () => {
  const rule = { model: "white_noise", isCandidate: () => false };
  assert.throws(() => runFalsificationAudit({ ...base, ...rule, replications: 0 }), /replications must be an integer/);
  assert.throws(() => runFalsificationAudit({ ...base, ...rule, replications: 5000 }), /replications must be an integer/);
  assert.throws(() => runFalsificationAudit({ ...base, ...rule, nominalAlpha: 0 }), /nominal alpha must be between zero and one/);
  assert.throws(() => runFalsificationAudit({ ...base, ...rule, nominalAlpha: 1 }), /nominal alpha must be between zero and one/);
  assert.throws(() => runFalsificationAudit({ ...base, ...rule, firstSeed: -1 }), /first seed must be a non-negative/);
});

test("falsification audit refuses a seed range it cannot fill with independent draws", () => {
  // Past the generator seed space every further replication throws, and the rate would be reported
  // over however many happened to fit. firstSeed 4294967295 with two replications used to return a
  // rate computed from a single completed draw while quietly recording one failure.
  assert.throws(() => runFalsificationAudit({
    ...base, replications: 2, firstSeed: 4294967295, model: "white_noise", isCandidate: () => false,
  }), /seeds must stay within 0 to 4294967295/);
  assert.throws(() => runPairedFalsificationAudit({
    ...base, replications: 10, firstSeed: 4294967290, isCandidate: () => false,
    runStudy: (primary) => primary,
  }), /overflows/);
  // The last seed that still fits must be accepted, so the bound is exact rather than defensive.
  const edge = runFalsificationAudit({
    ...base, replications: 1, firstSeed: 4294967295, bars: 100, model: "white_noise", isCandidate: () => false,
  });
  assert.equal(edge.completed, 1);
  assert.equal(edge.failed.length, 0);
});

test("falsification audit records the generation parameters actually used", () => {
  // A candidate rate is only reproducible if the record names every value behind it. Leaving these
  // out meant two runs at different volatilities were indistinguishable in their own output.
  const defaulted = runFalsificationAudit({
    ...base, replications: 3, model: "white_noise", isCandidate: () => false,
  });
  assert.equal(defaulted.volatility, 0.008, "the effective default, not undefined");
  assert.equal(defaulted.rho, undefined, "a single series has no correlation to report");

  const explicit = runFalsificationAudit({
    ...base, replications: 3, model: "white_noise", volatility: 0.02, isCandidate: () => false,
  });
  assert.equal(explicit.volatility, 0.02);

  const paired = runPairedFalsificationAudit({
    ...base, replications: 3, isCandidate: () => false, runStudy: (primary) => primary,
  });
  assert.equal(paired.rho, 0.7, "the effective default rho");
  assert.equal(paired.volatility, 0.008);

  const pairedExplicit = runPairedFalsificationAudit({
    ...base, replications: 3, rho: -0.4, volatility: 0.03, isCandidate: () => false, runStudy: (primary) => primary,
  });
  assert.equal(pairedExplicit.rho, -0.4);
  assert.equal(pairedExplicit.volatility, 0.03);
});
