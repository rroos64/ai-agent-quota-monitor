#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER_DIR="$ROOT_DIR/helper"

if [[ "${1:-}" == "--global" ]]; then
  echo "Installing aiqm globally from helper package with npm install -g (user npm prefix applies)."
  npm install -g "$HELPER_DIR"
else
  echo "Linking aiqm locally with npm link from helper package."
  echo "Use --global to run npm install -g ./helper instead."
  (cd "$HELPER_DIR" && npm link)
fi

AIQM_BIN="$(command -v aiqm)"
mkdir -p "$HOME/.local/bin"
ln -sfn "$AIQM_BIN" "$HOME/.local/bin/aiqm"

cat >"$HOME/.local/bin/aiqm-setup-terminal" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
AIQM_BIN="$HOME/.local/bin/aiqm"
AIQM_REAL_BIN="$(readlink -f "$AIQM_BIN" 2>/dev/null || printf '%s' "$AIQM_BIN")"
AIQM_NODE_BIN="$(dirname "$AIQM_REAL_BIN")"
SETUP_CMD='export PATH="$HOME/.local/bin:'"$AIQM_NODE_BIN"':$PATH"; export TERM="${TERM:-xterm-256color}"; clear; "$HOME/.local/bin/aiqm" setup; status=$?; if [ $status -ne 0 ]; then echo; read -r -p "Press Enter to close..."; fi; exit $status'

SCREEN_INFO=""
if command -v xrandr >/dev/null 2>&1; then
  SCREEN_INFO="$(xrandr --current 2>/dev/null | awk '/ connected primary / {for (i=1; i<=NF; i++) if ($i ~ /^[0-9]+x[0-9]+[+-][0-9]+[+-][0-9]+$/) {print $i; exit}} / connected / && first == "" {for (i=1; i<=NF; i++) if ($i ~ /^[0-9]+x[0-9]+[+-][0-9]+[+-][0-9]+$/) {first=$i}} END {if (first != "") print first}')"
fi
SCREEN_GEOMETRY="${SCREEN_INFO%%+*}"
SCREEN_OFFSET="${SCREEN_INFO#*+}"
SCREEN_X="${SCREEN_OFFSET%%+*}"
SCREEN_Y="${SCREEN_OFFSET#*+}"
SCREEN_WIDTH="${SCREEN_GEOMETRY%x*}"
SCREEN_HEIGHT="${SCREEN_GEOMETRY#*x}"
if [[ "$SCREEN_WIDTH" =~ ^[0-9]+$ && "$SCREEN_HEIGHT" =~ ^[0-9]+$ && "$SCREEN_X" =~ ^[0-9]+$ && "$SCREEN_Y" =~ ^[0-9]+$ ]]; then
  TERM_COLS=$(( SCREEN_WIDTH * 40 / 100 / 9 ))
  TERM_ROWS=$(( SCREEN_HEIGHT * 40 / 100 / 18 ))
  (( TERM_COLS < 60 )) && TERM_COLS=60
  (( TERM_ROWS < 18 )) && TERM_ROWS=18
  TERM_X=$(( SCREEN_X + (SCREEN_WIDTH - (TERM_COLS * 9)) / 2 ))
  TERM_Y=$(( SCREEN_Y + (SCREEN_HEIGHT - (TERM_ROWS * 18)) / 2 ))
  (( TERM_X < 0 )) && TERM_X=0
  (( TERM_Y < 0 )) && TERM_Y=0
  TERMINAL_GEOMETRY="${TERM_COLS}x${TERM_ROWS}+${TERM_X}+${TERM_Y}"
else
  TERMINAL_GEOMETRY="80x24"
fi

if command -v gnome-terminal >/dev/null 2>&1; then
  exec gnome-terminal --title="AIQM Setup" --geometry="$TERMINAL_GEOMETRY" -- bash -ic "$SETUP_CMD"
elif command -v mate-terminal >/dev/null 2>&1; then
  exec mate-terminal --title="AIQM Setup" --geometry="$TERMINAL_GEOMETRY" -- bash -ic "$SETUP_CMD"
elif command -v xterm >/dev/null 2>&1; then
  exec xterm -T "AIQM Setup" -geometry "$TERMINAL_GEOMETRY" -e bash -ic "$SETUP_CMD"
elif command -v x-terminal-emulator >/dev/null 2>&1; then
  exec x-terminal-emulator -geometry "$TERMINAL_GEOMETRY" -e bash -ic "$SETUP_CMD"
else
  exec "$AIQM_BIN" setup
fi
EOF
chmod 0755 "$HOME/.local/bin/aiqm-setup-terminal"

echo "Helper CLI installed. Try: aiqm --help"
echo "User-local Cinnamon-compatible link: $HOME/.local/bin/aiqm -> $AIQM_BIN"
echo "User-local Cinnamon setup launcher: $HOME/.local/bin/aiqm-setup-terminal"
