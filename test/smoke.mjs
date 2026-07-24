// Integration smoke test — requires the TradingView desktop app running with
// --remote-debugging-port=9222. Exercises every tool's underlying operation
// and restores the chart to its original state.
import { CdpClient } from "../build/cdp.js";
import { TradingView } from "../build/tradingview.js";
import { Scanner } from "../build/scanner.js";
import { EconomicCalendar } from "../build/calendar.js";

const cdp = new CdpClient();
const tv = new TradingView(cdp);
const scanner = new Scanner();
const calendar = new EconomicCalendar();

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
  const bushidoScalp = studies.find((s) => s.name === "BushidoScalp_Tenkafubu");
  if (bushidoScalp) {
    const ohlcMirror = bushidoScalp.plots.find((p) => /^ohlc_/.test(p.type));
    if (ohlcMirror) {
      throw new Error(`plotcandle ohlc_* mirror leaked into default plots: ${JSON.stringify(ohlcMirror)}`);
    }
    const withAll = await tv.getIndicatorValues({ studyId: bushidoScalp.id, count: 1, includeAllPlots: true });
    if (!withAll[0].plots.some((p) => /^ohlc_/.test(p.type))) {
      throw new Error("includeAllPlots must still surface ohlc_* plots");
    }
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

await check("set_indicator_input", async () => {
  const studies = await tv.getIndicatorInputs();
  if (!Array.isArray(studies) || studies.length === 0) {
    return "skipped-ish: no indicators on active chart";
  }
  const withNumeric = studies
    .map((s) => ({ study: s, input: s.inputs.find((i) => typeof i.value === "number") }))
    .find((x) => x.input);
  if (!withNumeric) return `${studies.length} studies, none with a numeric input`;
  const { study, input } = withNumeric;
  const bumped = input.value + 1;

  let set1;
  try {
    set1 = await tv.setIndicatorInput(study.id, [{ id: input.id, value: bumped }]);
    if (set1.applied[0].value !== bumped) {
      throw new Error(`expected ${bumped}, got ${JSON.stringify(set1.applied[0])}`);
    }
    const readBack = await tv.getIndicatorInputs({ studyId: study.id });
    const nowValue = readBack[0].inputs.find((i) => i.id === input.id)?.value;
    if (nowValue !== bumped) throw new Error(`get_indicator_inputs did not reflect the change: ${nowValue}`);
    return `${study.name}.${input.name}: ${input.value} -> ${bumped} -> restored`;
  } finally {
    // restore the original value no matter what — this tool leaves a live
    // chart edit in place until set back, so a check failing above must
    // not leave the user's chart on the bumped value
    const restore = await tv.setIndicatorInput(study.id, [{ id: input.id, value: input.value }]);
    if (restore.applied[0].value !== input.value) {
      throw new Error(`failed to restore original value ${input.value}`);
    }
  }
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

await check("get_indicator_tables", async () => {
  const studies = await tv.getIndicatorTables();
  if (!Array.isArray(studies) || studies.length === 0) {
    return "skipped-ish: no indicators on active chart";
  }
  const withCells = studies
    .flatMap((s) => (s.tables || []).map((t) => ({ study: s.name, t })))
    .find(({ t }) => t.cellCount > 0);
  if (!withCells) return `${studies.length} studies, none with populated tables`;
  const { study, t } = withCells;
  if (!Array.isArray(t.grid) || t.grid.length !== t.rows) {
    throw new Error(`grid has ${t.grid?.length} rows, table declares ${t.rows}`);
  }
  for (const row of t.grid) {
    if (row.length !== t.columns) throw new Error(`row width ${row.length} != ${t.columns} columns`);
  }
  const texts = t.grid.flat().filter((s) => s !== "");
  if (texts.length === 0) throw new Error("populated table reconstructed with no text");
  return `${study}: ${t.rows}x${t.columns}@${t.position}, e.g. [${t.grid[0].slice(0, 4).join(" | ")}]`;
});

let smokeScripts = [];
await check("list_pine_scripts", async () => {
  smokeScripts = await tv.listPineScripts();
  if (!Array.isArray(smokeScripts)) throw new Error("expected an array");
  if (smokeScripts.length === 0) return "skipped-ish: no saved scripts (not logged in?)";
  for (const s of smokeScripts) {
    if (!/^USER;[\w]{8,64}$/.test(s.pineId)) throw new Error(`unexpected pineId: ${s.pineId}`);
    if (!s.name) throw new Error("script without a name");
  }
  const used = smokeScripts.filter((s) => s.usedBy.length > 0);
  return `${smokeScripts.length} scripts, ${used.length} on chart${used[0] ? ` (e.g. ${used[0].name} -> ${used[0].usedBy[0].studyId})` : ""}`;
});

await check("get_pine_source", async () => {
  const target = smokeScripts.find((s) => s.usedBy.length > 0) ?? smokeScripts[0];
  if (!target) return "skipped-ish: no saved scripts";
  const src = await tv.getPineSource(target.pineId);
  if (typeof src.source !== "string" || src.source.length < 50) {
    throw new Error(`suspiciously short source: ${src.source?.length}`);
  }
  if (src.sourceLength !== src.source.length) throw new Error("sourceLength mismatch");
  const head = src.source.slice(0, 4000);
  if (!/@version|indicator|strategy|study/.test(head)) {
    throw new Error("source does not look like Pine (compiled IL leaked instead?)");
  }
  // validation throws synchronously, before any network access
  let rejected = null;
  try {
    await tv.getPineSource("PUB;abcdef1234567890");
  } catch (e) {
    rejected = e.message;
  }
  if (!rejected || !/USER;/.test(rejected)) throw new Error("PUB; id was not refused");
  return `${src.name} v${src.version}: ${src.sourceLength} chars of Pine`;
});

await check("save_pine_script non-destructive cycle + add_pine_to_chart", async () => {
  const NAME = "MCP Smoke Test - safe to delete";
  const SRC1 = `//@version=5\nindicator("${NAME}")\nplot(close)`;
  const SRC2 = `//@version=5\nindicator("${NAME}")\nplot(close * 2)`;
  const norm = (s) => s.replace(/\r\n/g, "\n");
  const deleteScript = (id) =>
    cdp.evaluate(
      `fetch("https://pine-facade.tradingview.com/pine-facade/delete/" + encodeURIComponent(${JSON.stringify(id)}), { method: "POST", credentials: "include" }).then((r) => r.status)`,
    );
  // leftovers from an earlier aborted run must not break the name check
  for (const s of await tv.listPineScripts()) {
    if (s.name === NAME) await deleteScript(s.pineId);
  }

  const dry = await tv.savePineScript({ source: SRC1, name: NAME });
  if (dry.dryRun !== true) throw new Error("missing confirm must be a dry run");
  const created = await tv.savePineScript({ source: SRC1, name: NAME, confirm: true });
  try {
    if (!created.saved || !created.verified || !created.compileOk) {
      throw new Error(`create failed: ${JSON.stringify(created)}`);
    }
    const v2 = await tv.savePineScript({ source: SRC2, pineId: created.pineId, confirm: true });
    if (!v2.saved || v2.version === created.version) throw new Error("version did not advance");
    const v1 = await tv.getPineSource(created.pineId, "1");
    if (norm(v1.source) !== norm(SRC1)) throw new Error("old version was not preserved");

    const added = await tv.addPineToChart(created.pineId);
    const mid = await tv.getChartContext();
    const onChart = mid.charts[mid.activeChartIndex ?? 0].studies.some((s) => s.id === added.studyId);
    await cdp.evaluate(
      `window.TradingViewApi.activeChart().removeEntity(${JSON.stringify(added.studyId)})`,
    );
    if (!onChart) throw new Error("added study did not appear on the chart");
    return `created ${created.pineId.slice(0, 16)}… v${created.version} -> v${v2.version}, v1 preserved, chart add/remove OK`;
  } finally {
    await deleteScript(created.pineId);
  }
});

await check("run_backtest applies, reports and cleans up", async () => {
  const strategy = smokeScripts.find((s) => s.kind === "strategy");
  if (!strategy) return "skipped-ish: no saved strategy scripts";
  const before = await tv.getChartContext();
  const beforeIds = before.charts[before.activeChartIndex ?? 0].studies.map((s) => s.id).join(",");
  const r = await tv.runBacktest({ pineId: strategy.pineId, tradesLimit: 5 });
  if (typeof r.summary.netProfit !== "number") throw new Error("netProfit missing from summary");
  if (typeof r.summary.percentProfitable !== "number") throw new Error("win rate missing");
  if (r.trades.length > 5) throw new Error(`asked for 5 trades, got ${r.trades.length}`);
  if (!r.removedFromChart) throw new Error("strategy was not removed from the chart");
  const after = await tv.getChartContext();
  const afterIds = after.charts[after.activeChartIndex ?? 0].studies.map((s) => s.id).join(",");
  if (afterIds !== beforeIds) throw new Error(`chart studies changed: ${beforeIds} -> ${afterIds}`);
  return `${r.strategy}: netProfit=${r.summary.netProfit.toFixed(0)} ${r.currency}, ` +
    `winRate=${(r.summary.percentProfitable * 100).toFixed(1)}%, ${r.trades.length}/${r.totalTrades} trades, chart restored`;
});

await check("get_strategy_report refuses stale/absent reports", async () => {
  // right after run_backtest removed its strategy, a stale report would be
  // the dangerous failure mode — it must NOT be returned
  const r = await tv.getStrategyReport().then(
    (v) => v,
    (e) => e,
  );
  if (r instanceof Error) {
    if (!/no strategy report available/.test(r.message)) throw r;
    return "correctly refused: no strategy on chart";
  }
  if (!r.strategy && typeof r.summary?.netProfit !== "number") {
    throw new Error("returned a report without strategy attribution");
  }
  return `report for on-chart strategy ${r.strategy}`;
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

await check("create_analysis_alerts guard validation", async () => {
  const scripts = await tv.listPineScripts();
  const overlayScript = scripts.find((s) => s.name === "Bushido Analysis Overlay");
  if (!overlayScript) {
    const dummyId = "USER;00000000000000000000000000000000";
    const res = await tv.createAnalysisAlerts({
      pineId: dummyId,
      expectedSymbol: originalSymbol,
      expectedTimeframe: originalResolution,
      analysisId: "smoke-test-001",
      confirm: false,
    }).then(v => v, e => e);
    if (res instanceof Error && !/analysis_overlay_not_owned|not saved|not owned/.test(res.message)) {
      throw res;
    }
    return `correctly refused unowned overlay script ${dummyId}`;
  }
  return `found saved overlay script ${overlayScript.pineId} (${overlayScript.usedBy.length} chart instance(s))`;
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
  const tickers = ["OANDA:EURUSD", "OANDA:USDJPY"];
  const [eur, jpy] = await scanner.getMtfOverview(tickers, ["60", "1D"], ["close", "RSI"]);
  if (eur.symbol !== "OANDA:EURUSD" || jpy.symbol !== "OANDA:USDJPY") {
    throw new Error(`results out of order: ${eur.symbol}, ${jpy.symbol}`);
  }
  for (const tf of ["60", "1D"]) {
    if (typeof eur.timeframes[tf]?.RSI !== "number") throw new Error(`RSI missing for EURUSD ${tf}`);
    if (typeof jpy.timeframes[tf]?.RSI !== "number") throw new Error(`RSI missing for USDJPY ${tf}`);
  }
  const badTicker = await scanner.getMtfOverview(["OANDA:EURUSD", "OANDA:NOTAREALTICKERXYZ"]).then(
    () => null,
    (e) => e.message,
  );
  if (!badTicker || !/no data for: OANDA:NOTAREALTICKERXYZ/.test(badTicker)) {
    throw new Error(`invalid ticker in a batch did not fail clearly: ${badTicker}`);
  }
  return `EURUSD RSI 60=${eur.timeframes["60"].RSI.toFixed(1)} 1D=${eur.timeframes["1D"].RSI.toFixed(1)}, ` +
    `USDJPY RSI 60=${jpy.timeframes["60"].RSI.toFixed(1)} 1D=${jpy.timeframes["1D"].RSI.toFixed(1)}`;
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

await check("get_key_levels", async () => {
  const r = await tv.getKeyLevels({ rangePercent: 10, limit: 50 });
  if (typeof r.price !== "number" || r.price <= 0) throw new Error(`bad current price: ${r.price}`);
  const lo = r.price * 0.9;
  const hi = r.price * 1.1;
  let prevDist = 0;
  for (const l of r.levels) {
    if (l.price < lo || l.price > hi) throw new Error(`level ${l.price} outside ±10% of ${r.price}`);
    if (!l.study || !l.detail) throw new Error(`level without source: ${JSON.stringify(l)}`);
    if (l.kind === "plot" && /^(open|high|low|close|hl2|hlc3|ohlc4|price|plot(_?\d+)?)$/i.test(l.detail)) {
      throw new Error(`generic plot leaked into levels: ${l.detail}=${l.price} from ${l.study}`);
    }
    const dist = Math.abs(l.distancePercent);
    if (dist + 1e-9 < prevDist) throw new Error("levels not sorted by distance");
    prevDist = dist;
  }
  const kinds = [...new Set(r.levels.map((l) => l.kind))].join(",");
  return `${r.count} levels near ${r.price}${r.count ? ` (kinds: ${kinds}, nearest: ${r.levels[0].price} from ${r.levels[0].study})` : ""}`;
});

await check("get_economic_events (calendar)", async () => {
  const r = await calendar.getEvents({ countries: ["US", "JP", "EU"], minImportance: "low", limit: 10 });
  if (!Array.isArray(r.events)) throw new Error("expected an events array");
  let prev = 0;
  for (const e of r.events) {
    if (!e.title || !e.date || !e.importance) throw new Error(`incomplete event: ${JSON.stringify(e)}`);
    const t = Date.parse(e.date);
    if (Number.isNaN(t) || t < prev) throw new Error("events not sorted by date");
    prev = t;
  }
  return `${r.returned}/${r.totalInRange} events${r.events[0] ? `, next: ${r.events[0].date.slice(0, 16)} ${r.events[0].country} ${r.events[0].title}` : ""}`;
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

await check("set_symbol fails loudly for an invalid symbol and rolls back", async () => {
  const ctxBefore = await tv.getChartContext();
  const symbolBefore = ctxBefore.charts[ctxBefore.activeChartIndex ?? 0].symbol;
  const r = await tv.setSymbol("ZZZINVALIDXYZ123").then(
    (v) => v,
    (e) => e,
  );
  if (!(r instanceof Error)) {
    throw new Error(`invalid symbol did not reject: ${JSON.stringify(r)}`);
  }
  if (!/did not take effect|no data loaded/.test(r.message)) throw r;
  const ctxAfter = await tv.getChartContext();
  const symbolAfter = ctxAfter.charts[ctxAfter.activeChartIndex ?? 0].symbol;
  if (symbolAfter !== symbolBefore) {
    throw new Error(`chart left on ${symbolAfter}, expected rollback to ${symbolBefore}`);
  }
  if (!/restored to/.test(r.message)) {
    throw new Error(`rollback happened but was not reported: ${r.message.slice(0, 100)}`);
  }
  return `rejected and rolled back to ${symbolAfter}`;
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
