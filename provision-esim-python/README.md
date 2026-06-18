---
name: provision-esim
title: "Production-ready Flask application for eSIM provisioning via Telnyx."
description: "Application. Built with Telnyx IoT/SIM, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [IoT/SIM, Migration, Number Porting]
---

# Production-ready Flask application for eSIM provisioning via Telnyx.

Production-ready Flask application for eSIM provisioning via Telnyx.


## Telnyx API Endpoints Used

- **SIM Cards: Activate**: `POST /v2/sim_cards/{id}/actions/enable` — [API reference](https://developers.telnyx.com/api/sim-cards/sim-card-actions)
- **eSIM Provisioning**: `POST /v2/sim_cards/actions/bulk_set_public_ips` — [API reference](https://developers.telnyx.com/api/sim-cards)


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
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t provision-esim .
docker run --env-file .env -p 5000:5000 provision-esim
```

## API Reference

### `POST /esim/profiles`

Handles `POST /esim/profiles`.

**Request:**

```bash
curl -X POST http://localhost:5000/esim/profiles \
  -H "Content-Type: application/json" \
  -d '{
  "device_name": "Jane Doe",
  "sim_card_group_id": "abc-123"
}'
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `POST /esim/profiles/<sim_card_id>/activate`

Handles `POST /esim/profiles/<sim_card_id>/activate`.

**Request:**

```bash
curl -X POST http://localhost:5000/esim/profiles/example-id/activate
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `GET /esim/profiles/<sim_card_id>`

Returns esim details.

**Request:**

```bash
curl http://localhost:5000/esim/profiles/example-id
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `GET /esim/profiles`

Returns all esims.

**Request:**

```bash
curl http://localhost:5000/esim/profiles
```

**Response:**

```json
{
  "status_code": "..."
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

### `POST /esim/webhooks/sim-status`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
