---
name: porting-loa-automation
title: "Porting LOA Automation"
description: "Porting LOA Automation — automate Letter of Authorization generation and porting order submission."
language: python
framework: flask
telnyx_products: [Migration, Missions, Number Porting]
---

# Porting LOA Automation

Porting LOA Automation — automate Letter of Authorization generation and porting order submission.


## Telnyx API Endpoints Used

- **Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)
- **Porting Orders**: `POST /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/create-porting-order)


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
cd telnyx-code-examples/porting-loa-automation-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t porting-loa-automation .
docker run --env-file .env -p 5000:5000 porting-loa-automation
```

## API Reference

### `POST /loa/generate`

Handles `POST /loa/generate`.

**Request:**

```bash
curl -X POST http://localhost:5000/loa/generate \
  -H "Content-Type: application/json" \
  -d '{
  "authorized_person": "example_value",
  "current_provider": "abc-123",
  "phone_numbers": "[]",
  "billing_number": "example_value",
  "account_number": 4,
  "service_address": "123 Main St, Apt 4",
  "title": "example_value",
  "company": "Acme Corp"
}'
```

**Response:**

```json
{
  "loa_id": "...",
  "loa_text": "...",
  "record": "..."
}
```

### `POST /loa/submit-and-port`

Handles `POST /loa/submit-and-port`.

**Request:**

```bash
curl -X POST http://localhost:5000/loa/submit-and-port \
  -H "Content-Type: application/json" \
  -d '{
  "phone_numbers": "+12125551234",
  "authorized_person": "example_value",
  "current_provider": "abc-123",
  "billing_number": "example_value"
}'
```

**Response:**

```json
{
  "loa_id": "...",
  "porting_order": "...",
  "pipeline": "..."
}
```

### `POST /loa/check-portability`

Handles `POST /loa/check-portability`.

**Request:**

```bash
curl -X POST http://localhost:5000/loa/check-portability \
  -H "Content-Type: application/json" \
  -d '{
  "phone_numbers": "[]"
}'
```

**Response:**

```json
{
  "results": "..."
}
```

### `GET /loa`

Returns all loas.

**Request:**

```bash
curl http://localhost:5000/loa
```

**Response:**

```json
{
  "loas": "..."
}
```

### `GET /pipeline`

Handles `GET /pipeline`.

**Request:**

```bash
curl http://localhost:5000/pipeline
```

**Response:**

```json
{
  "pipeline": "..."
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
