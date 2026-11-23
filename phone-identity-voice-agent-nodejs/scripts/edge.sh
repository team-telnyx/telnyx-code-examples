#!/usr/bin/env bash
# Runs the Telnyx Edge CLI against THIS project's account: the API key comes
# from .env (TELNYX_API_KEY), through a project-local CLI home (.edge-home/,
# git-ignored), so the global ~/.telnyx-edge login used by other projects is
# never touched.   npm run edge -- <telnyx-edge args>   e.g. npm run edge -- list
set -euo pipefail
cd "$(dirname "$0")/.."
key=$(grep -E '^TELNYX_API_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')
[ -n "$key" ] || { echo "TELNYX_API_KEY is not set in .env" >&2; exit 1; }
mkdir -p .edge-home/.telnyx-edge
umask 077
printf 'api_endpoint = "https://api.telnyx.com"\napi_key = "%s"\n' "$key" > .edge-home/.telnyx-edge/config.toml
REAL_HOME="$HOME"
EDGE_BIN="${TELNYX_EDGE_BIN:-$(command -v telnyx-edge 2>/dev/null || echo "$REAL_HOME/bin/telnyx-edge")}"
[ -x "$EDGE_BIN" ] || { echo "telnyx-edge not found (set TELNYX_EDGE_BIN or add to PATH)" >&2; exit 1; }
HOME="$PWD/.edge-home" exec "$EDGE_BIN" "$@"
