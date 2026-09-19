#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="${FLINT_REPO_OWNER:-flint-md}"
REPO_NAME="flint"
REPO_BRANCH="${FLINT_BRANCH:-main}"
REPO_ARCHIVE_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_BRANCH}.tar.gz"

FLINT_HOME="${FLINT_HOME:-$HOME/.flint}"
FLINT_APP="$FLINT_HOME/app"
FLINT_SOURCE_CACHE="$FLINT_HOME/source"
FLINT_BIN="$FLINT_HOME/bin"
FLINT_VENV="$FLINT_HOME/venv"

YES_MODE=false
NON_INTERACTIVE=false
BUILD_FROM_SOURCE=false
LOCAL_SOURCE_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      YES_MODE=true
      shift
      ;;
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    --build-from-source)
      BUILD_FROM_SOURCE=true
      shift
      ;;
    --source-dir)
      LOCAL_SOURCE_OVERRIDE="$2"
      shift 2
      ;;
    --branch)
      REPO_BRANCH="$2"
      REPO_ARCHIVE_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_BRANCH}.tar.gz"
      shift 2
      ;;
    --install-dir)
      FLINT_HOME="$2"
      FLINT_APP="$FLINT_HOME/app"
      FLINT_SOURCE_CACHE="$FLINT_HOME/source"
      FLINT_BIN="$FLINT_HOME/bin"
      FLINT_VENV="$FLINT_HOME/venv"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [ "${FLINT_NON_INTERACTIVE:-}" = "1" ] || [ "${CI:-}" = "true" ]; then
  NON_INTERACTIVE=true
  YES_MODE=true
fi

BOLD=''
DIM=''
GREEN=''
YELLOW=''
RED=''
CYAN=''
NC=''
if [ -t 1 ]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  CYAN='\033[0;36m'
  NC='\033[0m'
fi

say() { printf "%b\n" "$*"; }
step() { say "${CYAN}[$1/8]${NC} $2"; }
ok() { say "      OK  $1"; }
warn() { say "      ${YELLOW}WARN${NC}  $1"; }
fail() { say "${RED}ERROR:${NC} $1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

ask() {
  local prompt="$1"
  local default="$2"
  local answer
  if [ "$YES_MODE" = true ] || [ "$NON_INTERACTIVE" = true ]; then
    say "      ${DIM}$prompt [auto: $default]${NC}"
    if [ "$default" = "y" ]; then return 0; else return 1; fi
  fi
  read -p "      $prompt [$(if [ "$default" = "y" ]; then echo "Y/n"; else echo "y/N"; fi)]: " answer
  answer="${answer:-$default}"
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    return 0
  else
    return 1
  fi
}

print_header() {
  say ""
  say "${CYAN}  ███████╗██╗     ██╗███╗   ██╗████████╗${NC}"
  say "${CYAN}  ██╔════╝██║     ██║████╗  ██║╚══██╔══╝${NC}"
  say "${CYAN}  █████╗  ██║     ██║██╔██╗ ██║   ██║   ${NC}"
  say "${CYAN}  ██╔══╝  ██║     ██║██║╚██╗██║   ██║   ${NC}"
  say "${CYAN}  ██║     ███████╗██║██║ ╚████║   ██║   ${NC}"
  say "${CYAN}  ╚═╝     ╚══════╝╚═╝╚═╝  ╚═══╝   ╚═╝   ${NC}"
  say "  ${DIM}Flint Desktop Installer v2.1.0${NC}"
  say "  Local-first knowledge base with AI"
  say ""
}

check_node() {
  step 1 "Checking Node.js & npm environment"
  have node || fail "Node.js 18+ is required. Install it from https://nodejs.org and rerun this installer."
  have npm || fail "npm is required and should be installed with Node.js."

  node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  if [ "$node_major" -lt 18 ]; then
    fail "Node.js 18+ is required. Found $(node -v)."
  fi

  ok "Node.js $(node -v)"
  ok "npm $(npm -v)"
}

check_python() {
  step 2 "Checking Python for local AI capabilities"
  PYTHON_CMD=""
  if have python3; then
    PYTHON_CMD="python3"
  elif have python; then
    PYTHON_CMD="python"
  fi

  if [ -z "$PYTHON_CMD" ]; then
    warn "Python 3 was not detected. The note app will install, but local Python AI agent features will be disabled."
  else
    ok "$($PYTHON_CMD --version 2>&1)"
  fi
}

try_binary_install() {
  if [ "$BUILD_FROM_SOURCE" = true ] || [ -n "$LOCAL_SOURCE_OVERRIDE" ]; then
    return 1
  fi

  if ! have curl; then
    return 1
  fi

  local arch os
  arch="$(uname -m)"
  os="$(uname -s)"
  if [ "$os" != "Linux" ] || [ "$arch" != "x86_64" ]; then
    return 1
  fi

  step 1 "Checking for official pre-packaged Flint desktop binary"
  local api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
  local release_json
  release_json="$(curl -fsSL -H "User-Agent: Flint-Installer" "$api_url" 2>/dev/null || true)"

  if [ -z "$release_json" ]; then
    return 1
  fi

  local appimage_url
  appimage_url="$(printf "%s" "$release_json" | grep -o '"browser_download_url": *"[^"]*\.AppImage"' | head -n 1 | cut -d '"' -f 4 || true)"

  if [ -z "$appimage_url" ]; then
    ok "No standalone AppImage on latest release, falling back to fast prebuilt runtime"
    return 1
  fi

  say "      Found standalone Linux AppImage: $appimage_url"
  mkdir -p "$FLINT_BIN" "$FLINT_APP"
  say "      Downloading Flint standalone desktop app..."
  curl -fsSL "$appimage_url" -o "$FLINT_BIN/flint"
  chmod +x "$FLINT_BIN/flint"

  # Download logo & uninstaller
  curl -fsSL "https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/public/flint-logo.png" -o "$FLINT_APP/icon.png" 2>/dev/null || true
  curl -fsSL "https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/uninstall.sh" -o "$FLINT_HOME/uninstall.sh" 2>/dev/null || true
  chmod +x "$FLINT_HOME/uninstall.sh" 2>/dev/null || true

  # XDG icon registration
  mkdir -p "$HOME/.local/share/icons/hicolor/512x512/apps" 2>/dev/null || true
  [ -f "$FLINT_APP/icon.png" ] && cp "$FLINT_APP/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/flint.png" 2>/dev/null || true
  have gtk-update-icon-cache && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

  # Desktop launcher
  if [ -d "$HOME/.local/share/applications" ] || mkdir -p "$HOME/.local/share/applications" 2>/dev/null; then
    cat > "$HOME/.local/share/applications/flint.desktop" <<DESKTOP
[Desktop Entry]
Name=Flint
Comment=Local-first knowledge base with AI
Exec=$FLINT_BIN/flint %U
Icon=$FLINT_APP/icon.png
Type=Application
Categories=Office;Utility;TextEditor;
Keywords=notes;markdown;knowledge;ai;
StartupNotify=true
Terminal=false
StartupWMClass=Flint
DESKTOP
    chmod +x "$HOME/.local/share/applications/flint.desktop"
    update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
    ok "Application menu entry created"
  fi

  # Uninstall command
  cat > "$FLINT_BIN/flint-uninstall" <<LAUNCHER
#!/usr/bin/env bash
set -e
FLINT_HOME="\${FLINT_HOME:-$FLINT_HOME}"
if [ -f "\$FLINT_HOME/uninstall.sh" ]; then
  exec "\$FLINT_HOME/uninstall.sh" "\$@"
elif [ -f "\$(dirname "\$0")/../uninstall.sh" ]; then
  exec "\$(dirname "\$0")/../uninstall.sh" "\$@"
else
  echo "Flint uninstaller not found at \$FLINT_HOME/uninstall.sh" >&2
  exit 1
fi
LAUNCHER
  chmod +x "$FLINT_BIN/flint-uninstall"

  case ":$PATH:" in
    *":$FLINT_BIN:"*) ok "Command available as flint" ;;
    *)
      if ! grep -q "$FLINT_BIN" "$HOME/.profile" 2>/dev/null; then
        printf '\n# Flint\nexport PATH="$HOME/.flint/bin:$PATH"\n' >> "$HOME/.profile"
      fi
      ok "Added $FLINT_BIN to PATH"
      ;;
  esac

  ok "Pre-packaged binary installed in seconds without Node.js!"
  return 0
}

stop_running_instances() {
  step 3 "Checking for running Flint instances"
  if pkill -0 -f "flint-desktop" 2>/dev/null || pkill -0 -f "electron.*flint" 2>/dev/null; then
    say "      Closing running Flint instances to prevent file lock conflicts..."
    pkill -f "flint-desktop" 2>/dev/null || true
    pkill -f "electron.*flint" 2>/dev/null || true
    pkill -f "agent.py" 2>/dev/null || true
    sleep 1
    ok "Running instances stopped"
  else
    ok "No conflicting processes found"
  fi
}

resolve_source() {
  step 4 "Preparing source files"

  local_dir=""
  if [ -n "$LOCAL_SOURCE_OVERRIDE" ] && [ -f "$LOCAL_SOURCE_OVERRIDE/package.json" ]; then
    local_dir="$LOCAL_SOURCE_OVERRIDE"
  elif [ -n "${FLINT_SOURCE_DIR:-}" ] && [ -f "$FLINT_SOURCE_DIR/package.json" ]; then
    local_dir="$FLINT_SOURCE_DIR"
  elif [ -f "./package.json" ] && [ -d "./src" ] && [ -d "./electron" ] && grep -q '"name"[[:space:]]*:[[:space:]]*"flint"' ./package.json; then
    local_dir="$(pwd)"
  fi

  rm -rf "$FLINT_SOURCE_CACHE"
  mkdir -p "$FLINT_HOME"

  if [ -n "$local_dir" ]; then
    ok "Using local repository source at $local_dir"
    mkdir -p "$FLINT_SOURCE_CACHE"
    (
      cd "$local_dir"
      tar --exclude='./node_modules' --exclude='./dist_electron' --exclude='./.git' --exclude='./venv' --exclude='./__pycache__' -cf - .
    ) | (
      cd "$FLINT_SOURCE_CACHE"
      tar -xf -
    )
    return
  fi

  tmp_dir="$(mktemp -d)"
  archive="$tmp_dir/flint.tar.gz"
  say "      Downloading latest archive from GitHub ($REPO_OWNER/$REPO_NAME:$REPO_BRANCH)..."
  if have curl; then
    curl -fsSL "$REPO_ARCHIVE_URL" -o "$archive"
  elif have wget; then
    wget -qO "$archive" "$REPO_ARCHIVE_URL"
  else
    fail "curl or wget is required to download Flint from GitHub."
  fi

  mkdir -p "$FLINT_SOURCE_CACHE"
  tar -xzf "$archive" --strip-components=1 -C "$FLINT_SOURCE_CACHE"
  rm -rf "$tmp_dir"
  ok "Downloaded & verified ${REPO_OWNER}/${REPO_NAME} (${REPO_BRANCH})"
}

prepare_install_dir() {
  mkdir -p "$FLINT_APP" "$FLINT_BIN"
  rm -rf "$FLINT_HOME/.build"
}

build_frontend() {
  step 5 "Building Flint application"
  BUILD_DIR="$FLINT_HOME/.build"
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR"
  (
    cd "$FLINT_SOURCE_CACHE"
    tar --exclude='./node_modules' --exclude='./dist_electron' --exclude='./.git' --exclude='./venv' -cf - .
  ) | (
    cd "$BUILD_DIR"
    tar -xf -
  )

  cd "$BUILD_DIR"
  if [ -f "$FLINT_SOURCE_CACHE/dist/index.html" ] && [ "$BUILD_FROM_SOURCE" = false ]; then
    mkdir -p "$BUILD_DIR/dist"
    cp -R "$FLINT_SOURCE_CACHE/dist/." "$BUILD_DIR/dist/"
    ok "Reusing prebuilt bundle from source (fast-path)"
  else
    say "      Installing dependencies with npm..."
    if [ -f package-lock.json ]; then
      npm ci --loglevel=error || npm install --loglevel=error
    else
      npm install --loglevel=error
    fi
    say "      Compiling Vite singlefile bundle..."
    npm run build
  fi

  [ -f "$BUILD_DIR/dist/index.html" ] || fail "Build failed: dist/index.html was not created."
  ok "Frontend build complete"
}

install_agent() {
  step 6 "Installing AI agent & Python environment"
  
  if [ -z "${PYTHON_CMD:-}" ]; then
    warn "Python not found, skipping agent installation."
    return
  fi

  if ! ask "Install local AI agent (requires Python & Ollama support)?" "y"; then
    ok "Skipped AI agent installation"
    return
  fi

  mkdir -p "$FLINT_HOME/agent" "$FLINT_APP/agent"
  if [ -d "$BUILD_DIR/agent" ]; then
    rm -rf "$FLINT_HOME/agent" "$FLINT_APP/agent"
    mkdir -p "$FLINT_HOME/agent" "$FLINT_APP/agent"
    cp -R "$BUILD_DIR/agent/." "$FLINT_HOME/agent/"
    cp -R "$BUILD_DIR/agent/." "$FLINT_APP/agent/"
    ok "Agent files copied"
  else
    warn "No agent directory found in source."
    return
  fi

  if [ -f "$FLINT_HOME/agent/requirements.txt" ]; then
    say "      Creating Python virtual environment ($FLINT_VENV)..."
    "$PYTHON_CMD" -m venv "$FLINT_VENV" || { warn "Failed to create venv. Using system pip."; FLINT_VENV=""; }
    
    local pip_cmd
    local python_bin
    if [ -n "$FLINT_VENV" ]; then
      pip_cmd="$FLINT_VENV/bin/pip"
      python_bin="$FLINT_VENV/bin/python"
    else
      pip_cmd="$PYTHON_CMD -m pip install --user"
      python_bin="$PYTHON_CMD"
    fi

    say "      Installing Python requirements (flask, flask-cors, requests)..."
    $pip_cmd install -q -r "$FLINT_HOME/agent/requirements.txt" || warn "Could not install all Python packages. Install manually via: $pip_cmd install -r $FLINT_HOME/agent/requirements.txt"
    
    if $python_bin -c "import flask, flask_cors, requests" 2>/dev/null; then
      ok "Agent dependencies installed & verified"
    else
      ok "Agent dependencies installed"
    fi
  fi
}

install_desktop_app() {
  step 7 "Configuring Electron desktop runtime"
  
  local install_electron=true
  if [ -x "$FLINT_APP/node_modules/.bin/electron" ]; then
    if ask "Electron runtime is already installed. Reinstall runtime?" "n"; then
      install_electron=true
    else
      install_electron=false
      ok "Preserved existing Electron installation"
    fi
  fi

  cp "$BUILD_DIR/electron/main.cjs" "$FLINT_APP/main.cjs"
  rm -rf "$FLINT_APP/dist"
  cp -R "$BUILD_DIR/dist" "$FLINT_APP/dist"
  
  # Copy logo assets
  [ -f "$BUILD_DIR/public/flint-logo.png" ] && cp "$BUILD_DIR/public/flint-logo.png" "$FLINT_APP/icon.png"
  [ -f "$BUILD_DIR/public/flint-logo.png" ] && cp "$BUILD_DIR/public/flint-logo.png" "$FLINT_APP/flint-logo.png"
  [ -f "$BUILD_DIR/public/flint-logo.ico" ] && cp "$BUILD_DIR/public/flint-logo.ico" "$FLINT_APP/icon.ico"
  [ -f "$BUILD_DIR/public/flint-logo.ico" ] && cp "$BUILD_DIR/public/flint-logo.ico" "$FLINT_APP/flint-logo.ico"

  # Standard XDG icon registration across all resolutions for desktop environments
  if [ -f "$FLINT_APP/icon.png" ]; then
    mkdir -p "$HOME/.local/share/pixmaps" 2>/dev/null || true
    cp "$FLINT_APP/icon.png" "$HOME/.local/share/pixmaps/flint.png" 2>/dev/null || true
    cp "$FLINT_APP/icon.png" "$HOME/.local/share/pixmaps/flint-desktop.png" 2>/dev/null || true

    # Generate icons across all standard resolutions
    if have python3; then
      python3 -c "
import os
from PIL import Image
try:
    img = Image.open('$FLINT_APP/icon.png')
    base = os.path.expanduser('~/.local/share/icons/hicolor')
    for s in [16, 24, 32, 48, 64, 128, 256, 512]:
        d = os.path.join(base, f'{s}x{s}', 'apps')
        os.makedirs(d, exist_ok=True)
        r = img.resize((s, s), Image.Resampling.LANCZOS)
        r.save(os.path.join(d, 'flint.png'))
        r.save(os.path.join(d, 'flint-desktop.png'))
except Exception:
    pass
" 2>/dev/null || true
    else
      for s in 16 24 32 48 64 128 256 512; do
        mkdir -p "$HOME/.local/share/icons/hicolor/${s}x${s}/apps" 2>/dev/null || true
        cp "$FLINT_APP/icon.png" "$HOME/.local/share/icons/hicolor/${s}x${s}/apps/flint.png" 2>/dev/null || true
        cp "$FLINT_APP/icon.png" "$HOME/.local/share/icons/hicolor/${s}x${s}/apps/flint-desktop.png" 2>/dev/null || true
      done
    fi

    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
      gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
    fi
  fi

  # Deploy uninstaller
  if [ -f "$BUILD_DIR/uninstall.sh" ]; then
    cp "$BUILD_DIR/uninstall.sh" "$FLINT_HOME/uninstall.sh"
    chmod +x "$FLINT_HOME/uninstall.sh"
  elif [ -f "$FLINT_SOURCE_CACHE/uninstall.sh" ]; then
    cp "$FLINT_SOURCE_CACHE/uninstall.sh" "$FLINT_HOME/uninstall.sh"
    chmod +x "$FLINT_HOME/uninstall.sh"
  fi

  cat > "$FLINT_APP/package.json" <<'JSON'
{
  "name": "flint-desktop",
  "version": "2.1.0",
  "private": true,
  "main": "main.cjs",
  "devDependencies": {
    "electron": "^42.4.0"
  }
}
JSON

  if [ "$install_electron" = true ]; then
    say "      Downloading Electron runtime (may take 1-2 mins)..."
    cd "$FLINT_APP"
    npm install --omit=optional --loglevel=error
    [ -x "$FLINT_APP/node_modules/.bin/electron" ] || fail "Electron was not installed."
  fi
  ok "Electron desktop runtime ready"
}

create_launchers() {
  step 8 "Creating launchers, desktop entries, and PATH"

  cat > "$FLINT_BIN/flint" <<LAUNCHER
#!/usr/bin/env bash
set -e
FLINT_APP="$FLINT_APP"
if [ ! -x "\$FLINT_APP/node_modules/.bin/electron" ]; then
  echo "Flint desktop runtime is missing. Reinstall with: curl -fsSL https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/install.sh | bash" >&2
  exit 1
fi
exec "\$FLINT_APP/node_modules/.bin/electron" "\$FLINT_APP" "\$@"
LAUNCHER
  chmod +x "$FLINT_BIN/flint"

  local agent_python
  if [ -f "$FLINT_VENV/bin/python3" ]; then
    agent_python="$FLINT_VENV/bin/python3"
  elif [ -f "$FLINT_VENV/bin/python" ]; then
    agent_python="$FLINT_VENV/bin/python"
  else
    agent_python="python3"
  fi

  cat > "$FLINT_BIN/flint-agent" <<AGENT
#!/usr/bin/env bash
set -e
exec "$agent_python" "$FLINT_HOME/agent/agent.py" "\$@"
AGENT
  chmod +x "$FLINT_BIN/flint-agent"

  # Uninstaller CLI wrapper
  cat > "$FLINT_BIN/flint-uninstall" <<LAUNCHER
#!/usr/bin/env bash
set -e
FLINT_HOME="\${FLINT_HOME:-$FLINT_HOME}"
if [ -f "\$FLINT_HOME/uninstall.sh" ]; then
  exec "\$FLINT_HOME/uninstall.sh" "\$@"
elif [ -f "\$(dirname "\$0")/../uninstall.sh" ]; then
  exec "\$(dirname "\$0")/../uninstall.sh" "\$@"
else
  echo "Flint uninstaller not found at \$FLINT_HOME/uninstall.sh" >&2
  exit 1
fi
LAUNCHER
  chmod +x "$FLINT_BIN/flint-uninstall"

  if [ -d "$HOME/.local/share/applications" ] || mkdir -p "$HOME/.local/share/applications" 2>/dev/null; then
    cat > "$HOME/.local/share/applications/flint.desktop" <<DESKTOP
[Desktop Entry]
Name=Flint
Comment=Local-first knowledge base with AI
Exec=$FLINT_BIN/flint %U
Icon=flint
Type=Application
Categories=Office;Utility;TextEditor;
Keywords=notes;markdown;knowledge;ai;
StartupNotify=true
Terminal=false
StartupWMClass=flint-desktop
DESKTOP
    chmod +x "$HOME/.local/share/applications/flint.desktop"
    cp "$HOME/.local/share/applications/flint.desktop" "$HOME/.local/share/applications/flint-desktop.desktop"
    chmod +x "$HOME/.local/share/applications/flint-desktop.desktop"
    update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
    ok "Application menu entry created"
  fi

  case ":$PATH:" in
    *":$FLINT_BIN:"*) ok "Command available as flint" ;;
    *)
      if ! grep -q "$FLINT_BIN" "$HOME/.profile" 2>/dev/null; then
        printf '\n# Flint\nexport PATH="$HOME/.flint/bin:$PATH"\n' >> "$HOME/.profile"
        warn "Added $FLINT_BIN to PATH in ~/.profile. Open a new terminal or run: export PATH=\"$FLINT_BIN:\$PATH\""
      else
        ok "PATH already contains $FLINT_BIN"
      fi
      ;;
  esac
}

cleanup() {
  rm -rf "${BUILD_DIR:-}" 2>/dev/null || true
}

main() {
  print_header
  stop_running_instances

  if try_binary_install; then
    return 0
  fi

  check_node
  check_python
  resolve_source
  prepare_install_dir
  build_frontend
  install_agent
  install_desktop_app
  create_launchers
  cleanup

  say ""
  say "============================================================"
  say "${GREEN}  Flint Installed Successfully!${NC}"
  say "============================================================"
  say ""
  say "  Launch Flint:"
  say "    - From app launcher: Search for 'Flint'"
  say "    - From terminal:     flint"
  say "    - Direct executable: $FLINT_BIN/flint"
  say ""
  say "  AI Agent Launcher (Optional):"
  say "    - flint-agent"
  say ""
  say "  To uninstall anytime:"
  say "    - Terminal command:  flint-uninstall"
  say "    - Direct script:     $FLINT_HOME/uninstall.sh"
  say ""
}

main "$@"
