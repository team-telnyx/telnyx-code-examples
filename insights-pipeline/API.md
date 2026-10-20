# API Reference — Structured-Insights Pipeline Desk

Typed endpoint contract for every route and Telnyx API surface this sample touches.
All Telnyx REST calls use `Authorization: Bearer $TELNYX_API_KEY` and return a
`{"data": ...}` envelope unless noted otherwise.

Base URL: `$TELNYX_API_BASE` (default `https://api.telnyx.com/v2`)

---

## Local HTTP surface (webhook receiver)

`webhook_receiver.py` runs a FastAPI app on `0.0.0.0:8000` (override with `--port`).

### `POST /webhooks/telnyx`

Receives Telnyx webhook events. The handler verifies the Ed25519 signature via
`telnyx.Webhook.construct_event(raw_body, headers, TELNYX_PUBLIC_KEY)`, then
processes only `call.conversation.insights_generated` events.

**Headers**

| Header | Type | Required | Description |
|---|---|---|---|
| `telnyx-signature-ed25519` | string | yes | Ed25519 signature over the raw body. |
| `telnyx-timestamp` | string | yes | Unix timestamp used in the signed payload. |
| `content-type` | string | yes | `application/json`. |

**Request body** (Telnyx event envelope)

| Field | Type | Required | Description |
|---|---|---|---|
| `data` | object | yes | Event envelope. |
| `data.event_type` | string | yes | Must be `call.conversation.insights_generated` to be processed. |
| `data.payload` | object | yes | Event payload. |
| `data.payload.conversation_id` | string | yes | Conversation the insights were generated for. Appended to the local store. |

**Example request**

```bash
curl -X POST http://localhost:8000/webhooks/telnyx \
  -H "content-type: application/json" \
  -H "telnyx-signature-ed25519: <signature>" \
  -H "telnyx-timestamp: <unix-ts>" \
  -d '{
    "data": {
      "event_type": "call.conversation.insights_generated",
      "payload": {
        "conversation_id": "conv_01HXYZ..."
      }
    }
  }'
```

**Response**

| Status | Body | Meaning |
|---|---|---|
| `200` | empty | Event accepted (or ignored because the event type is not `insights_generated`). |
| `400` | empty | Signature verification failed. Details are logged server-side only. |

**Status codes**

| Code | Description |
|---|---|
| `200` | Event accepted or intentionally ignored. |
| `400` | Signature verification failed. |
| `500` | Unhandled server error (logged via `app.logger.exception`). |

---

## Telnyx REST — Insight templates

### `POST /ai/conversations/insights`

Create a structured insight template. Called by `create_templates.py` via raw REST
(the insights surface is untyped in the shipped Python SDK).

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Idempotent template name (`sentiment-v1`, `compliance-v1`, `escalation-v1`). |
| `instructions` | string | yes | Natural-language extraction instructions for the model. |
| `json_schema` | object \| string | yes | Strict JSON Schema. This sample always sends the object form. |
| `webhook` | string | no | Per-template webhook URL. Set to `$PUBLIC_WEBHOOK_BASE_URL/webhooks/telnyx` when configured. |

**Example request**

```bash
curl -X POST "$TELNYX_API_BASE/ai/conversations/insights" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "sentiment-v1",
    "instructions": "Score the caller sentiment across the whole conversation.",
    "json_schema": {
      "type": "object",
      "properties": {
        "positivity_score": {"type": "number", "minimum": 1, "maximum": 5},
        "frustration_level": {"type": "number", "minimum": 1, "maximum": 5},
        "overall_sentiment": {
          "type": "string",
          "enum": ["positive", "negative", "mixed", "neutral"]
        },
        "key_emotions": {"type": "array", "items": {"type": "string"}}
      },
      "required": ["positivity_score", "frustration_level", "overall_sentiment"]
    }
  }'
```

**Response**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"data": {"id": "...", "name": "...", "json_schema": {...}, ...}}` | Template created (or updated when the name already exists). |
| `400` | `{"errors": [...]}` | Invalid schema or missing required field. |
| `401` | `{"errors": [...]}` | Missing or invalid API key. |
| `500` | `{"errors": [...]}` | Server error. |

**Status codes**

| Code | Description |
|---|---|
| `200` | Template created/updated; response echoes `id` and `json_schema`. |
| `400` | Malformed request body or schema rejected. |
| `401` | Authentication failed. |
| `500` | Upstream error. |

### `GET /ai/conversations/insights`

List existing insight templates. Used by `create_templates.py` to diff template
counts before and after the run (drift detection).

**Request body** — none.

**Example request**

```bash
curl "$TELNYX_API_BASE/ai/conversations/insights" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"data": [{"id": "...", "name": "...", "json_schema": {...}}, ...]}` | Array of templates. |
| `401` | `{"errors": [...]}` | Authentication failed. |
| `500` | `{"errors": [...]}` | Upstream error. |

**Status codes**

| Code | Description |
|---|---|
| `200` | Template list returned. |
| `401` | Authentication failed. |
| `500` | Upstream error. |

---

## Telnyx REST — Insight groups

### `POST /ai/conversations/insight-groups`

Create a template group. Called by `create_group.py`.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Group name (`qa-scorecard-v1`). |
| `description` | string | yes | Human-readable description. |
| `webhook` | string | no | Group-level webhook URL. Set to `$PUBLIC_WEBHOOK_BASE_URL/webhooks/telnyx` when configured. |

**Example request**

```bash
curl -X POST "$TELNYX_API_BASE/ai/conversations/insight-groups" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "qa-scorecard-v1",
    "description": "QA scorecard: sentiment, compliance, escalation.",
    "webhook": "https://<your-ngrok-id>.ngrok.app/webhooks/telnyx"
  }'
```

**Response**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"data": {"id": "...", "name": "...", "insights": [...]}}` | Group created. |
| `400` | `{"errors": [...]}` | Malformed request. |
| `401` | `{"errors": [...]}` | Authentication failed. |
| `500` | `{"errors": [...]}` | Upstream error. |

**Status codes**

| Code | Description |
|---|---|
| `200` | Group created; `id` returned. |
| `400` | Malformed request body. |
| `401` | Authentication failed. |
| `500` | Upstream error. |

### `POST /ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign`

Assign a template to a group. Called once per template by `create_group.py`.

**Path parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | string | yes | Group id returned by the create call. |
| `insight_id` | string | yes | Template id from `INSIGHT_TEMPLATE_IDS`. |

**Request body** — none.

**Example request**

```bash
curl -X POST "$TELNYX_API_BASE/ai/conversations/insight-groups/$GROUP_ID/insights/$INSIGHT_ID/assign" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"data": {...}}` | Template assigned. |
| `400` | `{"errors": [...]}` | Invalid ids. |
| `404` | `{"errors": [...]}` | Group or template not found. |
| `500` | `{"errors": [...]}` | Upstream error. |

**Status codes**

| Code | Description |
|---|---|
| `200` | Assignment succeeded. |
| `400` | Invalid ids. |
| `404` | Group or template not found. |
| `500` | Upstream error. |

### `GET /ai/conversations/insight-groups/{group_id}`

Read a group back to verify membership. Called by `create_group.py` after all
assignments; the script exits non-zero if membership count does not match.

**Path parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | string | yes | Group id. |

**Example request**

```bash
curl "$TELNYX_API_BASE/ai/conversations/insight-groups/$GROUP_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"data": {"id": "...", "name": "...", "insights": [{"id": "...", "name": "..."}, ...]}}` | Group with membership list. |
| `404` | `{"errors": [...]}` | Group not found. |
| `500` | `{"errors": [...]}` | Upstream error. |

**Status codes**

| Code | Description |
|---|---|
| `200` | Group returned. |
| `404` | Group not found. |
| `500` | Upstream error. |

---

## Telnyx REST — Conversation insights

### `GET /ai/conversations/{conversation_id}/conversations-insights`

Fetch the insight records produced for a conversation. Called by `scorecard.py`
for every conversation id in the local store. This is the polling fallback and
the source of truth for the scorecard.

**Path parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `conversation_id` | string | yes | Conversation id from `conversations.json` or `--conversation-id`. |

**Example request**

```bash
curl "$TELNYX_API_BASE/ai/conversations/$CONVERSATION_ID/conversations-insights" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"data": [{"name": "sentiment-v1", "status": "completed", "result": {...}}, ...]}` | Insight records for the conversation. |
| `404` | `{"errors": [...]}` | Conversation not found. |
| `500` | `{"errors": [...]}` | Upstream error. |

**Record shape**

| Field | Type | Description |
|---|---|---|
| `name` | string | Template name (`sentiment-v1`, `compliance-v1`, `escalation-v1`). |
| `status` | string | One of `pending`, `in_progress`, `completed`, `failed`. |
| `result` | object | Schema-conformant payload when `status == "completed"`. |

**Status codes**

| Code | Description |
|---|---|
| `200` | Records returned (may include `pending`/`in_progress` rows). |
| `404` | Conversation not found. |
| `500` | Upstream error. |

---

## Telnyx SDK — Assistants

Called via the typed SDK (`telnyx.Client`), not raw REST.

### `client.ai.assistants.create(...)`

Create the demo assistant with `insight_settings` attached. Called by
`wire_assistant.py` when `ASSISTANT_ID` is not set.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Assistant name. |
| `instructions` | string | yes | Demo system prompt (frustrated patient scenario). |
| `insight_settings` | object | yes | `{"insight_group_id": "<group_id>", "enabled": true}`. |

**Example (Python)**

```python
assistant = client.ai.assistants.create(
    name="Structured-Insights Demo Assistant",
    instructions=DEMO_SYSTEM_PROMPT,
    insight_settings={"insight_group_id": group_id, "enabled": True},
)
```

### `client.ai.assistants.update(assistant_id, insight_settings=...)`

Attach `insight_settings` to an existing assistant. Called by `wire_assistant.py`
when `ASSISTANT_ID` is set.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assistant_id` | string | yes | Assistant id. |
| `insight_settings` | object | yes | `{"insight_group_id": "<group_id>", "enabled": true}`. |

### `client.ai.assistants.retrieve(assistant_id)`

Read the assistant back to verify `insight_settings` is present. Called by
`wire_assistant.py`; the script exits non-zero if settings are missing.

**Response** — assistant object with `insight_settings` attribute.

---

## Telnyx REST — Scheduled events

### `POST /ai/assistants/{assistant_id}/scheduled-events`

Place the demo call through the assistant scheduled-event surface. Called by
`place_call.py` when `DEMO_MODE=false`.

**Path parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assistant_id` | string | yes | Assistant id from `ASSISTANT_ID`. |

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `telnyx_conversation_channel` | string | yes | `phone_call`. |
| `telnyx_end_user_target` | string | yes | Caller number (E.164), from `DESTINATION_NUMBER`. |
| `telnyx_agent_target` | string | yes | Assistant phone number (E.164), from `ASSISTANT_PHONE_NUMBER`. Must already be associated with the assistant in the portal. |
| `scheduled_at_fixed_datetime` | string | yes | ISO-8601 timestamp; this sample schedules ~60 seconds out. |

**Example request**

```bash
curl -X POST "$TELNYX_API_BASE/ai/assistants/$ASSISTANT_ID/scheduled-events" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "telnyx_conversation_channel": "phone_call",
    "telnyx_end_user_target": "+1555XXXXXXXX",
    "telnyx_agent_target": "+1555YYYYYYYY",
    "scheduled_at_fixed_datetime": "2026-10-20T18:30:00+00:00"
  }'
```

**Response**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"data": {"conversation_id": "...", ...}}` | Event scheduled; `conversation_id` is appended to the local store. |
| `400` | `{"errors": [...]}` | Missing/invalid target or timestamp. |
| `404` | `{"errors": [...]}` | Assistant not found. |
| `500` | `{"errors": [...]}` | Upstream error. |

**Status codes**

| Code | Description |
|---|---|
| `200` | Event scheduled; `conversation_id` present. |
| `400` | Malformed request body. |
| `404` | Assistant not found. |
| `500` | Upstream error. |

---

## Webhook — `call.conversation.insights_generated`

Fires once per conversation when the insight set completes. Consumed by
`webhook_receiver.py`; the payload carries the conversation identifier and the
produced insight records.

**Payload fields**

| Field | Type | Description |
|---|---|---|
| `data.event_type` | string | `call.conversation.insights_generated`. |
| `data.payload.conversation_id` | string | Conversation the insights were generated for. |
| `data.payload.insights` | array | Produced insight records (schema-conformant when complete). |

**Delivery contract**

| Aspect | Value |
|---|---|
| Delivery | HTTP POST to the registered `webhook` URL. |
| Signature | Ed25519, verified via `telnyx.Webhook.construct_event`. |
| Retries | Telnyx retries on non-2xx responses. |
| Fallback | `GET /ai/conversations/{id}/conversations-insights` produces the identical scorecard without the webhook. |

---

## Insight statuses

Every insight record carries a `status` field. The scorecard distinguishes
"not ready yet" from "schema-invalid".

| Status | Meaning | Scorecard treatment |
|---|---|---|
| `pending` | Queued, not started. | Counted as pending; excluded from aggregates. |
| `in_progress` | Model is extracting. | Counted as pending; excluded from aggregates. |
| `completed` | Record produced. | Schema-validated; included if valid. |
| `failed` | Extraction failed. | Excluded from aggregates; surfaced in the invalid list. |

---

## Error envelope

All Telnyx REST errors use the standard envelope:

```json
{
  "errors": [
    {
      "code": "string",
      "title": "string",
      "detail": "string"
    }
  ]
}
```

The sample never returns Telnyx error details to HTTP clients; failures are
logged via `app.logger.exception(...)` and generic status codes are returned.
