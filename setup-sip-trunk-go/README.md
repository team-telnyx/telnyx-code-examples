---
name: setup-sip-trunk
title: "Setup SIP Trunk"
description: "Create, list, and retrieve Telnyx SIP trunk connections via a Go and Gin REST API."
language: go
framework: gin
telnyx_products: [SIP Trunking]
channel: [voice]
---

# Setup SIP Trunk

Create, list, and retrieve Telnyx SIP trunk connections via a Go and Gin REST API.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. SIP connections route over the Telnyx-owned IP backbone for lower latency and higher call reliability than the public internet, with credential-based authentication and outbound voice profiles managed entirely through the API.

## Telnyx API Endpoints Used

- **Create Credential Connection**: `POST /v2/credential_connections` -- [API reference](https://developers.telnyx.com/api/connections/create-credential-connection)
- **List Credential Connections**: `GET /v2/credential_connections` -- [API reference](https://developers.telnyx.com/api/connections/list-connections)
- **Retrieve Credential Connection**: `GET /v2/credential_connections/{id}` -- [API reference](https://developers.telnyx.com/api/connections/retrieve-connection)

## Architecture

```
  HTTP Client (curl / PBX / SBC)
        │
        ▼
  ┌──────────────────────┐
  │ Gin REST API (:8080)  │
  │  /sip-connections     │
  └──────────┬───────────┘
             │  Telnyx Go SDK
             ▼
  ┌──────────────────────┐
  │ Telnyx SIP Trunking   │
  └──────────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `SIP_ENDPOINT_IP` | `string` | `192.0.2.10` | no | Default public IP/domain of your SIP endpoint | Your PBX/SBC |
| `SIP_ENDPOINT_PORT` | `string` | `5060` | no | Default SIP endpoint port (1–65535) | Your PBX/SBC |

> Only `TELNYX_API_KEY` is required to start the server. `SIP_ENDPOINT_IP` and `SIP_ENDPOINT_PORT` are loaded into config for convenience; the SIP endpoint used for a connection is supplied per request in the `POST /sip-connections` body.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-go
cp .env.example .env    # ← fill in your Telnyx API key
go mod download
go run .                # starts on http://localhost:8080
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

Create a new SIP trunk connection with credential authentication and a SIP endpoint.

```bash
curl -X POST http://localhost:8080/sip-connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My PBX Trunk",
    "username": "sip_user",
    "password": "s3cure_p@ss",
    "sip_endpoint_ip": "192.0.2.10",
    "sip_endpoint_port": 5060,
    "outbound_voice_profile_id": "1293384261075731499"
  }'
```

**Response `201`:**

```json
{
  "id": "1293384261075731234",
  "name": "My PBX Trunk",
  "username": "sip_user",
  "sip_endpoint_ip": "192.0.2.10",
  "sip_endpoint_port": 5060,
  "outbound_voice_profile_id": "1293384261075731499",
  "created_at": "2026-06-18 12:00:00 +0000 UTC"
}
```

### `GET /sip-connections`

List all SIP trunk connections on your account.

```bash
curl http://localhost:8080/sip-connections
```

**Response `200`:**

```json
[
  {
    "id": "1293384261075731234",
    "name": "My PBX Trunk",
    "username": "sip_user",
    "sip_endpoint_ip": "192.0.2.10",
    "sip_endpoint_port": 5060,
    "outbound_voice_profile_id": "1293384261075731499",
    "created_at": "2026-06-18 12:00:00 +0000 UTC"
  }
]
```

### `GET /sip-connections/:id`

Retrieve a single SIP trunk connection by ID.

```bash
curl http://localhost:8080/sip-connections/1293384261075731234
```

**Response `200`:**

```json
{
  "id": "1293384261075731234",
  "name": "My PBX Trunk",
  "username": "sip_user",
  "sip_endpoint_ip": "192.0.2.10",
  "sip_endpoint_port": 5060,
  "outbound_voice_profile_id": "1293384261075731499",
  "created_at": "2026-06-18 12:00:00 +0000 UTC"
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

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Error: TELNYX_API_KEY environment variable not set` on startup | No API key in environment; the app exits in `init()`. | Set `TELNYX_API_KEY` in `.env` (or export it) and re-run `go run .`. |
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is wrong, revoked, or has stray quotes/spaces. | Regenerate a key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and update `.env`. |
| `400 SIP endpoint port must be between 1 and 65535` | `sip_endpoint_port` is out of range. | Use a valid port - SIP is commonly `5060` (UDP/TCP) or `5061` (TLS). |
| `400` binding error on create | A required field (`name`, `username`, `password`, `sip_endpoint_ip`, `sip_endpoint_port`) is missing or malformed JSON. | Include all required fields and send valid `Content-Type: application/json`. |
| `429 Rate limit exceeded` | Too many requests to the Telnyx API. | Slow down and retry with backoff. |
| `503 Network error connecting to Telnyx` | Outbound HTTPS to `api.telnyx.com` is blocked or down. | Check connectivity and that a firewall/proxy is not blocking outbound HTTPS, then retry. |

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
- [inbound-sip-routing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-python/README.md) - route inbound SIP calls
- [sip-failover-routing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-python/README.md) - failover routing for high availability

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
- [Connections API reference](https://developers.telnyx.com/api/connections/create-credential-connection)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [Elastic SIP Trunking pricing](https://telnyx.com/pricing/elastic-sip)
