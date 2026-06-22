---
name: setup-sip-trunk
title: "Set Up a SIP Trunk"
description: "Create, retrieve, and list credential-authenticated SIP connections using the Telnyx SIP Trunking API."
language: nodejs
framework: express
telnyx_products: [SIP Trunking]
channel: [voice]
---

# Set Up a SIP Trunk

Create, retrieve, and list credential-authenticated SIP connections using the Telnyx SIP Trunking API.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. SIP connections traverse the Telnyx-owned IP backbone instead of the public internet, giving you lower latency, higher call quality, and credential-based authentication you provision entirely through the API.

## Telnyx API Endpoints Used

- **Create SIP Connection**: `POST /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- **Retrieve SIP Connection**: `GET /v2/sip_connections/{id}` -- [API reference](https://developers.telnyx.com/api/sip-trunking/retrieve-credential-connection)
- **List SIP Connections**: `GET /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip-trunking/list-credential-connections)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────────┐
  │  Express server.js    │
  │  /sip/connections      │
  └──────────┬───────────┘
             │ telnyx SDK
             ▼
  ┌──────────────────────┐
  │  Telnyx SIP Trunking  │
  │  credential_connections│
  └──────────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000` if unset) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
```

With the `PORT=5000` value from `.env.example`, the server listens on `http://localhost:5000`. If you remove `PORT`, it falls back to `3000`.

## API Reference

### `POST /sip/connections`

Create a new credential-authenticated SIP connection.

```bash
curl -X POST http://localhost:5000/sip/connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "office-pbx",
    "username": "pbxuser01",
    "password": "s3cretp4ss",
    "endpoint": "sip.example.com:5060"
  }'
```

**Response (`201 Created`):**

```json
{
  "id": "1234567890",
  "name": "office-pbx",
  "username": "pbxuser01",
  "status": "active",
  "created_at": "2026-06-18T12:00:00.000Z"
}
```

### `GET /sip/connections/:id`

Retrieve a single SIP connection by its ID.

```bash
curl http://localhost:5000/sip/connections/1234567890
```

**Response (`200 OK`):**

```json
{
  "id": "1234567890",
  "name": "office-pbx",
  "status": "active",
  "created_at": "2026-06-18T12:00:00.000Z",
  "updated_at": "2026-06-18T12:05:00.000Z"
}
```

### `GET /sip/connections`

List all SIP connections on the account.

```bash
curl http://localhost:5000/sip/connections
```

**Response (`200 OK`):**

```json
[
  {
    "id": "1234567890",
    "name": "office-pbx",
    "status": "active",
    "created_at": "2026-06-18T12:00:00.000Z"
  }
]
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Connection refused` on port 5000 | Server isn't running, or `PORT` differs from what you're curling. | Run `node server.js` and confirm the startup log shows the port; curl that same port. |
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace/quotes. | Generate a fresh key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys), paste it into `.env`, and restart the server. |
| `400 Missing required fields` | The POST body is missing `name`, `username`, `password`, or `endpoint`. | Send all four fields as JSON with a `Content-Type: application/json` header. |
| `400 Endpoint must be a valid hostname or IP address` | The `endpoint` value contains no `.` or `:`. | Use a hostname (`sip.example.com`) or IP with optional port (`192.168.1.10:5060`). |
| `429 Rate limit exceeded` | Too many API requests in a short window. | Back off and retry with exponential delays; see [API limits](https://developers.telnyx.com/docs/api). |
| `503 Network error connecting to Telnyx` | The server cannot reach the Telnyx API. | Check outbound network/DNS and retry. |

## Related Examples

- [setup-sip-trunk-python](../setup-sip-trunk-python/) - Same SIP trunk setup in Python
- [setup-sip-trunk-go](../setup-sip-trunk-go/) - Same SIP trunk setup in Go
- [inbound-sip-routing-nodejs](../inbound-sip-routing-nodejs/) - Route inbound SIP calls in Node.js
- [configure-sip-codecs-python](../configure-sip-codecs-python/) - Configure codecs on a SIP connection

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Trunking API Reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [Elastic SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)
