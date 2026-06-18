---
name: post-service-followup-engine
title: "Post-Service Follow-Up Engine"
description: "After appointment, SMS satisfaction survey. Negative responses trigger AI voice callback to understand the issue, then creates ticket in Jira and alerts manager via Slack."
language: python
framework: flask
telnyx_products: [Voice, AI Inference]
integrations: [Jira, HubSpot, Slack]
channel: [voice, sms]
---

# Post-Service Follow-Up Engine

After appointment, SMS satisfaction survey. Negative responses trigger AI voice callback to understand the issue, then creates ticket in Jira and alerts manager via Slack.

## Telnyx API Endpoints Used

- **Call Control: Speak (TTS)**: `POST /v2/calls/{call_control_id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Gather (STT/DTMF)**: `POST /v2/calls/{call_control_id}/actions/gather_using_speak` — [API reference](https://developers.telnyx.com/api/call-control/gather)
- **AI Inference (Chat Completions)**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) and [Messaging](https://developers.telnyx.com/docs/api/v2/messaging) webhook events:

- `call.answered` — call connected, app speaks greeting
- `call.speak.ended` — TTS finished, app starts listening
- `call.gather.ended` — caller input received (speech or DTMF)
- `call.hangup` — call ended, app cleans up session

## External Service Integrations

- **Jira** — Issue/ticket creation, project tracking ([docs](https://developer.atlassian.com/cloud/jira/platform/rest/v3))
- **HubSpot** — CRM contacts, deal updates ([docs](https://developers.hubspot.com/docs/api))
- **Slack** — Team notifications via incoming webhooks ([docs](https://api.slack.com/messaging/webhooks))

## Architecture

```text
┌─────────────┐     ┌────────────┐     ┌──────────────────────┐
│  Phone Call  │────►│            │────►│  POST /webhooks/voice│
│  or SMS/MMS  │     │   Telnyx   │     │  POST /webhooks/sms  │
└─────────────┘     │   Cloud    │     └──────────┬───────────┘
                    └────────────┘                │
                                                   │
                                          ┌────────┴────────┐
                                          │ Telnyx Inference │
                                          │ (AI processing) │
                                          └────────┬────────┘
                                                   │
                                          ┌────────┴────────┐
                                          │ Jira             │
                                          ├─────────────────┤
                                          │ HubSpot          │
                                          ├─────────────────┤
                                          │ Slack            │
                                          └────────┬────────┘
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │ Response (SMS/  │
                                          │ Voice/Webhook)  │
                                          └─────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [→ link](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [→ link](https://portal.telnyx.com/numbers/my-numbers) |
| `CONNECTION_ID` | `string` | `1234567890` | **yes** | Call Control connection ID | [→ link](https://portal.telnyx.com/call-control/applications) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Inference model identifier | [→ link](https://developers.telnyx.com/docs/inference/models) |
| `JIRA_URL` | `string` | `https://co.atlassian.net` | no | Jira instance URL | — |
| `JIRA_EMAIL` | `string` | `you@company.com` | no | Jira account email | — |
| `JIRA_TOKEN` | `string` | `ATATT...` | no | Jira API token | [→ link](https://id.atlassian.com/manage/api-tokens) |
| `JIRA_PROJECT` | `string` | `SUP` | no | Jira project key for ticket creation | [→ link](https://id.atlassian.com/manage/api-tokens) |
| `JIRA_PROJECT` | `string` | `SUP` | no | Jira project key | — |
| `MANAGER_SLACK_WEBHOOK` | `string` | `https://hooks.slack.com/...` | no | Slack webhook for manager alerts | [→ link](https://api.slack.com/messaging/webhooks) |
| `HUBSPOT_API_KEY` | `string` | `pat-...` | no | HubSpot private app token | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/post-service-followup-engine-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`
   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

### Docker

```bash
docker build -t post-service-followup-engine .
docker run --env-file .env -p 5000:5000 post-service-followup-engine
```

## API Reference

### `POST /follow-up/send`

Sends notifications to applicable recipients.

**Request:**

```bash
curl -X POST http://localhost:5000/follow-up/send \
  -H "Content-Type: application/json" \
  -d '{
  "phone": "+12125551234",
  "service": "service",
  "tech": "our technician"
}'
```

**Response:**

```json
{
  "follow_up_id": "...",
  "status": "ok"
}
```

### `GET /follow-ups`

Returns all followups.

**Request:**

```bash
curl http://localhost:5000/follow-ups
```

**Response:**

```json
{
  "followups": [
    "..."
  ]
}
```

### `GET /health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Webhook Endpoints

### `POST /webhooks/sms`

Receives [Telnyx Messaging](https://developers.telnyx.com/docs/messaging) webhook events.

**Example inbound payload:**

```json
{
  "data": {
    "event_type": "message.received",
    "direction": "inbound",
    "payload": {
      "id": "f5d7a7e0-1234-5678-9abc-def012345678",
      "from": {
        "phone_number": "+12125551234",
        "carrier": "Verizon",
        "line_type": "Wireless"
      },
      "to": [
        {
          "phone_number": "+13105559876"
        }
      ],
      "text": "HELP",
      "type": "SMS",
      "media": [],
      "received_at": "2026-07-15T14:30:00Z"
    }
  }
}
```

### `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.answered`, `call.speak.ended`, `call.gather.ended`, `call.hangup`

**Example inbound payload:**

```json
{
  "data": {
    "event_type": "call.initiated",
    "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
    "connection_id": "1494404757140276705",
    "direction": "incoming",
    "from": "+12125551234",
    "to": "+13105559876",
    "call_leg_id": "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
    "client_state": null,
    "state": "ringing"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://your-server.example.com/webhooks/voice"
  }
}
```

## Resources

- [Call Control: Speak (TTS) — API Reference](https://developers.telnyx.com/api/call-control/speak)
- [AI Inference (Chat Completions) — API Reference](https://developers.telnyx.com/api/inference/chat-completions)
- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
- [Jira Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3)
- [HubSpot Documentation](https://developers.hubspot.com/docs/api)
- [Slack Documentation](https://api.slack.com/messaging/webhooks)
