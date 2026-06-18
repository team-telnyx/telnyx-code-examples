---
name: e911-address-validator
title: "E911 Address Validator — validate and provision E911 addresses via API."
description: "Application. Built with Telnyx E911, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [E911, Migration, Number Porting]
---

# E911 Address Validator — validate and provision E911 addresses via API.

E911 Address Validator — validate and provision E911 addresses via API.


## Telnyx API Endpoints Used

- **Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)
- **E911 Addresses**: `POST /v2/addresses` — [API reference](https://developers.telnyx.com/api/e911/list-addresses)


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
cd telnyx-code-examples/e911-address-validator-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t e911-address-validator .
docker run --env-file .env -p 5000:5000 e911-address-validator
```

## API Reference

### `POST /e911/validate`

Adds a new entry.

**Request:**

```bash
curl -X POST http://localhost:5000/e911/validate \
  -H "Content-Type: application/json" \
  -d '{
  "street": "example_value",
  "street2": "example_value",
  "city": "example_value",
  "state": "example_value",
  "zip": "example_value",
  "country": "US",
  "business_name": "Acme Services"
}'
```

**Response:**

```json
{
  "valid": "...",
  "address_id": "...",
  "address": "..."
}
```

### `POST /e911/assign`

Assigns to a team member. Notifies both assignee and customer.

**Request:**

```bash
curl -X POST http://localhost:5000/e911/assign \
  -H "Content-Type: application/json" \
  -d '{
  "address_id": "123 Main St, Apt 4"
}'
```

**Response:**

```json
{
  "status": "ok",
  "phone": "...",
  "address_id": "..."
}
```

### `GET /e911/addresses`

Returns all addresses.

**Request:**

```bash
curl http://localhost:5000/e911/addresses
```

**Response:**

```json
{
  "addresses": "..."
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
