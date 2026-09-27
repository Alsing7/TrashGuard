# One JSON document: startup entries, services, scheduled tasks and admin state.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$approvedRoot = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'

function Get-ApprovedHex([string]$regKey, [string]$valueName) {
  $item = Get-Item -LiteralPath ($regKey -replace '^(HKCU|HKLM)\\', '$1:\')
  if (-not $item) { return $null }
  $bytes = $item.GetValue($valueName)
  if ($null -eq $bytes) { return $null }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

$startup = New-Object 'System.Collections.Generic.List[object]'

$runKeys = @(
  @{ scope = 'HKCU';   key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';             approved = "HKCU\$approvedRoot\Run" },
  @{ scope = 'HKLM';   key = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run';             approved = "HKLM\$approvedRoot\Run" },
  @{ scope = 'HKLM32'; key = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; approved = "HKLM\$approvedRoot\Run32" }
)
foreach ($source in $runKeys) {
  $item = Get-Item -LiteralPath $source.key
  if (-not $item) { continue }
  foreach ($valueName in $item.GetValueNames()) {
    if (-not $valueName) { continue }
    $startup.Add([ordered]@{
      kind = 'run'; scope = $source.scope; name = $valueName
      command = [string]$item.GetValue($valueName)
      approvedKey = $source.approved
      approvedHex = Get-ApprovedHex $source.approved $valueName
    })
  }
}

$shell = New-Object -ComObject WScript.Shell
$folders = @(
  @{ scope = 'user';   path = [Environment]::GetFolderPath('Startup');       approved = "HKCU\$approvedRoot\StartupFolder" },
  @{ scope = 'common'; path = [Environment]::GetFolderPath('CommonStartup'); approved = "HKLM\$approvedRoot\StartupFolder" }
)
foreach ($folder in $folders) {
  foreach ($file in Get-ChildItem -LiteralPath $folder.path -File | Where-Object { $_.Name -ne 'desktop.ini' }) {
    $command = '"' + $file.FullName + '"'
    if ($file.Extension -eq '.lnk') {
      $link = $shell.CreateShortcut($file.FullName)
      if ($link.TargetPath) { $command = ('"' + $link.TargetPath + '" ' + $link.Arguments).Trim() }
    }
    $startup.Add([ordered]@{
      kind = 'folder'; scope = $folder.scope; name = $file.Name
      command = $command
      approvedKey = $folder.approved
      approvedHex = Get-ApprovedHex $folder.approved $file.Name
    })
  }
}

$services = @(Get-CimInstance Win32_Service | ForEach-Object {
  [ordered]@{
    name = $_.Name; display = $_.DisplayName; description = $_.Description
    startMode = [string]$_.StartMode; delayed = [bool]$_.DelayedAutoStart
    state = [string]$_.State; command = $_.PathName; pid = [int]$_.ProcessId
  }
})

$tasks = @(Get-ScheduledTask | ForEach-Object {
  $action = $_.Actions | Where-Object { $_.Execute } | Select-Object -First 1
  [ordered]@{
    path = $_.TaskPath; name = $_.TaskName; state = [string]$_.State
    execute = $action.Execute; arguments = $action.Arguments; author = $_.Author
  }
})

$drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  [ordered]@{ root = $_.DeviceID + '\'; label = $_.VolumeName; size = [int64]$_.Size; free = [int64]$_.FreeSpace }
})

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$result = [ordered]@{
  admin    = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  startup  = $startup.ToArray()
  services = $services
  tasks    = $tasks
  drives   = $drives
}
[Console]::Out.Write(($result | ConvertTo-Json -Depth 5 -Compress))
