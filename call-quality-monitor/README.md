---
name: call-quality-monitor
title: "Call Quality Monitor — Real-time Call Quality Dashboard"
description: "Real-time call quality monitoring dashboard with WebSocket live updates and SQL historical analytics."
language: python
framework: flask
telnyx_products: [Call Control, Voice, Webhooks]
---

# Call Quality Monitor

Real-time call quality monitoring dashboard with WebSocket live updates and SQL historical analytics.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** that gives developers programmable access to carrier-grade voice, messaging, and real-time communications primitives. Unlike traditional telecom providers, Telnyx exposes call quality metrics (MOS, jitter, latency) directly through Call Control webhooks, enabling you to build observability and alerting into your applications at the infrastructure level. This sample demonstrates how to consume those real-time quality signals, persist them for historical analysis, and push live updates to a dashboard — all powered by Telnyx's communications platform.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/webhooks/call-quality` | `POST` | Receives Call Control webhook events containing MOS, jitter, and latency metrics |
| `telnyx.WebhookClient.unwrap()` | — | Verifies Ed25519 signature on inbound webhooks |
| `telnyx.api_key` | — | Authenticates SDK calls to Telnyx APIs |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Telnyx Call Control                           │
│                                                                     │
│   Call webhook (mos, jitter, latency)                               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    QualityAgent.onTask()                             │
│                    (Flask webhook handler)                           │
│                                                                     │
│   1. Verify Ed25519 signature via telnyx.WebhookClient              │
│   2. Extract call_id, mos, jitter, latency from data.payload        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
   ┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
   │  KV Store       │ │  SQL DB      │ │  Threshold Check │
   │  (per-call      │ │  (metrics    │ │  (MOS, jitter,   │
   │   state)        │ │   table)     │ │   latency)       │
   │                 │ │              │ │                  │
   │ call:${id}:     │ │ INSERT INTO  │ │ if MOS < thresh  │
   │ quality         │ │ metrics(...) │ │ → alert          │
   │                 │ │              │ │                  │
   └─────────────────┘ └──────────────┘ └────────┬─────────┘
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │  WebSocket Push  │
                                        │  (SocketIO)      │
                                        │                  │
                                        │ quality_update   │
                                        │ quality_alert    │
                                        └────────┬─────────┘
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │  Live Dashboard  │
                                        │  (Flask route)   │
                                        └──────────────────┘
```

**Data Flow:**

1. **Call Control** — Telnyx sends call status webhooks containing MOS, jitter, and latency metrics to `/webhooks/call-quality`.
2. **KV** — Per-call quality state is stored in KV under `call:${id}:quality` for real-time lookups.
3. **SQL** — Metrics are persisted to a SQLite `metrics` table for historical analytics.
4. **Threshold Alerting** — If MOS, jitter, or latency exceed configured thresholds, an alert is generated.
5. **WebSocket** — Live updates and alerts are pushed to the dashboard via SocketIO.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DB_PATH` | `string` | `your_db_path_here` | **yes** | DB_PATH | — |
| `FLASK_SECRET_KEY` | `string` | `your_flask_secret_key_here` | **yes** | FLASK_SECRET_KEY | — |
| `JITTER_THRESHOLD_MS` | `string` | `your_jitter_threshold_ms_here` | **yes** | JITTER_THRESHOLD_MS | — |
| `LATENCY_THRESHOLD_MS` | `string` | `your_latency_threshold_ms_here` | **yes** | LATENCY_THRESHOLD_MS | — |
| `MOS_THRESHOLD` | `string` | `your_mos_threshold_here` | **yes** | MOS_THRESHOLD | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_APP_ID` | `string` | `your_telnyx_app_id_here` | **yes** | TELNYX_APP_ID | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-quality-monitor

# Copy the example environment file
cp .env.example .env

# Edit .env with your Telnyx credentials and configuration
# (see Environment Variables table above)

# Install dependencies
pip install -r requirements.txt

# Initialize the database and start the server
python app.py
```

The application will start on `http://0.0.0.0:5000` (or the port specified in `PORT`).

## API Reference

### `POST /webhooks/call-quality`

Receives Call Control webhook events containing call quality metrics.

**Headers:**
- `Content-Type: application/json`
- Telnyx signature headers (`Telnyx-Signature-Ed25519`, `Telnyx-Timestamp`)

**Request Body:**
```json
{
  "data": {
    "payload": {
      "call_id": "call_abc123",
      "mos": 4.2,
      "jitter": 15,
      "latency": 80
    }
  },
  "event_type": "call.status"
}
```

**Responses:**
- `200 OK` — Webhook processed successfully
- `401 Unauthorized` — Invalid signature
- `400 Bad Request` — Missing call_id

### `GET /`

Serves the live call quality dashboard with WebSocket updates.

### `GET /api/metrics`

Returns historical quality metrics.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `call_id` | string | — | Filter by call ID |
| `limit` | integer | 100 | Maximum number of records |

**Response:**
```json
[
  {
    "call_id": "call_abc123",
    "mos": 4.2,
    "jitter": 15,
    "latency": 80,
    "timestamp": "2024-01-15T10:30:00+00:00"
  }
]
```

### `GET /api/quality/<call_id>`

Returns the current per-call quality state from KV.

**Response:**
```json
{
  "call_id": "call_abc123",
  "mos": 4.2,
  "jitter": 15,
  "latency": 80,
  "timestamp": "2024-01-15T10:30:00+00:00",
  "event_type": "call.status"
}
```

### `GET /health`

Health check endpoint.

**Response:**
```json
{"status": "ok"}
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Webhook returns 401 | Invalid Ed25519 signature | Verify `TELNYX_PUBLIC_KEY` is set correctly in `.env` |
| No metrics in dashboard | WebSocket connection failed | Check browser console for Socket.IO errors; ensure port is accessible |
| Database errors | SQLite file not writable | Verify `DB_PATH` points to a writable location |
| No alerts triggered | Thresholds too high | Lower `MOS_THRESHOLD`, `JITTER_THRESHOLD_MS`, or `LATENCY_THRESHOLD_MS` |
| App fails to start | Missing dependencies | Run `pip install -r requirements.txt` |
| Telnyx SDK errors | Invalid API key | Verify `TELNYX_API_KEY` in `.env` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](llms.txt)

## Related Examples

- [call-control-transfer](https://github.com/team-telnyx/telnyx-code-examples/tree/main/call-control-transfer) — Call transfer with Call Control
- [voice-analytics](https://github.com/team-telnyx/telnyx-code-examples/tree/main/voice-analytics) — Voice call analytics dashboard
- [sms-webhook-receiver](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sms-webhook-receiver) — SMS webhook receiver with verification
- [telnyx-edge-agent](https://github.com/team-telnyx/telnyx-code-examples/tree/main/telnyx-edge-agent) — Telnyx Edge Agent SDK example

## Resources

- [Telnyx Voice API Documentation](https://developers.telnyx.com/docs/voice)
- [Telnyx Call Control API Reference](https://developers.telnyx.com/api/reference/tag/Call-Control)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Voice Product Page](https://telnyx.com/voice)
- [Telnyx Pricing](https://telnyx.com/pricing)
