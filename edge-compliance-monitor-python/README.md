---
name: edge-compliance-monitor
title: "Edge Compliance Monitor"
description: "Real-time compliance checking for regulated call centers using Telnyx Voice, AI Inference, and Edge Compute."
language: python
framework: flask
telnyx_products: [Edge Compute, Voice, AI Inference]
channel: [voice]
---

# Edge Compliance Monitor

> Also known as: TCPA compliance, HIPAA monitoring, call center compliance, real-time compliance, PCI DSS.

Real-time compliance checking for regulated call centers at the edge. AI monitors call transcriptions against TCPA, HIPAA, and PCI rules. Whispers warnings to agents before violations occur.

## Why Telnyx

Telnyx is the AI Communications Infrastructure that runs voice, messaging, and AI inference on one private global network -- so live call audio, on-the-fly transcription, and compliance scoring happen close to the caller without bouncing across third-party clouds. This example pairs Call Control with the Telnyx AI Inference API to evaluate each agent utterance and whisper warnings back into the same call, all behind a single API key.

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
- `call.speak.ended` -- TTS playback finished, transitions to next action
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
cd telnyx-code-examples/edge-compliance-monitor-python
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

### `GET /violations`

Violations.

```bash
curl http://localhost:5000/violations
```

**Response:**

```json
{"status": "ok", "service": "edge-compliance-monitor"}
```

### `GET /calls`

Calls.

```bash
curl http://localhost:5000/calls
```

**Response:**

```json
{"status": "ok", "service": "edge-compliance-monitor"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "edge-compliance-monitor"}
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
| `GET` | `/violations` | Violations |
| `GET` | `/calls` | Calls |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `401 invalid signature` on `/webhooks/voice` | Set `TELNYX_PUBLIC_KEY` to your application's public key from the [Portal](https://portal.telnyx.com/call-control/applications). Verification requires the raw request body and the `telnyx-signature-ed25519` / `telnyx-timestamp` headers; a proxy that rewrites the body or strips headers will break it. Requests older than 300s are rejected as replays -- check your server clock. |
| Webhooks never arrive | Your local server isn't reachable. Restart `ngrok http 5000` and update the Call Control Application Webhook URL to the current `https://<id>.ngrok.io/webhooks/voice`. |
| Calls connect but no compliance whispers | The AI Inference call is failing. Confirm `TELNYX_API_KEY` is set and that `AI_MODEL` is a valid model id; check the server logs for `Compliance check failed`. The compliance check fails open (no violation) so the call still continues. |
| `500` / missing env var on startup | Ensure `.env` exists with at least `TELNYX_API_KEY`. Run `cp .env.example .env` and fill in values, then restart `python app.py`. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) -- route inbound calls to an AI voice agent with Call Control
- [call-whisper-monitoring-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-python/README.md) -- whisper coaching to agents during live calls
- [edge-fraud-firewall-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-fraud-firewall-python/README.md) -- real-time fraud screening at the edge
- [compliance-call-recorder-ai-auditor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/compliance-call-recorder-ai-auditor-python/README.md) -- record calls and AI-audit them for compliance

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
