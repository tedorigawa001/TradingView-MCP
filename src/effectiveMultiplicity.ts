/**
 * How many independent tests a correlated family behaves like.
 *
 * A Bonferroni threshold built from the nominal count treats twenty-one adjacent lags, or eighteen
 * buckets cut from one series of bars, as twenty-one or eighteen separate chances. They are not:
 * neighbouring lags move together, and buckets share the bars underneath them. The nominal count
 * therefore overstates the multiplicity and the threshold is stricter than the family warrants.
 *
 * Nothing here decides anything. Every value this module produces is reported beside the nominal
 * count and never replaces it, because a smaller effective count loosens a threshold, and a quantity
 * that loosens a threshold must not also be one a researcher can pick after seeing the data. The
 * estimator is fixed in advance and its identity travels with the result so a later reader can tell
 * which one produced the number.
 */

const METHODOLOGY = "effective_multiplicity_v1" as const;

/**
 * The pre-registered estimator. Alone among the four it makes no assumption about the shape of a
 * test statistic: each test is scored against its own null column, so only dependence between tests
 * survives into the family minimum. It is also unaffected by whether statistics arrive signed or
 * folded, which the eigenvalue estimators are not.
 */
export const PRE_REGISTERED_EFFECTIVE_MULTIPLICITY_ESTIMATOR = "empirical_null_minimum_p_value" as const;

export type EffectiveMultiplicityEstimator =
  | typeof PRE_REGISTERED_EFFECTIVE_MULTIPLICITY_ESTIMATOR
  | "li_ji_2005"
  | "galwey_2009"
  | "cheverud_nyholt";

export type EffectiveMultiplicityEstimate = {
  schemaVersion: "1.0";
  methodologyVersion: typeof METHODOLOGY;
  status: "available" | "not_evaluable";
  /** The count a Bonferroni threshold is actually built from. Unchanged by anything here. */
  nominalTests: number;
  replications: number;
  preRegisteredEstimator: typeof PRE_REGISTERED_EFFECTIVE_MULTIPLICITY_ESTIMATOR;
  /**
   * The pre-registered estimate, held inside the one to family-size range the quantity lives in.
   * A family behaves like at least one independent test and at most as many as it holds; anything
   * outside that is the sampling and discreteness of an empirical quantile, not an estimate.
   */
  effectiveTests: number | null;
  /**
   * The same estimate before that bound was applied. A clamped one and a genuine one are otherwise
   * indistinguishable, and a reader who cannot tell which they are looking at is worse off than one
   * given the raw number.
   */
  rawEffectiveTests: number | null;
  /**
   * How far the pre-registered estimate moves on replication count alone. At the thousand
   * replications the empirical nulls here run, an independent family of twenty-one measures anywhere
   * from about seventeen to about thirty, so the point estimate on its own reads far more precise
   * than it is. Reported so it cannot.
   */
  effectiveTestsInterval: { lower: number; upper: number; confidenceLevel: 0.95 } | null;
  /**
   * The estimate one step either side on the grid the replications allow. A p-value from n draws
   * lives on multiples of 1/n, so the count this inverts to is discrete, and coarsely so where it
   * matters: at a thousand replications an eighteen-test family can only read 10.2, 12.8 or 17.1.
   * Two studies landing on the same number have not necessarily agreed about anything.
   */
  attainableNeighbours: { below: number | null; above: number | null } | null;
  estimates: Record<EffectiveMultiplicityEstimator, number | null>;
  nominalAlpha: number;
  interpretation: string;
  usage: "reported_only_never_used_in_any_eligibility_decision";
  limitations: string[];
};

/**
 * Per-replication p-values for one test, taken against that test own null column.
 *
 * Reading the family maximum against a standard normal instead was wrong in exactly the case this
 * module exists for. A Fisher-z built on serially correlated returns is far wider than a standard
 * normal, so inverting its tail through the normal reported tens of thousands of independent tests
 * in a family of twenty-five. Ranks within each column carry no distributional assumption at all,
 * and a count that cannot exceed its own family is the only kind worth reporting.
 */
function columnPValues(column: number[]): number[] {
  const magnitudes = column.map(Math.abs);
  const sorted = [...magnitudes].sort((left, right) => left - right);
  return magnitudes.map((value) => {
    // Index of the first null draw at least as extreme, so the count above it needs no scan.
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle] < value) low = middle + 1;
      else high = middle;
    }
    // Leave the point itself out: it is one of the draws, and counting it would floor every p-value
    // at 1/n for a reason that has nothing to do with the data.
    return (sorted.length - low) / sorted.length;
  });
}

function quantile(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Eigenvalues of a symmetric matrix by cyclic Jacobi rotation. Families here hold tens of tests, not
 * thousands, so the simple and numerically forgiving method is the right one.
 */
export function symmetricEigenvalues(matrix: number[][]): number[] {
  const size = matrix.length;
  const a = matrix.map((row) => [...row]);
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let offDiagonal = 0;
    for (let row = 0; row < size - 1; row += 1) {
      for (let column = row + 1; column < size; column += 1) offDiagonal += a[row][column] ** 2;
    }
    if (offDiagonal <= 1e-18) break;
    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < size; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < size; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return Array.from({ length: size }, (_, index) => a[index][index]).sort((left, right) => right - left);
}

function correlationMatrix(columns: number[][]): number[][] | null {
  const size = columns.length;
  const means = columns.map((column) => column.reduce((sum, value) => sum + value, 0) / column.length);
  const deviations = columns.map((column, index) => column.map((value) => value - means[index]));
  const norms = deviations.map((column) => Math.sqrt(column.reduce((sum, value) => sum + value * value, 0)));
  // A test whose null statistic never moves has no correlation with anything, and every estimator
  // below would divide by its zero spread rather than report that.
  if (norms.some((norm) => !(norm > 0))) return null;
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    matrix[row][row] = 1;
    for (let column = row + 1; column < size; column += 1) {
      let dot = 0;
      for (let index = 0; index < deviations[row].length; index += 1) {
        dot += deviations[row][index] * deviations[column][index];
      }
      const value = dot / (norms[row] * norms[column]);
      matrix[row][column] = value;
      matrix[column][row] = value;
    }
  }
  return matrix;
}

export interface EffectiveMultiplicityInput {
  /**
   * Null replications of the family, one row per replication and one column per test. Both the
   * dependence between tests and the distribution of the family maximum come from this one object,
   * so the two never describe different nulls.
   */
  nullStatistics: number[][];
  /** Bonferroni is built from this many tests. Reported unchanged for comparison. */
  nominalTests: number;
  nominalAlpha: number;
}

export function estimateEffectiveMultiplicity(input: EffectiveMultiplicityInput): EffectiveMultiplicityEstimate {
  const replications = input.nullStatistics.length;
  const width = input.nullStatistics[0]?.length ?? 0;
  const notEvaluable = (reason: string): EffectiveMultiplicityEstimate => ({
    schemaVersion: "1.0",
    methodologyVersion: METHODOLOGY,
    status: "not_evaluable",
    nominalTests: input.nominalTests,
    replications,
    preRegisteredEstimator: PRE_REGISTERED_EFFECTIVE_MULTIPLICITY_ESTIMATOR,
    effectiveTests: null,
    rawEffectiveTests: null,
    effectiveTestsInterval: null,
    attainableNeighbours: null,
    estimates: { empirical_null_minimum_p_value: null, li_ji_2005: null, galwey_2009: null, cheverud_nyholt: null },
    nominalAlpha: input.nominalAlpha,
    interpretation: "effective multiplicity could not be estimated from the supplied null replications",
    usage: "reported_only_never_used_in_any_eligibility_decision",
    limitations: [reason],
  });

  if (!(input.nominalAlpha > 0 && input.nominalAlpha < 1)) return notEvaluable("nominal_alpha_outside_the_open_unit_interval");
  if (width < 2) return notEvaluable("a_family_of_fewer_than_two_tests_has_no_multiplicity_to_reduce");
  if (replications < 100) return notEvaluable("fewer_than_one_hundred_null_replications");
  if (input.nullStatistics.some((row) => row.length !== width || row.some((value) => !Number.isFinite(value)))) {
    return notEvaluable("null_replications_are_ragged_or_hold_non_finite_statistics");
  }

  // Measured, and distribution-free. Each test is scored against its own null column, so what is
  // left in the minimum across tests is dependence between them and nothing else. The count of
  // independent uniform tests reproducing that minimum at nominal_alpha is the count the family
  // behaves as if it had.
  const columns = Array.from({ length: width }, (_, test) => input.nullStatistics.map((row) => row[test]));
  const pValueColumns = columns.map(columnPValues);
  const minimumPValues = input.nullStatistics.map((_, replication) =>
    pValueColumns.reduce((best, column) => Math.min(best, column[replication]), 1));
  const sortedMinima = [...minimumPValues].sort((left, right) => left - right);
  const countFromQuantile = (tail: number): number | null =>
    tail > 0 && tail < 1 ? Math.log1p(-input.nominalAlpha) / Math.log1p(-tail) : null;
  const rawEffectiveTests = countFromQuantile(quantile(sortedMinima, input.nominalAlpha));
  // The ceiling is the number of columns measured rather than nominalTests, which may count
  // configuration trials the null replications know nothing about. In every wired family the two
  // agree; where they do not, only the measured family bounds the measured quantity.
  const hold = (value: number | null): number | null =>
    value === null ? null : Math.min(width, Math.max(1, value));
  const minimumPValueCount = hold(rawEffectiveTests);
  // The quantile itself is an order statistic of the replications, so its own sampling spread is
  // what the estimate inherits. Carried through the same transform rather than reported on the
  // quantile, where nobody would think to apply it.
  const probability = input.nominalAlpha;
  const spread = 1.959963984540054 * Math.sqrt(replications * probability * (1 - probability));
  const lowIndex = Math.max(0, Math.min(replications - 1, Math.floor(replications * probability - spread)));
  const highIndex = Math.max(0, Math.min(replications - 1, Math.ceil(replications * probability + spread)));
  // A larger alpha-quantile of the minimum p-value means fewer effective tests, so the quantile
  // bounds map to the interval the other way round.
  const fromLowQuantile = hold(countFromQuantile(sortedMinima[lowIndex]));
  const fromHighQuantile = hold(countFromQuantile(sortedMinima[highIndex]));
  // One step either way on the 1/replications grid the minimum p-value is confined to.
  const step = quantile(sortedMinima, input.nominalAlpha);
  const attainableNeighbours = {
    below: hold(countFromQuantile(step + 1 / replications)),
    above: hold(countFromQuantile(Math.max(1 / replications, step - 1 / replications))),
  };
  const effectiveTestsInterval = fromLowQuantile !== null && fromHighQuantile !== null
    ? { lower: Math.min(fromLowQuantile, fromHighQuantile),
        upper: Math.max(fromLowQuantile, fromHighQuantile), confidenceLevel: 0.95 as const }
    : null;

  const matrix = correlationMatrix(columns);
  let liJi: number | null = null;
  let galwey: number | null = null;
  let cheverudNyholt: number | null = null;
  if (matrix !== null) {
    const eigenvalues = symmetricEigenvalues(matrix);
    liJi = eigenvalues.reduce((sum, value) => {
      const magnitude = Math.abs(value);
      return sum + (magnitude >= 1 ? 1 : 0) + (magnitude - Math.floor(magnitude));
    }, 0);
    const nonNegative = eigenvalues.map((value) => Math.max(0, value));
    const total = nonNegative.reduce((sum, value) => sum + value, 0);
    galwey = total > 0 ? nonNegative.reduce((sum, value) => sum + Math.sqrt(value), 0) ** 2 / total : null;
    const mean = eigenvalues.reduce((sum, value) => sum + value, 0) / width;
    const variance = eigenvalues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / width;
    cheverudNyholt = 1 + (width - 1) * (1 - variance / width);
  }

  const estimates: Record<EffectiveMultiplicityEstimator, number | null> = {
    empirical_null_minimum_p_value: minimumPValueCount,
    li_ji_2005: liJi,
    galwey_2009: galwey,
    cheverud_nyholt: cheverudNyholt,
  };
  return {
    schemaVersion: "1.0",
    methodologyVersion: METHODOLOGY,
    status: minimumPValueCount === null ? "not_evaluable" : "available",
    nominalTests: input.nominalTests,
    replications,
    preRegisteredEstimator: PRE_REGISTERED_EFFECTIVE_MULTIPLICITY_ESTIMATOR,
    effectiveTests: minimumPValueCount,
    rawEffectiveTests,
    effectiveTestsInterval: minimumPValueCount === null ? null : effectiveTestsInterval,
    attainableNeighbours: minimumPValueCount === null ? null : attainableNeighbours,
    estimates,
    nominalAlpha: input.nominalAlpha,
    interpretation:
      "the number of independent tests whose family-wise error at nominal_alpha matches this family; " +
      "smaller than nominal_tests means the Bonferroni threshold in force is stricter than the family requires",
    usage: "reported_only_never_used_in_any_eligibility_decision",
    limitations: [
      "estimated from the same null replications that calibrate the family, so it inherits their assumptions",
      "the eigenvalue estimators are derived for signed statistics and are reported for comparison only; " +
        "where the family statistic is folded they understate the dependence",
      "an effective count below the nominal one is not on its own a reason to relax any threshold",
      "the interval covers replication noise alone and not error in the null model that produced the replications",
      "the estimate is quantised by the replication count and is coarse in the range a family of this size occupies",
      ...(rawEffectiveTests !== null && minimumPValueCount !== null && Math.abs(rawEffectiveTests - minimumPValueCount) > 1e-9
        ? ["the_estimate_fell_outside_one_to_family_size_and_was_held_at_the_bound_see_raw_effective_tests"]
        : []),
      ...(matrix === null ? ["a_test_with_no_variation_under_the_null_left_the_correlation_matrix_undefined"] : []),
    ],
  };
}
