---
name: activate-sim-card
title: "Activate SIM Card"
description: "Activate a Telnyx IoT SIM card over HTTP using the Telnyx Java SDK and the JDK HttpServer."
language: java
framework: jdk-httpserver
telnyx_products: [IoT]
channel: [iot]
---

# Activate SIM Card

Activate a Telnyx IoT SIM card over HTTP using the Telnyx Java SDK and the JDK `HttpServer`.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT SIM management on one private, global network - so you provision and activate connectivity through the same API you use for the rest of your stack.

- **Global IoT SIMs** - a single SKU with multi-carrier coverage, managed entirely over the API.
- **Developer-first** - a maintained Java SDK with a fluent, typed surface, plus SDKs for Python, Node.js, Go, and Ruby.
- **Predictable pricing** - pay-as-you-go data plans with no minimums or per-seat fees.

## Telnyx API Endpoints Used

- **Enable (activate) SIM Card**: `POST /v2/sim_cards/{id}/actions/enable` - [API reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)

The application calls the Telnyx Java SDK method `client.simCards().actions().enable(simCardId)`, which maps to the endpoint above.

## Architecture

```
  POST /sim/activate
        │
        ▼
  ┌──────────────────────┐
  │  JDK HttpServer       │
  │  ActivateHandler      │
  │  (parse + validate)   │
  └──────────┬───────────┘
             │ client.simCards().actions().enable(simCardId)
             ▼
  ┌──────────────────────┐
  │   Telnyx IoT SIM      │
  └──────────┬───────────┘
             │
             └──► SIM card transitions toward "enabled"
```

A single shared `TelnyxClient` is created once at startup via `TelnyxOkHttpClient.fromEnv()`. Each request is handled by one `HttpHandler`. There is no web framework - only `com.sun.net.httpserver.HttpServer` from the JDK.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal → API Keys](https://portal.telnyx.com/app/api-keys) |
| `PORT` | `integer` | `8080` | no | HTTP port the example listens on (defaults to `8080`) | - |

The SDK reads `TELNYX_API_KEY` directly from the environment via `TelnyxOkHttpClient.fromEnv()`. The credential is never hardcoded.

## Setup

Requires JDK 17+ and Maven 3.8+ (the SDK's webhook crypto path needs JDK 17+ for native Ed25519).

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-java
cp .env.example .env          # ← fill in your TELNYX_API_KEY

# Load the variables into your shell (the SDK reads them from the environment):
set -a && . ./.env && set +a

mvn -q compile                # install/compile dependencies
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


To run as a self-contained jar instead:

```bash
mvn -q package
java -jar target/activate-sim-card-java.jar
```

## API Reference

### `POST /sim/activate`

Activate (enable) a SIM card by its Telnyx SIM card ID.

```bash
curl -X POST http://localhost:8080/sim/activate \
  -H "Content-Type: application/json" \
  -d '{
    "sim_card_id": "6b14e151-8493-4fa1-8664-1cc4e6d14158"
  }'
```

**Response `200`:**

```json
{
  "id": "8a4c1b9e-4f2a-4c3d-9e21-8b7c6d5e4f3a",
  "sim_card_id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
  "status": "in-progress",
  "message": "SIM card enable requested"
}
```

`id` is the SIM-card *action* id (the enable operation is asynchronous); `status` is the action status. See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-java/API.md) for the full typed reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Process exits with `TELNYX_API_KEY environment variable is not set` on startup | `.env` not exported into the environment | Run `set -a && . ./.env && set +a` (or otherwise export `TELNYX_API_KEY`) before `mvn exec:java`. `fromEnv()` reads the process environment, not the `.env` file directly. |
| `{"error":"Invalid API key"}` (HTTP 401) | `TELNYX_API_KEY` is wrong or revoked | Generate a new key at [portal.telnyx.com/app/api-keys](https://portal.telnyx.com/app/api-keys) and re-export it. Remove any trailing spaces or quotes. |
| `{"error":"Missing required field: 'sim_card_id'"}` (HTTP 400) | Request body missing `sim_card_id` or not valid JSON | Send a JSON body with a non-empty `sim_card_id` and `Content-Type: application/json`. |
| `{"error":"SIM card not found"}` (HTTP 404) | The SIM card ID does not exist in your account | Confirm the ID in the [Telnyx Portal](https://portal.telnyx.com) under IoT → SIM Cards. Use the full UUID. |
| `{"error":"SIM card cannot be activated from its current status"}` (HTTP 422) | SIM is not in a state that can be enabled | A SIM can only be enabled from `disabled` / `standby`. Check the SIM status in the Portal. If it is already `enabled`, no action is needed. |
| `{"error":"Rate limit exceeded. Please slow down."}` (HTTP 429) | Too many requests in a short window | Back off and retry with exponential backoff. |
| Connection refused on port 8080 | App isn't running or port in use | Start the app and ensure no other process uses `PORT`. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [activate-sim-card-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-go/README.md) - Same flow in Go
- [activate-sim-card-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-python/README.md) - Same flow in Python
- [activate-sim-card-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-nodejs/README.md) - Same flow in Node.js
- [monitor-iot-data-usage-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-python/README.md) - Track SIM data usage

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
- [Enable SIM Card - API Reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)
- [Java SDK](https://developers.telnyx.com/development/sdk/java)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)
