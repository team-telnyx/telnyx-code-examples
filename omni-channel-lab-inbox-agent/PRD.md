# PRD: Lab Result Intake Agent — Omni-Channel Inbox

## Document Control

- Owner: Telnyx DevRel
- Linear: [DEV-978 — Build omni-channel agent demo (inbox across voice, SMS, RCS, WhatsApp, email)](https://linear.app/telnyx/issue/DEV-978/build-omni-channel-agent-demo-inbox-across-voice-sms-rcs-whatsapp)
- Reviewer: Stephen Malito
- Status: Draft — pivoted to lab-result fax intake workflow
- Created: 2026-08-26
- Updated: 2026-08-28
- Target build: TypeScript on Telnyx Edge Compute (Agent SDK + Stateful Actor)
- Source account: dedicated Telnyx account (org id in provisioner notes)

## 1. Summary

A stateful AI agent on Telnyx Edge Compute that manages a **lab result document intake workflow** across fax, email, SMS, and voice. Lab result PDFs arrive by fax. A human operator reviews the document in a unified inbox UI, clicks Accept, and the system deletes the original fax from Telnyx while retaining a UUID, reference, and status. The AI then drafts follow-up communications (confirmation emails, SMS status replies, voice call context) from the approved metadata — no PHI is stored after the fax is deleted.

## 2. Personas

| Persona | Role in the workflow |
|---|---|
| **Hospital Lab** | Sends the finalized lab result PDF by fax into the hospital intake number. |
| **Human Operator / Intake Staff** | The person using the centralized inbox. Reviews the incoming fax, downloads the PDF, decides whether it is acceptable, clicks Accept, approves/sends the drafted email, and takes over when needed. |
| **Patient / Customer** | Receives the confirmation email/SMS and later asks, "Was my lab document received?" They do not interact with the fax directly in the demo. |
| **AI Intake Agent** | Coordinates the workflow after the human-approved step. Does **not** interpret lab values. Drafts safe confirmation text, answers status questions, and uses the case reference/status during SMS or voice follow-up. |
| **Voice Agent** | Handles a phone call from the patient/customer. Answers non-clinical questions like receipt/status/reference number. If the caller asks anything clinical, it escalates to the human operator. |
| **Centralized Inbox** | The operator UI. Shows all cases and all channel activity in one place: fax received, human review, fax deleted, email sent, SMS received, voice call handled. |
| **Stateful Actor / Backend** | The durable case memory. Stores safe workflow state only: case ID, fax UUID/reference, status, timestamps, `deleted_at`, channel history. Does **not** store lab result content after Accept. |
| **Demo Presenter** | Narrates and operates the demo as the human operator — shows the inbox, clicks Download/Accept, approves the email, triggers the SMS/voice follow-up, and explains the safety boundary. |

### Safety boundary

The AI never reads or interprets lab values. It only knows: a document arrived, its case reference, and its workflow status. The human operator is the only persona that sees the PDF content. After Accept, the fax PDF is deleted from Telnyx — only safe metadata survives.

## 3. Workflow

```
  1. Lab result PDF arrives by fax
         │
         ▼
  2. Inbox notifies a human operator
     (new conversation appears, channel: fax, status: awaiting_review)
         │
         ▼
  3. Human downloads + reviews the PDF
     (click link → opens PDF from Telnyx fax storage)
         │
         ▼
  4. Human clicks Accept
     (status → accepted; fax deleted from Telnyx; UUID + reference + status retained)
         │
         ▼
  5. AI drafts follow-up from approved metadata:
     ├── Drafts confirmation email: "Your lab document was received"
     ├── Answers SMS status questions: "Was my document received?"
     └── Supports a later voice call using case reference + workflow state
```

## 4. Architecture

```
  Fax → Telnyx Fax API → /webhooks/fax → InboxAgent (per-customer actor)
                                                    │
                                                    ▼
                                         ┌──────────────────────┐
                                         │  ctx.storage.sql     │
                                         │  ├── documents       │
                                         │  │   (uuid, fax_id,  │
                                         │  │    reference,     │
                                         │  │    status,        │
                                         │  │    metadata)      │
                                         │  ├── conversations   │
                                         │  └── messages        │
                                         └──────────────────────┘
                                                    │
                     ┌──────────────────────────────┼──────────────────────────────┐
                     ▼                              ▼                              ▼
               Admin UI                      Email follow-up                Voice / SMS
          (inbox + review)              (AI-drafted, human-approved)     (AI uses case ref)
```

### Components

| Component | Technology | Role |
|---|---|---|
| Stateful actor | Telnyx Edge Compute + Agent SDK | Per-customer durable state (document records, conversations, messages) |
| Fax inbound | Telnyx Fax API → webhook | Receives lab result PDFs, stores metadata, notifies operator |
| Admin UI | Served from `GET /` | Unified inbox — operator reviews faxes, clicks Accept, approves AI-drafted follow-ups |
| Email follow-up | Telnyx Email API (`POST /v2/email_messages`) | AI drafts confirmation email from approved metadata; operator reviews + sends |
| SMS status | Telnyx Messaging API (v2 — gated on 10DLC) | AI answers "was my document received?" using the document record |
| Voice context | Telnyx Call Control + AI Assistant | Caller asks about their case; AI uses case reference + workflow state for context |
| PDF storage | Telnyx Fax API (temporary) → deleted on Accept | Original fax deleted; only UUID + reference + status retained |

## 5. Data Model

### `documents` table (per-actor SQLite)

```sql
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,           -- internal UUID (survives fax deletion)
  fax_id        TEXT,                       -- Telnyx fax id (null after deletion)
  reference     TEXT NOT NULL,              -- human-readable case reference (e.g. LAB-2026-0828-001)
  status        TEXT NOT NULL DEFAULT 'received',  -- received → reviewed → accepted → followed_up
  fax_url       TEXT,                       -- temporary fax download URL (null after deletion)
  file_name     TEXT,                       -- original fax file name
  from_number   TEXT,                       -- fax sender number
  to_number     TEXT,                       -- fax receiving number
  received_at   INTEGER NOT NULL,           -- unix ms
  reviewed_at   INTEGER,                   -- when operator opened the PDF
  accepted_at   INTEGER,                    -- when operator clicked Accept
  deleted_at    INTEGER,                    -- when fax was deleted from Telnyx
  metadata      TEXT,                       -- JSON: extracted info (patient name, doc type, etc.)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

### `conversations` and `messages` tables

Same as the existing inbox schema — channel-typed, with `documents.id` as a foreign key reference in the conversation's metadata so email/SMS/voice follow-ups are linked to the original fax intake.

## 6. Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-1 | Receive fax webhook | Must | `POST /webhooks/fax` receives Telnyx fax webhook (`fax.received`), stores document record with UUID + reference + status='received', stores fax_url for PDF download. |
| FR-2 | Notify operator in inbox | Must | New conversation appears in admin UI with channel='fax', status='awaiting_review', document reference visible. |
| FR-3 | Operator downloads PDF | Must | Admin UI shows a download link for the fax PDF. Clicking opens the PDF from Telnyx fax storage. |
| FR-4 | Operator clicks Accept | Must | `POST /api/document/accept` flips status to 'accepted', records `accepted_at`, deletes the original fax from Telnyx (`DELETE /v2/faxes/{fax_id}`), nulls `fax_id` and `fax_url`, retains UUID + reference + status. |
| FR-5 | AI drafts confirmation email | Must | After Accept, AI drafts an email: "Your lab document was received. Reference: LAB-2026-0828-001." Stored as `status='draft'` for operator review. |
| FR-6 | Operator reviews + sends email | Must | Operator sees the draft in the admin UI, can edit, clicks Send. Email sent via `POST /v2/email_messages` from the verified domain. |
| FR-7 | AI answers SMS status questions | Should | When a customer texts "Was my document received?", the AI checks the document record and replies with status + reference. (Gated on 10DLC registration — v2.) |
| FR-8 | AI supports voice call with case reference | Should | When a customer calls and mentions their case reference, the AI looks up the document record and provides status. |
| FR-9 | Fax deletion | Must | On Accept, the system calls `DELETE /v2/faxes/{fax_id}` to remove the original fax from Telnyx. The document record retains only UUID, reference, and status — no fax content. |
| FR-10 | Webhook signature verification | Must | All inbound webhooks (fax, email, voice, SMS) verify the Telnyx Ed25519 signature. |
| FR-11 | Raw DB viewer | Should | `GET /db` page shows raw `documents`, `conversations`, and `messages` tables for debugging. |

## 7. Admin UI

### Inbox view

```
┌──────────────────────────────────────────────────────────────────────┐
│  Telnyx Lab Result Inbox                                    DB viewer →│
├──────────────────────────────┬───────────────────────────────────────┤
│  Documents / Conversations    │  Document: LAB-2026-0828-001          │
│  ─────────────────────       │  Status: awaiting_review              │
│  ▸ LAB-2026-0828-001  fax ●   │  Received: Aug 28, 2026 2:15 PM       │
│    awaiting_review            │  From: +15551234567                   │
│  ▸ LAB-2026-0828-002  fax ◐   │  ───────────────────────────────────  │
│    accepted                   │  [Download PDF]  [Accept]  [Reject]  │
│                               │  ───────────────────────────────────  │
│                               │  Draft email: "Your lab document was  │
│                               │  received. Reference: LAB-..."       │
│                               │  [Edit] [Approve & send]              │
└──────────────────────────────┴───────────────────────────────────────┘
```

### Actions

- **Download PDF** — opens the fax PDF from Telnyx storage (link is valid until the fax is deleted on Accept)
- **Accept** — deletes the fax from Telnyx, retains UUID + reference + status, triggers AI to draft a confirmation email
- **Reject** — marks status as 'rejected', no email drafted, fax still deleted
- **Edit draft** — operator edits the AI-drafted email before sending
- **Approve & send** — sends the email via `POST /v2/email_messages`

## 8. Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `TELNYX_API_KEY` | Yes (secret) | Fax API (receive, delete), Email API (send), Call Control (answer, speak, transcribe) |
| `TELNYX_PUBLIC_KEY` | Yes (secret) | Webhook signature verification (Ed25519) |
| `FROM_NUMBER` | Yes | Telnyx phone number for voice calls |
| `FAX_NUMBER` | Yes | Telnyx fax number for receiving lab results |
| `TEXML_APP_ID` | Yes | Call Control Application id |
| `VOICE_ASSISTANT_ID` | Yes | AI Assistant persona for voice |
| `EMAIL_FROM` | Yes | Verified sending address (e.g. `omni-agent@inbox.telnyx.com`) |
| `EMAIL_DOMAIN_ID` | Yes | Telnyx email domain id (for webhook registration) |
| `EMAIL_INBOX_ID` | Yes | Telnyx email inbox id (for replies) |
| `AI_MODEL` | No | Inference model (default: `zai-org/GLM-5.2`) |
| `TTS_VOICE` | No | TTS voice (default: `Telnyx.KokoroTTS.af`) |
| `DEMO_MODE` | No | `true` skips webhook signature verification (local dev) |

## 9. Build Milestones

### Phase 1 — Fax intake (current priority)

1. Add `documents` table to the actor's SQLite schema.
2. Add `POST /webhooks/fax` handler — receives `fax.received`, stores document record, creates conversation.
3. Add `GET /api/documents` — list all documents with status.
4. Add `POST /api/document/accept` — flip status, delete fax from Telnyx, trigger AI email draft.
5. Add `POST /api/document/reject` — flip status, delete fax.
6. Update admin UI — show documents in the inbox, download link, Accept/Reject buttons.
7. Provision a Telnyx fax number and wire the fax webhook.

### Phase 2 — Email follow-up

1. After Accept, AI drafts a confirmation email from the document metadata (reference, received date).
2. Operator reviews in admin UI, edits if needed, clicks Send.
3. Email sent via `POST /v2/email_messages` from the verified domain.
4. Inbound email replies trigger `email.received` webhook → AI drafts a response using the case reference.

### Phase 3 — Voice + SMS follow-up

1. Voice: caller mentions case reference → AI looks up document record → provides status.
2. SMS: customer texts "Was my document received?" → AI checks document record → replies with status + reference. (Gated on 10DLC.)

### Phase 4 — Demo readiness

1. End-to-end demo script: fax in → review → accept → email out.
2. DB viewer showing the document lifecycle.
3. Demo data seed for a clean inbox.

## 10. Key Design Decisions

1. **Fax is deleted on Accept.** The original fax PDF is removed from Telnyx storage immediately when the operator clicks Accept. Only the UUID, reference number, and status are retained. This is a privacy-by-design choice — no document content persists after human review.

2. **Reference is human-readable.** Format: `LAB-YYYY-MMDD-NNN` (e.g. `LAB-2026-0828-001`). Generated from the date + a daily counter. Used in all follow-up communications so the customer can reference their case.

3. **AI drafts from metadata, not content.** The AI never sees the lab result PDF content. It only knows the document was received, the reference number, and the workflow status. This is intentional — the AI's follow-up communications are safe by construction.

4. **Per-customer actor.** The actor is keyed by the fax sender's number (or the patient's email/phone if known). All document records and conversations for that customer live in one durable actor instance.

5. **Email via Telnyx Email API (not AgentMail).** Outbound via `POST /v2/email_messages` from a verified custom domain (`inbox.telnyx.com`). Inbound via `email.received` webhook (Ed25519-signed, same verification as voice/fax webhooks). No AgentMail.

## 11. Acceptance Criteria

- [ ] Fax webhook receives lab result PDFs and stores document records
- [ ] Admin UI shows incoming faxes with status `awaiting_review`
- [ ] Operator can download the PDF from the admin UI
- [ ] Operator clicks Accept → fax deleted from Telnyx, UUID + reference + status retained
- [ ] AI drafts a confirmation email from the document metadata
- [ ] Operator reviews, edits, and sends the email
- [ ] Customer receives the email with their case reference
- [ ] Voice call with case reference → AI provides document status
- [ ] SMS status query → AI replies with document status (v2, gated on 10DLC)
- [ ] No fax content stored after Accept
- [ ] DB viewer shows the document lifecycle

## 12. Out of Scope

- OCR or content extraction from the lab result PDF
- Storing the actual lab result content after fax deletion
- SMS/RCS/WhatsApp send (gated on compliance registrations)
- Cross-customer analytics
- Production operator authentication

## 13. References

- Linear DEV-978: https://linear.app/telnyx/issue/DEV-978/build-omni-channel-agent-demo-inbox-across-voice-sms-rcs-whatsapp
- Telnyx Fax API: https://developers.telnyx.com/docs/fax
- Telnyx Email API: https://developers.telnyx.com/docs/messaging/email/overview
- Telnyx Call Control: https://developers.telnyx.com/docs/voice/call-control
- Telnyx Agent SDK: https://developers.telnyx.com/docs/agent-sdk
- Telnyx Edge Compute: https://developers.telnyx.com/docs/edge-compute
