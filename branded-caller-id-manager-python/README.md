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

- **Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)
- **Branded Calling**: `POST /v2/branded_calling` — [API reference](https://developers.telnyx.com/api/branded-calling)


## Architecture

```text
┌─────────────┐                        ┌──────────────────────┐
│  API Client │───────────────────────►│     Your App         │
└─────────────┘                        └──────────┬───────────┘
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
cd telnyx-code-examples/branded-caller-id-manager-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t branded-caller-id-manager .
docker run --env-file .env -p 5000:5000 branded-caller-id-manager
```

## API Reference

### `POST /brands`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/brands \
  -H "Content-Type: application/json" \
  -d '{
  "entity_type": "PRIVATE_PROFIT",
  "display_name": "Jane Doe",
  "company_name": "Jane Doe",
  "ein": "example_value",
  "phone": "+12125551234",
  "street": "example_value",
  "city": "example_value",
  "state": "example_value",
  "postal_code": "example_value",
  "country": "US",
  "vertical": "TECHNOLOGY",
  "website": "example_value"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /brands`

Returns all brands.

**Request:**

```bash
curl http://localhost:5000/brands
```

**Response:**

```json
{
  "brands": [
    "..."
  ]
}
```

### `POST /campaigns`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/campaigns \
  -H "Content-Type: application/json" \
  -d '{
  "brand_id": "abc-123",
  "usecase": "MIXED",
  "description": "Customer reported issue with service",
  "sample_message": "[\"Your appointment is tomorrow at 2pm. Reply CONFIRM.\"]",
  "phone_numbers": "[]"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `PUT /numbers/<number>/caller-id`

Updates the record.

**Request:**

```bash
curl -X PUT http://localhost:5000/numbers/example-id/caller-id \
  -H "Content-Type: application/json" \
  -d '{
  "business_name": "Acme Services"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /stir-shaken/status`

Handles `GET /stir-shaken/status`.

**Request:**

```bash
curl http://localhost:5000/stir-shaken/status
```

**Response:**

```json
{
  "number": "...",
  "cnam_enabled": "...",
  "caller_id_name": "...",
  "purchased_at": "..."
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

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
