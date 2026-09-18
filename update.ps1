[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$NonInteractive,
  [string]$Branch
)

$ErrorActionPreference = "Stop"

$RepoOwner = if ($env:FLINT_REPO_OWNER) { $env:FLINT_REPO_OWNER } else { "flint-md" }
$RepoName = "flint"
$RepoBranch = if ($Branch) { $Branch } elseif ($env:FLINT_BRANCH) { $env:FLINT_BRANCH } else { "main" }
$InstallerUrl = "https://raw.githubusercontent.com/$RepoOwner/$RepoName/$RepoBranch/install.ps1"
$FlintHome = if ($env:FLINT_HOME) { $env:FLINT_HOME } else { Join-Path $env:USERPROFILE ".flint" }

Write-Host ""
Write-Host "  =====================================" -ForegroundColor Cyan
Write-Host "             F L I N T                 " -ForegroundColor Cyan
Write-Host "       Local Knowledge Base & AI       " -ForegroundColor DarkGray
Write-Host "  =====================================" -ForegroundColor Cyan
Write-Host "  Flint Desktop Updater v2.1.0" -ForegroundColor Gray
Write-Host ""


if (-not (Test-Path (Join-Path $FlintHome "app"))) {
  Write-Host "Flint is not installed at $FlintHome." -ForegroundColor Yellow
  Write-Host "Install it with:"
  Write-Host "  irm $InstallerUrl | iex"
  exit 1
}

Write-Host "[1/3] Closing running Flint processes..." -ForegroundColor Cyan
Get-Process -Name "flint", "flint-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -and ($_.Path -like "*$FlintHome*" -or $_.Path -like "*flint*")
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Write-Host "      OK  Ready for update" -ForegroundColor Green

$ScriptDir = $PSScriptRoot
if ([string]::IsNullOrEmpty($ScriptDir)) {
  $ScriptDir = Get-Location
}

# If we are in a local repo, use the local install.ps1
if ((Test-Path (Join-Path $ScriptDir "install.ps1")) -and (Test-Path (Join-Path $ScriptDir "package.json"))) {
  Write-Host "[2/3] Updating from local source at $ScriptDir..." -ForegroundColor Cyan
  $env:FLINT_SOURCE_DIR = $ScriptDir
  $installArgs = @()
  if ($Yes) { $installArgs += "-Yes" }
  if ($NonInteractive) { $installArgs += "-NonInteractive" }
  & (Join-Path $ScriptDir "install.ps1") @installArgs
} else {
  Write-Host "[2/3] Downloading latest installer from $RepoOwner/$RepoName ($RepoBranch)..." -ForegroundColor Cyan
  $TempInstaller = Join-Path ([System.IO.Path]::GetTempPath()) ("flint-update-" + [System.Guid]::NewGuid().ToString("N") + ".ps1")
  Invoke-RestMethod -Uri $InstallerUrl -OutFile $TempInstaller
  $installArgs = @()
  if ($Yes) { $installArgs += "-Yes" }
  if ($NonInteractive) { $installArgs += "-NonInteractive" }
  & $TempInstaller @installArgs
  Remove-Item -LiteralPath $TempInstaller -Force -ErrorAction SilentlyContinue
}

Write-Host "[3/3] Finalizing update" -ForegroundColor Cyan
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Flint Has Been Updated Successfully!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Run Flint:" -ForegroundColor White
Write-Host ("    " + (Join-Path $FlintHome "bin\flint.cmd"))
Write-Host ""
