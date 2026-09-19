#!/usr/bin/env bash
set -euo pipefail

FLINT_HOME="${FLINT_HOME:-$HOME/.flint}"

YES_MODE=false
KEEP_DATA_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      YES_MODE=true
      shift
      ;;
    --keep-data)
      KEEP_DATA_FLAG="y"
      shift
      ;;
    --purge)
      KEEP_DATA_FLAG="n"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

BOLD=''
RED=''
GREEN=''
CYAN=''
NC=''
if [ -t 1 ]; then
  BOLD='\033[1m'
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  NC='\033[0m'
fi

echo ""
echo -e "${RED}  ███████╗██╗     ██╗███╗   ██╗████████╗"
echo -e "  ██╔════╝██║     ██║████╗  ██║╚══██╔══╝"
echo -e "  █████╗  ██║     ██║██╔██╗ ██║   ██║   "
echo -e "  ██╔══╝  ██║     ██║██║╚██╗██║   ██║   "
echo -e "  ██║     ███████╗██║██║ ╚████║   ██║   "
echo -e "  ╚═╝     ╚══════╝╚═╝╚═╝  ╚═══╝   ╚═╝   ${NC}"
echo -e "  ${BOLD}Flint Desktop Uninstaller${NC}"
echo ""

if [ ! -d "$FLINT_HOME" ]; then
  echo "Flint is not installed at $FLINT_HOME."
  exit 0
fi

if [ -n "$KEEP_DATA_FLAG" ]; then
  KEEP_DATA="$KEEP_DATA_FLAG"
elif [ "$YES_MODE" = true ]; then
  KEEP_DATA="y"
else
  read -r -p "  Keep vault notes and local data for a future reinstall? (y/N): " KEEP_DATA
  KEEP_DATA="${KEEP_DATA:-n}"
fi
echo ""

echo -e "${CYAN}[1/4] Stopping Flint processes...${NC}"
pkill -f "flint-desktop" 2>/dev/null || true
pkill -f "electron.*flint" 2>/dev/null || true
pkill -f "agent.py" 2>/dev/null || true
pkill -f "$FLINT_HOME" 2>/dev/null || true
echo "      OK  Processes stopped"

echo -e "${CYAN}[2/4] Removing app menu entry and icons...${NC}"
rm -f "$HOME/.local/share/applications/flint.desktop"
update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
rm -f "$HOME/.local/share/icons/hicolor/512x512/apps/flint.png" 2>/dev/null || true
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi
echo "      OK  App menu entry and icons removed"

echo -e "${CYAN}[3/4] Removing system commands and PATH entries...${NC}"
if [ -L "/usr/local/bin/flint" ] || [ -f "/usr/local/bin/flint" ]; then
  rm -f "/usr/local/bin/flint" 2>/dev/null || sudo rm -f "/usr/local/bin/flint" 2>/dev/null || true
fi
rm -f "$FLINT_HOME/bin/flint" "$FLINT_HOME/bin/flint-agent" "$FLINT_HOME/bin/flint-uninstall" 2>/dev/null || true

# Clean PATH entries from common shell rc files
for rc_file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$rc_file" ] && grep -q "\.flint/bin" "$rc_file"; then
    sed -i '/\.flint\/bin/d' "$rc_file" 2>/dev/null || true
    sed -i '/# Flint/d' "$rc_file" 2>/dev/null || true
  fi
done
echo "      OK  System commands and PATH entries cleaned"

echo -e "${CYAN}[4/4] Removing Flint files...${NC}"
if [[ "$KEEP_DATA" =~ ^[Yy]$ ]]; then
  rm -rf "$FLINT_HOME/app" "$FLINT_HOME/agent" "$FLINT_HOME/source" "$FLINT_HOME/.build" "$FLINT_HOME/bin" "$FLINT_HOME/venv" "$FLINT_HOME/uninstall.sh"
  echo "      OK  Flint app removed. Vault data preserved at $FLINT_HOME"
else
  rm -rf "$FLINT_HOME"
  echo "      OK  Flint completely removed from $FLINT_HOME"
fi

echo ""
echo "============================================================"
echo -e "${GREEN}  Flint Has Been Uninstalled Successfully.${NC}"
echo "============================================================"
echo ""
