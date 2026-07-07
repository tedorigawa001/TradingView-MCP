// Integration smoke test — requires the TradingView desktop app running with
// --remote-debugging-port=9222. Exercises every tool's underlying operation
// and restores the chart to its original state.
import { CdpClient } from "../build/cdp.js";
import { TradingView } from "../build/tradingview.js";
import { Scanner } from "../build/scanner.js";

const cdp = new CdpClient();
const tv = new TradingView(cdp);
const scanner = new Scanner();

let failures = 0;
async function check(name, fn) {
  try {
    const out = await fn();
    console.log(`PASS ${name}`, typeof out === "string" ? out : "");
  } catch (err) {
    failures++;
    console.error(`FAIL ${name}:`, err.message);
  }
}

const original = await tv.getChartContext();
const originalSymbol = original.charts[original.activeChartIndex ?? 0].symbol;
const originalResolution = original.charts[original.activeChartIndex ?? 0].resolution;

await check("get_chart_context", async () => {
  if (!original.charts.length) throw new Error("no charts in layout");
  return `${original.chartsCount} charts, active=${originalSymbol} ${originalResolution}`;
});

await check("get_ohlcv", async () => {
  const r = await tv.getOhlcv(10);
  if (r.bars.length === 0) throw new Error("no bars returned");
  const last = r.bars[r.bars.length - 1];
  for (const k of ["time", "open", "high", "low", "close"]) {
    if (typeof last[k] !== "number") throw new Error(`bar missing ${k}`);
  }
  if (new Date(last.timeIso).getTime() !== last.time * 1000) {
    throw new Error(`timeIso mismatch: ${last.timeIso} vs ${last.time}`);
  }
  for (const bar of r.bars.slice(0, -1)) {
    if (bar.forming) throw new Error("forming flag on a non-last bar");
  }
  return `${r.bars.length} bars of ${r.symbol} ${r.resolution}, last close=${last.close}${last.forming ? " (forming)" : ""}`;
});

await check("study ids from context filter indicator tools", async () => {
  const ctx = await tv.getChartContext();
  const withStudies = ctx.charts.find((c) => c.studies.length > 0);
  if (!withStudies) return "skipped-ish: no studies on any chart";
  const ref = withStudies.studies[0];
  if (!ref || !ref.id || !ref.name) {
    throw new Error(`context studies must carry {id, name}, got ${JSON.stringify(ref)}`);
  }
  const vals = await tv.getIndicatorValues({
    studyId: ref.id,
    count: 1,
    chartIndex: withStudies.index,
  });
  if (vals.length !== 1 || vals[0].id !== ref.id) {
    throw new Error("filtering by a context-provided id failed");
  }
  return `${ref.id} -> "${vals[0].name}"`;
});

await check("get_indicator_values", async () => {
  const studies = await tv.getIndicatorValues({ count: 3 });
  if (!Array.isArray(studies) || studies.length === 0) {
    return "skipped-ish: no indicators on active chart";
  }
  const withPlots = studies.find((s) => s.plots.length > 0 && s.bars.length > 0);
  if (!withPlots) return `${studies.length} studies, none with numeric plots`;
  const lastBar = withPlots.bars[withPlots.bars.length - 1];
  if (typeof lastBar.time !== "number") throw new Error("bar has no time");
  const raw = JSON.stringify(studies);
  if (raw.includes("pineId") || raw.includes("ILScript")) {
    throw new Error("internal Pine data leaked into values payload");
  }
  return `${withPlots.name}: ${Object.entries(lastBar.values).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(", ")}`;
});

await check("get_indicator_inputs", async () => {
  const studies = await tv.getIndicatorInputs();
  if (!Array.isArray(studies) || studies.length === 0) {
    return "skipped-ish: no indicators on active chart";
  }
  const raw = JSON.stringify(studies);
  for (const forbidden of ['"id":"text"', '"id":"pineId"', '"id":"pineVersion"', '"id":"pineFeatures"']) {
    if (raw.includes(forbidden)) throw new Error(`hidden input leaked: ${forbidden}`);
  }
  if (raw.length > 100_000) throw new Error(`payload too large: ${raw.length} chars`);
  const named = studies[0].inputs.find((i) => i.name && i.name !== i.id);
  return `${studies.length} studies, e.g. ${named ? `${named.name}=${named.value}` : "(no named inputs)"}`;
});

await check("get_indicator_graphics", async () => {
  const studies = await tv.getIndicatorGraphics({ limitPerKind: 5 });
  if (!Array.isArray(studies) || studies.length === 0) {
    return "skipped-ish: no indicators on active chart";
  }
  const withGraphics = studies.find(
    (s) => s.totals.labels + s.totals.lines + s.totals.boxes > 0,
  );
  if (!withGraphics) return `${studies.length} studies, none with drawings`;
  const label = withGraphics.labels[0];
  if (label && (typeof label.text !== "string" || label.text === "")) {
    throw new Error("label without text should have been filtered");
  }
  return `${withGraphics.name}: ${JSON.stringify(withGraphics.totals)}${label ? `, e.g. "${label.text.replace(/\n/g, " ")}"@${label.price}` : ""}`;
});

await check("list_alerts", async () => {
  const alerts = await tv.listAlerts();
  if (!Array.isArray(alerts)) throw new Error("expected an array");
  for (const a of alerts) {
    if (typeof a.symbol !== "string" || a.symbol.startsWith("={")) {
      throw new Error(`unparsed symbol expression: ${a.symbol}`);
    }
  }
  return `${alerts.length} alert(s)${alerts[0] ? `, e.g. ${alerts[0].symbol} active=${alerts[0].active}` : ""}`;
});

await check("load_more_history", async () => {
  const r = await tv.loadMoreHistory({ count: 50 });
  if (r.barsAfter < r.barsBefore) throw new Error("bar count decreased");
  if (r.added === 0 && r.moreAvailable !== false) {
    throw new Error("nothing loaded although more data was available");
  }
  return `${r.barsBefore} -> ${r.barsAfter} bars (earliest ${new Date(r.earliestTime * 1000).toISOString().slice(0, 10)})`;
});

await check("get_watchlist", async () => {
  const lists = await tv.getWatchlists();
  if (!Array.isArray(lists)) throw new Error("expected an array of lists");
  if (lists.length === 0) return "skipped-ish: no watchlists (not logged in?)";
  const total = lists.reduce((n, l) => n + l.symbolCount, 0);
  return `${lists.length} list(s), ${total} symbols, first="${lists[0].name}"`;
});

await check("get_quotes (scanner)", async () => {
  const q = await scanner.getQuotes(["OANDA:EURUSD"]);
  if (q.rows.length !== 1) throw new Error(`expected 1 row, got ${q.rows.length}`);
  const v = q.rows[0].values;
  if (typeof v.close !== "number") throw new Error("close is not a number");
  if (typeof v["Recommend.All"] !== "number") throw new Error("rating missing");
  return `EURUSD close=${v.close}, rating=${v["Recommend.All"].toFixed(2)}`;
});

await check("get_mtf_overview (scanner)", async () => {
  const o = await scanner.getMtfOverview("OANDA:EURUSD", ["60", "1D"], ["close", "RSI"]);
  for (const tf of ["60", "1D"]) {
    if (typeof o.timeframes[tf]?.RSI !== "number") throw new Error(`RSI missing for ${tf}`);
  }
  return `RSI 60=${o.timeframes["60"].RSI.toFixed(1)}, 1D=${o.timeframes["1D"].RSI.toFixed(1)}`;
});

await check("scan_market (scanner)", async () => {
  const r = await scanner.scanMarket({
    market: "japan",
    filters: [{ field: "volume", operation: "greater", value: 0 }],
    sortBy: "volume",
    limit: 2,
  });
  if (r.rows.length === 0) throw new Error("no screener results");
  return `${r.totalCount} matches, top: ${r.rows[0].symbol}`;
});

await check("get_chart_screenshot", async () => {
  const data = await cdp.screenshot("jpeg");
  if (data.length < 10_000) throw new Error("screenshot suspiciously small");
  return `${Math.round((data.length * 3) / 4 / 1024)} KiB jpeg`;
});

await check("get_chart_screenshot clipped to one chart", async () => {
  const r = await tv.getChartRect(0);
  if (r.width < 100 || r.height < 100) throw new Error(`rect too small: ${JSON.stringify(r)}`);
  const clipped = await cdp.screenshot("jpeg", undefined, {
    x: r.x, y: r.y, width: r.width, height: r.height, scale: r.devicePixelRatio,
  });
  if (clipped.length < 10_000) throw new Error("clipped screenshot suspiciously small");
  const outOfRange = await tv.getChartRect(99).then(() => null, (e) => e.message);
  if (!outOfRange || !/out of range/.test(outOfRange)) {
    throw new Error("out-of-range chart index did not fail clearly");
  }
  return `chart0 ${r.width}x${r.height}@${r.devicePixelRatio}x, ${Math.round((clipped.length * 3) / 4 / 1024)} KiB`;
});

await check("set_symbol", async () => {
  const r = await tv.setSymbol("BTCUSD");
  if (!r.symbol.includes("BTCUSD")) throw new Error(`unexpected symbol: ${r.symbol}`);
  return `now ${r.symbol}`;
});

await check("set_timeframe", async () => {
  const r = await tv.setResolution("240");
  if (r.resolution !== "240") throw new Error(`unexpected resolution: ${r.resolution}`);
  return `now ${r.resolution}`;
});

await check("set_timeframe accepts normalized aliases (D == 1D)", async () => {
  const r = await tv.setResolution("D"); // chart reports "1D" — must not misclassify as failure
  if (r.resolution.toUpperCase() !== "1D" && r.resolution.toUpperCase() !== "D") {
    throw new Error(`unexpected resolution: ${r.resolution}`);
  }
  return `requested "D" -> chart shows "${r.resolution}"`;
});

await check("set_symbol fails loudly for an invalid symbol", async () => {
  const r = await tv.setSymbol("ZZZINVALIDXYZ123").then(
    (v) => v,
    (e) => e,
  );
  if (r instanceof Error) {
    if (!/did not take effect|no data loaded/.test(r.message)) throw r;
    return `rejected: ${r.message.slice(0, 70)}`;
  }
  throw new Error(`invalid symbol did not reject: ${JSON.stringify(r)}`);
});

// restore original state
await tv.setSymbol(originalSymbol);
await tv.setResolution(originalResolution);
const restored = await tv.getChartContext();
const after = restored.charts[restored.activeChartIndex ?? 0];
await check("restore_original_state", async () => {
  if (after.symbol !== originalSymbol || after.resolution !== originalResolution) {
    throw new Error(`expected ${originalSymbol} ${originalResolution}, got ${after.symbol} ${after.resolution}`);
  }
  return `${after.symbol} ${after.resolution}`;
});

cdp.close();
process.exit(failures ? 1 : 0);
