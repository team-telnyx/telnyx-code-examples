---
name: edge-ivr-ab-tester
title: "Edge IVR A/B Tester"
description: "A/B test different IVR flows at the edge."
language: python
framework: flask
telnyx_products: [Edge Compute, Voice, AI Inference]
channel: [voice]
---

# Edge IVR A/B Tester

> Also known as: IVR testing, A/B test phone menu, call flow optimization, IVR analytics.

A/B test different IVR flows at the edge. Randomly assigns callers to variants, tracks completion rates per variant, and auto-promotes the winner when statistical significance is reached.

## Why Telnyx

Telnyx is AI Communications Infrastructure: voice, messaging, and AI inference run on one private global network, so the call control, text-to-speech, and AI Inference calls this experiment relies on share a single API and the same low-latency backbone. Routing IVR variant logic and TTS prompts through Telnyx Call Control keeps caller audio and decisioning close to the edge, reducing latency on every gather and speak action. One key and one platform cover answering calls, gathering DTMF/speech, and running model inference -- no stitching together separate vendors.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` -- [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Gather Using Speak**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
- `call.gather.ended` -- Caller input received (speech or DTMF), app processes response
- `call.hangup` -- Call ended, cleans up session state and logs outcome

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-ivr-ab-tester-python
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

### `POST /experiments`

Experiments.

```bash
curl -X POST http://localhost:5000/experiments \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `GET /experiments`

Experiments.

```bash
curl http://localhost:5000/experiments
```

**Response:**

```json
{"status": "ok", "service": "edge-ivr-ab-tester"}
```

### `GET /experiments/<exp_id>`

<Exp Id>.

```bash
curl http://localhost:5000/experiments/<exp_id>
```

**Response:**

```json
{"status": "ok", "service": "edge-ivr-ab-tester"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "edge-ivr-ab-tester"}
```


## Webhook Endpoints

### `POST /webhooks/voice`

Telnyx sends call events here. Your app processes them and responds with the next action.

**Events handled:**

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
- `call.gather.ended` -- Caller input received (speech or DTMF), app processes response
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
| `POST` | `/experiments` | Experiments |
| `GET` | `/experiments` | Experiments |
| `GET` | `/experiments/<exp_id>` | <Exp Id> |
| `POST` | `/webhooks/voice` | Voice |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| `401 invalid signature` on `/webhooks/voice` | `TELNYX_PUBLIC_KEY` is unset, malformed, or webhook signature verification is disabled | Set `TELNYX_PUBLIC_KEY` to the base64 Ed25519 key from [Portal -> Keys & Credentials](https://portal.telnyx.com); it must be the public key for the same account/app sending the events. |
| `TELNYX_API_KEY` missing or `401` from the Telnyx API | The API key env var is empty or wrong | Copy `.env.example` to `.env` and set `TELNYX_API_KEY` from [Portal API Keys](https://portal.telnyx.com/api-keys), then restart `python app.py`. |
| Webhooks never arrive | Local server not reachable from Telnyx | Run `ngrok http 5000` and set the Call Control Application Webhook URL to `https://<id>.ngrok.io/webhooks/voice`. |
| All callers land on variant `A` / no split happens | No experiment created, so `get_variant` defaults to `A` | `POST /experiments` to create one before testing; both variants need `MIN_SAMPLE_SIZE` calls (default 100) before a winner is auto-promoted. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [smart-ivr-ab-tester-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/smart-ivr-ab-tester-python/README.md) -- IVR A/B testing without the edge layer
- [ai-powered-ivr-replacement-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-powered-ivr-replacement-python/README.md) -- replace a menu-driven IVR with an AI voice agent
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) -- route inbound calls into an AI agent flow
- [edge-geo-smart-router-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-geo-smart-router-python/README.md) -- edge sibling that routes calls by geography

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
- [Telnyx Portal](https://portal.telnyx.com)
