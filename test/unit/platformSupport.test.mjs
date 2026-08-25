import assert from "node:assert/strict";
import test from "node:test";
import {
  cdpPortInspectionRemedy,
  defaultBookmapFlowDirectory,
  tradingViewLaunchRemedy,
} from "../../build/platformSupport.js";

test("Windows guidance uses PowerShell and a Windows-local Bookmap evidence directory", () => {
  assert.match(tradingViewLaunchRemedy("win32"), /Start-Process/);
  assert.match(tradingViewLaunchRemedy("win32"), /remote-debugging-port=9222/);
  assert.match(cdpPortInspectionRemedy("9333", "win32"), /Get-NetTCPConnection -LocalPort 9333/);
  assert.equal(
    defaultBookmapFlowDirectory("win32", "C:\\Users\\tester", "C:\\Users\\tester\\AppData\\Local"),
    "C:\\Users\\tester\\AppData\\Local\\TradingView-MCP\\bookmap-data",
  );
});

test("existing macOS defaults remain stable and Linux does not use a macOS volume", () => {
  assert.match(tradingViewLaunchRemedy("darwin"), /open -a TradingView/);
  assert.equal(defaultBookmapFlowDirectory("darwin", "/Users/tester"), "/Volumes/HD/bookmap_data");
  assert.equal(defaultBookmapFlowDirectory("linux", "/home/tester"), "/home/tester/.tradingview-mcp/bookmap-data");
});
