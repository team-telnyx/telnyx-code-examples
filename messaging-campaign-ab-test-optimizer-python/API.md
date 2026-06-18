# API Reference — Messaging Campaign A/B Test Optimizer

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/campaigns` | Create a new campaign. |
| `POST` | `/campaigns/<cid>/send` | Send campaign. |
| `GET` | `/campaigns/<cid>/analyze` | Analyze campaign. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /campaigns`

Create a new campaign.

### Request

```json
{
  "name": "Jane Smith",
  "variants": [],
  "contacts": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | no | Display name or label |
| `variants` | `array` | no | Variants |
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

## `GET /campaigns/<cid>/analyze`

Analyze campaign.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "campaigns": "..."
}
```

---

## Status Values

Records use these status values: `created`, `ok`, `sent`

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
