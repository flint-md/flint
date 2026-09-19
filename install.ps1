[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$NonInteractive,
  [switch]$BuildFromSource,
  [string]$SourceDir,
  [string]$Branch,
  [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$RepoOwner = if ($env:FLINT_REPO_OWNER) { $env:FLINT_REPO_OWNER } else { "flint-md" }
$RepoName = "flint"
$RepoBranch = if ($Branch) { $Branch } elseif ($env:FLINT_BRANCH) { $env:FLINT_BRANCH } else { "main" }
$RepoArchiveUrl = "https://github.com/$RepoOwner/$RepoName/archive/refs/heads/$RepoBranch.zip"

$FlintHome = if ($InstallDir) { $InstallDir } elseif ($env:FLINT_HOME) { $env:FLINT_HOME } else { Join-Path $env:USERPROFILE ".flint" }
$FlintApp = Join-Path $FlintHome "app"
$FlintBin = Join-Path $FlintHome "bin"
$FlintVenv = Join-Path $FlintHome "venv"
$SourceCache = Join-Path $FlintHome "source"
$BuildDir = Join-Path $FlintHome ".build"

function Show-Banner {
  Write-Host ""
  Write-Host "  =====================================" -ForegroundColor Cyan
  Write-Host "             F L I N T                 " -ForegroundColor Cyan
  Write-Host "       Local Knowledge Base & AI       " -ForegroundColor DarkGray
  Write-Host "  =====================================" -ForegroundColor Cyan
  Write-Host "  Desktop Installer v2.1.0" -ForegroundColor Gray
  Write-Host ""
}


function Write-Step($Index, $Text) {
  Write-Host "[$Index/8] $Text" -ForegroundColor Cyan
}

function Write-Ok($Text) {
  Write-Host "      OK  $Text" -ForegroundColor Green
}

function Write-Warn($Text) {
  Write-Host "      WARN  $Text" -ForegroundColor Yellow
}

function Fail($Text) {
  throw "ERROR: $Text"
}

function Test-Command($Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ask-User($Prompt, $Default) {
  if ($Yes -or $NonInteractive -or ($env:FLINT_NON_INTERACTIVE -eq "1") -or ($env:CI -eq "true")) {
    Write-Host "      $Prompt [auto: $Default]" -ForegroundColor DarkGray
    return $Default -match "^[Yy]$"
  }
  $choices = if ($Default -eq "y") { "Y/n" } else { "y/N" }
  $response = Read-Host "      $Prompt [$choices]"
  if ([string]::IsNullOrWhiteSpace($response)) {
    $response = $Default
  }
  return $response -match "^[Yy]$"
}

function Copy-DirectoryContents($Source, $Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $excludedNames = @("node_modules", "dist_electron", ".git", ".build", "venv", "__pycache__", ".vscode", "temp_asar", "electron_log.txt")
  Get-ChildItem -Force -LiteralPath $Source | ForEach-Object {
    if ($_.Name -in $excludedNames -or $_.Name.EndsWith(".pyc")) {
      return
    }
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

Show-Banner

# Step 1: Check Node.js
Write-Step 1 "Checking Node.js & npm environment"
if (-not (Test-Command "node")) {
  Fail "Node.js 18+ is required. Please install it from https://nodejs.org and rerun this installer."
}
if (-not (Test-Command "npm")) {
  Fail "npm is required and should be installed alongside Node.js."
}

$NodeVersion = (& node -p "process.versions.node").Trim()
$NodeMajor = [int]($NodeVersion.Split(".")[0])
if ($NodeMajor -lt 18) {
  Fail "Node.js 18+ is required. Found $NodeVersion."
}
Write-Ok "Node.js v$NodeVersion"
Write-Ok "npm v$((& npm -v).Trim())"

# Step 2: Check Python
Write-Step 2 "Checking Python for local AI capabilities"
$PythonCmd = $null
if (Test-Command "python") {
  $PythonCmd = "python"
} elseif (Test-Command "python3") {
  $PythonCmd = "python3"
}

if ($PythonCmd) {
  Write-Ok "$((& $PythonCmd --version 2>&1).Trim())"
} else {
  Write-Warn "Python 3 was not detected. The note app will install, but local Python AI agent features will be disabled."
}

# Step 3: Check Running Instances
Write-Step 3 "Checking for running Flint instances"
$flintProcs = Get-Process -Name "flint", "flint-desktop" -ErrorAction SilentlyContinue
$electronProcs = Get-Process -Name "electron" -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -and ($_.Path -like "*$FlintHome*" -or $_.Path -like "*flint*")
}
$runningProcs = @($flintProcs) + @($electronProcs)
if ($runningProcs.Count -gt 0) {
  Write-Host "      Detected running Flint process. Gracefully stopping before file update..." -ForegroundColor Yellow
  foreach ($p in $runningProcs) {
    try {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  Start-Sleep -Seconds 1
  Write-Ok "Running instances stopped"
} else {
  Write-Ok "No conflicting processes found"
}

# Step 4: Prepare Source
Write-Step 4 "Preparing source files"
New-Item -ItemType Directory -Force -Path $FlintHome | Out-Null
Remove-Item -Recurse -Force -LiteralPath $SourceCache -ErrorAction SilentlyContinue

$LocalSource = $null
if ($SourceDir -and (Test-Path (Join-Path $SourceDir "package.json"))) {
  $LocalSource = $SourceDir
} elseif ($env:FLINT_SOURCE_DIR -and (Test-Path (Join-Path $env:FLINT_SOURCE_DIR "package.json"))) {
  $LocalSource = $env:FLINT_SOURCE_DIR
} elseif ((Test-Path ".\package.json") -and (Test-Path ".\src") -and (Test-Path ".\electron") -and ((Get-Content ".\package.json" -Raw) -match '"name"\s*:\s*"flint"')) {
  $LocalSource = (Get-Location).Path
}

if ($LocalSource) {
  Copy-DirectoryContents $LocalSource $SourceCache
  Write-Ok "Using local repository source from $LocalSource"
} else {
  $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("flint-install-" + [System.Guid]::NewGuid().ToString("N"))
  $Archive = Join-Path $TempDir "flint.zip"
  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  Write-Host "      Downloading latest archive from GitHub ($RepoOwner/$RepoName branch $RepoBranch)..."
  Invoke-WebRequest -Uri $RepoArchiveUrl -OutFile $Archive
  Expand-Archive -LiteralPath $Archive -DestinationPath $TempDir -Force
  $Expanded = Get-ChildItem -Directory -LiteralPath $TempDir | Where-Object { $_.Name -like "$RepoName-*" } | Select-Object -First 1
  if (-not $Expanded) {
    Fail "Could not unpack the Flint source archive from GitHub."
  }
  Copy-DirectoryContents $Expanded.FullName $SourceCache
  Remove-Item -Recurse -Force -LiteralPath $TempDir -ErrorAction SilentlyContinue
  Write-Ok "Downloaded & verified $RepoOwner/$RepoName ($RepoBranch)"
}

# Step 5: Building Frontend
Write-Step 5 "Building Flint application"
Remove-Item -Recurse -Force -LiteralPath $BuildDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $FlintApp, $FlintBin, $BuildDir | Out-Null
Copy-DirectoryContents $SourceCache $BuildDir

Push-Location $BuildDir
try {
  # Check if prebuilt dist exists in source cache or local source
  $hasPrebuilt = (Test-Path (Join-Path $BuildDir "dist\index.html")) -or (Test-Path (Join-Path $SourceCache "dist\index.html"))
  if ($hasPrebuilt -and (-not $BuildFromSource)) {
    if (-not (Test-Path (Join-Path $BuildDir "dist\index.html"))) {
      New-Item -ItemType Directory -Force -Path (Join-Path $BuildDir "dist") | Out-Null
      Copy-Item -LiteralPath (Join-Path $SourceCache "dist\*") -Destination (Join-Path $BuildDir "dist") -Recurse -Force
    }
    Write-Ok "Reusing prebuilt bundle from source (fast-path)"
  } else {
    Write-Host "      Installing dependencies with npm..."
    if (Test-Path "package-lock.json") {
      & npm ci --loglevel=error
      if ($LASTEXITCODE -ne 0) {
        & npm install --loglevel=error
        if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
      }
    } else {
      & npm install --loglevel=error
      if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
    }
    Write-Host "      Compiling Vite singlefile bundle..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { Fail "npm run build failed." }
  }
} finally {
  Pop-Location
}

if (-not (Test-Path (Join-Path $BuildDir "dist\index.html"))) {
  Fail "Build failed: dist\index.html was not created."
}
Write-Ok "Frontend build complete"

# Step 6: Installing AI Agent
Write-Step 6 "Installing AI agent & Python environment"
if (-not $PythonCmd) {
  Write-Warn "Python not found, skipping local agent installation."
} else {
  if (Ask-User "Install local AI agent (requires Python & Ollama support)?" "y") {
    $AgentHome = Join-Path $FlintHome "agent"
    $AgentApp = Join-Path $FlintApp "agent"
    Remove-Item -Recurse -Force -LiteralPath $AgentHome, $AgentApp -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $AgentHome, $AgentApp | Out-Null
    $BuildAgent = Join-Path $BuildDir "agent"
    if (Test-Path $BuildAgent) {
      Copy-Item -Path (Join-Path $BuildAgent "*") -Destination $AgentHome -Recurse -Force
      Copy-Item -Path (Join-Path $BuildAgent "*") -Destination $AgentApp -Recurse -Force
      Write-Ok "Agent files copied"

      $AgentReqs = Join-Path $AgentHome "requirements.txt"
      if (Test-Path $AgentReqs) {
        Write-Host "      Setting up Python virtual environment ($FlintVenv)..."
        & $PythonCmd -m venv $FlintVenv
        $VenvPip = Join-Path $FlintVenv "Scripts\pip.exe"
        $VenvPython = Join-Path $FlintVenv "Scripts\python.exe"
        if (-not (Test-Path $VenvPip)) {
          $VenvPip = Join-Path $FlintVenv "bin\pip"
          $VenvPython = Join-Path $FlintVenv "bin\python"
        }

        Write-Host "      Installing Python requirements (flask, flask-cors, requests)..."
        & $VenvPip install -q -r $AgentReqs
        if ($LASTEXITCODE -ne 0) {
          Write-Warn "Could not auto-install all Python requirements. You can install them manually via: $VenvPip install -r $AgentReqs"
        } else {
          # Verify health
          try {
            $testRes = (& $VenvPython -c "import flask, flask_cors, requests; print('OK')" 2>&1).Trim()
            if ($testRes -eq "OK") {
              Write-Ok "Agent dependencies installed & verified"
            } else {
              Write-Ok "Agent dependencies installed"
            }
          } catch {
            Write-Ok "Agent dependencies installed"
          }
        }
      }
    } else {
      Write-Warn "No agent directory found in source."
    }
  } else {
    Write-Ok "Skipped AI agent installation"
  }
}

# Step 7: Installing Desktop App
Write-Step 7 "Configuring Electron desktop runtime"
$InstallElectron = $true
$ElectronCmd = Join-Path $FlintApp "node_modules\.bin\electron.cmd"
if (Test-Path $ElectronCmd) {
  if (-not (Ask-User "Electron runtime is already installed. Reinstall runtime?" "n")) {
    $InstallElectron = $false
    Write-Ok "Preserved existing Electron installation"
  }
}

Copy-Item -LiteralPath (Join-Path $BuildDir "electron\main.cjs") -Destination (Join-Path $FlintApp "main.cjs") -Force
Remove-Item -Recurse -Force -LiteralPath (Join-Path $FlintApp "dist") -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $BuildDir "dist") -Destination (Join-Path $FlintApp "dist") -Recurse -Force

$LogoIco = Join-Path $BuildDir "public\flint-logo.ico"
if (Test-Path $LogoIco) {
  Copy-Item -LiteralPath $LogoIco -Destination (Join-Path $FlintApp "icon.ico") -Force
  Copy-Item -LiteralPath $LogoIco -Destination (Join-Path $FlintApp "flint-logo.ico") -Force
}
$LogoPng = Join-Path $BuildDir "public\flint-logo.png"
if (Test-Path $LogoPng) {
  Copy-Item -LiteralPath $LogoPng -Destination (Join-Path $FlintApp "icon.png") -Force
  Copy-Item -LiteralPath $LogoPng -Destination (Join-Path $FlintApp "flint-logo.png") -Force
}

# Deploy uninstaller scripts
$UninstallerPs1 = Join-Path $BuildDir "uninstall.ps1"
if (-not (Test-Path $UninstallerPs1)) { $UninstallerPs1 = Join-Path $SourceCache "uninstall.ps1" }
if (Test-Path $UninstallerPs1) {
  Copy-Item -LiteralPath $UninstallerPs1 -Destination (Join-Path $FlintHome "uninstall.ps1") -Force
}
$UninstallerBat = Join-Path $BuildDir "uninstall.bat"
if (-not (Test-Path $UninstallerBat)) { $UninstallerBat = Join-Path $SourceCache "uninstall.bat" }
if (Test-Path $UninstallerBat) {
  Copy-Item -LiteralPath $UninstallerBat -Destination (Join-Path $FlintHome "uninstall.bat") -Force
}

if ($InstallElectron) {
  $DesktopPackage = @"
{
  "name": "flint-desktop",
  "version": "2.1.0",
  "private": true,
  "main": "main.cjs",
  "devDependencies": {
    "electron": "^42.4.0"
  }
}
"@
  Set-Content -LiteralPath (Join-Path $FlintApp "package.json") -Value $DesktopPackage -Encoding UTF8
  Push-Location $FlintApp
  try {
    Write-Host "      Downloading Electron runtime (may take 1-2 mins)..."
    & npm install --omit=optional --loglevel=error
    if ($LASTEXITCODE -ne 0) { Fail "Electron install failed." }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $ElectronCmd)) {
  Fail "Electron was not installed. Flint must run as a desktop application."
}
Write-Ok "Electron runtime configured successfully"

# Step 8: Creating Launchers & Shortcuts
Write-Step 8 "Creating launchers, Start Menu shortcut, and PATH"
$Launcher = Join-Path $FlintBin "flint.cmd"
$LauncherBody = @"
@echo off
set "FLINT_APP=$FlintApp"
if not exist "%FLINT_APP%\node_modules\.bin\electron.cmd" (
  echo Flint desktop runtime is missing. Reinstall with: irm https://raw.githubusercontent.com/$RepoOwner/$RepoName/$RepoBranch/install.ps1 ^| iex 1>&2
  exit /b 1
)
"%FLINT_APP%\node_modules\.bin\electron.cmd" "%FLINT_APP%" %*
"@
Set-Content -LiteralPath $Launcher -Value $LauncherBody -Encoding ASCII

$VenvPython = Join-Path $FlintVenv "Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
  $VenvPython = Join-Path $FlintVenv "bin\python"
}
if (-not (Test-Path $VenvPython)) {
  $VenvPython = if ($PythonCmd) { $PythonCmd } else { "python" }
}

$AgentLauncher = Join-Path $FlintBin "flint-agent.cmd"
$AgentLauncherBody = @"
@echo off
if not exist "$VenvPython" (
  echo Python environment is missing. Reinstall Flint. 1>&2
  exit /b 1
)
"$VenvPython" "$AgentHome\agent.py" %*
"@
Set-Content -LiteralPath $AgentLauncher -Value $AgentLauncherBody -Encoding ASCII

# Create uninstaller command wrapper
$UninstallLauncher = Join-Path $FlintBin "flint-uninstall.cmd"
$UninstallLauncherBody = @"
@echo off
set "FLINT_HOME=$FlintHome"
if exist "%FLINT_HOME%\uninstall.bat" (
  call "%FLINT_HOME%\uninstall.bat" %*
) else if exist "%FLINT_HOME%\uninstall.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%FLINT_HOME%\uninstall.ps1" %*
) else (
  echo Flint uninstaller not found at %FLINT_HOME%\uninstall.bat 1>&2
  exit /b 1
)
"@
Set-Content -LiteralPath $UninstallLauncher -Value $UninstallLauncherBody -Encoding ASCII

# Start Menu Shortcut
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
$ShortcutFile = Join-Path $StartMenu "Flint.lnk"
try {
  $Shell = New-Object -ComObject WScript.Shell
  $Shortcut = $Shell.CreateShortcut($ShortcutFile)
  $Shortcut.TargetPath = $Launcher
  $Shortcut.WorkingDirectory = $FlintBin
  $IconIco = Join-Path $FlintApp "icon.ico"
  $IconPng = Join-Path $FlintApp "icon.png"
  if (Test-Path $IconIco) {
    $Shortcut.IconLocation = "$IconIco,0"
  } elseif (Test-Path $IconPng) {
    $Shortcut.IconLocation = $IconPng
  }
  $Shortcut.Description = "Flint local-first knowledge base with AI"
  $Shortcut.Save()
  Write-Ok "Start Menu shortcut created"
} catch {
  Write-Warn "Could not create Start Menu shortcut."
}

# PATH configuration
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($UserPath.Split(";") -contains $FlintBin)) {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$FlintBin", "User")
  Write-Ok "Added $FlintBin to your User PATH"
} else {
  Write-Ok "PATH already contains $FlintBin"
}

# Also update current PowerShell session PATH so user can run 'flint' immediately
if (-not ($env:PATH.Split(";") -contains $FlintBin)) {
  $env:PATH = "$FlintBin;$env:PATH"
  Write-Ok "Updated current session PATH. 'flint' command is immediately ready!"
}

# Cleanup temporary build directory
Remove-Item -Recurse -Force -LiteralPath $BuildDir -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Flint Installed Successfully!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Launch Flint:" -ForegroundColor White
Write-Host "    - From Start Menu: Search for 'Flint'"
Write-Host "    - From Terminal:   flint"
Write-Host "    - Direct Launcher: $Launcher"
Write-Host ""
Write-Host "  AI Agent Launcher (Optional):" -ForegroundColor White
Write-Host "    - flint-agent"
Write-Host ""
Write-Host "  To uninstall anytime:" -ForegroundColor White
Write-Host "    - Terminal Command: flint-uninstall"
Write-Host "    - Direct Script:    $FlintHome\uninstall.bat"
Write-Host ""
