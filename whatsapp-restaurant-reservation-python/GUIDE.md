# Tutorial: Building a WhatsApp Restaurant Reservation System

This guide walks through how the WhatsApp Restaurant Reservation app is built, covering each major component.

## 1. Project Setup

The app uses Flask with SQLite for persistence. Two Telnyx API keys are configured — one for the main account (AI Inference) and one for the WABA-enabled account (WhatsApp messaging).

```python
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_WHATSAPP_API_KEY = os.getenv("TELNYX_WHATSAPP_API_KEY", "")
```

## 2. Restaurant Data Layer

Restaurants come from the OpenStreetMap Overpass API. The query fetches all nodes and ways tagged `amenity=restaurant` within a city boundary:

```python
query = """
[out:json][timeout:15];
area["name"="Amsterdam"]["admin_level"~"^[68]$"]->.a;
(
  node["amenity"="restaurant"](area.a);
  way["amenity"="restaurant"](area.a);
);
out center 50;
"""
```

Results are parsed into name, cuisine, address, GPS coordinates, and phone number. Photos come from Unsplash (queried by cuisine keyword) or from a fallback map of cuisine-to-photo URLs.

If the Overpass API is unreachable, 12 pre-seeded Amsterdam restaurants are used instead.

## 3. Table Inventory and Availability

Six tables are defined with varying seat capacities:

| Table | Seats |
|-------|-------|
| T1, T2 | 2 |
| T3, T4 | 4 |
| T5 | 6 |
| T6 | 8 |

Time slots run from 17:30 to 21:00 in 30-minute intervals. Availability checking queries existing reservations for a restaurant/date and returns slots where a suitable table is still free.

## 4. WhatsApp Webhook Handler

The webhook at `POST /webhooks/whatsapp` receives inbound messages from Telnyx. It handles:

- **Text messages** — Extract body text from `body.text.body`
- **Interactive replies** — List and button replies from `body.interactive.list_reply` or `body.interactive.button_reply`
- **Audio messages** — Download the OGG file and transcribe via Telnyx AI

Processing happens in a background thread so the webhook returns immediately.

## 5. AI Agentic Loop

The AI uses Telnyx Inference with tool calling. The system prompt tells it to be a restaurant reservation assistant. Five tools are available:

1. **search_restaurants** — Find restaurants by name or cuisine
2. **check_availability** — Check open time slots
3. **make_reservation** — Create a confirmed booking
4. **cancel_reservation** — Cancel a booking
5. **send_whatsapp** — Send text, list, or button messages

The agentic loop repeatedly calls inference and executes tool calls until the AI has no more tools to invoke (up to 10 iterations).

## 6. Interactive WhatsApp Messages

Three message types are supported:

### Text Messages

```python
payload["whatsapp_message"] = {"type": "text", "text": {"body": text}}
```

### List Messages

Used for restaurant selection or time slot picking:

```python
payload["whatsapp_message"] = {
    "type": "interactive",
    "interactive": {
        "type": "list",
        "body": {"text": "Choose a restaurant:"},
        "action": {
            "button": "See restaurants",
            "sections": [{
                "title": "Restaurants",
                "rows": [
                    {"id": "rest-1", "title": "De Kas", "description": "Fine dining"}
                ]
            }]
        }
    }
}
```

### Button Messages

Used for booking confirmation (max 3 buttons):

```python
payload["whatsapp_message"] = {
    "type": "interactive",
    "interactive": {
        "type": "button",
        "body": {"text": "Confirm your booking?"},
        "action": {
            "buttons": [
                {"type": "reply", "reply": {"id": "confirm", "title": "Confirm"}},
                {"type": "reply", "reply": {"id": "change", "title": "Change"}},
                {"type": "reply", "reply": {"id": "cancel", "title": "Cancel"}}
            ]
        }
    }
}
```

## 7. Real-Time Dashboard with SSE

Server-Sent Events push updates to the browser. The pattern:

**Server side:** A list of subscriber queues. `sse_publish()` pushes to all connected clients.

**Client side:** `EventSource('/stream')` listens for events and updates the three dashboard panels.

Events include `channel.whatsapp` (chat bubbles), `reservation.new` (new booking), `agent.thinking` (typing indicator), and more.

## 8. Voice Note Support

When a customer sends an audio message, the app:

1. Extracts the audio URL from the webhook payload
2. Downloads the OGG file
3. Sends it to `POST /v2/ai/audio/transcriptions` on the Telnyx API
4. Feeds the transcription into the AI agentic loop

## 9. Testing

All smoke tests mock HTTP calls and use a temporary SQLite database. Tests cover:

- Health endpoint
- Restaurant CRUD and search
- Reservation creation, listing, and status updates
- Webhook processing for text, interactive replies, and edge cases
- Conversation history storage and retrieval
