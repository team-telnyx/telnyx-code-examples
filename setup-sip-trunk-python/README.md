---
name: setup-sip-trunk
title: "Setup SIP Trunk"
description: "Provision and configure a SIP trunk connection on Telnyx with codec preferences, authentication, and failover."
language: python
framework: flask
telnyx_products: [SIP Trunking]
---

# Setup SIP Trunk

Provision and configure a SIP trunk connection on Telnyx with codec preferences, authentication, and failover.

## Telnyx API Endpoints Used

- **Create SIP Connection**: `POST /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip/create-sip-connection)
- **List SIP Connections**: `GET /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip/list-sip-connections)

## Architecture

```
  Your PBX / SBC
        │
        ▼
  ┌──────────────────┐
  │ Telnyx SIP Trunk  │
  │ (IP / FQDN auth)  │
  └────────┬─────────┘
           │
           ▼
     PSTN / Telnyx Network
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Elastic SIP** - instant provisioning, global coverage, codec negotiation, and failover built in.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | - |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-python
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

### `POST /sip/setup`

HTTP endpoint to set up SIP trunking.

```bash
curl -X POST http://localhost:5000/sip/setup \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "connections": [
    {
      "id": "1494404757140276705",
      "name": "Production SIP",
      "status": "active",
      "ip": "192.168.1.100"
    }
  ]
}
```

## Troubleshooting

- **Connection refused on port 5000**: App isn't running. Run `python app.py` and check no other process uses port 5000.
- **401 Unauthorized**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).

## Related Examples

- [Configure SIP Codecs (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/configure-sip-codecs-python/README.md)
- [Inbound SIP Routing (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-python/README.md)
- [SIP Failover Routing (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-python/README.md)
- [SIP Load Balancer Health Check (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-load-balancer-health-check-python/README.md)
- [SIP Trunking Failover Monitor (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-trunking-failover-monitor-python/README.md)

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

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
