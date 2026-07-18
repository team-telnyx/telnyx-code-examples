## `POST /webhook/order-status`

Sync webhook endpoint that receives tool calls from the AI Assistant, intentionally delays, then returns mock order status. Streams real-time events to the dashboard via SSE during the delay.

### Request

```json
{
  "order_id": "12345"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | `string` | yes | Order ID to look up (mock data: `12345`, `67890`, `11111`) |

### Response `200`

```json
{
  "result": {
    "order_id": "12345",
    "status": "shipped",
    "carrier": "FedEx",
    "tracking": "FX-98765",
    "eta": "2026-07-20",
    "items": ["Wireless Headset", "USB-C Cable"]
  }
}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/webhook/order-status \
  -H "Content-Type: application/json" \
  -d '{"order_id": "12345"}'
```

---

## `GET /`

Serves the split-screen dashboard HTML page.

### Response `200`

HTML page with two panels:
- **Left**: Call timeline showing tool calls, filler message indicators, and responses
- **Right**: Webhook server log with request/response JSON and delay countdown

**Try it:**

Open `http://localhost:5000` in a browser.

---

## `GET /events`

Server-Sent Events (SSE) stream for the dashboard. Emits these event types:

| Event | When | Data |
|-------|------|------|
| `tool_call_received` | Webhook request arrives | `order_id`, `request_body`, `delay_seconds` |
| `filler_message` | At webhook receipt (shows configured fillers) | `content`, `filler_type`, `timing_ms` |
| `countdown` | Each second during delay | `elapsed`, `total`, `remaining` |
| `response_sent` | Webhook responds | `order_id`, `response_body`, `duration_seconds` |

**Try it:**

```bash
curl -N http://localhost:5000/events
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "delay_seconds": 12,
  "connected_clients": 1
}
```

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Mock Order Data

| Order ID | Status | Carrier | ETA |
|----------|--------|---------|-----|
| `12345` | shipped | FedEx | 2026-07-20 |
| `67890` | processing | pending | 2026-07-25 |
| `11111` | delivered | UPS | 2026-07-14 |

## Error Handling

All endpoints return JSON. On error:

```json
{
  "result": {
    "order_id": "99999",
    "status": "not_found",
    "error": "Order not found"
  }
}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `500` | Server error |
