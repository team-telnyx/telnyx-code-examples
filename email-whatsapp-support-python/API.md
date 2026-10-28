# API Reference

## Dashboard

### `GET /`

Serves the web dashboard UI.

## Health

### `GET /health`

Returns server status.

```json
{
  "status": "ok",
  "mode": "demo",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Customers

### `GET /customers`

List all registered customers.

```json
[
  {
    "id": "cust_maria_santos",
    "name": "Maria Santos",
    "email": "maria.santos@example.com",
    "phone": "+15551234567",
    "created_at": "2024-01-15T10:30:00Z"
  }
]
```

## Conversations

### `GET /conversations`

Returns all conversation history grouped by customer ID.

```json
{
  "cust_maria_santos": [
    {
      "channel": "email",
      "role": "user",
      "content": "Subject: Damaged Order\nMy order arrived damaged.",
      "timestamp": "2024-01-15T10:30:00Z"
    },
    {
      "channel": "whatsapp",
      "role": "assistant",
      "content": "Hi Maria! Could you send a photo of the damage?",
      "timestamp": "2024-01-15T10:31:00Z"
    }
  ]
}
```

## Orders

### `GET /orders`

List all orders. Optional query parameter `customer_id` to filter.

```
GET /orders
GET /orders?customer_id=cust_maria_santos
```

```json
[
  {
    "id": "ORD-2024-7891",
    "customer_id": "cust_maria_santos",
    "product": "Wireless Noise-Cancelling Headphones",
    "status": "resolved",
    "tracking": "1Z999AA10123456784",
    "damage_photo_url": "https://example.com/photo.jpg",
    "replacement_tracking": "1Z999AA10987654321"
  }
]
```

### `GET /orders/<order_id>`

Get a single order by ID.

## SSE Stream

### `GET /stream`

Server-Sent Events endpoint. Streams real-time events to connected browser clients.

Event types:

| Type | Description |
|------|-------------|
| `customer.registered` | Customer profile created |
| `channel.email` | Email sent or received |
| `channel.whatsapp` | WhatsApp message sent or received |
| `order.update` | Order status changed |
| `journey.progress` | Demo journey step advanced |
| `journey.complete` | Demo journey finished |
| `agent.identity_resolved` | Customer identified by email/phone |

## Webhooks

### `POST /webhooks/email`

Receives inbound email events from Telnyx.

Expected payload:
```json
{
  "data": {
    "event_type": "email.received",
    "payload": {
      "from": { "email": "customer@example.com" },
      "subject": "Order issue",
      "body": "My order arrived damaged."
    }
  }
}
```

### `POST /webhooks/whatsapp`

Receives inbound WhatsApp messages from Telnyx.

Expected payload:
```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "direction": "inbound",
      "from": { "phone_number": "+15551234567" },
      "text": "Here is the damage photo",
      "media": [
        { "url": "https://example.com/photo.jpg", "content_type": "image/jpeg" }
      ]
    }
  }
}
```

## Demo Routes

Available only when running `demo/demo_server.py`.

### `POST /demo/journey`

Triggers the scripted 5-step demo journey.

### `GET /demo/log`

Returns the demo event log (all mocked API calls).

### `POST /demo/reset`

Resets demo state for a fresh run.
