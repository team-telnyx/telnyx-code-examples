---
name: setup-sip-trunk
title: "Set Up a SIP Trunk (C#)"
description: "Create, list, and retrieve credential-authenticated SIP connections using the Telnyx.net SDK and minimal ASP.NET."
language: csharp
framework: aspnet
telnyx_products: [SIP Trunking]
channel: [voice]
---

# Set Up a SIP Trunk (C#)

Create, list, and retrieve credential-authenticated SIP connections using the official Telnyx.net SDK and a minimal ASP.NET (net8.0) app.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. Credential SIP connections authenticate with a username and password and route calls over the Telnyx-owned IP backbone instead of the public internet, giving you lower latency, higher call quality, and full programmatic provisioning through the API.

## Telnyx API Endpoints Used

- **Create credential connection**: `POST /v2/credential_connections` - [API reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- **List credential connections**: `GET /v2/credential_connections` - [API reference](https://developers.telnyx.com/api/sip-trunking/list-credential-connections)
- **Retrieve credential connection**: `GET /v2/credential_connections/{id}` - [API reference](https://developers.telnyx.com/api/sip-trunking/retrieve-credential-connection)

## Architecture

```
  HTTP Request
        │
        ▼
  ┌───────────────────────────┐
  │  Minimal ASP.NET Program.cs│
  │  /sip/connections          │
  │  /webhooks/telnyx          │
  └────────────┬──────────────┘
               │ Telnyx.net SDK
               │ (CredentialConnectionService)
               ▼
  ┌───────────────────────────┐
  │  Telnyx SIP Trunking       │
  │  /credential_connections   │
  └───────────────────────────┘
```

The app configures the SDK statically with `TelnyxConfiguration.SetApiKey(...)`, then instantiates `CredentialConnectionService` per request. The inbound webhook route verifies the Telnyx Ed25519 signature with `Webhook.ConstructEvent` before reading `data.payload`.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal > API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o2D5...base64` | **yes** (for webhooks) | Account base64 Ed25519 public key, used to verify inbound webhook signatures | [Portal > Account > Public Key](https://portal.telnyx.com) |
| `TELNYX_API_BASE_URL` | `string` | `https://api.telnyx.com/v2` | no | Override the API base URL (defaults to `https://api.telnyx.com/v2`) | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-csharp
cp .env.example .env    # ← fill in your credentials
dotnet restore
dotnet run              # starts on http://localhost:5000 (or the Kestrel default)
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


The app reads `.env` via `DotNetEnv` at startup. Kestrel binds to the default ASP.NET URL (typically `http://localhost:5000`); the startup log prints the exact address. If `TELNYX_API_KEY` is missing, the app fails fast with a clear error before serving requests.

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-csharp/API.md) for the full typed endpoint reference. Summary:

### `POST /sip/connections`

Create a credential SIP connection.

```bash
curl -X POST http://localhost:5000/sip/connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "office-pbx",
    "username": "myuser12345",
    "password": "mySecret1234567",
    "active": true
  }'
```

**Response (`201 Created`):**

```json
{
  "id": "1293384261075731499",
  "connection_name": "office-pbx",
  "username": "myuser12345",
  "active": true,
  "sip_uri_calling_preference": "disabled"
}
```

The password is never returned in any response.

### `GET /sip/connections`

List credential connections. Supports `page` and `pageSize` query parameters.

```bash
curl "http://localhost:5000/sip/connections?page=1&pageSize=20"
```

### `GET /sip/connections/{id}`

Retrieve one credential connection by ID.

```bash
curl http://localhost:5000/sip/connections/1293384261075731499
```

### `POST /webhooks/telnyx`

Receives inbound Telnyx webhooks, verifies the Ed25519 signature, and reads `data.payload`. Returns `200` on a verified event and `401` on a bad signature or stale timestamp.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| App exits with `TELNYX_API_KEY environment variable is required` | `.env` is missing or `TELNYX_API_KEY` is unset. | Copy `.env.example` to `.env` and paste a valid key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys). |
| `400 {"error":"name, username, and password are required"}` | The POST body omitted one of `name`, `username`, or `password`. | Send all three as JSON with a `Content-Type: application/json` header. |
| `502 Failed to create SIP connection` | The Telnyx API rejected the request (invalid key, duplicate name, validation error). The detail is logged server-side, not returned. | Check the app logs for the `TelnyxException` detail; verify the API key and that the connection name/username are unique and valid. |
| `401 Unauthorized` on `/webhooks/telnyx` | The Ed25519 signature failed or the `telnyx-timestamp` is outside the 300s tolerance. | Confirm `TELNYX_PUBLIC_KEY` matches your account's public key and that the raw body is forwarded unmodified by any proxy. |
| `500` on `/webhooks/telnyx` | `TELNYX_PUBLIC_KEY` is not set. | Add `TELNYX_PUBLIC_KEY` to `.env` and restart. |
| `NU1101: unable to find package Telnyx` | Wrong NuGet id. | The package id is `Telnyx.net`, not `Telnyx`. Use `<PackageReference Include="Telnyx.net" Version="3.1.0" />`. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [setup-sip-trunk-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-python/README.md) - Same SIP trunk setup in Python
- [setup-sip-trunk-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-nodejs/README.md) - Same SIP trunk setup in Node.js
- [setup-sip-trunk-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-go/README.md) - Same SIP trunk setup in Go
- [inbound-sip-routing-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-nodejs/README.md) - Route inbound SIP calls in Node.js

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [Credential Connections API Reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- [.NET SDK](https://developers.telnyx.com/development/sdk/dotnet)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [Elastic SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)
