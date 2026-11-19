# SignalDesk API Reference

This document covers the HTTP surface of the SignalDesk MVP. All request/response shapes below are typed in the codebase; this is the human-readable contract.

## Conventions

- **Base path**: the app root (`/`).
- **Auth**: dashboard routes and mutations require an Auth.js session (password credentials). The Telnyx webhook route is the exception: it is publicly reachable and authenticated by Ed25519 webhook signatures.
- **Phone numbers**: E.164 (`+18005550123`). Numbers are masked in every server-rendered view (`+1 ••• ••• 0123`).
- **Errors**: JSON `{ error: string }` with an appropriate status; handler internals are never echoed to the client.
- **Idempotency**: every webhook event is stored under a unique idempotency key (`data.id` from Telnyx, with hash fallback). Duplicate deliveries are acked `200 {received, handled:"duplicate"}`.

## Webhook: `POST /api/webhooks/telnyx`

Receiver for Telnyx messaging events. **Never** dashboard-authenticated.

### Request

- Headers required (verified, order-agnostic):
  - `Telnyx-Signature-Ed25519`: base64 Ed25519 signature over `"{telnyx-timestamp}|{raw body}"`
  - `Telnyx-Timestamp`: unix seconds; rejected outside a ±300s window
- Body: raw JSON as sent by Telnyx (read before any parsing).

```jsonc
{
  "data": {
    "id": "0ccc7b76-4df5-4c1a-8b0c-6c1e4d9f8a01",     // event id -> idempotency key
    "event_type": "message.received",
    "payload": {
      "id": "2b1d7a01-…",                              // Telnyx message id
      "from": { "phone_number": "+18005550123" },
      "to": [{ "phone_number": "+18005550100" }],
      "text": "Severe: checkout API down for everyone…"
    }
  }
}
```

Handled `event_type` values:

| Event | Behavior |
|-------|----------|
| `message.received` | Command dispatch → incident creation / STOP / START / HELP / STATUS |
| `message.sent` | Outbound accepted by carrier; delivery state recorded as `sent` |
| `message.finalized` | Terminal delivery state: `delivered` or `failed` (+ error details) |

Anything else is acked as `handled: "ignored"`.

### Responses

| Status | Body | Meaning |
|--------|------|---------|
| `200` | `{ received: true, handled: "inbound" \| "delivery" \| "duplicate" \| "ignored" }` | Event accepted; slow work scheduled via `after()` |
| `401` | `{ error: "signature_verification_failed" }` | Missing/invalid/stale signature. No detail echoed. |
| `405` | HTML | Non-POST method |

> **Mock mode:** in `NODE_ENV=development` the route accepts `?mock=1` (dev-simulator calls) without a signature. This code path is impossible in production builds — the guard checks `NODE_ENV !== "production"`.

## Auth.js routes

`GET|POST /api/auth/[...nextauth]` — Auth.js v5 credential-provider handlers.

- `POST /api/auth/callback/credentials` with `csrfToken`, `username`, `password`.
- Sessions are JWTs (8h) stored in an httpOnly cookie.
- A single operator account is configured via `SIGNALDESK_OPERATOR_USERNAME` / `SIGNALDESK_OPERATOR_PASSWORD_HASH` (scrypt, `npm run hash-password -- "<pw>"`).
- Failure returns to `/login?error=CredentialsSignin`.

## Dashboard pages

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/login` | GET | — | Operator sign-in form |
| `/` | GET | session | Operations dashboard: severity/status counts, active incidents, all incidents (filterable), recent inbound messages, delivery-failure banner |
| `/incidents/[id]` | GET | session | Incident detail: extracted fields, original message, confidence, timeline, subscriber count, outbound delivery states, status form |
| `/dev/outbox` | GET | session + dev/mock | Outbound SMS that was mock-sent (or really sent) |
| `/dev/simulator` | GET | session + dev | Forms to simulate inbound SMS without Telnyx |

### Status change (server action)

`POST /incidents/[id]` form posts to the `updateIncidentStatus` server action (not a public API route):

```jsonc
// Form fields (application/x-www-form-urlencoded)
{
  "incidentId":   "uuid",
  "newStatus":    "IDENTIFIED" | "MONITORING" | "RESOLVED" | "INVESTIGATING",
  "operatorNote": "optional, ≤500 chars"
}
```

Behavior, in order:

1. Verifies an operator session (redirects to `/login` otherwise).
2. Validates input with Zod (status must be one of the four; note ≤500 chars).
3. Validates the transition (`isTransitionValid`); invalid transitions redirect with `error=invalid_transition`.
4. Applies the transition in a transaction: status + `resolved_at` (set on RESOLVED, cleared otherwise) + an `incident_updates` row (`previous_status` → `new_status`, note).
5. Loads **active subscribers** for the incident (active = true, not opted out) and sends each a status SMS (`outbound.status_update`), or the resolution copy when new status is `RESOLVED`. Opted-out numbers are skipped.
6. Revalidates and redirects back to the incident page (`updated=1`).

## Data model

```
incidents
  id uuid pk, number text unique, title, summary,
  severity SEV1|SEV2|SEV3|SEV4, status INVESTIGATING|IDENTIFIED|MONITORING|RESOLVED,
  affected_service, affected_region null, symptoms, suggested_next_action,
  confidence real, reporter_phone, source_message_id,
  created_at, updated_at, resolved_at null

incident_updates
  id, incident_id → incidents(id) on delete cascade,
  previous_status null|status, new_status, operator_note null, created_at

subscribers
  id, incident_id → incidents(id) on delete cascade, phone, active, opted_out_at null, created_at
  unique(incident_id, phone)

message_events
  id, telnyx_message_id null, idempotency_key unique,
  incident_id → incidents(id) on delete set null,
  direction inbound|outbound, event_type, phone, body,
  delivery_status null, error_details null, raw jsonb text, created_at, updated_at
```

Delivery states recorded on outbound `message_events`: `mock_outbox` (mock mode), `accepted` (API accepted — *not* final), `sent` (`message.sent`), `delivered` / `failed` (`message.finalized`, with `error_details`).

## Incident numbers

`INC-<6 digits>` generated from the PostgreSQL sequence `incident_number_seq` (e.g. `INC-000042`). Concurrency-safe: two simultaneous webhook handlers can never mint the same number.

## SMS commands (case-insensitive)

| Inbound text | Behavior |
|--------------|----------|
| `STOP` / `UNSUBSCRIBE` / `CANCEL` / `END` / `QUIT` | Marks the number opted out across all incidents; sends opt-out confirmation |
| `START` | Restores consent; sends opt-in confirmation |
| `HELP` | Sends help text |
| `STATUS INC-000123` | Replies with the incident's current status |
| Anything else (non-empty) | Treated as a new incident report (subject to `ALLOWED_REPORTER_NUMBERS`) |
| Empty/whitespace | Polite rejection, no incident created |
