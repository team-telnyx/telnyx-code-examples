---
name: signaldesk
title: "SignalDesk — AI Incident Response over SMS"
description: "A Next.js operations desk: incident reports arrive over Telnyx SMS, an AI Gateway model classifies them, operators triage in a dashboard, and subscribers get status updates by text."
language: typescript
framework: nextjs
telnyx_products: [Messaging, AI Inference, AI Gateway]
---

# SignalDesk

An AI incident-response MVP: field reporters text an incident report to a Telnyx number, the report is classified into structured severity/service/next-action data by `zai/glm-5.3-flash` through Vercel AI Gateway (forced to Telnyx-hosted inference), operators triage in a Next.js dashboard, and every status change fans out an SMS update to the incident's subscribers.

## What it does

1. A user sends an SMS to the SignalDesk number.
2. Telnyx posts a `message.received` webhook to `POST /api/webhooks/telnyx`.
3. The app verifies the Telnyx **Ed25519** signature (`telnyx-signature-ed25519` + `telnyx-timestamp`, ±300s replay window) over the raw request body.
4. The inbound message is persisted and deduplicated by webhook event id — Telnyx retries can never create a second incident.
5. The message is classified with the AI SDK `generateObject` + Zod: title, summary, severity, affected service/region, symptoms, suggested next action, confidence. The model must not invent outage facts; ambiguity lowers severity and confidence.
6. The incident is created in one PostgreSQL transaction (incident + initial status update + subscriber) and the reporter gets a confirmation SMS with the incident number.
7. An operator opens the dashboard, reviews the incident, and changes its status (with an optional note).
8. Active subscribers receive an SMS status update; a RESOLVED transition sends the resolution copy.
9. Telnyx `message.sent` / `message.finalized` webhooks update each message's recorded delivery state, including failures.

## Why Telnyx

SignalDesk needs three things that normally live in three vendors: carrier-grade messaging with delivery receipts, structured LLM inference you can steer, and a public webhook surface that proves where the request came from. Telnyx provides all of it as **AI Communications Infrastructure** — the Messaging API both receives and sends SMS, Ed25519-signed webhooks authenticate every event without a password, and Telnyx-hosted inference serves `zai/glm-5.3-flash` behind Vercel AI Gateway with `providerOptions.gateway.only = ["telnyx"]` pinning the route. One account, one number, one key: reports in, AI triage, updates out.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose in this app |
|----------|--------|---------------------|
| `/v2/messages` | `POST` | Outbound SMS (confirmation, status updates, resolution, HELP, opt-out confirmation) via the official `telnyx` SDK: `client.messages.send()` |
| Messaging webhooks (`message.received`, `message.sent`, `message.finalized`) | webhook POST | Inbound reports and delivery state; delivered to `/api/webhooks/telnyx` |
| Webhook signatures | — | `telnyx-signature-ed25519` / `telnyx-timestamp` verified with the SDK's `unwrapWebhook` (Node crypto, no extra deps) |
| AI inference (`zai/glm-5.3-flash`) | — | Served through **Vercel AI Gateway** with routing restricted to Telnyx (`only: ["telnyx"]`); no direct Telnyx AI call is made |

## Architecture

```
Browser/dashboard
        |
        v
Next.js application on Vercel
        |
        +--> PostgreSQL (Drizzle ORM)
        |      incidents / incident_updates / subscribers / message_events
        |
        +--> Vercel AI Gateway --> Telnyx-hosted inference
        |        zai/glm-5.3-flash  (providerOptions.gateway.only=["telnyx"])
        |
        +--> Telnyx Messaging API  -- sends SMS (official `telnyx` SDK)
                 ^      |
                 |      v
          Telnyx webhooks (Ed25519-signed)
          message.received / message.sent / message.finalized
                 |
                 v
        POST /api/webhooks/telnyx   (raw body -> verify -> dedupe -> ack -> after())
```

Request flow detail:

- The webhook handler reads the **unmodified raw body** with `await request.text()`, verifies the signature first, then parses JSON with Zod.
- Fast path: record the `message_events` row (unique idempotency key) and return `200` — Telnyx gets its ack in milliseconds.
- Slow path: classification + incident creation + confirmation SMS run inside `after()` (Next.js `waitUntil` on Vercel) after the response is flushed.
- On runtimes without safe background execution, the `after()` call is the single seam to replace with a queue/worker — everything after the ack is one function (`planIngestion.background`).

## Environment Variables

Copy `.env.example` → `.env` and fill in what you need. **Only `.env.example` is committed.**

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | PostgreSQL connection string (Drizzle ORM) |
| `AUTH_SECRET` | yes | Auth.js session signing secret (`openssl rand -base64 32`) |
| `SIGNALDESK_OPERATOR_USERNAME` | yes | Operator login (password auth) |
| `SIGNALDESK_OPERATOR_PASSWORD_HASH` | yes | `scrypt` hash — generate with `npm run hash-password -- "<password>"` |
| `TELNYX_API_KEY` | yes* | Telnyx API key (*local fallback when Vercel Connect is not configured) |
| `TELNYX_FROM_NUMBER` | yes* | E.164 sender number assigned to the SignalDesk messaging profile |
| `TELNYX_MESSAGING_PROFILE_ID` | optional | Messaging profile used for sends (recommended over raw number) |
| `TELNYX_PUBLIC_KEY` | for live webhooks | Ed25519 **public** key from the Telnyx portal for webhook verification |
| `TELNYX_CONNECTOR_NAME` | optional | Vercel Connect connector (`telnyx/signaldesk-telnyx`) for credential-less deploys |
| `AI_GATEWAY_API_KEY` | for live AI | Vercel AI Gateway key; unset on Vercel deployments uses OIDC automatically |
| `SIGNALDESK_MOCK_AI` | dev flag | `true` = deterministic offline classifier (no external calls) |
| `SIGNALDESK_MOCK_SMS` | dev flag | `true` = outbound SMS recorded to a dev outbox instead of sending |
| `ALLOWED_REPORTER_NUMBERS` | optional | Comma-separated E.164 allowlist; empty = accept any reporter |

> **Credential priority for Telnyx:** when running on Vercel with the `telnyx/signaldesk-telnyx` Connect connector installed, the app fetches the API key via `@vercel/connect` (`getToken`, OIDC-authenticated). `TELNYX_API_KEY` is the local-development fallback. Connector name is configurable via `TELNYX_CONNECTOR_NAME`.

> **Agent / CLI access.** Equivalent Telnyx CLI for the env vars above:
> `telnyx messaging-profiles create --name signaldesk --webhook-url "https://<host>/api/webhooks/telnyx"` (sets `TELNYX_MESSAGING_PROFILE_ID`), `telnyx phone-numbers update <ID> --messaging-profile-id <ID>` (moves `TELNYX_FROM_NUMBER` onto the profile), `telnyx keys list` (prints the Ed25519 key for `TELNYX_PUBLIC_KEY`). The reporter allowlist (`ALLOWED_REPORTER_NUMBERS`) lives only in this app's environment.

## Setup

### 1. Prerequisites

- Node.js 20+ (built with Node 24)
- Docker (for the local PostgreSQL)
- A Telnyx account with an SMS-capable number and an API key
- (For live AI) a Vercel AI Gateway key, or a Vercel deployment (OIDC)

### 2. Clone, install, and start the database

```bash
git clone <this-repo> && cd telnyx-code-examples/signaldesk
npm install
npm run db:up          # docker: postgres:16-alpine on localhost:54329
cp .env.example .env   # then edit .env (see below)
```

<details>
<summary>Programmatic / CLI setup (Telnyx CLI, agent-friendly)</summary>

The Telnyx CLI (`npm i -g @team-telnyx/ai` or `brew install telnyx/tap/telnyx`) can provision everything without opening the portal:

```bash
# 1. Create the SignalDesk messaging profile (webhook URL points at the app)
telnyx messaging-profiles create \
  --name signaldesk \
  --webhook-url "https://<your-host>/api/webhooks/telnyx" \
  --webhook-api-version v2

# 2. Assign the SignalDesk number to that profile (reads profile id from step 1)
telnyx phone-numbers update <PHONE_NUMBER_ID> \
  --messaging-profile-id <MESSAGING_PROFILE_ID>

# 3. Print the account's Ed25519 webhook public key for TELNYX_PUBLIC_KEY
telnyx keys list
```

Verify with `telnyx messaging-profiles list` and `telnyx phone-numbers list`.

</details>

### 3. Configure `.env`

```bash
# Database
DATABASE_URL=postgres://postgres:signaldesk@localhost:54329/signaldesk

# Auth (dashboard login)
AUTH_SECRET=$(openssl rand -base64 32)
SIGNALDESK_OPERATOR_USERNAME=operator
npm run hash-password -- "your-password-here"   # paste output into the next line
SIGNALDESK_OPERATOR_PASSWORD_HASH=scrypt:...

# Telnyx
TELNYX_API_KEY=your_telnyx_api_key
TELNYX_FROM_NUMBER=+1XXXXXXXXXX

# Local demo flags (mock first, real creds later)
SIGNALDESK_MOCK_AI=true
SIGNALDESK_MOCK_SMS=true
ALLOWED_REPORTER_NUMBERS=+1XXXXXXXXXX
```

### 4. Migrate, seed, run

```bash
npm run db:migrate     # applies drizzle migrations
npm run seed           # optional: five fictional incidents for the dashboard
npm run dev            # http://localhost:3000
```

Sign in at `/login` with the operator username + the password you hashed.
Then open **Simulator** (dev nav) to file an incident without touching Telnyx.

### 5. Wire real SMS (dev → live)

1. In the Telnyx portal, note your **Ed25519 public key** (Manage → Keys & Credentials) and set `TELNYX_PUBLIC_KEY`.
2. Create (or reuse) a **messaging profile**, set its webhook URL to `https://<your-host>/api/webhooks/telnyx`, and assign the SignalDesk number to it.
3. Put the profile id in `TELNYX_MESSAGING_PROFILE_ID` (or just the number in `TELNYX_FROM_NUMBER`).
4. Set `SIGNALDESK_MOCK_SMS=false` and restart.
5. For webhooks on your laptop, run a tunnel (`cloudflared tunnel --url http://localhost:3000`) and use that URL in step 2 — or deploy to Vercel and use its URL.

### 6. Turn on real AI

- Set `AI_GATEWAY_API_KEY` (vercel.com → AI Gateway → API keys) and `SIGNALDESK_MOCK_AI=false`.
- On a Vercel deployment you can leave the key unset: AI Gateway authenticates with the platform OIDC token automatically.
- The model is `zai/glm-5.3-flash`, and requests carry `providerOptions.gateway.only = ["telnyx"]` so inference is always served by Telnyx.

### 7. Vercel deployment

1. Push this folder to a Vercel project (or `npx vercel` from the folder).
2. Add a Postgres (Vercel Postgres, Neon, Supabase — any reachable PostgreSQL) and set `DATABASE_URL`.
3. Set the environment variables from the table above; `TELNYX_API_KEY` can stay empty if you install the **Telnyx Connect** integration and set `TELNYX_CONNECTOR_NAME=telnyx/signaldesk-telnyx`.
4. Run migrations against the deployed database: `DATABASE_URL=<prod url> npm run db:migrate`.
5. Point the messaging profile webhook to `https://<deployment>/api/webhooks/telnyx`.

> **10DLC / carrier registration — read before sending A2P traffic**
>
> US application-to-person messaging requires a registered campaign for the sending number. Numbers on an approved **10DLC campaign** (or a verified toll-free sender) are the only reliable path for app-initiated texts to US numbers; unregistered traffic is filtered by carriers regardless of correct API usage. This repo's demo campaign is Low Volume Mixed — see `GUIDE.md` for the registration overview. **Successful local runs do not guarantee carrier delivery**: use the recorded delivery states (`message.finalized`) to verify real reachability.
>
> Opt-out compliance: STOP/UNSUBSCRIBE/CANCEL/END/QUIT are honored globally per number, and transactional HELP/STOP replies remain deliverable. Never use SignalDesk for unsolicited marketing without your own compliance review.

## API Reference

Full typed reference in [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/signaldesk/API.md). Quick map:

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/webhooks/telnyx` | Ed25519 signature | Telnyx webhook receiver |
| `POST /api/auth/[...nextauth]` | — | Auth.js handlers |
| `GET /` | session | Dashboard: counts, incidents, inbound feed, failures |
| `GET /incidents/[id]` | session | Incident detail + status form |
| `POST` status update (server action) | session | Records transition + notifies subscribers |
| `GET /dev/outbox` | dev/mock | Messages that would have been sent |
| `GET /dev/simulator` | dev only | Simulates an inbound SMS through the real pipeline |

Data model: `incidents`, `incident_updates`, `subscribers`, `message_events` (see `src/db/schema.ts` and the walkthrough in `GUIDE.md`).

## Testing

```bash
npm test          # vitest — 67 tests
npm run typecheck # next typegen + tsc --noEmit
npm run lint      # eslint
npm run build     # production build
```

Covered: classification schema + severity validation, phone normalization/masking, SMS command parsing (STOP/START/HELP/STATUS), Ed25519 signature verification (valid, tampered, stale, malformed), webhook idempotency (dedupe against the database), opt-out enforcement, incident-number generation, status transitions, subscriber notification selection, and delivery-status derivation.

Fixtures for every webhook flow live in [`fixtures/`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/signaldesk/fixtures/) — point the simulator or a curl at them.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `signature_verification_failed` (401) | `TELNYX_PUBLIC_KEY` missing or not the account's current key. The key must be the portal's Ed25519 public key — never a private key. |
| Webhook 200 but no incident | Mock flags: `SIGNALDESK_MOCK_AI=true` classifies without inference; check `npm run dev` logs and `message_events.error_details` for `classification_failed`. |
| Incidents not created, duplicate key error | A webhook retry raced a slow first delivery — the unique idempotency key did its job. Nothing to do. |
| `DATABASE_URL is not set` | Scripts (seed) don't auto-load `.env` unless `dotenv` is imported — `npm run seed` does this for you; set the var when invoking tools manually. |
| Dashboard 307 on `/` | Not signed in — visit `/login`. |
| Outbound SMS show `mock_outbox` | `SIGNALDESK_MOCK_SMS=true`. Set `false` once real credentials are configured. |
| Telnyx 401/403 | API key lacks permission, or Connect token expired — check the connector in the Vercel dashboard. |
| Telnyx 422 on send | Number must be on the messaging profile; `from` must be E.164. |
| Telnyx 429 | Retry-After is parsed and surfaced; resend after the noted delay. |
| `No available providers match the 'only' filter: telnyx` | The model you called has no Telnyx endpoint on AI Gateway, or your team is on the free tier — `zai/glm-5.3-flash` is served by Telnyx but is `plan_restricted` for free teams. Add AI Gateway credits (vercel.com → AI Gateway → credits) to unlock it. |
| `plan_restricted` / model ineligible | Same as above: paid AI Gateway credits unlock restricted models. |
| Delayed/dropped US delivery without 10DLC | Expected: the number needs a registered campaign (see warning above). |

## Agent Discovery

- LLM-friendly index: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt) · [`llms-full.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms-full.txt)
- Agent CLI: [`@team-telnyx/ai`](https://github.com/team-telnyx/ai) — `npm i -g @team-telnyx/ai`
- Agent skills and signup: [developers.telnyx.com/ai](https://developers.telnyx.com/ai)
- Telnyx CLI (human + agent): [developers.telnyx.com/docs/cli](https://developers.telnyx.com/docs/cli)

## Related Examples

- [watchdog](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/watchdog/README.md) — scheduled web checks on Telnyx Edge with SMS alerts
- [two-way-sms-chat-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-nodejs/README.md) — conversational SMS without AI triage
- [sms-support-agent-with-followup](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-support-agent-with-followup/README.md) — SMS support with follow-ups
- [agent-sms-triage-bot](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md) — triage routing for inbound SMS

## Resources

- Telnyx Messaging API — [developers.telnyx.com/api-reference/messaging](https://developers.telnyx.com/api-reference/messaging)
- Send SMS quickstart (Node) — [developers.telnyx.com/docs/development/quickstarts/sms/send-sms-node](https://developers.telnyx.com/docs/development/quickstarts/sms/send-sms-node)
- Webhook signature verification — [developers.telnyx.com/docs/decoding-outbound-webhooks](https://developers.telnyx.com/docs/decoding-outbound-webhooks)
- Telnyx Node SDK — [github.com/team-telnyx/telnyx-node](https://github.com/team-telnyx/telnyx-node)
- 10DLC overview — [developers.telnyx.com/docs/messaging/10-dlc](https://developers.telnyx.com/docs/messaging/10-dlc)
- Telnyx pricing — [telnyx.com/pricing](https://telnyx.com/pricing)
- Vercel AI Gateway — [vercel.com/ai-gateway](https://vercel.com/ai-gateway)
