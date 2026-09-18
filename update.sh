#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="${FLINT_REPO_OWNER:-flint-md}"
REPO_NAME="flint"
REPO_BRANCH="${FLINT_BRANCH:-main}"
INSTALLER_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/install.sh"
FLINT_HOME="${FLINT_HOME:-$HOME/.flint}"

YES_FLAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      YES_FLAG="-y"
      shift
      ;;
    --branch)
      REPO_BRANCH="$2"
      INSTALLER_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/install.sh"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

BOLD=''
GREEN=''
CYAN=''
NC=''
if [ -t 1 ]; then
  BOLD='\033[1m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  NC='\033[0m'
fi

echo ""
echo -e "${CYAN}  ███████╗██╗     ██╗███╗   ██╗████████╗"
echo -e "  ██╔════╝██║     ██║████╗  ██║╚══██╔══╝"
echo -e "  █████╗  ██║     ██║██╔██╗ ██║   ██║   "
echo -e "  ██╔══╝  ██║     ██║██║╚██╗██║   ██║   "
echo -e "  ██║     ███████╗██║██║ ╚████║   ██║   "
echo -e "  ╚═╝     ╚══════╝╚═╝╚═╝  ╚═══╝   ╚═╝   ${NC}"
echo -e "  ${BOLD}Flint Desktop Updater${NC}"
echo ""

if [ ! -d "$FLINT_HOME/app" ]; then
  echo "Flint is not installed at $FLINT_HOME."
  echo "Install with:"
  echo "  curl -fsSL $INSTALLER_URL | bash"
  exit 1
fi

echo -e "${CYAN}[1/3] Closing running Flint processes...${NC}"
pkill -f "flint-desktop" 2>/dev/null || true
pkill -f "electron.*flint" 2>/dev/null || true
pkill -f "agent.py" 2>/dev/null || true
sleep 1
echo "      OK  Ready for update"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# If we are in a local repo, use the local install.sh
if [ -f "$SCRIPT_DIR/install.sh" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
  echo -e "${CYAN}[2/3] Updating from local source at $SCRIPT_DIR...${NC}"
  FLINT_SOURCE_DIR="$SCRIPT_DIR" bash "$SCRIPT_DIR/install.sh" $YES_FLAG
else
  echo -e "${CYAN}[2/3] Downloading latest installer from ${REPO_OWNER}/${REPO_NAME} (${REPO_BRANCH})...${NC}"
  tmp_installer="$(mktemp)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$INSTALLER_URL" -o "$tmp_installer"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp_installer" "$INSTALLER_URL"
  else
    echo "ERROR: curl or wget is required to update Flint." >&2
    exit 1
  fi
  bash "$tmp_installer" $YES_FLAG
  rm -f "$tmp_installer"
fi

echo -e "${CYAN}[3/3] Finalizing update${NC}"
echo ""
echo "============================================================"
echo -e "${GREEN}  Flint Has Been Updated Successfully!${NC}"
echo "============================================================"
echo ""
echo "  Run Flint:"
echo "    $FLINT_HOME/bin/flint"
echo ""
