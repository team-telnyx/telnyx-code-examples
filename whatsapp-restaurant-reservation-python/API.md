# API Reference

## Endpoints

### Health Check

```
GET /health
```

Returns server status and configuration.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-10-20T12:00:00+00:00",
  "whatsapp_number": "+12176180378",
  "city": "Amsterdam"
}
```

---

### List Restaurants

```
GET /api/restaurants
GET /api/restaurants?q=italian
```

Returns cached restaurants. Optional `q` parameter filters by name or cuisine.

**Response:**

```json
[
  {
    "id": "osm-12345",
    "name": "De Kas",
    "cuisine": "fine_dining",
    "address": "Kamerlingh Onneslaan 3, Amsterdam",
    "phone": "+31206204562",
    "lat": 52.3541,
    "lon": 4.9258,
    "photo_url": "https://images.unsplash.com/...",
    "cached_at": "2026-10-20T12:00:00+00:00"
  }
]
```

---

### Refresh Restaurants

```
POST /api/restaurants/refresh
```

Clears cached restaurants and re-fetches from the Overpass API. Falls back to seed data if the API is unavailable.

**Response:**

```json
{
  "status": "refreshed",
  "count": 42
}
```

---

### List Reservations

```
GET /api/reservations
GET /api/reservations?date=2026-10-25
```

Returns reservations for a given date (default: today).

**Response:**

```json
{
  "date": "2026-10-20",
  "reservations": [
    {
      "id": 1,
      "restaurant_id": "osm-12345",
      "restaurant_name": "De Kas",
      "customer_phone": "+31612345678",
      "customer_name": "Jan",
      "party_size": 4,
      "date": "2026-10-20",
      "time": "19:00",
      "status": "confirmed",
      "notes": "Window seat",
      "created_at": "2026-10-20T10:30:00+00:00",
      "updated_at": "2026-10-20T10:30:00+00:00"
    }
  ]
}
```

---

### Update Reservation

```
PATCH /api/reservations/:id
```

Update a reservation's status.

**Body:**

```json
{
  "status": "confirmed"
}
```

Valid statuses: `pending`, `confirmed`, `cancelled`, `completed`, `no_show`

**Response:** The updated reservation object.

---

### WhatsApp Webhook

```
POST /webhooks/whatsapp
```

Receives inbound WhatsApp messages from Telnyx. Processes text, interactive replies (list and button), and audio messages.

**Payload:** Standard Telnyx webhook format with `data.event_type = "message.received"`.

**Response:**

```json
{
  "status": "processing"
}
```

---

### SSE Stream

```
GET /stream
```

Server-Sent Events endpoint for real-time dashboard updates. Events:

| Event Type | Description |
|---|---|
| `channel.whatsapp` | Inbound or outbound WhatsApp message |
| `agent.thinking` | AI is processing |
| `agent.tool_call` | AI invoked a tool |
| `agent.tool_result` | Tool returned a result |
| `agent.done` | AI finished processing |
| `agent.error` | Processing error |
| `reservation.new` | New reservation created |
| `reservation.update` | Reservation status changed |

---

### Dashboard

```
GET /
```

Serves the HTML dashboard with restaurant browser, WhatsApp phone mockup, and reservation board.
