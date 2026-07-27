---
name: edge-merge-ai-receptionist
title: "Edge Merge AI Receptionist"
description: "Edge worker answers every call using Telnyx Voice, AI Inference, and Edge Compute with Merge HRIS."
language: python
framework: flask
telnyx_products: [Edge Compute, Voice, AI Inference]
integrations: [Merge HRIS, Merge CRM]
channel: [voice]
---

# Edge Merge AI Receptionist

> Also known as: AI receptionist, smart receptionist, auto attendant, intelligent call routing.

Edge worker answers every call. Matches requested name against Merge HRIS employees and CRM contacts simultaneously. Employees get transferred, CRM contacts get deal-context briefings, unknown callers are screened.

## Why Telnyx

Telnyx is AI Communications Infrastructure: programmable voice, AI inference, and edge compute run on one privately owned global network, so the receptionist answers, reasons, and routes calls without hopping between vendors. Call Control TTS and speech gathering, the chat-completions inference endpoint, and live PSTN transfers are all driven from a single API and account. Keeping media and AI on Telnyx's private backbone cuts latency between the greeting, the Merge lookup, and the transfer so callers never wait on a hand-off.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` -- [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Gather Using Speak**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Transfer**: `POST /v2/calls/{id}/actions/transfer` -- [API reference](https://developers.telnyx.com/api/call-control/transfer-call)
- **Call Control: Hangup**: `POST /v2/calls/{id}/actions/hangup` -- [API reference](https://developers.telnyx.com/api/call-control/hangup)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)

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
| `MERGE_API_KEY` | `string` | `your-key` | **yes** | Merge.dev API key | [Merge](https://app.merge.dev/keys) |
| `MERGE_ACCOUNT_TOKEN` | `string` | `your-token` | **yes** | Merge linked account token | [Merge](https://app.merge.dev) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-merge-ai-receptionist-python
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

### `GET /messages`

Messages.

```bash
curl http://localhost:5000/messages
```

**Response:**

```json
{"status": "ok", "service": "edge-merge-ai-receptionist"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "edge-merge-ai-receptionist"}
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
| `GET` | `/messages` | Messages |
| `GET` | `/health` | Health |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `401 invalid signature` on `/webhooks/voice` | `TELNYX_PUBLIC_KEY` is missing or wrong | Set `TELNYX_PUBLIC_KEY` to the base64 public key from the [Portal](https://portal.telnyx.com); the app rejects every webhook when it is empty. |
| Webhooks never arrive / call rings forever | Telnyx cannot reach your local server | Confirm `ngrok http 5000` is running and the Call Control Application's Webhook URL points to `https://<id>.ngrok.io/webhooks/voice`. |
| Calls connect but no one is found / no transfer | `MERGE_API_KEY` or `MERGE_ACCOUNT_TOKEN` missing or unset | Fill both in `.env`; HRIS and CRM lookups silently return no results without a valid Merge key and account token. |
| Greeting plays but AI briefing is generic | `TELNYX_API_KEY` invalid or `AI_MODEL` not available | Verify the API key in the [Portal](https://portal.telnyx.com/api-keys); inference falls back to "Let me transfer you now." on any error. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) -- core Call Control answer/gather/transfer flow for an AI agent
- [omnichannel-ai-receptionist-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/omnichannel-ai-receptionist-python/README.md) -- AI receptionist across voice and messaging channels
- [edge-merge-reference-checker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-merge-reference-checker-python/README.md) -- edge worker driving calls against Merge data
- [merge-employee-hotline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-employee-hotline-python/README.md) -- routes callers to employees pulled from Merge HRIS

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
- [Merge.dev API docs](https://docs.merge.dev)
- [Telnyx Portal](https://portal.telnyx.com)
