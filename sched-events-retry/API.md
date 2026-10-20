# API Reference — Scheduled-Events Retry Campaign Desk

Typed contract for every Telnyx endpoint this sample calls, plus the CLI surface of each workflow script.

Scheduled Events is **not** exposed as a typed resource in the installed `telnyx` Python SDK, so `create_campaign.py` and `watch_campaign.py` call the REST endpoints directly with `requests` and unwrap the `{"data": ...}` envelope. The request/response shapes below are the exact shapes those scripts send and read.

- Base URL: `TELNYX_API_BASE` (default `https://api.telnyx.com/v2`)
- Auth: `Authorization: Bearer $TELNYX_API_KEY`
- Content type: `application/json`

---

## `POST /v2/ai/assistants/{assistant_id}/scheduled_events`

Create one scheduled event. For this sample, one event = one outbound call with its own retry budget.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `assistant_id` | string | yes | Assistant the event is dispatched against. From `TELNYX_ASSISTANT_ID`. |

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `telnyx_conversation_channel` | string | yes | `"phone_call"` for this sample. Retry fields are **phone-call only** — sending them with `"sms_chat"` returns `400`. |
| `telnyx_end_user_target` | string | yes | The contact's phone number in E.164 (`+15551234567`). |
| `telnyx_agent_target` | string | yes | The outbound caller ID. From `TELNYX_FROM_NUMBER`. |
| `scheduled_at_fixed_datetime` | string (ISO-8601 UTC) | yes | Absolute dispatch time, e.g. `2026-10-20T15:00:00Z`. Staggered per contact across the `--spread` window. |
| `text` | string | yes | The call script the assistant speaks. |
| `conversation_metadata` | object | no | Free-form attribution tags. This sample sets `campaign_id` and `contact_name`; the watcher filters the list endpoint on `campaign_id`. |
| `max_retries_client_errors` | integer | conditional | Retry budget on top of the initial dispatch. Bounds **0–10**. `0` = 1 total attempt, `3` = up to 4, `10` = up to 11. Must be sent together with `retry_interval_secs`. |
| `retry_interval_secs` | integer | conditional | Seconds between attempts. Bounds **60–86400**. Must be sent together with `max_retries_client_errors`. |
| `call_settings` | object | no | Phone-call-only settings. |
| `call_settings.sip_region` | string | no | Region pin for the outbound leg, e.g. `"us-east"`. From `TELNYX_SIP_REGION`. |

**Validation rules encoded in `create_campaign.py` (`validate_retry_budget`):**

- `max_retries_client_errors` must be within `0–10`.
- `retry_interval_secs` must be within `60–86400`.
- The two must move together — one without the other is a `400`.

### Example request

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants/$TELNYX_ASSISTANT_ID/scheduled_events" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "telnyx_conversation_channel": "phone_call",
    "telnyx_end_user_target": "+15551234567",
    "telnyx_agent_target": "+1555XXXXXXXX",
    "scheduled_at_fixed_datetime": "2026-10-20T15:00:00Z",
    "text": "Hi Ada, this is a reminder from the campaign desk.",
    "conversation_metadata": {
      "campaign_id": "camp-1a2b3c4d",
      "contact_name": "Ada"
    },
    "max_retries_client_errors": 3,
    "retry_interval_secs": 300,
    "call_settings": { "sip_region": "us-east" }
  }'
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "evt_01HZX8Q2K3M4N5P6R7S8T9V0W1",
    "status": "pending",
    "telnyx_conversation_channel": "phone_call",
    "telnyx_end_user_target": "+15551234567",
    "telnyx_agent_target": "+1555XXXXXXXX",
    "scheduled_at_fixed_datetime": "2026-10-20T15:00:00Z",
    "conversation_metadata": {
      "campaign_id": "camp-1a2b3c4d",
      "contact_name": "Ada"
    },
    "max_retries_client_errors": 3,
    "retry_interval_secs": 300,
    "call_attempts": []
  }
}
```

`create_campaign.py` reads `data.id` and writes it to `campaign_manifest.json`.

### Status codes

| Code | Meaning | Sample behavior |
|------|---------|-----------------|
| `200` | Event created. | `event_id` appended to the manifest. |
| `400` | Validation failure — retry fields out of bounds, retry fields sent without their pair, or retry fields on a non-`phone_call` channel. | `demonstrate_sms_guard()` catches this deliberately to prove the phone-call-only constraint. |
| `404` | `assistant_id` not found. | `raise_for_status()` propagates; the contact is skipped and logged. |
| `500` | Telnyx-side error. | `raise_for_status()` propagates; the contact is skipped and logged. |

---

## `GET /v2/ai/assistants/{assistant_id}/scheduled_events`

Paginated list of scheduled events. This is the watcher's discovery call — Scheduled Events has **no webhook surface**, so polling is the documented way to observe it.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `assistant_id` | string | yes | Assistant whose events are listed. |

### Query parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `page[size]` | integer | no | Page size. The watcher sends `250`. |

### Example request

```bash
curl -G "https://api.telnyx.com/v2/ai/assistants/$TELNYX_ASSISTANT_ID/scheduled_events" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  --data-urlencode "page[size]=250"
```

### Response — `200 OK`

```json
{
  "data": [
    {
      "id": "evt_01HZX8Q2K3M4N5P6R7S8T9V0W1",
      "status": "pending",
      "conversation_metadata": { "campaign_id": "camp-1a2b3c4d", "contact_name": "Ada" }
    },
    {
      "id": "evt_01HZX8Q2K3M4N5P6R7S8T9V0W2",
      "status": "completed",
      "conversation_metadata": { "campaign_id": "camp-1a2b3c4d", "contact_name": "Grace" }
    }
  ],
  "meta": { "page": { "size": 250, "number": 1, "total_pages": 1, "total_results": 2 } }
}
```

The watcher filters this list on `conversation_metadata.campaign_id` so it only tracks events it created.

### Status codes

| Code | Meaning | Sample behavior |
|------|---------|-----------------|
| `200` | List returned. | Watcher filters by `campaign_id` and diffs against `seen_status`. |
| `400` | Malformed query parameters. | `raise_for_status()` propagates; the poll is logged and retried after `POLL_INTERVAL`. |
| `404` | `assistant_id` not found. | `raise_for_status()` propagates; the poll is logged and retried. |
| `500` | Telnyx-side error. | `raise_for_status()` propagates; the poll is logged and retried. |

---

## `GET /v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}`

Single-event detail. This is the forensics source — the `call_attempts` array is the per-attempt ledger.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `assistant_id` | string | yes | Assistant that owns the event. |
| `event_id` | string | yes | Event ID from the manifest. |

### Example request

```bash
curl "https://api.telnyx.com/v2/ai/assistants/$TELNYX_ASSISTANT_ID/scheduled_events/evt_01HZX8Q2K3M4N5P6R7S8T9V0W1" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "evt_01HZX8Q2K3M4N5P6R7S8T9V0W1",
    "status": "failed",
    "conversation_metadata": { "campaign_id": "camp-1a2b3c4d", "contact_name": "Ada" },
    "max_retries_client_errors": 3,
    "retry_interval_secs": 300,
    "errors": [
      { "code": "retry_budget_exhausted", "detail": "All retry attempts exhausted." }
    ],
    "call_attempts": [
      {
        "attempt_number": 1,
        "attempted_at": "2026-10-20T15:00:00Z",
        "call_status": "no-answer",
        "call_duration": 0,
        "telnyx_call_control_id": "v3:abc123"
      },
      {
        "attempt_number": 2,
        "attempted_at": "2026-10-20T15:05:00Z",
        "call_status": "busy",
        "call_duration": 0,
        "telnyx_call_control_id": "v3:def456"
      },
      {
        "attempt_number": 3,
        "attempted_at": "2026-10-20T15:10:00Z",
        "call_status": "no-answer",
        "call_duration": 0,
        "telnyx_call_control_id": "v3:ghi789"
      },
      {
        "attempt_number": 4,
        "attempted_at": "2026-10-20T15:15:00Z",
        "call_status": "failed",
        "call_duration": 0,
        "telnyx_call_control_id": "v3:jkl012"
      }
    ]
  }
}
```

### `call_attempts[]` — `AssistantScheduledCallAttempt`

| Field | Type | Description |
|-------|------|-------------|
| `attempt_number` | integer | 1-based attempt index. `1` is the initial dispatch; `2..N` are retries. |
| `attempted_at` | string (ISO-8601 UTC) | When the attempt fired. The retry clock is measured from this value. |
| `call_status` | string | Outcome of the attempt. Retryable: `busy`, `no-answer`, `failed`, `canceled`. Terminal success: `completed`. |
| `call_duration` | integer | Call duration in seconds. |
| `telnyx_call_control_id` | string | Call Control ID for the attempt — use it to correlate with Call Control events. |
| `conversation_id` | string | Present on `completed` attempts. Recorded by the watcher for transcript follow-up. |

### Event statuses

| Status | Meaning |
|--------|---------|
| `pending` | Scheduled, not yet dispatched. |
| `dispatched` | Initial attempt in flight. |
| `completed` | Terminal success. |
| `failed` | Terminal failure. Carries an `errors` entry; when the retry budget is exhausted the entry is `retry_budget_exhausted`. |
| `canceled` | Cancelled before dispatch via `DELETE`. Counted as `cancelled`, not a failure. |

### Retry clock semantics (asserted by `watch_campaign.py`)

After a terminal attempt at time `T`, the next attempt fires at **`T + retry_interval_secs`** — the clock restarts at `now + interval`, **not** at the original schedule + interval. `verify_retry_clock()` asserts `attempts[n+1].attempted_at >= attempts[n].attempted_at + retry_interval_secs` and returns a violation string for any attempt that fires early.

### Status codes

| Code | Meaning | Sample behavior |
|------|---------|-----------------|
| `200` | Event returned. | Ledger printed; clock violations flagged; dead-letter written on `failed` + `errors`. |
| `400` | Malformed `event_id`. | `raise_for_status()` propagates; the event is skipped for this poll. |
| `404` | Event not found. | `raise_for_status()` propagates; the event is skipped for this poll. |
| `500` | Telnyx-side error. | `raise_for_status()` propagates; the event is skipped for this poll. |

---

## `DELETE /v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}`

Cancel a pending event before dispatch. Used by the demo teardown for contacts removed from the CSV after creation. Cancelled events are counted as `cancelled` in the report, **not** as failures.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `assistant_id` | string | yes | Assistant that owns the event. |
| `event_id` | string | yes | Event to cancel. |

### Example request

```bash
curl -X DELETE "https://api.telnyx.com/v2/ai/assistants/$TELNYX_ASSISTANT_ID/scheduled_events/evt_01HZX8Q2K3M4N5P6R7S8T9V0W1" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": {
    "id": "evt_01HZX8Q2K3M4N5P6R7S8T9V0W1",
    "status": "canceled"
  }
}
```

### Status codes

| Code | Meaning | Sample behavior |
|------|---------|-----------------|
| `200` | Event cancelled. | Counted as `cancelled` in the scorecard. |
| `400` | Event already dispatched or terminal — cannot cancel. | Logged; the event keeps its terminal status. |
| `404` | Event not found. | Logged; skipped. |
| `500` | Telnyx-side error. | Logged; skipped. |

---

## CLI interfaces

Each workflow step is a standalone script. `app.py` is a thin help-dispatcher that prints the run order and exits.

### `python create_campaign.py`

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--contacts` | path | `contacts.csv` | CSV with `name,phone` columns. |
| `--start` | string | **required** | ISO-8601 UTC start, e.g. `2026-10-20T15:00:00Z`. |
| `--spread` | integer | `45` | Minutes across which contacts are staggered evenly. |
| `--max-retries` | integer | `3` | `max_retries_client_errors`. Bounds `0–10`. |
| `--retry-interval` | integer | `300` | `retry_interval_secs`. Bounds `60–86400`. |

Exit codes: `0` success, `2` validation/config error. Writes `campaign_manifest.json`.

### `python watch_campaign.py`

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--manifest` | path | `campaign_manifest.json` | Manifest written by `create_campaign.py`. |
| `--retry-interval` | integer | `300` | Interval used to assert the retry clock. |
| `--once` | flag | off | Poll once and exit (CI / smoke runs). |

Exit codes: `0` clean, `1` retry-clock violation detected, `2` manifest missing. Writes `dead_letter.csv`.

### `python report.py`

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--manifest` | path | `campaign_manifest.json` | Manifest written by `create_campaign.py`. |
| `--dead-letter` | path | `dead_letter.csv` | Dead-letter CSV written by the watcher. |

Exit codes: `0` success, `2` manifest missing.

---

## Error envelope

All non-2xx responses use the standard Telnyx error envelope:

```json
{
  "errors": [
    {
      "code": "10009",
      "title": "Invalid parameter",
      "detail": "retry_interval_secs must be between 60 and 86400",
      "source": { "pointer": "/retry_interval_secs" }
    }
  ]
}
```

`create_campaign.py` prints `errors` verbatim when it catches the deliberate `400` from the SMS guard.

---

## Reference

- [Scheduled events guide](https://developers.telnyx.com/docs/inference/ai-assistants/scheduled-events)
- [Create a scheduled event](https://developers.telnyx.com/api-reference/assistants/create-a-scheduled-event)
- [List scheduled events](https://developers.telnyx.com/api-reference/assistants/list-scheduled-events)
- [Get a scheduled event](https://developers.telnyx.com/api-reference/assistants/get-a-scheduled-event)
- [Delete a scheduled event](https://developers.telnyx.com/api-reference/assistants/delete-a-scheduled-event)
