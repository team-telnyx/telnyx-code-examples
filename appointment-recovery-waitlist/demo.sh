#!/usr/bin/env bash
# One-shot demo for appointment-recovery-waitlist (DEV-1223).
#
# Runs the minutes-long scenario from GUIDE.md against a deployed function:
#   1. open a slot (missed patient + 3-person waitlist)
#   2. the missed patient declines -> waitlist fill starts at priority 1
#   3. the priority-1 patient confirms -> first confirmation wins
#   4. a late confirmer is rejected (double-booking guard)
#   5. snapshot the actor state + outreach ledger
#
# Usage:
#   BASE=https://<your-function>.telnyxcompute.com ./demo.sh
#   BASE=http://localhost:8787 ./demo.sh          # local dev server (npm run dev)
#
# In DEMO_MODE=true (the default) calls/SMS are logged and patient replies are
# simulated by /demo/reply. Set SLOT_ID to reuse an existing slot.
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
SLOT_ID="${SLOT_ID:-SLOT-$(date +%H%M%S)}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "1. scheduling webhook -> openSlot (actor born for ${SLOT_ID})"
curl -sS -X POST "$BASE/webhook/scheduling" -H "Content-Type: application/json" -d "{
  \"slotId\": \"$SLOT_ID\",
  \"provider\": \"Dr. Okafor\",
  \"startsAt\": \"2026-10-08T10:00:00\",
  \"missedPatient\": { \"name\": \"Alex Rivera\", \"phone\": \"+15557000001\" },
  \"waitlist\": [
    { \"name\": \"Casey Doyle\",  \"phone\": \"+15557000003\", \"priority\": 1 },
    { \"name\": \"Brooke Chen\",  \"phone\": \"+15557000002\", \"priority\": 2 },
    { \"name\": \"Devin Shah\",   \"phone\": \"+15557000004\", \"priority\": 3 }
  ]
}"
echo

say "2. missed patient declines -> waitlist fill starts at priority 1"
curl -sS -X POST "$BASE/demo/reply" -H "Content-Type: application/json" \
  -d "{\"slotId\": \"$SLOT_ID\", \"from\": \"+15557000001\", \"text\": \"no, can't make it\"}"
echo

say "3. state: cursor=0, priority-1 candidate (Casey Doyle)"
curl -sS "$BASE/state/$SLOT_ID" | python3 -m json.tool

say "4. Casey confirms -> first confirmation wins"
curl -sS -X POST "$BASE/demo/reply" -H "Content-Type: application/json" \
  -d "{\"slotId\": \"$SLOT_ID\", \"from\": \"+15557000003\", \"text\": \"YES\"}"
echo

say "5. late confirmation from Brooke -> rejected (no double-booking)"
curl -sS -X POST "$BASE/demo/reply" -H "Content-Type: application/json" \
  -d "{\"slotId\": \"$SLOT_ID\", \"from\": \"+15557000002\", \"text\": \"YES\"}"
echo

say "6. outreach ledger (every attempt + final outcome)"
curl -sS "$BASE/ledger/$SLOT_ID" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d['attempts']:
    print(f\"  {a['patient']} | {a['channel']:5} | {a['status']:10} | {a['detail']}\")
c = d['confirmation']
print(f\"  CONFIRMED: {c['patient']} via {c['source']}\" if c else '  CONFIRMED: none')
"

say "done — kill the function/server mid-outreach and re-run step 3 to see the restart proof"
