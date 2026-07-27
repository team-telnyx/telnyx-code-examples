---
name: activate-sim-card
title: "Activate SIM Card"
description: "Activate a SIM card on the Telnyx network."
language: python
framework: flask
telnyx_products: [IoT/SIM]
---

# Production-ready Flask application for SIM card activation via Telnyx.

Production-ready Flask application for SIM card activation via Telnyx.

## Telnyx API Endpoints Used

- **List SIM Cards**: `GET /v2/sim_cards` - [API reference](https://developers.telnyx.com/api/sim-cards/list-sim-cards)
- **Retrieve SIM Card**: `GET /v2/sim_cards/{id}` - [API reference](https://developers.telnyx.com/api/sim-cards/get-sim-card)
- **Activate SIM Card**: `PATCH /v2/sim_cards/{id}` - [API reference](https://developers.telnyx.com/api/sim-cards/update-sim-card)

## Architecture

```
  ┌──────────────────┐
  │ API Request      │
  │ (SIM data /       │
  │  sensor reading)   │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Threshold Check   │
  └────────┬─────────┘
           │
           ▼
     JSON response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


## API Reference

### `GET /sim-cards`

HTTP endpoint to list all SIM cards.

```bash
curl http://localhost:5000/sim-cards
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

### `GET /sim-cards/<sim_card_id>`

HTTP endpoint to retrieve a single SIM card.

```bash
curl http://localhost:5000/sim-cards/example-id
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

### `POST /sim-cards/<sim_card_id>/activate`

HTTP endpoint to activate a SIM card.

```bash
curl -X POST http://localhost:5000/sim-cards/example-id/activate \
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

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [IoT Fleet Alert Escalation (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-fleet-alert-escalation-python/README.md)
- [IoT Panic Button Voice Alert (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-panic-button-voice-alert-python/README.md)
- [IoT Smart Building Voice Control (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-smart-building-voice-control-python/README.md)
- [Monitor IoT Data Usage (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-python/README.md)
- [Provision Esim (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
