#!/usr/bin/env bash
# Project-local telnyx-edge CLI that reads API key from .env into isolated config

set -euo pipefail
cd "$(dirname "$0")/.."

# Extract TELNYX_API_KEY from .env
key=$(grep -E '^TELNYX_API_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')
[ -n "$key" ] || { echo "TELNYX_API_KEY is not set in .env" >&2; exit 1; }

# Write to project-local .edge-home (git-ignored)
mkdir -p .edge-home/.telnyx-edge
umask 077
printf 'api_endpoint = "https://api.telnyx.com"\napi_key = "%s"\n' "$key" > .edge-home/.telnyx-edge/config.toml

# Execute telnyx-edge with project-local HOME
REAL_HOME="$HOME"
EDGE_BIN="${TELNYX_EDGE_BIN:-$(command -v telnyx-edge 2>/dev/null || echo "$REAL_HOME/bin/telnyx-edge")}"
[ -x "$EDGE_BIN" ] || { echo "telnyx-edge not found" >&2; exit 1; }

HOME="$PWD/.edge-home" exec "$EDGE_BIN" "$@"
