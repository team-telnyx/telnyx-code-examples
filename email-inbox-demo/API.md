# API Reference — Email Inbox Demo

Base URL for local development: `http://127.0.0.1:8788`. All routes are JSON unless stated otherwise. The webhook route accepts JSON without authentication — it verifies Telnyx's Ed25519 signature instead.

| Method | Path | Auth | Response |
|---|---|---|---|
| `GET` | `/` | none | `text/html; charset=utf-8` dashboard shell |
| `GET` | `/health` | none | `{ok, demoMode, hasTelnyxCreds, inboxes}` |
| `GET` | `/api/inboxes` | none | `InboxRow[]` — newest first |
| `POST` | `/api/inboxes` | none | `InboxRow` (creates in DEMO_MODE locally, or via Telnyx in live mode) |
| `DELETE` | `/api/inboxes/:id` | none | `204 No Content` — cascades to messages |
| `GET` | `/api/inboxes/:id/messages` | none | `MessageRow[]` — newest first; optional `?status=received\|read\|archived\|deleted` |
| `GET` | `/api/messages/:id` | none | `MessageRow` — includes `body_html`, `body_text`, `headers_json`, `attachments_json` |
| `POST` | `/api/messages/:id/read` | none | `{ok: true}` — flips status, sets `read_at`, broadcasts SSE |
| `POST` | `/api/messages/:id/archive` | none | `{ok: true}` — flips status, broadcasts SSE |
| `POST` | `/api/messages/:id/delete` | none | `{ok: true}` — soft-delete, broadcasts SSE |
| `GET` | `/api/events` | none | `text/event-stream` — SSE bus (see below) |
| `POST` | `/webhooks/email` | Ed25519 | `202 {ok, id}` — accepts Telnyx `email.received` |
| `POST` | `/api/demo/trigger` | none | `{ok, id}` — DEMO_MODE only; inject one synthetic inbound |

## SSE Events

```
event: hello
data: {"id":"<client-id>","demoMode":true}

event: inbox_created
data: {"inbox": {...InboxRow}}

event: message_received
data: {"id":"msg_...","inbox_id":"inbox_...","from_address":"...","from_name":"...","subject":"..."}

event: message_status
data: {"id":"msg_...","status":"read|archived|deleted"}
```

## Webhook payload (Telnyx → app)

Telnyx posts `email.received` to `/webhooks/email`. The handler reads:

```jsonc
{
  "data": {
    "event_type": "email.received",
    "id": "evt_...",
    "occurred_at": "2026-09-10T...",
    "payload": {
      "message_id": "msg_...",
      "inbox_id": "inb_...",
      "from":     { "email": "alice@example.com", "name": "Alice" },
      "to":       [{ "email": "bob@example.com",  "name": null }],
      "cc":       [],
      "subject":  "...",
      "text":     "...",
      "html":     "<p>...</p>",
      "headers":  { "from": "...", "subject": "...", ... },
      "attachments": [{ "id": "...", "filename": "...", "content_type": "...", "size": 1234 }],
      "thread_id": "t_..."
    }
  }
}
```

Headers required by the webhook route:

| Header | Description |
|---|---|
| `telnyx-signature-ed25519` | Hex-encoded Ed25519 signature of `<timestamp>.<rawBody>` |
| `telnyx-timestamp` | Unix seconds; rejected if outside ±300s tolerance |

In `DEMO_MODE=true`, signature verification is bypassed so the `POST /api/demo/trigger` and unsigned local tests work.

## Row types

```ts
type InboxRow = {
  id: string;
  email_address: string;
  display_name: string | null;
  domain_id: string;
  inbound_enabled: 0 | 1;
  status: string;
  source: "demo" | "telnyx";
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: string;
  inbox_id: string;
  telnyx_id: string | null;
  thread_id: string | null;
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  cc_addresses: string | null;
  subject: string | null;
  preview: string | null;
  body_html: string | null;
  body_text: string | null;
  headers_json: string | null;
  attachments_json: string | null;
  status: "received" | "read" | "archived" | "deleted";
  received_at: number;
  read_at: number | null;
};
```

## Error responses

```jsonc
// 400
{ "error": "username and domain are required" }
{ "error": "missing inbox_id in payload" }

// 401 (live mode only)
{ "error": "invalid signature", "reason": "stale_timestamp" | "bad_signature" | "missing_header" | "no_public_key" }

// 403 (live mode only)
{ "error": "demo mode disabled" }

// 404
{ "error": "not found" }
{ "error": "unknown inbox" }

// 502 (live mode only)
{ "error": "<Telnyx API error message>" }
```
