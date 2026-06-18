# API Reference — Smart Number Geo-Assignment

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/assign` | Assign number. |
| `POST` | `/lookup-and-assign` | Lookup and assign. |
| `GET` | `/inventory` | Inventory. |
| `GET` | `/assignments` | List assignments. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /assign`

Assign number.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `area_code` | `string` | **yes** | Area code |
| `use_case` | `string` | no | Use case |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /lookup-and-assign`

Lookup and assign.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target_number` | `string` | no | Target number |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /inventory`

Inventory.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /assignments`

List all assignments.

### Response `200`

```json
{"assignments": assignments[-50:]}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{ "status": "ok", "data": { } }
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
