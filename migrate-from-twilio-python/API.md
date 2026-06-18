# API Reference — Migrate from Twilio

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/audit/twilio` | Audit twilio. |
| `POST` | `/migrate/messaging-profile` | Migrate messaging. |
| `POST` | `/migrate/numbers` | Migrate numbers. |
| `POST` | `/migrate/webhook-map` | Receives Telnyx webhook events. |
| `GET` | `/migrate/code-changes` | Code changes guide. |
| `GET` | `/migration-log` | Get log. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /audit/twilio`

Audit twilio.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /migrate/messaging-profile`

Migrate messaging.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | no | Display name or label |
| `webhook_url` | `string` | no | Webhook url |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /migrate/numbers`

Migrate numbers.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `numbers` | `array` | no | List of phone numbers |
| `authorized_person` | `string` | **yes** | Authorized person |

### Response `200`

```json
{"results": results}
```

---

## `POST /migrate/webhook-map`

Receives Telnyx webhook events.

---

## `GET /migrate/code-changes`

Code changes guide.

### Response `200`

```json
{"guide": {
        "sdk": "pip install telnyx (replaces twilio package)",
        "auth": "Bearer token header (replaces Account SID + Auth Token basic auth)",
        "voice": {"twilio": ""..."."..."", "telnyx": "call.actions."...""}
```

---

## `GET /migration-log`

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
  "migrations": "..."
}
```

---

## Status Values

Records use these status values: `failed`, `ok`, `port_submitted`

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
