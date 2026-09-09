# API Reference

All `/api/*` routes are served by the deployed Edge function. Webhook routes are Ed25519-verified with the Telnyx public key when `DEMO_MODE=false`.

## Health

### `GET /health`

```json
{
  "status": "ok",
  "channels": ["voice", "email"],
  "from_number": "+15550001111",
  "voice_assistant_id": "assistant-...",
  "email_inbox": "set"
}
```

### `GET /health/liveness`, `GET /health/readiness`

Returns `200 ok`.

## Admin UI

### `GET /`

Serves the combined inbox UI (Lab Documents + Conversations + thread view).

### `GET /db`

Raw SQLite table viewer. Pick a `customer_id` (actor name), table (`conversations` | `messages` | `documents` | `appointments` | `customers`), and optional `conversation_id` filter.

## Webhooks

### `POST /webhooks/voice`

Telnyx Call Control events: `call.initiated` (answer + actor bind), `call.answered` (greeting TTS), `call.speak.ended` (start transcription), `call.transcription` (final → store inbound + AI draft → speak reply), `call.hangup` (close conversation).

### `POST /webhooks/fax`

Telnyx Fax events. On `fax.ended` with `status=received`: fetches `GET /v2/faxes/{id}` for the signed media URL, generates a case reference (`LAB-YYYYMMDD-NNN`), stores a document + conversation, registers the customer.

Response:

```json
{
  "action": "fax_stored",
  "document_id": "doc_...",
  "reference": "LAB-20260901-472"
}
```

### `POST /webhooks/messaging`

Inbound `message.received` → stores the SMS on the patient's actor, auto-replies using the patient record:

| Caller asks | Reply behavior |
|---|---|
| floor / where / directions | Floor + address from the appointment record |
| results / status / lab | Emailed date if sent; "1–3 business days" if not |
| appointment / reschedule | Time + location from the record |
| clinical question | Escalates to staff per the safety rules |

### `POST /webhooks/email`

Telnyx Email API `email.received` → stores the inbound email on the case, drafts an AI reply (threading headers preserved).

## Lab Documents

### `GET /api/documents`

Returns all documents across registered customer actors, newest first.

### `POST /api/document/accept`

```json
{ "document_id": "doc_...", "customer_id": "15550001111" }
```

Accepts the document: calls `DELETE /v2/faxes/{fax_id}` (real faxes), nulls `fax_id`/`fax_url`, sets `deleted_at`. The PDF is unrecoverable afterward — subsequent downloads return `410 Gone`.

### `POST /api/document/reject`

Same as accept but sets status `rejected`; no confirmation email is drafted.

### `GET /api/document/download?document_id=...&customer_id=...`

Returns `302` to a fresh-signed fax media URL (real faxes: refresh action + re-fetch; simulated docs: hosted sample PDF). First download flips status `received` → `reviewed`. Returns `410` once accepted/rejected.

### `POST /api/document/mark-opened`

Records `opened_at` on the document (real via webhooks on a custom domain; demo button).

### `POST /api/document/set-patient-email`

Stores the patient email on the case:

```json
{ "document_id": "doc_...", "customer_id": "...", "email": "patient@example.com" }
```

### `GET /api/document/patient-email?conversation_id=...&customer_id=...`

Returns `{ "email": "patient@example.com", "demo_default": "patient@example.com" }`.

## Drafts & Sending

### `POST /api/document/draft-email`

AI-drafts a confirmation email from metadata only (reference + received date — never lab content). Stored as `status='draft'`.

### `POST /api/draft/edit`

```json
{ "message_id": "msg_...", "body": "edited text", "customer_id": "..." }
```

### `POST /api/draft/approve`

```json
{ "message_id": "msg_...", "customer_id": "...", "to": "patient@example.com" }
```

Sends on the message's channel (voice TTS / Telnyx Email API), marks it `sent`, records `email_sent_at` + `emailed_to` on the linked document.

### `GET /api/email-events?message_id=<telnyx-email-id>`

Proxies Telnyx per-message events: `queued`, `sending`, `sent`, `delivered`, `opened`, `clicked`, `bounced`, `failed`.

## Appointments

### `POST /api/appointment/book`

All fields optional in demo mode (defaults from `DEMO_PATIENT_*` env vars):

```json
{
  "patient_phone": "+15551234567",
  "patient_name": "Jane",
  "appointment_time": "Friday, Sep 5 at 10:00 AM",
  "location": "500 University Ave, San Francisco",
  "floor": "Floor 2"
}
```

Books the appointment and sends the confirmation SMS.

### `POST /api/appointment/complete`

Marks the latest appointment `completed` and sends: *"Thanks for coming in today! Your visit is all set — lab results will land in your email within 1–3 business days."*

### `GET /api/appointments?patient_phone=...`

Lists appointments for a patient actor.

## Patient Record

### `GET /api/patient-record?patient_phone=...`

Non-clinical state used by the voice agent and SMS auto-replier:

```json
{
  "record": {
    "patient_id": "15551234567",
    "patient_email": "patient@example.com",
    "appointment": { "status": "completed", "appointment_time": "...", "location": "..." },
    "lab_documents": [
      { "reference": "LAB-20260901-472", "status": "followed_up", "email_sent_at": 1788..., "emailed_to": "patient@example.com" }
    ]
  }
}
```

## Voice Agent Tool

### `POST /ai-assistant/lookup`

Called by the AI Assistant's `lookup_lab_document` webhook tool during a live call.

```json
{ "reference": "LAB-20260901-472" }
```

Response (found, already emailed):

```json
{
  "result": "Reference LAB-20260901-472: the lab document was received on 9/1/2026, processed, and the results were already emailed to the patient on 9/1/2026. Tell the patient their results were already sent to their email inbox — ask them to check their email, including spam. This line cannot provide the results themselves.",
  "found": true,
  "reference": "LAB-20260901-472",
  "status": "followed_up"
}
```

Tolerant matching: full reference, spoken variants ("2026 09 01 472"), or the last 3 digits all resolve. Never returns lab content.

## Demo Controls

### `POST /api/demo/simulate-fax`

Creates a document with the hosted sample PDF (no real fax required). Seeds the patient email from `DEMO_PATIENT_EMAIL`.

### `POST /api/demo/reset`

Clears appointments, documents, conversations, and messages on the patient actor.
