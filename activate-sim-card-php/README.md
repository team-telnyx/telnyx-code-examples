---
name: activate-sim-card
title: "Activate SIM Card (PHP)"
description: "Enable (activate) a Telnyx IoT SIM card by ID using the Telnyx PHP SDK over a vanilla PHP front controller."
language: php
framework: vanilla
telnyx_products: [IoT]
channel: [sim]
---

# Activate SIM Card (PHP)

Enable (activate) a Telnyx IoT SIM card by ID using the Telnyx PHP SDK over a vanilla PHP front controller.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT SIM management on one private, global network. The IoT SIM API lets you provision, activate, and manage cellular connectivity programmatically with the same API key and SDK you use for everything else.

- **Programmable IoT SIMs** - enable, disable, and inspect SIM cards over a simple REST API.
- **One platform** - IoT connectivity sits next to voice, messaging, and AI under a single API key.
- **Developer-first SDKs** - the Telnyx PHP SDK ships typed services, native Ed25519 webhook verification, and pluggable PSR-18 transport.

## Telnyx API Endpoints Used

- **Get SIM Card**: `GET /v2/sim_cards/{id}` - via `$client->simCards->retrieve($id)` - [API reference](https://developers.telnyx.com/api-reference/sim-cards/get-sim-card)
- **Enable (Activate) SIM Card**: `POST /v2/sim_cards/{id}/actions/enable` - via `$client->simCards->actions->enable(id: $id)` - [API reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)
- **Webhook verification**: `$client->webhooks->unwrap($body, $headers)` verifies the Telnyx Ed25519 signature and parses the event.

## Architecture

```
  HTTP Request
        │
        ▼
  ┌──────────────────────┐
  │  Vanilla PHP router   │
  │  (index.php)          │
  └──────────┬───────────┘
             │  Telnyx PHP SDK
             ▼
  ┌──────────────────────┐
  │  Telnyx IoT SIM API   │
  └──────────┬───────────┘
             │  async enable action
             ▼
   ┌──────────────────────┐
   │  SIM webhook (status) │──► POST /webhooks/telnyx (Ed25519 verified)
   └──────────────────────┘
```

Activation is asynchronous: `POST /sim/{id}/activate` returns a SIM card action you poll (or wait for a webhook) to confirm the SIM reaches `enabled`.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key, used for every API call | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o0Yf...base64...=` | only for webhooks | Base64 Ed25519 public key used to verify inbound webhooks at `POST /webhooks/telnyx` | [Portal → Account → Public Key](https://portal.telnyx.com) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-php
cp .env.example .env        # ← fill in your TELNYX_API_KEY
composer install
php -S localhost:8080 index.php
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


The server listens on `http://localhost:8080`. PHP 8.1+ with the bundled `ext-sodium` is required (used for Ed25519 webhook verification).

## API Reference

### `GET /sim/{id}`

Retrieve a SIM card's current state.

```bash
curl http://localhost:8080/sim/6b14e151-8493-4fa1-8664-1cc4e6d14158
```

**Response `200`:**

```json
{
  "id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
  "iccid": "89310410106543789301",
  "status": "disabled",
  "simCardGroupId": "47a9c0fa-1d3b-4f2a-9e22-2c4e9a1b7d10"
}
```

### `POST /sim/{id}/activate`

Enable (activate) a SIM card. The SIM must already belong to a SIM card group. Activation is asynchronous, so the route returns `202 Accepted` with the action that was started.

```bash
curl -X POST http://localhost:8080/sim/6b14e151-8493-4fa1-8664-1cc4e6d14158/activate
```

**Response `202`:**

```json
{
  "message": "SIM card activation requested",
  "action": {
    "actionId": "a1b2c3d4-0000-1111-2222-333344445555",
    "simCardId": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
    "actionType": "enable",
    "status": "in-progress"
  }
}
```

### `POST /webhooks/telnyx`

Receive Telnyx SIM card webhooks. The raw body and headers are passed to `$client->webhooks->unwrap()`, which verifies the `Telnyx-Signature-Ed25519` header before the event is read from `data.payload`. Requests with a missing or invalid signature return `401`.

### `GET /health`

Liveness probe.

```bash
curl http://localhost:8080/health
```

**Response `200`:** `{ "status": "ok" }`

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `{"error": "Invalid API key"}` (401) | `TELNYX_API_KEY` is missing or wrong. | Set a valid key in `.env` and restart the server. The key is read from the environment at startup. |
| `{"error": "SIM card not found"}` (404) | The SIM card ID does not exist in your account. | Confirm the ID under IoT → SIM Cards in the [Telnyx Portal](https://portal.telnyx.com). |
| Activation fails with a `4xx` Telnyx API error | The SIM is not in a SIM card group, or is in a status that cannot be enabled (e.g. already `enabled`). | Add the SIM to a SIM card group and confirm it is in a state that allows enabling. |
| `{"error": "SIM card ID must be a non-empty string"}` (400) | The `{id}` path segment was empty. | Include a valid SIM card ID in the URL path. |
| `{"error": "Rate limit exceeded. Please slow down."}` (429) | Too many requests to the Telnyx API. | Add backoff between calls; batch activations where possible. |
| `{"error": "Network error connecting to Telnyx"}` (503) | The server cannot reach `api.telnyx.com`. | Check connectivity, firewall, and the [Telnyx Status Page](https://status.telnyx.com). |
| `{"error": "Invalid webhook signature"}` (401) | `TELNYX_PUBLIC_KEY` is missing/wrong, or the request was not signed by Telnyx. | Set the Ed25519 public key from Mission Control and ensure `ext-sodium` is enabled. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [activate-sim-card-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-python/README.md) - Same example in Python
- [activate-sim-card-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-nodejs/README.md) - Same example in Node.js
- [activate-sim-card-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-go/README.md) - Same example in Go
- [monitor-iot-data-usage-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-nodejs/README.md) - Track SIM data usage

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [Enable SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)
- [PHP SDK](https://developers.telnyx.com/development/sdk/php)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)
