/**
 * Small dense numerics for compare_forecast_losses (docs/FORECAST_LOSS_COMPARISON_PLAN.md). The
 * repository's normalCdf copies (Abramowitz-Stegun, error up to 7.5e-8) and symmetricEigenvalues
 * (absolute thresholds, not scale-invariant) are deliberately not used here.
 */
export type Matrix = number[][];

/** Lower Cholesky factor, or null when a pivot is not strictly positive and finite. */
export function cholesky(a: Matrix): Matrix | null {
  const n = a.length;
  const l: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    let diagonal = a[j][j];
    for (let k = 0; k < j; k++) diagonal -= l[j][k] * l[j][k];
    if (!(diagonal > 0) || !Number.isFinite(diagonal)) return null;
    const root = Math.sqrt(diagonal);
    l[j][j] = root;
    for (let i = j + 1; i < n; i++) {
      let value = a[i][j];
      for (let k = 0; k < j; k++) value -= l[i][k] * l[j][k];
      l[i][j] = value / root;
    }
  }
  return l;
}

export const logDeterminantFromCholesky = (l: Matrix) => 2 * l.reduce((sum, row, i) => sum + Math.log(row[i]), 0);

/** A⁻¹ from its lower Cholesky factor (A = L Lᵀ). */
export function inverseFromCholesky(l: Matrix): Matrix {
  const n = l.length;
  const inverse: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let column = 0; column < n; column++) {
    const y = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let value = i === column ? 1 : 0;
      for (let k = 0; k < i; k++) value -= l[i][k] * y[k];
      y[i] = value / l[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let value = y[i];
      for (let k = i + 1; k < n; k++) value -= l[k][i] * inverse[k][column];
      inverse[i][column] = value / l[i][i];
    }
  }
  return inverse;
}

export const frobeniusInner = (a: Matrix, b: Matrix) => a.reduce((sum, row, i) => sum + row.reduce((s, x, j) => s + x * b[i][j], 0), 0);
export const maxAbs = (a: Matrix) => a.reduce((m, row) => row.reduce((r, x) => Math.max(r, Math.abs(x)), m), 0);
export const allFinite = (a: Matrix) => a.every((row) => row.every(Number.isFinite));
export const symmetricWithin = (a: Matrix, relative: number) => {
  const scale = maxAbs(a);
  return a.every((row, i) => row.every((x, j) => Math.abs(x - a[j][i]) <= relative * scale));
};
export const symmetrize = (a: Matrix): Matrix => a.map((row, i) => row.map((x, j) => (x + a[j][i]) / 2));

/**
 * Positive semi-definite within τ = 1e-12·max|P|: Cholesky(P + τI) succeeds, i.e. λ_min > −τ. The
 * design's λ_min ≥ −τ differs only on a measure-zero boundary (plan section 7). The all-zero
 * matrix, where τ = 0, is valid. Scaling P by c > 0 scales τ by c, so validity is scale-invariant.
 */
export function positiveSemidefinite(p: Matrix): boolean {
  const scale = maxAbs(p);
  if (scale === 0) return true;
  const tau = 1e-12 * scale;
  return cholesky(p.map((row, i) => row.map((x, j) => (i === j ? x + tau : x)))) !== null;
}

// W. J. Cody, "Rational Chebyshev approximations for the error function", Math. Comp. 23 (1969),
// as in netlib specfun CALERF; relative error around 1e-15 over the whole range.
const A = [3.16112374387056560e0, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3, 1.85777706184603153e-1];
const B = [2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3];
const C = [5.64188496988670089e-1, 8.88314979438837594e0, 6.61191906371416295e1, 2.98635138197400131e2,
  8.81952221241769090e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3, 2.15311535474403846e-8];
const D = [1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3,
  3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3];
const P = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2,
  6.58749161529837803e-4, 1.63153871373020978e-2];
const Q = [2.56852019228982242e0, 1.87295284992346725e0, 5.27905102951428412e-1, 6.05183413124413191e-2,
  2.33520497626869185e-3];
const SQRT_PI_INVERSE = 5.6418958354775628695e-1;

/** exp(−y²)·r with y² split so the exponent is exact to ~1e-16 (CALERF). */
const scaledTail = (y: number, r: number) => {
  const ysq = Math.trunc(y * 16) / 16;
  const del = (y - ysq) * (y + ysq);
  return Math.exp(-ysq * ysq) * Math.exp(-del) * r;
};

/** Complementary error function. */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x);
  let result: number;
  if (y <= 0.46875) {
    const ysq = y > 1.11e-16 ? y * y : 0;
    let xnum = A[4] * ysq, xden = ysq;
    for (let i = 0; i < 3; i++) { xnum = (xnum + A[i]) * ysq; xden = (xden + B[i]) * ysq; }
    return 1 - x * (xnum + A[3]) / (xden + B[3]);
  } else if (y <= 4) {
    let xnum = C[8] * y, xden = y;
    for (let i = 0; i < 7; i++) { xnum = (xnum + C[i]) * y; xden = (xden + D[i]) * y; }
    result = scaledTail(y, (xnum + C[7]) / (xden + D[7]));
  } else if (y < 26.543) {
    const ysq = 1 / (y * y);
    let xnum = P[5] * ysq, xden = ysq;
    for (let i = 0; i < 4; i++) { xnum = (xnum + P[i]) * ysq; xden = (xden + Q[i]) * ysq; }
    result = scaledTail(y, (SQRT_PI_INVERSE - ysq * (xnum + P[4]) / (xden + Q[4])) / y);
  } else {
    result = 0;
  }
  return x < 0 ? 2 - result : result;
}

/** Standard normal CDF Φ(x) = erfc(−x/√2)/2. Use Φ(−x) for the upper tail, never 1 − Φ(x). */
export const normalCdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);

/** Average ranks (1-based) with ties sharing the mean of their positions. */
export function averageRanks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const ranks = new Array<number>(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1][0] === order[start][0]) end++;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k++) ranks[order[k][1]] = rank;
    start = end + 1;
  }
  return ranks;
}

/** Spearman ρ: Pearson on average ranks; null when either rank vector is constant or n < 2. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const ra = averageRanks(a), rb = averageRanks(b);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(ra), mb = mean(rb);
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
}

/**
 * Standard normal quantile Φ⁻¹(p), Wichura's AS241 (PPND16), relative error about 1e-16 (BACKLOG 103-2). Returns −∞ at
 * p = 0, +∞ at p = 1 and NaN outside [0, 1].
 */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return q * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r
      + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r
      + 3.387132872796366608)
      / (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r
        + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r
        + 1);
  }
  let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
  let value: number;
  if (r <= 5) {
    r -= 1.6;
    value = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r
      + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r
      + 1.42343711074968357734)
      / (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r
        + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r
        + 1);
  } else {
    r -= 5;
    value = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r
      + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r
      + 6.6579046435011037772)
      / (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r
        + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r
        + 1);
  }
  return q < 0 ? -value : value;
}
