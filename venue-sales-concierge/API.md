# API Reference — Venue Sales Concierge

All endpoints are served by a single Telnyx Edge Function at
`https://<your-function>.telnyxcompute.com` (or your attached custom domain).
Pages are HTML; APIs are JSON; webhooks are Ed25519-verified.

---

## Pages

### `GET /`

The branded venue microsite — galleries, capacity charts, catering menus, AV specs, pricing, FAQs, a live availability checker, and a site-visit booking form. Server-rendered entirely from KV (`venue/data`).

| Status | Meaning |
|--------|---------|
| 200 | HTML page |

### `GET /voice`

In-browser voice concierge page (WebRTC, anonymous login to the provisioned AI Assistant).

| Status | Meaning |
|--------|---------|
| 200 | HTML page (assistant must be provisioned via `POST /api/setup-assistant` first) |

### `GET /ops`

The venue's branded bookings dashboard ("{Venue name} — Bookings"): funnel stats, live availability (next 14 days), recent inquiries, booked site visits. Auto-refreshes every 15s.

| Status | Meaning |
|--------|---------|
| 200 | HTML page |

### `GET /health`

Platform health probe.

| Status | Meaning |
|--------|---------|
| 200 | `ok` |

---

## JSON APIs

### `GET /api/event`

Returns the venue data (the same JSON the microsite renders from KV).

```bash
curl https://<your-function-url>/api/event
```

**Response — `200 OK`**

| Field | Type | Description |
|-------|------|-------------|
| `venue` | object | name, tagline, location, description |
| `gallery` | array | `{url, caption}` photo entries |
| `spaces` | array | `{name, seated, cocktail, sqft, features[]}` |
| `menus` | array | `{name, price_per_person, description, items[]}` |
| `av` | array | AV/production specs |
| `pricing` | object | `{rental: {space: price}, catering_from, note}` |
| `faqs` | array | `{question, answer, keywords[]}` |

---

### `GET /api/availability?start=YYYY-MM-DD&end=YYYY-MM-DD`

Live availability from the venue SQLDB. Seeds the schema + 90 days of sample data on first call.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `start` | string | no | Range start (defaults to today) |
| `end` | string | no | Range end (defaults to +90 days) |

```bash
curl "https://<your-function-url>/api/availability?start=2026-10-01&end=2026-10-31"
```

**Response — `200 OK`**

| Field | Type | Description |
|-------|------|-------------|
| `start` / `end` | string | Echoed range |
| `summary` | string | Human summary the concierge quotes |
| `days` | array | `{date, available, note}` |

```json
{
  "start": "2026-10-01",
  "end": "2026-10-31",
  "summary": "27 of 31 dates between 2026-10-01 and 2026-10-31 are available. Earliest openings: 2026-10-01, 2026-10-02, ...",
  "days": [{ "date": "2026-10-01", "available": true, "note": "" }]
}
```

---

### `GET /api/leads`

Funnel + records for the sales dashboard.

**Response — `200 OK`**

| Field | Type | Description |
|-------|------|-------------|
| `stats.inquiries` | number | Total inquiry rows in SQLDB |
| `stats.qualified` | number | Inquiries qualified as RFPs (rendered as the "RFPs" card in the UI) |
| `stats.booked` | number | Site visits with status `booked` |
| `stats.conversion_pct` | number | Booked ÷ inquiries, rounded |
| `inquiries` | array | Recent inquiry rows |
| `visits` | array | Recent site-visit rows |

```json
{
  "stats": { "inquiries": 12, "qualified": 5, "booked": 3, "conversion_pct": 25 },
  "inquiries": [
    {
      "id": "inq-k1x2y3",
      "phone": "+15551234567",
      "name": "Jane",
      "email": "jane@example.com",
      "event_type": "wedding",
      "guests": 150,
      "budget": "$20,000",
      "dates": "2026-11-07 → 2026-11-08",
      "message": "We're planning a fall wedding for 150...",
      "channel": "sms",
      "qualified": 1,
      "created_at": 1757932000000
    }
  ],
  "visits": [
    {
      "id": "visit-a9b8c7",
      "phone": "+15551234567",
      "name": "Jane",
      "email": "jane@example.com",
      "visit_date": "2026-09-24",
      "status": "booked",
      "source": "voice-call",
      "created_at": 1757932100000
    }
  ]
}
```

---

### `POST /api/site-visit`

Book a site visit from the microsite form. Writes to SQLDB and confirms by email **and** SMS to the planner (real sends when `DEMO_MODE=false`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | string | yes | Planner phone (E.164) |
| `email` | string | yes | Planner email |
| `name` | string | no | Planner name |
| `visit_date` | string | no | Preferred date (`YYYY-MM-DD`); defaults to TBD |

```bash
curl -X POST https://<your-function-url>/api/site-visit \
  -H "Content-Type: application/json" \
  -d '{ "phone_number": "+15551234567", "email": "jane@example.com", "name": "Jane", "visit_date": "2026-09-24" }'
```

**Response — `200 OK`**

```json
{ "ok": true, "visit": { "id": "visit-a9b8c7", "visit_date": "2026-09-24", "email": "jane@example.com", "name": "Jane" } }
```

| Status | Meaning |
|--------|---------|
| 200 | Booked (confirmation emailed + texted, or demo-logged) |
| 400 | Missing/invalid phone or email |

---

### `GET /api/config`

What the browser voice page needs: the provisioned assistant id (never credentials).

```json
{ "assistant_id": "uuid-...", "venue_name": "Harborview Grand Pavilion" }
```

---

### `POST /api/setup-assistant`

Provisions (or updates) the Telnyx AI Assistant used for browser voice, wired with a `lookup_venue_info` webhook tool backed by this function's KV + SQLDB. Run once after the first deploy:

```bash
curl -X POST https://<your-function-url>/api/setup-assistant
```

**Response — `200 OK`**

```json
{
  "status": "ok",
  "assistant_id": "uuid-...",
  "webhook_tool_url": "https://<your-function-url>/tools/lookup",
  "voice_page": "https://<your-function-url>/voice"
}
```

---

### `POST /api/demo/message`

Demo-only entry: simulates an inbound planner SMS and runs the same StatefulActor pipeline end-to-end (inference, KV, SQLDB real; outbound sends demo-logged). No signature required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | yes | Planner phone (E.164) |
| `text` | string | yes | Message text |

```bash
curl -X POST https://<your-function-url>/api/demo/message \
  -H "Content-Type: application/json" \
  -d '{ "from": "+15551234567", "text": "Hi, planning a wedding for 150 guests, do you have space in November?" }'
```

**Response — `200 OK`**

```json
{ "queued": true, "phone": "+15551234567" }
```

---

## Webhooks

### `POST /webhooks/sms`

Inbound SMS webhook for the venue's messaging profile.

**Security**: Ed25519 — `Telnyx-Signature-Ed25519` + `Telnyx-Timestamp` headers verified against `TELNYX_PUBLIC_KEY` (±5 min skew). Failures: `400` missing headers, `401` bad signature/stale timestamp, `500` key not configured.

**Handling**: only `message.received` events with inbound direction are processed; outbound receipts and self-sent messages are ignored. Deduped on `data.payload.id` (KV lock, 10 min TTL). Fast-acked (`ok`), then processed in the background by the planner's StatefulActor.

**Expected payload** (`data.payload`):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Message id (dedupe key) |
| `direction` | string | `inbound` |
| `from.phone_number` | string | Planner phone |
| `text` | string \| object | Message text (or `{body}` for WhatsApp) |

Always responds `200` (or a 4xx/5xx verification error) — never echoes processing state, so Telnyx never retries a slow pipeline.

---

### `POST /webhooks/voice`

Call Control webhook for the venue's Call Control connection: inbound planner calls and events for the scheduled follow-up calls.

**Security**: same Ed25519 verification as above.

**Routing**: `direction === "outgoing"` routes by `payload.to` (follow-up calls the agent placed); `incoming` routes by `payload.from`.

**Handled events** (`data.event_type`):

| Event | Actor behavior |
|-------|----------------|
| `call.initiated` | Store call id, issue `answer` |
| `call.answered` | Follow-up call → personalized script + DTMF confirm. Inbound call → greeting + speech gather |
| `call.gather.ended` | Digits `1` → book site visit (SQLDB + email) / `2` → polite close. Speech → LLM turn → speak reply → gather again |
| `call.hangup` / `call.hangup.ended` | Clear call state |

**Expected payload** (`data.payload`):

| Field | Type | Description |
|-------|------|-------------|
| `call_control_id` | string | Live call handle |
| `direction` | string | `incoming` / `outgoing` |
| `from` / `to` | object \| string | `{phone_number}` or raw |
| `digits` | string | DTMF collected (confirm gathers) |
| `result` | string \| object | Speech transcription (chat gathers) |

---

### `POST /tools/lookup`

Webhook tool invoked by the AI Assistant mid-conversation (Telnyx signs these automatically). Ed25519-verified.

**Response — `200 OK`**

```json
{
  "venue": { "venue": {...}, "spaces": [...], "menus": [...], "av": [...], "pricing": {...}, "faqs": [...] },
  "availability": "58 of 91 dates between 2026-09-15 and 2026-12-14 are available..."
}
```

---

## Scheduled Tasks

### `followUpCall` (StatefulActor task)

Durable one-week timer, scheduled per planner with a fixed task id (`followup`) so it re-arms on every touchpoint instead of stacking.

| Guard | Skip reason |
|-------|-------------|
| `DEMO_MODE !== "false"` | `demo_mode` (logged instead of dialed) |
| `siteVisitBooked` | `already_booked` |
| Active within 7 days | `planner_active_recently` |
| Last message from planner | `planner_replied_after_us` |
| No `TELNYX_CONNECTION_ID` | `no_connection_id` |

When it fires: `POST /v2/calls` on the Call Control connection → `call.answered` → personalized speak script → DTMF gather → `1` books the visit (SQLDB + confirmation email) → hangup.
