# API Reference — Number Lookup Fraud Screener

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/screen/<number>` | Screen number. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/blocklist` | Add to blocklist. |
| `GET` | `/blocklist` | List blocklist. |
| `GET` | `/screening-log` | Get log. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /screen/<number>`

Screen number.

### Response `200`

```json
{"number": number, "action": "block", "reason": "blocklisted"}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `POST /blocklist`

Add to blocklist.

### Request

```json
{
  "number": "number-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | `string` | **yes** | Number |

### Response `200`

```json
{"status": "blocked", "number": number}
```

---

## `GET /blocklist`

List all blocklist.

### Response `200`

```json
{
  "blocked": "..."
}
```

---

## `GET /screening-log`

Get a specific log by ID.

### Response `200`

```json
{"log": results}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "screened": "...",
  "blocked": "..."
}
```

---

## Status Values

Records use these status values: `blocked`, `ok`

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
