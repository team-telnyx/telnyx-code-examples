---
name: email-batch-retry-agent
title: "Telnyx Email Batch Sender with Partial Failure Retry"
description: "A durable, stateful agent that sends email batches via the Telnyx Email API, tracks per-message state, and self-wakes to retry failures with exponential backoff."
language: typescript
framework: edge
telnyx_products: [Email, SMS, Agents]
---

# Telnyx Email Batch Sender with Partial Failure Retry

A durable, stateful agent that sends email batches via the Telnyx Email API, tracks per-message state, and self-wakes to retry failures with exponential backoff.

## The Story

A community bank is rolling out a fraud-alert campaign to notify cardholders about suspicious transactions on their accounts. Each notice carries a deadline: the longer a customer goes without confirming or disputing a charge, the more money is at risk, and the more the bank's reputation for vigilance is called into question. The bank's operations team uploads a batch of hundreds of messages, each with its own recipient, account context, and urgency. The actor IS the email campaign. It is born the moment the batch is submitted, it tracks the status of every single message as they fan out, and it survives chaos — like when the sending platform reboots mid-batch, or when a downstream email provider throttles a burst of requests. Through it all, the campaign remembers exactly which messages made it out, which failed, and how many retries each one deserves, waking itself up at the right time to try again without any human babysitting. The rest of this README is the API surface of that story.

Why Telnyx

Telnyx provides the **AI Communications Infrastructure** that powers this sample. The Telnyx Email API handles batch message delivery with idempotency-key support, while the Telnyx Edge Agent SDK provides the durable actor runtime — persistent state, self-waking schedules, and queues — that makes a resilient email campaign possible. Telnyx SMS completes the loop by notifying the operator when the campaign finishes.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/email_messages/batch` | `POST` | Send a batch of email messages. Returns a `207 Multi-Status` response with per-message success/failure. |
| Telnyx SMS API (via `TELNYX` binding) | `POST` | Send operator notification SMS on campaign completion or partial failure. |

## Architecture

The actor is the campaign. A `BatchAgent` instance owns the full campaign state — every message's status, attempt count, and idempotency key — and persists it durably across restarts and crashes. The initial batch is fired via a queue task, and failures are retried by self-scheduled tasks with exponential backoff.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client / Operator                               │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 │ POST /campaigns { campaignId, messages[] }
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BatchAgent (durable actor)                           │
│                                                                             │
│  ┌─────────────┐   queue("sendBatch")    ┌──────────────────────────────┐   │
│  │  fetch()    │ ──────────────────────▶ │  sendBatch()                 │   │
│  │  routes     │                         │  • POST /email_messages/batch│   │
│  └─────────────┘                         │  • parse 207 Multi-Status    │   │
│                                          │  • update per-message state  │   │
│  ┌──────────────────────────────┐        └──────────────┬───────────────┘   │
│  │  Durable State (ctx.storage) │                       │ failures?         │
│  │  CampaignState:              │                       ▼                   │
│  │  - messages[]                │        ┌──────────────────────────────┐   │
│  │  - status                    │        │  schedule(60, "retryFailed") │   │
│  │  - sent/failed/exhausted     │        └──────────────┬───────────────┘   │
│  └──────────────────────────────┘                       │                   │
│                                                         ▼                   │
│  ┌──────────────────────────────┐        ┌──────────────────────────────┐   │
│  │  RESULT_KV (audit trail)     │        │  retryFailed()               │   │
│  │  campaign:<id>               │        │  • retry only FAILED indices │   │
│  └──────────────────────────────┘        │  • new idempotency key       │   │
│                                          │  • backoff 60s → 5m          │   │
│                                          └──────────────┬───────────────┘   │
│                                                         │  final state      │
│                                                         ▼                   │
│                                          ┌──────────────────────────────┐   │
│                                          │  notifyOperator()            │   │
│                                          │  SMS summary via TELNYX      │   │
│                                          └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `OPERATOR_NUMBER` | `string` | `your_operator_number_here` | **yes** | OPERATOR_NUMBER | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_SENDER` | `string` | `your_telnyx_sender_here` | **yes** | TELNYX_SENDER | — |

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/email-batch-retry-agent
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Copy the `.env.example` file to `.env` and fill in your values:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your Telnyx API key, operator number, and sender.

4. **Authenticate the Telnyx Edge CLI**

   ```bash
   telnyx-edge auth api-key set "$TELNYX_API_KEY"
   ```

5. **Run the smoke test**

   ```bash
   npx tsx smoke_test.ts
   ```

6. **Deploy the agent**

   ```bash
   npm run deploy
   ```

   This runs `telnyx-edge ship`. The agent is now live and ready to receive requests.

## API Reference

### `POST /campaigns`

Creates a new campaign and immediately fires the initial batch send.

**Request body:**

```json
{
  "campaignId": "campaign-2026-03",
  "messages": [
    {
      "to": "+15551234567",
      "from": "sender@example.com",
      "subject": "Hello",
      "text": "This is a test message."
    }
  ]
}
```

**Response:** `202 Accepted`

```json
{
  "campaignId": "campaign-2026-03",
  "status": "CREATED"
}
```

### `GET /campaigns/:id`

Returns the full audit trail for a campaign, including per-message state, attempt counts, and idempotency keys.

**Response:** `200 OK`

```json
{
  "campaignId": "campaign-2026-03",
  "total": 100,
  "sent": 98,
  "failed": 0,
  "exhausted": 2,
  "messages": [
    {
      "index": 0,
      "to": "+15551234567",
      "from": "sender@example.com",
      "subject": "Hello",
      "text": "This is a test message.",
      "status": "SENT",
      "attempts": 1,
      "lastError": null,
      "idempotencyKey": "campaign-2026-03-1712345678901-a1b2c3d4"
    }
  ],
  "status": "PARTIAL_FAILURE",
  "createdAt": "2026-07-28T12:00:00.000Z",
  "completedAt": "2026-07-28T12:05:00.000Z"
}
```

### `GET /campaigns`

Lists all completed campaigns from the KV audit store.

**Response:** `200 OK`

```json
[
  {
    "campaignId": "campaign-2026-03",
    "status": "COMPLETED",
    "sent": 100,
    "total": 100
  }
]
```

## Troubleshooting

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| `TELNYX_API_KEY secret not configured` | The `TELNYX_API_KEY` secret is not set in the environment. | Run `telnyx-edge secrets add TELNYX_API_KEY "your_key_here"` and redeploy. |
| `Invalid E.164 'to' number` | The `to` field in a message is not a valid E.164 phone number. | Ensure all `to` numbers follow the `+15551234567` format. |
| `Batch API error 401` | The API key is invalid or expired. | Verify your `TELNYX_API_KEY` in the Telnyx Mission Control Portal. |
| `Operator not notified` | `OPERATOR_NUMBER` or `TELNYX_SENDER` secrets are missing. | Set both secrets via `telnyx-edge secrets add`. |
| `Campaign stuck in SENDING` | The agent crashed mid-batch and the state was not persisted. | The durable actor state should survive restarts. Check the actor logs for errors. |
| `Mock mode not working` | `MOCK_MODE` env var is not set to `true`. | Set `MOCK_MODE=true` in your environment or `telnyx.toml` to simulate failures. |

## Agent Discovery

- [Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [Telnyx LLMs.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Telnyx SMS Sender](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sms-sender)
- [Telnyx Voice Call Control](https://github.com/team-telnyx/telnyx-code-examples/tree/main/voice-call-control)
- [Telnyx AI Assistant](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-assistant)

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Email API Reference](https://developers.telnyx.com/api/email)
- [Telnyx TypeScript SDK](https://github.com/team-telnyx/telnyx-node)
- [Telnyx Product Page](https://telnyx.com)
- [Telnyx Pricing](https://telnyx.com/pricing)
