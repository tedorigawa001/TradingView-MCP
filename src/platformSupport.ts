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

/** An endpoint that took the connection and stalled: the app may be frozen, or another process may hold the port. */
export function cdpStallRemedy(port: string, platform = process.platform): string {
  const check = platform === "win32"
    ? `Get-NetTCPConnection -LocalPort ${port} -State Listen`
    : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
  return `If the app is open it may be frozen; restart it, or check what else listens on the port with ${check}. ${tradingViewLaunchRemedy(platform)}`;
}

/**
 * Where the Bookmap collector writes by default, which is where the reader looks by default: the home directory's
 * .tradingview-mcp/bookmap-data on every platform, as FlowCollector builds it from user.home (BACKLOG 102-24). The reader
 * used to look elsewhere on macOS and Windows, so with both left at their defaults it found no session.
 */
export function defaultBookmapFlowDirectory(platform = process.platform, home = homedir()): string {
  // The target platform's join, not the host's: the answer must not change with the host running it.
  return (platform === "win32" ? win32 : posix).join(home, ".tradingview-mcp", "bookmap-data");
}

/** The reader's default before BACKLOG 102-24, where it differed from today's; null where it did not. */
export function earlierDefaultBookmapFlowDirectory(
  platform = process.platform,
  localAppData = process.env.LOCALAPPDATA,
): string | null {
  if (platform === "darwin") return "/Volumes/HD/bookmap_data";
  if (platform === "win32" && localAppData?.trim()) return win32.join(localAppData.trim(), "TradingView-MCP", "bookmap-data");
  return null;
}
