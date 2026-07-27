---
name: edge-merge-reference-checker
title: "Edge Merge Reference Checker"
description: "Automate reference checks when an ATS application advances using Telnyx Voice and AI Inference with Merge ATS."
language: python
framework: flask
telnyx_products: [Edge Compute, Voice, AI Inference, Messaging]
integrations: [Merge ATS]
channel: [voice, sms]
---

# Edge Merge Reference Checker

> Also known as: reference check automation, automated reference calls, hiring reference checker.

ATS application reaches reference-check stage. Calls each reference. AI conducts structured 5-question interview, scores responses, updates ATS, SMS summary to hiring manager.

## Why Telnyx

This example runs outbound voice calls, real-time AI inference, and SMS notifications on Telnyx's **AI Communications Infrastructure** - one private global network instead of bolting together separate voice, AI, and messaging vendors. The same API key places the reference call, scores the responses with AI Inference, and texts the hiring manager the summary, so reference checks complete end-to-end with low latency and a single point of integration.

## Telnyx API Endpoints Used

- **Call Control: Gather Using Speak**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Hangup**: `POST /v2/calls/{id}/actions/hangup` -- [API reference](https://developers.telnyx.com/api/call-control/hangup)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Send Message (SMS)**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Create Outbound Call**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api/call-control/create-call)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` -- Call connected, app begins interaction with greeting
- `call.gather.ended` -- Caller input received (speech or DTMF), app processes response
- `call.speak.ended` -- TTS playback finished, transitions to next action
- `call.hangup` -- Call ended, cleans up session state and logs outcome

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_CONNECTION_ID` | `string` | `149440475714` | **yes** | Call Control app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `MERGE_API_KEY` | `string` | `your-key` | **yes** | Merge.dev API key | [Merge](https://app.merge.dev/keys) |
| `MERGE_ACCOUNT_TOKEN` | `string` | `your-token` | **yes** | Merge linked account token | [Merge](https://app.merge.dev) |
| `HIRING_MANAGER_PHONE` | `string` | `+12125551234` | no | Hiring manager phone | -- |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-merge-reference-checker-python
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

### `POST /check`

Check.

```bash
curl -X POST http://localhost:5000/check \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `GET /reports`

Reports.

```bash
curl http://localhost:5000/reports
```

**Response:**

```json
{"status": "ok", "service": "edge-merge-reference-checker"}
```

### `GET /reports/<check_id>`

<Check Id>.

```bash
curl http://localhost:5000/reports/<check_id>
```

**Response:**

```json
{"status": "ok", "service": "edge-merge-reference-checker"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "edge-merge-reference-checker"}
```


## Webhook Endpoints

### `POST /webhooks/voice`

Telnyx sends call events here. Your app processes them and responds with the next action.

**Events handled:**

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
| `POST` | `/check` | Check |
| `POST` | `/webhooks/voice` | Voice |
| `GET` | `/reports` | Reports |
| `GET` | `/reports/<check_id>` | <Check Id> |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| `401 invalid signature` on `/webhooks/voice` | `TELNYX_PUBLIC_KEY` is missing or wrong, so Ed25519 verification fails | Set `TELNYX_PUBLIC_KEY` from [Portal -> Keys & Credentials -> Public Key](https://portal.telnyx.com); it must be the base64 public key, not the API key |
| Reference calls never place | `TELNYX_CONNECTION_ID`, `TELNYX_PHONE_NUMBER`, or `TELNYX_API_KEY` unset | Fill all required vars in `.env`; the Connection ID must be a Call Control Application |
| Webhooks not received / signature timestamp rejected | Telnyx cannot reach your local server, or clock skew exceeds the 5-min replay window | Expose the server with `ngrok http 5000`, set the public HTTPS URL as the Call Control webhook, and sync your machine clock |
| No SMS summary to hiring manager | `HIRING_MANAGER_PHONE` not set, or no references completed all questions | Set `HIRING_MANAGER_PHONE` in E.164 format; SMS only fires once every reference finishes the interview |
| AI score always returns the `3` fallback | AI Inference call failed (bad `TELNYX_API_KEY` or model name) | Verify the API key and that `AI_MODEL` is a valid [Telnyx model](https://developers.telnyx.com/docs/inference/models) |

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

- [edge-merge-ai-receptionist-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-merge-ai-receptionist-python/README.md) - Edge voice + Merge ATS/CRM AI receptionist sibling
- [edge-merge-shift-coverage-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-merge-shift-coverage-python/README.md) - outbound voice + Merge integration for filling open shifts
- [ai-hiring-phone-screen-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-hiring-phone-screen-python/README.md) - AI-conducted structured phone screen for candidates
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) - Call Control patterns for connecting calls to an AI agent

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Merge.dev API docs](https://docs.merge.dev)
- [Telnyx Portal](https://portal.telnyx.com)
