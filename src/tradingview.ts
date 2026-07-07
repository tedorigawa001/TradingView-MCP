import type { CdpClient } from "./cdp.js";

export interface ChartInfo {
  index: number;
  symbol: string;
  resolution: string;
  studies: string[];
}

export interface ChartContext {
  layoutName: string | null;
  activeChartIndex: number | null;
  chartsCount: number;
  charts: ChartInfo[];
}

export interface OhlcvBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
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
  plots: IndicatorPlot[];
  bars: Array<{ time: number; values: Record<string, number | string | null> }>;
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

const STUDY_ID_PATTERN = /^[\w$]{1,64}$/;

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
          try { studies = c.getAllStudies().map((s) => s.name); } catch (e) {}
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
        const bars = items.slice(-${Math.max(1, Math.floor(count))}).map((it) => ({
          time: it.value[0],
          open: it.value[1],
          high: it.value[2],
          low: it.value[3],
          close: it.value[4],
          volume: it.value[5] ?? null,
        }));
        return {
          symbol: chart.symbol(),
          resolution: chart.resolution(),
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

        const isNoisePlot = (type) =>
          /colorer/i.test(type) || type === "alertcondition" || type === "textcolor";

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
            const row = { time: it.value[0], values: {} };
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

  /** Change the active chart's symbol (e.g. "OANDA:EURUSD", "BTCUSD"). */
  setSymbol(symbol: string): Promise<{ symbol: string; resolution: string }> {
    if (typeof symbol !== "string" || symbol.trim() === "") {
      throw new Error("symbol must be a non-empty string");
    }
    return this.cdp.evaluate(`
      new Promise((resolve, reject) => {
        const chart = window.TradingViewApi.activeChart();
        const done = () => resolve({ symbol: chart.symbol(), resolution: chart.resolution() });
        try {
          chart.setSymbol(${JSON.stringify(symbol)}, done);
          setTimeout(done, 8000); // fallback if the data-ready callback never fires
        } catch (e) { reject(e); }
      })
    `);
  }

  /** Change the active chart's timeframe (e.g. "1", "15", "60", "240", "1D", "1W"). */
  setResolution(resolution: string): Promise<{ symbol: string; resolution: string }> {
    if (typeof resolution !== "string" || !/^[0-9]*[SDWM]?$/i.test(resolution) || resolution === "") {
      throw new Error(`resolution must look like "15", "240", "1D", "1W" — got ${JSON.stringify(resolution)}`);
    }
    return this.cdp.evaluate(`
      new Promise((resolve, reject) => {
        const chart = window.TradingViewApi.activeChart();
        const done = () => resolve({ symbol: chart.symbol(), resolution: chart.resolution() });
        try {
          chart.setResolution(${JSON.stringify(resolution)}, done);
          setTimeout(done, 8000);
        } catch (e) { reject(e); }
      })
    `);
  }
}
