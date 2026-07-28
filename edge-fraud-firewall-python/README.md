---
name: edge-fraud-firewall
title: "Edge Fraud Firewall"
description: "Screen every inbound call at the edge with Telnyx Voice, Number Lookup, and AI Inference."
language: python
framework: flask
telnyx_products: [Edge Compute, Number Lookup, Voice, AI Inference]
channel: [voice]
---

# Edge Fraud Firewall

> Also known as: call screening, fraud detection, spam filter, robocall blocker, call firewall, STIR/SHAKEN verification.

Screen every inbound call at the edge. Runs number lookup, velocity checks, AI classification, and blocklist matching before your app sees the call. Legitimate calls pass through; fraud gets rejected with cause code.

## Why Telnyx

Telnyx is AI Communications Infrastructure: voice, messaging, number intelligence, and AI inference run on one private global network instead of stitched-together third parties. This firewall screens callers with Number Lookup and an AI classifier and rejects or transfers the call -- all from the same platform that carries the call, so screening happens before fraud ever touches your application. Low-latency Call Control and inference on a single backbone keep the screen-then-route decision fast enough to sit inline on every inbound call.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` -- [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Transfer**: `POST /v2/calls/{id}/actions/transfer` -- [API reference](https://developers.telnyx.com/api/call-control/transfer-call)
- **Call Control: Reject**: `POST /v2/calls/{id}/actions/reject` -- [API reference](https://developers.telnyx.com/api/call-control/reject-call)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Number Lookup**: `GET /v2/number_lookup/{phone}` -- [API reference](https://developers.telnyx.com/api/number-lookup/lookup-number)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
- `call.speak.ended` -- TTS playback finished, transitions to next action
- `call.hangup` -- Call ended, cleans up session state and logs outcome

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_CONNECTION_ID` | `string` | `149440475714` | **yes** | Call Control app ID | [Portal](https://portal.telnyx.com/call-control/applications) · [CLI: `telnyx call-control-applications`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-fraud-firewall-python
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

### `GET /blocklist`

Blocklist.

```bash
curl http://localhost:5000/blocklist
```

**Response:**

```json
{"status": "ok", "service": "edge-fraud-firewall"}
```

### `POST /blocklist`

Blocklist.

```bash
curl -X POST http://localhost:5000/blocklist \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `GET /stats`

Stats.

```bash
curl http://localhost:5000/stats
```

**Response:**

```json
{"status": "ok", "service": "edge-fraud-firewall"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "edge-fraud-firewall"}
```


## Webhook Endpoints

### `POST /webhooks/voice`

Telnyx sends call events here. Your app processes them and responds with the next action.

**Events handled:**

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
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
| `GET` | `/blocklist` | Blocklist |
| `POST` | `/blocklist` | Blocklist |
| `GET` | `/stats` | Stats |
| `GET` | `/health` | Health |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 invalid signature` on `/webhooks/voice` | `TELNYX_PUBLIC_KEY` is missing or wrong, so `client.webhooks.unwrap()` rejects the request | Copy the public key from your [Call Control Application](https://portal.telnyx.com/call-control/applications) into `.env` as `TELNYX_PUBLIC_KEY` and restart |
| Webhooks never arrive / no logs on inbound calls | Webhook URL not reachable -- ngrok tunnel down or wrong path configured in the Portal | Confirm `ngrok http 5000` is running and the Application Webhook URL ends in `/webhooks/voice` |
| App exits or 500s on startup | Required env var missing (`TELNYX_API_KEY` or `TELNYX_CONNECTION_ID`) | Ensure `.env` exists (`cp .env.example .env`) and both keys are filled from the [Portal](https://portal.telnyx.com/api-keys) |
| Every caller classified `CLEAN` (no blocking) | AI inference call failed and fell back to `CLEAN`, or Number Lookup returned no carrier data | Check `Classification failed` / `Number lookup failed` in the logs, verify `AI_MODEL` is valid, and confirm the API key has Inference access |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx call-control-applications list
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [number-lookup-fraud-screener-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/number-lookup-fraud-screener-python/README.md) -- Score and screen callers with Number Lookup reputation data
- [fraud-alert-verification-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/fraud-alert-verification-python/README.md) -- Verify suspicious activity with an outbound confirmation call
- [edge-geo-smart-router-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-geo-smart-router-python/README.md) -- Route inbound calls at the edge based on caller geography
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) -- Forward screened, verified calls to an AI voice agent

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
