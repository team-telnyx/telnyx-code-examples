---
name: call-quality-monitor
title: "Call Quality Monitor"
description: "Monitor call quality metrics (MOS, jitter, latency) via Telnyx webhooks, store historical data in SQLite, and view live alerts on a WebSocket dashboard."
language: python
framework: flask
telnyx_products: [Voice, Webhooks]
---

# Call Quality Monitor

Monitor call quality metrics (MOS, jitter, latency, packet loss) from Telnyx webhooks, store historical analytics in SQLite, track per-call state, and view live alerts on a WebSocket dashboard.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** needed to build real-time voice applications with granular call quality telemetry. This sample leverages Telnyx's webhook events to capture per-call quality metrics, enabling proactive monitoring and alerting for voice applications.

## Telnyx API Endpoints Used

- **Call Quality Webhooks** — Receive real-time quality metrics (MOS, jitter, latency, packet loss) for active calls via Telnyx's webhook delivery.
- **Call Lifecycle Webhooks** — Track call states (`call.initiated`, `call.answered`, `call.completed`) to correlate quality data with call events.
- **Webhook Signature Verification** — Verify inbound webhook payloads using Telnyx's Ed25519 signature to ensure authenticity.

## Architecture

```
┌─────────────┐     Webhooks      ┌──────────────────────────────┐
│   Telnyx    │ ─────────────────▶│      Flask App (app.py)      │
│   Voice     │                   │                              │
└─────────────┘                   │  ┌────────────────────────┐  │
                                  │  │ Webhook Verification   │  │
                                  │  │ (Ed25519 signature)    │  │
                                  │  └───────────┬────────────┘  │
                                  │              │               │
                                  │              ▼               │
                                  │  ┌────────────────────────┐  │
                                  │  │  Process Quality       │  │
                                  │  │  Metrics               │  │
                                  │  └──────┬────────┬────────┘  │
                                  │         │        │           │
                                  │         ▼        ▼           │
                                  │  ┌──────────┐  ┌──────────┐  │
                                  │  │ SQLite   │  │ In-Memory│  │
                                  │  │ (History)│  │ KV State │  │
                                  │  └──────────┘  └──────────┘  │
                                  │         │        │           │
                                  │         ▼        ▼           │
                                  │  ┌────────────────────────┐  │
                                  │  │ Threshold Checker      │  │
                                  │  │ (MOS, Jitter, Latency) │  │
                                  │  └──────────┬─────────────┘  │
                                  │             │                │
                                  │             ▼                │
                                  │  ┌────────────────────────┐  │
                                  │  │ WebSocket Broadcast    │  │
                                  │  │ (Live Dashboard)       │  │
                                  │  └────────────────────────┘  │
                                  └──────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DB_PATH` | `string` | `your_db_path_here` | **yes** | DB_PATH | — |
| `JITTER_THRESHOLD` | `string` | `your_jitter_threshold_here` | **yes** | JITTER_THRESHOLD | — |
| `LATENCY_THRESHOLD` | `string` | `your_latency_threshold_here` | **yes** | LATENCY_THRESHOLD | — |
| `MOS_THRESHOLD` | `string` | `your_mos_threshold_here` | **yes** | MOS_THRESHOLD | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/call-quality-monitor
   ```

2. **Create your `.env` file**

   Copy the `.env.example` file and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set your `TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY`. Adjust thresholds and database path as needed.

3. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application**

   ```bash
   python app.py
   ```

   The server will start on `http://localhost:5000` (or the port specified in `PORT`).

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhooks/call-quality` | Receive Telnyx call quality webhooks (verify signature, process metrics). |
| `GET` | `/api/quality/<call_id>` | Get all quality metrics for a specific call. |
| `GET` | `/api/quality` | Get all quality metrics with optional filters (`call_id`, `start`, `end`, `limit`). |
| `GET` | `/api/quality/stats` | Get aggregate statistics (average MOS, jitter, latency, packet loss). |
| `GET` | `/api/quality/alerts` | Get all threshold alerts from in-memory call state. |
| `GET` | `/ws` | WebSocket endpoint for live dashboard updates. |
| `GET` | `/health` | Health check endpoint. |

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|--------------|----------|
| `401 Unauthorized` on webhook | Invalid or missing `TELNYX_API_KEY` | Verify your API key in `.env` |
| `400 Invalid signature` on webhook | Incorrect `TELNYX_PUBLIC_KEY` | Ensure the public key matches your Telnyx account |
| No metrics stored | Webhook not configured in Telnyx portal | Set up the webhook URL to point to `https://<your-domain>/webhooks/call-quality` |
| WebSocket connection fails | Server not running with WebSocket support | Ensure the Flask app is running and accessible |
| Database errors | Invalid `DB_PATH` or permissions | Check the path is writable and valid |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai)
- [Telnyx llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Call Control Quickstart](https://github.com/team-telnyx/telnyx-code-examples/tree/main/call-control-quickstart)
- [Webhook Relay](https://github.com/team-telnyx/telnyx-code-examples/tree/main/webhook-relay)
- [Voice AI Assistant](https://github.com/team-telnyx/telnyx-code-examples/tree/main/voice-ai-assistant)

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com/)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Voice Product Page](https://telnyx.com/voice)
- [Telnyx Pricing](https://telnyx.com/pricing)
