---
name: edge-webhook-aggregator
title: "Edge Webhook Aggregator"
description: "Multi-tenant webhook consolidation at the edge."
language: python
framework: flask
telnyx_products: [Edge Compute, Voice, Messaging]
channel: [voice, sms]
---

# Edge Webhook Aggregator

> Also known as: webhook batching, multi-tenant webhooks, event aggregation, webhook proxy, event consolidation.

Multi-tenant webhook consolidation at the edge. Receives all Telnyx voice and messaging events, classifies by tenant from phone number mapping, batches events per interval, and forwards one consolidated payload per tenant.

## Why Telnyx

Telnyx is AI Communications Infrastructure: voice, messaging, and AI on one private global network instead of the public internet. Because every voice and SMS event already flows through that network, this aggregator can verify each webhook's Ed25519 signature, consolidate events per tenant at the edge, and forward a single batched payload - cutting backend traffic without bolting on a third-party event bus. One provider, one signing key, and one billing relationship across all channels.

## Telnyx API Endpoints Used

- See code for API calls

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):



## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | Server port | -- |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-webhook-aggregator-python
cp .env.example .env
pip install -r requirements.txt
python app.py
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

1. Expose your local server: `ngrok http 5000`
2. Configure in [Telnyx Portal](https://portal.telnyx.com/call-control/applications):
   - Call Control Application -> Webhook URL -> `https://<id>.ngrok.io/webhooks/voice`

## API Reference

### `POST /tenants`

Tenants.

```bash
curl -X POST http://localhost:5000/tenants \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `GET /tenants`

Tenants.

```bash
curl http://localhost:5000/tenants
```

**Response:**

```json
{"status": "ok", "service": "edge-webhook-aggregator"}
```

### `GET /stats`

Stats.

```bash
curl http://localhost:5000/stats
```

**Response:**

```json
{"status": "ok", "service": "edge-webhook-aggregator"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "edge-webhook-aggregator"}
```


## Webhook Endpoints

### `POST /webhooks/voice`

Telnyx sends call events here. Your app processes them and responds with the next action.

**Events handled:**



**Example payload:**

```json
{
  "data": {
    "event_type": "call.initiated",
    "id": "evt_123",
    "payload": {
      "call_control_id": "v3:abc123",
      "direction": "incoming",
      "from": "+12125551234",
      "to": "+18005559876"
    }
  }
}
```

## All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/ingest` | Ingest |
| `POST` | `/tenants` | Tenants |
| `GET` | `/tenants` | Tenants |
| `GET` | `/stats` | Stats |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 invalid signature` on `/webhooks/ingest` | `TELNYX_PUBLIC_KEY` is unset, wrong, or signature verification is disabled | Set `TELNYX_PUBLIC_KEY` from [Portal -> Keys & Credentials](https://portal.telnyx.com/api-keys) (base64 Ed25519 public key). An empty/invalid key disables verification and rejects every request. |
| `401` despite a valid key | Request timestamp is more than 5 minutes off (`MAX_SKEW_SECONDS`), or a proxy altered the raw body before it reached Flask | Sync the server clock and ensure the signature is verified against the unmodified raw body - do not re-serialize the JSON upstream. |
| Webhooks never arrive | Telnyx cannot reach your server, or the URL points at `/webhooks/voice` instead of the ingest route | Expose the server with `ngrok http 5000` and configure the public webhook URL to `https://<id>.ngrok.io/webhooks/ingest`. |
| Events land under `unassigned` | The event's `to`/`from` number is not in `tenant_map` | Register the tenant first via `POST /tenants` with the matching `phone_numbers`. |
| `callback_url must be a public https URL` on `POST /tenants` | Callback is non-https or resolves to a private/loopback/metadata address (SSRF guard) | Use a publicly reachable `https://` endpoint; localhost and internal IPs are rejected by design. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [edge-compute-webhook-proxy-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-compute-webhook-proxy-python/README.md) - single-tenant webhook proxy/transform at the edge
- [edge-fraud-firewall-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-fraud-firewall-python/README.md) - inspect and filter Telnyx events at the edge before they hit your backend
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) - handle the voice events this aggregator consolidates
- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) - receive and verify the messaging webhooks aggregated here

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
