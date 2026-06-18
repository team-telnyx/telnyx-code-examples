---
name: call-analytics-dashboard-api
title: "Call Analytics Dashboard API — pull CDRs and build usage analytics."
description: "SMS application. Built with Telnyx CDR, Migration, Number Porting, SMS/MMS."
language: python
framework: flask
telnyx_products: [SMS/MMS]
channel: [sms]
---

# Call Analytics Dashboard API — pull CDRs and build usage analytics.

Call Analytics Dashboard API — pull CDRs and build usage analytics.

## Telnyx API Endpoints Used

- **Messaging**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

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

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-analytics-dashboard-api-python
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
docker build -t call-analytics-dashboard-api .
docker run --env-file .env -p 5000:5000 call-analytics-dashboard-api
```

## API Reference

### `GET /analytics/calls`

Handles `GET /analytics/calls`.

**Request:**

```bash
curl http://localhost:5000/analytics/calls
```

**Response:**

```json
{
  "period_days": "...",
  "total_calls": 3,
  "inbound": "...",
  "outbound": "...",
  "avg_duration_secs": "...",
  "total_minutes": 3
}
```

### `GET /analytics/numbers`

Handles `GET /analytics/numbers`.

**Request:**

```bash
curl http://localhost:5000/analytics/numbers
```

**Response:**

```json
{
  "total_numbers": 3,
  "by_status": "..."
}
```

### `GET /analytics/messaging`

Handles `GET /analytics/messaging`.

**Request:**

```bash
curl http://localhost:5000/analytics/messaging
```

**Response:**

```json
{
  "recent_messages": "...",
  "sent": "...",
  "received": "..."
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

## Resources

- [Messaging — API Reference](https://developers.telnyx.com/api/messaging/send-message)
- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
