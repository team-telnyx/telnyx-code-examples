---
name: inbound-sip-routing
title: "Inbound SIP Routing"
description: "Create and manage Telnyx SIP connections for inbound call routing, and receive inbound call webhooks, using Node.js and Express."
language: nodejs
framework: express
telnyx_products: [SIP Trunking, Voice]
channel: [voice]
---

# Inbound SIP Routing

Create and manage Telnyx SIP connections for inbound call routing, and receive inbound call webhooks, using Node.js and Express.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Owned network** - inbound calls traverse the Telnyx-owned IP backbone for lower latency and higher reliability than the public internet.
- **Programmable SIP** - create and configure SIP connections entirely through the API, with authentication and webhook event delivery built in.

## Telnyx API Endpoints Used

- **Create SIP Connection**: `POST /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- **List SIP Connections**: `GET /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip-trunking/list-credential-connections)
- **Retrieve SIP Connection**: `GET /v2/sip_connections/{id}` -- [API reference](https://developers.telnyx.com/api/sip-trunking/retrieve-credential-connection)

## Architecture

```
  HTTP client                          Inbound PSTN call
       │                                       │
       ▼                                       ▼
  ┌──────────────────────┐            ┌──────────────────┐
  │ Express app          │            │ Telnyx Voice/SIP  │
  │ /sip/connections     │            └────────┬─────────┘
  │ /sip/connections/:id │                     │
  └──────────┬───────────┘                     │ webhook
             │                                  ▼
             │ SDK call            ┌────────────────────────────┐
             ▼                     │ POST /webhooks/inbound-call │
  ┌──────────────────┐            └────────────────────────────┘
  │ Telnyx SIP API    │
  └──────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000` if unset) | - |
| `SIP_ENDPOINT` | `string` | `sip:user@example.com` | **yes** | Inbound SIP URI that new connections route calls to | Your SIP server |
| `SIP_USERNAME` | `string` | `your_sip_username` | **yes** | Inbound authentication username for the SIP connection | Your SIP server |
| `SIP_PASSWORD` | `string` | `your_sip_password` | **yes** | Inbound authentication password for the SIP connection | Your SIP server |
| `WEBHOOK_URL` | `string` | `https://your-domain.com/webhook` | no | Public base URL logged at startup for the inbound-call webhook | [ngrok](https://ngrok.com) / your host |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
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


### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in the [Telnyx Portal](https://portal.telnyx.com):

   - **Voice / SIP Connection** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/inbound-call`

## API Reference

### `POST /sip/connections`

Create a new SIP connection for inbound routing. Uses `SIP_ENDPOINT`, `SIP_USERNAME`, and `SIP_PASSWORD` from the environment for the inbound URI and authentication.

```bash
curl -X POST http://localhost:5000/sip/connections \
  -H "Content-Type: application/json" \
  -d '{
    "connection_name": "inbound-routing-prod"
  }'
```

**Response `201`:**

```json
{
  "id": "1234567890",
  "connection_name": "inbound-routing-prod",
  "inbound_uri": "sip:user@example.com",
  "created_at": "2026-06-18T12:00:00Z"
}
```

### `GET /sip/connections`

List all SIP connections on the account.

```bash
curl http://localhost:5000/sip/connections
```

**Response `200`:**

```json
[
  {
    "id": "1234567890",
    "connection_name": "inbound-routing-prod",
    "inbound_uri": "sip:user@example.com",
    "created_at": "2026-06-18T12:00:00Z"
  }
]
```

### `GET /sip/connections/:id`

Retrieve a single SIP connection by ID.

```bash
curl http://localhost:5000/sip/connections/1234567890
```

**Response `200`:**

```json
{
  "id": "1234567890",
  "connection_name": "inbound-routing-prod",
  "inbound_uri": "sip:user@example.com",
  "inbound_authentication_username": "your_sip_username",
  "created_at": "2026-06-18T12:00:00Z"
}
```

### `POST /webhooks/inbound-call`

Receive inbound call webhooks from Telnyx. The app logs the event and acknowledges receipt. Extend this handler to route calls.

```bash
curl -X POST http://localhost:5000/webhooks/inbound-call \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.initiated",
      "call_session_id": "abc-123",
      "from": "+12125551234",
      "to": "+13105550000",
      "occurred_at": "2026-06-18T12:00:00Z"
    }
  }'
```

**Response `200`:**

```json
{
  "status": "received"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `{"error": "Invalid API key"}` with HTTP 401 | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace | Copy a fresh key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env` and restart `node server.js`. |
| `{"error": "Missing required field: connection_name"}` (400) | `POST /sip/connections` was sent without a `connection_name` in the JSON body | Include `connection_name` and send `Content-Type: application/json`. |
| SIP connection creation fails (400/422) | `SIP_ENDPOINT`, `SIP_USERNAME`, or `SIP_PASSWORD` is unset or invalid | Set all three in `.env`. Confirm the SIP URI is reachable and accepts the configured credentials. |
| Inbound webhooks never hit `/webhooks/inbound-call` | `WEBHOOK_URL` is not public or the SIP connection isn't linked to your number | Expose the server with `ngrok http 5000`, set the public URL in the Portal, and attach the connection to your Telnyx number. |
| `{"error": "Rate limit exceeded..."}` (429) | Too many SIP API requests in a short window | Add retry/backoff on the client side and reduce request frequency. |
| Server starts on `:3000` instead of `:5000` | `PORT` was not loaded from `.env` | Confirm `.env` contains `PORT=5000` and that `require("dotenv").config()` runs before startup. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [inbound-sip-routing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-python/README.md) - same example in Python
- [setup-sip-trunk-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-nodejs/README.md) - provision a SIP trunk in Node.js
- [configure-sip-codecs-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/configure-sip-codecs-python/README.md) - tune SIP connection codecs

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Connections API reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)
