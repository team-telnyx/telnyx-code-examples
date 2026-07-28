---
name: merge-ticket-escalation
title: "Merge Ticket Escalation"
description: "Critical ticket fires a webhook from Merge Ticketing, escalating via Telnyx Voice and AI Inference."
language: python
framework: flask
telnyx_products: [Voice, AI Inference]
integrations: [Merge Ticketing]
channel: [voice]
---

# Merge Ticket Escalation

> Also known as: ticket escalation, on-call alerts, incident response, support escalation.

Critical ticket fires a webhook from Merge Ticketing. Calls the on-call engineer with AI-generated context briefing. Engineer says connect me to bridge directly with the customer. Updates ticket status.

## Why Telnyx

Telnyx is AI Communications Infrastructure: programmable voice, AI inference, and messaging run on one private global network, so a critical ticket can trigger an outbound call and an AI-generated incident briefing without stitching together separate vendors. This example uses Call Control to place the on-call alert and bridge the customer, plus Telnyx AI Inference to summarize the ticket in real time -- all behind a single API key and one billing relationship. Owning the network end to end keeps escalation latency low and call quality consistent when an incident can't wait.

## Telnyx API Endpoints Used

- **Call Control: Gather Using Speak**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Transfer**: `POST /v2/calls/{id}/actions/transfer` -- [API reference](https://developers.telnyx.com/api/call-control/transfer-call)
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
| `ONCALL_NUMBER` | `string` | `+12125551234` | **yes** | On-call engineer phone | -- |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/merge-ticket-escalation-python
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

### `POST /escalate`

Escalate.

```bash
curl -X POST http://localhost:5000/escalate \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `GET /tickets`

Tickets.

```bash
curl http://localhost:5000/tickets
```

**Response:**

```json
{"status": "ok", "service": "merge-ticket-escalation"}
```

### `GET /escalations`

Escalations.

```bash
curl http://localhost:5000/escalations
```

**Response:**

```json
{"status": "ok", "service": "merge-ticket-escalation"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "merge-ticket-escalation"}
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
| `POST` | `/webhooks/ticket` | Ticket |
| `POST` | `/escalate` | Escalate |
| `POST` | `/webhooks/voice` | Voice |
| `GET` | `/tickets` | Tickets |
| `GET` | `/escalations` | Escalations |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 invalid signature` on `/webhooks/voice` | `TELNYX_PUBLIC_KEY` missing or wrong | Set `TELNYX_PUBLIC_KEY` to the base64 Ed25519 key from [Portal > Account > Keys & Credentials](https://portal.telnyx.com); the value must match the Call Control app sending the events. |
| `500 ONCALL_NUMBER not configured` | `ONCALL_NUMBER` env var is empty | Set `ONCALL_NUMBER` in `.env` to the on-call engineer's number in E.164 format (e.g. `+12125551234`). |
| On-call alert never rings / no webhooks arrive | Webhook URL not reachable or not configured | Confirm `ngrok http 5000` is running and the public URL is set as the Call Control app's Webhook URL ending in `/webhooks/voice`. |
| Ticket webhook returns `skipped` | Ticket priority below threshold | Only `CRITICAL`, `URGENT`, or `HIGH` priority tickets escalate; lower priorities are intentionally ignored. |
| Briefing falls back to generic message | AI Inference call failed | Verify `TELNYX_API_KEY` is valid and `AI_MODEL` is a supported [model](https://developers.telnyx.com/docs/inference/models); check logs for the inference error. |

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

- [call-sentiment-live-escalation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-sentiment-live-escalation-python/README.md) -- escalate a live call based on detected sentiment
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) -- route inbound calls to an AI voice agent with Call Control
- [iot-fleet-alert-escalation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-fleet-alert-escalation-python/README.md) -- on-call phone escalation triggered by fleet alerts
- [merge-employee-hotline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-employee-hotline-python/README.md) -- another Merge-integrated voice workflow

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
