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
    if (chartIndex !== undefined && (!Number.isInteger(chartIndex) || chartIndex < 0)) {
      throw new Error(`chartIndex must be a non-negative integer, got ${chartIndex}`);
    }
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
