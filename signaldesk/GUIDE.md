# SignalDesk — Guided Walkthrough

This guide walks through SignalDesk end to end: what happens on every text, how the AI classifies reports, how operators act, and how to take the app from a mocked laptop demo to a live Telnyx line. It also covers the Telnyx account setup (numbers, messaging profile, 10DLC) and Vercel/AI-Gateway wiring.

## The 30-minute happy path (fully local, no Telnyx account)

```bash
npm install
npm run db:up                 # Docker: postgres:16-alpine → localhost:54329
cp .env.example .env          # edit: AUTH_SECRET, operator creds
npm run hash-password -- "your password"   # paste hash into .env
npm run db:migrate
npm run seed                  # optional fictional incidents
SIGNALDESK_MOCK_AI=true SIGNALDESK_MOCK_SMS=true npm run dev
```

Open http://localhost:3000 → `/login` → sign in.

**Simulate an incident.** In the top bar open **Simulator**, press a preset (e.g. *"Sev1-style report"*), and send. The message flows through the *exact* pipeline the webhook uses:

1. The body is parsed (`parseSmsCommand`) — free text = report.
2. `classifyIncident` (mock or real) extracts structured fields.
3. A transaction creates the incident (`INC-00000N`), the first `incident_updates` row, and the reporter's `subscribers` row.
4. The confirmation SMS is recorded to the **outbox** (mock mode).

Open the incident → you'll see the extracted severity/service/next-action, the original text, confidence, timeline, and delivery state `mock_outbox`.

**Change status.** On the incident page, pick `IDENTIFIED`, add a note ("Bad config rolled back"), submit. The update is recorded and — because the reporter is a subscriber — an SMS is queued to the outbox with the incident number in the body.

**Try the SMS commands** from the simulator: `HELP`, `STATUS INC-000001`, `STOP` (then check the outbox for the opt-out confirmation), `START` to restore.

## What the webhook actually does

`POST /api/webhooks/telnyx` is the only public surface. It is *not* protected by dashboard auth; it's protected by Telnyx's Ed25519 webhook signatures:

1. Read the **raw** body with `await request.text()` — never a re-serialized copy.
2. Verify `Telnyx-Signature-Ed25519` over `"{Telnyx-Timestamp}|{raw body}"` using the SDK's `unwrapWebhook` and `TELNYX_PUBLIC_KEY`. Timestamps outside ±300s are rejected (replay protection).
3. Parse with Zod; deduplicate on `data.id` (unique column). **A Telnyx retry cannot create a second incident** — the duplicate is acked immediately.
4. Ack `200` with the fast path (`message_events` row inserted synchronously), then run slow work inside `after()`:

```
verify signature ─▶ parse envelope ─▶ record message_event (dedupe) ─▶ ACK ─▶ after():
                                                                             ├─ command?  stop/start/help/status reply
                                                                             └─ report?   classify → incident txn → confirmation SMS
```

If you port this to a runtime without `after()`/`waitUntil`, the slow work is already isolated in `planIngestion().background` — hand that closure to a queue (Vercel Queues, Workflow, etc.).

## How classification works

`src/lib/classify.ts` calls `generateObject` with:

- `model: gateway("zai/glm-5.3-flash")` — routed via Vercel AI Gateway
- `providerOptions.gateway.only: ["telnyx"]` — pins routing to Telnyx-hosted inference
- A Zod schema for title, summary, severity (`SEV1–4`), affected service, region, symptoms, suggested next action, confidence (0–1), missing information

System prompt rules: extract only what the reporter said; never invent facts; ambiguity lowers severity and confidence; unknowns go to `missingInformation`. The UI shows extracted fields and a confidence percentage — never model reasoning or chain-of-thought.

Auth note: on Vercel, unset `AI_GATEWAY_API_KEY` works via platform OIDC. Locally, `AI_GATEWAY_API_KEY` is required. Set `SIGNALDESK_MOCK_AI=true` to demo without any external call.

## Telnyx account setup

1. **Buy or choose a number.** SignalDesk uses a US number for two-way SMS. If you already have a 10DLC-cleared number you can reuse it — the campaign stays with the number.
2. **Messaging profile.** Create a profile for SignalDesk (don't repoint a profile another demo relies on). Set:
   - `webhook_url` → `https://<host>/api/webhooks/telnyx`
   - assign the SignalDesk number to this profile.
3. **10DLC campaign.** US A2P traffic requires an approved campaign on the sending number — either 10DLC (brand + campaign) or a verified toll-free sender. Unregistered numbers will be filtered by carriers *even though your API calls are correct*. Verify with the recorded delivery states on `message.finalized` events.
4. **Credentials.** Copy the API key into `TELNYX_API_KEY` (or leave it empty on Vercel and use the `telnyx/signaldesk-telnyx` Connect connector — the app calls `@vercel/connect` `getToken` with `subject: { type: "app" }` and falls back only when Connect is absent).
5. **Webhook key.** Copy the Ed25519 **public** key from the portal into `TELNYX_PUBLIC_KEY`. This is a public key; the private counterpart never leaves Telnyx.
6. Flip `SIGNALDESK_MOCK_SMS=false` and send a real report. The outbox page then shows the true delivery chain: `accepted → sent → delivered` (or `failed` with Telnyx error details).

## Deploying to Vercel

1. Create the project from this folder (`npx vercel` or the dashboard import).
2. Attach a Postgres (Vercel Postgres, Neon, …) and set `DATABASE_URL`.
3. Environment variables: everything in the README table. `TELNYX_API_KEY` optional with Connect; `AI_GATEWAY_API_KEY` optional (OIDC).
4. `npx vercel env pull` locally if you want to run against prod config; run migrations: `DATABASE_URL=... npm run db:migrate`.
5. Point the messaging profile webhook at the deployment URL.
6. If using Vercel Connect: install the Telnyx connector named `signaldesk-telnyx` under the `telnyx/*` type in the team's Connect store, then set `TELNYX_CONNECTOR_NAME=telnyx/signaldesk-telnyx`.

## Production readiness checklist

- [ ] `AUTH_SECRET` rotated from the example value; operator password hashed (`npm run hash-password`) and not the demo one
- [ ] `SIGNALDESK_MOCK_AI=false` and `SIGNALDESK_MOCK_SMS=false` on any deployment that receives real webhooks
- [ ] `TELNYX_PUBLIC_KEY` set — unverified webhooks are rejected (401); never disable signature verification in production
- [ ] 10DLC campaign (or toll-free verification) approved for the SignalDesk number
- [ ] `ALLOWED_REPORTER_NUMBERS` considered — without it, anyone who knows the number can open incidents
- [ ] Database backups / PITR enabled; migration runs are part of deploy
- [ ] Log hygiene: no API keys, signatures, or auth headers are logged; phone numbers are masked by `maskPhone`
- [ ] Rate limits: Telnyx 429s surface `Retry-After`; consider a queue if send volume grows
- [ ] Route the `after()` work to a queue if you need stronger delivery guarantees than waitUntil provides

## FAQ

**Can I reuse a number from another project?** Yes, if you move it to the SignalDesk messaging profile — SMS webhook routing follows the profile, voice routing is untouched. The 10DLC campaign assignment stays with the number.

**Why is my incident missing after a "200"?** The ack happens before classification. Check the `message_events` row for `error_details` (`classification_failed: …`) — most often a missing `AI_GATEWAY_API_KEY` with mock AI off.

**Does an accepted send mean delivered?** No. Acceptance (`accepted`) means Telnyx queued it. Final state arrives via `message.finalized`. The dashboard reflects the difference.

**How do subscribers get added?** The original reporter is subscribed automatically when their incident is created. For the MVP that is the entire subscriber model — status updates flow to the person who reported them.
