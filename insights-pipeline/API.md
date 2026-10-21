# API Reference — Structured-Insights Pipeline Desk

Typed contract for every Telnyx endpoint this sample calls, plus the local
Flask receiver route. All Telnyx routes are under the base URL
`https://api.telnyx.com/v2` (override with `TELNYX_API_BASE`). Every request
carries `Authorization: Bearer $TELNYX_API_KEY`.

Response envelopes are unwrapped as `body.get("data", body)` throughout the
sample — the shapes below show the `data` object.

---

## 1. `POST /ai/conversations/insights`

Create a structured insight template. Called by `create_templates.py` once per
template (`sentiment-v1`, `compliance-v1`, `escalation-v1`).

### Request body — `InsightTemplateCreateReq`

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Idempotent template name (`sentiment-v1`, `compliance-v1`, `escalation-v1`). Re-runs update rather than duplicate. |
| `instructions` | string | yes | Natural-language extraction instructions for the model. |
| `json_schema` | string \| object | yes | Strict JSON Schema for the model's output. The sample sends the **string** form (`json.dumps(schema)`); the API also accepts the object form. |
| `webhook` | string | no | Per-template webhook URL. Set to `$PUBLIC_WEBHOOK_BASE_URL/webhooks/telnyx` when configured. |

### Example request

```bash
curl -X POST https://api.telnyx.com/v2/ai/conversations/insights \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "sentiment-v1",
    "instructions": "Score the caller sentiment across the whole conversation.",
    "json_schema": "{\"type\":\"object\",\"properties\":{\"positivity_score\":{\"type\":\"number\",\"minimum\":1,\"maximum\":5},\"frustration_level\":{\"type\":\"number\",\"minimum\":0,\"maximum\":5},\"overall_sentiment\":{\"type\":\"string\",\"enum\":[\"positive\",\"negative\",\"mixed\",\"neutral\"]},\"key_emotions\":{\"type\":\"array\",\"items\":{\"type\":\"string\"}}},\"required\":[\"positivity_score\",\"frustration_level\",\"overall_sentiment\",\"key_emotions\"],\"additionalProperties\":false}"
  }'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "sentiment-v1",
    "instructions": "Score the caller sentiment across the whole conversation.",
    "json_schema": "{...}",
    "created_at": "2026-10-20T14:02:11Z"
  }
}
```

`create_templates.py` validates that `data.id` is present and `data.name`
matches the requested name; a mismatch exits non-zero.

### Status codes

| Code | Meaning |
|---|---|
| 200 | Template created (or updated on idempotent re-run). |
| 400 | Malformed body, invalid `json_schema`, or duplicate name conflict. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 500 | Telnyx-side error. |

---

## 2. `GET /ai/conversations/insights`

List existing insight templates. Used by `create_templates.py` (before/after
drift diff) and `create_group.py` (name → id lookup).

### Request body

None.

### Example request

```bash
curl https://api.telnyx.com/v2/ai/conversations/insights \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": [
    { "id": "3fa85f64-...", "name": "sentiment-v1" },
    { "id": "9c1b2a44-...", "name": "compliance-v1" },
    { "id": "77de0a11-...", "name": "escalation-v1" }
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Template list returned. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 500 | Telnyx-side error. |

---

## 3. `POST /ai/conversations/insight-groups`

Create the insight group that bundles the three templates. Called by
`create_group.py` (only when a group named `qa-scorecard-v1` does not already
exist).

### Request body — `InsightTemplateGroupCreateReq`

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Group name. Sample uses `qa-scorecard-v1`. |
| `description` | string | yes | Human-readable description of the bundle. |
| `webhook` | string | no | Group-level webhook URL. Set to `$PUBLIC_WEBHOOK_BASE_URL/webhooks/telnyx` when configured. |

### Example request

```bash
curl -X POST https://api.telnyx.com/v2/ai/conversations/insight-groups \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "qa-scorecard-v1",
    "description": "QA scorecard bundle: sentiment + compliance + escalation.",
    "webhook": "https://<your-ngrok-id>.ngrok.app/webhooks/telnyx"
  }'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "b1d2c3e4-5678-4abc-9def-0123456789ab",
    "name": "qa-scorecard-v1",
    "description": "QA scorecard bundle: sentiment + compliance + escalation.",
    "insights": []
  }
}
```

`create_group.py` exits non-zero if `data.id` is missing.

### Status codes

| Code | Meaning |
|---|---|
| 200 | Group created. |
| 400 | Malformed body or invalid `webhook` URL. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 500 | Telnyx-side error. |

---

## 4. `GET /ai/conversations/insight-groups`

List insight groups. Used by `create_group.py` (find-or-create) and
`wire_assistant.py` (resolve `qa-scorecard-v1` → id).

### Request body

None.

### Example request

```bash
curl https://api.telnyx.com/v2/ai/conversations/insight-groups \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": [
    { "id": "b1d2c3e4-...", "name": "qa-scorecard-v1" }
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Group list returned. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 500 | Telnyx-side error. |

---

## 5. `POST /ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign`

Assign one insight template to a group. Called by `create_group.py` three
times (once per template).

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | string (uuid) | yes | Target group id. |
| `insight_id` | string (uuid) | yes | Template id to assign. |

### Request body

None.

### Example request

```bash
curl -X POST "https://api.telnyx.com/v2/ai/conversations/insight-groups/b1d2c3e4-5678-4abc-9def-0123456789ab/insights/3fa85f64-5717-4562-b3fc-2c963f66afa6/assign" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": {
    "group_id": "b1d2c3e4-5678-4abc-9def-0123456789ab",
    "insight_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "assigned": true
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Template assigned to group. |
| 400 | Invalid ids or template already assigned. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 404 | Group or template not found. |
| 500 | Telnyx-side error. |

---

## 6. `GET /ai/conversations/insight-groups/{group_id}`

Read a group and its membership. Called by `create_group.py` after assignment
to verify all three templates are present.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | string (uuid) | yes | Group id to read. |

### Example request

```bash
curl "https://api.telnyx.com/v2/ai/conversations/insight-groups/b1d2c3e4-5678-4abc-9def-0123456789ab" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "b1d2c3e4-5678-4abc-9def-0123456789ab",
    "name": "qa-scorecard-v1",
    "insights": [
      { "id": "3fa85f64-...", "name": "sentiment-v1" },
      { "id": "9c1b2a44-...", "name": "compliance-v1" },
      { "id": "77de0a11-...", "name": "escalation-v1" }
    ]
  }
}
```

`create_group.py` reads `data.insights` (falling back to
`data.insight_templates`) and exits non-zero if any of the three template
names is missing.

### Status codes

| Code | Meaning |
|---|---|
| 200 | Group returned with membership. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 404 | Group not found. |
| 500 | Telnyx-side error. |

---

## 7. `POST /v2/ai/assistants`

Create an assistant when `ASSISTANT_ID` is unset. Called by
`wire_assistant.py`. Model and voice are omitted so the platform defaults
apply; `system_prompt` carries the demo scenario.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Assistant name. Sample uses `insights-pipeline-demo`. |
| `system_prompt` | string | yes | Demo scenario: frustrated patient, DOB verification, mandatory callback-disclosure line, escalation on request. |
| `model` | string | no | Omitted — platform default. |
| `voice` | string | no | Omitted — platform default. |

### Example request

```bash
curl -X POST https://api.telnyx.com/v2/ai/assistants \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "insights-pipeline-demo",
    "system_prompt": "You are a patient-services agent. The caller is a frustrated patient..."
  }'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "a1b2c3d4-5678-4abc-9def-0123456789ab",
    "name": "insights-pipeline-demo",
    "system_prompt": "You are a patient-services agent...",
    "insight_settings": null
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Assistant created. |
| 400 | Malformed body. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 500 | Telnyx-side error. |

---

## 8. `POST /v2/ai/assistants/{assistant_id}`

Update an assistant. Called by `wire_assistant.py` to attach
`insight_settings` so every call conversation is analyzed with the group's
templates.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assistant_id` | string (uuid) | yes | Assistant to update. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `insight_settings` | object | yes | `{ "insight_group_id": "<group_id>" }` — the group whose templates apply to every call conversation. |

### Example request

```bash
curl -X POST https://api.telnyx.com/v2/ai/assistants/a1b2c3d4-5678-4abc-9def-0123456789ab \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"insight_settings": {"insight_group_id": "b1d2c3e4-5678-4abc-9def-0123456789ab"}}'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "a1b2c3d4-5678-4abc-9def-0123456789ab",
    "insight_settings": { "insight_group_id": "b1d2c3e4-5678-4abc-9def-0123456789ab" }
  }
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Assistant updated. |
| 400 | Malformed body or unknown `insight_group_id`. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 404 | Assistant not found. |
| 500 | Telnyx-side error. |

---

## 9. `GET /v2/ai/assistants/{assistant_id}`

Read an assistant. Called by `wire_assistant.py` to verify
`insight_settings.insight_group_id` matches the group id.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assistant_id` | string (uuid) | yes | Assistant to read. |

### Example request

```bash
curl https://api.telnyx.com/v2/ai/assistants/a1b2c3d4-5678-4abc-9def-0123456789ab \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "a1b2c3d4-5678-4abc-9def-0123456789ab",
    "name": "insights-pipeline-demo",
    "insight_settings": { "insight_group_id": "b1d2c3e4-5678-4abc-9def-0123456789ab" }
  }
}
```

`wire_assistant.py` exits non-zero if `insight_settings.insight_group_id`
does not equal the resolved group id.

### Status codes

| Code | Meaning |
|---|---|
| 200 | Assistant returned. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 404 | Assistant not found. |
| 500 | Telnyx-side error. |

---

## 10. `POST /v2/ai/assistants/{assistant_id}/scheduled_events`

Place the demo call through the assistant scheduled-event surface. Called by
`place_call.py` (skipped in demo mode). The response carries the
`conversation_id` that is written to `conversations.json`.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assistant_id` | string (uuid) | yes | Assistant that owns the call. |

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `telnyx_conversation_channel` | string | yes | `"phone_call"`. |
| `telnyx_end_user_target` | string (E.164) | yes | `$DESTINATION_NUMBER` — the number the assistant calls. |
| `telnyx_agent_target` | string (E.164) | yes | `$ASSISTANT_PHONE_NUMBER` — must already be associated with the assistant in the portal. |
| `scheduled_at_fixed_datetime` | string (ISO-8601) | yes | Computed at runtime as now + ~60 s. Not an env var. |
| `text` | string | no | Not used by the sample. |
| `conversation_metadata` | object | no | Not used by the sample. |
| `dynamic_variables` | object | no | Not used by the sample. |
| `max_retries_client_errors` | integer | no | Not used by the sample. |
| `retry_interval_secs` | integer | no | Not used by the sample. |
| `call_settings` | object | no | Not used by the sample. |

### Example request

```bash
curl -X POST https://api.telnyx.com/v2/ai/assistants/a1b2c3d4-5678-4abc-9def-0123456789ab/scheduled_events \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "telnyx_conversation_channel": "phone_call",
    "telnyx_end_user_target": "+1555XXXXXXX",
    "telnyx_agent_target": "+1555YYYYYYY",
    "scheduled_at_fixed_datetime": "2026-10-20T14:03:11+00:00"
  }'
```

### Response — `200 OK`

```json
{
  "data": {
    "scheduled_event_id": "e5f6a7b8-9012-4cde-8f01-23456789abcd",
    "conversation_id": "c9d0e1f2-3456-4abc-9def-0123456789ab",
    "status": "scheduled",
    "call_status": "pending",
    "call_attempts": 0
  }
}
```

`place_call.py` exits non-zero if `data.conversation_id` is missing.

### Status codes

| Code | Meaning |
|---|---|
| 200 | Scheduled event created. |
| 400 | Malformed body, missing required target, or `telnyx_agent_target` not associated with the assistant. |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 404 | Assistant not found. |
| 500 | Telnyx-side error. |

---

## 11. `GET /ai/conversations/{conversation_id}/conversations-insights`

Read the insight records produced for a conversation. This is the polling
path used by `place_call.py` (wait gate) and the source of truth for
`scorecard.py`. It is also the fallback when no public webhook URL is
configured.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `conversation_id` | string (uuid) | yes | Conversation whose insight records to read. |

### Example request

```bash
curl "https://api.telnyx.com/v2/ai/conversations/c9d0e1f2-3456-4abc-9def-0123456789ab/conversations-insights" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": [
    {
      "id": "f1a2b3c4-5678-4abc-9def-0123456789ab",
      "name": "sentiment-v1",
      "status": "completed",
      "result": {
        "positivity_score": 2,
        "frustration_level": 4,
        "overall_sentiment": "negative",
        "key_emotions": ["frustrated", "confused"]
      }
    },
    {
      "id": "a2b3c4d5-6789-4abc-9def-0123456789ab",
      "name": "compliance-v1",
      "status": "completed",
      "result": {
        "verified_identity": true,
        "compliance_flags": ["identity_verification_passed", "disclosure_missing"]
      }
    },
    {
      "id": "b3c4d5e6-7890-4abc-9def-0123456789ab",
      "name": "escalation-v1",
      "status": "completed",
      "result": {
        "escalation_reason": "caller_request",
        "agent_performed_well": true
      }
    }
  ]
}
```

### Insight statuses

| Status | Meaning | Sample behavior |
|---|---|---|
| `pending` | Analysis not started. | `place_call.py` keeps polling; `scorecard.py` counts as pending. |
| `in_progress` | Analysis running. | `place_call.py` keeps polling; `scorecard.py` counts as pending. |
| `completed` | Record produced. | Validated against the declared schema. |
| `failed` | Analysis failed. | `place_call.py` prints the record id and exits non-zero. |

### Status codes

| Code | Meaning |
|---|---|
| 200 | Insight records returned (may be empty while analysis is queued). |
| 401 | Missing/invalid `TELNYX_API_KEY`. |
| 404 | Conversation not found. |
| 500 | Telnyx-side error. |

---

## 12. Webhook — `call.conversation.insights_generated`

Fires once per conversation when the insight set completes. Consumed by
`webhook_receiver.py` at `POST /webhooks/telnyx`. The payload carries the
conversation identifier and the produced insight records.

### Event shape

```json
{
  "data": {
    "event_type": "call.conversation.insights_generated",
    "id": "d4e5f6a7-8901-4bcd-9e0f-123456789abc",
    "occurred_at": "2026-10-20T14:05:42Z",
    "payload": {
      "conversation_id": "c9d0e1f2-3456-4abc-9def-0123456789ab",
      "insights": [
        { "id": "f1a2b3c4-...", "name": "sentiment-v1", "status": "completed", "result": { } }
      ]
    }
  }
}
```

`webhook_receiver.py` reads `data.event_type`, ignores anything other than
`call.conversation.insights_generated`, then reads
`data.payload.conversation_id`. It prints the sorted payload keys on first
receipt and appends `{"conversation_id", "received_at"}` to
`conversations.json`.

### Signature verification

The receiver verifies the Telnyx Ed25519 signature with
`telnyx.Webhook.construct_event(payload, headers, TELNYX_PUBLIC_KEY)` when
`TELNYX_PUBLIC_KEY` is set. A verification failure returns `400` and is
logged via `app.logger.exception(...)` — the response body never contains
exception details.

---

## 13. Local receiver route — `POST /webhooks/telnyx`

The Flask route that receives the webhook above. Registered on templates and
groups as `$PUBLIC_WEBHOOK_BASE_URL/webhooks/telnyx`.

### Request headers

| Header | Required | Description |
|---|---|---|
| `telnyx-signature-ed25519` | yes | Ed25519 signature over the raw body. |
| `telnyx-timestamp` | yes | Signature timestamp. |
| `Content-Type` | yes | `application/json`. |

### Request body

Raw JSON event (see route 12). The handler reads the raw bytes via
`request.get_data()` so signature verification sees the exact payload.

### Response — `200 OK`

```json
{ "status": "received" }
```

Non-`insights_generated` events return `{ "status": "ignored" }` with `200`.

### Status codes

| Code | Meaning |
|---|---|
| 200 | Event accepted (`received`) or ignored (`ignored`). |
| 400 | Signature verification failed, or `data.payload.conversation_id` missing. |
| 500 | Unhandled receiver error (logged, generic body returned). |

---

## Error handling conventions

All scripts use `requests` with a 30 s timeout and call `raise_for_status()`
on every Telnyx response. Failures surface as non-zero exits with an
actionable message:

| Condition | Script | Behavior |
|---|---|---|
| `TELNYX_API_KEY` unset | all | `sys.exit("TELNYX_API_KEY is required (set it in .env).")` |
| `ASSISTANT_PHONE_NUMBER` unset | `place_call.py` | Exits with a message noting the number must already be associated with the assistant in the portal. |
| `DESTINATION_NUMBER` unset | `place_call.py` | Exits with the same actionable message. |
| `ASSISTANT_ID` unset | `place_call.py` | Exits: "run wire_assistant.py first." |
| Template response missing `id` or name mismatch | `create_templates.py` | Exits non-zero. |
| Group response missing `id` | `create_group.py` | Exits non-zero. |
| Assignment verification fails | `create_group.py` | Exits non-zero listing the missing template names. |
| `insight_settings.insight_group_id` mismatch | `wire_assistant.py` | Exits non-zero. |
| Scheduled-event response missing `conversation_id` | `place_call.py` | Exits non-zero. |
| Any insight record `failed` | `place_call.py` | Prints the record id to stderr and exits non-zero. |
| Poll timeout (~3 min) | `place_call.py` | Prints a timeout message to stderr and exits non-zero. |
| Schema-invalid record | `scorecard.py` | Flagged by conversation id, excluded from aggregates, printed in the report. |
