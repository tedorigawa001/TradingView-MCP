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
  totals: { labels: number; lines: number; boxes: number };
  labels: GraphicLabel[];
  lines: GraphicLine[];
  boxes: GraphicBox[];
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
   * app's session. Creating or modifying alerts is intentionally unsupported.
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
