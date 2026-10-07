import type { ChartInfo, TradingView } from "./tradingview.js";

type ChartStateApi = Pick<TradingView, "getChartContext" | "setSymbol" | "setResolution">;
type ChartTarget = { symbol?: string; resolution?: string };
/**
 * `exchangeOptional` lets a requested symbol without an exchange prefix ("EURUSD") stand for a listing of that ticker
 * on whichever exchange TradingView resolves it to ("OANDA:EURUSD"); the transaction then binds to the resolved symbol.
 * Only a change the user asks for takes it. Research evidence is bound to the exact symbol it names, so every other
 * caller leaves it unset, and a requested symbol that names its exchange is matched exactly either way.
 */
type ChartTargetOptions = { resolutionFirst?: boolean; exchangeOptional?: boolean };

const normalizeResolution = (value: string) => {
  const upper = value.trim().toUpperCase();
  if (/^[SDWM]$/.test(upper)) return `1${upper}`;
  const hours = upper.match(/^(\d+)H$/);
  return hours ? String(Number(hours[1]) * 60) : upper;
};

const sameSymbol = (left: string, right: string) => left.toUpperCase() === right.toUpperCase();
/** A symbol behind one exchange name, capturing all that follows it. Exchange names are letters, digits and "_". */
const BEHIND_EXCHANGE = /^[A-Z0-9_]+:(.+)$/i;

/**
 * Whether the chart's symbol is the requested one, or with `exchangeOptional` exactly the requested text behind one
 * exchange name. The text is compared whole, so a listing whose ticker holds a "/" ("NYSE:BAC/PL" for "BAC/PL")
 * satisfies it, while a formula chart holding the requested ticker among others ("OANDA:EURUSD/OANDA:USDJPY",
 * "2*OANDA:EURUSD") does not: each of its tickers has more than an exchange name before it or more formula after it.
 * A requested symbol that names its own exchange is matched exactly.
 */
const symbolSatisfies = (actual: string, requested: string, exchangeOptional: boolean) => {
  if (sameSymbol(actual, requested)) return true;
  if (!exchangeOptional || requested.includes(":")) return false;
  const behind = BEHIND_EXCHANGE.exec(actual)?.[1];
  return behind !== undefined && sameSymbol(behind, requested);
};
const sameResolution = (left: string, right: string) =>
  normalizeResolution(left) === normalizeResolution(right);

export async function readChartState(api: ChartStateApi, chartIndex: number): Promise<ChartInfo> {
  if (!Number.isInteger(chartIndex) || chartIndex < 0) throw new Error("chartIndex must be a non-negative integer");
  const chart = (await api.getChartContext()).charts.find((candidate) => candidate.index === chartIndex);
  if (!chart) throw new Error(`chart index ${chartIndex} is not available`);
  return { ...chart, studies: chart.studies.map((study) => ({ ...study })) };
}

export async function assertChartState(
  api: ChartStateApi,
  chartIndex: number,
  expected: { symbol: string; resolution: string },
): Promise<ChartInfo> {
  const chart = await readChartState(api, chartIndex);
  if (!sameSymbol(chart.symbol, expected.symbol)) {
    throw new Error(`chart ${chartIndex} symbol ${chart.symbol} does not match expected ${expected.symbol}`);
  }
  if (!sameResolution(chart.resolution, expected.resolution)) {
    throw new Error(`chart ${chartIndex} timeframe ${chart.resolution} does not match expected ${expected.resolution}`);
  }
  return chart;
}

async function applyChartTarget(
  api: ChartStateApi,
  chartIndex: number,
  target: { symbol: string; resolution: string },
  options: ChartTargetOptions = {},
) {
  const operations: Array<{ kind: "symbol" | "timeframe"; result: unknown }> = [];
  const exchangeOptional = options.exchangeOptional === true;
  let current = await readChartState(api, chartIndex);
  let symbol = target.symbol;
  const setResolution = async () => {
    if (!sameResolution(current.resolution, target.resolution)) {
      operations.push({ kind: "timeframe", result: await api.setResolution(target.resolution, chartIndex) });
      current = await readChartState(api, chartIndex);
    }
  };
  const setSymbol = async () => {
    if (!symbolSatisfies(current.symbol, symbol, exchangeOptional)) {
      operations.push({ kind: "symbol", result: await api.setSymbol(symbol, chartIndex) });
      current = await readChartState(api, chartIndex);
      if (!symbolSatisfies(current.symbol, symbol, exchangeOptional)) {
        throw new Error(`chart ${chartIndex} symbol change did not verify: requested ${symbol}, chart shows ${current.symbol}`);
      }
    }
    // From here the chart must keep the symbol it resolved to.
    symbol = current.symbol;
  };
  if (options.resolutionFirst) { await setResolution(); await setSymbol(); }
  else { await setSymbol(); await setResolution(); }
  const verified = await assertChartState(api, chartIndex, { symbol, resolution: target.resolution });
  return { operations, verified };
}

export async function restoreChartState(
  api: ChartStateApi,
  chartIndex: number,
  original: { symbol: string; resolution: string },
) {
  return applyChartTarget(api, chartIndex, original);
}

export async function changeChartState(
  api: ChartStateApi,
  chartIndex: number,
  target: ChartTarget,
  options: ChartTargetOptions = {},
) {
  const original = await readChartState(api, chartIndex);
  const requested = {
    symbol: target.symbol ?? original.symbol,
    resolution: target.resolution ?? original.resolution,
  };
  try {
    const applied = await applyChartTarget(api, chartIndex, requested, options);
    const lastResult = applied.operations.at(-1)?.result;
    const bars = lastResult && typeof lastResult === "object" && !Array.isArray(lastResult) &&
      typeof (lastResult as { bars?: unknown }).bars === "number"
      ? (lastResult as { bars: number }).bars
      : null;
    return {
      original: { symbol: original.symbol, resolution: original.resolution },
      current: { symbol: applied.verified.symbol, resolution: applied.verified.resolution },
      changed: applied.operations.length > 0,
      bars,
      operations: applied.operations,
    };
  } catch (err) {
    try {
      await restoreChartState(api, chartIndex, original);
    } catch (restoreErr) {
      const first = err instanceof Error ? err.message : String(err);
      const second = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
      throw new Error(`chart state change failed (${first}) and rollback also failed (${second})`);
    }
    throw err;
  }
}

export async function withTemporaryChartState<T>(
  api: ChartStateApi,
  chartIndex: number,
  target: ChartTarget,
  operation: () => Promise<T>,
  options: { resolutionFirst?: boolean } = {},
) {
  const original = await readChartState(api, chartIndex);
  let change: Awaited<ReturnType<typeof changeChartState>> | null = null;
  let value: T | null = null;
  let operationError: unknown = null;
  let restoreError: unknown = null;
  try {
    change = await changeChartState(api, chartIndex, target, options);
    value = await operation();
  } catch (err) {
    operationError = err;
  } finally {
    try {
      await restoreChartState(api, chartIndex, original);
    } catch (err) {
      restoreError = err;
    }
  }
  return {
    original: { symbol: original.symbol, resolution: original.resolution },
    target: {
      symbol: target.symbol ?? original.symbol,
      resolution: target.resolution ?? original.resolution,
    },
    change,
    value,
    operationError,
    restored: restoreError === null,
    restoreError,
  };
}
