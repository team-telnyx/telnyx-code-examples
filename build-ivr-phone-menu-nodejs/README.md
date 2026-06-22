---
name: build-ivr-phone-menu
title: "Build an IVR Phone Menu"
description: "Production-ready IVR system using the Telnyx Voice API and Express.js. Answers inbound calls, plays a menu via TTS, collects DTMF input, and routes callers to sales or support."
language: nodejs
framework: express
telnyx_products: [Voice]
channel: [voice]
---

# Build an IVR Phone Menu

Production-ready IVR system using the Telnyx Voice API and Express.js. Answers inbound calls, plays a menu via TTS, collects DTMF input, and routes callers to sales or support.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. Programmable Call Control lets you answer, speak, gather DTMF, and transfer calls over webhooks, so your IVR logic lives in your own code instead of a rigid hosted menu builder.

- **Call Control built in** — answer, TTS, DTMF gather, and transfer are all single API calls driven by webhook events.

## Telnyx API Endpoints Used

- **Answer Call**: `POST /v2/calls/{call_control_id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Speak Text (TTS)**: `POST /v2/calls/{call_control_id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Gather Using Speak**: `POST /v2/calls/{call_control_id}/actions/gather_using_speak` — [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Transfer Call**: `POST /v2/calls/{call_control_id}/actions/transfer` — [API reference](https://developers.telnyx.com/api/call-control/transfer-call)

## Architecture

```
  Inbound Phone Call
        │
        ▼
  ┌──────────────────────┐
  │ Telnyx Call Control   │
  └─────────┬────────────┘
            │ webhooks
            ▼
  ┌──────────────────────┐
  │ Express app           │
  │  /webhooks/*          │
  └─────────┬────────────┘
            │
  call.initiated ──► answer ──► gather_using_speak (menu + DTMF)
            │
  dtmf.received ──► 1 ► transfer sales
                    2 ► transfer support
                    3 ► repeat menu
                    * ► invalid, retry
            │
  call.hangup ──► clean up call state
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000`) | — |
| `WEBHOOK_URL` | `string` | `https://your-domain.com/webhook` | no | Public webhook base URL, logged on startup for reference | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000 (or $PORT)
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure your Call Control Application in the [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/call-initiated`

   This app listens on separate paths per event (`/webhooks/call-initiated`, `/webhooks/dtmf-received`, `/webhooks/call-hangup`). Point each Telnyx webhook at the matching path, or route all events to one path and branch on `event_type` in production.

## API Reference

### `POST /webhooks/call-initiated`

Telnyx fires this when an inbound call arrives. The app answers the call, speaks the menu greeting, and starts collecting a single DTMF digit.

```bash
curl -X POST http://localhost:5000/webhooks/call-initiated \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.initiated",
      "payload": {
        "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA"
      }
    }
  }'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `POST /webhooks/dtmf-received`

Telnyx fires this when the caller presses a key. The app routes the call: `1` transfers to sales, `2` transfers to support, `3` repeats the menu, anything else replays an "invalid selection" prompt and gathers again.

```bash
curl -X POST http://localhost:5000/webhooks/dtmf-received \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.dtmf.received",
      "payload": {
        "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
        "dtmf": { "digits": "1" }
      }
    }
  }'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `POST /webhooks/call-hangup`

Telnyx fires this when the call ends. The app removes the call's in-memory state.

```bash
curl -X POST http://localhost:5000/webhooks/call-hangup \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.hangup",
      "payload": {
        "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA"
      }
    }
  }'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /health`

Health check endpoint for monitoring.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2026-06-18T14:30:00.000Z"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Invalid API key` | `TELNYX_API_KEY` is missing or wrong | Verify the key in `.env` matches the one in the [Portal](https://portal.telnyx.com/api-keys); no quotes or trailing spaces, then restart `node server.js` |
| Webhooks never arrive | Local server not publicly reachable | Run `ngrok http 5000` and set the ngrok HTTPS URL as your Call Control Application webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| DTMF input ignored | `gather_using_speak` not running, or call already transferred/ended | Confirm the greeting calls `gatherUsingSpeak` (speaks the prompt and collects DTMF in one command), and that the call is still active when the digit is pressed; check server logs |
| Transfer says "Transferring…" but nothing happens | Destination number invalid or not in E.164 | Edit the hardcoded sales/support numbers in `server.js` to valid E.164 numbers (e.g. `+15559876543`) your account can dial |
| `429 Rate limit exceeded` | Too many Call Control requests | Slow down request volume; the error middleware already returns 429 for `RateLimitError` |

## Related Examples

- [build-ivr-phone-menu-python](../build-ivr-phone-menu-python/) — the same IVR in Python/Flask
- [make-outbound-phone-call-nodejs](../make-outbound-phone-call-nodejs/) — place outbound calls with Call Control
- [text-to-speech-phone-call-nodejs](../text-to-speech-phone-call-nodejs/) — speak text on a call
- [record-phone-calls-nodejs](../record-phone-calls-nodejs/) — record call audio
- [route-phone-calls-to-ai-agent-nodejs](../route-phone-calls-to-ai-agent-nodejs/) — hand calls to an AI voice agent

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Gather DTMF API Reference](https://developers.telnyx.com/api/call-control/gather)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Voice AI Agents](https://telnyx.com/products/voice-ai-agents)
- [Voice Pricing](https://telnyx.com/pricing/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
