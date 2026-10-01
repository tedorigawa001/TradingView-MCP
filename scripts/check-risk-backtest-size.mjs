#!/usr/bin/env node
// Slow Monte Carlo size checks for backtest_risk_forecast (docs/RISK_FORECAST_BACKTEST_PLAN.md, step 2, P2). Run by
// hand after `npm run build`, never in CI:
//   node scripts/check-risk-backtest-size.mjs
// For T ∈ {500, 1900}, α ∈ {1%, 5%} and a true hit rate π ∈ {α, 2α}, it draws R = 2,000 independent hit sequences
// (seed 20,261,101 + r for replication r) and runs the production statistics and nulls at N = 9,999 on each.
// Pass rule: the rejection rate is at most 5% + 2·√(0.05·0.95/R) (about 6.0%) for the coverage tests at π = α and for
// the independence test at both π, and at least 1% for the coverage tests at π = α, to catch an over-conservative bug.
// The independence null depends only on T, the segments, x and its seed, so it is cached per x; that is exact.
import {
  VAR_LEVELS, coverageNull, independenceNull, independenceSeed, kupiecStatistic, independenceStatistic, transitionCounts,
  monteCarloP,
} from '../build/riskForecastBacktest.js';
import { createRandom } from '../build/seededRandom.js';

const R = 2_000;
const CEILING = 0.05 + 2 * Math.sqrt((0.05 * 0.95) / R);
const FLOOR = 0.01;
let failed = false;
for (const T of [500, 1_900]) {
  const segments = [T];
  for (const level of [0, 1]) {
    const alpha = VAR_LEVELS[level].level;
    const nullDraws = coverageNull(level, T, segments);
    const independenceByX = new Map();
    for (const pi of [alpha, 2 * alpha]) {
      const rejected = { kupiec: 0, independence: 0, conditional: 0 };
      for (let r = 0; r < R; r++) {
        const random = createRandom(20_261_101 + r);
        const hits = new Uint8Array(T);
        let x = 0;
        for (let t = 0; t < T; t++) { hits[t] = random() < pi ? 1 : 0; x += hits[t]; }
        if (!independenceByX.has(x)) independenceByX.set(x, independenceNull(T, segments, x, independenceSeed(0, level, 0)));
        const uc = kupiecStatistic(x, T, alpha);
        const ind = independenceStatistic(transitionCounts(hits, segments));
        if (monteCarloP(uc, nullDraws.kupiec).rejects) rejected.kupiec++;
        if (monteCarloP(ind, independenceByX.get(x)).rejects) rejected.independence++;
        if (monteCarloP(uc + ind, nullDraws.conditional).rejects) rejected.conditional++;
      }
      const rate = (name) => rejected[name] / R;
      const checks = [['independence', rate('independence') <= CEILING]];
      if (pi === alpha) {
        for (const name of ['kupiec', 'conditional']) checks.push([name, rate(name) <= CEILING && rate(name) >= FLOOR]);
      }
      const verdict = checks.every(([, ok]) => ok) ? 'pass' : 'FAIL';
      if (verdict === 'FAIL') failed = true;
      console.log(`T=${T} α=${alpha} π=${pi.toFixed(2)}: LR_uc ${(100 * rate('kupiec')).toFixed(2)}%, ` +
        `LR_ind ${(100 * rate('independence')).toFixed(2)}%, LR_cc ${(100 * rate('conditional')).toFixed(2)}% ` +
        `(checked: ${checks.map(([name]) => name).join(', ')}) ${verdict}`);
    }
  }
}
console.log(`ceiling ${(100 * CEILING).toFixed(2)}%, floor ${(100 * FLOOR).toFixed(2)}% for coverage at π = α`);
process.exit(failed ? 1 : 0);
