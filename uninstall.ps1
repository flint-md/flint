[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$KeepData,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$FlintHome = if ($env:FLINT_HOME) { $env:FLINT_HOME } else { Join-Path $env:USERPROFILE ".flint" }

Write-Host ""
Write-Host "  =====================================" -ForegroundColor Red
Write-Host "             F L I N T                 " -ForegroundColor Red
Write-Host "     Desktop Uninstaller v2.1.0        " -ForegroundColor DarkGray
Write-Host "  =====================================" -ForegroundColor Red
Write-Host ""


if (-not (Test-Path $FlintHome)) {
  Write-Host "Flint is not installed at $FlintHome." -ForegroundColor Yellow
  exit 0
}

function Ask-User($Prompt, $Default) {
  if ($Yes -or $NonInteractive -or ($env:FLINT_NON_INTERACTIVE -eq "1") -or ($env:CI -eq "true")) {
    Write-Host "  $Prompt [auto: $Default]" -ForegroundColor DarkGray
    return $Default -match "^[Yy]$"
  }
  $choices = if ($Default -eq "y") { "Y/n" } else { "y/N" }
  $response = Read-Host "  $Prompt [$choices]"
  if ([string]::IsNullOrWhiteSpace($response)) {
    $response = $Default
  }
  return $response -match "^[Yy]$"
}

$keepNotes = $KeepData
if (-not $KeepData -and -not $Yes) {
  $keepNotes = Ask-User "Keep notes, vault data, and local cache for future reinstall?" "y"
}

Write-Host "[1/4] Stopping Flint processes..." -ForegroundColor Cyan
Get-Process -Name "flint", "flint-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -and ($_.Path -like "*$FlintHome*" -or $_.Path -like "*flint*")
} | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "python", "python3" -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -and ($_.Path -like "*$FlintHome*")
} | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "      OK  Processes stopped" -ForegroundColor Green

Write-Host "[2/4] Removing Start Menu shortcuts..." -ForegroundColor Cyan
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$ShortcutFile = Join-Path $StartMenu "Flint.lnk"
if (Test-Path $ShortcutFile) {
  Remove-Item -LiteralPath $ShortcutFile -Force -ErrorAction SilentlyContinue
}
Write-Host "      OK  Shortcuts removed" -ForegroundColor Green

Write-Host "[3/4] Removing Flint from PATH..." -ForegroundColor Cyan
$FlintBin = Join-Path $FlintHome "bin"
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath) {
  $pathParts = $UserPath.Split(";") | Where-Object { $_ -and ($_ -ne $FlintBin) }
  $newUserPath = $pathParts -join ";"
  [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
}
# Also remove from current session
$env:PATH = ($env:PATH.Split(";") | Where-Object { $_ -and ($_ -ne $FlintBin) }) -join ";"
Write-Host "      OK  PATH cleaned" -ForegroundColor Green

Write-Host "[4/4] Removing Flint files..." -ForegroundColor Cyan
if ($keepNotes) {
  Remove-Item -Recurse -Force -LiteralPath (Join-Path $FlintHome "app") -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -LiteralPath (Join-Path $FlintHome "agent") -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -LiteralPath (Join-Path $FlintHome "bin") -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -LiteralPath (Join-Path $FlintHome "source") -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -LiteralPath (Join-Path $FlintHome ".build") -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -LiteralPath (Join-Path $FlintHome "venv") -ErrorAction SilentlyContinue
  Remove-Item -Force -LiteralPath (Join-Path $FlintHome "uninstall.bat") -ErrorAction SilentlyContinue
  Remove-Item -Force -LiteralPath (Join-Path $FlintHome "uninstall.ps1") -ErrorAction SilentlyContinue
  Write-Host "      OK  Flint app removed. Vault data preserved at $FlintHome" -ForegroundColor Green
} else {
  Remove-Item -Recurse -Force -LiteralPath $FlintHome -ErrorAction SilentlyContinue
  Write-Host "      OK  Flint completely removed from $FlintHome" -ForegroundColor Green
}

Write-Host ""
Write-Host "Flint has been uninstalled successfully." -ForegroundColor Green
Write-Host ""
