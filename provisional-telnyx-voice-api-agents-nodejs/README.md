---
name: provisional-telnyx-voice-api-agents
title: "Provisional Agents with Telnyx Voice API"
description: "Start one reusable Telnyx AI Assistant on Telnyx Voice API calls with runtime business instructions selected by the called phone number."
language: nodejs
framework: express
telnyx_products: [Voice, AI Assistants]
channel: [voice]
---

# Provisional Agents with Telnyx Voice API

Start one reusable Telnyx AI Assistant on Telnyx Voice API calls with runtime business instructions selected by the called phone number.

This example shows a Provisional Agents with Telnyx Voice API pattern:

```text
base Telnyx AI Assistant + Telnyx Voice API call-time business config = business-specific voice agent
```

The server answers inbound Telnyx Voice API calls, waits for the `call.answered` webhook, maps the called number to a business config, renders appointment-scheduling instructions, and starts the base Telnyx AI Assistant with a runtime `greeting` and `instructions`.

## Telnyx Voice API Endpoints Used

- **Answer Call**: `POST /v2/calls/{call_control_id}/actions/answer` - [API reference](https://developers.telnyx.com/api-reference/call-commands/answer-call)
- **Start AI Assistant**: `POST /v2/calls/{call_control_id}/actions/ai_assistant_start` - [API reference](https://developers.telnyx.com/api-reference/call-commands/start-ai-assistant)
- **Create Call**: `POST /v2/calls` - optional outbound test helper

## Architecture

```text
  caller
    |
    v
  telnyx number
    |
    v
  voice api webhook
    |
    v
  express server
    |
    +--> call.initiated -> answer call
    |
    +--> call.answered
           |
           +--> called number -> examples/number-routing.json
           +--> business config -> prompt template
           +--> ai_assistant_start with runtime instructions and greeting
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform that combines Voice API call control and AI Assistants on one communications platform. That lets your webhook answer a call, select context from your own application data, and attach an AI voice assistant to the same live call without handing the call across multiple vendors.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY_your_telnyx_api_key_here` | **yes** | Telnyx API v2 key used for Voice API commands | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `base64_public_key` | recommended | Public key for webhook signature verification | [Webhook signing docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing) |
| `BASE_ASSISTANT_ID` | `string` | `assistant-...` | **yes for live calls** | Reusable Telnyx AI Assistant started on each call | [AI Assistants](https://portal.telnyx.com/#/ai/assistants) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on | - |
| `TELNYX_CONNECTION_ID` | `string` | `connection-id` | only for `npm run call` | Voice connection used by the outbound test helper | [Portal](https://portal.telnyx.com) |
| `TELNYX_FROM_NUMBER` | `string` | `+15551111111` | only for `npm run call` | Telnyx number used as outbound caller ID | [Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TEST_TO_NUMBER` | `string` | `+15552222222` | only for `npm run call` | Destination phone number for the outbound test call | - |

## Setup

Prerequisite: Node.js 18 or newer.

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provisional-telnyx-voice-api-agents-nodejs
cp .env.example .env
npm install
```

Create a generic Telnyx AI Assistant for appointment scheduling. Keep it business-agnostic: model, voice, tools, and stable behavior belong on the base assistant. Clinic names, hours, services, and greetings come from runtime config in this example.

Set the base assistant id in `.env`:

```bash
BASE_ASSISTANT_ID=assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## Preview Provisional Agents with Telnyx Voice API Runtime Instructions

Preview the generated Telnyx Voice API `ai_assistant_start` payload without making a call:

```bash
npm run preview -- smile-dental
```

Try another config:

```bash
npm run preview -- northside-medical
```

## Run the Inbound Telnyx Voice API Example

Start the server:

```bash
npm start
```

Expose it publicly:

```bash
ngrok http 5000
```

Configure your Telnyx Voice API application webhook URL:

```text
https://<id>.ngrok.io/webhooks/voice
```

Assign your Telnyx number to that Voice API application, then map the number in `examples/number-routing.json`:

```json
{
  "+15551111111": "smile-dental"
}
```

Call the mapped number. The expected flow is:

1. Telnyx sends `call.initiated`.
2. The server answers the call.
3. Telnyx sends `call.answered`.
4. The server maps the called number to a business config.
5. The server starts the base Telnyx AI Assistant with runtime instructions and greeting.

## Optional Telnyx Voice API Outbound Test Call

Telnyx Voice API outbound testing is useful when you want to force a business config using `client_state` instead of number routing:

```bash
npm run call -- smile-dental
```

The Telnyx Voice API outbound helper places a call and encodes:

```json
{ "business_config": "smile-dental" }
```

When the Telnyx Voice API call is answered, the webhook reads that `client_state` first. If there is no usable `client_state`, it falls back to called-number routing.

## API Reference

### `POST /webhooks/voice`

Receives Telnyx Voice API webhooks. Telnyx calls this endpoint directly.

For local testing without Telnyx signatures, leave `TELNYX_PUBLIC_KEY` unset. For production, set `TELNYX_PUBLIC_KEY` so the server verifies webhook signatures.

### `GET /health`

```bash
curl http://localhost:5000/health
```

Response:

```json
{
  "status": "ok",
  "webhook": "/webhooks/voice",
  "configs": ["smile-dental", "northside-medical", "brightcare-physical-therapy"]
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Webhook returns `401 invalid signature` | `TELNYX_PUBLIC_KEY` is set but the request is not signed by Telnyx | Use a real Telnyx webhook, or unset `TELNYX_PUBLIC_KEY` for local curl testing |
| Live call returns `BASE_ASSISTANT_ID is required` | No base assistant id is configured | Create a generic AI Assistant and set `BASE_ASSISTANT_ID` |
| No business config is selected | The called number is not in `examples/number-routing.json` | Add the called number in E.164 format |
| Call rings forever | Telnyx is not reaching your webhook or the call was not answered | Check the ngrok URL, Voice API application webhook URL, and number assignment |
| `ai_assistant_start` fails | The call is not answered, assistant id is invalid, or the API key lacks permissions | Confirm `call.answered` arrived, check `BASE_ASSISTANT_ID`, and verify the API key |

## Related Examples

- [build-voice-ai-agent-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-nodejs/README.md) - Build a voice AI agent with Telnyx Inference and Call Control
- [route-phone-calls-to-ai-agent-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-nodejs/README.md) - Receive and answer inbound Voice API calls
- [create-ai-assistant-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-nodejs/README.md) - Create a reusable AI Assistant

## Resources

- [Voice API guide](https://developers.telnyx.com/docs/voice/programmable-voice)
- [Start AI Assistant API reference](https://developers.telnyx.com/api-reference/call-commands/start-ai-assistant)
- [Answer Call API reference](https://developers.telnyx.com/api-reference/call-commands/answer-call)
- [Telnyx AI Assistants](https://telnyx.com/products/voice-ai-agents)
- [Telnyx Portal](https://portal.telnyx.com)
