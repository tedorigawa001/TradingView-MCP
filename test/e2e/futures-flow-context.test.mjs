import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_FUTURES_FLOW_E2E_CONFIG";
const config = process.env[CONFIG_ENV] ? JSON.parse(process.env[CONFIG_ENV]) : null;

function payload(result, name) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no text`);
  if (result.isError === true) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text);
}

function containsArrayAtKey(value, key) {
  if (Array.isArray(value)) return value.some((item) => containsArrayAtKey(item, key));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([name, item]) =>
    (name === key && Array.isArray(item)) || containsArrayAtKey(item, key));
}

test("futures flow context over MCP stdio and live TradingView", {
  skip: config ? false : `${CONFIG_ENV} is not set`, timeout: 120_000,
}, async (t) => {
  // First-seen collection is append-only and permanent, so the live run must never write into the
  // operator's real log. Point the spawned server at a throwaway file instead.
  const historyDirectory = await mkdtemp(join(tmpdir(), "tv-mcp-e2e-oi-"));
  const historyPath = join(historyDirectory, "futures-open-interest-first-seen.jsonl");
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["build/index.js"], cwd: process.cwd(),
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
      TRADINGVIEW_MCP_FUTURES_OI_HISTORY_PATH: historyPath,
    },
    stderr: "pipe",
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const client = new Client({ name: "tradingview-futures-flow-e2e", version: "1.0.0" });
  try {
    await client.connect(transport);
    const call = async (name, args, timeout = 30_000) =>
      payload(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "get_futures_flow_context"));
    const before = await call("get_chart_context", {});
    const result = await call("get_futures_flow_context", config, 60_000);
    assert.equal(result.mapping.targetSymbol.toUpperCase(), config.target_symbol.toUpperCase());
    assert.equal(result.mapping.futuresSymbol.toUpperCase(), config.expected_futures_symbol.toUpperCase());
    assert.equal(typeof result.quality.rollAnomalyBars, "number");
    assert.equal(containsArrayAtKey(result, "bars"), false, "raw OHLCV arrays must not be returned");
    assert.ok(result.sample.observations > 0);
    t.diagnostic(`current=${JSON.stringify(result.current)} quality=${JSON.stringify(result.quality)}`);
    t.diagnostic(`cot_status=${result.cot.status} issues=${JSON.stringify(result.qualityIssues)}`);

    // The point of this E2E is that first-seen collection actually runs against the live server, so
    // a configuration that cannot produce open interest fails loudly rather than skipping quietly.
    assert.notEqual(result.openInterest.status, "unavailable",
      `${CONFIG_ENV} must exercise open interest collection: supply open_interest_study_id with ` +
      "open_interest_plot_title, or open_interest_data. Reason: " + String(result.openInterest.reason));

    await t.test("the open interest just read is written with the moment it was seen", async () => {
      assert.ok(result.openInterestFirstSeen, "the flow context must report what it recorded");
      assert.ok(result.openInterestFirstSeen.recorded > 0,
        `nothing was recorded: ${JSON.stringify(result.openInterestFirstSeen)}`);

      assert.equal((await lstat(historyPath)).mode & 0o777, 0o600, "the log must stay owner-only");
      const lines = (await readFile(historyPath, "utf8")).trim().split("\n").filter(Boolean);
      assert.equal(lines.length, result.openInterestFirstSeen.recorded);
      const records = lines.map((line) => JSON.parse(line));
      for (const [index, record] of records.entries()) {
        assert.equal(record.sequence, index + 1, "sequence must stay contiguous");
        assert.equal(record.futures_symbol.toUpperCase(), config.expected_futures_symbol.toUpperCase());
        assert.ok(record.open_interest > 0);
        // The invariant the whole log exists to protect.
        assert.ok(record.observation_date <= record.first_seen_at.slice(0, 10),
          `observation ${record.observation_date} cannot predate its first_seen ${record.first_seen_at}`);
      }
      const scopes = new Set(records.map((record) => record.scope));
      assert.equal(scopes.size, 1, "one call reads one scope");
      t.diagnostic(`first_seen scope=${[...scopes][0]} records=${records.length}`);
    });

    await t.test("reading the same series again records no duplicates", async () => {
      const repeat = await call("get_futures_flow_context", config, 60_000);
      assert.ok(repeat.openInterestFirstSeen.unchanged > 0,
        `a second identical read must be recognised as unchanged: ${JSON.stringify(repeat.openInterestFirstSeen)}`);
      const lines = (await readFile(historyPath, "utf8")).trim().split("\n").filter(Boolean);
      // Only a genuine revision may grow the log; an unchanged re-read must not.
      assert.equal(lines.length, result.openInterestFirstSeen.recorded + repeat.openInterestFirstSeen.recorded);
      t.diagnostic(`repeat=${JSON.stringify(repeat.openInterestFirstSeen)}`);
    });

    const after = await call("get_chart_context", {});
    assert.deepEqual(after, before);
  } catch (error) {
    if (stderr.length > 0) error.message += `\nMCP stderr:\n${stderr.join("").slice(-4000)}`;
    throw error;
  } finally {
    await client.close();
  }
});
