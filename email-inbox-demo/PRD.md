# PRD: Email Inbox Demo — TRUST-286

## Document Control

- Owner: Telnyx DevRel
- Linear: [TRUST-286 — Email Inbox Demo](https://linear.app/telnyx/issue/TRUST-286/email-inbox-demo)
- Reviewer: Stephen Malito
- Status: Built — pending review
- Created: 2026-09-10
- Target build: TypeScript on local Node.js (Express + better-sqlite3 + vanilla HTML)

## 1. Summary

A focused web demo of the **inbound** side of the Telnyx Email API. Create inboxes on verified domains with `inbound_enabled`, receive `email.received` webhooks (Ed25519-signed), list and read messages in a three-pane inbox UI. Live updates over Server-Sent Events. The recording target for the TRUST team's YouTube demo (TRUST-286).

This is a sub-feature of the broader Email API release (August 28 2026 GA) and a focused, standalone companion to the `omni-channel-lab-inbox-agent` demo, which mixes email with fax / voice / SMS / appointments.

## 2. Personas

| Persona | Role |
|---|---|
| **Demo viewer** (YouTube audience) | Watches the presenter click around — adds an inbox, sees inbound arrive live, opens a message, archives it |
| **Presenter (Harpreet)** | Records the demo against the running app; flips to "recording view" for a clean screen capture |
| **Real user** (post-demo) | Clones the repo, runs `npm start` in DEMO_MODE in under a minute, explores the UI without needing a Telnyx account |

## 3. User-visible flow

1. Open `http://localhost:8788` — dashboard renders with a seeded demo inbox
2. Toggle **Recording view** (top right) — type enlarges, debug controls hide, demo banner shows
3. Click **Trigger inbound** — a realistic email arrives: Stripe receipt, GitHub 2FA code, meeting notes — randomized; the message list updates live, the reader opens automatically
4. Click another message — reader renders the HTML body in a sandboxed iframe with a plain-text toggle; Archive / Delete buttons appear; the message is marked as read
5. Click **+ Add inbox** — create a new inbox (DEMO_MODE creates a synthetic one locally; live mode calls `POST /v2/email_inboxes`)
6. Click into the new inbox — independent message list; the sidebar shows unread badges updating live

## 4. Architecture

```
  External sender                    Telnyx Email API                  Dashboard (Express)
        │                                  │                                  │
        │ SMTP → MX                        │                                  │
        ▼                                  │                                  │
   ┌──────────────────┐                    │                                  │
   │ Telnyx inbound   │                    │                                  │
   │ (verified domain)│                    │                                  │
   └────────┬─────────┘                    │                                  │
            │ email.received webhook       │                                  │
            ▼                              │                                  │
   ┌──────────────────────────────┐ POST /webhooks/email                  │
   │ Local Express server         │ ─────────────────────▶ ┌────────────┐ │
   │ • verify Ed25519 signature  │                          │ SQLite     │ │
   │ • extract message_id        │                          │ cache      │ │
   │ • store in local SQLite     │ ◀─── SSE events ────── │ + events   │ │
   │ • append to event timeline  │                          └─────┬──────┘ │
   └──────────────────────────────┘                                │       │
                                                                   ▼       │
                                                            ┌──────────────┐
                                                            │ 3-pane HTML  │
                                                            │ dashboard    │
                                                            │ + recording  │
                                                            │ view         │
                                                            └──────────────┘
```

### Components

| Component | Technology | Role |
|---|---|---|
| Web server | Express on Node 22+ | Routes, SSE bus, webhook receiver |
| Cache | better-sqlite3 | Local store of inboxes, messages, events |
| Telnyx SDK | `telnyx` Node v7.20+ | `POST /v2/email_inboxes` (live mode) |
| Webhook verify | `tweetnacl` | Ed25519 over `telnyx-signature-ed25519` + `telnyx-timestamp` |
| Dashboard | Self-contained HTML/CSS/JS | 3-pane inbox UI; SSE for live updates |
| Demo seeder | Background interval | Synthesizes realistic inbound for DEMO_MODE |

## 5. Data Model

```sql
CREATE TABLE inboxes (
  id              TEXT PRIMARY KEY,
  email_address   TEXT NOT NULL UNIQUE,
  display_name    TEXT,
  domain_id       TEXT NOT NULL,
  inbound_enabled INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  source          TEXT NOT NULL DEFAULT 'demo',  -- 'demo' | 'telnyx'
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE messages (
  id               TEXT PRIMARY KEY,
  inbox_id         TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  telnyx_id        TEXT,
  thread_id        TEXT,
  from_address     TEXT NOT NULL,
  from_name        TEXT,
  to_addresses     TEXT NOT NULL,
  cc_addresses     TEXT,
  subject          TEXT,
  preview          TEXT,
  body_html        TEXT,
  body_text        TEXT,
  headers_json     TEXT,
  attachments_json TEXT,
  status           TEXT NOT NULL DEFAULT 'received',  -- 'received' | 'read' | 'archived' | 'deleted'
  received_at      INTEGER NOT NULL,
  read_at          INTEGER
);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  inbox_id   TEXT NOT NULL,
  message_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  detail     TEXT,
  ts         INTEGER NOT NULL
);
```

## 6. Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-1 | List inboxes | Must | `GET /api/inboxes` returns the inbox list with unread counts |
| FR-2 | Create inbox (live) | Must | `POST /api/inboxes` with credentials calls `POST /v2/email_inboxes` with `inbound_enabled: true`; returns the new row |
| FR-3 | Create inbox (demo) | Must | `POST /api/inboxes` without credentials creates a synthetic inbox locally |
| FR-4 | List messages | Must | `GET /api/inboxes/:id/messages?status=received` returns message list, newest first |
| FR-5 | Retrieve message | Must | `GET /api/messages/:id` returns full row including HTML + text bodies and headers |
| FR-6 | Mark read | Must | `POST /api/messages/:id/read` flips status and sets `read_at`; SSE broadcast |
| FR-7 | Archive | Should | `POST /api/messages/:id/archive` flips status; SSE broadcast |
| FR-8 | Delete (soft) | Should | `POST /api/messages/:id/delete` flips status; SSE broadcast |
| FR-9 | Live webhook receiver | Must | `POST /webhooks/email` verifies Ed25519 signature, extracts payload, stores message, broadcasts SSE |
| FR-10 | DEMO_MODE seeder | Must | Background timer injects one realistic inbound every `DEMO_SEED_INTERVAL_MS` (default 15s) into one of the demo inboxes |
| FR-11 | Manual trigger | Should | `POST /api/demo/trigger` with `{inbox_id}` injects one inbound on demand (debug button) |
| FR-12 | SSE event bus | Must | `GET /api/events` streams `inbox_created`, `message_received`, `message_status` events to connected dashboards |
| FR-13 | Recording view | Should | `body.recording` class enlarges type, hides debug controls, shows demo banner; toggled by top-bar button |
| FR-14 | Ed25519 verify | Must | All `email.received` webhooks in live mode verify against `TELNYX_PUBLIC_KEY`; bypass only in DEMO_MODE for the manual trigger |

## 7. Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Dashboard HTML |
| `GET` | `/health` | Liveness |
| `GET` | `/api/inboxes` | List inboxes |
| `POST` | `/api/inboxes` | Create inbox (live or demo) |
| `DELETE` | `/api/inboxes/:id` | Delete inbox + cascade messages |
| `GET` | `/api/inboxes/:id/messages?status=...` | List messages |
| `GET` | `/api/messages/:id` | Single message |
| `POST` | `/api/messages/:id/read` | Mark read |
| `POST` | `/api/messages/:id/archive` | Archive |
| `POST` | `/api/messages/:id/delete` | Soft-delete |
| `GET` | `/api/events` | SSE stream |
| `POST` | `/webhooks/email` | Telnyx `email.received` receiver (Ed25519) |
| `POST` | `/api/demo/trigger` | DEMO_MODE only — inject one synthetic inbound |

## 8. Environment Variables

See README.md "Environment Variables" section.

## 9. Acceptance Criteria

- [x] DEMO_MODE runs end-to-end with no Telnyx credentials
- [x] Dashboard renders at `http://localhost:8788`
- [x] DEMO seeder injects realistic inbound on a timer
- [x] Trigger button injects one inbound on demand
- [x] Creating a new inbox adds it to the sidebar live (SSE)
- [x] Clicking a message opens the reader, marks it read, renders HTML + text bodies
- [x] Ed25519 signature verification accepts valid signatures, rejects tampered bodies and stale timestamps
- [x] 5 smoke tests pass (`npm test`)
- [x] `npm run typecheck` and `npm run build` pass clean
- [x] Recording view enlarges type and hides debug controls

## 10. Out of Scope

- Sending outbound email (covered by `ai-email-agent-python`, `POST /v2/email_messages`)
- AI-drafted replies (covered by `ai-email-agent-python`)
- Cross-channel inbox (covered by `omni-channel-lab-inbox-agent`)
- Production operator authentication
- Threading / conversation grouping beyond simple `thread_id` column
- Attachments download (UI shows attachments list; download is a v2 follow-on)
- Templates / Liquid rendering (send-side only)

## 11. References

- Linear TRUST-286: https://linear.app/telnyx/issue/TRUST-286/email-inbox-demo
- Email API GA release notes: https://telnyx.com/release-notes/email-api-now-generally-available
- Email API quickstart: https://developers.telnyx.com/docs/messaging/email/quickstart
- Email API API reference: https://developers.telnyx.com/api-reference/email-messages/create-or-send-an-email-message
- omni-channel-lab-inbox-agent: https://github.com/team-telnyx/telnyx-code-examples/tree/main/omni-channel-lab-inbox-agent
