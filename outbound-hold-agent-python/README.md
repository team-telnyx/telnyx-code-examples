---
name: outbound-hold-agent
title: "Outbound Hold-Aware AI Agent"
description: "Call a business, navigate IVRs with a Telnyx AI Assistant, pause the assistant during hold, monitor with transcription, and resume with context when a representative answers."
language: python
framework: fastapi
telnyx_products: [Voice, AI Assistants, Transcription, TeXML]
channel: [voice]
---

# Outbound Hold-Aware AI Agent

Build an outbound Telnyx AI voice agent that can call a business, navigate an IVR, stop the active AI Assistant during hold, monitor the call with transcription, and restart a representative-facing assistant with the original objective and approved context.

This is useful for agents that call insurance companies, hotels, clinics, service providers, or any business where the agent may spend several minutes in menus and hold queues before a human answers.

## What This Example Does

- Places an outbound Call Control call.
- Starts an IVR navigation AI Assistant after answer.
- Lets the assistant request backend-owned DTMF through `/tools/send-dtmf`.
- Detects hold from Telnyx events, assistant tool calls, or transcript phrases.
- Stops the active assistant during hold with `ai_assistant_stop`.
- Starts transcription-only monitoring during hold.
- Detects representative pickup from `call.unhold` or transcript phrases.
- Starts a second AI Assistant with the original task, context, hold duration, and recent transcript.
- Exposes an `/tools/end-call` tool for task completion.
- Includes a deterministic fake company TeXML flow for repeatable testing.

## Telnyx API Endpoints Used

- **Dial**: `POST /v2/calls` - [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- **Start AI Assistant**: `POST /v2/calls/{call_control_id}/actions/ai_assistant_start` - [API reference](https://developers.telnyx.com/api-reference/call-commands/start-ai-assistant)
- **Stop AI Assistant**: `POST /v2/calls/{call_control_id}/actions/ai_assistant_stop` - [API reference](https://developers.telnyx.com/api-reference/call-commands/stop-ai-assistant)
- **Send DTMF**: `POST /v2/calls/{call_control_id}/actions/send_dtmf` - [API reference](https://developers.telnyx.com/api-reference/call-commands/send-dtmf)
- **Transcription Start**: `POST /v2/calls/{call_control_id}/actions/transcription_start` - [API reference](https://developers.telnyx.com/api-reference/call-commands/transcription-start)
- **Transcription Stop**: `POST /v2/calls/{call_control_id}/actions/transcription_stop` - [API reference](https://developers.telnyx.com/api-reference/call-commands/transcription-stop)
- **Hangup**: `POST /v2/calls/{call_control_id}/actions/hangup` - [API reference](https://developers.telnyx.com/api-reference/call-commands/hangup-call)

## Telnyx Webhook Events

- `call.answered` - start the IVR assistant.
- `call.hold` - stop the assistant and enter hold monitoring.
- `call.unhold` - treat the call as representative-ready.
- `call.transcription` - detect hold and representative pickup phrases.
- `call.hangup` - mark the local session ended.

## Architecture

```txt
Client / workflow
  -> POST /calls/outbound
  -> Telnyx dials target company
  -> call.answered
  -> IVR AI Assistant starts
  -> assistant calls /tools/send-dtmf for menus
  -> hold detected
  -> backend stops assistant
  -> transcription-only hold monitoring
  -> representative detected
  -> representative AI Assistant starts with context
  -> task completes
  -> assistant calls /tools/end-call
```

## Environment Variables

| Variable | Required for real calls | Description |
| --- | --- | --- |
| `TELNYX_API_KEY` | yes | Telnyx API key used for Voice API requests. |
| `TELNYX_CONNECTION_ID` | yes | Voice API / Call Control connection ID. |
| `TELNYX_FROM_NUMBER` | yes | Telnyx caller ID number in E.164 format. |
| `TELNYX_IVR_ASSISTANT_ID` | yes | Assistant used for menu navigation before hold. |
| `TELNYX_REPRESENTATIVE_ASSISTANT_ID` | yes | Assistant used after representative pickup. |
| `PUBLIC_BASE_URL` | yes | Public HTTPS base URL for webhooks, assistant tools, and fake company TeXML. |
| `TELNYX_PUBLIC_KEY` | recommended | Telnyx webhook public key for signature verification. |
| `TRANSCRIPTION_ENGINE` | no | Defaults to `Deepgram`. |
| `TRANSCRIPTION_MODEL` | no | Defaults to `nova-2`. |
| `TRANSCRIPTION_LANGUAGE` | no | Defaults to `en`. |
| `START_TRANSCRIPTION_DURING_IVR` | no | Defaults to `true` so phrase detection can catch hold language during demos. |
| `TELNYX_DRY_RUN` | no | Defaults to `true` for local testing without real Telnyx API calls. |
| `PORT` | no | Local server port. Defaults to `8000`. |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/outbound-hold-agent-python
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Keep `python app.py` running in this terminal. Open a second terminal in the same folder to run the curl commands.

## Try It Locally

Dry-run mode is enabled by default, so this creates a local session and mock Telnyx command responses:

```bash
curl -X POST http://127.0.0.1:8000/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{
    "to":"+15551234567",
    "objective":"book a hotel reservation for Friday night",
    "target_company":"Willow Creek Hotel",
    "context":{"guest_name":"Alex Morgan","party_size":2}
  }'
```

Simulate Telnyx answering the call by using the returned `call_control_id`:

```bash
curl -X POST http://127.0.0.1:8000/webhooks/telnyx \
  -H "Content-Type: application/json" \
  -d '{"data":{"event_type":"call.answered","payload":{"call_control_id":"dry-run-call-id"}}}'
```

Simulate IVR menu navigation:

```bash
curl -X POST http://127.0.0.1:8000/tools/send-dtmf \
  -H "Content-Type: application/json" \
  -d '{"digits":"1","reason":"reservations menu option"}'
```

Simulate hold detection:

```bash
curl -X POST http://127.0.0.1:8000/tools/hold-detected \
  -H "Content-Type: application/json" \
  -d '{"reason":"please hold for the next available representative","confidence":0.95}'
```

Simulate representative pickup from transcription:

```bash
curl -X POST http://127.0.0.1:8000/webhooks/telnyx \
  -H "Content-Type: application/json" \
  -d '{"data":{"event_type":"call.transcription","payload":{"call_control_id":"dry-run-call-id","transcript":"thanks for holding, this is Sarah with reservations"}}}'
```

Inspect state:

```bash
curl http://127.0.0.1:8000/sessions
```

## Test With The Built-In Fake Company

Expose the app:

```bash
ngrok http 8000
```

Set `PUBLIC_BASE_URL` to the HTTPS ngrok URL. Then point a Telnyx TeXML application or test number at:

```txt
https://YOUR_PUBLIC_BASE_URL/fake-company/texml
```

The fake company answers as Willow Creek Hotel, presents a menu, accepts digit `1`, emits hold language, and then emits a representative pickup phrase. Use this before calling a real company.

## Assistant Tools

Configure the IVR assistant with these tools:

```txt
POST https://YOUR_PUBLIC_BASE_URL/tools/send-dtmf
POST https://YOUR_PUBLIC_BASE_URL/tools/hold-detected
```

Configure the representative assistant with this optional tool:

```txt
POST https://YOUR_PUBLIC_BASE_URL/tools/end-call
```

## API Reference

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/outbound-hold-agent-python/API.md) for local endpoints exposed by this example.

## Going to Production

- Set `TELNYX_DRY_RUN=false`.
- Expose the app over public HTTPS and set `PUBLIC_BASE_URL`.
- Configure your Telnyx Voice API application webhook URL to `https://YOUR_PUBLIC_BASE_URL/webhooks/telnyx`.
- Set `TELNYX_PUBLIC_KEY` so webhook signatures are verified.
- Add authentication to local workflow endpoints and assistant tool endpoints.
- Keep DTMF actions backend-owned and validate allowed digits per target company.
- Replace in-memory sessions with persistent storage.
- Add destination allowlists, rate limits, retries, and stuck-call alerting.
- Review outbound calling, AI disclosure, recording, transcription, and retention requirements.

## Troubleshooting

| Issue | Cause | Fix |
| --- | --- | --- |
| Curl works but no real call is placed | `TELNYX_DRY_RUN=true` | Set `TELNYX_DRY_RUN=false` after configuring Telnyx values. |
| Assistant does not start | Missing assistant ID or no `call.answered` webhook | Check assistant IDs and webhook URL. |
| DTMF tool is accepted but IVR does not move | Wrong digit or DTMF sent before menu is ready | Confirm the assistant waits for the prompt and sends a valid option. |
| Representative assistant never starts | No pickup phrase was detected | Tune `REPRESENTATIVE_PHRASES` or trigger `call.unhold`. |
| Webhook returns 401 | Signature verification failed | Confirm `TELNYX_PUBLIC_KEY` and webhook signature headers. |

## Resources

- [Telnyx Dial API](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Start AI Assistant API](https://developers.telnyx.com/api-reference/call-commands/start-ai-assistant)
- [Send DTMF API](https://developers.telnyx.com/api-reference/call-commands/send-dtmf)
- [Transcription Start API](https://developers.telnyx.com/api-reference/call-commands/transcription-start)
- [Telnyx Voice API webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks)

## Why Telnyx

Telnyx is an AI Communications Infrastructure platform that exposes outbound calling, call-control webhooks, DTMF, AI Assistants, and real-time transcription in one Voice API, so the app can control the full call lifecycle without stitching together separate providers.

## Related Examples

- [make-outbound-phone-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-python/README.md) - place an outbound Call Control call.
- [build-ivr-phone-menu-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-python/README.md) - build a traditional DTMF IVR.
- [ai-voice-agent-with-function-calling-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voice-agent-with-function-calling-python/README.md) - add tool calls to an AI voice agent.
