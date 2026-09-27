# Creates a desktop shortcut that starts TrashGuard as administrator.
$root = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'TrashGuard.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $node
$shortcut.Arguments = '"' + (Join-Path $root 'server.mjs') + '"'
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Description = 'TrashGuard'
$shortcut.Save()

# Byte 0x15, bit 0x20 in a .lnk file = "Run as administrator".
$bytes = [IO.File]::ReadAllBytes($shortcutPath)
$bytes[0x15] = $bytes[0x15] -bor 0x20
[IO.File]::WriteAllBytes($shortcutPath, $bytes)

"Genvej oprettet: $shortcutPath"
