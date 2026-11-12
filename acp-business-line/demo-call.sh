#!/usr/bin/env bash
# demo-call.sh — rehearsal caller for the acp-business-line demo.
#
# Places a call from the agent's own number back to itself over the PSTN.
# The agent answers the inbound leg with its greeting, then a TTS "caller"
# runs the appointment intake so the agent has a real conversation with no
# second phone needed. Use it to warm up or to show live call activity; for
# the recording, a human caller dialing the number looks best.
#
# Usage: TELNYX_API_KEY must be set (or present in .env).
set -euo pipefail

cd "$(dirname "$0")"

if [ -f .env ] && [ -z "${TELNYX_API_KEY:-}" ]; then
  set -a; source .env; set +a
fi
: "${TELNYX_API_KEY:?export TELNYX_API_KEY first}"

read -r AGENT_NUMBER CONN <<EOF
$(python3 - <<'PY'
import json
spec = json.load(open("agent.json"))
print(spec["phone"][0], spec["deployed"]["channels"][0]["id"])
PY
)
EOF

api() {
  curl -sS -X POST "https://api.telnyx.com/v2/calls$1" \
    -H "Authorization: Bearer $TELNYX_API_KEY" \
    -H "Content-Type: application/json" "${@:2}"
}

echo "agent calls itself at $AGENT_NUMBER..."
resp="$(api "" -d "{\"connection_id\":\"$CONN\",\"to\":\"$AGENT_NUMBER\",\"from\":\"$AGENT_NUMBER\",\"timeout_secs\":60}")"
ccid="$(echo "$resp" | python3 -c "
import json,sys
d = json.load(sys.stdin)
if 'data' not in d:
    print(d, file=sys.stderr); sys.exit(1)
print(d['data']['call_control_id'])
")"
echo "ringing... the agent answers its own line"
sleep 10

say() {
  api "/$ccid/actions/speak" -d "{\"payload\": \"$1\", \"voice\": \"female\", \"language\": \"en-US\"}" >/dev/null
  echo "caller said: $1"
  sleep 8
}

say "Hi, I am Alex Rivera."
say "I would like a checkup next Thursday afternoon, please."

sleep 12  # agent confirms the request back

echo "--- the exchange, from telnyx-acp logs ---"
telnyx-acp logs --since 2m | grep voiceTurn || echo "(no turns captured)"

sleep 5
api "/$ccid/actions/hangup" -d '{}' >/dev/null
echo "hung up."
