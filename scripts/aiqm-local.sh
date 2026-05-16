#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
AIQM local installer.

Usage:
  scripts/aiqm-local.sh [bootstrap options] install [--launch-setup]
  scripts/aiqm-local.sh [bootstrap options] setup
  scripts/aiqm-local.sh [bootstrap options] uninstall [--purge-data]
  scripts/aiqm-local.sh --help

Subcommands:
  install       Build helper, link aiqm into ~/.local/bin, install Cinnamon desklet, create app dirs.
  setup         Run the interactive AIQM setup TUI (`aiqm setup`).
  uninstall     Remove Cinnamon desklet and ~/.local/bin/aiqm; preserve app data unless --purge-data.

Install/setup options:
  --launch-setup        With install: launch `aiqm setup` after installation.
  --purge-data          With uninstall: remove AIQM data/cache after strict path safety checks.

Bootstrap options, useful when this script is run outside a cloned repo:
  --repo-url <url>      Git repository to clone if no local repo is detected.
  --ref <ref>           Git branch/tag/commit to checkout after cloning/fetching.
  --install-dir <path>  Source checkout dir. Default: ~/.local/share/ai-agent-quota-monitor/source

Notes:
  - No sudo is used.
  - install creates no accounts and writes no dummy latest.json.
  - Codex accounts are added from the setup TUI after install.
EOF
}

SCRIPT_PATH="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
DEFAULT_INSTALL_DIR="$HOME/.local/share/ai-agent-quota-monitor/source"
REPO_URL="${AIQM_REPO_URL:-}"
REF="${AIQM_REF:-}"
INSTALL_DIR="${AIQM_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
ARGS=()
COMMAND=""
LAUNCH_SETUP=0
PURGE_DATA=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --ref)
      REF="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --launch-setup)
      LAUNCH_SETUP=1
      ARGS+=("$1")
      shift
      ;;
    --purge-data)
      PURGE_DATA=1
      ARGS+=("$1")
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    install|setup|uninstall)
      if [[ -n "$COMMAND" ]]; then
        echo "Only one subcommand may be provided." >&2
        usage >&2
        exit 2
      fi
      COMMAND="$1"
      ARGS+=("$1")
      shift
      ;;
    *)
      echo "Unknown option or subcommand: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$COMMAND" ]]; then
  usage
  exit 0
fi
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  echo "Do not run this script as root; no sudo is required." >&2
  exit 2
fi

is_repo_root() {
  local dir="$1"
  [[ -f "$dir/package.json" && -d "$dir/helper" && -d "$dir/desklet" && -f "$dir/scripts/internal/install-helper.sh" ]]
}

resolve_path() {
  realpath -m "$1"
}

ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if ! is_repo_root "$ROOT_DIR"; then
  INSTALL_DIR="$(resolve_path "$INSTALL_DIR")"
  if [[ -d "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
    echo "Install dir exists but is not a git checkout: $INSTALL_DIR" >&2
    exit 2
  fi
  if [[ ! -d "$INSTALL_DIR/.git" ]]; then
    if [[ -z "$REPO_URL" ]]; then
      echo "No local AIQM repo detected. Pass --repo-url <git-url> to bootstrap a checkout." >&2
      exit 2
    fi
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --depth 1 ${REF:+--branch "$REF"} "$REPO_URL" "$INSTALL_DIR"
  elif [[ -n "$REF" ]]; then
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF" || git -C "$INSTALL_DIR" fetch origin "$REF"
    git -C "$INSTALL_DIR" checkout FETCH_HEAD
  fi
  exec "$INSTALL_DIR/scripts/aiqm-local.sh" "${ARGS[@]}"
fi

DATA_DIR="${AIQM_DATA_DIR:-$HOME/.local/share/ai-agent-quota-monitor}"
CACHE_DIR="${AIQM_CACHE_DIR:-$HOME/.cache/ai-agent-quota-monitor}"
DESKLET_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/cinnamon/desklets/ai-agent-quota-monitor@local"
LOCAL_BIN="$HOME/.local/bin/aiqm"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
POLL_SERVICE_FILE="$SYSTEMD_USER_DIR/aiqm-poll.service"
POLL_TIMER_FILE="$SYSTEMD_USER_DIR/aiqm-poll.timer"

safe_rm_aiqm_path() {
  local label="$1"
  local path="$2"
  local resolved
  resolved="$(resolve_path "$path")"
  local base
  base="$(basename "$resolved")"

  if [[ -z "$path" || -z "$resolved" || "$resolved" == "/" || "$resolved" == "$HOME" || "$base" != "ai-agent-quota-monitor" ]]; then
    echo "Refusing to purge unsafe $label path: $path" >&2
    return 1
  fi

  case "$resolved" in
    "$HOME/.local/share/ai-agent-quota-monitor"|"$HOME/.cache/ai-agent-quota-monitor"|*/ai-agent-quota-monitor)
      ;;
    *)
      echo "Refusing to purge unexpected $label path: $path" >&2
      return 1
      ;;
  esac

  rm -rf "$resolved"
  echo "Purged $label: $resolved"
}

ensure_config_defaults() {
  mkdir -p "$DATA_DIR"
  AIQM_CONFIG_FILE="$DATA_DIR/config.json" node <<'NODE'
const fs = require('node:fs');
const path = process.env.AIQM_CONFIG_FILE;
const minDefaults = { codex: 60, 'claude-code': 600 };
const maxDefaults = { codex: 900, 'claude-code': 900 };
let config = { schemaVersion: '1', accounts: [], settings: { refreshIntervalMinutes: 5 } };
if (fs.existsSync(path)) {
  config = JSON.parse(fs.readFileSync(path, 'utf8'));
}
config.schemaVersion = config.schemaVersion || '1';
config.accounts = Array.isArray(config.accounts) ? config.accounts : [];
config.settings = config.settings && typeof config.settings === 'object' ? config.settings : {};
config.settings.refreshIntervalMinutes = Number.isInteger(config.settings.refreshIntervalMinutes) && config.settings.refreshIntervalMinutes >= 1
  ? config.settings.refreshIntervalMinutes
  : 5;
config.settings.providerPollIntervalSeconds = {
  ...minDefaults,
  ...(config.settings.providerPollIntervalSeconds || {})
};
config.settings.providerPollMaxIntervalSeconds = {
  ...maxDefaults,
  ...(config.settings.providerPollMaxIntervalSeconds || {})
};
fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
NODE
  chmod 600 "$DATA_DIR/config.json"
  echo "Ensured config defaults: $DATA_DIR/config.json"
}

install_poll_timer() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found; skipping AIQM user poll timer."
    return 0
  fi

  local node_bin
  node_bin="$(dirname "$(command -v node)")"
  local interval
  interval="${AIQM_POLL_INTERVAL_SECONDS:-60}"
  if ! [[ "$interval" =~ ^[0-9]+$ ]] || [[ "$interval" -lt 30 ]]; then
    interval=60
  fi

  mkdir -p "$SYSTEMD_USER_DIR"
  cat >"$POLL_SERVICE_FILE" <<EOF
[Unit]
Description=AIQM quota poll

[Service]
Type=oneshot
TimeoutStartSec=45s
KillMode=control-group
ExecStart=/usr/bin/env PATH=%h/.local/bin:$node_bin:/usr/local/bin:/usr/bin:/bin %h/.local/bin/aiqm poll --json
StandardOutput=null
EOF

  cat >"$POLL_TIMER_FILE" <<EOF
[Unit]
Description=AIQM quota poll timer

[Timer]
OnBootSec=30s
OnUnitActiveSec=${interval}s
AccuracySec=5s
Unit=aiqm-poll.service

[Install]
WantedBy=timers.target
EOF

  systemctl --user stop aiqm-poll.service >/dev/null 2>&1 || true
  systemctl --user daemon-reload || true
  systemctl --user enable --now aiqm-poll.timer || true
  systemctl --user restart aiqm-poll.service || true
  echo "Installed user poll timer: aiqm-poll.timer (${interval}s)"
}

uninstall_poll_timer() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now aiqm-poll.timer >/dev/null 2>&1 || true
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  rm -f "$POLL_SERVICE_FILE" "$POLL_TIMER_FILE"
  echo "Removed user poll timer files."
}

run_install() {
  echo "AIQM local install"
  echo "Repository: $ROOT_DIR"
  echo "Data dir: $DATA_DIR"
  echo "Cache dir: $CACHE_DIR"
  echo

  npm run build
  bash "$ROOT_DIR/scripts/internal/install-helper.sh"
  bash "$ROOT_DIR/scripts/internal/install-desklet.sh"
  mkdir -p "$DATA_DIR" "$CACHE_DIR"
  ensure_config_defaults
  install_poll_timer

  echo
  echo "Installed helper link: $LOCAL_BIN"
  if [[ -e "$LOCAL_BIN" ]]; then
    ls -l "$LOCAL_BIN"
  fi
  echo "Installed desklet: $DESKLET_DIR"
  echo "Installed poll timer: $POLL_TIMER_FILE"
  echo
  echo "Next steps:"
  echo "  1. Reload Cinnamon manually if needed (Alt+F2, r, Enter) or log out/in."
  echo "  2. Open Cinnamon Desklets settings and add/enable 'AI Agent Quota Monitor'."
  echo "  3. Run 'aiqm setup' or click the desklet Setup button to add Codex accounts."

  if [[ "$LAUNCH_SETUP" -eq 1 ]]; then
    echo
    echo "Launching aiqm setup. Press c to add Codex accounts."
    "$LOCAL_BIN" setup
  fi
}

run_setup() {
  if [[ ! -x "$LOCAL_BIN" ]]; then
    echo "aiqm is not installed at $LOCAL_BIN. Run: scripts/aiqm-local.sh install" >&2
    exit 1
  fi
  "$LOCAL_BIN" setup
}

run_uninstall() {
  echo "AIQM local uninstall"

  if [[ -e "$LOCAL_BIN" || -L "$LOCAL_BIN" ]]; then
    rm -f "$LOCAL_BIN"
    echo "Removed helper link: $LOCAL_BIN"
  else
    echo "Helper link not found: $LOCAL_BIN"
  fi

  uninstall_poll_timer

  echo "Attempting npm unlink/uninstall cleanup for helper package."
  (cd "$ROOT_DIR/helper" && npm unlink --global @ai-agent-quota-monitor/helper >/dev/null 2>&1) || true
  npm uninstall -g @ai-agent-quota-monitor/helper >/dev/null 2>&1 || true

  if [[ -d "$DESKLET_DIR" ]]; then
    rm -rf "$DESKLET_DIR"
    echo "Removed desklet: $DESKLET_DIR"
  else
    echo "Desklet not installed at: $DESKLET_DIR"
  fi

  find "${XDG_DATA_HOME:-$HOME/.local/share}/cinnamon/desklets" \
    -maxdepth 1 \
    -type d \
    -name 'ai-agent-quota-monitor@local.backup.*' \
    -exec rm -rf {} + 2>/dev/null || true

  if [[ "$PURGE_DATA" -eq 1 ]]; then
    safe_rm_aiqm_path "data" "$DATA_DIR"
    safe_rm_aiqm_path "cache" "$CACHE_DIR"
  else
    echo "App data preserved: $DATA_DIR"
    echo "Cache preserved: $CACHE_DIR"
    echo "Use 'scripts/aiqm-local.sh uninstall --purge-data' to remove them."
  fi
}

case "$COMMAND" in
  install)
    run_install
    ;;
  setup)
    run_setup
    ;;
  uninstall)
    run_uninstall
    ;;
esac
