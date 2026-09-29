# Sizes of files that cannot be opened (hiberfil.sys, pagefile.sys, locked databases),
# read from the directory listing instead of the file itself. Optionally also the space
# used by shadow copies (restore points) on one drive; that lives in System Volume Information.
# Input: -ListFile with JSON { "C:\dir": ["name", ...] }.
# Output: one JSON line { sizes = { "C:\dir" = { "name" = bytes } }; shadowBytes }.
param(
  [Parameter(Mandatory = $true)][string]$ListFile,
  [string]$ShadowDrive = ''
)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$wanted = Get-Content -LiteralPath $ListFile -Raw -Encoding UTF8 | ConvertFrom-Json
$sizes = @{}
foreach ($dir in $wanted.PSObject.Properties) {
  $names = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($name in $dir.Value) { [void]$names.Add($name) }
  $found = @{}
  try {
    foreach ($file in (New-Object IO.DirectoryInfo $dir.Name).EnumerateFiles()) {
      if ($names.Contains($file.Name)) { $found[$file.Name] = [int64]$file.Length }
    }
  } catch { }
  $sizes[$dir.Name] = $found
}

$shadowBytes = $null
if ($ShadowDrive) {
  $volume = Get-CimInstance Win32_Volume -Filter "DriveLetter='$ShadowDrive'"
  foreach ($storage in Get-CimInstance Win32_ShadowStorage) {
    if ($storage.Volume.DeviceID -eq $volume.DeviceID) { $shadowBytes = [int64]$storage.UsedSpace }
  }
}

[Console]::Out.WriteLine((@{ sizes = $sizes; shadowBytes = $shadowBytes } | ConvertTo-Json -Depth 4 -Compress))
