---
name: auto-failover-voice-routing
title: "Auto-Failover Voice Routing with Circuit Breaker"
description: "Telecom-native circuit breaker pattern using Telnyx Call Control, KV state, and SMS alerts for automatic SIP failover."
language: typescript
framework: edge
telnyx_products: [Call Control, SMS, Webhooks, KV]
---

# Auto-Failover Voice Routing with Circuit Breaker

Telecom-native circuit breaker pattern using Telnyx Call Control, KV state, and SMS alerts for automatic SIP failover.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a global, programmable communications platform built for developers who need carrier-grade reliability with the flexibility of cloud-native primitives. Unlike traditional telecom providers that require complex carrier contracts and proprietary hardware, Telnyx exposes SIP trunking, Call Control, SMS, and edge KV stores through a unified API surface. This sample demonstrates how Telnyx's composable primitives — Call Control connections, webhook-driven event processing, KV state management, and SMS alerting — can be orchestrated into a telecom-native circuit breaker pattern that automatically fails over from a primary SIP connection to a backup when failure thresholds are exceeded.

## Telnyx API Endpoints Used

| API | Method | Purpose |
|-----|--------|---------|
| Call Control API | `env.TELNYX.calls.dial()` | Create outbound calls via primary or backup SIP connections |
| Call Control Actions | `env.TELNYX.calls.actions.speak()` / `gather()` / `hangup()` | Deliver the fraud alert, collect the 1/2 response, hang up |
| Call Control Webhooks | `telnyx.webhooks.unwrap()` | Verify Ed25519-signed webhook events for call state changes |
| SMS API | `env.TELNYX.messages.send()` | Send SMS alerts to ops when the circuit breaker trips and confirmations to the customer |
| Telnyx KV | `env.FAILOVER_KV.get()` / `put()` | Persist circuit breaker state (failures, tripped, last_fail) and call routing maps |

## Architecture

The sample runs on Telnyx Edge Compute with the Agent SDK: an edge **worker** (`src/index.ts`) fronts the HTTP surface and dispatches Call Control webhooks to a durable **actor** (`src/failoverAgent.ts`, a `FailoverAgent` extending `Agent`) that owns the circuit breaker and the call flow. Breaker state lives in the `FAILOVER_KV` KV binding so it survives restarts and is shared between the worker and the actor.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Telnyx Platform                          │
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │  Primary SIP │     │  Backup SIP  │     │   Webhook    │    │
│  │ Connection    │     │ Connection   │     │   Endpoint   │    │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘    │
│         │                    │                    │            │
│         │ env.TELNYX         │ env.TELNYX         │ POST       │
│         │ .calls.dial        │ .calls.dial        │            │
│         ▼                    ▼                    ▼            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │        Edge worker (src/index.ts, fetch handler)        │   │
│  │                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │   │
│  │  │ /api/route  │  │ /webhooks/  │  │ /api/circuit-  │  │   │
│  │  │             │  │ call-control│  │ state          │  │   │
│  │  │ Reads the   │  │ Verifies    │  │                │  │   │
│  │  │ breaker in  │  │ the Ed25519 │  │ Reads breaker  │  │   │
│  │  │ KV, dials   │  │ signature,  │  │ state from KV  │  │   │
│  │  │ the chosen  │  │ dispatches  │  │ (closed/open/  │  │   │
│  │  │ connection  │  │ events to   │  │ half-open)     │  │   │
│  │  │ and records │  │ the actor   │  └────────────────┘  │   │
│  │  │ the routing │  │             │  ┌────────────────┐  │   │
│  │  │ map in KV   │  │             │  │ /api/circuit-  │  │   │
│  │  │             │  │             │  │ reset          │  │   │
│  │  └─────────────┘  │             │  │                │  │   │
│  │                   │             │  │ Resets breaker │  │   │
│  │                   │             │  │ via the actor  │  │   │
│  │                   │             │  └────────────────┘  │   │
│  │                   │             │  ┌────────────────┐  │   │
│  │                   │             │  │ /health        │  │   │
│  │                   │             │  └────────────────┘  │   │
│  │         ┌─────────┘             │                      │   │
│  │         ▼                       │                      │   │
│  │  ┌──────────────────────────────┴───────────────────┐  │   │
│  │  │      FailoverAgent actor (src/failoverAgent.ts)  │  │   │
│  │  │                                                  │  │   │
│  │  │  recordOutcome(): counts primary failures in KV, │  │   │
│  │  │  trips the breaker at threshold → ops SMS        │  │   │
│  │  │  handleCallEvent(): announces the fraud alert    │  │   │
│  │  │  (speak → gather → resolve → SMS → hangup)       │  │   │
│  │  │  resetBreaker(): closes the breaker              │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │   Telnyx KV (env.FAILOVER_KV) — durable breaker state    │  │
│  │   primary:failures  → int                                │  │
│  │   primary:tripped   → bool                               │  │
│  │   primary:last_fail → timestamp                          │  │
│  └──────────────────────────────────────────────────────────┘  │
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
| `COOLDOWN_SECONDS` | `string` | `300` | **yes** | Seconds the breaker stays open before half-open probing | Your ops policy |
| `DEMO_MODE` | `string` | `true` | **yes** | `true` logs SMS/alerts instead of sending and skips dialing | — |
| `DIAL_TIMEOUT_SECS` | `string` | `30` | **yes** | Ring timeout for outbound dials | Your ops policy |
| `FAILURE_THRESHOLD` | `string` | `3` | **yes** | Failures before the breaker trips | Your ops policy |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key (Edge secret) | Telnyx Mission Control → API Keys |
| `TELNYX_BACKUP_CONNECTION_ID` | `string` | `your_telnyx_backup_connection_id_here` | **yes** | Backup SIP connection ID | Telnyx Portal → Voice → SIP Connections |
| `TELNYX_FROM_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Caller ID for outbound calls | Telnyx Portal → Numbers |
| `TELNYX_OPS_ALERT_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Mobile number that receives breaker-trip SMS alerts | Your ops on-call number |
| `TELNYX_PRIMARY_CONNECTION_ID` | `string` | `your_telnyx_primary_connection_id_here` | **yes** | Primary SIP connection ID | Telnyx Portal → Voice → SIP Connections |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_base64` | **yes** (live) | Ed25519 public key for webhook signature verification | Telnyx Portal → Webhook signing keys |
| `SMS_FROM_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Sender for SMS alerts (falls back to `TELNYX_FROM_NUMBER`) | Telnyx Portal → Numbers |
| `TTS_VOICE` | `string` | `Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02` | **yes** | Telnyx voice for the spoken fraud alert | [Telnyx TTS voices](https://developers.telnyx.com/docs/voice/programmable-voice/best-practices/tts) |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/auto-failover-voice-routing

# Install dependencies and typecheck/build
npm install
npm run typecheck
npm run build

# Copy the example environment file and configure your values
cp .env.example .env
# Edit .env with your Telnyx API key, connection IDs, phone numbers, and public key

# Run the sample locally (telnyx-edge dev)
npm start

# Deploy to Telnyx Edge Compute
telnyx-edge ship
```

On Telnyx Edge Compute the config is provided by `telnyx.toml` (`[env_vars]`, `[[secrets]]`, and the `[storage.kv.FAILOVER_KV]` namespace). Locally, the same variables load from `.env`. In demo mode (`DEMO_MODE=true`), no real calls or SMS messages are sent — all actions are logged, and inbound webhook signatures are skipped so you can test without the public key.

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
| Webhook returns 401 | Invalid or missing Ed25519 signature | In live mode, set `TELNYX_PUBLIC_KEY` (`telnyx-edge secrets add TELNYX_PUBLIC_KEY <base64>`). Demo mode (`DEMO_MODE=true`) skips verification for local testing. |
| Calls always route to backup | Circuit breaker is tripped and cooldown hasn't expired | Wait for cooldown period or call `POST /api/circuit-reset` |
| No SMS alert sent | `DEMO_MODE=true` or `TELNYX_OPS_ALERT_NUMBER` not set | Set `DEMO_MODE=false` and configure `TELNYX_OPS_ALERT_NUMBER` |
| Call creation fails | Invalid `TELNYX_PRIMARY_CONNECTION_ID` or `TELNYX_BACKUP_CONNECTION_ID` | Verify connection IDs in the Telnyx Portal under SIP Connections |
| Module not found | Dependencies not installed | Run `npm install` |
| KV errors on Edge | `FAILOVER_KV` namespace not created | Run `telnyx-edge storage kv create --name auto-failover-breaker` and paste the id into `telnyx.toml` |

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
- [Telnyx Edge Compute Docs](https://developers.telnyx.com/docs/edge)
- [Telnyx Call Control Product Page](https://telnyx.com/call-control)
- [Telnyx SMS Product Page](https://telnyx.com/sms)
- [Telnyx Pricing](https://telnyx.com/pricing)
