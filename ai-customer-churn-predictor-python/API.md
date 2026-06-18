# API Reference — AI Customer Churn Predictor

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/predict` | Predict churn. |
| `POST` | `/predict/batch` | Batch predict. |
| `GET` | `/predictions` | List predictions. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /predict`

Predict churn.

### Response `200`

```json
{ "status": "ok" }
```

---

## `POST /predict/batch`

Batch predict.

### Request

```json
{
  "customers": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `customers` | `array` | no | Customers |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /predictions`

List all predictions.

### Response `200`

```json
{"predictions": results}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "predictions": "..."
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
