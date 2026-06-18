# API Reference — Toll-Free SMS Campaign Manager

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/campaigns` | Create a new campaign. |
| `POST` | `/campaigns/<cid>/send` | Send campaign. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/verification/status` | Verification status. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /campaigns`

Create a new campaign.

### Request

```json
{
  "name": "Jane Smith",
  "message": "Hello from the API",
  "contacts": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `message` | `string` | **yes** | Message content to send |
| `contacts` | `array` | no | Contacts |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /campaigns/<cid>/send`

Send campaign.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

### SMS Commands

| Reply | Action |
|-------|--------|
| `STOP` | Get |
| `START` | start action |

---

## `GET /verification/status`

Verification status.

### Response `200`

```json
{ "status": "ok", "data": { } }
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

Records use these status values: `created`, `handled`, `ignored`, `ok`, `sent`

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
