import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  cdpPortInspectionRemedy,
  cdpStallRemedy,
  defaultBookmapFlowDirectory,
  earlierDefaultBookmapFlowDirectory,
  tradingViewLaunchRemedy,
} from "../../build/platformSupport.js";

test("a stalled endpoint is answered with a restart and a port check for the platform", () => {
  assert.match(cdpStallRemedy("9333", "win32"), /Get-NetTCPConnection -LocalPort 9333/);
  assert.match(cdpStallRemedy("9333", "win32"), /Start-Process/);
  assert.match(cdpStallRemedy("9333", "darwin"), /lsof -nP -iTCP:9333 -sTCP:LISTEN/);
  assert.match(cdpStallRemedy("9333", "darwin"), /open -a TradingView/);
});

test("Windows guidance uses PowerShell", () => {
  assert.match(tradingViewLaunchRemedy("win32"), /Start-Process/);
  assert.match(tradingViewLaunchRemedy("win32"), /remote-debugging-port=9222/);
  assert.match(cdpPortInspectionRemedy("9333", "win32"), /Get-NetTCPConnection -LocalPort 9333/);
});

// BACKLOG 102-24: the reader looks where the collector writes by default, on every platform.
test("Bookmap evidence is read by default where the collector writes it, on every platform", () => {
  assert.equal(defaultBookmapFlowDirectory("win32", "C:\\Users\\tester"), "C:\\Users\\tester\\.tradingview-mcp\\bookmap-data");
  assert.equal(defaultBookmapFlowDirectory("darwin", "/Users/tester"), "/Users/tester/.tradingview-mcp/bookmap-data");
  assert.equal(defaultBookmapFlowDirectory("linux", "/home/tester"), "/home/tester/.tradingview-mcp/bookmap-data");
  // The collector builds its default from user.home and the same two segments.
  const collector = readFileSync(new URL("../../bookmap-addon/src/main/java/jp/bushido/bookmap/FlowCollector.java", import.meta.url), "utf8");
  const initializer = collector.match(/public String outputDirectory = ([^;]+);/)?.[1].replace(/\s+/g, " ");
  assert.equal(initializer, 'System.getProperty("user.home") + File.separator + ".tradingview-mcp" + File.separator + "bookmap-data"');
  // The defaults the reader had before, for pointing at sessions left there.
  assert.equal(earlierDefaultBookmapFlowDirectory("darwin"), "/Volumes/HD/bookmap_data");
  assert.equal(earlierDefaultBookmapFlowDirectory("win32", "C:\\Users\\tester\\AppData\\Local"), "C:\\Users\\tester\\AppData\\Local\\TradingView-MCP\\bookmap-data");
  assert.equal(earlierDefaultBookmapFlowDirectory("win32", " "), null);
  assert.equal(earlierDefaultBookmapFlowDirectory("linux"), null);
});

test("macOS guidance opens the app", () => {
  assert.match(tradingViewLaunchRemedy("darwin"), /open -a TradingView/);
});
