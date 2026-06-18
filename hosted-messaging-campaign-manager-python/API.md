# API Reference — Hosted Messaging Campaign Manager

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/campaigns` | Create a new campaign. |
| `POST` | `/subscribers` | Add subscribers. |
| `POST` | `/campaigns/<cid>/send` | Send campaign. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/subscribers` | List subscribers. |
| `GET` | `/campaigns` | List campaigns. |
| `GET` | `/analytics` | Analytics. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /campaigns`

Create a new campaign.

### Request

```json
{
  "name": "Jane Smith",
  "message": "Hello from the API"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `message` | `string` | **yes** | Message content to send |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /subscribers`

Add subscribers.

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
{"added": added, "total": "..."}
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

---

## `GET /subscribers`

List all subscribers.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /campaigns`

List all campaigns.

### Response `200`

```json
{"campaigns": "...")}
```

---

## `GET /analytics`

Analytics.

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
  "campaigns": "...",
  "subscribers": "..."
}
```

---

## Status Values

Records use these status values: `draft`, `ok`, `opted_in`, `opted_out`, `sent`

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
