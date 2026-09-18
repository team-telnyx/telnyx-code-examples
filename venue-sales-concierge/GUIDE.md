# Venue Sales Concierge — Developer Guide

Walkthrough for `venue-sales-concierge`: a Telnyx-branded venue microsite + AI sales concierge on Telnyx Edge Compute. Planners browse the site, then text or talk to the concierge to check live availability, get pricing, request proposals, and book site visits. Per-planner Stateful Actors keep every conversation durable; the venue team gets a live sales dashboard; quiet planners get a personalized voice follow-up call one week later.

---

## Prerequisites

- A Telnyx account with an API key ([sign up](https://portal.telnyx.com/sign-up))
- Node.js 18+ and npm
- The Telnyx Edge CLI installed:

```bash
npm install -g @telnyx/edge-cli
telnyx-edge auth api-key set <YOUR_API_KEY>
```

---

## Project Structure

```
venue-sales-concierge/
├── src/
│   ├── index.ts          # Router: microsite, APIs, webhooks, tool
│   ├── agent.ts          # ConciergeAgent — one StatefulActor per planner
│   ├── store.ts          # KV: venue content (seeded on first read)
│   ├── db.ts             # SQLDB: availability, inquiries, site visits
│   ├── telnyx.ts         # Inference, Messaging, Voice, Email, Assistants
│   ├── verify.ts         # Ed25519 webhook verification
│   ├── types.ts          # Env bindings, domain types, helpers
│   └── pages/
│       ├── microsite.ts  # Branded venue website (KV-rendered)
│       ├── voice.ts      # In-browser WebRTC voice page
│       └── ops.ts        # Sales dashboard (SQLDB-rendered)
├── test/concierge.test.ts
├── telnyx.toml
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Local Verification

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest — 16 unit tests
```

---

## Provisioning Walkthrough

### 1. Create the Edge Function

```bash
telnyx-edge new-func -l ts -n venue-sales-concierge
# Copy the generated func_id into telnyx.toml [edge_compute]
```

### 2. Create the KV namespace (venue content)

```bash
telnyx-edge storage kv create --name venue-sales-concierge-data
# Paste the id into telnyx.toml [storage.kv.VENUE_KV]
```

On first read, the function seeds `venue/data` with the sample venue (galleries, spaces, menus, AV, pricing, FAQs) — edit that JSON any time with `telnyx-edge storage kv put` or via a PUT to your own tooling; everything re-renders automatically.

### 3. Create the SQLDB instance (availability + funnel)

Mission Control → **SQL Database** → create instance → paste the id into `telnyx.toml [storage.sqldb.AVAILABILITY_DB]`.

The schema (3 tables: `availability`, `inquiries`, `site_visits`) and a 90-day availability seed are created idempotently on the first `/api/availability`, `/ops`, or concierge turn.

### 4. Set secrets

```bash
# Org public key for Ed25519 webhook verification
curl -H "Authorization: Bearer $TELNYX_API_KEY" https://api.telnyx.com/v2/public_key
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"

# Call Control connection id (for the one-week follow-up calls)
telnyx-edge secrets add TELNYX_CONNECTION_ID "$CONNECTION_ID"
```

To create the Call Control connection: Mission Control → Voice → Programmable Voice → create a connection and point its webhook URL at `https://<your-function-url>/webhooks/voice`.

### 5. Env vars (non-secret)

Set in `telnyx.toml [env_vars]` (or via the CLI):

- `TELNYX_SMS_FROM` — the venue's Telnyx number (SMS sender + voice ANI)
- `EMAIL_TO` — venue sales inbox for qualified-lead alerts
- `EMAIL_FROM` — sender address (the shared `onboarding@mail.telnyx.com` domain works out of the box)
- `AI_MODEL` / `ASSISTANT_MODEL` — Telnyx-hosted inference models (default `moonshotai/Kimi-K2.6`, no BYOK needed)
- `DEMO_MODE` — `true` (default) simulates outbound SMS/email/calls; inference, KV, and SQLDB always run for real

### 6. Deploy

```bash
telnyx-edge ship
```

Your function is live at `https://venue-sales-concierge-<id>.telnyxcompute.com`.

### 7. Wire the phone number

```bash
# Messaging profile → SMS webhook
telnyx messaging-profiles create --name "venue-sales-concierge" \
  --webhook-url "https://<your-function-url>/webhooks/sms"
telnyx messaging-phone-numbers update <number-id> --messaging-profile-id <profile-id>

# Call Control connection → attach the same number for the follow-up calls
```

### 8. Provision the browser voice assistant (one-time)

```bash
curl -X POST https://<your-function-url>/api/setup-assistant
```

This creates/updates the AI Assistant with a `lookup_venue_info` webhook tool that reads this function's KV + SQLDB — the voice agent can never drift from what the website says.

### 9. Custom domain (branded venue website)

Mission Control → Edge Functions → your function → **Domains** → attach your venue domain (e.g. `events.harborviewvenue.com`). TLS is provisioned for you, and the microsite is served at `/`.

---

## Demo Script (video-ready)

1. **Land on the microsite** (`/`) — Telnyx-branded venue site: gallery, capacity chart, menus, AV specs, pricing, FAQs.
2. **Check your date** — pick a weekend range; the availability grid renders live from SQLDB.
3. **Book a site visit from the form** — the confirmation lands by email **and** text; the dashboard funnel ticks up.
4. **Text the concierge** (or use `POST /api/demo/message` without a phone): *"Hi, planning a wedding for 150 guests in November, what's your pricing?"* — grounded reply quotes the same KV data; SQLDB logs the inquiry.
5. **Follow up by text with your name + email** — the agent qualifies you, emails the brochure, pings the venue sales inbox, and marks the lead **Qualified** on `/ops`.
6. **Talk to the concierge in the browser** (`/voice`) — WebRTC straight to the AI Assistant, which answers from the same KV/SQLDB.
7. **Let a planner go quiet** — after the 7-day timer fires (`DEMO_MODE=false` for the real call), the agent dials them: *"Hi Jane, following up on your inquiry — press 1 to book your site visit."* Pressing 1 books it and emails the confirmation. For the video demo, trigger it on demand:

   ```bash
   curl -X POST https://<your-function-url>/api/demo/followup \
     -H "Content-Type: application/json" \
     -d '{ "from": "+15551234567", "force": true }'
   ```
   (`force` bypasses the 7-day recency window only — demo mode and the already-booked guard still apply.)
8. **Show the venue team the bookings dashboard** (`/ops`) — inquiries → RFPs → booked, with conversion rate.

---

## How the Ticket Primitives Map

| Primitive | Where |
|---|---|
| Functions | Single Edge Function deploy (`telnyx-edge ship`) |
| Custom domains | Branded microsite at `/` on your attached domain |
| KV | `venue/data` — site, concierge, voice tool, dashboard all read it |
| SQLDB | `availability`, `inquiries`, `site_visits` tables + funnel |
| Stateful Actors | `ConciergeAgent` — one per planner, durable across channels/weeks |
| Voice | Call Control speak/gather conversation + scheduled follow-up dial |
| Email | Brochures, site-visit confirmations, qualified-lead alerts |
| Inference | Grounded replies + planner-detail extraction (Telnyx-hosted model) |
