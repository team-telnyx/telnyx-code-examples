---
name: setup-sip-trunk
title: "Set Up a SIP Trunk (Java)"
description: "Create, list, and retrieve credential-authenticated Telnyx SIP connections with the Telnyx Java SDK and the JDK's built-in HTTP server."
language: java
framework: jdk-httpserver
telnyx_products: [SIP Trunking]
channel: [voice]
---

# Set Up a SIP Trunk (Java)

Create, list, and retrieve credential-authenticated Telnyx SIP connections with the Telnyx Java SDK and the JDK's built-in HTTP server.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. Credential (SIP) connections route over the Telnyx-owned IP backbone for lower latency and higher call reliability than the public internet, with SIP username/password authentication and outbound voice profiles managed entirely through the API.

## Telnyx API Endpoints Used

- **Create Credential Connection**: `POST /v2/credential_connections` - [API reference](https://developers.telnyx.com/api/connections/create-credential-connection)
- **List Credential Connections**: `GET /v2/credential_connections` - [API reference](https://developers.telnyx.com/api/connections/list-credential-connections)
- **Retrieve Credential Connection**: `GET /v2/credential_connections/{id}` - [API reference](https://developers.telnyx.com/api/connections/retrieve-credential-connection)

These are reached through the SDK's `client.credentialConnections()` service (`create` / `list` / `retrieve`).

## Architecture

```
  HTTP Client (curl / PBX / SBC)
        │
        ▼
  ┌─────────────────────────────────┐
  │ JDK HttpServer (:8080)          │
  │  POST /sip-connections          │
  │  GET  /sip-connections          │
  │  GET  /sip-connections/{id}     │
  └──────────────┬──────────────────┘
                 │  Telnyx Java SDK (TelnyxClient)
                 ▼
  ┌─────────────────────────────────┐
  │ Telnyx Credential Connections   │
  │ /v2/credential_connections      │
  └─────────────────────────────────┘
```

A single `TelnyxClient` is created once at startup via `TelnyxOkHttpClient.fromEnv()` and shared across requests (the client is thread-safe). The HTTP layer is the JDK's `com.sun.net.httpserver.HttpServer` - no web framework. SDK response models are mapped to plain maps before serialization, and the SIP `password` is never echoed back in any response.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/app/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PUBLIC_KEY` | `string` | `o0Yv...base64...` | no | Base64 Ed25519 public key for verifying inbound webhook signatures (only if you extend this example to receive webhooks) | [Portal](https://portal.telnyx.com/app/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `PORT` | `integer` | `8080` | no | Local HTTP server port (defaults to `8080`) | - |

> Only `TELNYX_API_KEY` is required to start the server. The Telnyx SDK reads `TELNYX_API_KEY` (and the optional `TELNYX_PUBLIC_KEY` / `TELNYX_BASE_URL`) directly from the environment via `TelnyxOkHttpClient.fromEnv()`.

## Setup

Requires JDK 17+ and Maven 3.8+. (The SDK's webhook signature verification uses JDK-native Ed25519, which requires JDK 15+.)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-java
cp .env.example .env          # ← fill in your Telnyx API key

# Load the .env into your shell (the SDK reads from the environment):
set -a && . ./.env && set +a

mvn -q compile                # compile against the Telnyx SDK
mvn -q exec:java              # starts on http://localhost:8080
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

### `POST /sip-connections`

Create a new credential (SIP) connection. The request body is a flat JSON object.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `connection_name` | `string` | yes | Human-readable name for the connection |
| `user_name` | `string` | yes | SIP username for credential authentication |
| `password` | `string` | yes | SIP password (never returned in responses) |

```bash
curl -X POST http://localhost:8080/sip-connections \
  -H "Content-Type: application/json" \
  -d '{
    "connection_name": "My PBX Trunk",
    "user_name": "sipuser12345",
    "password": "SuperSecretPass123"
  }'
```

**Response `201`:**

```json
{
  "id": "1293384261075731234",
  "connection_name": "My PBX Trunk",
  "user_name": "sipuser12345"
}
```

### `GET /sip-connections`

List all credential connections on your account (the SDK auto-pages across result pages).

```bash
curl http://localhost:8080/sip-connections
```

**Response `200`:**

```json
{
  "data": [
    {
      "id": "1293384261075731234",
      "connection_name": "My PBX Trunk",
      "user_name": "sipuser12345"
    }
  ]
}
```

### `GET /sip-connections/{id}`

Retrieve a single credential connection by ID.

```bash
curl http://localhost:8080/sip-connections/1293384261075731234
```

**Response `200`:**

```json
{
  "id": "1293384261075731234",
  "connection_name": "My PBX Trunk",
  "user_name": "sipuser12345"
}
```

### `GET /health`

Liveness probe.

```bash
curl http://localhost:8080/health
```

**Response `200`:**

```json
{ "status": "ok" }
```

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-java/API.md) for the full typed endpoint reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `TELNYX_API_KEY environment variable is not set.` then exit | No API key in the environment; the app exits at startup. | Set `TELNYX_API_KEY` (e.g. `set -a && . ./.env && set +a`) and re-run `mvn exec:java`. |
| `502 {"error": "Upstream Telnyx API error"}` | The Telnyx API rejected the request (bad/expired key, validation, or rate limit). Detail is logged server-side, not leaked to the caller. | Check the server logs, regenerate a key at [portal.telnyx.com/app/api-keys](https://portal.telnyx.com/app/api-keys), and verify the request fields. |
| `400 {"error": "Missing required field: connection_name"}` | A required field (`connection_name`, `user_name`, `password`) was missing. | Include all three fields in the JSON body. |
| `400 {"error": "Request body must be a JSON object"}` | The POST body was empty or not a JSON object. | Send a valid JSON object with `Content-Type: application/json`. |
| `KeyFactory.getInstance("Ed25519")` failure (only if you add webhooks) | Running on a JDK older than 15 without an Ed25519 provider. | Use JDK 17+ (the SDK's webhook verification path needs JDK-native Ed25519). |
| Build cannot resolve `com.telnyx.sdk:telnyx` | The artifactId is `telnyx`, not `telnyx-java`. | Confirm `pom.xml` pins `com.telnyx.sdk:telnyx:6.76.0` and re-run `mvn -q compile`. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [setup-sip-trunk-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-python/README.md) - same SIP trunk setup in Python/Flask
- [setup-sip-trunk-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-nodejs/README.md) - same SIP trunk setup in Node.js/Express
- [setup-sip-trunk-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-go/README.md) - same SIP trunk setup in Go/Gin
- [inbound-sip-routing-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-nodejs/README.md) - route inbound SIP calls

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [Create Credential Connection API reference](https://developers.telnyx.com/api/connections/create-credential-connection)
- [Java SDK](https://developers.telnyx.com/development/sdk/java)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [Elastic SIP Trunking pricing](https://telnyx.com/pricing/elastic-sip)
