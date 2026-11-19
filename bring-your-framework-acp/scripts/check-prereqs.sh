#!/usr/bin/env bash
set -euo pipefail

fail=0

check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    printf 'ok   %s\n' "$1"
  else
    printf 'miss %s\n' "$1"
    fail=1
  fi
}

check_command node
check_command npm
check_command telnyx-edge

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -ge 22 ]; then
  printf 'ok   node >= 22\n'
else
  printf 'warn node 22.13+ is required by the ACP docs\n'
  fail=1
fi

if command -v telnyx-acp >/dev/null 2>&1; then
  printf 'ok   telnyx-acp\n'
else
  printf 'warn telnyx-acp is not installed; install with npm install -g @telnyx/acp\n'
fi

if [ -f "$(dirname "$0")/../pipecat-edge/function/bot.py" ]; then
  printf 'ok   pipecat-edge/function/bot.py\n'
else
  printf 'warn pipecat-edge/function/bot.py is not present; add the Pipecat source clone before the voice cut\n'
fi

exit "$fail"

