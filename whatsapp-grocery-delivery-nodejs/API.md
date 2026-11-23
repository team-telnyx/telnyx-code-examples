## `POST /webhooks/whatsapp`

Receives Telnyx WhatsApp webhook events. Called automatically by Telnyx when a WhatsApp message arrives — do not call directly.

The handler extracts the message type (text, interactive, audio), deduplicates by message ID and phone cooldown, and dispatches to the AI inference loop. Audio messages are transcribed via Telnyx Audio Transcription before processing.

Returns `200` immediately; AI processing happens asynchronously.

**Events handled:** `message.received` (inbound direction only)

**Example payload:**

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "direction": "inbound",
      "from": { "phone_number": "+15551234567" },
      "to": "+1XXXXXXXXXX",
      "body": {
        "type": "text",
        "text": { "body": "I need milk and eggs" }
      },
      "id": "msg-abc123"
    }
  }
}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "timestamp": "2026-11-18T12:00:00.000Z",
  "whatsapp_number": "+1XXXXXXXXXX"
}
```

**Try it:**

```bash
curl http://localhost:3000/health
```

---

## `GET /api/config`

Returns dashboard configuration including WhatsApp number and product categories.

### Response `200`

```json
{
  "whatsapp_number": "+1XXXXXXXXXX",
  "categories": [
    { "id": "fruits", "name": "Fruits", "emoji": "..." },
    { "id": "vegetables", "name": "Vegetables", "emoji": "..." }
  ]
}
```

**Try it:**

```bash
curl http://localhost:3000/api/config
```

---

## `GET /api/categories`

Returns the list of product categories.

### Response `200`

```json
[
  { "id": "fruits", "name": "Fruits", "emoji": "..." },
  { "id": "vegetables", "name": "Vegetables", "emoji": "..." },
  { "id": "dairy", "name": "Dairy", "emoji": "..." }
]
```

**Try it:**

```bash
curl http://localhost:3000/api/categories
```

---

## `GET /api/products`

Search and filter products.

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `q` | `string` | Search query (product name keyword) |
| `category` | `string` | Category ID filter (`fruits`, `vegetables`, `dairy`, etc.) |
| `specials` | `string` | Set to `"true"` to return only on-sale products |

### Response `200`

```json
{
  "products": [
    {
      "id": "abc-123",
      "name": "Organic Bananas",
      "price": 1.49,
      "unit": "bunch",
      "category_name": "Fruits",
      "in_stock": 1,
      "on_sale": 0,
      "sale_price": null,
      "dietary_tags": "organic"
    }
  ],
  "total": 1
}
```

**Try it:**

```bash
curl "http://localhost:3000/api/products?q=banana"
curl "http://localhost:3000/api/products?category=fruits"
curl "http://localhost:3000/api/products?specials=true"
```

---

## `GET /api/orders`

List orders, optionally filtered by customer phone.

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `phone` | `string` | Customer phone in E.164 format to filter by |

### Response `200`

```json
{
  "orders": [
    {
      "id": "ord-abc123",
      "customer_phone": "+15551234567",
      "status": "confirmed",
      "subtotal": 24.97,
      "item_count": 3,
      "slot_label": "Tomorrow 10:00-12:00",
      "created_at": "2026-11-18T12:00:00.000Z"
    }
  ]
}
```

**Try it:**

```bash
curl http://localhost:3000/api/orders
curl "http://localhost:3000/api/orders?phone=%2B15551234567"
```

---

## `GET /api/orders/:id`

Get a single order by ID, including items and substitutions.

### Response `200`

```json
{
  "order": {
    "id": "ord-abc123",
    "customer_phone": "+15551234567",
    "status": "confirmed",
    "subtotal": 24.97,
    "item_count": 3,
    "slot_label": "Tomorrow 10:00-12:00",
    "items": [],
    "substitutions": []
  }
}
```

### Response `404`

```json
{ "error": "Order not found" }
```

**Try it:**

```bash
curl http://localhost:3000/api/orders/ord-abc123
```

---

## `POST /api/orders/:id/advance`

Advance an order to the next status in the pipeline. Sends a WhatsApp notification to the customer for each transition.

**Status pipeline:** `confirmed` -> `picking` -> `packed` -> `out_for_delivery` -> `delivered`

### Response `200`

```json
{
  "order": {
    "id": "ord-abc123",
    "status": "picking",
    "customer_phone": "+15551234567"
  }
}
```

### Response `400`

```json
{ "error": "Order already delivered" }
```

**Try it:**

```bash
curl -X POST http://localhost:3000/api/orders/ord-abc123/advance
```

---

## `GET /api/substitutions`

List all pending and resolved substitutions across all orders.

### Response `200`

```json
{
  "substitutions": [
    {
      "id": "sub-abc123",
      "order_id": "ord-abc123",
      "original_item": "Organic Milk",
      "suggested_item": "Regular Milk",
      "price_diff": -0.50,
      "status": "pending"
    }
  ]
}
```

**Try it:**

```bash
curl http://localhost:3000/api/substitutions
```

---

## `GET /api/delivery-slots`

Get available delivery time windows.

### Response `200`

```json
{
  "slots": [
    {
      "id": "slot-1",
      "label": "Tomorrow 10:00-12:00",
      "date": "2026-11-19",
      "time_start": "10:00",
      "time_end": "12:00",
      "capacity": 10,
      "booked": 2
    }
  ]
}
```

**Try it:**

```bash
curl http://localhost:3000/api/delivery-slots
```

---

## `GET /api/cart/:phone`

Get the cart contents for a customer.

### Response `200`

```json
{
  "items": [
    {
      "product_name": "Organic Bananas",
      "quantity": 2,
      "unit_price": 1.49
    }
  ],
  "total": "2.98"
}
```

**Try it:**

```bash
curl http://localhost:3000/api/cart/%2B15551234567
```

---

## `GET /api/ui-events`

Retrieve UI events for the operator dashboard. Used for cross-instance polling when SSE is unavailable.

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `since` | `string` | ISO timestamp — returns events after this time |

### Response `200`

```json
{
  "events": [
    {
      "id": "evt-abc123",
      "type": "cart.update",
      "payload": "{\"customer_phone\":\"+15551234567\",\"action\":\"add\"}",
      "created_at": "2026-11-18T12:00:00.000Z"
    }
  ]
}
```

**Try it:**

```bash
curl http://localhost:3000/api/ui-events
curl "http://localhost:3000/api/ui-events?since=2026-11-18T00:00:00Z"
```

---

## `POST /api/customers`

Register a new customer. Validates the phone number via Telnyx Number Lookup API and normalizes to E.164 format.

### Request Body

```json
{
  "phone": "+15551234567",
  "name": "Jane Doe",
  "address": "123 Main St"
}
```

### Response `200`

```json
{
  "customer": {
    "phone": "+15551234567",
    "name": "Jane Doe",
    "address": "123 Main St"
  }
}
```

### Response `400`

```json
{ "error": "phone and name are required" }
```

### Response `422`

```json
{ "error": "This phone number is not valid. Please enter a real phone number with country code." }
```

**Try it:**

```bash
curl -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -d '{"phone":"+15551234567","name":"Jane Doe","address":"123 Main St"}'
```

---

## `GET /api/customers/:phone`

Get a customer by phone number.

### Response `200`

```json
{
  "customer": {
    "phone": "+15551234567",
    "name": "Jane Doe",
    "address": "123 Main St"
  }
}
```

### Response `404`

```json
{ "error": "Customer not found" }
```

**Try it:**

```bash
curl http://localhost:3000/api/customers/%2B15551234567
```

---

## `GET /api/conversations`

Get conversation history (messages between the AI assistant and customers).

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `phone` | `string` | Filter by customer phone (E.164) |
| `since` | `string` | ISO timestamp — returns messages after this time |
| `limit` | `integer` | Max messages to return (1-100, default 50) |

### Response `200`

```json
{
  "messages": [
    {
      "customer_phone": "+15551234567",
      "role": "user",
      "content": "I need milk and eggs",
      "timestamp": "2026-11-18T12:00:00.000Z"
    },
    {
      "customer_phone": "+15551234567",
      "role": "assistant",
      "content": "Added milk and eggs to your cart!",
      "timestamp": "2026-11-18T12:00:05.000Z"
    }
  ]
}
```

**Try it:**

```bash
curl http://localhost:3000/api/conversations
curl "http://localhost:3000/api/conversations?phone=%2B15551234567&limit=10"
```

---

## `DELETE /api/conversations`

Clear conversation history and related data. If `phone` is provided, clears only that customer's data. Otherwise, clears all conversations, orders, carts, and UI events.

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `phone` | `string` | Customer phone to clear (omit for all) |

### Response `200`

```json
{ "status": "cleared" }
```

**Try it:**

```bash
curl -X DELETE http://localhost:3000/api/conversations
curl -X DELETE "http://localhost:3000/api/conversations?phone=%2B15551234567"
```

---

## `GET /stream`

Server-Sent Events (SSE) stream for real-time updates to the operator dashboard. Sends keepalive comments every 30 seconds.

### Event Types

| Event | Description |
|-------|-------------|
| `channel.whatsapp` | Inbound or outbound WhatsApp message |
| `agent.thinking` | AI is processing |
| `agent.tool_call` | AI invoked a tool |
| `agent.tool_result` | Tool returned a result |
| `agent.done` | AI finished processing |
| `agent.error` | Processing error |
| `cart.update` | Cart was modified |
| `order.created` | New order placed |
| `order.status_changed` | Order advanced to next status |
| `product.search` | Product search executed |
| `product.selected` | Product selected |
| `customer.registered` | New customer registered |

**Try it:**

```bash
curl -N http://localhost:3000/stream
```

---

## Status Values

Orders use these status values in sequence:

| Status | Label |
|--------|-------|
| `confirmed` | Confirmed |
| `picking` | Picking |
| `packed` | Packed |
| `out_for_delivery` | Out for Delivery |
| `delivered` | Delivered |

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "description of the problem" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `404` | Resource not found |
| `422` | Validation failed (e.g. invalid phone number) |
| `503` | Database unavailable (still initializing) |
