# API Reference — TeXML Voicemail Drop — leave pre-recorded voicemails at scale via TeXML.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/drop` | Voicemail drop. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/drops` | List drops. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /drop`

Voicemail drop.

### Request

```json
{
  "numbers": [
    "+12125559999"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `numbers` | `array` | no | List of phone numbers |

### Response `200`

```json
{"results": results, "total": "..."}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /drops`

List all drops.

### Response `200`

```json
{"drops": drops[-100:], "total": "..."}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## Status Values

Records use these status values: `calling`, `delivered`, `ended`, `failed`, `human_answered_skipped`, `initiated`, `message_playing`, `ok`, `processed`

## Error Handling

All endpoints return JSON. On error:

```json
{ "status": "ok", "data": { } }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `500` | Server error |
