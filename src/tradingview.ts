import type { CdpClient } from "./cdp.js";

export interface StudyRef {
  id: string;
  name: string;
}

export interface ChartInfo {
  index: number;
  symbol: string;
  resolution: string;
  studies: StudyRef[];
}

export interface ChartContext {
  layoutName: string | null;
  activeChartIndex: number | null;
  chartsCount: number;
  charts: ChartInfo[];
}

export interface ExecutionQuote {
  chartIndex: number;
  symbol: string;
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
  lpTime: number | null;
  updateMode: string | null;
  currentSession: string | null;
  hubRealtimeLoaded: boolean | null;
  tradeLoaded: boolean | null;
  pricescale: number | null;
  minmov: number | null;
  minmove2: number | null;
  fractional: boolean | null;
  type: string | null;
  currency: string | null;
  exchange: string | null;
  timezone: string | null;
  session: string | null;
}

export interface OhlcvBar {
  time: number;
  timeIso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  /** Present on the most recent bar when it is still forming (heuristic). */
  forming?: boolean;
}

export interface OhlcvResult {
  symbol: string;
  resolution: string;
  count: number;
  bars: OhlcvBar[];
}

export interface IndicatorPlot {
  id: string;
  title: string;
  type: string;
}

export interface IndicatorValues {
  id: string;
  name: string;
  visible?: boolean;
  hasError?: boolean;
  /** false for oscillator panes (RSI etc.) whose values are not prices. */
  isPriceStudy?: boolean;
  plots: IndicatorPlot[];
  bars: Array<{
    time: number;
    timeIso: string;
    values: Record<string, number | string | null>;
  }>;
  error?: string;
}

export interface IndicatorInput {
  id: string;
  name: string;
  type: string;
  value: unknown;
  defval: unknown;
  tooltip: string | null;
}

export interface IndicatorInputs {
  id: string;
  name: string;
  title: string | null;
  inputs: IndicatorInput[];
  error?: string;
}

export interface GraphicLabel {
  time: number | null;
  timeEstimated?: boolean;
  price: number | null;
  text: string;
  size: string | null;
}

export interface GraphicLine {
  time1: number | null;
  price1: number | null;
  time2: number | null;
  price2: number | null;
  extend: string | null;
  width: number | null;
}

export interface GraphicBox {
  time1: number | null;
  time2: number | null;
  priceHigh: number | null;
  priceLow: number | null;
  text: string | null;
}

export interface IndicatorGraphics {
  id: string;
  name: string;
  /** false for oscillator panes whose y coordinates are not prices. */
  isPriceStudy?: boolean;
  totals: { labels: number; lines: number; boxes: number };
  labels: GraphicLabel[];
  lines: GraphicLine[];
  boxes: GraphicBox[];
  error?: string;
}

export interface IndicatorTableTooltip {
  row: number;
  column: number;
  tooltip: string;
}

export interface IndicatorTable {
  id: number | string;
  /** Pine table position, e.g. "top_right", "bottom_right". */
  position: string | null;
  rows: number;
  columns: number;
  cellCount: number;
  /**
   * Cell texts as grid[row][column]; "" for cells the indicator left empty.
   * Omitted when the table currently has no cells (e.g. hidden by an input).
   */
  grid?: string[][];
  tooltips?: IndicatorTableTooltip[];
  error?: string;
}

export interface IndicatorTables {
  id: string;
  name: string;
  tables: IndicatorTable[];
  error?: string;
}

export interface HistoryLoadResult {
  requested: number;
  barsBefore: number;
  barsAfter: number;
  added: number;
  earliestTime: number | null;
  moreAvailable: boolean | null;
}

export interface Alert {
  id: number | string;
  name: string | null;
  symbol: string;
  resolution: string | null;
  condition: unknown;
  message: string | null;
  active: boolean;
  type: string | null;
  createTime: string | number | null;
  lastFireTime: string | number | null;
  expiration: string | number | null;
  lastError: string | null;
}

export interface CreatePriceAlertOptions {
  symbol: string;
  resolution: string;
  operator: "cross_up" | "cross_down";
  level: number;
  expiration: string;
  name: string;
  message: string;
  mobilePush: boolean;
  popup: boolean;
  playSound: boolean;
}

export interface WatchlistSection {
  name: string | null;
  symbols: string[];
}

export interface Watchlist {
  id: number | string;
  name: string;
  type: string | null;
  symbolCount: number;
  sections: WatchlistSection[];
}

export interface KeyLevel {
  price: number;
  /** Signed distance from the current price in percent (positive = above). */
  distancePercent: number;
  kind: "plot" | "line" | "box" | "label";
  study: string;
  /** Plot title, label text, or box/line description — where the level comes from. */
  detail: string;
  time: number | null;
}

export interface KeyLevelsResult {
  symbol: string;
  resolution: string;
  /** Current price (last close, possibly of a forming bar). */
  price: number;
  rangePercent: number;
  count: number;
  /** Sorted by absolute distance from the current price. */
  levels: KeyLevel[];
}

// Plot titles that explicitly name a price level. Without this filter every
// numeric plot of a price study becomes a "level" — including plain
// open/high/low/close mirrors and unnamed plot_N outputs, which sit on top of
// the current price and read like fake support/resistance.
const LEVEL_TITLE_PATTERN =
  /(resist|support|s\/r|pivot|vwap|band|bos|choch|breaker|order\s*block|\bob\b|fvg|imbalance|supply|demand|poc|value\s*area|equilibrium|liquidity|key\s*level|\blevel\b|zone|\b[rs][1-6]\b|レジスタンス|抵抗|サポート|支持|節目)/i;

export interface PineScriptUsage {
  chartIndex: number;
  studyId: string;
  name: string;
  version: string | null;
}

export interface PineScript {
  /** e.g. "USER;adc40b1dfee344f19412f1ae9af74f3f" — input for get_pine_source. */
  pineId: string;
  name: string;
  /** "study" or "strategy". */
  kind: string | null;
  version: string | null;
  /** Chart studies currently rendered from this script, if any. */
  usedBy: PineScriptUsage[];
}

export interface PineSource {
  pineId: string;
  name: string;
  kind: string | null;
  version: string | null;
  updated: string | number | null;
  sourceLength: number;
  /** Full Pine source, e.g. starting with "//@version=5". */
  source: string;
}

export interface SetIndicatorInputResult {
  studyId: string;
  /** Confirmed post-write value for each input, read back after settling. */
  applied: Array<{ id: string; name: string; value: unknown }>;
  /** False when the 20s deadline hit before the recalculation went quiet. */
  settled: boolean;
  /** Present when settled is false: dependent reads may still be stale. */
  warning?: string;
}

export interface StrategyTradeSide {
  time: number | null;
  timeIso: string | null;
  price: number | null;
  /** Order id/comment from the strategy, e.g. "Long", "Short Exit". */
  label: string | null;
}

export interface StrategyTrade {
  number: number | null;
  direction: "long" | "short" | null;
  entry: StrategyTradeSide | null;
  exit: StrategyTradeSide | null;
  profit: number | null;
  profitPercent: number | null;
  cumulativeProfit: number | null;
  quantity: number | null;
}

export interface StrategyLedgerTrade extends StrategyTrade {
  /** Zero-based position in TradingView's report.trades array. */
  reportIndex: number;
  status: "closed" | "open";
  durationMilliseconds: number | null;
  commission: number | null;
  commissionPercent: number | null;
  runUp: number | null;
  runUpPercent: number | null;
  drawDown: number | null;
  drawDownPercent: number | null;
}

export interface StrategyTradeLedger {
  schemaVersion: "1.0";
  ledgerId: string;
  strategy: string | null;
  symbol: string | null;
  timeframe: string | null;
  studyId: string | null;
  pineId: string | null;
  pineVersion: string | null;
  inputs: Array<{ id: string; name: string; value: string | number | boolean | null }>;
  currency: string | null;
  initialCapital: number | null;
  dateRange: { from: string | null; to: string | null } | null;
  summary: Record<string, number | null>;
  totalTrades: number | null;
  availableTrades: number;
  countMatchesSummary: boolean | null;
  ordering: "strategy_report";
  offset: number;
  limit: number;
  returned: number;
  nextOffset: number | null;
  complete: boolean;
  unavailableFields: string[];
  qualityIssues: string[];
  trades: StrategyLedgerTrade[];
}

export interface StrategyReport {
  strategy: string | null;
  currency: string | null;
  initialCapital: number | null;
  dateRange: { from: string | null; to: string | null } | null;
  /** Percent-style fields are fractions: 0.33 means 33%. */
  summary: Record<string, number | null>;
  totalTrades: number | null;
  /** Most recent trades, chronological. */
  trades: StrategyTrade[];
}

export interface BacktestResult extends StrategyReport {
  pineId: string;
  /** Study id when kept on the chart, otherwise null. */
  studyId: string | null;
  keptOnChart: boolean;
  removedFromChart: boolean;
  warning?: string;
}

export interface ReplayStatus {
  available: boolean;
  toolbarVisible: boolean;
  started: boolean;
  ready: boolean;
  autoplay: boolean;
  jumpToBarMode: boolean;
  currentTime: number | null;
  currentTimeIso: string | null;
  selectedTime: number | null;
  selectedTimeIso: string | null;
  currentResolution: string | null;
  replayResolutions: string[];
  autoResolution: string | null;
  autoplayDelayMs: number | null;
  activeChart: { symbol: string; resolution: string; index: number | null };
}

export interface ReplayStepResult {
  requestedSteps: number;
  completedSteps: number;
  reachedEnd: boolean;
  before: ReplayStatus;
  after: ReplayStatus;
}

export interface PineSaveDryRun {
  dryRun: true;
  action: "create_new" | "new_version";
  pineId: string | null;
  name: string | null;
  currentVersion: string | null;
  currentSourceLength: number | null;
  newSourceLength: number;
  note: string;
}

export interface PineCompileMessage {
  line: number | null;
  column: number | null;
  message: string;
}

export interface PineSaveResult {
  dryRun: false;
  action: "create_new" | "new_version";
  /** Whether a version was persisted (happens even when compilation fails). */
  saved: boolean;
  pineId: string | null;
  name: string | null;
  version: string | null;
  compileOk: boolean;
  compileErrors: PineCompileMessage[];
  compileWarnings: PineCompileMessage[];
  /** True when the fetched-back latest source equals the submitted source. */
  verified: boolean;
  revertHint?: string;
}

// Only the user's own workspace scripts ("USER;<id>"). Published/protected
// script ids ("PUB;...") are rejected so no third-party source is ever pulled.
const PINE_ID_PATTERN = /^USER;[\w]{8,64}$/;

const PINE_VERSION_PATTERN = /^(last|[0-9]{1,6}(\.[0-9]{1,3})?)$/;

const MAX_PINE_SOURCE = 200_000;

// TradingView removed TradingViewApi.backtestingStrategyApi in a 2026 app
// update. Current builds keep the same report on the active chart model's
// strategy source. Normalize both layouts behind the WatchedValue-shaped
// surface consumed by report formatting and recalculation settling.
const BACKTESTING_API_SNIPPET = `
  const resolveBacktestingApi = async (api, chart) => {
    if (typeof api.backtestingStrategyApi === "function") {
      return await api.backtestingStrategyApi();
    }
    const model = chart && chart._chartWidget &&
      chart._chartWidget._lineToolsSynchronizer &&
      chart._chartWidget._lineToolsSynchronizer._chartModel;
    if (!model) return null;
    const activeSource = () => {
      let holder = null;
      try {
        holder = typeof model.activeStrategySource === "function"
          ? model.activeStrategySource()
          : model._activeStrategySource;
      } catch (e) {}
      try {
        return holder && typeof holder.value === "function" ? holder.value() : holder;
      } catch (e) {
        return null;
      }
    };
    const reportFor = (source) => {
      if (!source) return null;
      try {
        if (typeof source.reportData === "function") return source.reportData();
      } catch (e) {}
      return source._reportData || null;
    };
    const metaFor = (source) => {
      if (!source) return null;
      try {
        if (typeof source.metaInfo === "function") return source.metaInfo();
      } catch (e) {}
      return source._metaInfo || null;
    };
    return {
      activeStrategy: { value: () => activeSource() },
      activeStrategyMetaInfo: { value: () => metaFor(activeSource()) },
      activeStrategyReportData: { value: () => reportFor(activeSource()) },
    };
  };
`;

// In-page helper shared by getStrategyReport and runBacktest: shapes the raw
// backtesting report into the StrategyReport structure above.
const FORMAT_REPORT_SNIPPET = `
  const iso = (ms) => (typeof ms === "number" && isFinite(ms) ? new Date(ms).toISOString() : null);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const formatReport = (bt, tradesLimit) => {
    // The report WatchedValue outlives a removed strategy — a report is only
    // trustworthy while a strategy is actually active on the chart.
    const act = bt.activeStrategy.value();
    if (act === null || act === undefined) return null;
    const report = bt.activeStrategyReportData.value();
    if (!report || !report.performance) return null;
    const p = report.performance;
    const a = p.all || {};
    let strategy = null;
    try { strategy = bt.activeStrategyMetaInfo.value()?.description ?? null; } catch (e) {}
    if (!strategy) {
      try {
        if (typeof act.metaInfo === "function") strategy = act.metaInfo().description ?? null;
      } catch (e) {}
    }
    const dr = report.settings && report.settings.dateRange && report.settings.dateRange.backtest;
    const side = (s) => (s ? { time: num(s.time), timeIso: iso(s.time), price: num(s.price), label: typeof s.id === "string" ? s.id : null } : null);
    const dirOf = (t) => {
      const ty = t && t.entry ? String(t.entry.type || "") : "";
      return ty.startsWith("s") ? "short" : ty.startsWith("l") ? "long" : null;
    };
    const trades = (Array.isArray(report.trades) ? report.trades : []).slice(-tradesLimit).map((t) => ({
      number: num(t.tradeNumber),
      direction: dirOf(t),
      entry: side(t.entry),
      exit: side(t.exit),
      profit: t.profit ? num(t.profit.value) : null,
      profitPercent: t.profit ? num(t.profit.percentValue) : null,
      cumulativeProfit: t.cumulativeProfit ? num(t.cumulativeProfit.value) : null,
      quantity: num(t.quantity),
    }));
    return {
      strategy,
      currency: report.currency ?? null,
      initialCapital: num(p.initialCapital),
      dateRange: dr ? { from: iso(dr.from), to: iso(dr.to) } : null,
      summary: {
        netProfit: num(a.netProfit),
        netProfitPercent: num(a.netProfitPercent),
        totalTrades: num(a.totalTrades),
        winningTrades: num(a.numberOfWiningTrades),
        losingTrades: num(a.numberOfLosingTrades),
        percentProfitable: num(a.percentProfitable),
        profitFactor: num(a.profitFactor),
        grossProfit: num(a.grossProfit),
        grossLoss: num(a.grossLoss),
        commissionPaid: num(a.commissionPaid),
        avgTrade: num(a.avgTrade),
        avgWinTrade: num(a.avgWinTrade),
        avgLosTrade: num(a.avgLosTrade),
        ratioAvgWinAvgLoss: num(a.ratioAvgWinAvgLoss),
        avgBarsInTrade: num(a.avgBarsInTrade),
        maxDrawdown: num(p.maxStrategyDrawDown),
        maxDrawdownPercent: num(p.maxStrategyDrawDownPercent),
        sharpeRatio: num(p.sharpeRatio),
        sortinoRatio: num(p.sortinoRatio),
        buyHoldReturnPercent: num(p.buyHoldReturnPercent),
        openPL: num(p.openPL),
      },
      totalTrades: num(a.totalTrades),
      trades,
    };
  };
`;

const STUDY_ID_PATTERN = /^[\w$]{1,64}$/;

const INPUT_ID_PATTERN = /^[\w$]{1,64}$/;

// Pine-internal inputs (script source/id) — never writable via setIndicatorInput.
const HIDDEN_INPUT_IDS = new Set(["text", "pineId", "pineVersion", "pineFeatures", "__profile"]);

function assertStudyId(studyId: string): void {
  if (typeof studyId !== "string" || !STUDY_ID_PATTERN.test(studyId)) {
    throw new Error(
      `studyId must match ${STUDY_ID_PATTERN} — get ids from get_chart_context`,
    );
  }
}

function assertChartIndex(chartIndex: number | undefined): void {
  if (chartIndex !== undefined && (!Number.isInteger(chartIndex) || chartIndex < 0)) {
    throw new Error(`chartIndex must be a non-negative integer, got ${chartIndex}`);
  }
}

const REPLAY_STATUS_SNIPPET = `
  const replayStatus = () => {
    const unwrap = (value) => value && typeof value.value === "function" ? value.value() : value;
    const finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
    const iso = (value) => {
      const number = finite(value);
      if (number === null) return null;
      const date = new Date(Math.abs(number) >= 1e12 ? number : number * 1000);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    const chart = api.activeChart();
    let index = null;
    try { index = api.activeChartIndex(); } catch (e) {}
    const currentTime = finite(unwrap(replay.currentDate()));
    const selectedTime = finite(unwrap(replay.getReplaySelectedDate()));
    const resolutions = unwrap(replay.replayResolutions());
    const currentResolution = unwrap(replay.currentReplayResolution());
    const autoResolution = unwrap(replay.autoReplayResolution());
    return {
      available: unwrap(replay.isReplayAvailable()) === true,
      toolbarVisible: unwrap(replay.isReplayToolbarVisible()) === true,
      started: unwrap(replay.isReplayStarted()) === true,
      ready: unwrap(replay.isReadyToPlay()) === true,
      autoplay: unwrap(replay.isAutoplayStarted()) === true,
      jumpToBarMode: unwrap(replay.isJumpToBarModeEnabled()) === true,
      currentTime,
      currentTimeIso: iso(currentTime),
      selectedTime,
      selectedTimeIso: iso(selectedTime),
      currentResolution: typeof currentResolution === "string" ? currentResolution : null,
      replayResolutions: Array.isArray(resolutions)
        ? resolutions.filter((value) => typeof value === "string").slice(0, 100) : [],
      autoResolution: typeof autoResolution === "string" ? autoResolution : null,
      autoplayDelayMs: finite(replay.autoplayDelay()),
      activeChart: { symbol: chart.symbol(), resolution: chart.resolution(), index },
    };
  };
`;

/**
 * High-level TradingView operations built on the in-page charting API
 * (window.TradingViewApi) exposed by the desktop app.
 */
export class TradingView {
  constructor(private cdp: CdpClient) {}

  /** Current layout state: all charts with symbol, resolution and indicators. */
  getChartContext(): Promise<ChartContext> {
    return this.cdp.evaluate<ChartContext>(`
      (() => {
        const api = window.TradingViewApi;
        if (!api) throw new Error("TradingViewApi not found on page");
        const count = api.chartsCount();
        const charts = [];
        for (let i = 0; i < count; i++) {
          const c = api.chart(i);
          let studies = [];
          try { studies = c.getAllStudies().map((s) => ({ id: s.id, name: s.name })); } catch (e) {}
          charts.push({ index: i, symbol: c.symbol(), resolution: c.resolution(), studies });
        }
        let layoutName = null;
        try { layoutName = api.layoutName(); } catch (e) {}
        let activeChartIndex = null;
        try { activeChartIndex = api.activeChartIndex(); } catch (e) {}
        return { layoutName, activeChartIndex, chartsCount: count, charts };
      })()
    `);
  }

  /** Read-only state of TradingView Bar Replay. */
  getReplayStatus(): Promise<ReplayStatus> {
    return this.cdp.evaluate<ReplayStatus>(`
      (async () => {
        const api = window.TradingViewApi;
        if (!api || typeof api.replayApi !== "function") {
          throw new Error("Bar Replay API is unavailable in this app session");
        }
        const replay = await api.replayApi();
        ${REPLAY_STATUS_SNIPPET}
        return replayStatus();
      })()
    `);
  }

  /** Start Bar Replay at a caller-bound historical instant on the active chart. */
  startReplay(options: {
    startAt: string;
    expectedSymbol: string;
    expectedResolution: string;
  }): Promise<{ requestedStartAt: string; status: ReplayStatus }> {
    const startMs = Date.parse(options.startAt);
    if (!Number.isFinite(startMs)) throw new Error("startAt must be a valid ISO-8601 timestamp");
    if (startMs >= Date.now()) throw new Error("startAt must be in the past");
    if (typeof options.expectedSymbol !== "string" || options.expectedSymbol.trim() === "") {
      throw new Error("expectedSymbol must be a non-empty string");
    }
    if (!/^[0-9]*[SDWM]?$/i.test(options.expectedResolution) || options.expectedResolution === "") {
      throw new Error("expectedResolution must be a TradingView resolution");
    }
    return this.cdp.evaluate(`
      (async () => {
        const api = window.TradingViewApi;
        if (!api || typeof api.replayApi !== "function") throw new Error("Bar Replay API is unavailable");
        const replay = await api.replayApi();
        const chart = api.activeChart();
        const expectedSymbol = ${JSON.stringify(options.expectedSymbol)};
        const expectedResolution = ${JSON.stringify(options.expectedResolution)};
        const normalize = (value) => {
          const upper = String(value).trim().toUpperCase();
          return /^[SDWM]$/.test(upper) ? "1" + upper : upper;
        };
        if (chart.symbol().toUpperCase() !== expectedSymbol.toUpperCase()) {
          throw new Error("active chart symbol does not match expectedSymbol");
        }
        if (normalize(chart.resolution()) !== normalize(expectedResolution)) {
          throw new Error("active chart timeframe does not match expectedResolution");
        }
        ${REPLAY_STATUS_SNIPPET}
        const before = replayStatus();
        if (!before.available) throw new Error("Bar Replay is unavailable for this chart");
        if (before.started || before.toolbarVisible) {
          throw new Error("Bar Replay is already active; stop it before starting another session");
        }
        try {
          await replay.selectDate(${startMs});
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            const current = replayStatus();
            if (current.started && current.currentTime !== null) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          if (!replayStatus().started) {
            throw new Error("Bar Replay did not start within 20 seconds");
          }
          return {
            requestedStartAt: ${JSON.stringify(new Date(startMs).toISOString())},
            status: replayStatus(),
          };
        } catch (error) {
          let rollbackError = null;
          try {
            const partial = replayStatus();
            if (partial.started || partial.toolbarVisible) {
              await replay.stopReplay();
              const rollbackDeadline = Date.now() + 10000;
              while (Date.now() < rollbackDeadline) {
                const restored = replayStatus();
                if (!restored.started && !restored.toolbarVisible) break;
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              const restored = replayStatus();
              if (restored.started || restored.toolbarVisible) {
                throw new Error("Bar Replay cleanup did not finish within 10 seconds");
              }
            }
          } catch (cleanupError) {
            rollbackError = cleanupError;
          }
          if (rollbackError !== null) {
            throw new Error(
              "Bar Replay start failed (" + String(error?.message || error) +
              ") and cleanup also failed (" + String(rollbackError?.message || rollbackError) + ")",
            );
          }
          throw error;
        }
      })()
    `);
  }

  /** Advance a paused replay by a bounded number of bars. */
  stepReplay(steps = 1): Promise<ReplayStepResult> {
    if (!Number.isInteger(steps) || steps < 1 || steps > 100) {
      throw new Error(`steps must be an integer between 1 and 100, got ${steps}`);
    }
    return this.cdp.evaluate<ReplayStepResult>(`
      (async () => {
        const api = window.TradingViewApi;
        if (!api || typeof api.replayApi !== "function") throw new Error("Bar Replay API is unavailable");
        const replay = await api.replayApi();
        ${REPLAY_STATUS_SNIPPET}
        const before = replayStatus();
        if (!before.started || !before.ready) throw new Error("Bar Replay is not ready for stepping");
        if (before.autoplay) throw new Error("pause Bar Replay autoplay before stepping");
        let completedSteps = 0;
        let reachedEnd = false;
        for (let i = 0; i < ${steps}; i += 1) {
          const prior = replayStatus().currentTime;
          await replay.doStep();
          const deadline = Date.now() + 5000;
          let advanced = false;
          while (Date.now() < deadline) {
            const current = replayStatus();
            if (!current.started) { reachedEnd = true; break; }
            if (current.currentTime !== null && current.currentTime !== prior) { advanced = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          if (!advanced) { reachedEnd = true; break; }
          completedSteps += 1;
        }
        return { requestedSteps: ${steps}, completedSteps, reachedEnd, before, after: replayStatus() };
      })()
    `);
  }

  /** Close Bar Replay and verify that the chart returned to real-time mode. */
  stopReplay(): Promise<{ changed: boolean; before: ReplayStatus; after: ReplayStatus }> {
    return this.cdp.evaluate(`
      (async () => {
        const api = window.TradingViewApi;
        if (!api || typeof api.replayApi !== "function") throw new Error("Bar Replay API is unavailable");
        const replay = await api.replayApi();
        ${REPLAY_STATUS_SNIPPET}
        const before = replayStatus();
        if (!before.started && !before.toolbarVisible) return { changed: false, before, after: before };
        await replay.stopReplay();
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const current = replayStatus();
          if (!current.started && !current.toolbarVisible) return { changed: true, before, after: current };
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("Bar Replay did not stop within 10 seconds");
      })()
    `);
  }

  /** Live quote state already attached to each open chart's main series. */
  getExecutionQuotes(): Promise<ExecutionQuote[]> {
    return this.cdp.evaluate<ExecutionQuote[]>(`
      (() => {
        const api = window.TradingViewApi;
        if (!api) throw new Error("TradingViewApi not found on page");
        const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
        const text = (value) => typeof value === "string" && value.length > 0 ? value : null;
        const result = [];
        for (let i = 0; i < api.chartsCount(); i++) {
          const chart = api.chart(i);
          const series = chart.chartModel().mainSeries();
          const quote = series.quotes?.() || {};
          const info = series.symbolInfo?.() || {};
          result.push({
            chartIndex: i,
            symbol: chart.symbol(),
            bid: number(quote.bid),
            ask: number(quote.ask),
            lastPrice: number(quote.last_price),
            lpTime: number(quote.lp_time),
            updateMode: text(quote.update_mode),
            currentSession: text(quote.current_session),
            hubRealtimeLoaded: typeof quote.hub_rt_loaded === "boolean" ? quote.hub_rt_loaded : null,
            tradeLoaded: typeof quote.trade_loaded === "boolean" ? quote.trade_loaded : null,
            pricescale: number(quote.pricescale ?? info.pricescale),
            minmov: number(quote.minmov ?? info.minmov),
            minmove2: number(quote.minmove2 ?? info.minmove2),
            fractional: typeof (quote.fractional ?? info.fractional) === "boolean" ? (quote.fractional ?? info.fractional) : null,
            type: text(quote.type ?? info.type),
            currency: text(quote.currency_code ?? info.currency_code),
            exchange: text(quote.exchange ?? info.exchange),
            timezone: text(quote.timezone ?? info.timezone),
            session: text(info.session),
          });
        }
        return result;
      })()
    `);
  }

  /**
   * OHLCV bars loaded in a chart. Reads the internal series model because
   * the desktop build disables the official exportData() API.
   */
  getOhlcv(count: number, chartIndex?: number): Promise<OhlcvResult> {
    if (!Number.isFinite(count) || count < 1) {
      throw new Error(`count must be a positive number, got ${count}`);
    }
    assertChartIndex(chartIndex);
    const chartExpr =
      chartIndex === undefined ? "api.activeChart()" : `api.chart(${chartIndex})`;
    return this.cdp.evaluate<OhlcvResult>(`
      (() => {
        const api = window.TradingViewApi;
        const chart = ${chartExpr};
        const items = chart.chartModel().mainSeries().bars()._items;
        if (!items) throw new Error("no bar data loaded");
        const resolution = chart.resolution();
        // bar duration in seconds, for the forming-bar heuristic
        const resolutionSeconds = (res) => {
          const u = String(res).toUpperCase();
          if (/^\\d+$/.test(u)) return parseInt(u, 10) * 60; // plain numbers are minutes
          const m = u.match(/^(\\d*)([SDWM])$/);
          if (!m) return null;
          const n = parseInt(m[1] || "1", 10);
          return n * { S: 1, D: 86400, W: 604800, M: 2592000 }[m[2]];
        };
        const barSec = resolutionSeconds(resolution);
        const lastTime = items.length ? items[items.length - 1].value[0] : null;
        const nowSec = Date.now() / 1000;
        const lastIsForming =
          barSec !== null && lastTime !== null && nowSec < lastTime + barSec;

        const bars = items.slice(-${Math.max(1, Math.floor(count))}).map((it, i, arr) => {
          const bar = {
            time: it.value[0],
            timeIso: new Date(it.value[0] * 1000).toISOString(),
            open: it.value[1],
            high: it.value[2],
            low: it.value[3],
            close: it.value[4],
            volume: it.value[5] ?? null,
          };
          if (lastIsForming && i === arr.length - 1 && it.value[0] === lastTime) {
            bar.forming = true;
          }
          return bar;
        });
        return {
          symbol: chart.symbol(),
          resolution,
          count: bars.length,
          bars,
        };
      })()
    `);
  }

  /**
   * Recent plot values of indicators (studies) on a chart. By default,
   * cosmetic plots (colorers, alert conditions) are filtered out.
   */
  getIndicatorValues(
    options: {
      studyId?: string;
      count?: number;
      chartIndex?: number;
      includeAllPlots?: boolean;
    } = {},
  ): Promise<IndicatorValues[]> {
    const { studyId, count = 10, chartIndex, includeAllPlots = false } = options;
    if (studyId !== undefined) assertStudyId(studyId);
    if (!Number.isFinite(count) || count < 1) {
      throw new Error(`count must be a positive number, got ${count}`);
    }
    assertChartIndex(chartIndex);
    const chartExpr =
      chartIndex === undefined ? "api.activeChart()" : `api.chart(${chartIndex})`;
    return this.cdp.evaluate<IndicatorValues[]>(`
      (() => {
        const api = window.TradingViewApi;
        const chart = ${chartExpr};
        const studyIdFilter = ${studyId === undefined ? "null" : JSON.stringify(studyId)};
        const includeAllPlots = ${includeAllPlots ? "true" : "false"};
        const maxBars = ${Math.floor(count)};

        const sourceById = {};
        for (const s of chart.chartModel().dataSources()) {
          if (typeof s.id === "function") sourceById[s.id()] = s;
        }
        const studies = chart
          .getAllStudies()
          .filter((st) => studyIdFilter === null || st.id === studyIdFilter);
        if (studies.length === 0) {
          throw new Error(
            studyIdFilter === null
              ? "no indicators on this chart"
              : "study " + studyIdFilter + " not found; get ids from get_chart_context",
          );
        }

        // ohlc_* types come from plotcandle() — a duplicate of get_ohlcv used
        // only to color-code candles, carrying no information of its own.
        const isNoisePlot = (type) =>
          /colorer/i.test(type) || type === "alertcondition" || type === "textcolor" || /^ohlc_/.test(type);

        return studies.map((st) => {
          const out = { id: st.id, name: st.name, plots: [], bars: [] };
          const src = sourceById[st.id];
          if (!src || typeof src.metaInfo !== "function" || typeof src.data !== "function") {
            out.error = "study has no readable data source";
            return out;
          }
          try {
            const studyApi = chart.getStudyById(st.id);
            out.visible = studyApi.isVisible();
            out.hasError = studyApi.hasError();
          } catch (e) {}

          const mi = src.metaInfo();
          if (typeof mi.is_price_study === "boolean") out.isPriceStudy = mi.is_price_study;
          const styles = mi.styles || {};
          const keep = [];
          const usedTitles = new Set();
          (mi.plots || []).forEach((p, i) => {
            if (!includeAllPlots && isNoisePlot(p.type)) return;
            let title = (styles[p.id] && styles[p.id].title) || p.id;
            if (usedTitles.has(title)) title = title + " (" + p.id + ")";
            usedTitles.add(title);
            keep.push({ col: i + 1, id: p.id, type: p.type, title });
          });
          out.plots = keep.map((k) => ({ id: k.id, title: k.title, type: k.type }));

          const items = src.data()._items || [];
          out.bars = items.slice(-maxBars).map((it) => {
            const row = {
              time: it.value[0],
              timeIso: new Date(it.value[0] * 1000).toISOString(),
              values: {},
            };
            for (const k of keep) {
              const v = it.value[k.col];
              row.values[k.title] = v === undefined ? null : v;
            }
            return row;
          });
          return out;
        });
      })()
    `);
  }

  /**
   * Input parameters of indicators (studies) on a chart, with names, current
   * values and defaults. Internal Pine inputs (script source, ids) are excluded.
   */
  getIndicatorInputs(
    options: { studyId?: string; chartIndex?: number } = {},
  ): Promise<IndicatorInputs[]> {
    const { studyId, chartIndex } = options;
    if (studyId !== undefined) assertStudyId(studyId);
    assertChartIndex(chartIndex);
    const chartExpr =
      chartIndex === undefined ? "api.activeChart()" : `api.chart(${chartIndex})`;
    return this.cdp.evaluate<IndicatorInputs[]>(`
      (() => {
        const api = window.TradingViewApi;
        const chart = ${chartExpr};
        const studyIdFilter = ${studyId === undefined ? "null" : JSON.stringify(studyId)};
        // Pine-internal inputs; "text" holds the (possibly protected) script source
        const HIDDEN = new Set(["text", "pineId", "pineVersion", "pineFeatures", "__profile"]);
        const MAX_STRING = 200;

        const studies = chart
          .getAllStudies()
          .filter((st) => studyIdFilter === null || st.id === studyIdFilter);
        if (studies.length === 0) {
          throw new Error(
            studyIdFilter === null
              ? "no indicators on this chart"
              : "study " + studyIdFilter + " not found; get ids from get_chart_context",
          );
        }

        return studies.map((st) => {
          const out = { id: st.id, name: st.name, title: null, inputs: [] };
          let studyApi;
          try {
            studyApi = chart.getStudyById(st.id);
            out.title = studyApi.title();
          } catch (e) {
            out.error = "study API unavailable: " + e.message;
            return out;
          }
          const infoById = {};
          try {
            for (const i of studyApi.getInputsInfo()) infoById[i.id] = i;
          } catch (e) {}
          try {
            out.inputs = studyApi
              .getInputValues()
              .filter((v) => !HIDDEN.has(v.id))
              .map((v) => {
                const meta = infoById[v.id] || {};
                let value = v.value;
                if (typeof value === "string" && value.length > MAX_STRING) {
                  value = value.slice(0, MAX_STRING) + "…(truncated)";
                }
                return {
                  id: v.id,
                  name: meta.localizedName || meta.name || v.id,
                  type: meta.type || typeof v.value,
                  value,
                  defval: meta.defval === undefined ? null : meta.defval,
                  tooltip: meta.tooltip || null,
                };
              });
          } catch (e) {
            out.error = "cannot read inputs: " + e.message;
          }
          return out;
        });
      })()
    `);
  }

  /**
   * Change input values of an indicator or strategy already on a chart —
   * the write counterpart to getIndicatorInputs. The Pine source is
   * untouched, but the study's input values on the chart remain changed
   * until set back — a live chart edit, exactly like opening its Settings
   * dialog (and possibly captured by TradingView's own layout autosave).
   * Works for both plain indicators and strategies (a strategy's backtest
   * report recalculates and can be read via get_strategy_report).
   */
  setIndicatorInput(
    studyId: string,
    inputs: Array<{ id: string; value: unknown }>,
    options: { chartIndex?: number } = {},
  ): Promise<SetIndicatorInputResult> {
    assertStudyId(studyId);
    assertChartIndex(options.chartIndex);
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 20) {
      throw new Error("inputs must be a non-empty array of at most 20 {id, value} entries");
    }
    for (const inp of inputs) {
      if (!inp || typeof inp.id !== "string" || !INPUT_ID_PATTERN.test(inp.id)) {
        throw new Error(`invalid input id: ${JSON.stringify(inp && inp.id)}`);
      }
      if (HIDDEN_INPUT_IDS.has(inp.id)) {
        throw new Error(`input "${inp.id}" is internal (Pine source/id) and cannot be set`);
      }
      const t = typeof inp.value;
      if (t !== "number" && t !== "string" && t !== "boolean") {
        throw new Error(`input "${inp.id}" value must be a number, string or boolean`);
      }
    }
    const chartExpr =
      options.chartIndex === undefined ? "api.activeChart()" : `api.chart(${options.chartIndex})`;
    return this.cdp.evaluate<SetIndicatorInputResult>(`
      (async () => {
        const api = window.TradingViewApi;
        const chart = ${chartExpr};
        ${BACKTESTING_API_SNIPPET}
        const studyId = ${JSON.stringify(studyId)};
        const inputs = ${JSON.stringify(inputs)};
        let studyApi;
        try {
          studyApi = chart.getStudyById(studyId);
        } catch (e) {
          throw new Error("study " + studyId + " not found; get ids from get_chart_context");
        }
        const before = studyApi.getInputValues();
        for (const inp of inputs) {
          if (!before.some((v) => v.id === inp.id)) {
            throw new Error("study " + studyId + " has no input with id " + inp.id + " — check get_indicator_inputs");
          }
        }

        // Strategies recalculate their backtest report asynchronously; watch
        // for the report object to be replaced (same pattern as run_backtest)
        // AND for the study's own data to settle, so this also works for
        // plain (non-strategy) indicators that have no report at all.
        // The Strategy Tester API is absent until the app initializes it
        // (e.g. right after an app restart with no strategy loaded) — fall
        // back to isLoading-only settling instead of failing the write.
        let bt = null;
        try {
          bt = await resolveBacktestingApi(api, chart);
        } catch (e) {}
        const staleReport = bt ? bt.activeStrategyReportData.value() : null;

        studyApi.setInputValues(inputs);

        const t0 = Date.now();
        // Changing several inputs at once can trigger a recalculation per
        // input, with gaps between them longer than a single quiet window —
        // settling after the first one hands back a stale strategy report.
        // Scale the quiet window with the number of inputs and never settle
        // while the study still reports loading.
        const quietMs = Math.min(1000 + (inputs.length - 1) * 750, 3500);
        const noSignalMs = inputs.length > 1 ? 5000 : 3000;
        let lastReport = staleReport;
        let lastLoading = studyApi.isLoading();
        let lastChangeAt = Date.now();
        let sawChange = false;
        let settled = false;
        while (Date.now() - t0 < 20000) {
          const curReport = bt ? bt.activeStrategyReportData.value() : null;
          const curLoading = studyApi.isLoading();
          if (curReport !== lastReport || curLoading !== lastLoading) {
            lastReport = curReport;
            lastLoading = curLoading;
            lastChangeAt = Date.now();
            sawChange = true;
          }
          if (!curLoading) {
            if (sawChange && Date.now() - lastChangeAt > quietMs) { settled = true; break; }
            if (!sawChange && Date.now() - t0 > noSignalMs) { settled = true; break; } // plain indicators may show no signal at all
          }
          await new Promise((r) => setTimeout(r, 250));
        }

        const after = studyApi.getInputValues();
        const infoById = {};
        try { for (const i of studyApi.getInputsInfo()) infoById[i.id] = i; } catch (e) {}
        const applied = inputs.map((inp) => {
          const found = after.find((v) => v.id === inp.id);
          const meta = infoById[inp.id] || {};
          return { id: inp.id, name: meta.localizedName || meta.name || inp.id, value: found ? found.value : null };
        });
        const result = { studyId, applied, settled };
        if (!settled) {
          result.warning = "inputs were applied, but the study was still recalculating when the 20s " +
            "deadline hit — dependent reads (e.g. get_strategy_report) may return a stale result; " +
            "wait and re-read before trusting them";
        }
        return result;
      })()
    `);
  }

  /**
   * Drawing primitives (labels, lines, boxes) rendered by Pine indicators —
   * the only way to read drawing-only studies (e.g. Elliott Wave labels).
   * Graphic x coordinates are translated to bar times via the study's index
   * map; points projected beyond the last bar get an extrapolated time.
   */
  getIndicatorGraphics(
    options: { studyId?: string; chartIndex?: number; limitPerKind?: number } = {},
  ): Promise<IndicatorGraphics[]> {
    const { studyId, chartIndex, limitPerKind = 50 } = options;
    if (studyId !== undefined) assertStudyId(studyId);
    assertChartIndex(chartIndex);
    if (!Number.isInteger(limitPerKind) || limitPerKind < 1 || limitPerKind > 500) {
      throw new Error(`limitPerKind must be an integer between 1 and 500, got ${limitPerKind}`);
    }
    const chartExpr =
      chartIndex === undefined ? "api.activeChart()" : `api.chart(${chartIndex})`;
    return this.cdp.evaluate<IndicatorGraphics[]>(`
      (() => {
        const api = window.TradingViewApi;
        const chart = ${chartExpr};
        const studyIdFilter = ${studyId === undefined ? "null" : JSON.stringify(studyId)};
        const limit = ${limitPerKind};

        const model = chart.chartModel();
        const items = model.mainSeries().bars()._items || [];
        const firstIndex = items.length ? items[0].index : 0;
        const lastItem = items[items.length - 1];
        const lastIndex = lastItem ? lastItem.index : 0;
        const lastTime = lastItem ? lastItem.value[0] : null;
        const avgDur =
          items.length > 1 ? (lastTime - items[0].value[0]) / (items.length - 1) : null;

        // model bar index -> unix time (estimated beyond the last bar).
        // Raw (pre-materialization) primitives use graphic x that must first
        // go through the study's _indexes map; materialized primitives use
        // model indexes directly (possibly negative after history loads).
        const timeOf = (indexes, x, translate) => {
          if (!Number.isInteger(x)) return { time: null };
          let m = x;
          if (translate && Array.isArray(indexes) && x >= 0 && x < indexes.length) m = indexes[x];
          if (!Number.isInteger(m) || m < -1000000) return { time: null };
          const off = m - firstIndex;
          if (off >= 0 && off < items.length) return { time: items[off].value[0] };
          if (avgDur !== null && m > lastIndex) {
            return { time: Math.round(lastTime + (m - lastIndex) * avgDur), estimated: true };
          }
          return { time: null };
        };

        // Primitives live in _primitivesDataById (raw, before the store is
        // materialized) or _primitiveById (a Map, after). Prefer materialized.
        const collect = (outerMap) => {
          const raw = [];
          const materialized = [];
          if (!(outerMap instanceof Map)) return { prims: [], translate: false };
          for (const inner of outerMap.values()) {
            const stores = typeof inner.values === "function" ? [...inner.values()] : [inner];
            for (const store of stores) {
              if (!store) continue;
              const mat = store._primitiveById;
              if (mat instanceof Map) for (const p of mat.values()) materialized.push(p);
              const byId = store._primitivesDataById;
              if (byId) for (const key of Object.getOwnPropertyNames(byId)) raw.push(byId[key]);
            }
          }
          return materialized.length > 0
            ? { prims: materialized, translate: false }
            : { prims: raw, translate: true };
        };
        const recent = (prims, xOf) =>
          prims.sort((a, b) => (xOf(b) ?? -Infinity) - (xOf(a) ?? -Infinity)).slice(0, limit);

        const studies = chart
          .getAllStudies()
          .filter((st) => studyIdFilter === null || st.id === studyIdFilter);
        if (studies.length === 0) {
          throw new Error(
            studyIdFilter === null
              ? "no indicators on this chart"
              : "study " + studyIdFilter + " not found; get ids from get_chart_context",
          );
        }

        return studies.map((st) => {
          const out = { id: st.id, name: st.name, totals: { labels: 0, lines: 0, boxes: 0 }, labels: [], lines: [], boxes: [] };
          const src = model.dataSources().find((s) => typeof s.id === "function" && s.id() === st.id);
          if (!src || typeof src.graphics !== "function") {
            out.error = "study has no graphics";
            return out;
          }
          try {
            const mi = src.metaInfo();
            if (typeof mi.is_price_study === "boolean") out.isPriceStudy = mi.is_price_study;
          } catch (e) {}
          const g = src.graphics();
          const pc = g._primitivesCollection || {};
          const indexes = g._indexes;

          // raw fields:          labels {x,y,t,sz}  lines {x1..y2,ex,st,w}  boxes {x1,x2,y1,y2,t}
          // materialized fields: labels {x,y,text,size}  lines {x1..y2,extend,width}
          //                      boxes {left,right,top,bottom,text}
          const labelText = (p) => (typeof p.text === "string" ? p.text : p.t) || "";

          const lc = collect(pc.dwglabels);
          const labels = lc.prims.filter((p) => labelText(p).trim() !== "");
          out.totals.labels = labels.length;
          const seen = new Set();
          out.labels = recent(labels, (p) => p.x)
            .map((p) => {
              const t = timeOf(indexes, p.x, lc.translate);
              const row = {
                time: t.time,
                price: p.y ?? null,
                text: labelText(p).trim(),
                size: p.size ?? p.sz ?? null,
              };
              if (t.estimated) row.timeEstimated = true;
              return row;
            })
            .filter((row) => {
              const key = row.time + "|" + row.price + "|" + row.text;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });

          const nc = collect(pc.dwglines);
          out.totals.lines = nc.prims.length;
          out.lines = recent(nc.prims, (p) => p.x2).map((p) => {
            const t1 = timeOf(indexes, p.x1, nc.translate);
            const t2 = timeOf(indexes, p.x2, nc.translate);
            const row = {
              time1: t1.time, price1: p.y1 ?? null,
              time2: t2.time, price2: p.y2 ?? null,
              extend: p.extend ?? p.ex ?? null,
              width: p.width ?? p.w ?? null,
            };
            if (t1.estimated || t2.estimated) row.timeEstimated = true;
            return row;
          });

          const bc = collect(pc.dwgboxes);
          out.totals.boxes = bc.prims.length;
          out.boxes = recent(bc.prims, (p) => p.x2 ?? p.right).map((p) => {
            const bx1 = p.x1 ?? p.left;
            const bx2 = p.x2 ?? p.right;
            const t1 = timeOf(indexes, bx1, bc.translate);
            const t2 = timeOf(indexes, bx2, bc.translate);
            const ys = [p.y1 ?? p.top, p.y2 ?? p.bottom].filter((v) => typeof v === "number");
            const text = (typeof p.text === "string" ? p.text : p.t) || "";
            const row = {
              time1: t1.time, time2: t2.time,
              priceHigh: ys.length ? Math.max(...ys) : null,
              priceLow: ys.length ? Math.min(...ys) : null,
              text: text.trim() !== "" ? text.trim() : null,
            };
            if (t1.estimated || t2.estimated) row.timeEstimated = true;
            return row;
          });

          return out;
        });
      })()
    `);
  }

  /**
   * Tables drawn by Pine indicators (e.g. multi-timeframe trend dashboards),
   * reconstructed as text grids from the dwgtables/dwgtablecells primitives.
   * This is the only way to read table-only summaries that have no plots.
   */
  getIndicatorTables(
    options: { studyId?: string; chartIndex?: number } = {},
  ): Promise<IndicatorTables[]> {
    const { studyId, chartIndex } = options;
    if (studyId !== undefined) assertStudyId(studyId);
    assertChartIndex(chartIndex);
    const chartExpr =
      chartIndex === undefined ? "api.activeChart()" : `api.chart(${chartIndex})`;
    return this.cdp.evaluate<IndicatorTables[]>(`
      (() => {
        const api = window.TradingViewApi;
        const chart = ${chartExpr};
        const studyIdFilter = ${studyId === undefined ? "null" : JSON.stringify(studyId)};
        const MAX_TEXT = 200;
        const MAX_GRID_CELLS = 2000;

        const model = chart.chartModel();
        const studies = chart
          .getAllStudies()
          .filter((st) => studyIdFilter === null || st.id === studyIdFilter);
        if (studies.length === 0) {
          throw new Error(
            studyIdFilter === null
              ? "no indicators on this chart"
              : "study " + studyIdFilter + " not found; get ids from get_chart_context",
          );
        }

        // The nesting depth differs per primitive kind: for dwgtables the
        // outer map's values are map-likes of stores, for dwgtablecells the
        // outer map's values ARE the stores. Accept both shapes.
        const isStore = (o) => !!o && (o._primitiveById instanceof Map || !!o._primitivesDataById);
        const storesOf = (outerMap) => {
          const stores = [];
          if (!(outerMap instanceof Map)) return stores;
          for (const inner of outerMap.values()) {
            if (isStore(inner)) { stores.push(inner); continue; }
            if (!inner || typeof inner.values !== "function") continue;
            for (const store of inner.values()) if (isStore(store)) stores.push(store);
          }
          return stores;
        };
        // Prefer materialized primitives, like get_indicator_graphics does.
        const primsOf = (outerMap) => {
          const materialized = [];
          const raw = [];
          for (const store of storesOf(outerMap)) {
            if (store._primitiveById instanceof Map) {
              for (const p of store._primitiveById.values()) materialized.push(p);
            }
            const byId = store._primitivesDataById;
            if (byId) for (const key of Object.getOwnPropertyNames(byId)) raw.push(byId[key]);
          }
          return materialized.length > 0 ? materialized : raw;
        };
        const clip = (s) => {
          s = String(s);
          return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "…(truncated)" : s;
        };

        return studies.map((st) => {
          const out = { id: st.id, name: st.name, tables: [] };
          const src = model.dataSources().find((s) => typeof s.id === "function" && s.id() === st.id);
          if (!src || typeof src.graphics !== "function") {
            out.error = "study has no graphics";
            return out;
          }
          const pc = src.graphics()._primitivesCollection || {};

          const byTable = new Map();
          const tableOf = (id) => {
            if (!byTable.has(id)) byTable.set(id, { id, position: null, rows: 0, columns: 0, cells: [] });
            return byTable.get(id);
          };
          for (const m of primsOf(pc.dwgtables)) {
            if (m.id === undefined || m.id === null) continue;
            const t = tableOf(m.id);
            if (typeof m.position === "string") t.position = m.position;
            if (Number.isInteger(m.rows)) t.rows = m.rows;
            if (Number.isInteger(m.columns)) t.columns = m.columns;
          }
          for (const c of primsOf(pc.dwgtablecells)) {
            const id = c.tableId;
            if (id === undefined || id === null) continue;
            const row = c.row;
            const column = c.column;
            if (!Number.isInteger(row) || row < 0 || !Number.isInteger(column) || column < 0) continue;
            tableOf(id).cells.push({
              row,
              column,
              text: clip(typeof c.text === "string" ? c.text : ""),
              tooltip: typeof c.tooltip === "string" && c.tooltip !== "" ? clip(c.tooltip) : null,
            });
          }

          out.tables = [...byTable.values()]
            .map((t) => {
              const rows = Math.max(t.rows, ...t.cells.map((c) => c.row + 1), 0);
              const columns = Math.max(t.columns, ...t.cells.map((c) => c.column + 1), 0);
              const base = { id: t.id, position: t.position, rows, columns, cellCount: t.cells.length };
              if (t.cells.length === 0) return base; // declared but currently empty
              if (rows * columns > MAX_GRID_CELLS) {
                return { ...base, error: "table too large to reconstruct (" + rows + "x" + columns + ")" };
              }
              const grid = Array.from({ length: rows }, () => Array(columns).fill(""));
              const tooltips = [];
              for (const c of t.cells) {
                grid[c.row][c.column] = c.text;
                if (c.tooltip) tooltips.push({ row: c.row, column: c.column, tooltip: c.tooltip });
              }
              const table = { ...base, grid };
              if (tooltips.length > 0) table.tooltips = tooltips;
              return table;
            })
            .sort((a, b) => (String(a.id) > String(b.id) ? 1 : -1));
          return out;
        });
      })()
    `);
  }

  /**
   * Ask the chart to load more historical bars (same as the user scrolling
   * left). Loading happens in the background; the visible range is untouched.
   * The desktop build disables setVisibleRange, so this uses the series'
   * own requestMoreData.
   */
  loadMoreHistory(
    options: { count?: number; chartIndex?: number } = {},
  ): Promise<HistoryLoadResult> {
    const { count = 300, chartIndex } = options;
    if (!Number.isInteger(count) || count < 1 || count > 5000) {
      throw new Error(`count must be an integer between 1 and 5000, got ${count}`);
    }
    assertChartIndex(chartIndex);
    const chartExpr =
      chartIndex === undefined ? "api.activeChart()" : `api.chart(${chartIndex})`;
    return this.cdp.evaluate<HistoryLoadResult>(`
      (async () => {
        const api = window.TradingViewApi;
        const chart = ${chartExpr};
        const series = chart.chartModel().mainSeries();
        const bars = () => series.bars()._items || [];
        const barsBefore = bars().length;
        const requested = ${count};

        const available = typeof series.requestMoreDataAvailable === "function"
          ? series.requestMoreDataAvailable()
          : null;
        if (available === false) {
          return {
            requested, barsBefore, barsAfter: barsBefore, added: 0,
            earliestTime: barsBefore ? bars()[0].value[0] : null,
            moreAvailable: false,
          };
        }

        series.requestMoreData(requested);
        const t0 = Date.now();
        let lastCount = barsBefore;
        let lastGrowth = Date.now();
        while (Date.now() - t0 < 15000) {
          await new Promise((r) => setTimeout(r, 250));
          const cur = bars().length;
          if (cur > lastCount) { lastCount = cur; lastGrowth = Date.now(); }
          if (cur - barsBefore >= requested) break;
          if (cur > barsBefore && Date.now() - lastGrowth > 1500) break; // loading went quiet
        }
        const barsAfter = bars().length;
        return {
          requested, barsBefore, barsAfter, added: barsAfter - barsBefore,
          earliestTime: barsAfter ? bars()[0].value[0] : null,
          moreAvailable: typeof series.requestMoreDataAvailable === "function"
            ? series.requestMoreDataAvailable()
            : null,
        };
      })()
    `);
  }

  /**
   * The user's price alerts, read-only, via the alerts REST API with the
   * app's session. This method never changes an alert.
   */
  listAlerts(): Promise<Alert[]> {
    return this.cdp.evaluate<Alert[]>(`
      (async () => {
        const res = await fetch("https://pricealerts.tradingview.com/list_alerts", {
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error("alerts API returned HTTP " + res.status + " — is the app logged in?");
        }
        const json = await res.json();
        const list = Array.isArray(json.r) ? json.r : [];
        // symbol may be a plain ticker or an expression like ={"symbol":"OANDA:USDJPY",...}
        const parseSymbol = (s) => {
          if (typeof s !== "string") return "";
          if (s.startsWith("={")) {
            try { return JSON.parse(s.slice(1)).symbol ?? s; } catch (e) { return s; }
          }
          return s;
        };
        return list.map((a) => ({
          id: a.alert_id,
          name: a.name || null,
          symbol: parseSymbol(a.symbol),
          resolution: a.resolution ?? null,
          condition: a.condition ?? null,
          message: typeof a.message === "string" ? a.message.slice(0, 300) : null,
          active: !!a.active,
          type: a.type ?? null,
          createTime: a.create_time ?? null,
          lastFireTime: a.last_fire_time ?? null,
          expiration: a.expiration ?? null,
          lastError: a.last_error ?? null,
        }));
      })()
    `);
  }

  /** Create one bounded price alert and verify it through list_alerts. */
  createPriceAlert(options: CreatePriceAlertOptions): Promise<{
    requestId: number | string | null;
    alertId: number | string;
    name: string;
    symbol: string;
    resolution: string;
    operator: string;
    level: number;
    expiration: string;
    verified: true;
  }> {
    if (!/^[\w!.:&-]{1,48}$/.test(options.symbol)) throw new Error("symbol has an invalid format");
    if (!/^[A-Za-z0-9]{1,8}$/.test(options.resolution)) throw new Error("resolution has an invalid format");
    if (options.operator !== "cross_up" && options.operator !== "cross_down") throw new Error("operator is unsupported");
    if (!Number.isFinite(options.level) || options.level <= 0) throw new Error("level must be a positive finite number");
    const expirationMs = Date.parse(options.expiration);
    if (!Number.isFinite(expirationMs) || expirationMs <= Date.now()) throw new Error("expiration must be a future ISO timestamp");
    if (!/^BUSHIDO-MCP:[0-9a-f]{16}:(?:confirmation|invalidation|target_1)$/.test(options.name)) {
      throw new Error("name must be a Bushido MCP ownership label");
    }
    if (options.message.length < 1 || options.message.length > 300) throw new Error("message must contain 1 to 300 characters");

    const serialized = JSON.stringify({
      symbol: options.symbol,
      resolution: options.resolution,
      operator: options.operator,
      level: options.level,
      expiration: new Date(expirationMs).toISOString(),
      name: options.name,
      message: options.message,
      mobilePush: options.mobilePush,
      popup: options.popup,
      playSound: options.playSound,
    });
    return this.cdp.evaluate(`
      (async () => {
        const requested = ${serialized};
        const user = globalThis.user;
        if (!user || typeof user.username !== "string" || user.username.length === 0) {
          throw new Error("TradingView alert creation requires a logged-in user");
        }
        if ((typeof globalThis.BUILD_TIME !== "string" && typeof globalThis.BUILD_TIME !== "number")
            || String(globalThis.BUILD_TIME).length === 0) {
          throw new Error("TradingView BUILD_TIME is unavailable");
        }
        const endpoint = new URL("https://pricealerts.tradingview.com/create_alert");
        endpoint.searchParams.set("log_username", user.username);
        endpoint.searchParams.set("build_time", String(globalThis.BUILD_TIME));
        const condition = {
          type: requested.operator,
          frequency: "on_first_fire",
          series: [{ type: "barset" }, { type: "value", value: requested.level }],
          resolution: requested.resolution,
          cross_interval: true,
        };
        const payload = {
          conditions: [condition],
          symbol: requested.symbol,
          resolution: requested.resolution,
          message: requested.message,
          sound_file: requested.playSound ? "alert/calling" : "",
          sound_duration: requested.playSound ? 5 : 0,
          popup: requested.popup,
          auto_deactivate: false,
          email: false,
          sms_over_email: false,
          mobile_push: requested.mobilePush,
          web_hook: null,
          name: requested.name,
          expiration: requested.expiration,
        };
        const response = await fetch(endpoint.toString(), {
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ payload }),
        });
        if (!response.ok) throw new Error("alert creation API returned HTTP " + response.status);
        const created = await response.json();
        if (!created || typeof created !== "object" || !("id" in created) || !("s" in created)) {
          throw new Error("alert creation API returned an invalid response");
        }
        if (created.err) {
          const code = created.err && typeof created.err.code === "string" ? created.err.code : "unknown";
          throw new Error("alert creation API rejected the request: " + code);
        }
        if (created.s !== "ok") throw new Error("alert creation API returned a non-ok status");
        const parseSymbol = (value) => {
          if (typeof value !== "string") return "";
          if (value.startsWith("={")) {
            try { return JSON.parse(value.slice(1)).symbol ?? value; } catch (_) { return value; }
          }
          return value;
        };
        const deadline = Date.now() + 5000;
        do {
          const listResponse = await fetch("https://pricealerts.tradingview.com/list_alerts", {
            credentials: "include",
          });
          if (!listResponse.ok) throw new Error("alert readback API returned HTTP " + listResponse.status);
          const listed = await listResponse.json();
          const match = (Array.isArray(listed.r) ? listed.r : []).find((alert) => {
            const c = alert && typeof alert.condition === "object" ? alert.condition : null;
            const value = Array.isArray(c && c.series)
              ? c.series.find((series) => series && series.type === "value")
              : null;
            return alert.name === requested.name
              && alert.active === true
              && parseSymbol(alert.symbol).toUpperCase() === requested.symbol.toUpperCase()
              && String(alert.resolution) === requested.resolution
              && c && c.type === requested.operator
              && value && value.value === requested.level
              && Math.abs(Date.parse(alert.expiration) - Date.parse(requested.expiration)) <= 1000;
          });
          if (match) {
            return {
              requestId: created.id ?? null,
              alertId: match.alert_id,
              name: match.name,
              symbol: parseSymbol(match.symbol),
              resolution: String(match.resolution),
              operator: match.condition.type,
              level: requested.level,
              expiration: match.expiration,
              verified: true,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        } while (Date.now() < deadline);
        throw new Error("alert creation succeeded but readback verification timed out");
      })()
    `);
  }

  /**
   * Viewport rectangle of one chart in the layout (CSS pixels), for clipped
   * screenshots. Chart containers appear in the DOM in chart-index order.
   */
  getChartRect(chartIndex: number): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    devicePixelRatio: number;
  }> {
    if (!Number.isInteger(chartIndex) || chartIndex < 0) {
      throw new Error(`chartIndex must be a non-negative integer, got ${chartIndex}`);
    }
    return this.cdp.evaluate(`
      (() => {
        const els = document.querySelectorAll(".chart-container");
        if (${chartIndex} >= els.length) {
          throw new Error("chart index ${chartIndex} out of range — layout has " + els.length + " chart(s)");
        }
        const r = els[${chartIndex}].getBoundingClientRect();
        if (r.width < 10 || r.height < 10) throw new Error("chart container has no visible area");
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
          devicePixelRatio: window.devicePixelRatio || 1,
        };
      })()
    `);
  }

  /**
   * The user's own saved Pine scripts (indicators/strategies), via the same
   * pine-facade REST API the built-in Pine Editor uses, with the app's
   * session. Each script is cross-referenced against the charts so the AI can
   * tell which on-chart indicator a script belongs to. Read-only.
   */
  listPineScripts(): Promise<PineScript[]> {
    return this.cdp.evaluate<PineScript[]>(`
      (async () => {
        const res = await fetch("https://pine-facade.tradingview.com/pine-facade/list/?filter=saved", {
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error("pine-facade API returned HTTP " + res.status + " — is the app logged in?");
        }
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error("unexpected pine-facade response shape");
        // Same gate as getPineSource: anything the source tool would refuse
        // must not be listed in the first place.
        const PINE_ID = new RegExp(${JSON.stringify(PINE_ID_PATTERN.source)});

        // pineId -> chart studies rendered from that script
        const usedBy = {};
        const api = window.TradingViewApi;
        try {
          const count = api.chartsCount();
          for (let i = 0; i < count; i++) {
            const c = api.chart(i);
            let studies = [];
            try { studies = c.getAllStudies(); } catch (e) {}
            for (const st of studies) {
              try {
                const vals = c.getStudyById(st.id).getInputValues();
                const pid = (vals.find((v) => v.id === "pineId") || {}).value;
                const version = (vals.find((v) => v.id === "pineVersion") || {}).value;
                if (typeof pid === "string") {
                  (usedBy[pid] = usedBy[pid] || []).push({
                    chartIndex: i,
                    studyId: st.id,
                    name: st.name,
                    version: typeof version === "string" ? version : null,
                  });
                }
              } catch (e) {}
            }
          }
        } catch (e) {}

        return list
          .filter((s) => s && typeof s.scriptIdPart === "string" && PINE_ID.test(s.scriptIdPart))
          .map((s) => ({
            pineId: s.scriptIdPart,
            name: String(s.scriptName ?? ""),
            kind: (s.extra && s.extra.kind) ?? null,
            version: s.version ?? null,
            usedBy: usedBy[s.scriptIdPart] || [],
          }));
      })()
    `);
  }

  /**
   * Full Pine source of one of the user's own saved scripts. Only "USER;..."
   * ids are accepted — published/protected third-party scripts are refused,
   * so the existing source-leak protections stay intact. Older versions can
   * be fetched by number, which is also the revert path after a bad save.
   */
  getPineSource(pineId: string, version: string = "last"): Promise<PineSource> {
    if (typeof pineId !== "string" || !PINE_ID_PATTERN.test(pineId)) {
      throw new Error(
        `pineId must look like "USER;<id>" (own saved scripts only, from list_pine_scripts) — got ${JSON.stringify(pineId)}`,
      );
    }
    if (typeof version !== "string" || !PINE_VERSION_PATTERN.test(version)) {
      throw new Error(`version must be "last" or a version number like "3" — got ${JSON.stringify(version)}`);
    }
    return this.cdp.evaluate<PineSource>(`
      (async () => {
        const pineId = ${JSON.stringify(pineId)};
        const res = await fetch(
          "https://pine-facade.tradingview.com/pine-facade/get/" + encodeURIComponent(pineId) + "/" + ${JSON.stringify(version)},
          { credentials: "include" },
        );
        if (res.status === 403 || res.status === 404) {
          throw new Error("pine-facade returned HTTP " + res.status + " for " + pineId + " — not one of your saved scripts?");
        }
        if (!res.ok) {
          throw new Error("pine-facade API returned HTTP " + res.status + " — is the app logged in?");
        }
        const detail = await res.json();
        if (!detail || typeof detail.source !== "string") {
          throw new Error("unexpected pine-facade response: no source field");
        }
        return {
          pineId,
          name: String(detail.scriptName ?? ""),
          kind: (detail.extra && detail.extra.kind) ?? null,
          version: detail.version ?? null,
          updated: detail.updated ?? null,
          sourceLength: detail.source.length,
          source: detail.source,
        };
      })()
    `);
  }

  /**
   * Save Pine source — the only write tool for the user's script library,
   * guarded by a confirm flow. Without confirm=true nothing is written and a
   * dry-run preview is returned. Writes are strictly non-destructive: a new
   * script (saveNew, never with overwrite) or a new version of an existing
   * script (saveNext; every older version stays retrievable via
   * getPineSource(pineId, version)). Note that pine-facade persists the
   * version even when compilation fails — the result reports compile errors
   * and how to revert.
   */
  async savePineScript(options: {
    source: string;
    pineId?: string;
    name?: string;
    confirm?: boolean;
  }): Promise<PineSaveDryRun | PineSaveResult> {
    const { source, pineId, name, confirm = false } = options;
    if (typeof source !== "string" || source.trim() === "") {
      throw new Error("source must be a non-empty string of Pine code");
    }
    if (source.length > MAX_PINE_SOURCE) {
      throw new Error(`source is too large (${source.length} chars, max ${MAX_PINE_SOURCE})`);
    }
    if (pineId !== undefined && !PINE_ID_PATTERN.test(pineId)) {
      throw new Error(
        `pineId must look like "USER;<id>" (own saved scripts only, from list_pine_scripts) — got ${JSON.stringify(pineId)}`,
      );
    }
    if (pineId === undefined && (typeof name !== "string" || name.trim() === "")) {
      throw new Error("name is required when creating a new script (no pineId given)");
    }
    if (name !== undefined && (typeof name !== "string" || name.trim() === "" || name.length > 100)) {
      throw new Error("name must be a non-empty string of at most 100 characters");
    }
    const action = pineId === undefined ? "create_new" : "new_version";

    if (confirm !== true) {
      const note =
        "DRY RUN — nothing was saved. Review the change with the user, then call again with confirm: true.";
      if (pineId === undefined) {
        return {
          dryRun: true,
          action,
          pineId: null,
          name: name ?? null,
          currentVersion: null,
          currentSourceLength: null,
          newSourceLength: source.length,
          note,
        };
      }
      // also validates that the target script exists and is the user's own
      const current = await this.getPineSource(pineId);
      return {
        dryRun: true,
        action,
        pineId,
        name: name ?? current.name,
        currentVersion: current.version,
        currentSourceLength: current.sourceLength,
        newSourceLength: source.length,
        note,
      };
    }

    return this.cdp.evaluate<PineSaveResult>(`
      (async () => {
        const lib = window.TradingViewApi.pineLibApi();
        const source = ${JSON.stringify(source)};
        const pineId = ${pineId === undefined ? "null" : JSON.stringify(pineId)};
        const name = ${name === undefined ? "null" : JSON.stringify(name)};
        if (!pineId) {
          // a duplicate name makes the server reject with a useless generic
          // error (and we never overwrite) — detect it and say what to do
          try {
            const lr = await fetch("https://pine-facade.tradingview.com/pine-facade/list/?filter=saved", { credentials: "include" });
            if (lr.ok) {
              const scripts = await lr.json();
              const dup = Array.isArray(scripts) ? scripts.find((s) => s && s.scriptName === name) : null;
              if (dup) {
                throw new Error('a script named "' + name + '" already exists (' + dup.scriptIdPart +
                  ") — pass pine_id to save a new version of it, or choose a different name");
              }
            }
          } catch (e) {
            if (e instanceof Error && /already exists/.test(e.message)) throw e;
          }
        }
        let res;
        try {
          if (pineId) {
            const args = { scriptIdPart: pineId, scriptSource: source, isLegacyScript: false };
            if (name) args.scriptName = name;
            res = await lib.saveNext(args);
          } else {
            // never allowOverwrite — new scripts only
            res = await lib.saveNew({ scriptSource: source, scriptName: name });
          }
        } catch (e) {
          // pine-facade rejects with plain strings, not Errors
          throw new Error("pine-facade save failed: " + (typeof e === "string" ? e : (e && e.message) || String(e)));
        }
        const mi = res.metaInfo || {};
        const newPineId = mi.scriptIdPart || pineId || null;
        let version = null;
        let verified = false;
        let savedName = mi.description || name || null;
        if (newPineId) {
          try {
            const g = await fetch(
              "https://pine-facade.tradingview.com/pine-facade/get/" + encodeURIComponent(newPineId) + "/last",
              { credentials: "include" },
            );
            if (g.ok) {
              const d = await g.json();
              version = d.version ?? null;
              // pine-facade normalizes line endings to CRLF on save
              const norm = (s) => String(s).replace(/\\r\\n/g, "\\n");
              verified = norm(d.source) === norm(source);
              if (!savedName && d.scriptName) savedName = d.scriptName;
            }
          } catch (e) {}
        }
        const fmt = (e) => ({
          line: e && e.start && Number.isFinite(e.start.line) ? e.start.line : null,
          column: e && e.start && Number.isFinite(e.start.column) ? e.start.column : null,
          message: String((e && e.message) || "").slice(0, 300),
        });
        const errors = ((res.compileErrors && res.compileErrors.errors) || []).map(fmt);
        const warnings = ((res.compileErrors && res.compileErrors.warnings) || []).map(fmt);
        const compileOk = res.success === true && errors.length === 0;
        const out = {
          dryRun: false,
          action: ${JSON.stringify(action)},
          saved: verified,
          pineId: newPineId,
          name: savedName,
          version,
          compileOk,
          compileErrors: errors,
          compileWarnings: warnings,
          verified,
        };
        if (!compileOk && verified && pineId) {
          out.revertHint = "the broken source was still stored as version " + version +
            " — fetch an older version with get_pine_source(pine_id, version) and save it again to revert";
        }
        return out;
      })()
    `);
  }

  /**
   * Add one of the user's own saved Pine scripts to a chart (the missing
   * "apply" step after saving an improved version). Additive only — this
   * never removes or replaces existing studies; the user can remove the
   * added study from the chart UI.
   */
  addPineToChart(
    pineId: string,
    chartIndex?: number,
  ): Promise<{
    studyId: string;
    name: string | null;
    isStrategy: boolean;
    version: string | null;
    chartIndex: number | null;
  }> {
    if (typeof pineId !== "string" || !PINE_ID_PATTERN.test(pineId)) {
      throw new Error(
        `pineId must look like "USER;<id>" (own saved scripts only, from list_pine_scripts) — got ${JSON.stringify(pineId)}`,
      );
    }
    assertChartIndex(chartIndex);
    const chartExpr =
      chartIndex === undefined ? "api.activeChart()" : `api.chart(${chartIndex})`;
    return this.cdp.evaluate(`
      (async () => {
        const api = window.TradingViewApi;
        const chart = ${chartExpr};
        const pineId = ${JSON.stringify(pineId)};
        // findById is a cache and may not know a freshly saved script yet —
        // use it for metadata when available, but let createStudy decide.
        const repo = api.studyMetaIntoRepository();
        let meta = null;
        try {
          meta = await repo.findById({ type: "pine", pineId, version: "last" });
        } catch (e) {}
        let studyId;
        try {
          studyId = await chart.createStudy({ type: "pine", pineId, version: "last" });
        } catch (e) {
          throw new Error("could not add " + pineId + " to the chart: " +
            (typeof e === "string" ? e : (e && e.message) || e) + " — check list_pine_scripts");
        }
        return {
          studyId,
          name: meta ? meta.description ?? null : null,
          isStrategy: meta ? meta.isTVScriptStrategy === true : false,
          version: meta && meta.pine ? meta.pine.version ?? null : null,
          chartIndex: ${chartIndex === undefined ? "null" : chartIndex},
        };
      })()
    `);
  }

  /** Remove one on-chart instance only after its hidden Pine id matches. */
  removePineFromChart(
    pineId: string,
    studyId: string,
    chartIndex?: number,
  ): Promise<{
    removed: true;
    pineId: string;
    pineVersion: string | null;
    studyId: string;
    name: string;
    chartIndex: number | null;
  }> {
    if (typeof pineId !== "string" || !PINE_ID_PATTERN.test(pineId)) {
      throw new Error(
        `pineId must look like "USER;<id>" (own saved scripts only, from list_pine_scripts) — got ${JSON.stringify(pineId)}`,
      );
    }
    assertStudyId(studyId);
    assertChartIndex(chartIndex);
    const chartExpr =
      chartIndex === undefined ? "api.activeChart()" : `api.chart(${chartIndex})`;
    return this.cdp.evaluate(`
      (async () => {
        const api = window.TradingViewApi;
        const chart = ${chartExpr};
        const pineId = ${JSON.stringify(pineId)};
        const studyId = ${JSON.stringify(studyId)};
        const ref = chart.getAllStudies().find((study) => study.id === studyId);
        if (!ref) throw new Error("study " + studyId + " not found; nothing was removed");
        let values;
        try {
          values = chart.getStudyById(studyId).getInputValues();
        } catch (e) {
          throw new Error("cannot inspect study " + studyId + "; nothing was removed");
        }
        const actualPineId = (values.find((value) => value.id === "pineId") || {}).value;
        const pineVersion = (values.find((value) => value.id === "pineVersion") || {}).value;
        if (actualPineId !== pineId) {
          throw new Error("study " + studyId + " does not belong to " + pineId + "; nothing was removed");
        }
        chart.removeEntity(studyId);
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && chart.getAllStudies().some((study) => study.id === studyId)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (chart.getAllStudies().some((study) => study.id === studyId)) {
          throw new Error("study removal did not settle within 5s");
        }
        return {
          removed: true,
          pineId,
          pineVersion: typeof pineVersion === "string" ? pineVersion : null,
          studyId,
          name: ref.name,
          chartIndex: ${chartIndex === undefined ? "null" : chartIndex},
        };
      })()
    `);
  }

  /**
   * Backtest report of the strategy currently on the active chart (the
   * Strategy Tester data): performance summary, date range, recent trades.
   * Read-only — fails if no strategy is on the chart.
   */
  getStrategyReport(options: { tradesLimit?: number } = {}): Promise<StrategyReport> {
    const { tradesLimit = 20 } = options;
    if (!Number.isInteger(tradesLimit) || tradesLimit < 1 || tradesLimit > 500) {
      throw new Error(`tradesLimit must be an integer between 1 and 500, got ${tradesLimit}`);
    }
    return this.cdp.evaluate<StrategyReport>(`
      (async () => {
        const api = window.TradingViewApi;
        const chart = api.activeChart();
        ${BACKTESTING_API_SNIPPET}
        ${FORMAT_REPORT_SNIPPET}
        const bt = await resolveBacktestingApi(api, chart);
        if (!bt) throw new Error("Strategy Tester data model is unavailable in this app session");
        const report = formatReport(bt, ${tradesLimit});
        if (!report) {
          throw new Error("no strategy report available — the active chart has no strategy (or it is still calculating). Add one or use run_backtest");
        }
        return report;
      })()
    `);
  }

  /**
   * Paginated, read-only trade ledger for the strategy currently active in
   * Strategy Tester. The ledger id covers every normalized trade, allowing a
   * caller to reject pages from a report that recalculated between requests.
   */
  getStrategyTradeLedger(options: {
    offset?: number;
    limit?: number;
    expectedLedgerId?: string;
  } = {}): Promise<StrategyTradeLedger> {
    const { offset = 0, limit = 200, expectedLedgerId } = options;
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000_000) {
      throw new Error(`offset must be an integer between 0 and 10000000, got ${offset}`);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error(`limit must be an integer between 1 and 500, got ${limit}`);
    }
    if (expectedLedgerId !== undefined && !/^sha256:[a-f0-9]{64}$/.test(expectedLedgerId)) {
      throw new Error(`expectedLedgerId must be a sha256 ledger id, got ${JSON.stringify(expectedLedgerId)}`);
    }
    return this.cdp.evaluate<StrategyTradeLedger>(`
      (async () => {
        const api = window.TradingViewApi;
        const offset = ${offset};
        const limit = ${limit};
        const expectedLedgerId = ${expectedLedgerId === undefined ? "null" : JSON.stringify(expectedLedgerId)};
        const chart = api.activeChart();
        ${BACKTESTING_API_SNIPPET}
        const bt = await resolveBacktestingApi(api, chart);
        if (!bt) throw new Error("Strategy Tester data model is unavailable in this app session");
        const act = bt.activeStrategy.value();
        if (act === null || act === undefined) {
          throw new Error("no active strategy — add a strategy to the chart before requesting its trade ledger");
        }
        const report = bt.activeStrategyReportData.value();
        if (!report || !report.performance) {
          throw new Error("no strategy report available — the active strategy may still be calculating");
        }
        const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
        const iso = (ms) => (typeof ms === "number" && isFinite(ms) ? new Date(ms).toISOString() : null);
        const metric = (v) => {
          if (typeof v === "number") return num(v);
          return v && typeof v === "object" ? num(v.value ?? v.v) : null;
        };
        const percent = (v) => v && typeof v === "object" ? num(v.percentValue ?? v.p) : null;
        const performance = report.performance;
        const all = performance.all || {};
        const totalTrades = num(all.totalTrades);
        const side = (s) => (s ? {
          time: num(s.time ?? s.tm),
          timeIso: iso(s.time ?? s.tm),
          price: num(s.price ?? s.p),
          label: typeof (s.id ?? s.c) === "string" ? (s.id ?? s.c) : null,
        } : null);
        const dirOf = (trade) => {
          const entry = trade ? (trade.entry ?? trade.e) : null;
          const type = entry ? String(entry.type ?? entry.tp ?? "") : "";
          return type.startsWith("s") ? "short" : type.startsWith("l") ? "long" : null;
        };
        const normalizeTrade = (trade, reportIndex, markedOpen) => {
          const entry = side(trade.entry ?? trade.e);
          // TradingView appends the live position with a synthetic current-price
          // exit. It is absent from performance.all.totalTrades and has no exit id.
          const exit = markedOpen ? null : side(trade.exit ?? trade.x);
          const runUp = trade.runUp ?? trade.runup ?? trade.maxRunUp ?? trade.rn ?? null;
          const drawDown = trade.drawDown ?? trade.drawdown ?? trade.maxDrawDown ?? trade.dd ?? null;
          const commission = trade.commission ?? trade.cm ?? null;
          const profit = trade.profit ?? trade.tp ?? null;
          const cumulativeProfit = trade.cumulativeProfit ?? trade.cp ?? null;
          return {
            reportIndex,
            number: num(trade.tradeNumber ?? trade.number),
            direction: dirOf(trade),
            status: markedOpen || !exit ? "open" : "closed",
            entry,
            exit,
            durationMilliseconds: entry && exit && entry.time !== null && exit.time !== null
              ? Math.max(0, exit.time - entry.time)
              : null,
            profit: metric(profit),
            profitPercent: percent(profit),
            cumulativeProfit: metric(cumulativeProfit),
            quantity: num(trade.quantity ?? trade.q),
            commission: metric(commission),
            commissionPercent: percent(commission),
            runUp: metric(runUp),
            runUpPercent: percent(runUp),
            drawDown: metric(drawDown),
            drawDownPercent: percent(drawDown),
          };
        };
        const rawTrades = Array.isArray(report.trades) ? report.trades : [];
        const lastRawExit = rawTrades.length > 0
          ? (rawTrades[rawTrades.length - 1].exit ?? rawTrades[rawTrades.length - 1].x)
          : null;
        const lastRawExitLabel = lastRawExit ? (lastRawExit.id ?? lastRawExit.c) : null;
        const markedOpenIndex = totalTrades !== null && rawTrades.length === totalTrades + 1 &&
          lastRawExit !== null && lastRawExitLabel === ""
          ? rawTrades.length - 1
          : -1;
        const allTrades = rawTrades.map((trade, reportIndex) =>
          normalizeTrade(trade, reportIndex, reportIndex === markedOpenIndex));
        const closedTradeCount = allTrades.filter((trade) => trade.status === "closed").length;
        if (offset > allTrades.length) {
          throw new Error("offset " + offset + " exceeds available trade count " + allTrades.length);
        }
        let strategy = null;
        try { strategy = bt.activeStrategyMetaInfo.value()?.description ?? null; } catch (e) {}
        if (!strategy) {
          try {
            if (typeof act.metaInfo === "function") strategy = act.metaInfo().description ?? null;
          } catch (e) {}
        }
        const symbol = typeof chart.symbol === "function" ? chart.symbol() : null;
        const timeframe = typeof chart.resolution === "function" ? chart.resolution() : null;
        let activeId = null;
        if (typeof act === "string") activeId = act;
        else if (act && typeof act.id === "string") activeId = act.id;
        else if (act && typeof act.id === "function") {
          try { activeId = act.id(); } catch (e) {}
        }
        const studyCandidates = chart.getAllStudies().filter((study) =>
          activeId !== null ? study.id === activeId : strategy !== null && study.name === strategy);
        const activeStudy = studyCandidates.length === 1 ? studyCandidates[0] : null;
        let pineId = null;
        let pineVersion = null;
        let inputs = [];
        let unsupportedInputValue = false;
        if (activeStudy) {
          try {
            const studyApi = chart.getStudyById(activeStudy.id);
            const infoById = {};
            try {
              for (const info of studyApi.getInputsInfo()) infoById[info.id] = info;
            } catch (e) {}
            const values = studyApi.getInputValues();
            pineId = typeof values.find((value) => value.id === "pineId")?.value === "string"
              ? values.find((value) => value.id === "pineId").value
              : null;
            pineVersion = typeof values.find((value) => value.id === "pineVersion")?.value === "string"
              ? values.find((value) => value.id === "pineVersion").value
              : null;
            const hidden = new Set(["text", "pineId", "pineVersion", "pineFeatures", "__profile"]);
            inputs = values.filter((value) => !hidden.has(value.id)).map((input) => {
              const info = infoById[input.id] || {};
              const primitive = typeof input.value === "string" || typeof input.value === "number" || typeof input.value === "boolean";
              if (!primitive && input.value !== null) unsupportedInputValue = true;
              return {
                id: input.id,
                name: info.localizedName || info.name || input.id,
                value: primitive ? input.value : null,
              };
            });
          } catch (e) {}
        }
        const dateRange = report.settings && report.settings.dateRange && report.settings.dateRange.backtest;
        const normalizedDateRange = dateRange ? { from: iso(dateRange.from), to: iso(dateRange.to) } : null;
        const identity = JSON.stringify({
          strategy,
          symbol,
          timeframe,
          pineId,
          pineVersion,
          inputs,
          currency: report.currency ?? null,
          initialCapital: num(performance.initialCapital),
          dateRange: normalizedDateRange,
          totalTrades,
          trades: allTrades,
        });
        if (!globalThis.crypto || !globalThis.crypto.subtle || typeof TextEncoder !== "function") {
          throw new Error("Web Crypto is unavailable — cannot bind paginated ledger pages safely");
        }
        const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
        const ledgerId = "sha256:" + Array.from(new Uint8Array(digest))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        if (expectedLedgerId !== null && expectedLedgerId !== ledgerId) {
          throw new Error("strategy report changed between ledger pages: expected " + expectedLedgerId + " but found " + ledgerId);
        }
        const trades = allTrades.slice(offset, offset + limit);
        const nextOffset = offset + trades.length < allTrades.length ? offset + trades.length : null;
        const unavailableFields = [];
        if (!allTrades.some((trade) => trade.commission !== null)) unavailableFields.push("trade_commission");
        if (!allTrades.some((trade) => trade.runUp !== null)) unavailableFields.push("trade_run_up");
        if (!allTrades.some((trade) => trade.drawDown !== null)) unavailableFields.push("trade_draw_down");
        const qualityIssues = [];
        if (totalTrades !== null && totalTrades !== closedTradeCount) qualityIssues.push("report_trade_count_mismatch");
        if (!activeStudy) qualityIssues.push(studyCandidates.length > 1 ? "ambiguous_active_strategy_study" : "active_strategy_study_not_found");
        if (unsupportedInputValue) qualityIssues.push("unsupported_strategy_input_value");
        for (let index = 1; index < allTrades.length; index += 1) {
          const previous = allTrades[index - 1].entry?.time;
          const current = allTrades[index].entry?.time;
          if (previous !== null && previous !== undefined && current !== null && current !== undefined && current < previous) {
            qualityIssues.push("non_monotonic_trade_order");
            break;
          }
        }
        return {
          schemaVersion: "1.0",
          ledgerId,
          strategy,
          symbol,
          timeframe,
          studyId: activeStudy?.id ?? null,
          pineId,
          pineVersion,
          inputs,
          currency: report.currency ?? null,
          initialCapital: num(performance.initialCapital),
          dateRange: normalizedDateRange,
          summary: {
            netProfit: num(all.netProfit),
            netProfitPercent: num(all.netProfitPercent),
            totalTrades,
            winningTrades: num(all.numberOfWiningTrades),
            losingTrades: num(all.numberOfLosingTrades),
            percentProfitable: num(all.percentProfitable),
            profitFactor: num(all.profitFactor),
            grossProfit: num(all.grossProfit),
            grossLoss: num(all.grossLoss),
            commissionPaid: num(all.commissionPaid),
          },
          totalTrades,
          availableTrades: allTrades.length,
          countMatchesSummary: totalTrades === null ? null : totalTrades === closedTradeCount,
          ordering: "strategy_report",
          offset,
          limit,
          returned: trades.length,
          nextOffset,
          complete: nextOffset === null,
          unavailableFields,
          qualityIssues,
          trades,
        };
      })()
    `);
  }

  /**
   * Run a backtest of one of the user's own saved strategies on the active
   * chart (current symbol/timeframe): apply the strategy, wait for the
   * Strategy Tester report, and remove the strategy again by default so the
   * chart is left as it was.
   */
  runBacktest(options: {
    pineId: string;
    tradesLimit?: number;
    keepOnChart?: boolean;
  }): Promise<BacktestResult> {
    const { pineId, tradesLimit = 20, keepOnChart = false } = options;
    if (typeof pineId !== "string" || !PINE_ID_PATTERN.test(pineId)) {
      throw new Error(
        `pineId must look like "USER;<id>" (own saved scripts only, from list_pine_scripts) — got ${JSON.stringify(pineId)}`,
      );
    }
    if (!Number.isInteger(tradesLimit) || tradesLimit < 1 || tradesLimit > 500) {
      throw new Error(`tradesLimit must be an integer between 1 and 500, got ${tradesLimit}`);
    }
    return this.cdp.evaluate<BacktestResult>(`
      (async () => {
        const api = window.TradingViewApi;
        const chart = api.activeChart();
        const pineId = ${JSON.stringify(pineId)};
        const keep = ${keepOnChart ? "true" : "false"};
        ${BACKTESTING_API_SNIPPET}
        ${FORMAT_REPORT_SNIPPET}

        const repo = api.studyMetaIntoRepository();
        let meta = null;
        try {
          meta = await repo.findById({ type: "pine", pineId, version: "last" });
        } catch (e) {}
        if (!meta) throw new Error("script not found: " + pineId + " — check list_pine_scripts");
        if (meta.isTVScriptStrategy !== true) {
          throw new Error(pineId + " is not a strategy — pick a script with kind \\"strategy\\" from list_pine_scripts");
        }

        const bt = await resolveBacktestingApi(api, chart);
        if (!bt) throw new Error("Strategy Tester data model is unavailable in this app session");
        // The report WatchedValue can still hold the PREVIOUS run of a
        // strategy with the SAME name (e.g. re-testing after saving a new
        // version) — remember it so only a report object that replaced it
        // is accepted.
        const staleReport = bt.activeStrategyReportData.value();
        const studyId = await chart.createStudy({ type: "pine", pineId, version: "last" });
        let report = null;
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
          // Only accept a report attributed to OUR strategy — if another
          // strategy on the chart stays active, waiting out the timeout and
          // failing is better than returning its numbers as ours.
          let activeDesc = null;
          try { activeDesc = bt.activeStrategyMetaInfo.value()?.description ?? null; } catch (e) {}
          const raw = bt.activeStrategyReportData.value();
          if (raw !== null && raw !== staleReport && activeDesc === meta.description) {
            report = formatReport(bt, ${tradesLimit});
            if (report) break;
          }
          await new Promise((r) => setTimeout(r, 400));
        }

        // By default the strategy must not stay on the user's chart —
        // remove it whether or not the report arrived.
        let removed = false;
        let warning;
        // keepOnChart applies only to a successful run. A timed-out or
        // unattributed report must never strand the temporary strategy.
        if (!keep || !report) {
          try {
            chart.removeEntity(studyId);
            removed = true;
          } catch (e) {
            warning = "could not remove the strategy from the chart: " + e.message;
          }
        }
        if (!report) {
          throw new Error("backtest report did not appear within 20s (another strategy may be active on the chart)" +
            (removed
              ? " — the strategy was removed from the chart"
              : " — WARNING: the strategy may still be on the chart"));
        }
        const out = {
          pineId,
          studyId: keep ? studyId : null,
          keptOnChart: keep,
          removedFromChart: removed,
          ...report,
        };
        if (warning) out.warning = warning;
        return out;
      })()
    `);
  }

  /**
   * The user's watchlists, fetched with the app's own session via the
   * TradingView REST API (the in-page watchlist widget API is disabled in
   * the desktop build). Symbols beginning with "###" are section headers
   * and are converted into named sections.
   */
  getWatchlists(): Promise<Watchlist[]> {
    return this.cdp.evaluate<Watchlist[]>(`
      (async () => {
        const res = await fetch("https://www.tradingview.com/api/v1/symbols_list/custom/", {
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error("watchlist API returned HTTP " + res.status + " — is the app logged in?");
        }
        const lists = await res.json();
        if (!Array.isArray(lists)) throw new Error("unexpected watchlist response shape");
        return lists.map((l) => {
          const sections = [{ name: null, symbols: [] }];
          for (const s of Array.isArray(l.symbols) ? l.symbols : []) {
            if (typeof s !== "string") continue;
            if (s.startsWith("###")) {
              sections.push({ name: s.slice(3), symbols: [] });
            } else {
              sections[sections.length - 1].symbols.push(s);
            }
          }
          const nonEmpty = sections.filter((sec) => sec.name !== null || sec.symbols.length > 0);
          return {
            id: l.id,
            name: String(l.name ?? ""),
            type: l.type ?? null,
            symbolCount: nonEmpty.reduce((n, sec) => n + sec.symbols.length, 0),
            sections: nonEmpty,
          };
        });
      })()
    `);
  }

  /**
   * Change one chart's symbol (e.g. "OANDA:EURUSD", "BTCUSD").
   * Rejects if the change does not take effect (e.g. invalid symbol) rather
   * than silently returning the old state.
   */
  setSymbol(symbol: string, chartIndex?: number): Promise<{
    symbol: string;
    resolution: string;
    changed: boolean;
    bars: number | null;
    note?: string;
  }> {
    if (typeof symbol !== "string" || symbol.trim() === "") {
      throw new Error("symbol must be a non-empty string");
    }
    assertChartIndex(chartIndex);
    const chartExpr =
      chartIndex === undefined ? "window.TradingViewApi.activeChart()" : `window.TradingViewApi.chart(${chartIndex})`;
    return this.cdp.evaluate(`
      new Promise((resolve, reject) => {
        const requested = ${JSON.stringify(symbol)};
        const chart = ${chartExpr};
        const before = chart.symbol();
        const state = () => ({ symbol: chart.symbol(), resolution: chart.resolution() });
        // "EURUSD" resolves to e.g. "OANDA:EURUSD", so match with or without prefix
        const matches = (actual) => {
          const a = String(actual).toUpperCase();
          const r = requested.trim().toUpperCase();
          return a === r || a.endsWith(":" + r);
        };
        const barCount = () => {
          try { return chart.chartModel().mainSeries().bars()._items.length; }
          catch (e) { return null; }
        };
        // On failure the chart must not be left on a broken symbol: roll it
        // back to the previous one before rejecting, and report the outcome.
        const fail = (message) => {
          if (state().symbol === before) {
            reject(new Error(message));
            return;
          }
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(rt);
            const restored = state().symbol === before;
            reject(new Error(message + (restored
              ? " — the chart was restored to " + before
              : " — WARNING: the chart could not be restored and may show " + state().symbol)));
          };
          const rt = setTimeout(finish, 8000);
          try { chart.setSymbol(before, finish); } catch (e) { finish(); }
        };
        let settled = false;
        // Used on BOTH paths: even a fired callback is only trusted if the
        // chart shows the requested symbol AND actually has data.
        const settle = (viaCallback) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const s = state();
          if (!matches(s.symbol)) {
            fail("symbol change to " + requested + " did not take effect" +
              (viaCallback ? " (callback fired but chart shows " + s.symbol + ")" : " within 8s (chart still shows " + s.symbol + ")") +
              " — the symbol may be invalid");
            return;
          }
          const bars = barCount();
          if (bars === 0) {
            fail("symbol was set to " + s.symbol + " but no data loaded (0 bars) — likely an invalid symbol");
            return;
          }
          const result = { ...s, changed: s.symbol !== before, bars };
          if (!viaCallback) result.note = "data-ready callback did not fire within 8s";
          resolve(result);
        };
        const timer = setTimeout(() => settle(false), 8000);
        try {
          chart.setSymbol(requested, () => settle(true));
        } catch (e) {
          settled = true;
          clearTimeout(timer);
          reject(e);
        }
      })
    `);
  }

  /**
   * Change the active chart's timeframe (e.g. "1", "15", "60", "240", "1D", "1W").
   * Rejects if the change does not take effect rather than silently returning
   * the old state.
   */
  setResolution(resolution: string, chartIndex?: number): Promise<{
    symbol: string;
    resolution: string;
    changed: boolean;
    bars: number | null;
    note?: string;
  }> {
    if (typeof resolution !== "string" || !/^[0-9]*[SDWM]?$/i.test(resolution) || resolution === "") {
      throw new Error(`resolution must look like "15", "240", "1D", "1W" — got ${JSON.stringify(resolution)}`);
    }
    assertChartIndex(chartIndex);
    const chartExpr =
      chartIndex === undefined ? "window.TradingViewApi.activeChart()" : `window.TradingViewApi.chart(${chartIndex})`;
    return this.cdp.evaluate(`
      new Promise((resolve, reject) => {
        const requested = ${JSON.stringify(resolution)};
        const chart = ${chartExpr};
        const before = chart.resolution();
        const state = () => ({ symbol: chart.symbol(), resolution: chart.resolution() });
        // Normalize "D"/"1D", "W"/"1W", "M"/"1M", "S"/"1S" before comparing
        const normalize = (r) => {
          const u = String(r).toUpperCase();
          return /^[SDWM]$/.test(u) ? "1" + u : u;
        };
        const matches = (actual) => normalize(actual) === normalize(requested);
        const barCount = () => {
          try { return chart.chartModel().mainSeries().bars()._items.length; }
          catch (e) { return null; }
        };
        // Roll the chart back to the previous timeframe before rejecting.
        const fail = (message) => {
          if (state().resolution === before) {
            reject(new Error(message));
            return;
          }
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(rt);
            const restored = state().resolution === before;
            reject(new Error(message + (restored
              ? " — the chart was restored to " + before
              : " — WARNING: the chart could not be restored and may show " + state().resolution)));
          };
          const rt = setTimeout(finish, 8000);
          try { chart.setResolution(before, finish); } catch (e) { finish(); }
        };
        let settled = false;
        const settle = (viaCallback) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const s = state();
          if (!matches(s.resolution)) {
            fail("timeframe change to " + requested + " did not take effect" +
              (viaCallback ? " (callback fired but chart shows " + s.resolution + ")" : " within 8s (chart still shows " + s.resolution + ")"));
            return;
          }
          const bars = barCount();
          if (bars === 0) {
            fail("timeframe was set to " + s.resolution + " but no data loaded (0 bars)");
            return;
          }
          const result = { ...s, changed: s.resolution !== before, bars };
          if (!viaCallback) result.note = "data-ready callback did not fire within 8s";
          resolve(result);
        };
        const timer = setTimeout(() => settle(false), 8000);
        try {
          chart.setResolution(requested, () => settle(true));
        } catch (e) {
          settled = true;
          clearTimeout(timer);
          reject(e);
        }
      })
    `);
  }

  /**
   * Key price levels near the current price, aggregated from indicator plot
   * values, horizontal lines, box edges and labels across all price-scale
   * studies on a chart. Oscillator panes (isPriceStudy=false) are excluded so
   * e.g. an RSI of 50 is never mistaken for a price level, and plot-derived
   * levels are limited to plots whose title names a level (S/R, pivot, VWAP,
   * bands, BOS/CHoCH...) unless includeAllPlots is set.
   */
  async getKeyLevels(
    options: {
      chartIndex?: number;
      rangePercent?: number;
      limit?: number;
      includeAllPlots?: boolean;
    } = {},
  ): Promise<KeyLevelsResult> {
    const { chartIndex, rangePercent = 3, limit = 30, includeAllPlots = false } = options;
    assertChartIndex(chartIndex);
    if (!Number.isFinite(rangePercent) || rangePercent <= 0 || rangePercent > 50) {
      throw new Error(`rangePercent must be a number in (0, 50], got ${rangePercent}`);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error(`limit must be an integer between 1 and 200, got ${limit}`);
    }

    const ohlcv = await this.getOhlcv(1, chartIndex);
    if (ohlcv.bars.length === 0) throw new Error("no bar data loaded");
    const price = ohlcv.bars[ohlcv.bars.length - 1].close;
    if (typeof price !== "number" || !Number.isFinite(price) || price === 0) {
      throw new Error(`cannot determine the current price (last close: ${price})`);
    }

    // A chart without indicators has no levels — not an error here.
    const noIndicatorsAsEmpty = (err: unknown): never[] => {
      if (err instanceof Error && /no indicators on this chart/.test(err.message)) return [];
      throw err;
    };
    const [values, graphics] = await Promise.all([
      this.getIndicatorValues({ count: 1, chartIndex }).catch(noIndicatorsAsEmpty),
      this.getIndicatorGraphics({ chartIndex, limitPerKind: 100 }).catch(noIndicatorsAsEmpty),
    ]);

    const lo = price * (1 - rangePercent / 100);
    const hi = price * (1 + rangePercent / 100);
    const inBand = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
    const pct = (v: number) => Math.round(((v - price) / price) * 10000) / 100;

    const levels: KeyLevel[] = [];
    const seen = new Set<string>();
    const push = (l: KeyLevel) => {
      const key = `${l.kind}|${l.study}|${l.detail}|${l.price}`;
      if (!seen.has(key)) {
        seen.add(key);
        levels.push(l);
      }
    };

    for (const st of values) {
      if (st.isPriceStudy === false) continue;
      const bar = st.bars[st.bars.length - 1];
      if (!bar) continue;
      for (const [title, v] of Object.entries(bar.values)) {
        if (!includeAllPlots && !LEVEL_TITLE_PATTERN.test(title)) continue;
        if (!inBand(v)) continue;
        push({ price: v, distancePercent: pct(v), kind: "plot", study: st.name, detail: title, time: bar.time });
      }
    }

    for (const st of graphics) {
      if (st.isPriceStudy === false) continue;
      for (const ln of st.lines) {
        // horizontal S/R rays only — a sloped trend line has no single price
        if (ln.price1 === null || ln.price2 === null) continue;
        if (Math.abs(ln.price1 - ln.price2) > Math.abs(price) * 1e-6) continue;
        if (!inBand(ln.price2)) continue;
        push({
          price: ln.price2,
          distancePercent: pct(ln.price2),
          kind: "line",
          study: st.name,
          detail: "horizontal line" + (ln.extend ? ` (extend: ${ln.extend})` : ""),
          time: ln.time2,
        });
      }
      for (const bx of st.boxes) {
        const edges: Array<[string, number | null]> = [
          ["box top", bx.priceHigh],
          ["box bottom", bx.priceLow],
        ];
        for (const [edge, v] of edges) {
          if (!inBand(v)) continue;
          push({
            price: v,
            distancePercent: pct(v),
            kind: "box",
            study: st.name,
            detail: bx.text ? `${edge}: ${bx.text}` : edge,
            time: bx.time2,
          });
        }
      }
      for (const lb of st.labels) {
        if (!inBand(lb.price)) continue;
        push({ price: lb.price, distancePercent: pct(lb.price), kind: "label", study: st.name, detail: lb.text, time: lb.time });
      }
    }

    levels.sort((a, b) => Math.abs(a.distancePercent) - Math.abs(b.distancePercent));
    const kept = levels.slice(0, limit);
    return {
      symbol: ohlcv.symbol,
      resolution: ohlcv.resolution,
      price,
      rangePercent,
      count: kept.length,
      levels: kept,
    };
  }
}
