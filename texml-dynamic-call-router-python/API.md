# API Reference — TeXML Dynamic Call Router

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/texml/route` | Route call. |
| `POST` | `/texml/recording` | Handle recording. |
| `POST` | `/vip` | Add vip. |
| `GET` | `/calls` | List calls. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /texml/route`

Route call.

### Response `200`

```json
{ "status": "ok" }
```

---

## `POST /texml/recording`

Handle recording.

### Response `200`

```json
{ "status": "ok" }
```

---

## `POST /vip`

Add vip.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Phone number |
| `name` | `string` | no | Display name or label |

### Response `200`

```json
{"status": "added", "phone": phone}
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
  "calls": "...",
  "vips": "..."
}
```

---

## Status Values

Records use these status values: `added`, `ok`

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
