# Moves files and folders (all on one drive) to the Recycle Bin - but only when the bin can hold them.
# Windows deletes an item permanently (and silently, with no-confirm flags) when it is larger than
# the bin's maximum, and it permanently deletes the oldest items in the bin when the bin is full.
# Both are checked first. Each path is moved on its own, so an item in use does not stop the rest.
# Input: -ListFile with a JSON array of paths, -Bytes with their total size.
# Prints one JSON line: { ok; moved; failed } or { ok = false; reason; ... }. Messages are mapped to Danish in Node.
param(
  [Parameter(Mandatory = $true)][string]$ListFile,
  [Parameter(Mandatory = $true)][long]$Bytes
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

# Size on disk rounds up to whole clusters, so keep a margin below the bin's maximum.
$CapacityMargin = 0.95
$BytesPerMb = 1048576

function Write-Result($result) {
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
  exit 0
}

# Assigned first: PowerShell 5.1's ConvertFrom-Json sends an array down the pipeline as one object.
$listed = Get-Content -LiteralPath $ListFile -Raw -Encoding UTF8 | ConvertFrom-Json
$paths = @($listed | Where-Object { Test-Path -LiteralPath $_ })
if (-not $paths.Count) { Write-Result @{ ok = $false; reason = 'missing' } }

$driveRoot = [IO.Path]::GetPathRoot($paths[0])
$driveLetter = $driveRoot.Substring(0, 2)
$volume = Get-CimInstance Win32_Volume -Filter "DriveLetter='$driveLetter'"
$volumeGuid = $volume.DeviceID -replace '^\\\\\?\\Volume', '' -replace '\\$', ''
$binSettings = Get-Item -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\$volumeGuid" -ErrorAction SilentlyContinue
if (-not $binSettings) { Write-Result @{ ok = $false; reason = 'no-bin-settings' } }
if ([int]$binSettings.GetValue('NukeOnDelete') -eq 1) { Write-Result @{ ok = $false; reason = 'bin-disabled' } }
$maxBytes = [long]$binSettings.GetValue('MaxCapacity') * $BytesPerMb
if ($Bytes -gt $maxBytes * $CapacityMargin) { Write-Result @{ ok = $false; reason = 'too-big'; maxBytes = $maxBytes } }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TrashGuardShell {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct FileOperation {
    public IntPtr Window;
    public uint Function;
    public string From;
    public string To;
    public ushort Flags;
    [MarshalAs(UnmanagedType.Bool)] public bool Aborted;
    public IntPtr NameMappings;
    public string ProgressTitle;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  private static extern int SHFileOperation(ref FileOperation operation);

  [StructLayout(LayoutKind.Sequential)]
  private struct BinInfo {
    public int Size;
    public long Bytes;
    public long Items;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  private static extern int SHQueryRecycleBin(string root, ref BinInfo info);

  private const uint Delete = 3;
  // SILENT | NOCONFIRMATION | ALLOWUNDO | NOERRORUI | WANTNUKEWARNING (Windows' own last-resort warning)
  private const ushort RecycleFlags = 0x0004 | 0x0010 | 0x0040 | 0x0400 | 0x4000;

  public static int Recycle(string path, out bool aborted) {
    var operation = new FileOperation { Function = Delete, From = path + "\0", Flags = RecycleFlags };
    int code = SHFileOperation(ref operation);
    aborted = operation.Aborted;
    return code;
  }

  public static long UsedBytes(string root) {
    var info = new BinInfo { Size = Marshal.SizeOf(typeof(BinInfo)) };
    int code = SHQueryRecycleBin(root, ref info);
    if (code != 0) throw new InvalidOperationException("SHQueryRecycleBin failed: " + code);
    return info.Bytes;
  }
}
'@

$usedBytes = [TrashGuardShell]::UsedBytes($driveRoot)
if ($usedBytes + $Bytes -gt $maxBytes * $CapacityMargin) { Write-Result @{ ok = $false; reason = 'bin-full'; usedBytes = $usedBytes; maxBytes = $maxBytes } }

$moved = 0
$failed = 0
foreach ($path in $paths) {
  $aborted = $false
  $code = [TrashGuardShell]::Recycle($path, [ref]$aborted)
  if ($code -ne 0 -or $aborted) { $failed++ } else { $moved++ }
}
Write-Result @{ ok = $true; moved = $moved; failed = $failed }
