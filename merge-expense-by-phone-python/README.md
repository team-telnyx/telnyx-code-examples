---
name: merge-expense-by-phone
title: "Merge Expense by Phone"
description: "Salesperson calls and dictates an expense using Telnyx Voice and AI Inference with Merge Accounting."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Messaging]
integrations: [Merge Accounting, Merge CRM]
channel: [voice, sms]
---

# Merge Expense by Phone

> Also known as: expense reporting by phone, voice expense logger, expense automation.

Salesperson calls and dictates an expense. AI extracts amount, merchant, category, and deal context. Creates entry in accounting via Merge. Links to CRM opportunity if mentioned. SMS receipt.

## Why Telnyx

Telnyx is AI Communications Infrastructure: voice, messaging, and AI inference run on one private global network, so a single dictated call can be answered, transcribed, structured by an LLM, and confirmed with an SMS receipt without stitching together separate vendors. This example uses Call Control for the inbound voice flow, AI Inference to extract structured expense data, and the Messaging API for the receipt - all behind one API key with usage-based pricing.

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
| `TELNYX_PUBLIC_KEY` | `string` | `eyJ...` | **yes** | Ed25519 public key for webhook signature verification | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number | [Portal](https://portal.telnyx.com/numbers/my-numbers) · [CLI: `telnyx number-orders`](https://developers.telnyx.com/development/cli) |
| `TELNYX_CONNECTION_ID` | `string` | `149440475714` | **yes** | Call Control app ID | [Portal](https://portal.telnyx.com/call-control/applications) · [CLI: `telnyx call-control-applications`](https://developers.telnyx.com/development/cli) |
| `MERGE_API_KEY` | `string` | `your-key` | **yes** | Merge.dev API key | [Merge](https://app.merge.dev/keys) |
| `MERGE_ACCOUNT_TOKEN` | `string` | `your-token` | **yes** | Merge linked account token | [Merge](https://app.merge.dev) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/merge-expense-by-phone-python
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

### `GET /expenses`

Expenses.

```bash
curl http://localhost:5000/expenses
```

**Response:**

```json
{"status": "ok", "service": "merge-expense-by-phone"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "merge-expense-by-phone"}
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
| `GET` | `/expenses` | Expenses |
| `GET` | `/health` | Health |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `401 invalid signature` on `/webhooks/voice` | `TELNYX_PUBLIC_KEY` missing, wrong, or webhook verification disabled | Set `TELNYX_PUBLIC_KEY` to the Ed25519 public key from the [Portal](https://portal.telnyx.com/api-keys); the app logs "Invalid TELNYX_PUBLIC_KEY" at startup if it cannot decode it. |
| Calls connect but no greeting / actions fail | `TELNYX_API_KEY` missing or wrong, so Call Control `answer`/`gather_using_speak` requests fail | Confirm `TELNYX_API_KEY` is set and the key has Call Control permissions. |
| Telnyx never reaches your app | Webhook URL not publicly reachable | Run `ngrok http 5000` and set the Call Control Application webhook URL to `https://<id>.ngrok.io/webhooks/voice`. |
| "I could not extract the expense details" loop | AI Inference call failed or returned no amount | Check `AI_MODEL` is a valid [Inference model](https://developers.telnyx.com/docs/inference/models) and that the key has AI Inference enabled. |
| Expense not created / no SMS receipt | `MERGE_API_KEY` / `MERGE_ACCOUNT_TOKEN` or `TELNYX_PHONE_NUMBER` missing | Set all three; Merge and receipt failures are logged via `app.logger` but do not interrupt the call. |

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

- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) - Call Control voice flow that routes callers to an AI agent.
- [ai-sales-call-with-live-crm-updates-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-sales-call-with-live-crm-updates-python/README.md) - voice call that writes structured data back to CRM via Merge.
- [merge-invoice-collector-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-invoice-collector-python/README.md) - sibling Merge accounting integration over voice.
- [mms-receipt-scanner-expense-tracker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/mms-receipt-scanner-expense-tracker-python/README.md) - expense capture from MMS receipt images.

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
