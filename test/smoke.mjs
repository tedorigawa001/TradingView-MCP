// Integration smoke test — requires the TradingView desktop app running with
// --remote-debugging-port=9222. Exercises every tool's underlying operation
// and restores the chart to its original state.
import { CdpClient } from "../build/cdp.js";
import { TradingView } from "../build/tradingview.js";

const cdp = new CdpClient();
const tv = new TradingView(cdp);

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
  return `${r.bars.length} bars of ${r.symbol} ${r.resolution}, last close=${last.close}`;
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

await check("get_chart_screenshot", async () => {
  const data = await cdp.screenshot("jpeg");
  if (data.length < 10_000) throw new Error("screenshot suspiciously small");
  return `${Math.round((data.length * 3) / 4 / 1024)} KiB jpeg`;
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
