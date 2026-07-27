import type { OhlcvBar } from "./tradingview.js";

/**
 * Price series with no exploitable predictability, used to calibrate what this project treats as a
 * candidate. Running the study tools over these answers a question real data cannot: how often does
 * the whole pipeline, with its folds, regime joins, intervals and multiplicity warnings, produce a
 * candidate when there is provably nothing to find.
 *
 * The null is stated on SIMPLE returns, because that is what the studies being audited measure:
 * `featureOutcomeRelationships` and every event study score an outcome as `close_end / close_signal
 * - 1`. So the price itself is the martingale here, and the Ito term below is required rather than
 * optional. Dropping it would leave the conditional simple-return mean equal to half the step
 * variance, and under regime switching that state is autocorrelated, so any feature that detects
 * recent high volatility would predict a positive simple return. That is a real edge, and a null
 * that contains one cannot calibrate anything.
 *
 * Every model is a martingale difference in returns. `regime_switching_volatility` and
 * `bid_ask_bounce` add the two structures most likely to fool an interval that assumes independent
 * observations, without adding any predictable direction:
 *
 * - `white_noise` is the plain null.
 * - `regime_switching_volatility` clusters variance, so a fold can look calm or violent by accident.
 * - `bid_ask_bounce` gives returns a negative first-order autocorrelation from a spread that has no
 *   information in it, which is exactly what a short-horizon reversal study would misread.
 */
export type SyntheticNullModel = "white_noise" | "regime_switching_volatility" | "bid_ask_bounce";

export interface SyntheticNullSeriesInput {
  model: SyntheticNullModel;
  bars: number;
  seed: number;
  timeframeMinutes: number;
  /** Bar-open timestamp of the first bar, in epoch milliseconds. Must be a whole number of bars. */
  startTimeMs?: number;
  startPrice?: number;
  /** Standard deviation of a single bar log return. */
  volatility?: number;
  /** Half-spread as a fraction of price. Only used by bid_ask_bounce. */
  halfSpread?: number;
}

const MAX_BARS = 50_000;
/** Exported so a caller recording what it ran can name the value actually used, not `undefined`. */
export const MAX_SEED = 0xffffffff;
export const DEFAULT_VOLATILITY = 0.008;
export const DEFAULT_FACTOR_RHO = 0.7;

/**
 * mulberry32. The audit is only meaningful if a reported candidate rate can be reproduced exactly,
 * so the generator never touches Math.random.
 */
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Box-Muller. Returns one standard normal per call, caching the second of each pair. */
const createNormal = (random: () => number): (() => number) => {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const value = spare; spare = null; return value; }
    let u = 0;
    while (u === 0) u = random();
    const v = random();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
};

const DEFAULT_START_MS = Date.UTC(2006, 0, 2);

/**
 * The default start rounded down to a bar boundary. A fixed calendar date is not a whole number of
 * bars since the epoch for every timeframe, so a weekly series could not be generated at all
 * without this, even though the timeframe is inside the accepted range.
 */
const defaultStartTimeMs = (stepMs: number): number => Math.floor(DEFAULT_START_MS / stepMs) * stepMs;

const NULL_MODELS = new Set<SyntheticNullModel>(["white_noise", "regime_switching_volatility", "bid_ask_bounce"]);

function validateInput(input: SyntheticNullSeriesInput) {
  // The audit reports the model it believes it ran. Leaving this to the type system alone meant an
  // unknown name reached no branch below and quietly produced white noise under another label,
  // which would put a wrong process name next to every candidate rate it produced.
  if (!NULL_MODELS.has(input.model)) {
    throw new Error(`synthetic null model must be one of ${[...NULL_MODELS].join(", ")}`);
  }
  if (!Number.isInteger(input.bars) || input.bars < 2 || input.bars > MAX_BARS) {
    throw new Error(`synthetic null bars must be an integer from 2 to ${MAX_BARS}`);
  }
  // mulberry32 keeps 32 bits of state, so a wider seed would silently fold onto one already used
  // and an audit counting independent seeds would overstate how many trials it actually ran.
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > MAX_SEED) {
    throw new Error("synthetic null seed must be an integer from 0 to 4294967295");
  }
  if (!Number.isInteger(input.timeframeMinutes) || input.timeframeMinutes < 1 || input.timeframeMinutes > 10_080) {
    throw new Error("synthetic null timeframe minutes must be an integer from 1 to 10080");
  }
  const volatility = input.volatility ?? DEFAULT_VOLATILITY;
  if (!Number.isFinite(volatility) || volatility <= 0 || volatility > 0.5) {
    throw new Error("synthetic null volatility must be greater than zero and at most 0.5");
  }
  const startPrice = input.startPrice ?? 100;
  if (!Number.isFinite(startPrice) || startPrice <= 0) throw new Error("synthetic null start price must be positive");
  const halfSpread = input.halfSpread ?? 0.0004;
  if (!Number.isFinite(halfSpread) || halfSpread < 0 || halfSpread > 0.05) {
    throw new Error("synthetic null half spread must be between zero and 0.05");
  }
  return { volatility, startPrice, halfSpread };
}

/**
 * Builds bars from a mid-price path. The extremes are drawn independently of the return, so a bar
 * range carries no information about the next one, and the OHLC relations the study tools require
 * hold by construction rather than by luck.
 */
function barsFromPath(
  path: number[],
  normal: () => number,
  random: () => number,
  volatility: number,
  timeframeMinutes: number,
  startTimeMs: number,
): OhlcvBar[] {
  const stepMs = timeframeMinutes * 60_000;
  const bars: OhlcvBar[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const open = path[index - 1];
    const close = path[index];
    const upperWick = Math.abs(normal()) * volatility * 0.5;
    const lowerWick = Math.abs(normal()) * volatility * 0.5;
    const time = Math.floor((startTimeMs + (index - 1) * stepMs) / 1000);
    // At the top of the accepted ranges the Ito term subtracts enough log price per bar that a long
    // series underflows to exactly zero, and a zero OHLC breaks every study downstream. Refusing to
    // emit the series is the honest outcome: the generator cannot represent what was asked for.
    if (!Number.isFinite(open) || open <= 0 || !Number.isFinite(close) || close <= 0) {
      throw new Error(`synthetic null price reached ${close} at bar ${index - 1}: reduce volatility or bars`);
    }
    bars.push({
      time,
      timeIso: new Date(time * 1000).toISOString(),
      open,
      // Scaling by exp keeps both extremes strictly positive for any wick draw. A linear
      // (1 - wick) factor turns negative once a tail exceeds one, which the allowed volatility
      // range can reach, and a negative low is a bar no validator downstream would accept.
      high: Math.max(open, close) * Math.exp(upperWick),
      low: Math.min(open, close) * Math.exp(-lowerWick),
      close,
      volume: Math.round(1_000 + random() * 1_000),
    });
  }
  return bars;
}

/** Returns `bars` closed bars. No bar is marked forming: a null series has no live edge to model. */
export function generateSyntheticNullSeries(input: SyntheticNullSeriesInput): OhlcvBar[] {
  const { volatility, startPrice, halfSpread } = validateInput(input);
  const stepMs = input.timeframeMinutes * 60_000;
  const startTimeMs = input.startTimeMs ?? defaultStartTimeMs(stepMs);
  if (!Number.isInteger(startTimeMs) || startTimeMs % stepMs !== 0) {
    throw new Error("synthetic null start time must be a whole number of bars since the epoch");
  }
  const random = createRandom(input.seed);
  const normal = createNormal(random);

  // The mid path is a martingale in price under every model. Only the variance process and the
  // observed-price transform differ, so any candidate the tools report is produced by the pipeline.
  // The Ito term keeps the conditional simple-return mean at zero whatever the volatility state is,
  // which is what makes the regime-switching model a null rather than a volatility-timing edge.
  const mid: number[] = [startPrice];
  let logVariance = Math.log(volatility);
  for (let index = 0; index < input.bars; index += 1) {
    let stepVolatility = volatility;
    if (input.model === "regime_switching_volatility") {
      // A slow mean-reverting drift in log volatility, so folds inherit different variance without
      // any change in expected return.
      logVariance += (Math.log(volatility) - logVariance) * 0.02 + normal() * 0.15;
      stepVolatility = Math.exp(logVariance);
    }
    mid.push(mid[index] * Math.exp(normal() * stepVolatility - 0.5 * stepVolatility * stepVolatility));
  }

  if (input.model !== "bid_ask_bounce") {
    return barsFromPath(mid, normal, random, volatility, input.timeframeMinutes, startTimeMs);
  }

  // Every observation lands on the bid or the ask at random. The mid is still a martingale, but the
  // observed close series now reverses on itself, which is the classic way a reversal study finds
  // an effect that cannot be traded because it lives entirely inside the spread.
  const observed = mid.map((value) => value * (1 + (random() < 0.5 ? -halfSpread : halfSpread)));
  return barsFromPath(observed, normal, random, volatility, input.timeframeMinutes, startTimeMs);
}

/**
 * Two series sharing a common factor. Contemporaneous correlation is real, every lagged relation is
 * absent, which is the null a lead/lag scan has to survive: it should see the factor at lag zero and
 * nothing at any tradable lag.
 *
 * Both legs are white noise at constant volatility. `model` is therefore not a parameter here: this
 * generator has no clustered-variance or bounce variant to select, and accepting the name while
 * ignoring it would let an audit label a run with a process it never used.
 */
export function generateFactorNullPair(
  input: Omit<SyntheticNullSeriesInput, "model"> & { rho?: number; model?: "white_noise" },
): {
  primary: OhlcvBar[];
  reference: OhlcvBar[];
} {
  if (input.model !== undefined && input.model !== "white_noise") {
    throw new Error("factor null pairs are white noise only; the model cannot be selected");
  }
  const { volatility, startPrice } = validateInput({ ...input, model: "white_noise" });
  // `rho` is the contemporaneous return correlation itself, not a loading. Giving both legs the same
  // signed loading on one factor made a negative value produce a positive correlation, and any
  // magnitude above one zeroed the idiosyncratic term and pinned the pair at exactly +1.
  const rho = input.rho ?? DEFAULT_FACTOR_RHO;
  if (!Number.isFinite(rho) || rho < -1 || rho > 1) throw new Error("factor null rho must be between -1 and 1");
  const stepMs = input.timeframeMinutes * 60_000;
  const startTimeMs = input.startTimeMs ?? defaultStartTimeMs(stepMs);
  if (!Number.isInteger(startTimeMs) || startTimeMs % stepMs !== 0) {
    throw new Error("synthetic null start time must be a whole number of bars since the epoch");
  }
  const random = createRandom(input.seed);
  const normal = createNormal(random);
  const primaryPath = [startPrice];
  const referencePath = [startPrice];
  const idiosyncraticShare = Math.sqrt(1 - rho * rho);
  for (let index = 0; index < input.bars; index += 1) {
    // One shared shock per bar, drawn once and used at the same index in both legs. Carrying it to a
    // neighbouring index would plant exactly the lead the scan is supposed to fail to find.
    const factor = normal();
    const primaryReturn = factor * volatility;
    const referenceReturn = (rho * factor + idiosyncraticShare * normal()) * volatility;
    primaryPath.push(primaryPath[index] * Math.exp(primaryReturn - 0.5 * volatility * volatility));
    referencePath.push(referencePath[index] * Math.exp(referenceReturn - 0.5 * volatility * volatility));
  }
  return {
    primary: barsFromPath(primaryPath, normal, random, volatility, input.timeframeMinutes, startTimeMs),
    reference: barsFromPath(referencePath, normal, random, volatility, input.timeframeMinutes, startTimeMs),
  };
}
