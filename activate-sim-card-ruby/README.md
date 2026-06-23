---
name: activate-sim-card
title: "Activate SIM Card"
description: "Activate a Telnyx IoT SIM card using Ruby and Sinatra."
language: ruby
framework: sinatra
telnyx_products: [IoT/SIM]
---

# Activate SIM Card (Ruby)

Activate (enable) a Telnyx IoT SIM card over HTTP using the Telnyx Ruby SDK and Sinatra.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT SIM management on one private, global network — so you provision and activate cellular connectivity through the same API you use for the rest of your stack.

- **Global IoT SIMs** — a single SKU with multi-carrier coverage, managed entirely over the API.
- **Developer-first** — official SDKs (Ruby, Python, Node.js, Go, and more) with a consistent client interface and a comprehensive webhook event model.
- **Private network** — traffic traverses the Telnyx-owned IP network for lower latency and higher reliability than the public internet.

## Telnyx API Endpoints Used

- **Enable (activate) SIM Card**: `POST /v2/sim_cards/{id}/actions/enable` — [API reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)

The SDK method is `client.sim_cards.actions.enable(sim_card_id)`.

## Architecture

```
  POST /sim/activate
        │
        ▼
  ┌────────────────────────┐
  │   Sinatra handler       │
  │  (validate JSON body)   │
  └───────────┬────────────┘
              │ client.sim_cards.actions.enable(id)
              ▼
  ┌────────────────────────┐
  │   Telnyx IoT SIM API    │
  └───────────┬────────────┘
              │  enable is asynchronous
              └──► SIM transitions toward "enabled"
                          │
                          ▼  (optional) sim_card.status_changed
              ┌────────────────────────┐
              │  POST /webhooks/sim     │
              │  Ed25519 verify, then   │
              │  read data.payload      │
              └────────────────────────┘
```

Enabling a SIM card is **asynchronous**: the API accepts the request and the SIM transitions toward `enabled`. Confirm completion by polling the SIM status or by handling the `sim_card.status_changed` webhook on `/webhooks/sim`.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal → Keys & Credentials](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o6i...base64...=` | webhooks only | Base64 Ed25519 public key used to verify inbound webhook signatures | Portal → Account → Keys & Credentials → Public Key |
| `PORT` | `int` | `4567` | no | Port the Sinatra server listens on (default `4567`) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-ruby
cp .env.example .env       # ← fill in TELNYX_API_KEY (and TELNYX_PUBLIC_KEY for webhooks)
bundle install
bundle exec ruby app.rb    # starts on http://localhost:4567
```

> Requires **Ruby 3.2+**. The Telnyx 5.x SDK is a Stainless-generated rewrite and does not support older Ruby versions.

## API Reference

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-ruby/API.md) for the full typed reference.

### `POST /sim/activate`

Activate a SIM card by its Telnyx SIM card ID.

```bash
curl -X POST http://localhost:4567/sim/activate \
  -H "Content-Type: application/json" \
  -d '{
    "sim_card_id": "6b14e151-8493-4fa1-8664-1cc4e6d14158"
  }'
```

**Response `200`:**

```json
{
  "id": "f1f7e3a0-1c2b-4d3e-9a8b-0c1d2e3f4a5b",
  "status": "in-progress",
  "action_type": "enable",
  "sim_card_id": "6b14e151-8493-4fa1-8664-1cc4e6d14158"
}
```

### `POST /webhooks/sim`

Receives SIM status-change webhooks from Telnyx. The handler verifies the Ed25519 signature over `"<telnyx-timestamp>|<raw-body>"` (headers `Telnyx-Signature-Ed25519` and `Telnyx-Timestamp`) **before** parsing the body, then reads event fields from `data.payload`. Invalid or stale signatures return `401`.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| App exits with `TELNYX_API_KEY environment variable not set` on startup | `.env` missing or not loaded | Confirm `.env` exists in the same directory as `app.rb` and contains `TELNYX_API_KEY`. `dotenv/load` runs on require. |
| `LoadError` mentioning `standardwebhooks` when starting | `standardwebhooks` not installed | `require "telnyx"` loads it at startup. Run `bundle install` — it is pinned in the `Gemfile`. |
| `{"error": "Invalid API key"}` (HTTP 401) on `/sim/activate` | `TELNYX_API_KEY` is wrong or revoked | Generate a new key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and update `.env`. Remove any trailing spaces or quotes. |
| `{"error": "Missing required field: 'sim_card_id'"}` (HTTP 400) | Body missing `sim_card_id` or not valid JSON | Send a JSON body with a non-empty `sim_card_id` and `Content-Type: application/json`. |
| API error about SIM status / group | SIM is not in a state that can be enabled, or is not in a SIM card group | A SIM must belong to a SIM card group before it can be enabled. Check the SIM in [Telnyx Portal](https://portal.telnyx.com) under IoT → SIM Cards. |
| `{"error": "Rate limit exceeded. Please slow down."}` (HTTP 429) | Too many requests in a short window | Back off and retry with exponential backoff. |
| `{"error": "Invalid webhook signature"}` (HTTP 401) on `/webhooks/sim` | Signature/timestamp missing, stale (>5 min), or `TELNYX_PUBLIC_KEY` unset/wrong | Set `TELNYX_PUBLIC_KEY` to the base64 Ed25519 public key from the Portal and ensure your server clock is correct. |
| `Bundler::GemRequireError` / unsupported Ruby | Ruby older than 3.2 | Install Ruby 3.2+ (e.g. via `rbenv` or `asdf`) and re-run `bundle install`. |

## Related Examples

- [activate-sim-card-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-python/README.md) — Same flow in Python
- [activate-sim-card-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-nodejs/README.md) — Same flow in Node.js
- [activate-sim-card-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-go/README.md) — Same flow in Go
- [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) — Send SMS with the Telnyx Ruby SDK

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [Enable SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)
