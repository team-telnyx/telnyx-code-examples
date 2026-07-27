---
name: merge-pipeline-briefing
title: "Merge Pipeline Briefing"
description: "Morning pipeline briefing delivered by Telnyx Voice and AI Inference with Merge CRM."
language: python
framework: flask
telnyx_products: [Voice, AI Inference]
integrations: [Merge CRM]
channel: [voice]
---

# Merge Pipeline Briefing

> Also known as: sales briefing, pipeline review, morning standup, CRM voice briefing.

Morning pipeline briefing. Pulls rep pipeline from CRM via Merge. AI generates spoken briefing covering total deals, value, deals closing this week, and stale opportunities. Calls rep with personalized briefing.

## Why Telnyx

Telnyx is AI Communications Infrastructure: voice, messaging, and AI inference run on one private global network, so the outbound call, the spoken briefing, and the AI text generation all happen behind a single API and key. That means lower latency between generating the briefing and speaking it, no third-party AI hop, and predictable carrier-grade call quality for every rep you dial.

## Telnyx API Endpoints Used

- **Call Control: Gather Using Speak**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Hangup**: `POST /v2/calls/{id}/actions/hangup` -- [API reference](https://developers.telnyx.com/api/call-control/hangup)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)
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
cd telnyx-code-examples/merge-pipeline-briefing-python
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

### `POST /briefing`

Briefing.

```bash
curl -X POST http://localhost:5000/briefing \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `POST /briefing/preview`

Preview.

```bash
curl -X POST http://localhost:5000/briefing/preview \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `GET /briefings`

Briefings.

```bash
curl http://localhost:5000/briefings
```

**Response:**

```json
{"status": "ok", "service": "merge-pipeline-briefing"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "merge-pipeline-briefing"}
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
| `POST` | `/briefing` | Briefing |
| `POST` | `/briefing/preview` | Preview |
| `POST` | `/webhooks/voice` | Voice |
| `GET` | `/briefings` | Briefings |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| Webhook returns `401 invalid signature` | `TELNYX_PUBLIC_KEY` missing or wrong | Copy the Ed25519 public key from [Portal -> Keys & Credentials](https://portal.telnyx.com/app/account/keys) into `TELNYX_PUBLIC_KEY`; it must be the base64 value Telnyx shows. |
| Briefing call never starts (`500 briefing call failed`) | Missing/invalid `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, or `TELNYX_CONNECTION_ID` | Confirm all three are set in `.env` and the connection ID matches the Call Control Application whose webhook points at this server. |
| Telnyx never sends webhook events | Webhook URL not reachable | Run `ngrok http 5000` and set the Call Control Application webhook to `https://<id>.ngrok.io/webhooks/voice`; the URL must be public HTTPS. |
| Briefing says "No pipeline data available" or empty summary | `MERGE_API_KEY` / `MERGE_ACCOUNT_TOKEN` wrong, or no `owner_id` deals | Verify the Merge keys at [app.merge.dev](https://app.merge.dev) and confirm the linked CRM account has opportunities; test with `POST /briefing/preview` first. |

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

- [merge-deal-desk-alerts-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-deal-desk-alerts-python/README.md) - CRM-driven deal alerts over voice via Merge.
- [merge-invoice-collector-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-invoice-collector-python/README.md) - another Merge + voice automation sibling.
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) - Call Control + AI inference routing patterns.
- [record-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-python/README.md) - capturing audio on Call Control calls.

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
