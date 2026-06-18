# API Reference — WebRTC Browser Calling

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves the browser calling UI |
| `POST` | `/token` | Generate a WebRTC credential token |
| `GET` | `/health` | Health check |

---

## `POST /token`

Generates a short-lived WebRTC credential token for browser-based calling.

### Request

```json
{
  "connection_id": "your-sip-connection-id"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `connection_id` | `string` | **yes** | SIP Connection ID from portal |

### Response `200`

```json
{
  "token": "eyJ...",
  "expires_at": "2026-06-18T21:00:00Z"
}
```

---

## `GET /health`

### Response `200`

```json
{ "status": "ok" }
```
