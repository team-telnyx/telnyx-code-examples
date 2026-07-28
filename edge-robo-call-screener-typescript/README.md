---
name: edge-robo-call-screener
title: "Edge Robo-Call Screener"
description: "Inbound call screener on Telnyx Edge Compute Stateful Actors — answers, asks a question, AI judges if it's a robocall, hangs up on robocalls and forwards legitimate callers."
language: nodejs
framework: telnyx-edge (Stateful Actors)
telnyx_products: [Edge Compute, Voice, AI Inference]
channel: [voice]
---

# Edge Robo-Call Screener

Inbound call screener on Telnyx Edge Compute Stateful Actors — answers, asks a question, AI judges if it's a robocall, hangs up on robocalls and forwards legitimate callers. No ngrok, no external server — runs at `*.telnyxcompute.com`.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Gather Using Speak**: `POST /v2/calls/{id}/actions/gather_using_speak` — [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Call Control: Hangup**: `POST /v2/calls/{id}/actions/hangup` — [API reference](https://developers.telnyx.com/api/call-control/hangup-call)
- **Call Control: Transfer**: `POST /v2/calls/{id}/actions/transfer` — [API reference](https://developers.telnyx.com/api/call-control/transfer-call)
- **Call Control: Reject**: `POST /v2/calls/{id}/actions/reject` — [API reference](https://developers.telnyx.com/api/call-control/reject-call)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  Caller dials your number
        │
        ▼
  ┌──────────────────────────────┐
  │ Telnyx Voice webhook         │
  │ → *.telnyxcompute.com        │
  └────────┬─────────────────────┘
           │
           ▼
  ┌──────────────────────────────┐
  │ Edge Stateful Actor           │
  │ (CallScreener)                │
  │  1. Check blocklist           │
  │  2. Answer + ask question     │
  │  3. Gather speech → STT       │
  │  4. AI Inference judges       │
  │  5. Hang up or forward        │
  └────────┬─────────────────────┘
           │
     ├── robocall → hang up + add to blocklist
     └── legitimate → transfer to human
```

## Environment Variables / Secrets

Set secrets via the Edge CLI (do not commit real values):

```bash
telnyx-edge secrets add TELNYX_API_KEY "KEY0123..."
telnyx-edge secrets add TELNYX_PHONE_NUMBER "+18005551234"
telnyx-edge secrets add FORWARD_TO_NUMBER "+17175551234"
```

Non-secret env vars go in `telnyx.toml` `[env_vars]`:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123...` | **yes** | Telnyx API v2 key (secret) | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | Your Telnyx number (E.164) (secret) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `FORWARD_TO_NUMBER` | `string` | `+17175551234` | **yes** | Where to forward legit callers (secret) | Your phone number |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model | [Models](https://developers.telnyx.com/docs/inference/models) |

## Setup

### Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+ (`telnyx-edge`)
- Node.js 18+
- A Telnyx phone number with a Call Control Application

### 1. Configure secrets

```bash
cd edge-robo-call-screener-typescript
telnyx-edge auth api-key set <YOUR_API_KEY>
telnyx-edge secrets add TELNYX_API_KEY "KEY0123..."
telnyx-edge secrets add TELNYX_PHONE_NUMBER "+18005551234"
telnyx-edge secrets add FORWARD_TO_NUMBER "+17175551234"
```

### 2. Install dependencies

```bash
npm install
```

### 3. Deploy

```bash
telnyx-edge ship
```

`ship` prints a URL like `edge-robo-call-screener-<id>.telnyxcompute.com`.

### 4. Point your Call Control webhook

In the [Telnyx Portal](https://portal.telnyx.com/call-control/applications):

1. Create or edit a Call Control Application
2. Set the **Webhook URL** to `https://edge-robo-call-screener-<id>.telnyxcompute.com/webhooks/voice`
3. Assign your Telnyx phone number to this application

### 5. Test

Call your Telnyx number from your phone. The app answers, asks "Who are you and why are you calling?", and either hangs up (robocall) or forwards you (legitimate).

## API Reference

### `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Handles: `call.answered`, `call.gather.ended`, `call.hangup`.

### `GET /stats?number=<e164>`

Returns cumulative stats for the screened number.

```bash
curl https://edge-robo-call-screener-<id>.telnyxcompute.com/stats
```

**Response:**

```json
{
  "number": "+18005551234",
  "total_calls": 15,
  "blocked": 9,
  "forwarded": 6,
  "blocklist": ["+18005559999", "+12125550000"]
}
```

### `GET /calls?number=<e164>&limit=20`

Returns recent call records.

```bash
curl https://edge-robo-call-screener-<id>.telnyxcompute.com/calls
```

### `POST /blocklist/clear?number=<e164>`

Clears the blocklist for a number.

```bash
curl -X POST https://edge-robo-call-screener-<id>.telnyxcompute.com/blocklist/clear
```

### `GET /health/{liveness,readiness}`

Health check endpoints (returns `"ok"`).

```bash
curl https://edge-robo-call-screener-<id>.telnyxcompute.com/health/liveness
```

## How It Works

1. **Inbound call** → Telnyx sends `call.answered` webhook to Edge
2. **Blocklist check** → Actor checks if caller is on the per-number blocklist (durable storage). If yes → reject immediately.
3. **Answer + ask** → Actor answers the call and plays "Who are you and why are you calling?" via TTS gather
4. **Speech recognition** → Caller speaks, Telnyx transcribes → `call.gather.ended` webhook
5. **AI judgment** → Transcript sent to AI Inference → classifies as `robocall`, `legitimate`, or `unknown`
6. **Action** → Robocall (confidence ≥ 0.7): hang up + add to blocklist. Legitimate/unknown: transfer to your phone.
7. **Persistence** → All call records, stats, and blocklist entries persist in the actor's storage across invocations.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Webhook not received | Call Control app webhook URL not set | Set webhook to `https://<func>.telnyxcompute.com/webhooks/voice` in the Portal |
| `401 Unauthorized` on Telnyx API calls | Missing/invalid `TELNYX_API_KEY` secret | `telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| Calls not forwarded | `FORWARD_TO_NUMBER` not set | `telnyx-edge secrets add FORWARD_TO_NUMBER "<e164>"` |
| No speech detected | Caller didn't speak or too quiet | Call back and speak clearly after the prompt |
| Slow response | Reasoning model emits many tokens | Use a faster model or reduce `max_tokens` in `src/index.ts` |

## Related Examples

- [Edge Voicemail to Action (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voicemail-to-action-python/README.md)
- [Edge Compute Webhook Proxy (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-compute-webhook-proxy-python/README.md)
- [AI After Hours Emergency Triage (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-after-hours-emergency-triage-python/README.md)

## Resources

- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.
