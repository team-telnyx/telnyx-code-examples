---
name: setup-sip-trunk
title: "Set Up a SIP Trunk (PHP)"
description: "Create, list, and retrieve a Telnyx credential (SIP) connection using the Telnyx PHP SDK over a vanilla PHP front controller."
language: php
framework: vanilla
telnyx_products: [SIP]
channel: [sip]
---

# Set Up a SIP Trunk (PHP)

Create, list, and retrieve a Telnyx credential (SIP) connection using the Telnyx PHP SDK over a vanilla PHP front controller.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT SIM management on one private, global network. SIP trunking connects your PBX, SBC, or softphone to the PSTN over the Telnyx-owned network, configured programmatically with the same API key and SDK you use for everything else.

- **Elastic SIP trunking** - provision credential, FQDN, and IP connections over a simple REST API; scale concurrent calls without per-channel contracts.
- **One platform** - SIP trunking sits next to voice, messaging, and AI under a single API key.
- **Developer-first SDKs** - the Telnyx PHP SDK ships typed services, native Ed25519 webhook verification, and pluggable PSR-18 transport.

## Telnyx API Endpoints Used

- **Create Credential Connection**: `POST /v2/credential_connections` - via `$client->credentialConnections->create(connectionName: ..., userName: ..., password: ...)` - [API reference](https://developers.telnyx.com/api-reference/credential-connections/create-credential-connection)
- **List Credential Connections**: `GET /v2/credential_connections` - via `$client->credentialConnections->list()` - [API reference](https://developers.telnyx.com/api-reference/credential-connections/list-credential-connections)
- **Get Credential Connection**: `GET /v2/credential_connections/{id}` - via `$client->credentialConnections->retrieve($id)` - [API reference](https://developers.telnyx.com/api-reference/credential-connections/get-credential-connection)
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
  ┌──────────────────────────────┐
  │  Telnyx Credential Conn. API  │
  └──────────┬───────────────────┘
             │  call/registration events
             ▼
   ┌──────────────────────┐
   │  SIP webhook (events) │──► POST /webhooks/telnyx (Ed25519 verified)
   └──────────────────────┘
```

A credential connection is a SIP trunk that authenticates with a username and password. Once created, point your PBX/SBC at `sip.telnyx.com` and register with the credentials you set here.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key, used for every API call | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o0Yf...base64...=` | only for webhooks | Base64 Ed25519 public key used to verify inbound webhooks at `POST /webhooks/telnyx` | [Portal → Account → Public Key](https://portal.telnyx.com) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-php
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

### `POST /connections`

Create a credential (SIP) connection. `connectionName`, `userName`, and `password` are all required.

```bash
curl -X POST http://localhost:8080/connections \
  -H 'Content-Type: application/json' \
  -d '{
    "connectionName": "My SIP Trunk",
    "userName": "myuser1234",
    "password": "SuperSecret123"
  }'
```

**Response `201`:**

```json
{
  "id": "1234567890",
  "connectionName": "My SIP Trunk",
  "userName": "myuser1234",
  "active": true,
  "createdAt": "2026-06-19T12:00:00.000Z"
}
```

The plaintext `password` is never returned in the response.

### `GET /connections`

List credential (SIP) connections.

```bash
curl http://localhost:8080/connections
```

**Response `200`:**

```json
{
  "data": [
    {
      "id": "1234567890",
      "connectionName": "My SIP Trunk",
      "userName": "myuser1234",
      "active": true,
      "createdAt": "2026-06-19T12:00:00.000Z"
    }
  ]
}
```

### `GET /connections/{id}`

Retrieve a single credential (SIP) connection by ID.

```bash
curl http://localhost:8080/connections/1234567890
```

**Response `200`:**

```json
{
  "id": "1234567890",
  "connectionName": "My SIP Trunk",
  "userName": "myuser1234",
  "active": true,
  "createdAt": "2026-06-19T12:00:00.000Z"
}
```

### `POST /webhooks/telnyx`

Receive Telnyx webhooks. The raw body and headers are passed to `$client->webhooks->unwrap()`, which verifies the `Telnyx-Signature-Ed25519` header before the event is read from `data.payload`. Requests with a missing or invalid signature return `401`.

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
| `{"error": "connectionName, userName, and password are required"}` (400) | One of the required fields was missing or empty in the request body. | Include all three fields. `userName` is 4–32 alphanumeric characters; `password` is 8–128 characters. |
| `{"error": "Invalid request to Telnyx API"}` (400) | Telnyx rejected the create payload (e.g. duplicate `connectionName`, or `userName`/`password` outside the allowed length). | Use a unique connection name and credentials that meet the length rules. |
| `{"error": "Credential connection not found"}` (404) | The connection ID does not exist in your account. | Confirm the ID under SIP Connections in the [Telnyx Portal](https://portal.telnyx.com) or via `GET /connections`. |
| `{"error": "Rate limit exceeded. Please slow down."}` (429) | Too many requests to the Telnyx API. | Add backoff between calls; batch operations where possible. |
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

- [setup-sip-trunk-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-python/README.md) - Same example in Python
- [setup-sip-trunk-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-nodejs/README.md) - Same example in Node.js
- [setup-sip-trunk-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-go/README.md) - Same example in Go
- [activate-sim-card-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-php/README.md) - Telnyx PHP SDK with IoT SIM cards

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [Create Credential Connection API Reference](https://developers.telnyx.com/api-reference/credential-connections/create-credential-connection)
- [PHP SDK](https://developers.telnyx.com/development/sdk/php)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [Elastic SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)
