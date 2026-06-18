# API Reference — Policy Renewal Campaign

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/campaigns/run` | Run campaign. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/webhooks/sms` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/policies` | List policies. |
| `GET` | `/campaign-log` | Get log. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /campaigns/run`

Run campaign.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `days_to_expiry` | `string` | no | Days to expiry |

### Response `200`

```json
{"results": results}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### Events Handled

| Event | Action |
|-------|--------|
| `call.answered` | Begins interaction (TTS greeting or gather) |
| `call.speak.ended` | TTS finished — transitions to gather or next step |
| `call.gather.ended` | Input received — processes customer response |

### DTMF Options

| Key | Action |
|-----|--------|
| `1` | Renewed |
| `2` | ll have an agent call you back within the hour. Thank you! |

---

## `POST /webhooks/sms`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

### SMS Commands

| Reply | Action |
|-------|--------|
| `RENEW` | Active |

---

## `GET /policies`

List all policies.

### Response `200`

```json
{"policies": policies}
```

---

## `GET /campaign-log`

Get a specific log by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "active": "..."
}
```

---

## Status Values

Records use these status values: `active`, `ok`, `renewed`

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
