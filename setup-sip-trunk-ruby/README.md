---
name: setup-sip-trunk
title: "Set Up a SIP Trunk (Ruby)"
description: "Create, list, and retrieve credential-authenticated SIP connections using the Telnyx SIP Trunking API with Ruby and Sinatra."
language: ruby
framework: sinatra
telnyx_products: [SIP Trunking]
channel: [voice]
---

# Set Up a SIP Trunk (Ruby)

Create, list, and retrieve credential-authenticated SIP connections using the Telnyx SIP Trunking API with Ruby and Sinatra.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. SIP connections traverse the Telnyx-owned IP backbone instead of the public internet, giving you lower latency, higher call quality, and credential-based authentication you provision entirely through the API.

## Telnyx API Endpoints Used

- **Create credential connection**: `POST /v2/credential_connections` - [API reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- **List credential connections**: `GET /v2/credential_connections` - [API reference](https://developers.telnyx.com/api/sip-trunking/list-credential-connections)
- **Retrieve credential connection**: `GET /v2/credential_connections/{id}` - [API reference](https://developers.telnyx.com/api/sip-trunking/retrieve-credential-connection)

## Architecture

```
  HTTP request
        │
        ▼
  ┌─────────────────────────┐
  │  Sinatra app.rb          │
  │  /sip/connections        │
  │  /webhooks/sip           │
  └──────────┬──────────────┘
             │ telnyx Ruby SDK (Telnyx::Client)
             ▼
  ┌─────────────────────────┐
  │  Telnyx SIP Trunking      │
  │  credential_connections   │
  └─────────────────────────┘

  Inbound webhook ─▶ Ed25519 signature verify ─▶ read data.payload
```

The app instantiates one `Telnyx::Client` per process. Each route maps directly to a Telnyx `credential_connections` SDK call and returns plain JSON. The webhook route verifies the Telnyx Ed25519 signature natively (with the `ed25519` gem) before parsing the body.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal > Keys & Credentials](https://portal.telnyx.com/#/app/account/keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o0Yx...base64...=` | only for webhooks | Base64 Ed25519 public key used to verify inbound webhook signatures | [Portal > Keys & Credentials](https://portal.telnyx.com/#/app/account/keys) |
| `PORT` | `number` | `4567` | no | Port the Sinatra server listens on (defaults to `4567`) | - |

## Setup

> **Requires Ruby 3.2 or newer.** The Telnyx 5.x SDK is a Stainless rewrite that
> drops Ruby 2.x/3.0/3.1. This example was authored against a system with Ruby
> 2.6, so it was **not run locally - CI must confirm** install, lint, and boot on Ruby 3.2+.

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-ruby
cp .env.example .env       # ← fill in your credentials
bundle install
ruby app.rb                # starts on http://localhost:4567
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


With the `PORT=4567` value from `.env.example`, the server listens on `http://localhost:4567`. Change `PORT` to use a different port.

## API Reference

### `POST /sip/connections`

Create a new credential-authenticated SIP connection.

```bash
curl -X POST http://localhost:4567/sip/connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "office-pbx",
    "username": "pbxuser01",
    "password": "s3cretp4ssw0rd"
  }'
```

**Response (`201 Created`):**

```json
{
  "id": "1234567890",
  "connection_name": "office-pbx",
  "user_name": "pbxuser01",
  "status": "active",
  "created_at": "2026-06-18T12:00:00.000Z"
}
```

### `GET /sip/connections/:id`

Retrieve a single SIP connection by its ID.

```bash
curl http://localhost:4567/sip/connections/1234567890
```

**Response (`200 OK`):**

```json
{
  "id": "1234567890",
  "connection_name": "office-pbx",
  "user_name": "pbxuser01",
  "status": "active",
  "created_at": "2026-06-18T12:00:00.000Z"
}
```

### `GET /sip/connections`

List SIP connections (paginated via `page_number` / `page_size` query params).

```bash
curl "http://localhost:4567/sip/connections?page_number=1&page_size=20"
```

**Response (`200 OK`):**

```json
[
  {
    "id": "1234567890",
    "connection_name": "office-pbx",
    "user_name": "pbxuser01",
    "status": "active",
    "created_at": "2026-06-18T12:00:00.000Z"
  }
]
```

### `POST /webhooks/sip`

Inbound webhook receiver for SIP/voice events. Verifies the Telnyx Ed25519
signature before reading `data.payload`. Returns `200` once handled, `401` on an
invalid signature, `408` on a stale timestamp. See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-ruby/API.md) for the full
typed reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `LoadError: cannot load such file -- standardwebhooks` | `telnyx` 5.x requires `standardwebhooks` at load time but does not declare it as a dependency. | It is already pinned in the `Gemfile`; run `bundle install`. |
| Install fails / syntax errors on `ruby app.rb` | You are on Ruby < 3.2. The SDK requires 3.2+. | Install Ruby 3.2+ (e.g. via `rbenv`/`asdf`) and re-run `bundle install`. |
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace/quotes. | Generate a fresh key in the [Portal](https://portal.telnyx.com/#/app/account/keys), paste it into `.env`, and restart the server. |
| `400 Missing required fields` | The POST body is missing `name`, `username`, or `password`. | Send all three fields as JSON with a `Content-Type: application/json` header. |
| `422` on create | `user_name` must be 4–32 chars and `password` ≥ 8 chars. | Adjust the credentials to meet the constraints; see the [API reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection). |
| Webhook returns `401 Invalid signature` | `TELNYX_PUBLIC_KEY` is wrong, or a proxy altered the raw body. | Use the base64 Ed25519 public key from the Portal and forward the unmodified body and `telnyx-*` headers. |
| `429 Rate limit exceeded` | Too many API requests in a short window. | Back off and retry with exponential delays. |
| `503 Network error connecting to Telnyx` | The server cannot reach the Telnyx API. | Check outbound network/DNS and retry. |

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
- [inbound-sip-routing-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-nodejs/README.md) - Route inbound SIP calls with webhooks
- [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) - Send SMS with the Telnyx Ruby SDK

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
- [Credential Connection API Reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [Elastic SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)
