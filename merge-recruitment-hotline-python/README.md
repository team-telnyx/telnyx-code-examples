---
name: merge-recruitment-hotline
title: "Merge Recruitment Hotline"
description: "Job seekers call a recruitment hotline powered by Telnyx Voice, AI Inference, and Messaging with Merge ATS."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Messaging]
integrations: [Merge ATS]
channel: [voice, sms]
---

# Merge Recruitment Hotline

> Also known as: recruitment phone line, job application by phone, ATS voice interface.

Job seekers call. AI asks what role they want, searches open positions in ATS via Merge, describes top matches conversationally, and submits applications on their behalf with SMS confirmation.

## Why Telnyx

Telnyx is the AI Communications Infrastructure that runs voice, messaging, and AI inference on one owned, private global network - so the call audio, the TTS, the LLM that describes job matches, and the confirmation SMS all live behind a single API and key. This example uses Telnyx Call Control for the inbound phone leg, the Telnyx AI Inference endpoint for conversational job descriptions, and the Messaging API for the confirmation text, with no third-party telecom or model providers to stitch together. Keeping it on one low-latency backbone means faster spoken responses and one bill, one SLA, and one support team for the whole hotline.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` -- [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Gather Using Speak**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Hangup**: `POST /v2/calls/{id}/actions/hangup` -- [API reference](https://developers.telnyx.com/api/call-control/hangup)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Send Message (SMS)**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

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
| `TELNYX_CONNECTION_ID` | `string` | `149440475714` | **yes** | Call Control app ID | [Portal](https://portal.telnyx.com/call-control/applications) · [CLI: `telnyx call-control-applications`](https://developers.telnyx.com/development/cli) |
| `MERGE_API_KEY` | `string` | `your-key` | **yes** | Merge.dev API key | [Merge](https://app.merge.dev/keys) |
| `MERGE_ACCOUNT_TOKEN` | `string` | `your-token` | **yes** | Merge linked account token | [Merge](https://app.merge.dev) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/merge-recruitment-hotline-python
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

### `GET /jobs`

Jobs.

```bash
curl http://localhost:5000/jobs
```

**Response:**

```json
{"status": "ok", "service": "merge-recruitment-hotline"}
```

### `GET /applications`

Applications.

```bash
curl http://localhost:5000/applications
```

**Response:**

```json
{"status": "ok", "service": "merge-recruitment-hotline"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "merge-recruitment-hotline"}
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
| `GET` | `/jobs` | Jobs |
| `GET` | `/applications` | Applications |
| `GET` | `/health` | Health |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Webhook returns `401 invalid signature` | `TELNYX_PUBLIC_KEY` is missing or wrong, so Ed25519 verification fails (and is disabled when unset) | Set `TELNYX_PUBLIC_KEY` to the base64 public key from [Portal -> Keys & Credentials](https://portal.telnyx.com/keys); confirm it matches the Call Control application sending the webhook. |
| Call connects but no greeting plays | Webhook URL not reachable, or a required env var (`TELNYX_API_KEY` / `TELNYX_CONNECTION_ID`) is unset | Verify the ngrok tunnel is up and the Portal webhook URL points at `https://<id>.ngrok.io/webhooks/voice`; check the API key and connection ID are loaded from `.env`. |
| "I could not find matching positions" for every search | Merge credentials wrong or no `OPEN` jobs in the linked ATS | Confirm `MERGE_API_KEY` and `MERGE_ACCOUNT_TOKEN`, then `curl http://localhost:5000/jobs` to see what the ATS returns. |
| Application submits but no confirmation SMS arrives | `TELNYX_PHONE_NUMBER` unset, or the number is not SMS-enabled / not on the connection | Set `TELNYX_PHONE_NUMBER` to a messaging-enabled Telnyx number and check the app logs for `Confirmation SMS failed`. |

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

- [merge-interview-pipeline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-interview-pipeline-python/README.md) - voice-driven interview pipeline updates against a Merge ATS.
- [edge-merge-reference-checker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-merge-reference-checker-python/README.md) - automated reference checks over Merge for hiring workflows.
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) - route inbound Call Control calls into a Telnyx AI voice agent.
- [ai-phone-story-hotline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-phone-story-hotline-python/README.md) - another inbound voice hotline using gather-using-speak and AI inference.

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
