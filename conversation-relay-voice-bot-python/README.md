---
name: conversation-relay-voice-bot
title: "Turn a Text Chatbot Into a Voice Bot With Conversation Relay"
description: "Forward live phone calls to any existing text-in/text-out AI chatbot using Telnyx Conversation Relay — no changes to the bot."
language: python
framework: flask
telnyx_products: [Conversation Relay, Voice]
channel: [voice]
---

# Turn a Text Chatbot Into a Voice Bot With Conversation Relay

Call a phone number and talk to **your existing AI chatbot** — the same one that already answers your Telegram, Slack, or web messages. Telnyx **Conversation Relay** handles all the telephony audio (speech-to-text, text-to-speech, call control). Your application only exchanges **text** over a WebSocket, so the chatbot needs **zero changes**: it doesn't even know the input came from a phone call instead of a chat message.

## How it works

```
  Caller speaks into phone
        │
        ▼
  ┌─────────────────────────────┐
  │ Telnyx (Conversation Relay) │  STT + TTS + call control
  │  transcribes speech → text   │
  └──────────────┬──────────────┘
                 │  WebSocket text frame: {"type":"prompt","text":"...","last":true}
                 ▼
  ┌─────────────────────────────┐
  │  This bridge app (app.py)    │  ~140 lines of glue
  │  forwards text to your bot   │
  └──────────────┬──────────────┘
                 │  POST /v1/chat/completions (OpenAI-compatible)
                 ▼
  ┌─────────────────────────────┐
  │  Your existing AI chatbot    │  ← NO CHANGES (Clawdbot/Nyx, etc.)
  │  returns a text reply        │
  └──────────────┬──────────────┘
                 │  text reply
                 ▼
  ┌─────────────────────────────┐
  │  Bridge sends text frame     │  {"type":"text","token":"...","last":true}
  └──────────────┬──────────────┘
                 │
                 ▼
  Telnyx TTS speaks the reply to the caller
```

**The key idea:** if your bot already takes text in and produces text out, Conversation Relay makes it a voice bot. Telnyx converts caller speech → text (your bot's input), and your bot's text → speech (back to the caller). Your bot's logic, personality, tools, and knowledge base stay exactly the same.

## Telnyx Products

- **Conversation Relay** — text-over-WebSocket bridge between a phone call and your app. [Docs](https://developers.telnyx.com/docs/conversation-relay) | [WebSocket API](https://telnyx.mintlify.app/api-reference/websockets/conversationrelay-websocket-channel)

## What this bridge does

| Route | Purpose |
|-------|---------|
| `GET/POST /texml/inbound` | Returns TeXML `<Connect><ConversationRelay>` to hand the call to the WebSocket |
| `WS /ws/conversation-relay` | Receives `setup`/`prompt`/`dtmf`/`interrupt` frames, calls your bot, sends replies |
| `POST /callbacks/conversation-relay` | Conversation Relay action callback (logged, returns 204) |
| `GET /health` | Health check + active session count |

### Conversation Relay frame types

**Telnyx → your app (received):**

| Frame | Meaning |
|-------|---------|
| `setup` | First frame — session ID and call info |
| `prompt` | Transcribed caller speech. `last:false` = partial, `last:true` = final |
| `dtmf` | Caller pressed a digit |
| `interrupt` | Caller barged in over TTS playback |
| `error` | Error frame |

**Your app → Telnyx (sent):**

| Frame | Meaning |
|-------|---------|
| `text` | Text to speak via TTS. `last:false` = stream tokens, `last:true` = finalize |

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `CHATBOT_BASE_URL` | `string` | `http://localhost:18789` | **yes** | Your chatbot's base URL (OpenAI-compatible) | Your bot's gateway/API host |
| `CHATBOT_TOKEN` | `string` | `sk-...` | **yes** | Bearer token for your chatbot endpoint | Your bot's auth config |
| `CHATBOT_MODEL` | `string` | `openclaw` | no | Model name your endpoint expects | Your bot's docs (`openclaw` for Clawdbot) |
| `TELNYX_PUBLIC_BASE_URL` | `string` | `https://abc.ngrok.app` | **yes** | Public HTTPS URL of this app | Your ngrok/tunnel URL |
| `WELCOME_GREETING` | `string` | `Hi! This is Nyx...` | no | Spoken when the call connects | - |
| `VOICE` | `string` | `Telnyx.NaturalHD.orion` | no | Telnyx TTS voice (NaturalHD = premium) | [Voices](https://developers.telnyx.com/docs/voice/tts) |
| `LANGUAGE` | `string` | `en` | no | TTS + transcription language | - |
| `TRANSCRIPTION_PROVIDER` | `string` | `deepgram` | no | Speech-to-text provider | `deepgram`, `google`, or `telnyx` |
| `PORT` | `integer` | `8000` | no | HTTP server port | - |

## Setup

### 1. Install and run the bridge

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/conversation-relay-voice-bot-python
cp .env.example .env    # ← fill in your chatbot URL + token + ngrok URL
pip install -r requirements.txt
python app.py           # starts on http://localhost:8000
```

### 2. Expose it publicly

Conversation Relay needs a public WebSocket URL. Use ngrok:

```bash
ngrok http 8000
```

Copy the HTTPS URL (e.g. `https://abc.ngrok.app`) and set it as `TELNYX_PUBLIC_BASE_URL` in `.env`, then restart the app.

### 3. Configure a TeXML Application in the Telnyx Portal

1. Go to the [Telnyx Portal](https://portal.telnyx.com) → **TeXML Applications** → create a new app.
2. Set the **Voice URL** (inbound) to `https://abc.ngrok.app/texml/inbound`.
3. Assign a phone number to this TeXML application.

### 4. Make sure your existing chatbot is running

Your chatbot must be reachable from this bridge (e.g. `localhost:18789` if it runs on the same machine). Test it:

```bash
curl http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $CHATBOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"openclaw","messages":[{"role":"user","content":"hello"}],"max_tokens":20}'
```

### 5. Call the number

Dial your Telnyx number. You'll hear the welcome greeting, then speak — Telnyx transcribes your speech, the bridge forwards it to your chatbot, and your chatbot's reply is spoken back to you.

## Testing the bridge without a phone call

Verify the TeXML and health endpoints locally:

```bash
# TeXML should return the <Connect><ConversationRelay> document
curl http://localhost:8000/texml/inbound

# Health check
curl http://localhost:8000/health
```

To exercise the full WebSocket path without a real call, you can connect a WebSocket client to `ws://localhost:8000/ws/conversation-relay`, send a `setup` frame, then a `prompt` frame with `last: true` and a `text` field — the bridge will call your chatbot and send back a `text` frame.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| No audio / call drops | `TELNYX_PUBLIC_BASE_URL` not set or wrong | Set it to your ngrok HTTPS URL and restart |
| `502` from Telnyx on connect | App not running or not publicly reachable | Start `app.py` and keep ngrok tunnel open |
| Bot replies are generic | Conversation history not maintained | This bridge keeps per-call history; ensure `sessionId` arrives in the `setup` frame |
| `401` from chatbot endpoint | Wrong/missing `CHATBOT_TOKEN` | Verify the bearer token in `.env` |
| `Invalid model` error | `CHATBOT_MODEL` not recognized | Use `openclaw` for a Clawdbot gateway, or your endpoint's model name |

## Related Examples

- [AI Language Learning Phone Tutor (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-language-learning-phone-tutor-python/README.md)
- [AI Audiobook Narrator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-audiobook-narrator-python/README.md)

## Resources

- [Conversation Relay Guide](https://developers.telnyx.com/docs/conversation-relay)
- [Conversation Relay WebSocket API](https://telnyx.mintlify.app/api-reference/websockets/conversationrelay-websocket-channel)
- [TeXML Reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml)
- [Telnyx Portal](https://portal.telnyx.com)
- [Telnyx Developer Docs](https://developers.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
