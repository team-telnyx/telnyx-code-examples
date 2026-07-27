---
name: number-search-and-purchase-api
title: "Number Search and Purchase API"
description: "Number Search and Purchase API - search, filter, and buy phone numbers programmatically."
language: python
framework: flask
telnyx_products: [Numbers]
---

# Number Search and Purchase API

Number Search and Purchase API - search, filter, and buy phone numbers programmatically.

## Telnyx API Endpoints Used

- **Search Available Numbers**: `GET /v2/available_phone_numbers` - [API reference](https://developers.telnyx.com/api/numbers/list-available-phone-numbers)
- **Create Number Order**: `POST /v2/number_orders` - [API reference](https://developers.telnyx.com/api/numbers/create-number-order)
- **List Phone Numbers**: `GET /v2/phone_numbers` - [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │ Your App          │
  └────────┬─────────┘
           │
           ├──► Telnyx Number Management
           │
           ├──► Appointment scheduling
           │
           ▼
     JSON response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `PORT` | `integer` | `5000` | no | HTTP server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/number-search-and-purchase-api-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
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

### `GET /numbers/search`

Returns search

```bash
curl http://localhost:5000/numbers/search
```

**Response:**

```json
{
  "numbers": [
    {
      "phone_number": "+18005551234",
      "status": "active",
      "type": "local",
      "region": "US-CA"
    }
  ]
}
```

### `POST /numbers/purchase`

Triggers purchase

```bash
curl -X POST http://localhost:5000/numbers/purchase \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "numbers": [
    {
      "phone_number": "+18005551234",
      "status": "active",
      "type": "local",
      "region": "US-CA"
    }
  ]
}
```

### `GET /numbers/inventory`

Returns inventory

```bash
curl http://localhost:5000/numbers/inventory
```

**Response:**

```json
{
  "numbers": [
    {
      "phone_number": "+18005551234",
      "status": "active",
      "type": "local",
      "region": "US-CA"
    }
  ]
}
```

### `GET /health`

Returns health

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "active_sessions": 2,
  "version": "1.0.0"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [Branded Caller Id Manager (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/branded-caller-id-manager-python/README.md)
- [Build Conference Calling (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-python/README.md)
- [Build IVR Phone Menu (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-python/README.md)
- [Bulk Number Validation Cleaner (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/bulk-number-validation-cleaner-python/README.md)
- [Call Analytics Dashboard Api (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-analytics-dashboard-api-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
