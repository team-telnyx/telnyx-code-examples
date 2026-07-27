---
name: schedule-sms-messages
title: "Schedule SMS Messages"
description: "Schedule SMS messages to be sent at a future time with the Telnyx Messaging API, backed by an APScheduler job store and a Flask job-management API."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# Schedule SMS Messages

Schedule SMS messages to be sent at a future time with the Telnyx Messaging API, backed by an APScheduler job store and a Flask job-management API.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** - number reputation, 10DLC registration, and deliverability monitoring included.
- **Developer-first** - a single SDK (`telnyx.Telnyx`) wraps the Messaging API, so scheduling logic stays in your application while delivery stays with Telnyx.
- **Pay-as-you-go pricing** - no minimums, contracts, or per-seat fees.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` - called from the scheduled job via `client.messages.create(...)`. [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Architecture

```
  POST /sms/schedule
        │
        ▼
  ┌──────────────────┐      run_date reached       ┌──────────────────┐
  │ Flask API        │ ───────────────────────────►│ APScheduler job   │
  │ (job metadata)   │                              │ send_scheduled_sms│
  └────────┬─────────┘                              └─────────┬────────┘
           │                                                  │
   GET/DELETE /sms/scheduled                                  ▼
           │                                        ┌──────────────────┐
           └───────────────────────────────────────│ Telnyx Messaging  │
                                                    │ POST /v2/messages │
                                                    └─────────┬────────┘
                                                              │
                                                              └──► SMS delivered
```

The Flask process owns two things: an in-memory map of job metadata (`scheduled_jobs`) and a `BackgroundScheduler`. When a request hits `POST /sms/schedule`, the app registers a one-shot `DateTrigger` job and stores its metadata. When the scheduled time arrives, APScheduler invokes `send_scheduled_sms`, which calls the Telnyx Messaging API and updates the stored status.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key used to send messages | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number (E.164) used as the `from` address | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `FLASK_DEBUG` | `string` | `false` | no | Enable Flask debug mode (`true`/`false`) | - |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/schedule-sms-messages-python
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


The server schedules and sends messages directly through the Telnyx API; there are no inbound webhooks to expose, so no tunnel (ngrok) is required.

## API Reference

All endpoints accept and return JSON.

### `POST /sms/schedule`

Schedule an SMS for a future time. `send_at` must be an ISO 8601 timestamp in the future.

```bash
curl -X POST http://localhost:5000/sms/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15559876543",
    "message": "Your scheduled message",
    "send_at": "2026-06-18T14:30:00Z"
  }'
```

**Response `201`:**

```json
{
  "job_id": "sms_1718721000123",
  "status": "scheduled",
  "scheduled_for": "2026-06-18T14:30:00Z",
  "to": "+15559876543"
}
```

### `GET /sms/scheduled/<job_id>`

Retrieve the full status record of a single scheduled job.

```bash
curl http://localhost:5000/sms/scheduled/sms_1718721000123
```

**Response `200`:**

```json
{
  "id": "sms_1718721000123",
  "to": "+15559876543",
  "message": "Your scheduled message",
  "scheduled_for": "2026-06-18T14:30:00Z",
  "status": "scheduled",
  "created_at": "2026-06-18T14:25:00.000000"
}
```

### `GET /sms/scheduled`

List a summary of all scheduled jobs.

```bash
curl http://localhost:5000/sms/scheduled
```

**Response `200`:**

```json
[
  {
    "id": "sms_1718721000123",
    "to": "+15559876543",
    "status": "scheduled",
    "scheduled_for": "2026-06-18T14:30:00Z",
    "created_at": "2026-06-18T14:25:00.000000"
  }
]
```

### `DELETE /sms/scheduled/<job_id>`

Cancel a job before it is sent. Jobs already in `sent` or `failed` state cannot be cancelled.

```bash
curl -X DELETE http://localhost:5000/sms/scheduled/sms_1718721000123
```

**Response `200`:**

```json
{
  "id": "sms_1718721000123",
  "status": "cancelled",
  "cancelled_at": "2026-06-18T14:26:00.000000"
}
```

## Troubleshooting

- **Job never sends / status stays `scheduled`**: The Flask process must stay running until the `send_at` time - APScheduler runs in a background thread inside the same process. Confirm the app is up and check the logs.
- **`"Scheduled time must be in the future"`**: The server compares against `datetime.utcnow()`. Send a UTC ISO 8601 timestamp (e.g. `2026-06-18T14:30:00Z`) at least a minute ahead, and check for clock skew.
- **`"Invalid datetime format"`**: `send_at` must be ISO 8601. A trailing `Z` is accepted and normalized to `+00:00`.
- **Job status `failed` with "Authentication error"**: Your `TELNYX_API_KEY` is invalid or lacks messaging permission. Regenerate at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and restart the app.
- **Scheduled jobs disappear after a restart**: The job store and metadata are in memory only. Use a persistent APScheduler job store (SQLAlchemy) or a task queue (Celery + Redis) for production.

## Related Examples

- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) - send a single SMS immediately.

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send a Message - API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
