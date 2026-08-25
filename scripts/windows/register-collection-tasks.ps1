[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet("all", "research", "first-seen", "policy-rates")]
    [string]$TaskKind = "all",
    [string]$ProjectDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$NodeExecutable,
    [ValidatePattern("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
    [string]$FirstSeenMorningLocalTime = "10:30",
    [ValidatePattern("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
    [string]$FirstSeenEveningLocalTime = "22:30",
    [ValidatePattern("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
    [string]$PolicyRateLocalTime = "10:45"
)

$ErrorActionPreference = "Stop"

if (-not $NodeExecutable) {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw "node.exe was not found on PATH. Pass -NodeExecutable explicitly." }
    $NodeExecutable = $node.Source
}
if (-not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf)) {
    throw "Node executable does not exist: $NodeExecutable"
}

$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$weekdays = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")

function ConvertTo-LocalTriggerTime {
    param([string]$Value)
    $parts = $Value.Split(":")
    return [datetime]::Today.AddHours([int]$parts[0]).AddMinutes([int]$parts[1])
}

function Register-CollectorTask {
    param(
        [string]$Name,
        [string]$Cli,
        [string]$Arguments,
        [object[]]$Triggers
    )
    $cliPath = Join-Path $ProjectDirectory $Cli
    if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
        throw "Built collector CLI does not exist: $cliPath. Run npm run build first."
    }
    $actionArguments = ('"{0}" {1}' -f $cliPath, $Arguments).Trim()
    $action = New-ScheduledTaskAction -Execute $NodeExecutable -Argument $actionArguments -WorkingDirectory $ProjectDirectory
    if ($PSCmdlet.ShouldProcess($Name, "Register Windows scheduled collection task")) {
        Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Triggers `
            -Principal $principal -Settings $settings -Description "TradingView-MCP owner-session collector" -Force | Out-Null
        Write-Host "Registered $Name"
    }
}

if ($TaskKind -in @("all", "research")) {
    $researchStart = (Get-Date).AddHours(1)
    $researchStart = $researchStart.AddMinutes(-$researchStart.Minute).AddSeconds(-$researchStart.Second).AddMilliseconds(-$researchStart.Millisecond)
    $trigger = New-ScheduledTaskTrigger -Once -At $researchStart `
        -RepetitionInterval (New-TimeSpan -Hours 1)
    Register-CollectorTask "TradingView-MCP Research Collection" `
        "build\researchCollectionCli.js" "--confirm-chart-switch" @($trigger)
}

if ($TaskKind -in @("all", "first-seen")) {
    $triggers = @(
        (New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $weekdays -At (ConvertTo-LocalTriggerTime $FirstSeenMorningLocalTime)),
        (New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $weekdays -At (ConvertTo-LocalTriggerTime $FirstSeenEveningLocalTime))
    )
    Register-CollectorTask "TradingView-MCP First-Seen Collection" `
        "build\collectionCli.js" "collect --cot-symbol OANDA:EURUSD --cot-symbol OANDA:USDJPY --cot-symbol OANDA:XAUUSD" $triggers
}

if ($TaskKind -in @("all", "policy-rates")) {
    $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $weekdays -At (ConvertTo-LocalTriggerTime $PolicyRateLocalTime)
    Register-CollectorTask "TradingView-MCP Policy-Rate Collection" `
        "build\policyRateCollectionCli.js" "--confirm-chart-switch" @($trigger)
}
