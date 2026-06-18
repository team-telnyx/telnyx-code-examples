# API Reference — WhatsApp-SMS Bridge

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/bridge` | Create a new bridge. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/bridges` | List bridges. |
| `GET` | `/messages` | List messages. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /bridge`

Create a new bridge.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sms_number` | `string` | **yes** | Sms number |
| `whatsapp_number` | `string` | **yes** | Whatsapp number |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /bridges`

List all bridges.

### Response `200`

```json
{"bridges": bridges}
```

---

## `GET /messages`

List all messages.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{"status": "ok", "bridges": "..." // 2, "messages": "..."}
```

---

## Status Values

Records use these status values: `bridged`, `forwarded`, `ignored`, `no_bridge`, `ok`

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
