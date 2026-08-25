[CmdletBinding()]
param(
    [string]$TradingViewExecutable
)

$ErrorActionPreference = "Stop"

if (-not $TradingViewExecutable) {
    $command = Get-Command TradingView.exe -ErrorAction SilentlyContinue
    if ($command) {
        $TradingViewExecutable = $command.Source
    }
}

if (-not $TradingViewExecutable -or -not (Test-Path -LiteralPath $TradingViewExecutable -PathType Leaf)) {
    throw "TradingView.exe was not found. Pass -TradingViewExecutable with the executable or app-execution-alias path."
}

Start-Process -FilePath $TradingViewExecutable -ArgumentList "--remote-debugging-port=9222"
