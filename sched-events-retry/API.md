# API Reference — Scheduled-Events Retry Campaign Desk

Typed endpoint contract for the Flask app in `app.py`. All routes return JSON. All request bodies are `application/json` unless noted.

Base URL (local): `http://localhost:5000`

---

## `GET /health`

Liveness probe. Reports whether the process is running and which mode it is in.

### Response schema

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"` when the process is up. |
| `demo_mode` | boolean | `true` when `DEMO_MODE` is enabled — no real Telnyx calls are dispatched. |

```json
{ "status": "ok", "demo_mode": true }
```

---

## `POST /campaign/create`

Schedules one phone-call scheduled event per contact via `POST /v2/ai/assistants/{assistant_id}/scheduled_events`. Each event carries the retry budget (`max_retries_client_errors` + `retry_interval_secs`), a staggered `scheduled_at_fixed_datetime`, and `conversation_metadata` tagging the campaign.

Before creating the phone-call events, the route runs the **phone-call-only guard**: it demonstrates the documented `400` returned when retry fields are set on an `sms_chat` event. The probe is **simulated in all modes** — it never issues a real `sms_chat` create. The result is returned under `sms_guard`.

Created event IDs are persisted to `$STATE_DIR/created_events.json`.

### Request body

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `contacts_csv` | string | **yes** | — | Raw CSV text. Must contain a `phone` column; optional `id` and `script` columns. |
| `start` | string (ISO 8601) | no | now (UTC) | Campaign window start. |
| `spread` | integer (minutes) | no | `45` | Window across which contacts are evenly spaced. |
| `max_retries_client_errors` | integer | no | `3` | Retries on top of the initial dispatch. Bounds: `0`–`10`. |
| `retry_interval_secs` | integer | no | `300` | Seconds between attempts. Bounds: `60`–`86400`. Must be set together with `max_retries_client_errors`. |

### Example request

```bash
curl -s -X POST http://localhost:5000/campaign/create \
  -H 'Content-Type: application/json' \
  -d '{
    "contacts_csv": "id,phone,script\nc1,+1555XXXXXXX1,\"Hi, this is your appointment reminder.\"",
    "start": "2026-10-20T15:00:00Z",
    "spread": 45,
    "max_retries_client_errors": 3,
    "retry_interval_secs": 300
  }'
```

### Response schema

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | string | Campaign identifier from `CAMPAIGN_ID`. |
| `created` | array | One entry per scheduled event. |
| `created[].scheduled_event_id` | string | The `scheduled_event_id` returned by the API (or a `demo-*` id in demo mode). |
| `created[].scheduled_at` | string (ISO 8601) | The staggered `scheduled_at_fixed_datetime`. |
| `created[].contact_id` | string | Contact `id` from the CSV. |
| `created[].demo` | boolean | Present and `true` only in demo mode. |
| `sms_guard` | object | Result of the phone-call-only probe. |
| `sms_guard.status` | integer | HTTP status of the SMS create attempt — expected `400`. |
| `sms_guard.detail` | string | Human-readable outcome. |
| `sms_guard.demo` | boolean | Present and `true` when the probe was simulated. |
| `demo_mode` | boolean | Whether the run was
