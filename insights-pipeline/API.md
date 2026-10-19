# API Reference — `insights-pipeline`

Typed endpoint reference for the Flask application in `app.py`. This document covers the HTTP surface exposed by the app (webhook receiver + health probe) and the CLI subcommands that map 1:1 to the pipeline stages. It does **not** repeat setup or architecture material — see `README.md` and `GUIDE.md` for those.

All Telnyx API calls are made through the Telnyx Python SDK (`import telnyx`) using the SDK's underlying HTTP client (`telnyx.post` / `telnyx.get`) against the documented REST paths. The Flask routes below are the **inbound** surface; the CLI subcommands are the **outbound** orchestration surface.

---

## Table of Contents

- [Inbound HTTP Routes](#inbound-http-routes)
  - [`POST /webhooks/telnyx`](#post-webhookstelnyx)
  - [`GET /health`](#get-health)
- [CLI Subcommands (Outbound API Orchestration)](#cli-subcommands-outbound-api-orchestration)
  - [`create-templates`](#create-templates)
  - [`create-group`](#create-group)
  - [`wire-assistant`](#wire-assistant)
  - [`place-call`](#place-call)
  - [`scorecard`](#scorecard)
  - [`serve`](#serve)
  - [`print-url`](#print-url)
- [Telnyx REST Endpoints Consumed](#telnyx-rest-endpoints-consumed)
- [Status Codes](#status-codes)
- [Error Response Shape](#error-response-shape)

---

## Inbound HTTP Routes

### `POST /webhooks/telnyx`

Receives Telnyx webhook events. The handler verifies the Ed25519 signature via `telnyx.Webhook.construct_event(body, headers, TELNYX_PUBLIC_KEY)` before reading any field. Only `call.conversation.insights_generated` events are acted upon; all other verified events are acknowledged with `200` and ignored.

**Request headers**

| Header | Type | Required | Description |
|---|---|---|---|
| `telnyx-signature-ed25519` | string | yes | Ed25519 signature over the raw request body. Verified by `construct_event`. |
| `telnyx-timestamp` | string | yes | Unix timestamp used in the signed payload. Verified by `construct_event`. |
| `content-type` | string | yes | `application/json`. |

**Request body schema** (Telnyx webhook envelope)

| Field | Type | Required | Description |
|---|---|---|---|
| `data` | object | yes | Event envelope. |
| `data.event_type` | string | yes | Event name. Handled value: `call.conversation.insights_generated`. |
| `data.id` | string | yes | Unique event identifier. |
| `data.occurred_at` | string (ISO 8601) | yes | Event timestamp. |
| `data.payload` | object | yes | Event payload. |
| `data.payload.conversation_id` | string | yes | Conversation identifier. Appended to the local JSON-lines store. |
| `data.payload.insights` | array | no | Produced insight records (template name + result). Logged as payload keys only. |

**Example request**

```bash
curl -X POST http://localhost:8000/webhooks/telnyx \
  -H "Content-Type: application/json" \
  -H "telnyx-signature-ed25519: <signature>" \
  -H "telnyx-timestamp: <timestamp>" \
  -d '{
    "data": {
      "id": "evt_01H...",
      "event_type": "call.conversation.insights_generated",
      "occurred_at": "2026-10-20T14:03:11Z",
      "payload": {
        "conversation_id": "conv_01H...",
        "insights": [
          { "name": "sentiment-v1", "status": "completed", "result": { "overall_sentiment": "negative" } }
        ]
      }
    }
  }'
```

**Response schema**

`200 OK`

```json
{ "received": true }
```

`400 Bad Request`

```json
{ "error": "invalid signature" }
```

**Status codes**

| Code | Meaning |
|---|---|
| `200` | Event verified and accepted (handled or ignored). |
| `400` | Signature verification failed, or malformed body. |
| `500` | Unhandled server error. Details are logged via `app.logger.exception`; the response body is generic. |

---

### `GET /health`

Liveness probe. No authentication, no side effects.

**Request body** — none.

**Example request**

```bash
curl http://localhost:8000/health
```

**Response schema**

`200 OK`

```json
{ "status": "ok" }
```

**Status codes**

| Code | Meaning |
|---|---|
| `200` | Process is up. |
| `500` | Unhandled server error. |

---

## CLI Subcommands (Outbound API Orchestration)

Each subcommand maps 1:1 to a script named in the ticket spec. All subcommands read configuration from environment variables loaded via `dotenv`.

| Subcommand | Spec script | Purpose |
|---|---|---|
| `create-templates` | `create_templates.py` | Create the three insight templates. |
| `create-group` | `create_group.py` | Create the insight group and assign templates. |
| `wire-assistant` | `wire_assistant.py` | Attach the group to the assistant via `insight_settings`. |
| `place-call` | `place_call.py` | Schedule the demo call via the assistant scheduled-event surface. |
| `scorecard` | `scorecard.py` | Render the QA scorecard from typed insight records. |
| `serve` | `webhook_receiver.py` | Run the Flask webhook receiver. |
| `print-url` | — | Print the exact webhook registration URL. |

---

### `create-templates`

Creates (or idempotently updates) the three insight templates via `POST /ai/conversations/insights`. Each template carries a strict `json_schema` serialized as a JSON string. The script diffs the template count before and after and prints any drift.

**Arguments** — none.

**Example**

```bash
python app.py create-templates
```

**Outbound request body** (`POST /ai/conversations/insights`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Template name. One of `sentiment-v1`, `compliance-v1`, `escalation-v1`. |
| `instructions` | string | yes | Natural-language extraction instructions for the model. |
| `json_schema` | string \| object | yes | JSON Schema for the typed output. This sample sends the **string** form (`json.dumps(schema)`); the API also accepts the object form. |
| `webhook` | string (URL) | no | Registered only when `PUBLIC_WEBHOOK_BASE_URL` is set. Value: `{PUBLIC_WEBHOOK_BASE_URL}/webhooks/telnyx`. |

**Declared schemas**

`sentiment-v1`

| Field | Type | Required | Constraints |
|---|---|---|---|
| `positivity_score` | number | yes | min `1`, max `5` |
| `frustration_level` | number | yes | min `0`, max `5` |
| `overall_sentiment` | string | yes | enum: `positive`, `negative`, `mixed`, `neutral` |
| `key_emotions` | array of string | yes | free-form labels |

`compliance-v1`

| Field | Type | Required | Constraints |
|---|---|---|---|
| `verified_identity` | boolean | yes | — |
| `compliance_flags` | array of string | yes | enum: `identity_verification_passed`, `disclosure_missing`, `profanity_detected`, `sensitive_data_mentioned`, `escalation_requested` |

`escalation-v1`

| Field | Type | Required | Constraints |
|---|---|---|---|
| `escalation_reason` | string | yes | enum: `caller_request`, `compliance_violation`, `poor_call_quality`, `system_error`, `other` |
| `agent_performed_well` | boolean | yes | — |

**Response schema** — prints one line per template:

```text
  template sentiment-v1 -> <insight_id>
  template compliance-v1 -> <insight_id>
  template escalation-v1 -> <insight_id>
  template count drift: 0 (expected 0 on re-run)
```

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | All templates created and validated. |
| `1` | A template create response was missing `id` (`RuntimeError`), or an API call failed. |

---

### `create-group`

Creates the insight group via `POST /ai/conversations/insight-groups`, assigns each template via `POST /ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign`, then re-reads the group and prints its membership.

**Arguments** — none. Templates are created inline (calls `create_templates()` first).

**Example**

```bash
python app.py create-group
```

**Outbound request body** (`POST /ai/conversations/insight-groups`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Group name. Value: `qa-scorecard-v1`. |
| `description` | string | yes | Group description. |
| `webhook` | string (URL) | no | Registered only when `PUBLIC_WEBHOOK_BASE_URL` is set. |

**Outbound request body** (`POST .../insights/{insight_id}/assign`)

| Field | Type | Required | Description |
|---|---|---|---|
| — | — | — | Empty body `{}`. Membership is expressed by the path. |

**Response schema** — prints the group ID and verified membership:

```text
  group <group_id> membership: ['<insight_id_1>', '<insight_id_2>', '<insight_id_3>']
```

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Group created and membership verified. |
| `1` | Group create response was missing `id`, or an API call failed. |

---

### `wire-assistant`

Attaches the insight group to the assistant via `insight_settings`. If `ASSISTANT_ID` is set, the existing assistant is updated; otherwise a new assistant is created with the demo `system_prompt`. The script then re-reads the assistant and prints the verified `insight_settings`.

**Arguments** — none.

**Example**

```bash
python app.py wire-assistant
```

**Outbound request body** (`POST /ai/assistants/{assistant_id}` — update path)

| Field | Type | Required | Description |
|---|---|---|---|
| `insight_settings` | object | yes | `{ "insight_group_id": "<group_id>" }` |

**Outbound request body** (`POST /ai/assistants` — create path)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Value: `insights-pipeline-demo`. |
| `system_prompt` | string | yes | Demo scenario prompt (frustrated patient, DOB verification, callback disclosure). |
| `insight_settings` | object | yes | `{ "insight_group_id": "<group_id>" }` |

**Response schema** — prints the assistant ID and verified settings:

```text
  assistant <assistant_id> insight_settings: {'insight_group_id': '<group_id>'}
```

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Assistant wired and verified. |
| `1` | API call failed. |

---

### `place-call`

Schedules the demo call through the assistant scheduled-event surface (channel `phone_call`). In demo mode (`DEMO_MODE=true`, the default) the payload is printed and no call is placed. In live mode the response's `conversation_id` is appended to the local JSON-lines store.

**Arguments** — none.

**Example**

```bash
python app.py place-call
```

**Outbound request body** (`POST /ai/assistants/{assistant_id}/scheduled_events`)

| Field | Type | Required | Description |
|---|---|---|---|
| `telnyx_conversation_channel` | string | yes | Value: `phone_call`. |
| `telnyx_end_user_target` | string (E.164) | yes | `DESTINATION_NUMBER`. |
| `telnyx_agent_target` | string (E.164) | yes | `ASSISTANT_PHONE_NUMBER` — must be a number already associated with the assistant in the portal. |
| `scheduled_at_fixed_datetime` | string (ISO 8601) | yes | Now + 60 seconds, UTC. |

**Response schema** — prints the scheduled conversation ID:

```text
  scheduled call conversation_id=<conversation_id>
```

In demo mode:

```text
  [DEMO] would schedule call: {"telnyx_conversation_channel": "phone_call", ...}
```

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Call scheduled (live) or demo payload printed. |
| `1` | `ASSISTANT_PHONE_NUMBER` or `DESTINATION_NUMBER` not set (`RuntimeError`), or API call failed. |

---

### `scorecard`

Fetches insight records per conversation via `GET /ai/conversations/{conversation_id}/conversations-insights`, validates each record against the declared schemas, and renders the QA scorecard. Records still `pending` or `in_progress` are reported as pending rows, not failures. Schema-invalid records are excluded from aggregates and reported by conversation ID.

**Arguments**

| Flag | Type | Required | Description |
|---|---|---|---|
| `--date` | string (ISO date) | no | Filter store rows by `received_at` prefix. |
| `--conversation-id` | string | no | Override the store for a single manual run. |
| `--strict` | flag | no | Inject a synthetic schema-invalid record (`demo-synthetic-invalid`) to demonstrate the failure mode. |

**Example**

```bash
python app.py scorecard --date 2026-10-20
python app.py scorecard --conversation-id conv_01H...
python app.py scorecard --strict
```

**Outbound request** (`GET /ai/conversations/{conversation_id}/conversations-insights`)

No body. Path parameter `conversation_id` is the conversation identifier.

**Response schema** — prints the scorecard JSON:

```json
{
  "sentiment_distribution": { "negative": 1, "mixed": 0 },
  "compliance_flag_rates": { "identity_verification_passed": 1, "disclosure_missing": 1 },
  "escalation_breakdown": { "caller_request": 1 },
  "schema_invalid": [],
  "pending": []
}
```

| Field | Type | Description |
|---|---|---|
| `sentiment_distribution` | object (enum → count) | Counts by `overall_sentiment`. |
| `compliance_flag_rates` | object (enum → count) | Counts by `compliance_flags` entry. |
| `escalation_breakdown` | object (enum → count) | Counts by `escalation_reason`. |
| `schema_invalid` | array of string | Conversation IDs with at least one schema-invalid record. |
| `pending` | array of string | Conversation IDs with records still `pending` / `in_progress`, or fetch failures. |

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Scorecard rendered. |
| `1` | Unhandled error. |

---

### `serve`

Runs the Flask webhook receiver on `0.0.0.0:$PORT` (default `8000`).

**Arguments** — none.

**Example**

```bash
python app.py serve
```

**Routes exposed**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/webhooks/telnyx` | Telnyx webhook receiver (signature-verified). |
| `GET` | `/health` | Liveness probe. |

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Server shut down cleanly. |
| `1` | Bind failure (port in use). |

---

### `print-url`

Prints the exact webhook registration URL derived from `PUBLIC_WEBHOOK_BASE_URL`. Useful for pasting into the Telnyx portal or an `ngrok` session.

**Arguments** — none.

**Example**

```bash
python app.py print-url
# -> https://<your-ngrok-subdomain>.ngrok.io/webhooks/telnyx
```

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | URL printed (may be empty if `PUBLIC_WEBHOOK_BASE_URL` is unset). |

---

## Telnyx REST Endpoints Consumed

| Method | Path | Used by | Purpose |
|---|---|---|---|
| `POST` | `/ai/conversations/insights` | `create-templates` | Create an insight template. |
| `GET` | `/ai/conversations/insights` | `create-templates` | Count templates before/after for drift detection. |
| `POST` | `/ai/conversations/insight-groups` | `create-group` | Create an insight group. |
| `POST` | `/ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign` | `create-group` | Assign a template to the group. |
| `GET` | `/ai/conversations/insight-groups/{group_id}` | `create-group` | Re-read group membership. |
| `POST` | `/ai/assistants` | `wire-assistant` | Create the demo assistant. |
| `POST` | `/ai/assistants/{assistant_id}` | `wire-assistant` | Update `insight_settings` on an existing assistant. |
| `GET` | `/ai/assistants/{assistant_id}` | `wire-assistant` | Verify `insight_settings`. |
| `POST` | `/ai/assistants/{assistant_id}/scheduled_events` | `place-call` | Schedule the demo call. |
| `GET` | `/ai/conversations/{conversation_id}/conversations-insights` | `scorecard` | Fetch typed insight records. |

**Insight record statuses**

| Status | Meaning |
|---|---|
| `pending` | Analysis has not started. Reported as a pending row. |
| `in_progress` | Analysis is running. Reported as a pending row. |
| `completed` | Analysis finished. Validated against the declared schema. |
| `failed` | Analysis failed. Reported as a pending row (not a schema failure). |

---

## Status Codes

| Code | Applies to | Meaning |
|---|---|---|
| `200` | All routes and subcommands | Success. |
| `400` | `POST /webhooks/telnyx` | Signature verification failed or malformed body. |
| `404` | Any route | Unknown path. Flask returns the default 404 page. |
| `500` | All routes | Unhandled server error. Details logged server-side; response body is generic. |

---

## Error Response Shape

All Flask error responses use a single-key JSON object:

```json
{ "error": "<generic message>" }
```

Exception details are never returned to the client. They are logged via `app.logger.exception(...)` with the request context. CLI subcommands raise `RuntimeError` with actionable messages (e.g. missing `ASSISTANT_PHONE_NUMBER`) and exit non-zero.
