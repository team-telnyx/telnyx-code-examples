---
name: sim-fleet-data-usage-anomaly-detector
title: "SIM Fleet Data Usage Anomaly Detector"
description: "SIM Fleet Data Usage Anomaly Detector — monitor IoT SIM usage, AI detects anomalies, SMS alerts."
language: python
framework: flask
telnyx_products: [SMS/MMS, AI Inference]
---

# SIM Fleet Data Usage Anomaly Detector

SIM Fleet Data Usage Anomaly Detector — monitor IoT SIM usage, AI detects anomalies, SMS alerts.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **SIM Cards**: `GET /v2/sim_cards` — [API reference](https://developers.telnyx.com/api/sim-cards/list-sim-cards)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  ┌──────────────┐
  │ API Request  │
  │ (SIM/sensor)  │
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ AI Classify  │ ── severity / category
  └──────┬───────┘
         │
         ▼
    JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `ALERT_NUMBER` | `string` | `your_value` | **yes** | Alert number | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sim-fleet-data-usage-anomaly-detector-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t sim-fleet-data-usage-anomaly-detector-python .
docker run --env-file .env -p 5000:5000 sim-fleet-data-usage-anomaly-detector-python
```

## API Reference

### `POST /scan`

Triggers scan

```bash
curl -X POST http://localhost:5000/scan \
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

### `GET /anomalies`

Returns anomalies

```bash
curl http://localhost:5000/anomalies
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

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
