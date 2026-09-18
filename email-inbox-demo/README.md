---
name: email-inbox-demo
title: "Email Inbox Demo with Telnyx Email API"
description: "A focused inbound-email demo for the Telnyx Email API. Create inboxes on verified domains, receive messages through email.received webhooks, list and read them, and watch the UI update live. DEMO_MODE injects realistic inbound so the UI feels alive without a real account or ngrok."
language: nodejs
framework: express
telnyx_products: [Email API]
---

# Email Inbox Demo

A self-contained inbound-email dashboard for the **Telnyx Email API**. Create inboxes on verified domains with `inbound_enabled`, receive messages through `email.received` webhooks (Ed25519-signed), and read them in a clean three-pane UI — folders, message list, reader — with live Server-Sent Events so new mail appears without a refresh.

Built for the TRUST-286 demo. **DEMO_MODE** runs the full pipeline without Telnyx credentials: a background seeder injects realistic inbound (Stripe receipts, GitHub notifications, customer follow-ups, two-factor codes, meeting notes) on a timer so the UI feels alive on first open.

## Why Telnyx

Telnyx is **AI Communications Infrastructure** — voice, messaging, fax, email, and AI inference on one private global network. The Email API adds inbound as a first-class channel: create inboxes on verified domains, receive `email.received` webhooks with Ed25519 signatures, list and read messages via REST. No SMTP plumbing, no DNS MX records to maintain, no separate SDK — one platform, one API key.

## Telnyx API Endpoints Used

- `POST /v2/email_inboxes` — create inbox with `inbound_enabled: true` on a verified domain
- `GET /v2/email_inboxes` — list inboxes
- `GET /v2/email_inboxes/{id}/messages` — list messages in an inbox
- `GET /v2/emails/{id}` — retrieve a single message (HTML + text body, headers, attachments)
- `POST /v2/email_domains/{domain_id}/webhooks` — register webhook URL for `email.received` and delivery events
- `email.received` webhook (Ed25519-signed) — fires when a new message arrives

> **Three domain paths** (see the [Email API quickstart](https://developers.telnyx.com/docs/messaging/email/quickstart) for the full list):
> 1. `shared_inbound` (RECOMMENDED for the demo — no DNS needed): pass `"domain": "shared_inbound"` (or any string name) to `POST /v2/email_inboxes` and Telnyx auto-provisions the inbox on a managed subdomain.
> 2. **Shared sandbox** (`mail.telnyx.com`, `msgtelnyx.com`): from-address must be `onboarding@<domain>`; recipients must be on your Telnyx account.
> 3. **Custom verified domain**: bring your own domain, publish DNS records (MX/SPF/DKIM/DMARC), verify, then create inboxes.

## Telnyx Webhook Events

The dashboard listens for `email.received` (Ed25519-signed via the `telnyx-signature-ed25519` and `telnyx-timestamp` headers) and emits a live `message_received` Server-Sent Event so the UI updates without polling. Additional events (`email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.failed`) can be subscribed to by extending the webhook registration.

## Architecture

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

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `DEMO_MODE` | no (default `true`) | If `true`, runs without Telnyx credentials and seeds fake inbound on a timer |
| `PORT` | no (default `8788`) | Local server port |
| `HOST` | no (default `127.0.0.1`) | Bind host |
| `EMAIL_INBOX_DB` | no (default `.data/inbox.sqlite`) | Local SQLite cache path |
| `DEMO_SEED_INTERVAL_MS` | no (default `15000`) | How often the seeder injects a fake inbound |
| `TELNYX_API_KEY` | yes (live mode) | Telnyx v2 API key — `Portal → API Keys` |
| `TELNYX_PUBLIC_KEY` | yes (live mode) | Ed25519 webhook verification key — base64 or PEM |
| `TELNYX_PUBLIC_BASE_URL` | yes (live mode) | Public HTTPS URL of this server (ngrok / cloudflared) |

## Setup

```bash
# Clone
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/email-inbox-demo

# Install
npm install

# Run in DEMO_MODE — no credentials needed
npm start
# → http://localhost:8788
# → Dashboard shows a seeded inbox "support@telnyx-demo.msgtelnyx.com"
# → Every 15s a realistic inbound arrives via the background seeder
```

### Live mode (real Telnyx Email API)

```bash
# 1. Create an inbox on the shared_inbound domain (no DNS needed)
export TELNYX_API_KEY="KEY..."
curl -s -X POST "https://api.telnyx.com/v2/email_inboxes" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Email Inbox Demo", "domain": "shared_inbound"}'
# → {"data": {"id": "...", "email_address": "inbox-xxxx@yoursubdomain.msgtelnyx.com", ...}}

# 2. Get your webhook signing public key
export TELNYX_PUBLIC_KEY=$(curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/public_key | jq -r '.data.public')

# 3. Expose the local server
ngrok http 8788
export TELNYX_PUBLIC_BASE_URL="https://your-tunnel.ngrok.app"

# 4. Wire the webhook on the inbox's domain
curl -s -X POST "https://api.telnyx.com/v2/email_domains/<domain_id>/webhooks" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$TELNYX_PUBLIC_BASE_URL/webhooks/email\", \"events\": [\"email.received\", \"email.delivered\", \"email.opened\", \"email.clicked\", \"email.bounced\", \"email.failed\"]}"

# 5. Configure the app
cat > .env <<EOF
DEMO_MODE=false
TELNYX_API_KEY=$TELNYX_API_KEY
TELNYX_PUBLIC_KEY=$TELNYX_PUBLIC_KEY
TELNYX_PUBLIC_BASE_URL=$TELNYX_PUBLIC_BASE_URL
EOF

# 6. Run
npm start
# → Visit http://localhost:8788, click "+ Add inbox", send any email to your inbox address.
```

## Demo flow (for the YouTube recording)

1. **Show the empty state (15s)** — open `http://localhost:8788`. The dashboard renders with one seeded demo inbox. The message list is empty. Narration: *"This is a focused look at the inbound side of the Telnyx Email API. No outbound, no AI — just receive, list, and read."*
2. **Click "Recording view" (10s)** — top right. Type enlarges, debug controls hide. *"For the recording I switch to a presentation-friendly layout."*
3. **Click "Trigger inbound" (60s)** — top right. A realistic email arrives: Stripe receipt, GitHub two-factor code, meeting notes — randomized each click. The toast flashes, the message appears in the list, the reader opens automatically. *"The seeder injects realistic inbound so the demo works without a real inbox or ngrok. The rendering path is the same code that handles real `email.received` webhooks — only the source differs."*
4. **Click another message (15s)** — the reader renders the full HTML body in a sandboxed iframe, with a toggle to plain text. Archive / Delete buttons appear. *"Reading the message opens it, marks it as read, and renders the HTML body safely."*
5. **Click "+ Add inbox" (30s)** — type a username + subdomain, hit submit. A second inbox appears in the sidebar with its own message stream. *"Creating an inbox is one API call — `POST /v2/email_inboxes` with `inbound_enabled: true`. In live mode this creates a real inbox on the shared_inbound subdomain."*
6. **Click into the new inbox, trigger more (30s)** — show independent message lists per inbox, the unread badges in the sidebar updating live. *"Each inbox is independent. Messages stream in via Server-Sent Events so the UI updates the moment a webhook fires."*
7. **Outro (15s)** — *"Inbound email on the Telnyx Email API: one platform, one API key, one signed webhook. Clone it and run it in DEMO_MODE in under a minute."*

## Files

| File | Purpose |
|------|---------|
| `src/server.ts` | Express server, SSE bus, route wiring, webhook receiver |
| `src/db.ts` | `better-sqlite3` cache for inboxes + messages + events |
| `src/dashboard.ts` | Self-contained 3-pane HTML dashboard export |
| `src/telnyxClient.ts` | `telnyx` Node SDK wrappers + payload mapper |
| `src/webhookVerify.ts` | Ed25519 signature verification (`tweetnacl`) |
| `src/demoSeeder.ts` | Background fake-inbound generator for DEMO_MODE |
| `src/types.ts` | Row types + Telnyx payload shapes |
| `tests/smoke.test.ts` | 5 smoke tests — DB CRUD, seeder, payload mapping, Ed25519 verify |
| `.env.example` | All configuration knobs with defaults |

## Notes

- **The dashboard runs without any npm frontend tooling** — vanilla HTML/CSS/JS, single self-contained file. Same pattern as the `omni-channel-lab-inbox-agent` admin UI.
- **Ed25519 verification** uses `tweetnacl`. The public key can be either a PEM block or a raw base64/hex 32-byte string. Telnyx's `GET /v2/public_key` returns the raw base64 form.
- **The DEMO_MODE seeder** synthesizes the exact `email.received` payload shape Telnyx would send, then routes it through the same storage + SSE pipeline. Switching to live mode (by setting `DEMO_MODE=false` and the three Telnyx env vars) flips the input source without changing the rendering path.
- **Recording view** is a `body.recording` CSS class — type enlarges, debug controls hide, demo banner appears. Toggle with the top-right button.
- **Trigger inbound** is hidden in recording view — it's a debug surface only.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `npm install` fails on `@types/tweetnacl` | That package doesn't exist | Removed — `tweetnacl` ships its own types |
| Dashboard loads but no messages appear | DEMO_MODE seeder hasn't fired yet | Wait 15s, or click "Trigger inbound" in the top bar |
| `401 invalid signature` on webhook | `TELNYX_PUBLIC_KEY` doesn't match the webhook signing key | Re-fetch via `GET /v2/public_key` and update `.env` |
| `502 Bad Gateway` on inbox creation | Telnyx API rejected the request | Check `TELNYX_API_KEY`, `EMAIL_SENDING_DOMAIN`, or domain verification status |
| Webhook never fires | Public URL not reachable from Telnyx | Confirm `ngrok`/`cloudflared` is running and `TELNYX_PUBLIC_BASE_URL` matches |
| Messages show but reader is blank | HTML body is empty | Toggle the "Plain text" disclosure under the iframe |

## Related Examples

- [omni-channel-lab-inbox-agent (TypeScript, Edge Compute)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/omni-channel-lab-inbox-agent) — full lab-result workflow across fax, voice, SMS, email
- [ai-email-agent-python (Python, Flask)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-email-agent-python) — AI-drafted email reply bot
- [ai-voice-memo-to-email-python (Python, Flask)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-voice-memo-to-email-python) — phone call → formatted email
- [Edge Cron Scheduler (TypeScript, Agent SDK)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-cron-scheduler) — durable job runner with auth-gated dashboard (the pattern this dashboard mirrors)

## References

- [Email API quickstart](https://developers.telnyx.com/docs/messaging/email/quickstart)
- [Email API API reference](https://developers.telnyx.com/api-reference/email-messages/create-or-send-an-email-message)
- [Email API GA release notes](https://telnyx.com/release-notes/email-api-now-generally-available)
- [Telnyx Node SDK](https://github.com/team-telnyx/telnyx-node)
- [Telnyx Developer Docs](https://developers.telnyx.com)

## Agent Discovery

- **Sign up**: [telnyx.com/sign-up](https://telnyx.com/sign-up)
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli)
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **LLM-friendly docs**: [developers.telnyx.com/llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [llms.txt](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI** (human + agent): [developers.telnyx.com/docs/development/cli](https://developers.telnyx.com/docs/development/cli)
