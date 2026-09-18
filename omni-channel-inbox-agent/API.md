# API Reference — Omni-Channel Inbox Agent

All `/api/*` routes require no auth in demo mode (`DEMO_MODE=true`). Webhook routes verify Ed25519 signatures when `DEMO_MODE=false`.

## Inbox

### `GET /api/conversations`

Query: `channel` (voice|email|sms|fax|rcs|whatsapp), `status` (open|awaiting_human|closed), `limit`, `offset`.

Response: `{ conversations: [{ conversation: ConversationRow, last_message_preview, last_message_at, unread }] }`

### `GET /api/messages?conversation_id=&customer_id=`

Response: `{ messages: [{ message: MessageRow, sender_label }] }`

### `POST /api/reply`

Body: `{ conversation_id, customer_id, text, operator_id }`

Sends an operator reply on the conversation's channel (voice → TTS on the live call, email → Telnyx Email API, sms → Messaging API).

## Drafts (human-in-the-loop)

### `POST /api/draft/edit`

Body: `{ message_id, body, customer_id }` — edits an AI draft before approval.

### `POST /api/draft/approve`

Body: `{ message_id, customer_id, to?, subject? }`

Approves the draft and sends it on the draft's channel. Voice drafts speak via TTS on the live call; email drafts send via the Telnyx Email API with the tracking pixel and click-rewritten portal links; SMS drafts send via the Messaging API.

## Lab documents (fax intake)

### `POST /api/document/accept`

Body: `{ document_id, customer_id }`

Accepts the document and deletes the original fax from Telnyx (`DELETE /v2/faxes/{fax_id}`). Retains only the document UUID, reference, and status.

### `POST /api/document/reject`

Body: `{ document_id, customer_id }` — rejects and deletes the fax.

### `GET /api/document/download?document_id=&customer_id=`

Downloads the fax PDF. Returns `410` after acceptance (the fax is deleted).

### `GET` | `POST` `/api/document/set-patient-email`

Reads/writes the patient email on file for the document.

## Appointments

### `POST /api/appointment/book`

Body: `{ patient_phone?, patient_name?, patient_email?, appointment_time?, location?, floor?, send_sms? }`

Books the appointment and sends an SMS confirmation (date computed dynamically when omitted; the floor is deliberately excluded — the patient can ask).

### `POST` | `GET` `/api/appointment/complete` | `/api/appointments`

Marks the latest appointment complete (sends the follow-up SMS) / lists appointments.

### `GET /api/patient-record?patient_phone=`

Returns the actor's memory: `{ record: { patient_id, patient_email, appointment, lab_documents } }`.

## Email tracking

### `GET /email/open/{customerId}/{documentId}`

Self-hosted open-tracking pixel. Returns a 1x1 GIF and records the open on the document.

### `GET /email/click/{customerId}/{documentId}`

Click-tracking redirect: records the click and 302-redirects to the patient portal page.

### `GET /api/email/insights`

Aggregates outbound emails across actors: `{ totals: { sent, delivered, opened, tracked }, rates: { open_rate }, messages: [...] }`. Delivered comes from Telnyx message events; opened comes from the self-hosted pixel (Telnyx open tracking is domain-gated).

## Demo

### `POST /api/demo/simulate-fax`

Simulates an inbound lab fax — creates the document and conversation on the demo patient's actor.

### `POST /api/demo/reset`

Sweeps all demo state (conversations, messages, documents, appointments) on every registered actor.

## Webhooks

| Path | Events | Notes |
|------|--------|-------|
| `POST /webhooks/voice` | `call.initiated`, `call.answered`, `call.speak.ended`, `call.transcription`, `call.hangup` | Answer → greeting → transcribe → AI draft → TTS reply |
| `POST /webhooks/fax` | `fax.ended` | Status `received` → store document + conversation |
| `POST /webhooks/email` | `email.received` | Store inbound reply, draft a response |
| `POST /webhooks/messaging` | `message.received` | Store inbound SMS + rule-based auto-reply (floor, directions, status, appointment) |
