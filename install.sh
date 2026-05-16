#!/usr/bin/env bash
# AIQM one-command installer.
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/rroos64/ai-agent-quota-monitor/main/install.sh)
#   bash <(curl -fsSL https://raw.githubusercontent.com/rroos64/ai-agent-quota-monitor/main/install.sh) --launch-setup
#
# To install a specific release tag:
#   AIQM_REF=v1.0.0 bash <(curl -fsSL https://raw.githubusercontent.com/rroos64/ai-agent-quota-monitor/main/install.sh)
#
# Or use a pinned tag URL directly:
#   bash <(curl -fsSL https://raw.githubusercontent.com/rroos64/ai-agent-quota-monitor/v1.0.0/install.sh)
#
# All extra arguments are forwarded to aiqm-local.sh (e.g. --launch-setup).
set -euo pipefail

REPO_URL="https://github.com/rroos64/ai-agent-quota-monitor"
REF="${AIQM_REF:-}"
SCRIPT_URL="${REPO_URL}/raw/${REF:-refs/heads/main}/scripts/aiqm-local.sh"

TMP=$(mktemp)
curl -fsSL "$SCRIPT_URL" -o "$TMP"

REF_ARGS=()
[[ -n "$REF" ]] && REF_ARGS=(--ref "$REF")

bash "$TMP" --repo-url "$REPO_URL" "${REF_ARGS[@]}" "$@"
EXIT_CODE=$?
rm -f "$TMP"
exit $EXIT_CODE
