#!/usr/bin/env bash
# Creates the Night Nurse assistant and prints its id.
# The assistant MUST end every reply with a final line: TRIAGE: <verdict>
# so the NightNurse actor can parse the verdict out of `content`.
set -euo pipefail

: "${TELNYX_API_KEY:?set TELNYX_API_KEY before running this script}"

INSTRUCTIONS='You are the Night Nurse Line, an after-hours triage assistant for a prenatal clinic.
Ask at most one clarifying question, then give a short, calm answer.
End EVERY reply with a final line in exactly this format:
TRIAGE: <self-care|appointment|page-on-call>
Use page-on-call for red flags (chest pain or tightness, bleeding, shortness of breath, contractions before 37 weeks).
Use appointment for anything that should be seen at the morning clinic.
Use self-care only for clearly benign symptoms.'

curl -sS -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer ${TELNYX_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"name":"Night Nurse Line","model":"meta-llama/Meta-Llama-3.1-70B-Instruct","instructions":%s,"telephony_settings":{"supports_unauthenticated_web_calls":true}}' \
        "$(printf '%s' "${INSTRUCTIONS}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin).get("data",{}); print("NIGHT_NURSE_ASSISTANT_ID=" + str(d.get("id","")))'
