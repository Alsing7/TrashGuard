# Moves one file or folder to the Recycle Bin - but only when the bin can hold it.
# Windows deletes an item permanently (and silently, with no-confirm flags) when it is
# larger than the bin's maximum, so that is checked first.
# Prints one JSON line: { ok } or { ok = false; reason; ... }. Messages are mapped to Danish in Node.
param(
  [Parameter(Mandatory = $true)][string]$Path,
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

if (-not (Test-Path -LiteralPath $Path)) { Write-Result @{ ok = $false; reason = 'missing' } }

$driveLetter = [IO.Path]::GetPathRoot($Path).Substring(0, 2)
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

  private const uint Delete = 3;
  // SILENT | NOCONFIRMATION | ALLOWUNDO | NOERRORUI | WANTNUKEWARNING (Windows' own last-resort warning)
  private const ushort RecycleFlags = 0x0004 | 0x0010 | 0x0040 | 0x0400 | 0x4000;

  public static int Recycle(string path, out bool aborted) {
    var operation = new FileOperation { Function = Delete, From = path + "\0", Flags = RecycleFlags };
    int code = SHFileOperation(ref operation);
    aborted = operation.Aborted;
    return code;
  }
}
'@

$aborted = $false
$code = [TrashGuardShell]::Recycle($Path, [ref]$aborted)
if ($code -ne 0 -or $aborted) { Write-Result @{ ok = $false; reason = 'failed'; code = $code; stillThere = (Test-Path -LiteralPath $Path) } }
Write-Result @{ ok = $true }
