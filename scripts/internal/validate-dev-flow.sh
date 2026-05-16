#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"
OUTPUT_DIR="$TMP_ROOT/outputs"
mkdir -p "$OUTPUT_DIR"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

export AIQM_DATA_DIR="$TMP_ROOT/data"
export AIQM_CACHE_DIR="$TMP_ROOT/cache"
SECRET_SENTINEL="SECRET_SENTINEL_DO_NOT_LEAK"
CLI="$ROOT_DIR/helper/dist/cli/index.js"

assert_file_exists() {
  if [[ ! -f "$1" ]]; then
    echo "Expected file to exist: $1" >&2
    exit 1
  fi
}

assert_file_missing() {
  if [[ -e "$1" ]]; then
    echo "Expected path to be removed: $1" >&2
    exit 1
  fi
}

assert_no_secret_strings() {
  local path="$1"
  if grep -E "${SECRET_SENTINEL}|tokenPayload|rawMetadata" "$path" >/dev/null 2>&1; then
    echo "Unsafe string found in $path" >&2
    exit 1
  fi
}

run_cli() {
  local name="$1"
  shift
  node "$CLI" "$@" >"$OUTPUT_DIR/$name.json"
  assert_no_secret_strings "$OUTPUT_DIR/$name.json"
}

cd "$ROOT_DIR/helper"
npm run build >/dev/null

run_cli setup setup --provider fake --email release@example.com --scenario multi_window --poll --json
run_cli status status --json
run_cli account-list account list --json
run_cli diagnose diagnose --json
run_cli poll poll --json

LATEST_FILE="$AIQM_DATA_DIR/latest.json"
HISTORY_FILE="$AIQM_DATA_DIR/history.log"
CONFIG_FILE="$AIQM_DATA_DIR/config.json"
TOKENS_FILE="$AIQM_DATA_DIR/tokens.json"

assert_file_exists "$LATEST_FILE"
assert_file_exists "$HISTORY_FILE"
assert_no_secret_strings "$LATEST_FILE"
assert_no_secret_strings "$HISTORY_FILE"

run_cli reset reset --all --json

assert_file_missing "$CONFIG_FILE"
assert_file_missing "$TOKENS_FILE"
assert_file_missing "$LATEST_FILE"
assert_file_missing "$HISTORY_FILE"

echo "AIQM development flow validation passed"
