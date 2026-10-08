# One JSON document: the last boots, logons, Run-key timings and failed services.
# Reads event fields, never message text, so it works in any Windows language.
param([int]$Sessions = 10)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function ToMs($time) { [DateTimeOffset]::new($time).ToUnixTimeMilliseconds() }

# Kernel-Boot 27: 0 = cold boot, 1 = Fast Startup, 2 = resume from hibernation.
$bootEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Boot'; Id = 27 } -MaxEvents $Sessions)
$since = if ($bootEvents.Count) { $bootEvents[-1].TimeCreated } else { Get-Date }
$boots = @($bootEvents | ForEach-Object { [ordered]@{ at = ToMs $_.TimeCreated; type = [int]$_.Properties[0].Value } })

$logons = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Winlogon'; Id = 7001; StartTime = $since } |
  ForEach-Object { ToMs $_.TimeCreated })

# Explorer runs Run-key entries one at a time. 9705 = list started, 9707 = command started, 9708 = command done.
$runs = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Shell-Core/Operational'; Id = 9705, 9707, 9708; StartTime = $since } | ForEach-Object {
  $command = if ($_.Id -eq 9707) { $_.Properties[0].Value } elseif ($_.Id -eq 9708) { $_.Properties[1].Value } else { '' }
  [ordered]@{ at = ToMs $_.TimeCreated; id = $_.Id; command = [string]$command }
})

# 7009/7011 carry the timeout first and the service name second.
$failedServices = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Service Control Manager'; Id = 7000, 7009, 7011, 7022, 7023; StartTime = $since } | ForEach-Object {
  $name = if ($_.Id -eq 7009 -or $_.Id -eq 7011) { $_.Properties[1].Value } else { $_.Properties[0].Value }
  [ordered]@{ at = ToMs $_.TimeCreated; id = $_.Id; name = [string]$name }
})

$power = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
$result = [ordered]@{
  lastBoot       = ToMs (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
  fastStartup    = ($power.HiberbootEnabled -eq 1)
  boots          = $boots
  logons         = $logons
  runs           = $runs
  failedServices = $failedServices
}
[Console]::Out.Write(($result | ConvertTo-Json -Depth 4 -Compress))
