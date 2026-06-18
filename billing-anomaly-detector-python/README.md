---
name: billing-anomaly-detector
title: "Billing Anomaly Detector"
description: "Billing Anomaly Detector — monitor usage and billing for anomalies, alert on cost spikes and unusual patterns."
language: python
framework: flask
telnyx_products: [CDR, Migration, Number Porting, SMS/MMS]
---

# Billing Anomaly Detector

Billing Anomaly Detector — monitor usage and billing for anomalies, alert on cost spikes and unusual patterns.


## Telnyx API Endpoints Used

- **CDR Reports**: `GET /v2/reports/call_detail_records` -- [API reference](https://developers.telnyx.com/api/reports/list-cdrs)


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
| `ALERT_WEBHOOK` | `string` | `https://...` | no | alert webhook | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/billing-anomaly-detector-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t billing-anomaly-detector .
docker run --env-file .env -p 5000:5000 billing-anomaly-detector
```

## API Reference

### `POST /config`

Handles `POST /config`.

**Request:**

```bash
curl -X POST http://localhost:5000/config
```

**Response:**

```json
{
  "baselines": "..."
}
```

### `GET /config`

Returns baselines details.

**Request:**

```bash
curl http://localhost:5000/config
```

**Response:**

```json
{
  "baselines": "..."
}
```

### `POST /check`

Executes the batch workflow.

**Request:**

```bash
curl -X POST http://localhost:5000/check
```

**Response:**

```json
{
  "anomalies": "...",
  "checked_at": "..."
}
```

### `GET /balance`

Handles `GET /balance`.

**Request:**

```bash
curl http://localhost:5000/balance
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /alerts`

Returns all alerts.

**Request:**

```bash
curl http://localhost:5000/alerts
```

**Response:**

```json
{
  "alerts": "..."
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
