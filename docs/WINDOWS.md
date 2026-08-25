# Windows Support

## Supported baseline

The npm MCP server, CDP chart connection, quote/scanner tools, Pine tools, and
pure research calculations are intended to run on Windows 10 22H2 or Windows
11 22H2 and later with Node.js 22 or later. CI builds and runs the Node and
SDK-free Bookmap tests on `windows-latest`.

TradingView Desktop must be started with a CDP port. From a source checkout:

```powershell
.\scripts\windows\start-tradingview.ps1
```

If the MSIX app execution alias is not on `PATH`, pass its executable or alias
path explicitly:

```powershell
.\scripts\windows\start-tradingview.ps1 -TradingViewExecutable "C:\path\to\TradingView.exe"
```

Then verify `http://127.0.0.1:9222/json` locally and set
`TV_CDP_URL=http://127.0.0.1:9222` if `localhost` reaches another listener.

On Windows, MCP clients should invoke npm's Windows shim. For example, Codex
uses:

```toml
[mcp_servers.tradingview]
command = "npx.cmd"
args = ["-y", "bushido-tradingview-mcp"]
```

## Bookmap add-on

Set `BOOKMAP_HOME` to the directory whose `lib` subdirectory contains
`bm-simplified-api-wrapper.jar` and `bm-l1api.jar`, then run:

```powershell
$env:BOOKMAP_HOME = "C:\path\to\Bookmap"
npm run build:bookmap-addon
npm run test:bookmap-addon
```

The collector and delayed/Replay research modules default to
`%USERPROFILE%\.tradingview-mcp\bookmap-data`. The Bookmap parameter can point
elsewhere, including another local NTFS volume.

## Scheduled collection

Scheduled collectors require a source checkout because the npm
package intentionally ships only the MCP server's compiled JavaScript. Build
the checkout, keep TradingView running with CDP enabled, then register the
research, first-seen, and policy-rate jobs for the current interactive user:

```powershell
npm run build
.\scripts\windows\register-collection-tasks.ps1 -WhatIf
.\scripts\windows\register-collection-tasks.ps1
```

The script uses `IgnoreNew` and the default shared chart-operation lock. It
does not run tasks as another user or in a noninteractive session, where the
TradingView Desktop instance would not be the same one. Use `-TaskKind` to
register only `research`, `first-seen`, or `policy-rates`.

The scheduled times are local Windows wall-clock times. Their defaults
(`10:30`, `22:30`, and `10:45`) are the JST operating schedule used by this
project. On a machine in another time zone, pass local equivalents with
`-FirstSeenMorningLocalTime`, `-FirstSeenEveningLocalTime`, and
`-PolicyRateLocalTime`. The first-seen task explicitly collects EURUSD,
USDJPY, and XAUUSD COT evidence rather than relying on the CLI's two-symbol
fallback.

## Filesystem security difference

POSIX owner and `0600`/`0700` checks do not have an exact Node.js equivalent
on Windows. Windows runs rely on the ACL inherited from the current user's
profile directory. Symlink checks and exclusive lock creation remain active,
but Node.js does not expose Windows `FILE_FLAG_OPEN_REPARSE_POINT`, so the
same race-resistant `O_NOFOLLOW` guarantee cannot be claimed. Keep evidence
under the user profile or another owner-restricted NTFS directory and do not
grant write access to untrusted accounts.
