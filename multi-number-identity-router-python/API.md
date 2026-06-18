# API Reference — Multi-Number Identity Router

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/identities` | Add identity. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/identities` | List identities. |
| `GET` | `/calls` | List calls. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /identities`

Add identity.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | `string` | **yes** | Number |
| `name` | `string` | **yes** | Display name or label |
| `greeting` | `string` | **yes** | Greeting |
| `forward_to` | `string` | **yes** | Forward to |
| `hours` | `string` | no | Hours |

### Response `200`

```json
{"status": "added", "number": number}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /identities`

List all identities.

### Response `200`

```json
{"identities": {k: {"name": v["name"], "hours": v["hours"]}
```

---

## `GET /calls`

List all calls.

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
  "identities": "..."
}
```

---

## Status Values

Records use these status values: `added`, `answering`, `ended`, `forwarding`, `greeting`, `ok`

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
