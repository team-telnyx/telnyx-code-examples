---
name: wireless-fleet-activation-portal
title: "Wireless Fleet Activation Portal — bulk activate SIMs with status tracking."
description: "Application. Built with Telnyx IoT/SIM, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [IoT/SIM, Migration, Number Porting]
---

# Wireless Fleet Activation Portal — bulk activate SIMs with status tracking.

Wireless Fleet Activation Portal — bulk activate SIMs with status tracking.


## Telnyx API Endpoints Used

- **SIM Cards: Activate**: `POST /v2/sim_cards/{id}/actions/enable` — [API reference](https://developers.telnyx.com/api/sim-cards/sim-card-actions)
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
cd telnyx-code-examples/wireless-fleet-activation-portal-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t wireless-fleet-activation-portal .
docker run --env-file .env -p 5000:5000 wireless-fleet-activation-portal
```

## API Reference

### `GET /sims`

Returns all sims.

**Request:**

```bash
curl http://localhost:5000/sims
```

**Response:**

```json
{
  "sims": [
    "..."
  ]
}
```

### `POST /sims/activate`

Handles `POST /sims/activate`.

**Request:**

```bash
curl -X POST http://localhost:5000/sims/activate \
  -H "Content-Type: application/json" \
  -d '{
  "sim_ids": "[]"
}'
```

**Response:**

```json
{
  "results": "...",
  "activated": "..."
}
```

### `POST /sims/deactivate`

Handles `POST /sims/deactivate`.

**Request:**

```bash
curl -X POST http://localhost:5000/sims/deactivate \
  -H "Content-Type: application/json" \
  -d '{
  "sim_ids": "[]"
}'
```

**Response:**

```json
{
  "results": "..."
}
```

### `GET /activation-log`

Returns log details.

**Request:**

```bash
curl http://localhost:5000/activation-log
```

**Response:**

```json
{
  "log": "..."
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
