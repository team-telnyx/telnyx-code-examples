# API Reference — Schedule SMS Messages

All endpoints accept and return `application/json`.

---

## `POST /sms/schedule`

Schedule an SMS to be sent at a future time.

### Request

```json
{
  "to": "+15559876543",
  "message": "Your scheduled message",
  "send_at": "2026-06-18T14:30:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164, must start with `+`) |
| `message` | `string` | **yes** | Message body to send |
| `send_at` | `string` | **yes** | ISO 8601 timestamp; must be in the future (a trailing `Z` is accepted) |

### Response `201`

```json
{
  "job_id": "sms_1718721000123",
  "status": "scheduled",
  "scheduled_for": "2026-06-18T14:30:00Z",
  "to": "+15559876543"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `job_id` | `string` | Identifier used to look up or cancel the job |
| `status` | `string` | Always `scheduled` on creation |
| `scheduled_for` | `string` | Echo of the requested `send_at` |
| `to` | `string` | Echo of the destination number |

**Try it:**

```bash
curl -X POST http://localhost:5000/sms/schedule \
  -H "Content-Type: application/json" \
  -d '{"to": "+15559876543", "message": "Your scheduled message", "send_at": "2026-06-18T14:30:00Z"}'
```

---

## `GET /sms/scheduled/{job_id}`

Retrieve the full record of a single scheduled job. Fields such as `message_id`, `sent_at`, `cancelled_at`, and `error` appear once the job reaches the corresponding state.

| Path param | Type | Required | Description |
|------------|------|----------|-------------|
| `job_id` | `string` | **yes** | The job ID returned by `POST /sms/schedule` |

### Response `200`

```json
{
  "id": "sms_1718721000123",
  "to": "+15559876543",
  "message": "Your scheduled message",
  "scheduled_for": "2026-06-18T14:30:00Z",
  "status": "scheduled",
  "created_at": "2026-06-18T14:25:00.000000"
}
```

**Try it:**

```bash
curl http://localhost:5000/sms/scheduled/sms_1718721000123
```

---

## `GET /sms/scheduled`

List a summary of all scheduled jobs.

### Response `200`

```json
[
  {
    "id": "sms_1718721000123",
    "to": "+15559876543",
    "status": "scheduled",
    "scheduled_for": "2026-06-18T14:30:00Z",
    "created_at": "2026-06-18T14:25:00.000000"
  }
]
```

**Try it:**

```bash
curl http://localhost:5000/sms/scheduled
```

---

## `DELETE /sms/scheduled/{job_id}`

Cancel a job before it is sent. Jobs already in `sent` or `failed` state return `400`.

| Path param | Type | Required | Description |
|------------|------|----------|-------------|
| `job_id` | `string` | **yes** | The job ID to cancel |

### Response `200`

```json
{
  "id": "sms_1718721000123",
  "status": "cancelled",
  "cancelled_at": "2026-06-18T14:26:00.000000"
}
```

**Try it:**

```bash
curl -X DELETE http://localhost:5000/sms/scheduled/sms_1718721000123
```

---

## Job Status Values

| Status | Meaning |
|--------|---------|
| `scheduled` | Job is queued and waiting for its `send_at` time |
| `sent` | The Telnyx Messaging API accepted the message; `message_id` is set |
| `failed` | Sending failed; `error` describes the category (auth, API, or network) |
| `rate_limited` | Telnyx rate-limited the send attempt |
| `cancelled` | Cancelled via `DELETE` before sending |

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Job scheduled |
| `400` | Bad request — missing/invalid fields, past `send_at`, bad datetime, or uncancellable job |
| `404` | Job not found |
| `500` | Server error |

Exception details are logged server-side only; HTTP responses return generic messages.
