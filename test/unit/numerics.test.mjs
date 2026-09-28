import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cholesky, inverseFromCholesky, logDeterminantFromCholesky, positiveSemidefinite, erfc, normalCdf, spearman, averageRanks,
} from '../../build/numerics.js';

const REF = JSON.parse(readFileSync(new URL('../fixtures/forecast-loss/hac-reference.json', import.meta.url), 'utf8'));
const close = (got, want, relative, label) =>
  assert.ok(Math.abs(got - want) <= relative * Math.abs(want), `${label}: ${got} vs ${want}`);

test('Cholesky, its inverse and log det on a known matrix', () => {
  const a = [[4, 2, 0.4], [2, 5, 1], [0.4, 1, 3]];
  const l = cholesky(a);
  const rebuilt = a.map((row, i) => row.map((_, j) => l[i].reduce((s, x, k) => s + x * l[j][k], 0)));
  rebuilt.forEach((row, i) => row.forEach((x, j) => close(x, a[i][j], 1e-14, `LLᵀ[${i}][${j}]`)));
  const inverse = inverseFromCholesky(l);
  a.forEach((row, i) => row.forEach((_, j) => {
    const product = row.reduce((s, x, k) => s + x * inverse[k][j], 0);
    assert.ok(Math.abs(product - (i === j ? 1 : 0)) < 1e-14);
  }));
  const det = 4 * (5 * 3 - 1) - 2 * (2 * 3 - 0.4) + 0.4 * (2 - 5 * 0.4);
  close(logDeterminantFromCholesky(l), Math.log(det), 1e-14, 'log det');
  assert.equal(cholesky([[1, 2], [2, 1]]), null, 'indefinite');
  assert.equal(cholesky([[0]]), null, 'zero pivot');
  assert.equal(cholesky([[NaN]]), null, 'not finite');
});

test('the PSD check is scale-invariant from 1e-12 to 1e12 (plan #1, Q3)', () => {
  const r = [1.5, -0.7, 2.2];
  const rankOne = r.map((x) => r.map((y) => x * y));
  // A slightly indefinite matrix: eigenvalues 3, 1 and −1e-9·max|P|, far outside τ = 1e-12·max|P|.
  const q = [[2 / 3, 2 / 3, 1 / 3], [2 / 3, -1 / 3, -2 / 3], [1 / 3, -2 / 3, 2 / 3]];
  const lambdas = [3, 1, -1e-9 * 3];
  const indefinite = q.map((_, i) => q.map((__, j) => lambdas.reduce((s, l, k) => s + l * q[i][k] * q[j][k], 0)));
  for (let power = -12; power <= 12; power++) {
    const c = 10 ** power;
    assert.equal(positiveSemidefinite(rankOne.map((row) => row.map((x) => x * c))), true, `rank one at ${c}`);
    assert.equal(positiveSemidefinite(indefinite.map((row) => row.map((x) => x * c))), false, `indefinite at ${c}`);
    assert.equal(positiveSemidefinite([[c]]), true);
    assert.equal(positiveSemidefinite([[-c]]), false);
  }
  assert.equal(positiveSemidefinite([[0, 0], [0, 0]]), true, 'all zero');
  assert.equal(positiveSemidefinite([[-0]]), true, 'negative zero');
  // The eigenvalue helper this replaces accepts this tiny indefinite matrix; the Cholesky test does not.
  assert.equal(positiveSemidefinite([[1e-10, 2e-10], [2e-10, 1e-10]]), false);
});

test('Φ matches scipy norm.cdf and norm.sf to a relative 1e-12, in both tails (plan #2)', () => {
  for (const point of REF.phi) {
    close(normalCdf(point.x), point.cdf, 1e-12, `cdf(${point.x})`);
    close(normalCdf(-point.x), point.sf, 1e-12, `sf(${point.x})`);
  }
  assert.equal(erfc(0), 1);
  assert.equal(erfc(40), 0);
  assert.equal(erfc(-40), 2);
  assert.ok(Number.isNaN(erfc(NaN)));
  // The upper tail never goes through 1 − Φ: Φ(−8) keeps its precision.
  close(normalCdf(-8), 6.22096057427178e-16, 1e-12, 'Φ(−8)');
});

test('Spearman: average ranks for ties, Pearson on ranks, scipy reference, undefined when constant', () => {
  assert.deepEqual(averageRanks([10, 20, 20, 5]), [2, 3.5, 3.5, 1]);
  for (const c of REF.spearman) close(spearman(c.a, c.b), c.rho, 1e-12, c.name);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), null);
  assert.equal(spearman([1], [2]), null);
  assert.equal(spearman([1, 2], [1, 2, 3]), null);
});
