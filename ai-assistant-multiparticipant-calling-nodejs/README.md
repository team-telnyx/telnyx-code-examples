---
name: ai-assistant-multiparticipant-calling
title: "AI Assistant Multiparticipant Calling"
description: "Build a Telnyx Voice AI assistant that answers an inbound call, uses a backend tool to dial a second participant, and joins them into the same live AI conversation with ai_assistant_join."
language: nodejs
framework: express
telnyx_products: [Voice AI, Programmable Voice]
channel: [voice]
---

# AI Assistant Multiparticipant Calling

Build a Telnyx Voice AI assistant that answers an inbound call, uses a backend tool to dial a second participant, and joins them into the same live AI conversation with `ai_assistant_join`.

## Telnyx API Endpoints Used

- **Answer Call**: `POST /v2/calls/{call_control_id}/actions/answer`
- **Create Outbound Call**: `POST /v2/calls`
- **Join AI Assistant Conversation**: `POST /v2/calls/{call_control_id}/actions/ai_assistant_join`

## Architecture

```text
Caller dials Telnyx number
        |
        v
Telnyx sends call.initiated webhook
        |
        v
Express app answers with AI Assistant
        |
        v
AI Assistant calls dial_specialist tool
        |
        v
Backend dials specialist with POST /v2/calls
        |
        v
Specialist answers
        |
        v
Backend calls ai_assistant_join with conversation_id
        |
        v
Caller + AI + specialist share one live conversation
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform that lets developers combine programmable voice, AI assistants, phone numbers, and webhooks in one workflow. This example shows how a Voice AI assistant can coordinate a human handoff without ending the original call or losing conversation context.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY_your_telnyx_api_key_here` | **yes** | Telnyx API key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `-----BEGIN PUBLIC KEY-----...` | no | Public key for webhook signature verification in production | [Portal](https://portal.telnyx.com) |
| `CONNECTION_ID` | `string` | `1234567890` | **yes** | Programmable Voice / Voice API application connection ID | [Portal](https://portal.telnyx.com) |
| `TELNYX_NUMBER` | `string` | `+13125550001` | **yes** | Telnyx number assigned to the Voice API application | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `SPECIALIST_NUMBER` | `string` | `+13125550002` | **yes** | Human specialist phone number to dial | Your phone |
| `PUBLIC_URL` | `string` | `https://example.ngrok-free.app` | **yes** | Public HTTPS URL for your local app | ngrok or another tunnel |
| `PORT` | `number` | `8787` | no | Local server port | - |
| `AI_ASSISTANT_MODEL` | `string` | `openai/gpt-4o` | no | AI Assistant model | Telnyx AI models |
| `AI_ASSISTANT_VOICE` | `string` | `voice ultra katie` | no | AI Assistant voice | Telnyx voice options |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-assistant-multiparticipant-calling-nodejs
cp .env.example .env
npm install
npm test
npm start
```

Expose your app:

```bash
ngrok http 8787
```

Set your Programmable Voice / Voice API webhook URL to:

```text
https://<your-ngrok-domain>/webhooks/voice
```

Then call your Telnyx number.

## API Reference

### `POST /webhooks/voice`

Receives Telnyx Voice webhooks. It answers inbound calls with the AI Assistant, captures AI `conversation_id` values, and joins the specialist call leg after `call.answered`.

### `POST /tools/dial-specialist`

AI Assistant tool endpoint. The assistant calls this after consent is granted. The backend dials `SPECIALIST_NUMBER` with `POST /v2/calls`.

### `GET /sessions`

Returns in-memory state for local debugging.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Missing required environment variable` | `.env` is missing a required value. | Copy `.env.example` to `.env` and fill in the Telnyx values. |
| Inbound call does not reach the app | Voice API webhook URL is not set or tunnel is down. | Run `ngrok http 8787`, set `PUBLIC_URL`, and update the Voice API application webhook. |
| Specialist is not dialed | Consent was not recorded or `SPECIALIST_NUMBER` is invalid. | Make sure the assistant calls `record_specialist_consent` first and use E.164 format. |
| `Missing AI conversation_id` | The app has not received an AI event with `conversation_id` yet. | Wait for the AI assistant to start and emit AI events before dialing/joining. |
| Specialist answers but is not joined | `ai_assistant_join` failed. | Check API key, call control ID, and server logs for the Telnyx error response. |

## Related Examples

- [Build Voice AI Agent (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-nodejs/README.md) - basic Voice AI agent
- [Route Phone Calls to AI Agent (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-nodejs/README.md) - inbound call webhook pattern
- [Make Outbound Phone Call (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-nodejs/README.md) - outbound dialing pattern
- [Build Conference Calling (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-python/README.md) - traditional conference calling

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Assistant Multi-Participant Calls](https://developers.telnyx.com/docs/inference/ai-assistants/multi-participant-calls)
- [Join AI Assistant Conversation API](https://developers.telnyx.com/api-reference/call-commands/join-ai-assistant-conversation)
- [Telnyx Portal](https://portal.telnyx.com)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)
