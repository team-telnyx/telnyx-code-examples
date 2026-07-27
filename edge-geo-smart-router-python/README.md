---
name: edge-geo-smart-router
title: "Edge Geo Smart Router"
description: "Route calls by geography at the edge using Telnyx Voice, AI Inference, and Edge Compute."
language: python
framework: flask
telnyx_products: [Edge Compute, Voice, AI Inference, Call Recording]
channel: [voice]
---

# Edge Geo Smart Router

> Also known as: geo routing, multilingual IVR, GDPR call recording, geographic call routing.

Route calls by geography at the edge. US callers get English AI, LATAM gets Spanish with localized greetings, EU gets GDPR-compliant recording with explicit consent collection.

## Why Telnyx

Telnyx is AI Communications Infrastructure: voice, messaging, and AI inference run on one private global network, so a call can be answered, routed by caller geography, transcribed, and answered by an AI model without leaving Telnyx. This example uses Call Control for region-aware greetings and consent, AI Inference for multilingual replies, and Telnyx Storage for compliant recording archival -- all under a single API key with low-latency edge routing.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` -- [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Gather Using Speak**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Call Control: Record Start**: `POST /v2/calls/{id}/actions/record_start` -- [API reference](https://developers.telnyx.com/api/call-control/start-recording)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
- `call.gather.ended` -- Caller input received (speech or DTMF), app processes response
- `call.recording.saved` -- Recording available for download
- `call.hangup` -- Call ended, cleans up session state and logs outcome

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PUBLIC_KEY` | `string` | _(base64 Ed25519)_ | **yes** | Webhook signature verification key | [Portal > Keys & Credentials](https://portal.telnyx.com/api-keys) |
| `STORAGE_ACCESS_KEY` | `string` | `AKIAIOSFODNN7EXAMPLE` | for recording archival | Telnyx Storage S3 access key (separate from API key) | [Portal > Storage](https://portal.telnyx.com/storage) |
| `STORAGE_SECRET_KEY` | `string` | _(secret)_ | for recording archival | Telnyx Storage S3 secret key | [Portal > Storage](https://portal.telnyx.com/storage) |
| `STORAGE_BUCKET` | `string` | `call-recordings` | for recording archival | S3-compatible bucket name | [Portal > Storage](https://portal.telnyx.com/storage) |
| `STORAGE_REGION` | `string` | `us-east-1` | no | Storage bucket region | [Portal > Storage](https://portal.telnyx.com/storage) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `HOST` | `string` | `127.0.0.1` | no | Server host | -- |
| `PORT` | `integer` | `5000` | no | Server port | -- |

> **Note on Storage:** Telnyx Storage is S3-compatible but uses its **own** access/secret key pair (created under Portal > Storage > Credentials), not the Telnyx API key. If `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY` are not set, recording archival is gracefully skipped — the app still works for routing, greetings, and AI conversation, but recordings won't be archived to Storage.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-geo-smart-router-python
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

### `GET /regions`

Returns the per-region routing config (language, voice, recording, consent).

```bash
curl http://localhost:5000/regions
```

**Response:**

```json
{
  "regions": {
    "US":     {"language": "en-US", "voice": "AWS.Polly.Joanna-Neural", "record": true,  "requires_consent": false},
    "LATAM":  {"language": "es-MX", "voice": "AWS.Polly.Lupe-Neural",   "record": true,  "requires_consent": false},
    "EU":     {"language": "en-GB", "voice": "AWS.Polly.Amy-Neural",     "record": false, "requires_consent": true},
    "DEFAULT":{"language": "en-US", "voice": "AWS.Polly.Joanna-Neural", "record": true,  "requires_consent": false}
  }
}
```

### `GET /health`

Health check with active call count.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "edge-geo-smart-router", "active_calls": 0}
```


## Webhook Endpoints

### `POST /webhooks/voice`

Telnyx sends call events here. Your app processes them and responds with the next action.

**Events handled:**

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
- `call.gather.ended` -- Caller input received (speech or DTMF), app processes response
- `call.recording.saved` -- Recording available for download
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
| `GET` | `/regions` | Regions |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 invalid signature` on `/webhooks/voice` | `TELNYX_PUBLIC_KEY` missing or wrong; webhook verification is rejected | Set `TELNYX_PUBLIC_KEY` (Portal -> Keys & Credentials) to the base64 Ed25519 key. If unset, every webhook is rejected by design. |
| Telnyx never reaches your webhook | Local server not exposed; Webhook URL points at `localhost` | Run `ngrok http 5000` and set the Call Control Application Webhook URL to `https://<id>.ngrok.io/webhooks/voice`. |
| Inference replies with "I'm having trouble right now" | `TELNYX_API_KEY` invalid/missing or `AI_MODEL` not available | Verify `TELNYX_API_KEY` in `.env`, confirm the `AI_MODEL` slug at [Models](https://developers.telnyx.com/docs/inference/models). |
| Caller routed to `DEFAULT` instead of expected region | Number not in E.164 form, or its prefix isn't in `EU_PREFIXES` / `LATAM_PREFIXES` | Ensure the `from` number starts with `+<country code>`; add the prefix to the lists in `app.py`. |
| Recordings not archived | EU caller pressed 2 (no consent), `recording_url` not on a Telnyx host, OR `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` not set | EU recording only starts after consent (digit `1`); non-Telnyx URLs are skipped (SSRF guard); Storage archival is skipped if Storage credentials are missing — set them in `.env` (these are separate from the Telnyx API key; created under Portal > Storage > Credentials). |
| `400 invalid voice` / `language` ignored | Voice id is bare (`"female"`) for a non-`en-US` language | Bare `female`/`male` only work with `service_level: "basic"` (en-US). Use a full voice id like `AWS.Polly.Lupe-Neural` for `es-MX` — the defaults in `REGION_CONFIG` already do this. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [ai-powered-ivr-replacement-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-powered-ivr-replacement-python/README.md) -- AI-driven IVR that replaces menu trees with natural language.
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) -- Connect inbound calls to a Telnyx AI voice agent.
- [record-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-python/README.md) -- Start and retrieve Call Control recordings.
- [edge-compliance-monitor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-compliance-monitor-python/README.md) -- Edge-based compliance and consent monitoring for calls.

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
