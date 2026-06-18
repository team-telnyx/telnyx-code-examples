# API Reference — AI Competitive Win/Loss Call Analyzer

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/analyze` | Analyze call. |
| `GET` | `/insights` | Get insights. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /analyze`

Analyze call.

### Request

```json
{
  "transcript": "transcript-value",
  "outcome": "outcome-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transcript` | `string` | no | Transcript |
| `outcome` | `string` | no | Outcome |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /insights`

Get a specific insights by ID.

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
  "analyses": "..."
}
```

---

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
