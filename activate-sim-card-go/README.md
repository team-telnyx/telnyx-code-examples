---
name: activate-sim-card
title: "Activate SIM Card"
description: "Activate a Telnyx IoT SIM card over HTTP using the Telnyx Go SDK and Gin."
language: go
framework: gin
telnyx_products: [IoT]
channel: [iot]
---

# Activate SIM Card

Activate a Telnyx IoT SIM card over HTTP using the Telnyx Go SDK and Gin.

## Telnyx API Endpoints Used

- **Activate SIM Card**: `POST /v2/sim_cards/{id}/actions/enable` -- [API reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)

## Architecture

```
  POST /sim/activate
        │
        ▼
  ┌──────────────────┐
  │   Gin handler     │
  │  (validate body)  │
  └────────┬─────────┘
           │ client.SimCards.Actions.Enable(ctx, id)
           ▼
  ┌──────────────────┐
  │  Telnyx IoT SIM   │
  └────────┬─────────┘
           │
           └──► SIM card transitions to "enabling"
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT SIM management on one private, global network - so you provision and activate connectivity through the same API you use for the rest of your stack.

- **Global IoT SIMs** - a single SKU with multi-carrier coverage, managed entirely over the API.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-go
cp .env.example .env    # ← fill in your TELNYX_API_KEY
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

### `POST /sim/activate`

Activate a SIM card by its Telnyx SIM card ID.

```bash
curl -X POST http://localhost:8080/sim/activate \
  -H "Content-Type: application/json" \
  -d '{
    "sim_card_id": "6b14e151-8493-4fa1-8664-1cc4e6d14158"
  }'
```

**Response:**

```json
{
  "id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
  "sim_card_id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
  "action_type": "enable",
  "status": "in-progress",
  "created_at": "2024-01-01T00:00:00Z"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| App panics with `TELNYX_API_KEY environment variable not set` on startup | `.env` missing or variable not loaded | Confirm `.env` exists in the same directory as `main.go` and contains `TELNYX_API_KEY`. `godotenv.Load()` runs in `init()` before `os.Getenv()`. |
| `{"error": "Invalid API key"}` (HTTP 401) | `TELNYX_API_KEY` is wrong or revoked | Generate a new key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and update `.env`. Remove any trailing spaces or quotes. |
| `{"error": "Missing required field: 'sim_card_id'"}` (HTTP 400) | Request body missing `sim_card_id` or not valid JSON | Send a JSON body with a non-empty `sim_card_id` and `Content-Type: application/json`. |
| API error about SIM already active / invalid status | SIM is not in a state that can be activated | A SIM can only be activated from `ready` or `standby`. Check the SIM status in [Telnyx Portal](https://portal.telnyx.com) under IoT → SIM Cards. |
| `{"error": "Rate limit exceeded. Please slow down."}` (HTTP 429) | Too many requests in a short window | Back off and retry. |
| Connection refused on port 8080 | App isn't running | Run `go run .` and check no other process uses port 8080. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [activate-sim-card-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-python/README.md) - Same flow in Python
- [activate-sim-card-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-nodejs/README.md) - Same flow in Node.js
- [monitor-iot-data-usage-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-python/README.md) - Track SIM data usage
- [send-sms-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-go/README.md) - Send SMS with the Telnyx Go SDK

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

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)
</content>
</invoke>
