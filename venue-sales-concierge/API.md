# API Reference — Venue Sales Concierge

All endpoints are served by a single Telnyx Edge Function. The function routes inbound webhooks to a `ConciergeAgent` (a stateful `Agent` backed by a `StatefulActor`) via the `CONCIERGE` actor namespace.

---

## `GET /health`

Health check endpoint.

### Request

No parameters.

### Example

```bash
curl https://<your-function-url>/health
```

### Response — `200 OK`

| Field    | Type   | Description                     |
|----------|--------|---------------------------------|
| `status` | string | Always `"ok"`.                  |

```json
{ "status": "ok" }
```

### Status Codes

| Code | Description                     |
|------|---------------------------------|
| 200  | Service is healthy.             |

---

## `POST /inbound`

Primary entry point for inbound SMS and voice webhooks. The request body is forwarded to the `ConciergeAgent` actor for stateful processing.

### Request Body

| Field    | Type    | Required | Description                                                                 |
|----------|---------|----------|-----------------------------------------------------------------------------|
| `from`   | string  | Yes      | The planner's phone number (E.164 format). Used as the actor state key.     |
| `text`   | string  | No       | The SMS message body. Omit or empty for voice-only interactions.            |
| `callId` | string  | No       | Telnyx Call Control ID. When present, the request is treated as a voice call. |

### Example — SMS

```bash
curl -X POST https://<your-function-url>/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+15551234567",
    "text": "Hi, I am interested in booking a site visit for 150 guests."
  }'
```

### Example — Voice Call

```bash
curl -X POST https://<your-function-url>/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+15551234567",
    "callId": "TNKabc123def456"
  }'
```

### Response — `200 OK` (SMS)

| Field  | Type   | Description                                              |
|--------|--------|----------------------------------------------------------|
| `reply`| string | The AI-generated or demo-mode response text sent to the planner. |

```json
{ "reply": "[DEMO MODE] I'd be happy to book a site visit! Our available tour slots are Tuesday through Friday, 10 AM to 3 PM. What date works best for you?" }
```

### Response — `200 OK` (Voice)

| Field    | Type   | Description                                              |
|----------|--------|----------------------------------------------------------|
| `status` | string | Always `"call_initiated"`.                               |

```json
{ "status": "call_initiated" }
```

### Status Codes

| Code | Description                                                                 |
|------|-----------------------------------------------------------------------------|
| 200  | Request processed successfully.                                             |
| 400  | Missing required `from` field.                                              |
| 404  | Path not found.                                                             |
| 500  | Internal server error (generic message; details logged server-side).        |

---

## `GET /voice/{callId}`

Voice webhook endpoint. Returns TwiML-like XML consumed by Telnyx Call Control to handle the inbound voice call.

### Path Parameters

| Parameter | Type   | Required | Description                                      |
|-----------|--------|----------|--------------------------------------------------|
| `callId`  | string | Yes      | The Telnyx Call Control ID from the inbound call.|

### Example

```bash
curl https://<your-function-url>/voice/TNKabc123def456
```

### Response — `200 OK`

Returns XML with `Content-Type: application/xml`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="female" language="en-US">Hello! This is your venue sales concierge. Please leave a message after the beep, or continue your conversation via text.</Say>
  <Record timeout="10" maxLength="120" />
  <Hangup />
</Response>
```

### Status Codes

| Code | Description                                                                 |
|------|-----------------------------------------------------------------------------|
| 200  | XML response returned for Call Control.                                     |
| 404  | Path not found.                                                             |
| 500  | Internal server error (generic message; details logged server-side).        |

---

## Scheduled Task: `followUpCall`

Triggered automatically by `this.schedule(7 * 24 * 3600, "followUpCall", { phone })` — one week (604 800 seconds) after a planner's second inquiry, if they have not become active again.

### Payload

| Field   | Type   | Description                                           |
|---------|--------|-------------------------------------------------------|
| `phone` | string | The planner's phone number (E.164 format).            |

### Behavior

1. Loads the planner's persisted `PlannerState` from the actor's durable storage.
2. Checks `lastActive` — if the planner has been active within the last 7 days, the follow-up is skipped.
3. In **demo mode** (`DEMO_MODE=true`): logs the intended outbound call message with a masked phone number.
4. In **live mode**: places an outbound voice call via `this.env.TELNYX.calls.create()` to the planner's number from `FROM_NUMBER`.

### Example Log (Demo Mode)

```
[DEMO] Would place outbound call to +15***67: Hi there! This is a friendly follow-up from your venue sales concierge. We noticed you were interested in booking a site visit. Would you like to schedule one now?
```

### Status Codes

This is an internal scheduled task — no HTTP response is returned to the caller. Errors are logged server-side.

---

## Environment Variables

| Variable       | Required | Description                                                                 |
|----------------|----------|-----------------------------------------------------------------------------|
| `TELNYX_API_KEY` | Yes      | Telnyx API key (injected as a secret binding).                              |
| `DEMO_MODE`    | No       | Set to `"true"` to enable demo mode (default). No real SMS/calls are made.  |
| `FROM_NUMBER`  | Yes      | The venue's Telnyx phone number (E.164 format) used as the sender/caller ID.|
| `VENUE_EMAIL`  | Yes      | The venue's email address for brochure delivery.                            |

> All variables are configured via `telnyx.toml` bindings and `.env.example`. No credentials are hardcoded.
