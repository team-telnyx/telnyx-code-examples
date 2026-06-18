---
name: x402-usdc-account-funder
title: "x402 USDC Account Funder"
description: "X402 USDC Account Funder — fund your Telnyx account with USDC cryptocurrency on the Base blockchain."
language: python
framework: flask
telnyx_products: [Migration, Number Porting]
---

# x402 USDC Account Funder

X402 USDC Account Funder — fund your Telnyx account with USDC cryptocurrency on the Base blockchain.


## Telnyx API Endpoints Used

- **x402 Payments**: `POST /v2/balance/fund` — [API reference](https://developers.telnyx.com/api/account)


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
cd telnyx-code-examples/x402-usdc-account-funder-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t x402-usdc-account-funder .
docker run --env-file .env -p 5000:5000 x402-usdc-account-funder
```

## API Reference

### `POST /quote`

Returns quote details.

**Request:**

```bash
curl -X POST http://localhost:5000/quote \
  -H "Content-Type: application/json" \
  -d '{
  "amount_usd": "50.00"
}'
```

**Response:**

```json
{
  "quote": [
    "..."
  ]
}
```

### `POST /pay`

Handles `POST /pay`.

**Request:**

```bash
curl -X POST http://localhost:5000/pay \
  -H "Content-Type: application/json" \
  -d '{
  "quote_id": "abc-123",
  "payment_signature": "example_value"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /balance`

Returns balance details.

**Request:**

```bash
curl http://localhost:5000/balance
```

**Response:**

```json
{
  "balance": [
    "..."
  ]
}
```

### `GET /info`

Handles `GET /info`.

**Request:**

```bash
curl http://localhost:5000/info
```

**Response:**

```json
{
  "chain": "...",
  "chain_id": "...",
  "usdc_contract": "...",
  "min_amount": "...",
  "max_amount": "...",
  "quote_expiry": "...",
  "steps": "..."
}
```

### `GET /quotes`

Returns all quotes.

**Request:**

```bash
curl http://localhost:5000/quotes
```

**Response:**

```json
{
  "quotes": "..."
}
```

### `GET /payments`

Returns all payments.

**Request:**

```bash
curl http://localhost:5000/payments
```

**Response:**

```json
{
  "payments": "..."
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
