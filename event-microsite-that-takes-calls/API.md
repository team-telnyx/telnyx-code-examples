# API Reference — Event Microsite That Takes Calls

This document describes every HTTP endpoint exposed by the Flask application in `app.py`. All webhook endpoints verify the Telnyx Ed25519 signature before processing.

---

## Table of Contents

1. [Microsite & Data API](#microsite--data-api)
   - [GET /](#get-)
   - [GET /api/event](#get-apievent)
   - [GET /api/schedule](#get-apischedule)
   - [GET /api/speakers](#get-aspeakers)
   - [GET /api/venue](#get-apivenue)
   - [GET /api/sponsors](#get-apisponsors)
2. [SMS / WhatsApp — AI Concierge](#sms--whatsapp--ai-concierge)
   - [POST /webhook/sms](#post-webhooksms)
   - [POST /webhook/whatsapp](#post-webhookwhatsapp)
3. [Voice — AI Concierge](#voice--ai-concierge)
   - [POST /webhook/voice](#post-webhookvoice)
   - [POST /webhook/voice-ai](#post-webhookvoice-ai)
   - [GET /api/voice-websocket-info](#get-apivoice-websocket-info)
4. [Broadcast Schedule Changes](#broadcast-schedule-changes)
   - [POST /api/broadcast-schedule-change](#post-apibroadcast-schedule-change)
5. [Exhibitor Lead Qualification](#exhibitor-lead-qualification)
   - [POST /api/qualify-lead](#post-apiqualify-lead)
6. [Post-Event Feedback](#post-event-feedback)
   - [POST /api/submit-feedback](#post-apisubmit-feedback)
   - [GET /api/sponsor-report](#get-apisponsor-report)

---

## Microsite & Data API

### GET /

Renders the full event microsite HTML page from KV-backed event data.

**Request**

No request body.

**Example**

```bash
curl https://<your-domain>/
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | text/html          | Full HTML microsite page with schedule, speakers, venue, sponsors.   |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

---

### GET /api/event

Returns the complete event data object as JSON.

**Request**

No request body.

**Example**

```bash
curl https://<your-domain>/api/event
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | See [Event Data Schema](#event-data-schema) below.                   |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

**Event Data Schema**

| Field       | Type    | Description                                      |
|-------------|---------|--------------------------------------------------|
| event       | object  | Event metadata (name, date, location, description). |
| schedule    | array   | List of schedule items.                          |
| speakers    | array   | List of speaker objects.                         |
| venue       | object  | Venue details (address, map_url, wifi, parking). |
| sponsors    | array   | List of sponsor objects.                         |

---

### GET /api/schedule

Returns the schedule array as JSON.

**Request**

No request body.

**Example**

```bash
curl https://<your-domain>/api/schedule
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | Array of schedule item objects.                                      |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

**Schedule Item Schema**

| Field   | Type   | Required | Description                          |
|---------|--------|----------|--------------------------------------|
| id      | string | Yes      | Unique session identifier.           |
| time    | string | Yes      | Session start time (HH:MM).          |
| title   | string | Yes      | Session title.                       |
| speaker | string | No       | Speaker name (may be empty).         |
| room    | string | Yes      | Room/location name.                  |

---

### GET /api/speakers

Returns the speakers array as JSON.

**Request**

No request body.

**Example**

```bash
curl https://<your-domain>/api/speakers
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | Array of speaker objects.                                            |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

**Speaker Schema**

| Field  | Type   | Required | Description                          |
|--------|--------|----------|--------------------------------------|
| id     | string | Yes      | Unique speaker identifier.           |
| name   | string | Yes      | Speaker full name.                   |
| title  | string | Yes      | Speaker title/company.               |
| bio    | string | Yes      | Short biography.                     |
| photo  | string | Yes      | URL to speaker photo.                |

---

### GET /api/venue

Returns the venue object as JSON.

**Request**

No request body.

**Example**

```bash
curl https://<your-domain>/api/venue
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | Venue object.                                                        |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

**Venue Schema**

| Field    | Type   | Required | Description                          |
|----------|--------|----------|--------------------------------------|
| address  | string | Yes      | Physical venue address.              |
| map_url  | string | Yes      | Google Maps link.                    |
| wifi     | string | Yes      | WiFi SSID and password.              |
| parking  | string | Yes      | Parking instructions.                |

---

### GET /api/sponsors

Returns the sponsors array as JSON.

**Request**

No request body.

**Example**

```bash
curl https://<your-domain>/api/sponsors
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | Array of sponsor objects.                                            |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

**Sponsor Schema**

| Field  | Type   | Required | Description                          |
|--------|--------|----------|--------------------------------------|
| id     | string | Yes      | Unique sponsor identifier.           |
| name   | string | Yes      | Sponsor company name.                |
| tier   | string | Yes      | Sponsorship tier (Platinum/Gold/Silver). |
| logo   | string | Yes      | URL to sponsor logo.                 |

---

## SMS / WhatsApp — AI Concierge

### POST /webhook/sms

Handles inbound SMS messages from attendees. Verifies the Telnyx webhook signature, then generates an AI concierge response via Inference and replies via SMS (or logs in demo mode).

**Request**

Headers:

| Header              | Type   | Required | Description                              |
|---------------------|--------|----------|------------------------------------------|
| Telnyx-Signature-Ed25519 | string | Yes      | Ed25519 signature (base64) for webhook verification. |
| Telnyx-Timestamp   | string | Yes      | Timestamp used in the signed payload `"{ts}|{body}"`. |
| Content-Type        | string | Yes      | Must be `application/json`.              |

Body: Telnyx webhook payload (raw JSON, not parsed by client).

**Example**

```bash
curl -X POST https://<your-domain>/webhook/sms \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: <timestamp>" \
  -H "Content-Type: application/json" \
  -d '{"data":{"payload":{"from":{"phone_number":"+15551234567"},"to":{"phone_number":"+15559999999"},"text":"What time is the keynote?"}}}'
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | `{"status": "ok", "response": "<AI response text>"}`                 |
| 401         | application/json   | `{"error": "Unauthorized"}` — missing or invalid signature.          |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

---

### POST /webhook/whatsapp

Handles inbound WhatsApp messages from attendees. Same flow as SMS but uses the WhatsApp sender number.

**Request**

Headers:

| Header              | Type   | Required | Description                              |
|---------------------|--------|----------|------------------------------------------|
| Telnyx-Signature-Ed25519 | string | Yes      | Ed25519 signature (base64) for webhook verification. |
| Telnyx-Timestamp   | string | Yes      | Timestamp used in the signed payload `"{ts}|{body}"`. |
| Content-Type        | string | Yes      | Must be `application/json`.              |

Body: Telnyx webhook payload (raw JSON).

**Example**

```bash
curl -X POST https://<your-domain>/webhook/whatsapp \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: <timestamp>" \
  -H "Content-Type: application/json" \
  -d '{"data":{"payload":{"from":{"phone_number":"+15551234567"},"text":{"body":"Where is the venue?"}}}}'
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | `{"status": "ok", "response": "<AI response text>"}`                 |
| 401         | application/json   | `{"error": "Unauthorized"}`                                          |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

---

## Voice — AI Concierge

### POST /webhook/voice

Handles inbound voice calls. Verifies the webhook signature via `unwrap_with_ed25519`, answers the call with `telnyx_client.calls.actions.answer`, and connects the caller to the Telnyx AI Assistant via `telnyx_client.calls.actions.start_ai_assistant` for real-time AI conversation.

**Request**

Headers:

| Header              | Type   | Required | Description                              |
|---------------------|--------|----------|------------------------------------------|
| Telnyx-Signature-Ed25519 | string | Yes      | Ed25519 signature (base64) for webhook verification. |
| Telnyx-Timestamp   | string | Yes      | Timestamp used in the signed payload `"{ts}|{body}"`. |
| Content-Type        | string | Yes      | Must be `application/json`.              |

Body: Telnyx webhook payload (raw JSON).

**Example**

```bash
curl -X POST https://<your-domain>/webhook/voice \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: <timestamp>" \
  -H "Content-Type: application/json" \
  -d '{"data":{"payload":{"call_control_id":"call_abc123","call_leg_id":"leg_xyz789"}}}'
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | `{"status": "ok", "call_control_id": "call_abc123"}`                 |
| 200         | application/json   | `{"status": "demo", "call_control_id": "call_abc123"}` (demo mode)   |
| 401         | application/json   | `{"error": "Unauthorized"}`                                          |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

---

### POST /webhook/voice-ai

Handles Voice AI WebSocket events including call lifecycle and transcription events.

**Request**

Headers:

| Header              | Type   | Required | Description                              |
|---------------------|--------|----------|------------------------------------------|
| Telnyx-Signature-Ed25519 | string | Yes      | Ed25519 signature (base64) for webhook verification. |
| Telnyx-Timestamp   | string | Yes      | Timestamp used in the signed payload `"{ts}|{body}"`. |
| Content-Type        | string | Yes      | Must be `application/json`.              |

Body: Telnyx webhook payload (raw JSON). Event types include: `call.started`, `call.answered`, `transcription.received`, `call.ended`.

**Example**

```bash
curl -X POST https://<your-domain>/webhook/voice-ai \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: <timestamp>" \
  -H "Content-Type: application/json" \
  -d '{"type":"transcription.received","data":{"payload":{"transcript":"Hello, I need help with the schedule"}}}'
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | `{"status": "ok"}`                                                   |
| 401         | application/json   | `{"error": "Unauthorized"}`                                          |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

---

### GET /api/voice-websocket-info

Returns configuration information for initializing the in-browser Voice AI WebSocket connection.

**Request**

No request body.

**Example**

```bash
curl https://<your-domain>/api/voice-websocket-info
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | See [Voice WebSocket Info Schema](#voice-websocket-info-schema).     |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

**Voice WebSocket Info Schema**

| Field               | Type    | Description                                      |
|---------------------|---------|--------------------------------------------------|
| connection_id       | string  | Telnyx Voice connection ID.                      |
| domain              | string  | Custom event domain.                             |
| ai_concierge_name   | string  | Name of the AI concierge.                        |
| demo_mode           | boolean | Whether demo mode is active.                     |

---

## Broadcast Schedule Changes

### POST /api/broadcast-schedule-change

Broadcasts a schedule change notification to all opted-in attendees via both SMS and WhatsApp.

**Request**

Headers:

| Header         | Type   | Required | Description              |
|----------------|--------|----------|--------------------------|
| Content-Type   | string | Yes      | Must be `application/json`. |

Body:

| Field               | Type   | Required | Description                                      |
|---------------------|--------|----------|--------------------------------------------------|
| change              | string | No       | Description of the schedule change. Defaults to "Schedule update". |
| session             | string | No       | Affected session name/ID.                        |

**Example**

```bash
curl -X POST https://<your-domain>/api/broadcast-schedule-change \
  -H "Content-Type: application/json" \
  -d '{"change": "Opening keynote moved to 10:00 AM", "session": "s1"}'
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | `{"status": "ok", "message": "...", "recipients": 0, "demo_mode": true}` |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

---

## Exhibitor Lead Qualification

### POST /api/qualify-lead

Captures exhibitor lead information, qualifies the lead (hot lead if budget is high/enterprise and timeline is immediate/near-term), stores it in SQLDB, and routes hot leads to the sales representative via SMS.

**Request**

Headers:

| Header         | Type   | Required | Description              |
|----------------|--------|----------|--------------------------|
| Content-Type   | string | Yes      | Must be `application/json`. |

Body:

| Field          | Type   | Required | Description                                      |
|----------------|--------|----------|--------------------------------------------------|
| company        | string | Yes      | Company name.                                    |
| company_size   | string | Yes      | Company size (e.g., "50-200", "Enterprise").     |
| budget         | string | Yes      | Budget level (e.g., "high", "medium", "low").    |
| timeline       | string | Yes      | Purchase timeline (e.g., "immediate", "q3 2025"). |
| phone_number   | string | Yes      | Contact phone number (E.164 format).             |

**Example**

```bash
curl -X POST https://<your-domain>/api/qualify-lead \
  -H "Content-Type: application/json" \
  -d '{"company": "Acme Corp", "company_size": "200-500", "budget": "high", "timeline": "immediate", "phone_number": "+15551234567"}'
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | `{"status": "ok", "company": "Acme Corp", "is_hot_lead": true, "routed_to_sales": true, "demo_mode": true}` |
| 400         | application/json   | `{"error": "Missing required lead fields"}`                          |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

---

## Post-Event Feedback

### POST /api/submit-feedback

Accepts post-event spoken feedback (audio URL), transcribes it using Telnyx Inference Whisper, summarizes the transcript for a sponsor report, and stores the result in SQLDB.

**Request**

Headers:

| Header         | Type   | Required | Description              |
|----------------|--------|----------|--------------------------|
| Content-Type   | string | Yes      | Must be `application/json`. |

Body:

| Field        | Type   | Required | Description                                      |
|--------------|--------|----------|--------------------------------------------------|
| phone_number | string | Yes      | Attendee phone number (E.164 format).            |
| audio_url    | string | Yes      | URL to the recorded audio file.                  |

**Example**

```bash
curl -X POST https://<your-domain>/api/submit-feedback \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+15551234567", "audio_url": "https://example.com/audio/feedback_001.wav"}'
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | `{"status": "ok", "transcript": "...", "summary": "...", "demo_mode": true}` |
| 400         | application/json   | `{"error": "Missing phone_number or audio_url"}`                     |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

---

### GET /api/sponsor-report

Generates a sponsor report from all collected post-event feedback stored in SQLDB.

**Request**

No request body.

**Example**

```bash
curl https://<your-domain>/api/sponsor-report
```

**Response**

| Status Code | Content-Type       | Body                                                                 |
|-------------|--------------------|----------------------------------------------------------------------|
| 200         | application/json   | See [Sponsor Report Schema](#sponsor-report-schema).                 |
| 500         | application/json   | `{"error": "Internal server error"}`                                 |

**Sponsor Report Schema**

| Field                | Type   | Description                                      |
|----------------------|--------|--------------------------------------------------|
| generated_at         | string | ISO 8601 timestamp of report generation.         |
| total_feedback_items | integer| Number of feedback entries in the report.        |
| feedback             | array  | List of feedback objects (see below).            |

**Feedback Object Schema**

| Field        | Type   | Description                                      |
|--------------|--------|--------------------------------------------------|
| phone_number | string | Attendee phone number.                           |
| transcript   | string | Full transcription of spoken feedback.           |
| summary      | string | AI-generated summary of the feedback.            |
| created_at   | string | ISO 8601 timestamp of feedback submission.       |

---

## Status Codes Summary

| Code | Meaning                  | When It Occurs                                      |
|------|--------------------------|-----------------------------------------------------|
| 200  | OK                       | Request processed successfully.                     |
| 400  | Bad Request              | Missing required fields in request body.            |
| 401  | Unauthorized             | Missing or invalid Telnyx webhook signature.        |
| 404  | Not Found                | Endpoint path does not exist.                       |
| 500  | Internal Server Error    | Unhandled exception during request processing.      |
