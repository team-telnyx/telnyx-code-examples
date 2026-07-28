---
name: merge-employee-onboarding
title: "Merge Employee Onboarding"
description: "New employee webhook from Merge HRIS triggers full provisioning: Telnyx phone number, AI voicemail greeting, welcome SMS with IT setup instructions, and IT ticket via Merge Ticketing."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Messaging, Numbers]
integrations: [Merge HRIS, Merge Ticketing]
channel: [voice, sms]
---

# Merge Employee Onboarding

> Also known as: employee onboarding, new hire automation, HR provisioning, onboarding workflow.

New employee webhook from Merge HRIS triggers full provisioning: Telnyx phone number, AI voicemail greeting, welcome SMS with IT setup instructions, and IT ticket via Merge Ticketing.

## Why Telnyx

This onboarding flow provisions a phone number, generates an AI voicemail greeting, and sends welcome SMS in a single handler -- because Telnyx runs voice, messaging, and AI inference on one private global network as **AI Communications Infrastructure**. Numbers ordered here are immediately routable to your Call Control application, and AI Inference responds on the same low-latency backbone, so a new hire is fully reachable the moment Merge fires the webhook -- no stitching together separate carrier, SMS, and model vendors.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Send Message (SMS)**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Search Available Numbers**: `GET /v2/available_phone_numbers` -- [API reference](https://developers.telnyx.com/api/numbers/list-available-phone-numbers)
- **Order Numbers**: `POST /v2/number_orders` -- [API reference](https://developers.telnyx.com/api/numbers/create-number-order)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):



## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number | [Portal](https://portal.telnyx.com/numbers/my-numbers) · [CLI: `telnyx number-orders`](https://developers.telnyx.com/development/cli) |
| `TELNYX_CONNECTION_ID` | `string` | `149440475714` | **yes** | Call Control app ID | [Portal](https://portal.telnyx.com/call-control/applications) · [CLI: `telnyx call-control-applications`](https://developers.telnyx.com/development/cli) |
| `MERGE_API_KEY` | `string` | `your-key` | **yes** | Merge.dev API key | [Merge](https://app.merge.dev/keys) |
| `MERGE_ACCOUNT_TOKEN` | `string` | `your-token` | **yes** | Merge linked account token | [Merge](https://app.merge.dev) |
| `IT_ADMIN_PHONE` | `string` | `+12125551234` | no | IT admin phone | -- |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/merge-employee-onboarding-python
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

### `POST /onboard`

Onboard.

```bash
curl -X POST http://localhost:5000/onboard \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `GET /onboardings`

Onboardings.

```bash
curl http://localhost:5000/onboardings
```

**Response:**

```json
{"status": "ok", "service": "merge-employee-onboarding"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "merge-employee-onboarding"}
```


## Webhook Endpoints

### `POST /webhooks/voice`

Telnyx sends call events here. Your app processes them and responds with the next action.

**Events handled:**



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
| `POST` | `/webhooks/hris` | Hris |
| `POST` | `/onboard` | Onboard |
| `GET` | `/onboardings` | Onboardings |
| `GET` | `/health` | Health |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Unauthorized` from Telnyx | Missing or wrong `TELNYX_API_KEY` | Verify the v2 key in your `.env` against the [Portal](https://portal.telnyx.com/api-keys); restart the app so `load_dotenv()` re-reads it |
| `number_provisioning_failed` action returned | No matching numbers, or `TELNYX_CONNECTION_ID` unset/invalid | Confirm a Call Control Application exists and set its ID in `.env`; numbers can only be ordered against a valid connection |
| Welcome SMS never arrives | `TELNYX_PHONE_NUMBER` unset, or employee record has no `phone_numbers` value | Set a verified Telnyx `from` number; the SMS step is skipped when either the source or the employee personal phone is missing |
| `Merge GET/POST rejected non-Merge host` in logs | A path resolved off the trusted `api.merge.dev` host | Pass only relative Merge paths (e.g. `/hris/v1/employees/{id}`); the SSRF guard in `_merge_url()` blocks anything else |
| HRIS webhook returns `404 Employee not found` | `MERGE_API_KEY` / `MERGE_ACCOUNT_TOKEN` wrong, or the `id` in the payload is unknown to Merge | Re-check both Merge credentials and confirm the linked account token matches the HRIS integration |

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

- [merge-employee-hotline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-employee-hotline-python/README.md) -- AI phone line backed by Merge HRIS employee data
- [merge-ticket-escalation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-ticket-escalation-python/README.md) -- create and escalate tickets via Merge Ticketing
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) -- route the newly provisioned number to an AI agent
- [send-sms-notifications-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-python/README.md) -- standalone outbound SMS notification patterns

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
