---
name: join-meeting-by-sms
title: "Join a Meeting by SMS"
description: "Text a meeting link to a Telnyx number and a bot joins the call for you, then texts back a TL;DR when the meeting ends."
language: nodejs
framework: express
telnyx_products: [Messaging, Meeting Bot]
channel: [sms]
---

# Join a Meeting by SMS

Text a Google Meet, Zoom, Teams, or Webex link to your Telnyx number and a bot joins the meeting in your place, announces itself in chat, and texts you a TL;DR when the meeting ends.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. This example uses two products from the same API key: Messaging to receive your text and reply, and Meeting Bot to join the call, record a transcript, and generate the summary. There is no separate transcription or summarization vendor to wire up.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| Inbound Message webhook (`/webhooks/sms`, your endpoint) | POST | Telnyx calls this when you text your number -- [Webhook reference](https://developers.telnyx.com/docs/messaging/messages/receive-message) |
| `/v2/meeting_sessions` | GET | Check whether a bot is already in the meeting |
| `/v2/meeting_sessions` | POST | Send the bot into the meeting (`summarize_on_end: true`) |
| `/v2/meeting_sessions/{id}` | GET | Poll status: `joining`, `waiting_for_admission`, `active`, `ended` |
| `/v2/meeting_sessions/{id}/artifacts` | GET | Fetch the generated `summary` artifact |
| `/v2/messages` | POST | Text you status updates and the TL;DR |

## Architecture

```
  You text a meeting link
        │
        ▼
  ┌──────────────────┐   POST webhook   ┌───────────────────────┐
  │ Telnyx Messaging │ ───────────────► │ Express /webhooks/sms │
  └──────────────────┘                  └───────────┬───────────┘
                                                    │ verify Ed25519 signature
                                                    │ owner check + extract URL
                                                    ▼
                                        ┌───────────────────────┐
                                        │ POST /meeting_sessions│
                                        └───────────┬───────────┘
                                                    ▼
                                        ┌───────────────────────┐
                                        │ Bot joins the meeting │
                                        └───────────┬───────────┘
                                                    │ poll status every 5s
                                                    ▼
                    "Bot is in" SMS  ◄── active ── ended ──► summary artifact ──► "TL;DR" SMS
```

**Flow:**
1. You text a meeting link to your Telnyx number.
2. The server verifies the webhook signature and checks the text came from `OWNER_PHONE_NUMBER`.
3. It creates a meeting session. The inbound message ID is the idempotency key, so a webhook retry cannot add a second bot.
4. The bot joins as `BOT_NAME` and posts `CHAT_ON_ENTER` in the meeting chat.
5. The server texts you when the bot reaches the waiting room and when it is in.
6. When the session ends, it fetches the summary artifact and texts you the TL;DR.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PUBLIC_KEY` | `string` | `base64 key` | **yes** | Verifies the Ed25519 signature on inbound webhooks | [Portal](https://portal.telnyx.com) > Account Settings > Keys & Credentials > Public Key |
| `TELNYX_PHONE_NUMBER` | `string` | `+15555550100` | **yes** | SMS-enabled Telnyx number that receives your texts and sends replies | [Portal](https://portal.telnyx.com/numbers/my-numbers) · [CLI: `telnyx number-orders create`](https://developers.telnyx.com/development/cli) |
| `OWNER_PHONE_NUMBER` | `string` | `+15555550123` | **yes** | Your mobile number. Only texts from this number can send the bot into a meeting | Your phone |
| `BOT_NAME` | `string` | `Your Bot` | no | Name on the bot's tile (default `Meeting Bot`) | - |
| `CHAT_ON_ENTER` | `string` | `Hi all - I am a bot attending on behalf of a teammate...` | no | Message the bot posts in meeting chat when it joins | - |
| `ASSISTANT_ID` | `string` | `assistant-...` | no | Telnyx AI Assistant that lets the bot speak and answer questions | [Portal](https://portal.telnyx.com/ai-assistants) |
| `CAMERA_IMAGE_URL` | `string` | `https://example.com/bot.jpg` | no | Public HTTPS JPEG shown as the bot's camera tile | - |
| `PORT` | `number` | `3000` | no | Port the Express server listens on (default `3000`) | - |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx number-orders create --phone-number +15555550100
> telnyx messaging-profiles create --name meeting-bot-sms
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/join-meeting-by-sms-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
npm start               # starts on http://localhost:3000
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
telnyx messaging-profiles create --name meeting-bot-sms
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 3000
   ```

2. In the [Telnyx Portal](https://portal.telnyx.com), set the Messaging Profile's inbound webhook URL to `https://<id>.ngrok.io/webhooks/sms`.

3. Assign `TELNYX_PHONE_NUMBER` to that Messaging Profile.

4. Text your Telnyx number from `OWNER_PHONE_NUMBER`:

   > I can't join this meeting: https://meet.google.com/abc-defg-hij. Join as my bot, and send me a TL;DR when it ends.

> **US numbers:** outbound SMS to US mobiles needs a registered sender (10DLC campaign or toll-free verification). Until that is approved, replies may be filtered even though the bot still joins.

## API Reference

### `POST /webhooks/sms`

Receives inbound SMS events from Telnyx. Verifies the `telnyx-signature-ed25519` and `telnyx-timestamp` headers over the raw body, returns `200` immediately, then handles `message.received` events. Requests with a bad signature get `401`.

Telnyx calls this for you. To exercise it locally you must sign the body with the key that matches `TELNYX_PUBLIC_KEY`; an unsigned `curl` is rejected:

```bash
curl -i -X POST http://localhost:3000/webhooks/sms \
  -H "Content-Type: application/json" \
  -d '{"data":{"event_type":"message.received","payload":{}}}'
# HTTP/1.1 401 Unauthorized
# {"error":"invalid signature"}
```

**Response (verified):**

```json
{ "received": true }
```

### `GET /health`

```bash
curl http://localhost:3000/health
```

```json
{ "status": "ok", "watching": 0 }
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Server exits with `Missing required environment variable` | `.env` is incomplete | Fill in `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_PHONE_NUMBER`, `OWNER_PHONE_NUMBER` |
| Every webhook returns `401` | Wrong public key, or the body was parsed before verification | Copy the Public Key from Keys & Credentials. Do not add a global `express.json()` ahead of the webhook route |
| Texts arrive but nothing happens | Sender is not `OWNER_PHONE_NUMBER` (logged as `[skip]`) | Use E.164 format on both sides and text from the owner number |
| "I could not send the bot to that meeting" | Session create failed (bad link, unsupported platform, or `chat_on_enter` rejected) | Check the server log for the API error. Chat is not supported on every platform; clear `CHAT_ON_ENTER` to test |
| Bot sits at the waiting room | The host has not admitted it | Admit "BOT_NAME" from the participant list. You get a text when it is admitted |
| No TL;DR text | Meeting ended before a transcript existed, or the summary failed | The server texts a fallback message. Fetch artifacts with `GET /v2/meeting_sessions/{id}/artifacts` |
| Bot joins but you get no replies | Sender number not registered for US SMS | Complete 10DLC or toll-free verification for `TELNYX_PHONE_NUMBER` |
| Status texts stop after a restart | Watched sessions are held in memory | Persist session IDs in a database and resume watching on boot |

## Related Examples

- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) - Receive and verify inbound SMS webhooks
- [ai-meeting-action-tracker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-meeting-action-tracker-python/README.md) - Extract action items from multi-party calls
- [video-room-ai-meeting-moderator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/video-room-ai-meeting-moderator-python/README.md) - AI moderator for video rooms
- [sms-auto-reply-bot-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-nodejs/README.md) - Auto-reply to inbound SMS

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Receive a Message Guide](https://developers.telnyx.com/docs/messaging/messages/receive-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
