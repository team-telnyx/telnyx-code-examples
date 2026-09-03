# Event Microsite That Takes Calls — API Reference

Base URL: `https://edge-event-microsite-<id>.telnyxcompute.com`

All JSON endpoints accept and return `application/json` unless noted. Inbound webhooks (`/webhook/*`, `/tools/lookup`) are verified with Telnyx Ed25519 signatures (`Telnyx-Signature-Ed25519` + `Telnyx-Timestamp` headers; signed payload `"{ts}|{body}"`; ±5 minute clock skew allowed).

---

## Pages

### GET /

Server-rendered microsite (schedule, speakers, venue, sponsors, lead form, broadcast registration, voice-feedback recorder). Every value comes from KV.

**Response:** `text/html`

### GET /voice

In-browser voice concierge page. Connects to the Telnyx AI Assistant over WebRTC (`@telnyx/ai-agent-lib`, anonymous login — no credentials in the page). User speech turns are captured as feedback automatically.

**Response:** `text/html`

---

## Read APIs

### GET /api/event

Full event JSON from KV (seeds sample data on first call).

**Response `200`**

```json
{
  "event": { "name": "TechForward Summit 2026", "date": "2026-10-15", "location": "San Francisco Convention Center", "description": "..." },
  "schedule": [ { "id": "s1", "time": "09:00", "title": "Opening Keynote", "speaker": "Jane Doe", "room": "Main Hall" } ],
  "speakers": [ { "id": "sp1", "name": "Jane Doe", "title": "CEO, TechCorp", "bio": "...", "photo": "..." } ],
  "venue": { "address": "...", "map_url": "...", "wifi": "SSID: ... | Password: ...", "parking": "..." },
  "sponsors": [ { "id": "spon1", "name": "Telnyx", "tier": "Platinum", "logo": "..." } ]
}
```

### GET /api/config

Assistant id + event name for the voice page (no credentials exposed).

**Response `200`**

```json
{ "assistant_id": "assistant-0ff930c5-...", "event_name": "TechForward Summit 2026" }
```

### GET /api/leads

Captured exhibitor leads, newest first.

**Response `200`**

```json
{
  "count": 1,
  "hot": 1,
  "leads": [
    {
      "id": "lead-mtkjh6aw-45fpzz",
      "company": "Acme Robotics",
      "company_size": "500",
      "budget": "enterprise",
      "timeline": "immediate",
      "phone_number": "+15551234567",
      "notes": "met at booth 42",
      "is_hot": true,
      "source": "web-form",
      "created_at": "2026-09-02T20:15:00.000Z"
    }
  ]
}
```

### GET /api/sponsor-report

Aggregated post-event feedback summaries.

**Response `200`**

```json
{
  "event": "TechForward Summit 2026",
  "generated_at": "2026-09-02T20:25:58.056Z",
  "total_feedback_items": 2,
  "feedback": [
    { "id": "fb-mtkjpsio-fz6s94", "phone_number": "***-***-7292", "summary": "Mixed — enjoyed the keynote, complained about room temperature and WiFi.", "created_at": "..." }
  ]
}
```

---

## Write APIs

### POST /api/leads

Submit a structured exhibitor lead (microsite form). Hot leads (budget `high`/`enterprise` AND near-term timeline) trigger an SMS to `TELNYX_SALES_REP_PHONE` with the contact's masked phone, with an email fallback if the SMS fails.

**Request**

```json
{
  "company": "Acme Robotics",
  "company_size": "500",
  "budget": "enterprise",
  "timeline": "immediate",
  "phone_number": "+15551234567",
  "notes": "met at booth 42"
}
```

**Response `201`**

```json
{ "status": "ok", "lead_id": "lead-mtkjh6aw-45fpzz", "is_hot": true, "routed_to_sales": true }
```

**Errors:** `400` missing fields

### POST /api/attendees

Register a phone number for schedule-change broadcasts.

**Request**

```json
{ "phone_number": "+15551234567" }
```

**Response `201`**

```json
{ "ok": true, "phone_number": "+15551234567" }
```

**Errors:** `400` not E.164

### POST /api/broadcast

SMS + WhatsApp a schedule change to all opted-in attendees.

**Request**

```json
{ "change": "Opening keynote moved to 10:00", "session": "s1" }
```

**Response `200`**

```json
{
  "status": "ok",
  "message": "📢 Schedule Update: Opening keynote moved to 10:00 (Session: s1)",
  "recipients": 1,
  "results": [ { "phone": "***-***-7292", "sms": "sent", "whatsapp": "sent" } ]
}
```

**Errors:** `400` missing `change`

### POST /api/feedback

Spoken feedback. Two modes:

- **Audio upload** (`multipart/form-data`): fields `audio` (webm/wav/mp3, ≤24MB) + `phone_number`. The audio is transcribed with Whisper (`POST /v2/ai/audio/transcriptions`).
- **Direct transcript** (`application/json`): fields `transcript` + `phone_number`. Used by the voice page to save browser-captured speech turns.

The transcript is summarized with AI Inference and stored in KV.

**Response `201` (audio mode)**

```json
{
  "status": "ok",
  "id": "fb-mtkjqga6-9dusgu",
  "transcript": "The keynote was excellent, but the afternoon sessions were hard to hear from the back of the room.",
  "summary": "The attendee feedback was mixed, praising the keynote as \"excellent\" but expressing disappointment with the afternoon sessions due to audio issues.",
  "via": "whisper"
}
```

**Errors:** `400` no transcript produced, `413` audio too large

### POST /api/email-report

Email the sponsor report (feedback summaries + hot leads) to `EMAIL_TO` via the Telnyx Email API.

**Response `200`**

```json
{ "status": "ok", "to": "organizer@example.com", "feedback_items": 2, "hot_leads": 1 }
```

**Errors:** `400` `EMAIL_TO` not configured, `502` send failure

### POST /api/setup-assistant

Provision (or update by name) the Telnyx AI Assistant used for browser voice. Wires a `lookup_event_info` webhook tool to this function's `/tools/lookup` and stores the assistant id in KV.

**Response `200`**

```json
{
  "status": "ok",
  "assistant_id": "assistant-0ff930c5-...",
  "webhook_tool_url": "https://edge-event-microsite-<id>.telnyxcompute.com/tools/lookup",
  "voice_page": "https://edge-event-microsite-<id>.telnyxcompute.com/voice"
}
```

---

## Webhooks

### POST /webhook/sms · POST /webhook/whatsapp

Inbound messages from the messaging profile. Ed25519-verified. Flow: register the sender as an attendee → generate a concierge reply with AI Inference grounded in the live KV event data → detect lead intent (budget/pricing/demo/booth keywords) → extract + store + route hot leads → reply on the same channel.

**Request body (Telnyx messaging webhook)**

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "from": { "phone_number": "+15551234567" },
      "to": { "phone_number": "+16282564655" },
      "text": "What's the wifi password?"
    }
  }
}
```

WhatsApp payloads carry the message body at `payload.text.body`; the handler accepts both shapes.

**Response `200`**

```json
{
  "status": "ok",
  "channel": "sms",
  "delivered": true,
  "reply_chars": 86,
  "lead_captured": false,
  "lead_hot": false
}
```

**Errors:** `400` missing signature headers / bad JSON, `401` invalid signature or stale timestamp, `500` `TELNYX_PUBLIC_KEY` not configured

### POST /tools/lookup

The voice assistant's webhook tool. Telnyx calls this mid-conversation (signed with Ed25519 headers automatically); it returns the live event data from KV so the voice agent always matches the website.

**Response `200`**: same shape as `GET /api/event`.

**Errors:** `400`/`401` signature failures, `500` missing public key

---

## Health

### GET /health/liveness · GET /health/readiness

Platform probes. **Response:** `200` `ok`
