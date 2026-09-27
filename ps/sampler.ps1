# Emits one JSON line per interval: processes with CPU time, RAM and VRAM
# (+ GPU load every N ticks, running services every M ticks), then a meta line
# with signatures for executables not seen before.
# Exits by itself when the Node parent dies.
param(
  [int]$IntervalMs = 2000,
  [int]$SignaturesPerTick = 15,
  [int]$ServiceEveryTicks = 15,
  [int]$GpuEveryTicks = 3,
  [int]$ParentPid = 0
)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$pendingPaths = New-Object 'System.Collections.Generic.Queue[string]'
$seenPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$tick = 0

# Win32_VideoController.AdapterRAM stops at 4 GB; the driver's registry value does not.
$vramTotal = [int64]0
foreach ($adapterKey in Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}') {
  $size = [int64](Get-ItemProperty -LiteralPath $adapterKey.PSPath).'HardwareInformation.qwMemorySize'
  if ($size -gt $vramTotal) { $vramTotal = $size }
}

while ($true) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit }

  $windowed = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($process in [Diagnostics.Process]::GetProcesses()) {
    if ($process.MainWindowHandle -ne [IntPtr]::Zero) { [void]$windowed.Add($process.Id) }
    $process.Dispose()
  }

  # LocalUsage = what actually sits in VRAM. The per-process DedicatedUsage counter is unreliable.
  $vramByPid = @{}
  foreach ($row in Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -Property Name, LocalUsage) {
    if ($row.Name -match '^pid_(\d+)_') { $id = [int]$Matches[1]; $vramByPid[$id] = [int64]$vramByPid[$id] + [int64]$row.LocalUsage }
  }
  $vramUsed = [int64]0
  foreach ($row in Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -Property DedicatedUsage) { $vramUsed += [int64]$row.DedicatedUsage }

  # Like Task Manager: a process' GPU load is its busiest engine; the total is the busiest engine overall.
  $gpuByPid = $null
  $gpuTotal = $null
  if ($tick % $GpuEveryTicks -eq 0) {
    $gpuByPid = @{}
    $engineLoad = @{}
    foreach ($row in Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Property Name, UtilizationPercentage) {
      if ($row.Name -notmatch '^pid_(\d+)_(.+)$') { continue }
      $id = [int]$Matches[1]
      $load = [double]$row.UtilizationPercentage
      if ($load -gt [double]$gpuByPid[$id]) { $gpuByPid[$id] = $load }
      $engineLoad[$Matches[2]] = [double]$engineLoad[$Matches[2]] + $load
    }
    $gpuTotal = 0
    foreach ($load in $engineLoad.Values) { if ($load -gt $gpuTotal) { $gpuTotal = $load } }
    $gpuTotal = [Math]::Min(100, $gpuTotal)
  }

  $procs = New-Object 'System.Collections.Generic.List[object]'
  foreach ($row in Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, ExecutablePath, KernelModeTime, UserModeTime, WorkingSetSize, PrivatePageCount) {
    $id = [int]$row.ProcessId
    $path = $row.ExecutablePath
    if ($path -and $seenPaths.Add($path)) { $pendingPaths.Enqueue($path) }
    $entry = [ordered]@{
      pid  = $id
      ppid = [int]$row.ParentProcessId
      name = $row.Name
      path = $path
      cpu  = [int64]$row.KernelModeTime + [int64]$row.UserModeTime
      ram  = [int64]$row.WorkingSetSize
      priv = [int64]$row.PrivatePageCount
      vram = [int64]$vramByPid[$id]
      win  = $windowed.Contains($id)
    }
    if ($gpuByPid) { $entry.gpu = [double]$gpuByPid[$id] }
    $procs.Add($entry)
  }

  $memory = Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize, FreePhysicalMemory
  $system = [ordered]@{
    ramTotal  = [int64]$memory.TotalVisibleMemorySize * 1024
    ramUsed   = ([int64]$memory.TotalVisibleMemorySize - [int64]$memory.FreePhysicalMemory) * 1024
    vramTotal = $vramTotal
    vramUsed  = $vramUsed
    gpuTotal  = $gpuTotal
  }
  $message = [ordered]@{ type = 'tick'; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); system = $system; procs = $procs.ToArray() }
  if ($tick % $ServiceEveryTicks -eq 0) {
    $message.services = @(Get-CimInstance Win32_Service -Filter "State='Running'" -Property Name, DisplayName, ProcessId | ForEach-Object {
      [ordered]@{ name = $_.Name; display = $_.DisplayName; pid = [int]$_.ProcessId }
    })
  }
  [Console]::Out.WriteLine(($message | ConvertTo-Json -Depth 4 -Compress))

  $meta = [ordered]@{}
  for ($i = 0; $i -lt $SignaturesPerTick -and $pendingPaths.Count -gt 0; $i++) {
    $path = $pendingPaths.Dequeue()
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($path)
    $meta[$path] = [ordered]@{
      subject = $signature.SignerCertificate.Subject
      valid   = ($signature.Status -eq 'Valid')
      company = $info.CompanyName
      desc    = $info.FileDescription
    }
  }
  if ($meta.Count) { [Console]::Out.WriteLine((@{ type = 'meta'; files = $meta } | ConvertTo-Json -Depth 4 -Compress)) }

  $tick++
  $remaining = $IntervalMs - $clock.ElapsedMilliseconds
  if ($remaining -gt 50) { Start-Sleep -Milliseconds $remaining }
}
