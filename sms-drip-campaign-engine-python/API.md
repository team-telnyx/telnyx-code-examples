# API Reference — SMS Drip Campaign Engine

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/drip/create` | Create a new drip. |
| `POST` | `/drip/<did>/subscribe` | Subscribe. |
| `POST` | `/drip/advance` | Advance all. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /drip/create`

Create a new drip.

### Request

```json
{
  "name": "Jane Smith",
  "steps": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `steps` | `array` | no | Steps |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /drip/<did>/subscribe`

Subscribe.

### Request

```json
{
  "phone": "+12125559999"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /drip/advance`

Advance all.

### Response `200`

```json
{"advanced": advanced}
```

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

### SMS Commands

| Reply | Action |
|-------|--------|
| `STOP` | Get |

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "campaigns": "...",
  "subscribers": "..."
}
```

---

## Status Values

Records use these status values: `handled`, `ignored`, `ok`, `subscribed`

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
