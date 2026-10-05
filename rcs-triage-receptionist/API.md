# API Reference — RCS Triage Receptionist

This document describes the HTTP endpoints exposed by the `rcs-triage-receptionist` sample. The application is a Telnyx Edge Stateful Actor that receives inbound RCS messages via webhook, classifies intent, sends rich cards with suggested replies, and persists thread/booking state to SQL.

---

## Table of Contents

- [POST /webhook/message](#post-webhookmessage)
- [GET /health](#get-health)

---

## POST /webhook/message

Receives inbound RCS `message.received` webhook events from the Telnyx RCS Agent. The payload contains either a `suggestion_response` (tapped suggested reply) or free-text `text`. The actor is born via `env.FRONTDESK.idFromName(phoneDigits)` on first contact and restores durable thread state.

### Request

**Content-Type:** `application/json`

#### Body Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `event_type` | `string` | Yes | Telnyx event type, e.g. `"message.received"`. |
| `data` | `object` | Yes | Envelope object. |
| `data.payload` | `object` | Yes | The RCS message payload. |
| `data.payload.from` | `string` | Yes | Sender phone number in E.164 format (e.g. `+15551234567`). |
| `data.payload.to` | `string` | Yes | Recipient (agent) phone number. |
| `data.payload.suggestion_response` | `object` | No | Present when a suggested reply was tapped. |
| `data.payload.suggestion_response.postback_data` | `string` | No | Programmatic postback identifier (e.g. `book_appt`, `service_general`, `date_mon_9am`). |
| `data.payload.suggestion_response.text` | `string` | No | User-visible label of the tapped suggestion. |
| `data.payload.text` | `string` | No | Free-text message body (present when no suggestion was tapped). |

> **Note:** The handler also accepts a flattened payload (without the `data.payload` envelope) for direct testing.

### Example Request

```bash
curl -X POST https://<your-worker-url>/webhook/message \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "message.received",
    "data": {
      "payload": {
        "from": "+15551234567",
        "to": "+15559998888",
        "suggestion_response": {
          "postback_data": "book_appt",
          "text": "Book appointment"
        }
      }
    }
  }'
```

### Response

**Status:** `200 OK`

```json
{
  "received": true
}
```

### Status Codes

| Status | Description |
|---|---|
| `200` | Webhook accepted and processed successfully. |
| `400` | Malformed JSON body or missing required fields. |
| `404` | Path not found. |
| `500` | Internal server error (e.g. Decision Model API failure, SQL error). |

---

## GET /health

Simple health-check endpoint used for liveness probes and deployment verification.

### Request

No parameters.

### Example Request

```bash
curl https://<your-worker-url>/health
```

### Response

**Status:** `200 OK`

```json
{
  "status": "ok"
}
```

### Status Codes

| Status | Description |
|---|---|
| `200` | Service is healthy. |
| `404` | Path not found. |

---

## Actor RPC Methods (Internal)

The `Receptionist` actor exposes the following async methods callable via the Telnyx Edge Actor SDK stub. These are not HTTP endpoints but are invoked internally by the webhook handler through `env.FRONTDESK.idFromName(...)`.

### `handleInbound(payload: object): Promise<void>`

Entry point for processing an inbound RCS message. Restores or creates thread state, routes based on `suggestion_response.postback_data` or free-text `text`, and sends the appropriate rich card.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `payload` | `object` | Yes | The RCS message payload (same shape as `data.payload` above). |

**Returns:** `void`

### `classifyFreeText(text: string): Promise<void>`

Classifies free-text input using the Telnyx Decision Models API (`POST /v2/ai/typesafe/v1/systemone` with model `telnyx/decision-flash`). Routes to the appropriate card based on classified intent (`book`, `refill`, `nurse`, `urgent`).

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | `string` | Yes | The free-text message from the patient. |

**Returns:** `void`

### `callDecisionModel(freeText: string, stage: TriazeStage): Promise<{intent: string, urgency: number, emergency: boolean}>`

Calls the Telnyx Decision Models API with a `choice` question for intent classification, a `score` question for urgency, and a `noul` question for emergency routing.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `freeText` | `string` | Yes | Free-text input to classify. |
| `stage` | `TriazeStage` | Yes | Current triage stage (`greeting`, `service`, `date`, `confirm`, `completed`). |

**Returns:**

```typescript
{
  intent: string;      // "book" | "refill" | "nurse" | "urgent" | "unknown"
  urgency: number;     // 0–100 urgency score
  emergency: boolean;  // true if noul question flags emergency
}
```

### `checkCapabilities(phone: string): Promise<boolean>`

Queries `GET /v2/messaging/rcs/capabilities/{agent_id}/{phone_number}` to determine whether the recipient device supports RCS rich cards.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `phone` | `string` | Yes | Recipient phone number in E.164 format. |

**Returns:** `boolean` — `true` if `supports_rich_cards` is `true`, `false` otherwise.

### `sendRichCard(card: RichCard, fallbackText?: string): Promise<void>`

Sends an RCS rich card via `POST /v2/messages/rcs`. If the recipient does not support RCS, includes an `sms_fallback` with plain-text content.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `card` | `RichCard` | Yes | Rich card definition with `standalone_card` containing `suggestions[]`. |
| `fallbackText` | `string` | No | Plain-text fallback message for non-RCS devices. |

**Returns:** `void`

### `persistThread(): Promise<void>`

Persists the current thread state to the `threads` SQL table using an upsert (`INSERT ... ON CONFLICT(phone) DO UPDATE`).

**Returns:** `void`

### `persistBooking(state: ThreadState): Promise<void>`

Inserts a booking record into the `bookings` SQL table.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `state` | `ThreadState` | Yes | Current thread state containing phone, slot, and stage. |

**Returns:** `void`

---

## External API Calls

The actor makes the following external API calls to Telnyx services:

### POST /v2/messages/rcs

Sends an RCS message (rich card) to a recipient.

**Endpoint:** `https://api.telnyx.com/v2/messages/rcs`

**Headers:**

| Field | Value |
|---|---|
| `Authorization` | `Bearer <TELNYX_API_KEY>` |
| `Content-Type` | `application/json` |

**Body Schema:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_id` | `string` | Yes | RCS Agent ID. |
| `to` | `string` | Yes | Recipient phone number (E.164). |
| `messaging_profile_id` | `string` | Yes | Telnyx messaging profile ID. |
| `agent_message` | `object` | Yes | Agent message envelope. |
| `agent_message.content_message` | `object` | Yes | Content message wrapper. |
| `agent_message.content_message.rich_card` | `object` | Yes | Rich card payload (see `RichCard` type). |
| `sms_fallback` | `object` | No | Fallback SMS for non-RCS devices. |
| `sms_fallback.from` | `string` | No | Sender phone number for fallback SMS. |
| `sms_fallback.text` | `string` | No | Plain-text fallback message. |

**Example:**

```bash
curl -X POST https://api.telnyx.com/v2/messages/rcs \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "01894a7a-3b2c-7d1e-9f8a-2b3c4d5e6f7a",
    "to": "+15551234567",
    "messaging_profile_id": "12345678-1234-1234-1234-123456789012",
    "agent_message": {
      "content_message": {
        "rich_card": {
          "standalone_card": {
            "card_orientation": "VERTICAL",
            "card_content": {
              "title": "Welcome to Riverside Clinic",
              "description": "How can we help you today?",
              "suggestions": [
                { "reply": { "text": "Book appointment", "postback_data": "book_appt" } },
                { "reply": { "text": "Refill prescription", "postback_data": "refill" } },
                { "reply": { "text": "Talk to a nurse", "postback_data": "nurse" } }
              ]
            }
          }
        }
      }
    },
    "sms_fallback": {
      "from": "+15559998888",
      "text": "Riverside Clinic: Please use a device that supports RCS for the full experience."
    }
  }'
```

**Response:**

**Status:** `200 OK`

```json
{
  "data": {
    "id": "msg_01894a7a3b2c7d1e9f8a2b3c4d5e6f7a",
    "status": "queued"
  }
}
```

### GET /v2/messaging/rcs/capabilities/{agent_id}/{phone_number}

Queries device capabilities for a given phone number.

**Endpoint:** `https://api.telnyx.com/v2/messaging/rcs/capabilities/{agent_id}/{phone_number}`

**Headers:**

| Field | Value |
|---|---|
| `Authorization` | `Bearer <TELNYX_API_KEY>` |

**Response:**

**Status:** `200 OK`

```json
{
  "data": {
    "supports_rich_cards": true,
    "supports_carousels": true,
    "supports_video": false
  }
}
```

### POST /v2/ai/typesafe/v1/systemone

Calls the Telnyx Decision Models API to classify free-text intent.

**Endpoint:** `https://api.telnyx.com/v2/ai/typesafe/v1/systemone`

**Headers:**

| Field | Value |
|---|---|
| `Authorization` | `Bearer <TELNYX_API_KEY>` |
| `Content-Type` | `application/json` |

**Body Schema:**

| Field | Type | Required | Description |
|---|---|---|---|
| `model` | `string` | Yes | Model identifier: `"telnyx/decision-flash"`. |
| `state` | `object` | Yes | Current conversation state. |
| `state.free_text` | `string` | Yes | Free-text input to classify. |
| `state.stage` | `string` | Yes | Current triage stage. |
| `questions` | `object` | Yes | Questions to ask the model. |
| `questions.intent` | `object` | Yes | `{ type: "choice", options: ["book", "refill", "nurse", "urgent"] }`. |
| `questions.urgency` | `object` | Yes | `{ type: "score" }`. |
| `questions.emergency` | `object` | Yes | `{ type: "noul" }`. |

**Example:**

```bash
curl -X POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "telnyx/decision-flash",
    "state": {
      "free_text": "I need to schedule a dental checkup",
      "stage": "greeting"
    },
    "questions": {
      "intent": { "type": "choice", "options": ["book", "refill", "nurse", "urgent"] },
      "urgency": { "type": "score" },
      "emergency": { "type": "noul" }
    }
  }'
```

**Response:**

**Status:** `200 OK`

```json
{
  "choices": [
    {
      "intent": "book",
      "urgency": 30,
      "emergency": false
    }
  ]
}
```

---

## SQL Schema

The actor uses a `SqlDatabase` binding (`THREADS_DB`) with two tables:

### `threads`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `phone` | `TEXT` | `PRIMARY KEY` | Patient phone number (E.164). |
| `stage` | `TEXT` | `NOT NULL` | Current triage stage. |
| `intent` | `TEXT` | | Classified intent (`book`, `refill`, `nurse`, `urgent`). |
| `slot` | `TEXT` | | Selected service or date slot. |
| `last_card` | `TEXT` | | Last card sent (`greeting`, `service`, `date`, `confirm`). |
| `taps` | `TEXT` | `NOT NULL DEFAULT '[]'` | JSON array of tap history. |

### `bookings`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | Booking record ID. |
| `phone` | `TEXT` | `NOT NULL` | Patient phone number. |
| `provider` | `TEXT` | `NOT NULL` | Provider name (e.g. `"Riverside Clinic"`). |
| `status` | `TEXT` | `NOT NULL` | Booking status (e.g. `"confirmed"`). |
| `slot` | `TEXT` | `NOT NULL` | Selected date/time slot. |
| `at` | `INTEGER` | `NOT NULL` | Unix timestamp of booking creation. |
