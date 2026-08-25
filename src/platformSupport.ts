import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export function tradingViewLaunchRemedy(platform = process.platform): string {
  if (platform === "win32") {
    return "Launch TradingView Desktop from PowerShell with: Start-Process '<path-to-TradingView.exe>' -ArgumentList '--remote-debugging-port=9222'";
  }
  if (platform === "darwin") {
    return "Launch it with: open -a TradingView --args --remote-debugging-port=9222";
  }
  return "Launch TradingView Desktop with the --remote-debugging-port=9222 argument";
}

export function cdpPortInspectionRemedy(port: string, platform = process.platform): string {
  if (platform === "win32") {
    return `Something other than the desktop app is answering; inspect the listener in PowerShell with Get-NetTCPConnection -LocalPort ${port} -State Listen.`;
  }
  return `Something other than the desktop app is answering; check with lsof -nP -iTCP:${port} -sTCP:LISTEN before restarting the app.`;
}

export function defaultBookmapFlowDirectory(
  platform = process.platform,
  home = homedir(),
  localAppData = process.env.LOCALAPPDATA,
): string {
  if (platform === "win32") {
    return win32.join(localAppData?.trim() || home, "TradingView-MCP", "bookmap-data");
  }
  if (platform === "darwin") return "/Volumes/HD/bookmap_data";
  // posix.join, not join: this function takes the target platform as an
  // argument, so its answer must not change with the host running it.
  return posix.join(home, ".tradingview-mcp", "bookmap-data");
}
