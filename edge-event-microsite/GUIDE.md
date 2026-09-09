# Event Microsite That Takes Calls — Walkthrough

A conference microsite, an AI concierge, and an exhibitor lead engine that all share **one Telnyx KV namespace**. Deployed as a single Telnyx Edge Compute function at a public `*.telnyxcompute.com` URL — no ngrok, no external server, no dialing.

## The Story

Conference organizers pay for event apps (Cvent add-ons, event concierge SaaS). This replaces that category with one deployment:

- The **microsite** renders the schedule, speakers, venue (WiFi + parking), and sponsors from KV.
- Attendees **text or WhatsApp** a number and the concierge answers from the same KV.
- Attendees **talk to the concierge in the browser** — WebRTC voice, no number dialed, no credentials in the page.
- Exhibitors **capture leads** by texting the concierge or using the on-site form; hot leads page a sales rep over SMS in real time.
- Attendees **leave spoken feedback**; Whisper transcribes it, inference summarizes it, and the organizer emails themselves a sponsor report.

The "never drift" guarantee: change the schedule in KV once and the site, the text concierge, and the voice agent all reflect it immediately.

## How It's Built

```
edge-event-microsite/
├── telnyx.toml          # bindings: [telnyx] inference client + KV namespace + env vars
├── src/
│   ├── index.ts         # fetch router — every route in one place
│   ├── types.ts         # Env bindings, domain types, helpers
│   ├── store.ts         # KV layer + seed event data
│   ├── telnyx.ts        # inference (zero-credential) + REST helpers (messages/email/whisper/assistants)
│   ├── verify.ts        # Ed25519 webhook signature verification
│   ├── pages/
│   │   ├── microsite.ts # server-rendered HTML from KV
│   │   └── voice.ts     # browser voice page (@telnyx/ai-agent-lib via CDN)
│   └── routes/
│       ├── concierge.ts # /webhook/sms + /webhook/whatsapp → grounded Q&A
│       ├── ops.ts       # leads, attendees, broadcast, feedback, sponsor report, email
│       └── assistant.ts # assistant provisioning + the assistant's KV lookup tool
```

## Key Flows

### 1. The KV single source of truth

`src/store.ts` reads/writes `event/data` in the KV namespace bound in `telnyx.toml` as `EVENTS`. On first read it seeds sample data. The microsite HTML, every JSON API, the concierge's system prompt, and the assistant's webhook tool all call the same `getEvent()`.

### 2. SMS concierge (inbound webhook)

1. Telnyx posts the inbound message to `/webhook/sms` (or `/webhook/whatsapp`).
2. `verify.ts` checks the Ed25519 signature (`"{ts}|{body}"` signed payload, ±5 min skew).
3. The sender is registered as an attendee (opt-in for broadcasts).
4. The concierge prompt embeds the **live KV event JSON**, and `env.TELNYX.ai.openai.chat.createCompletion` answers — zero credentials, no API key in code.
5. If the message smells like a lead ("budget", "pricing", "demo", "booth"), inference extracts structured fields; hot leads (high/enterprise budget + near-term timeline) page the sales rep via SMS with a masked phone.
6. The reply goes back over the same channel via `POST /v2/messages`.

### 3. Browser voice (no dialing)

`/voice` loads `@telnyx/ai-agent-lib` from a CDN and connects with just the assistant id — anonymous WebRTC login, nothing sensitive in the page. The assistant was provisioned by `POST /api/setup-assistant` with a **webhook tool** pointing at `/tools/lookup` on this function. When an attendee asks "what's the wifi password?", the assistant calls the tool, the function reads KV, and the assistant speaks the answer. The page also captures the attendee's speech turns and saves them as feedback.

### 4. Spoken feedback → sponsor report

The microsite records audio with `MediaRecorder` and posts it to `/api/feedback`. The function forwards the bytes to `POST /v2/ai/audio/transcriptions` (Whisper), summarizes the transcript with inference, and stores it under `feedback/<id>`. `GET /api/sponsor-report` aggregates; `POST /api/email-report` emails the digest.

### 5. Broadcasts

`POST /api/broadcast` lists every opted-in attendee from KV (`attendee/*`) and sends the update over both SMS and WhatsApp, reporting per-recipient delivery status with masked numbers in logs.

## Deploy It Yourself

See the README Setup section. Short version:

```bash
npm install
telnyx-edge storage kv create --name edge-event-microsite-data   # paste id into telnyx.toml
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
telnyx-edge secrets add EMAIL_TO "you@example.com"
telnyx-edge ship
curl -X POST https://edge-event-microsite-<id>.telnyxcompute.com/api/setup-assistant
```

Then point a messaging profile's webhook at `/webhook/sms`, assign your number to it, and text away.

## Notes & Trade-offs

- **KV instead of SQLDB** — the storage here is read-heavy, low-contention event data; KV's globally distributed reads are the right fit, and one namespace keeps the "never drift" story simple. KV keys allow only `a-z A-Z 0-9 - _ / = .`, so phone numbers are stored with `+` encoded as `=`.
- **Assistant model set** — `meta-llama/Llama-3.3-70B-Instruct` works for chat completions but is rejected by the Assistants API; `ASSISTANT_MODEL` defaults to `moonshotai/Kimi-K2.6`.
- **Shared email domain** — `onboarding@mail.telnyx.com` sends without DNS setup but only to the account's verified email. Verify your own domain to send to arbitrary organizers.
- **Webhook idempotency** — Telnyx retries webhook deliveries; the handlers here are safe to re-run (reply duplicates are possible but harmless for a demo). For production, dedupe on the webhook event id inside a Stateful Actor.
