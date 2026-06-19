# API Reference — SMS Marketing Campaign

All endpoints accept and return JSON. The base URL is `http://localhost:5000` in local development.

## `POST /campaigns`

Create a campaign and queue its recipients. Phone numbers that are not valid E.164 are skipped silently.

### Request

```json
{
  "name": "Spring Sale",
  "message": "Spring sale! 20% off everything this weekend. Reply STOP to opt out.",
  "recipients": ["+12125551234", "+13105556789"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Human-readable campaign name |
| `message` | `string` | **yes** | Message body; must be ≤ 160 characters |
| `recipients` | `string[]` | **yes** | Non-empty list of destination numbers in E.164 format |

### Response `201`

```json
{
  "campaign_id": "f5d7a7e0-1234-5678-9abc-def012345678",
  "name": "Spring Sale",
  "recipient_count": 2,
  "status": "queued"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `string` | UUID for the new campaign |
| `name` | `string` | Echoed campaign name |
| `recipient_count` | `integer` | Count of valid (queued) recipients |
| `status` | `string` | Always `queued` on creation |

### Try it

```bash
curl -X POST http://localhost:5000/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "Spring Sale", "message": "20% off this weekend! Reply STOP to opt out.", "recipients": ["+12125551234"]}'
```

---

## `POST /campaigns/{campaign_id}/send`

Send a rate-limited batch of queued messages. Each message is spaced by `RATE_LIMIT_DELAY` (default 100ms). Recipients that fail are marked `failed` and the batch continues.

### Path parameters

| Param | Type | Description |
|-------|------|-------------|
| `campaign_id` | `string` | UUID returned by `POST /campaigns` |

### Request

```json
{ "batch_size": 100 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `batch_size` | `integer` | no | Recipients to process this call (1–1000, default 100) |

### Response `200`

```json
{
  "campaign_id": "f5d7a7e0-1234-5678-9abc-def012345678",
  "sent": 2,
  "failed": 0,
  "remaining": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `string` | Campaign UUID |
| `sent` | `integer` | Messages accepted by Telnyx this batch |
| `failed` | `integer` | Recipients marked failed this batch |
| `remaining` | `integer` | Recipients still `pending` after this batch |

### Try it

```bash
curl -X POST http://localhost:5000/campaigns/f5d7a7e0-1234-5678-9abc-def012345678/send \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 100}'
```

---

## `GET /campaigns/{campaign_id}`

Get campaign status and a per-status recipient breakdown.

### Path parameters

| Param | Type | Description |
|-------|------|-------------|
| `campaign_id` | `string` | Campaign UUID |

### Response `200`

```json
{
  "campaign_id": "f5d7a7e0-1234-5678-9abc-def012345678",
  "name": "Spring Sale",
  "status": "sent",
  "created_at": "2026-06-18 12:00:00",
  "total_recipients": 2,
  "breakdown": { "delivered": 2 }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `string` | Campaign UUID |
| `name` | `string` | Campaign name |
| `status` | `string` | `queued` or `sent` |
| `created_at` | `string` | Creation timestamp |
| `total_recipients` | `integer` | Total recipients across all statuses |
| `breakdown` | `object` | Map of recipient `status` → count |

### Try it

```bash
curl http://localhost:5000/campaigns/f5d7a7e0-1234-5678-9abc-def012345678
```

---

## `POST /webhooks/message-status`

Inbound endpoint for Telnyx delivery receipts. **The Ed25519 signature is verified against the raw body before any processing**; requests without a valid `telnyx-signature-ed25519` / `telnyx-timestamp` pair are rejected with `401`. Telnyx delivers a single event object.

### Request (sent by Telnyx)

```json
{
  "data": {
    "event_type": "message.finalized",
    "payload": {
      "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "to": [{ "phone_number": "+12125551234", "status": "delivered" }]
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | Event name, e.g. `message.sent`, `message.finalized` |
| `data.payload.id` | `string` | Telnyx message ID, matched against `campaign_recipients.message_id` |
| `data.payload.to[].status` | `string` | Per-recipient delivery status (`delivered`, `failed`, …) |

### Response `200`

```json
{ "status": "received" }
```

---

## `GET /health`

Liveness probe.

### Response `200`

```json
{ "status": "healthy" }
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

Exception details are never returned in responses — they are logged server-side and a generic message is sent to the client.

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Campaign created |
| `400` | Bad request — missing/invalid fields or `batch_size` out of range |
| `401` | Invalid API key (send) or invalid webhook signature |
| `404` | Campaign not found |
| `429` | Telnyx rate limit exceeded |
| `503` | Network error reaching Telnyx |
| `500` | Internal server error |
