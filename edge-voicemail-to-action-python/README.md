---
name: edge-voicemail-to-action
title: "Edge Voicemail to Action"
description: "AI-powered voicemail triage at the edge."
language: python
framework: flask
telnyx_products: [Edge Compute, Voice, AI Inference, Messaging]
channel: [voice, sms]
---

# Edge Voicemail to Action

> Also known as: voicemail transcription, voicemail triage, smart voicemail, voicemail AI.

AI-powered voicemail triage at the edge. Transcribes voicemails, classifies them (urgent, routine, spam), and takes action: urgent triggers callback, routine goes to SMS digest, spam gets blocklisted.

## Why Telnyx

Telnyx is AI Communications Infrastructure: voice (Call Control), messaging (SMS), and AI Inference run on one private global network, so this app captures a voicemail, classifies it with an LLM, and escalates by phone or SMS without stitching together separate vendors. Speech gathering, TTS briefings, outbound callbacks, and chat completions are all served from the same low-latency platform, which keeps the urgent-callback path fast and the spam-blocklist logic close to where calls land. One API key and one billing relationship cover the entire transcribe-classify-act loop.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` -- [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Gather Using Speak**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Hangup**: `POST /v2/calls/{id}/actions/hangup` -- [API reference](https://developers.telnyx.com/api/call-control/hangup)
- **Call Control: Reject**: `POST /v2/calls/{id}/actions/reject` -- [API reference](https://developers.telnyx.com/api/call-control/reject-call)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Send Message (SMS)**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Create Outbound Call**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api/call-control/create-call)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
- `call.gather.ended` -- Caller input received (speech or DTMF), app processes response
- `call.speak.ended` -- TTS playback finished, transitions to next action
- `call.hangup` -- Call ended, cleans up session state and logs outcome

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number | [Portal](https://portal.telnyx.com/numbers/my-numbers) · [CLI: `telnyx number-orders`](https://developers.telnyx.com/development/cli) |
| `TELNYX_CONNECTION_ID` | `string` | `149440475714` | **yes** | Call Control app ID | [Portal](https://portal.telnyx.com/call-control/applications) · [CLI: `telnyx call-control-applications`](https://developers.telnyx.com/development/cli) |
| `ONCALL_NUMBER` | `string` | `+12125551234` | **yes** | On-call engineer phone | -- |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-voicemail-to-action-python
cp .env.example .env
pip install -r requirements.txt
python app.py
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
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


### Webhook Configuration

1. Expose your local server: `ngrok http 5000`
2. Configure in [Telnyx Portal](https://portal.telnyx.com/call-control/applications):
   - Call Control Application -> Webhook URL -> `https://<id>.ngrok.io/webhooks/voice`

## API Reference

### `GET /voicemails`

Voicemails.

```bash
curl http://localhost:5000/voicemails
```

**Response:**

```json
{"status": "ok", "service": "edge-voicemail-to-action"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "edge-voicemail-to-action"}
```


## Webhook Endpoints

### `POST /webhooks/voice`

Telnyx sends call events here. Your app processes them and responds with the next action.

**Events handled:**

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
- `call.gather.ended` -- Caller input received (speech or DTMF), app processes response
- `call.speak.ended` -- TTS playback finished, transitions to next action
- `call.hangup` -- Call ended, cleans up session state and logs outcome

**Example payload:**

```json
{
  "data": {
    "event_type": "call.initiated",
    "id": "evt_123",
    "payload": {
      "call_control_id": "v3:abc123",
      "direction": "incoming",
      "from": "+12125551234",
      "to": "+18005559876"
    }
  }
}
```

## All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/voice` | Voice |
| `POST` | `/webhooks/oncall` | Oncall |
| `GET` | `/voicemails` | Voicemails |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 invalid signature` on `/webhooks/voice` or `/webhooks/oncall` | `TELNYX_PUBLIC_KEY` is unset or wrong (the app rejects every webhook when it is missing) | Copy the Ed25519 public key from your [Portal Call Control application](https://portal.telnyx.com/call-control/applications) into `TELNYX_PUBLIC_KEY` in `.env` and restart |
| `401 invalid signature` even with a key set | Webhook timestamp is older than 300s, or a proxy altered the raw body | Ensure server clock is in sync (replay window is `MAX_TIMESTAMP_SKEW = 300`) and that the tunnel forwards the body unmodified |
| Telnyx never reaches your app | Local server is not publicly reachable | Run `ngrok http 5000` and set the Call Control Webhook URL to `https://<id>.ngrok.io/webhooks/voice` |
| Urgent voicemails do not trigger a callback | `ONCALL_NUMBER` or `TELNYX_CONNECTION_ID` is missing | Set both in `.env`; `call_oncall` returns early when `ONCALL_NUMBER` is empty and needs the connection ID to place the outbound call |
| Routine digest SMS never arrives | `DIGEST_RECIPIENTS` is empty or the digest interval has not elapsed | Set `DIGEST_RECIPIENTS` (comma-separated); the digest thread sends once per hour and only when the routine queue is non-empty |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> telnyx call-control-applications list
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) - route inbound calls into a Telnyx AI agent
- [ai-voicemail-transcription-forwarding-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voicemail-transcription-forwarding-python/README.md) - transcribe voicemails and forward them
- [record-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-python/README.md) - record calls with Call Control
- [edge-merge-ai-receptionist-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-merge-ai-receptionist-python/README.md) - edge AI receptionist that triages callers

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
