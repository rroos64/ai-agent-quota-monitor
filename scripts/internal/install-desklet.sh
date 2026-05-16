#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/desklet"
TARGET_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/cinnamon/desklets/ai-agent-quota-monitor@local"
TARGET_PARENT="$(dirname "$TARGET_DIR")"
BACKUP_PARENT="${AIQM_DATA_DIR:-$HOME/.local/share/ai-agent-quota-monitor}/desklet-backups"
BACKUP_DIR=""
STAGING_DIR=""
INSTALLED=0

restore_on_failure() {
  local exit_code=$?
  if [[ "$INSTALLED" -eq 0 ]]; then
    if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
      rm -rf "$STAGING_DIR"
    fi
    if [[ ! -d "$TARGET_DIR" && -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
      echo "Install failed; restoring previous desklet from: $BACKUP_DIR" >&2
      mv "$BACKUP_DIR" "$TARGET_DIR"
    fi
  fi
  exit "$exit_code"
}
trap restore_on_failure EXIT

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Desklet source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_PARENT"
mkdir -p "$BACKUP_PARENT"

STAGING_DIR="$(mktemp -d "$TARGET_PARENT/ai-agent-quota-monitor@local.staging.XXXXXX")"
cp -R "$SOURCE_DIR"/. "$STAGING_DIR"/

if [[ ! -f "$STAGING_DIR/metadata.json" ]]; then
  echo "Staged desklet metadata.json is missing" >&2
  exit 1
fi

if [[ ! -f "$STAGING_DIR/desklet.js" ]]; then
  echo "Staged desklet.js is missing" >&2
  exit 1
fi

if [[ -d "$TARGET_DIR" ]]; then
  BACKUP_DIR="$BACKUP_PARENT/ai-agent-quota-monitor@local.$(date +%Y%m%d%H%M%S)"
  echo "Existing desklet found. Moving it to backup outside Cinnamon scan dir: $BACKUP_DIR"
  mv "$TARGET_DIR" "$BACKUP_DIR"
fi

mv "$STAGING_DIR" "$TARGET_DIR"
STAGING_DIR=""
INSTALLED=1
trap - EXIT

echo "Desklet installed to: $TARGET_DIR"
if [[ -n "$BACKUP_DIR" ]]; then
  echo "Previous desklet backup: $BACKUP_DIR"
fi

echo "User Cinnamon settings are stored outside this directory and are not intentionally removed."
