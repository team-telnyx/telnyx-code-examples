---
name: auto-failover-voice-routing
title: "Auto-Failover Voice Routing with Circuit Breaker"
description: "Telecom-native circuit breaker pattern using Telnyx Call Control, KV state, and SMS alerts for automatic SIP failover."
language: python
framework: flask
telnyx_products: [Call Control, SMS, Webhooks, KV]
---

# Auto-Failover Voice Routing with Circuit Breaker

Telecom-native circuit breaker pattern using Telnyx Call Control, KV state, and SMS alerts for automatic SIP failover.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a global, programmable communications platform built for developers who need carrier-grade reliability with the flexibility of cloud-native primitives. Unlike traditional telecom providers that require complex carrier contracts and proprietary hardware, Telnyx exposes SIP trunking, Call Control, SMS, and edge KV stores through a unified API surface. This sample demonstrates how Telnyx's composable primitives — Call Control connections, webhook-driven event processing, KV state management, and SMS alerting — can be orchestrated into a telecom-native circuit breaker pattern that automatically fails over from a primary SIP connection to a backup when failure thresholds are exceeded.

## Telnyx API Endpoints Used

| API | Method | Purpose |
|-----|--------|---------|
| Call Control API | `telnyx.Call.create()` | Create outbound calls via primary or backup SIP connections |
| Call Control Webhooks | `telnyx.Webhook.construct_event()` | Verify Ed25519-signed webhook events for call state changes |
| SMS API | `telnyx.Message.create()` | Send SMS alerts to ops when circuit breaker trips |
| KV Store (in-memory demo) | `kv_get()` / `kv_put()` / `kv_increment()` | Persist circuit breaker state (failures, tripped, last_fail) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Telnyx Platform                          │
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │  Primary SIP │     │  Backup SIP  │     │   Webhook    │    │
│  │ Connection    │     │ Connection   │     │   Endpoint   │    │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘    │
│         │                    │                    │            │
│         │ Call Control API   │ Call Control API   │ POST       │
│         ▼                    ▼                    ▼            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Flask App (auto-failover)                  │   │
│  │                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │   │
│  │  │ /api/route  │  │ /webhooks/  │  │ /api/circuit-  │  │   │
│  │  │             │  │ call-control│  │ state          │  │   │
│  │  │ Routes call │  │             │  │                │  │   │
│  │  │ to primary  │  │ Receives    │  │ Returns breaker│  │   │
│  │  │ or backup   │  │ call failure│  │ state (closed/ │  │   │
│  │  │ based on    │  │ webhooks    │  │ open/half-open)│  │   │
│  │  │ breaker     │  │             │  │                │  │   │
│  │  │ state       │  │ → increments│  │                │  │   │
│  │  └─────────────┘  │   failure   │  └────────────────┘  │   │
│  │                   │   counter   │  ┌────────────────┐  │   │
│  │                   │   in KV     │  │ /api/circuit-  │  │   │
│  │                   │             │  │ reset          │  │   │
│  │                   │ → if count  │  │                │  │   │
│  │                   │   >= thresh │  │ Manually reset │  │   │
│  │                   │   → trip    │  │ breaker        │  │   │
│  │                   │   breaker   │  └────────────────┘  │   │
│  │                   │   → SMS     │  ┌────────────────┐  │   │
│  │                   │   alert     │  │ /health        │  │   │
│  │                   │   to ops    │  │                │  │   │
│  │                   └─────────────┘  │ Health check   │  │   │
│  │                                    └────────────────┘  │   │
│  │                                                         │   │
│  │  ┌────────────────────────────────────────────────────┐ │   │
│  │  │  KV Store (in-memory demo / Redis in production)   │ │   │
│  │  │  primary:failures  → int                           │ │   │
│  │  │  primary:tripped   → bool                          │ │   │
│  │  │  primary:last_fail → timestamp                     │ │   │
│  │  └────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────┐                                               │
│  │   SMS to     │                                               │
│  │   Ops Team   │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘

Circuit Breaker State Flow:
  CLOSED → (failures >= threshold) → OPEN → (cooldown expired) → HALF-OPEN → (test call succeeds) → CLOSED
                                                                                                   ↓
                                                                                                   → (test call fails) → OPEN
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `COOLDOWN_SECONDS` | `string` | `your_cooldown_seconds_here` | **yes** | COOLDOWN_SECONDS | — |
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `FAILURE_THRESHOLD` | `string` | `your_failure_threshold_here` | **yes** | FAILURE_THRESHOLD | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_BACKUP_CONNECTION_ID` | `string` | `your_telnyx_backup_connection_id_here` | **yes** | TELNYX_BACKUP_CONNECTION_ID | — |
| `TELNYX_FROM_NUMBER` | `string` | `your_telnyx_from_number_here` | **yes** | TELNYX_FROM_NUMBER | — |
| `TELNYX_OPS_ALERT_NUMBER` | `string` | `your_telnyx_ops_alert_number_here` | **yes** | TELNYX_OPS_ALERT_NUMBER | — |
| `TELNYX_PRIMARY_CONNECTION_ID` | `string` | `your_telnyx_primary_connection_id_here` | **yes** | TELNYX_PRIMARY_CONNECTION_ID | — |
| `TELNYX_WEBHOOK_SECRET` | `string` | `your_telnyx_webhook_secret_here` | **yes** | TELNYX_WEBHOOK_SECRET | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/auto-failover-voice-routing

# Create a virtual environment and install dependencies
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Copy the example environment file and configure your values
cp .env.example .env
# Edit .env with your Telnyx API key, connection IDs, phone numbers, and webhook secret

# Run the Flask application
python app.py
```

The server starts on `http://0.0.0.0:5000` by default. In demo mode (`DEMO_MODE=true`), no real calls or SMS messages are sent — all actions are logged.

## API Reference

See [API.md](API.md) for the full typed endpoint reference including request/response schemas, status codes, and parameter details.

Quick reference:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhooks/call-control` | Receives Call Control webhook events (call state changes) |
| `POST` | `/api/route` | Determines which SIP connection to use for an outbound call |
| `GET` | `/api/circuit-state` | Returns the current circuit breaker state |
| `POST` | `/api/circuit-reset` | Manually resets the circuit breaker to CLOSED state |
| `GET` | `/health` | Health check endpoint |

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Webhook returns 500 | Invalid or missing `Telnyx-Signature` header | Verify `TELNYX_WEBHOOK_SECRET` matches the secret configured in the Telnyx Portal |
| Calls always route to backup | Circuit breaker is tripped and cooldown hasn't expired | Wait for cooldown period or call `POST /api/circuit-reset` |
| No SMS alert sent | `DEMO_MODE=true` or `TELNYX_OPS_ALERT_NUMBER` not set | Set `DEMO_MODE=false` and configure `TELNYX_OPS_ALERT_NUMBER` |
| Call creation fails | Invalid `TELNYX_PRIMARY_CONNECTION_ID` or `TELNYX_BACKUP_CONNECTION_ID` | Verify connection IDs in the Telnyx Portal under SIP Connections |
| `telnyx` module not found | Dependencies not installed | Run `pip install -r requirements.txt` |
| Port already in use | Another process is using port 5000 | Set `PORT` environment variable to an available port |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [call-control-forwarding](../call-control-forwarding/) — Call forwarding with Telnyx Call Control
- [sms-notification-service](../sms-notification-service/) — SMS-based alerting and notifications
- [sip-trunk-monitoring](../sip-trunk-monitoring/) — Monitor SIP trunk health with webhooks
- [voice-ivr-menu](../voice-ivr-menu/) — Interactive voice response with Call Control

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Call Control Product Page](https://telnyx.com/call-control)
- [Telnyx SMS Product Page](https://telnyx.com/sms)
- [Telnyx Pricing](https://telnyx.com/pricing)
