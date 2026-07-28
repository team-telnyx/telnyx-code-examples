---
name: merge-interview-pipeline
title: "Merge Interview Pipeline"
description: "ATS webhook fires when a new application arrives, triggering Telnyx Voice, AI Inference, and Messaging with Merge ATS."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Messaging]
integrations: [Merge ATS]
channel: [voice, sms]
---

# Merge Interview Pipeline

> Also known as: automated phone screen, AI recruiter, ATS integration, candidate screening, hiring automation.

ATS webhook fires when a new application arrives. App calls the candidate within 60 seconds for an AI-conducted structured phone screen. Scores responses with AI. Updates ATS application stage. Sends SMS confirmation.

## Why Telnyx

Telnyx is **AI Communications Infrastructure** - outbound calls, real-time speech gather, text-to-speech, AI inference, and SMS all run on one private global network, so this entire screen-call-score-confirm pipeline needs a single provider and a single API key. Placing the outbound call, conducting the AI conversation, scoring the transcript, and texting the confirmation happen with low latency and no carrier hop-off between vendors. That keeps candidate experience fast and your hiring automation simple to operate.

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
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number | [Portal](https://portal.telnyx.com/numbers/my-numbers) · [CLI: `telnyx number-orders`](https://developers.telnyx.com/development/cli) |
| `TELNYX_CONNECTION_ID` | `string` | `149440475714` | **yes** | Call Control app ID | [Portal](https://portal.telnyx.com/call-control/applications) · [CLI: `telnyx call-control-applications`](https://developers.telnyx.com/development/cli) |
| `MERGE_API_KEY` | `string` | `your-key` | **yes** | Merge.dev API key | [Merge](https://app.merge.dev/keys) |
| `MERGE_ACCOUNT_TOKEN` | `string` | `your-token` | **yes** | Merge linked account token | [Merge](https://app.merge.dev) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/merge-interview-pipeline-python
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

### `POST /screen`

Screen.

```bash
curl -X POST http://localhost:5000/screen \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `GET /screens`

Screens.

```bash
curl http://localhost:5000/screens
```

**Response:**

```json
{"status": "ok", "service": "merge-interview-pipeline"}
```

### `GET /screens/<session_id>`

<Session Id>.

```bash
curl http://localhost:5000/screens/<session_id>
```

**Response:**

```json
{"status": "ok", "service": "merge-interview-pipeline"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "merge-interview-pipeline"}
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
| `POST` | `/webhooks/ats` | Ats |
| `POST` | `/screen` | Screen |
| `POST` | `/webhooks/voice` | Voice |
| `GET` | `/screens` | Screens |
| `GET` | `/screens/<session_id>` | <Session Id> |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 invalid signature` on `/webhooks/voice` | `TELNYX_PUBLIC_KEY` is missing or wrong, so Ed25519 verification fails | Set `TELNYX_PUBLIC_KEY` to the base64 public key from [Portal -> Keys & Credentials](https://portal.telnyx.com/app/account/keys-credentials); the app rejects all voice webhooks until it is valid |
| `Failed to place call` / no outbound call | `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, or `TELNYX_CONNECTION_ID` unset or invalid | Confirm all three are filled in `.env` and the connection is a Call Control application tied to the from-number |
| Webhooks never arrive | Telnyx cannot reach your local server, or the webhook URL is misconfigured | Run `ngrok http 5000` and set the Call Control app webhook URL to `https://<id>.ngrok.io/webhooks/voice`; the app derives the call's `webhook_url` from the request host |
| `Candidate not found` / `No phone number on file` | `MERGE_API_KEY` / `MERGE_ACCOUNT_TOKEN` wrong, or the candidate record has no phone | Verify the Merge keys at [app.merge.dev](https://app.merge.dev) and that the candidate has a populated phone number before the screen fires |

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

- [ai-hiring-phone-screen-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-hiring-phone-screen-python/README.md) - AI-conducted phone screen without the ATS integration
- [interview-screen-scheduler-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/interview-screen-scheduler-python/README.md) - schedule candidate screens over voice/SMS
- [merge-recruitment-hotline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-recruitment-hotline-python/README.md) - Merge ATS-backed recruiting hotline
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) - route inbound calls to an AI voice agent

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

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Merge.dev API docs](https://docs.merge.dev)
- [Telnyx Portal](https://portal.telnyx.com)
