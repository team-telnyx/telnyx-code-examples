# API Reference — Media Stream Voice Cloak

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/cloak/<ccid>` | Set cloak. |
| `GET` | `/effects` | List effects. |
| `GET` | `/active` | List active. |
| `GET` | `/log` | Get log. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `POST /cloak/<ccid>`

Set cloak.

### Request

```json
{
  "effect": "effect-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `effect` | `string` | no | Effect |

### Response `200`

```json
{"error": f"Unknown effect. Available: {"...")}
```

---

## `GET /effects`

List all effects.

### Response `200`

```json
{"effects": EFFECTS}
```

---

## `GET /active`

List all active.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /log`

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

Records use these status values: `answering`, `cloaking`, `effect_set`, `ended`, `ok`

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
