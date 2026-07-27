---
name: edge-number-masking
title: "Edge Number Masking"
description: "Marketplace-style proxy number pool at the edge."
language: python
framework: flask
telnyx_products: [Edge Compute, Numbers, Voice, Call Recording]
channel: [voice]
---

# Edge Number Masking

> Also known as: number masking, proxy numbers, anonymous calling, marketplace phone masking.

Marketplace-style proxy number pool at the edge. Dynamically assigns masked number pairs per booking, routes calls bidirectionally through the proxy, records for dispute resolution, and auto-expires at checkout.

## Why Telnyx

Telnyx is AI Communications Infrastructure: voice, messaging, numbers, and inference run on one private global network instead of the public internet. This example leans on that single stack, provisioning the proxy number pool, bridging both call legs with Call Control, and recording to Telnyx Storage all through one API and one set of credentials. Owning the network means lower call latency and consistent quality on every masked leg, with no third-party carrier in the path.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` -- [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Transfer**: `POST /v2/calls/{id}/actions/transfer` -- [API reference](https://developers.telnyx.com/api/call-control/transfer-call)
- **Call Control: Reject**: `POST /v2/calls/{id}/actions/reject` -- [API reference](https://developers.telnyx.com/api/call-control/reject-call)
- **Call Control: Record Start**: `POST /v2/calls/{id}/actions/record_start` -- [API reference](https://developers.telnyx.com/api/call-control/start-recording)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
- `call.recording.saved` -- Recording available for download
- `call.hangup` -- Call ended, cleans up session state and logs outcome

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
cd telnyx-code-examples/edge-number-masking-python
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

### `POST /pool`

Pool.

```bash
curl -X POST http://localhost:5000/pool \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `POST /bookings`

Bookings.

```bash
curl -X POST http://localhost:5000/bookings \
  -H "Content-Type: application/json" \
  -d '{"example": "value"}'
```

**Response:**

```json
{"status": "ok"}
```

### `DELETE /bookings/<booking_id>`

<Booking Id>.

```bash
curl http://localhost:5000/bookings/<booking_id>
```

**Response:**

```json
{"status": "ok", "service": "edge-number-masking"}
```

### `GET /bookings`

Bookings.

```bash
curl http://localhost:5000/bookings
```

**Response:**

```json
{"status": "ok", "service": "edge-number-masking"}
```

### `GET /health`

Health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{"status": "ok", "service": "edge-number-masking"}
```


## Webhook Endpoints

### `POST /webhooks/voice`

Telnyx sends call events here. Your app processes them and responds with the next action.

**Events handled:**

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction with greeting
- `call.recording.saved` -- Recording available for download
- `call.hangup` -- Call ended, cleans up session state and logs outcome

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
| `POST` | `/pool` | Pool |
| `POST` | `/bookings` | Bookings |
| `DELETE` | `/bookings/<booking_id>` | <Booking Id> |
| `POST` | `/webhooks/voice` | Voice |
| `GET` | `/bookings` | Bookings |
| `GET` | `/health` | Health |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 invalid signature` on `/webhooks/voice` | `TELNYX_PUBLIC_KEY` is unset, wrong, or the body was modified by a proxy | Set `TELNYX_PUBLIC_KEY` to the base64 Ed25519 key from the [Portal](https://portal.telnyx.com); verification runs over the raw body, so don't re-serialize the payload. A blank key makes every request fail closed. |
| `401` only on older or replayed events | `telnyx-timestamp` drifts more than 5 minutes (`MAX_SKEW_SECONDS`) | Sync the server clock (NTP) and ensure events are delivered promptly; intentional replays are rejected by design. |
| Inbound calls get `503 No proxy numbers available` | The proxy pool is empty when a booking is created | `POST /pool` with a `numbers` array first, and confirm masks are auto-expiring back into the pool at checkout. |
| Calls to a proxy number are rejected (`UNALLOCATED_NUMBER`) | No active mask maps the dialed number to a booking | Create the booking via `POST /bookings` before the parties dial, and check the mask has not passed `expires_at`. |
| Webhooks never arrive | Telnyx can't reach your local server | Run `ngrok http 5000` and set the Call Control Application Webhook URL to `https://<id>.ngrok.io/webhooks/voice`. |
| `call.recording.saved` archives nothing | `recording_url` failed the Telnyx-host SSRF guard or `STORAGE_BUCKET` is wrong | Confirm the recording URL is a `*.telnyx.com` host and that `STORAGE_BUCKET` exists in Telnyx Storage. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [multi-number-identity-router-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-number-identity-router-python/README.md) - route inbound calls across a pool of numbers by identity
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) - Call Control answer/transfer routing patterns
- [record-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-python/README.md) - start recordings and handle `call.recording.saved`
- [edge-geo-smart-router-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-geo-smart-router-python/README.md) - edge-deployed Call Control routing sibling

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
