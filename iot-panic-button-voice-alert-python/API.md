# API Reference — IoT Panic Button Voice Alert

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/alert` | Trigger a new alert. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/devices` | Register device. |
| `GET` | `/alerts` | List alerts. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /alert`

Trigger a new alert.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `device_id` | `string` | **yes** | Device identifier |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### DTMF Options

| Key | Action |
|-----|--------|
| `1` | Alert acknowledged. Dispatch team notified. Stay safe. |
| `2` | Escalating to emergency services. Please stay on the line. |

---

## `POST /devices`

Register device.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `device_id` | `string` | no | Device identifier |
| `name` | `string` | **yes** | Display name or label |
| `location` | `string` | **yes** | Location |
| `contacts` | `array` | no | Contacts |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /alerts`

List all alerts.

### Response `200`

```json
{"alerts": alerts[-50:]}
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

Records use these status values: `acknowledged`, `active`, `alerting`, `calling`, `ended`, `failed`, `listening`, `ok`

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
