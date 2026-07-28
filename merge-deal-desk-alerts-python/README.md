---
name: merge-deal-desk-alerts
title: "Merge Deal Desk Alerts"
description: "CRM webhook fires when a deal moves to negotiation, triggering Telnyx Voice and AI Inference alerts with Merge CRM."
language: python
framework: flask
telnyx_products: [Voice, AI Inference]
integrations: [Merge CRM]
channel: [voice]
---

# Merge Deal Desk Alerts

> Also known as: deal alerts, CRM voice alerts, sales notifications, deal desk automation.

CRM webhook fires when a deal moves to negotiation or exceeds a revenue threshold. Calls VP Sales with AI-generated spoken briefing. VP can say connect me to warm-transfer to the account executive.

## Why Telnyx

Telnyx is AI Communications Infrastructure: outbound voice, AI inference, and real-time warm transfers run on one private global network, so a CRM event can place a call, speak an AI-generated briefing, and connect the VP to the account executive without stitching together separate vendors. Programmable Call Control and the AI Inference API let you turn deal data into a spoken alert and route the live call in a single workflow, billed per-minute with no per-message markup. The same network carries the media end to end, keeping latency low for the gather/speak/transfer loop that makes these alerts feel real-time.

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
| `VP_SALES_NUMBER` | `string` | `+12125551234` | **yes** | VP Sales phone number | -- |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/merge-deal-desk-alerts-python
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

### `POST /alert`

Alert.

```bash
curl -X POST http://localhost:5000/alert \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `GET /deals`

Deals.

```bash
curl http://localhost:5000/deals
```

**Response:**

```json
{"status": "ok", "service": "merge-deal-desk-alerts"}
```

### `GET /alerts`

Alerts.

```bash
curl http://localhost:5000/alerts
```

**Response:**

```json
{"status": "ok", "service": "merge-deal-desk-alerts"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "merge-deal-desk-alerts"}
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
| `POST` | `/webhooks/crm` | Crm |
| `POST` | `/alert` | Alert |
| `POST` | `/webhooks/voice` | Voice |
| `GET` | `/deals` | Deals |
| `GET` | `/alerts` | Alerts |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| `/webhooks/voice` returns `401 invalid signature` | `TELNYX_PUBLIC_KEY` missing or wrong | Copy the Ed25519 public key from [Portal -> Keys & Credentials](https://portal.telnyx.com) into `.env`; it must match the Call Control app sending the events. |
| Alert call never places (`Failed to place alert call`) | Missing `TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`, `TELNYX_PHONE_NUMBER`, or `VP_SALES_NUMBER` | Confirm every required variable in `.env` is set; the Connection ID must be the Call Control Application whose webhook points at this server. |
| Voice events never arrive after the call connects | Webhook URL not reachable from Telnyx | Expose the server with `ngrok http 5000` and set the Call Control app webhook to `https://<id>.ngrok.io/webhooks/voice`; `localhost` will not receive events. |
| Deal alerts get skipped (`Below threshold`) or briefing is generic | Stage not in `ALERT_STAGES`, amount under `DEAL_THRESHOLD`, or Merge token invalid | Verify `MERGE_API_KEY` / `MERGE_ACCOUNT_TOKEN`, lower `DEAL_THRESHOLD`, or send a stage like `negotiation`; check `app.logger` output for `Merge GET ... failed`. |

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

- [merge-pipeline-briefing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-pipeline-briefing-python/README.md) - pull a CRM pipeline summary and deliver it as a spoken briefing.
- [warm-transfer-ai-briefing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-ai-briefing-python/README.md) - AI-generated briefing on a live warm transfer between agents.
- [transfer-live-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-python/README.md) - Call Control transfer mechanics used to connect the VP to the rep.
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) - route inbound calls into an AI voice agent with gather/speak.

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
