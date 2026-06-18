---
name: hosted-messaging-campaign-manager
title: "Hosted Messaging Campaign Manager"
description: "Hosted Messaging Campaign Manager — manage hosted messaging campaigns with subscriber opt-in/out tracking and delivery analytics."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, SMS/MMS]
channel: [sms]
---

# Hosted Messaging Campaign Manager

Hosted Messaging Campaign Manager — manage hosted messaging campaigns with subscriber opt-in/out tracking and delivery analytics.


## Telnyx API Endpoints Used

- **Messaging Profiles**: `GET /v2/messaging_profiles` — [API reference](https://developers.telnyx.com/api/messaging/list-messaging-profiles)
- **Hosted Messaging**: `POST /v2/messages (hosted)` — [API reference](https://developers.telnyx.com/api/messaging/send-message)


## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) and [Messaging](https://developers.telnyx.com/docs/api/v2/messaging) webhook events:

- `message.received` — inbound SMS/MMS received

## Architecture

```text
┌─────────────┐     ┌────────────┐     ┌──────────────────────┐
│   SMS/MMS   │────►│   Telnyx   │────►│  POST /webhooks/sms  │
└─────────────┘     │   Cloud    │     └──────────┬───────────┘
                    └────────────┘                │
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
| `FROM_NUMBER` | `string` | `+18005551234` | **yes** | from number | — |
| `MESSAGING_PROFILE_ID` | `string` | `4001...` | no | Telnyx messaging profile ID | [→ link](https://portal.telnyx.com/messaging/profiles) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hosted-messaging-campaign-manager-python
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

   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

### Docker

```bash
docker build -t hosted-messaging-campaign-manager .
docker run --env-file .env -p 5000:5000 hosted-messaging-campaign-manager
```

## API Reference

### `POST /campaigns`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/campaigns \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Jane Doe",
  "message": "Customer reported issue with service"
}'
```

**Response:**

```json
{
  "campaign_id": "...",
  "campaign": "..."
}
```

### `POST /subscribers`

Adds a new entry.

**Request:**

```bash
curl -X POST http://localhost:5000/subscribers \
  -H "Content-Type: application/json" \
  -d '{
  "numbers": "[]"
}'
```

**Response:**

```json
{
  "added": "...",
  "total": 3
}
```

### `POST /campaigns/<cid>/send`

Sends notifications to applicable recipients.

**Request:**

```bash
curl -X POST http://localhost:5000/campaigns/example-id/send
```

**Response:**

```json
{
  "sent": "...",
  "failed": "...",
  "total_subscribers": 3
}
```

### `GET /subscribers`

Returns all subscribers.

**Request:**

```bash
curl http://localhost:5000/subscribers
```

**Response:**

```json
{
  "total": 3,
  "active": 3,
  "opted_out": "..."
}
```

### `GET /campaigns`

Returns all campaigns.

**Request:**

```bash
curl http://localhost:5000/campaigns
```

**Response:**

```json
{
  "campaigns": "..."
}
```

### `GET /analytics`

Handles `GET /analytics`.

**Request:**

```bash
curl http://localhost:5000/analytics
```

**Response:**

```json
{
  "status": "ok"
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

### `POST /webhooks/messaging`

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

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
