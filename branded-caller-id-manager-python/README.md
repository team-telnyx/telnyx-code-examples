---
name: branded-caller-id-manager
title: "Branded Caller ID Manager"
description: "Branded Caller ID Manager — register, manage, and verify branded calling profiles with STIR/SHAKEN attestation for higher answer rates."
language: python
framework: flask
telnyx_products: [Branded Calling, CNAM Lookup, Migration, Number Porting, Verify]
---

# Branded Caller ID Manager

Branded Caller ID Manager — register, manage, and verify branded calling profiles with STIR/SHAKEN attestation for higher answer rates.

## Telnyx API Endpoints Used

- **Update Number**: `PATCH /v2/phone_numbers/{id}` — [API reference](https://developers.telnyx.com/api/numbers/update-phone-number)
- **CNAM Listing**: `POST /v2/cnam_requests` — [API reference](https://developers.telnyx.com/api/cnam/create-cnam-request)
- **Number Lookup**: `GET /v2/number_lookup/{phone_number}` — [API reference](https://developers.telnyx.com/api/number-lookup/lookup-number)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Verify API
           ├──► Telnyx Number Lookup
           ├──► Telnyx Number Porting
           │
           ▼
     JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/branded-caller-id-manager-python
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

### Docker

```bash
docker build -t branded-caller-id-manager-python .
docker run --env-file .env -p 5000:5000 branded-caller-id-manager-python
```

## API Reference

### `POST /brands`

Triggers brands

```bash
curl -X POST http://localhost:5000/brands \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

### `GET /brands`

Returns brands

```bash
curl http://localhost:5000/brands
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `POST /campaigns`

Triggers campaigns

```bash
curl -X POST http://localhost:5000/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Summer Outreach",
    "recipients": ["+12125551234", "+13105559876"],
    "message": "Your appointment reminder for tomorrow at 2 PM"
  }'
```

**Response:**

```json
{
  "campaign_id": "camp-1750280400",
  "status": "created",
  "recipients": 150,
  "scheduled_at": "2026-07-15T09:00:00Z"
}
```

### `PUT /numbers/<number>/caller-id`

Triggers caller-id

```bash
curl -X PUT http://localhost:5000/numbers/example-id/caller-id
```

**Response:**

```json
{
  "calls": [
    {
      "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "from": "+18005551234",
      "to": "+12125559876",
      "duration_seconds": 145,
      "status": "completed"
    }
  ]
}
```

### `GET /stir-shaken/status`

Returns status

```bash
curl http://localhost:5000/stir-shaken/status
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /campaigns`

Returns campaigns

```bash
curl http://localhost:5000/campaigns
```

**Response:**

```json
{
  "campaigns": [
    {
      "id": "camp-1750280400",
      "name": "Summer Outreach",
      "status": "active",
      "sent": 120,
      "delivered": 115,
      "failed": 5
    }
  ]
}
```

### `GET /health`

Returns health

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "active_sessions": 2,
  "version": "1.0.0"
}
```

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
