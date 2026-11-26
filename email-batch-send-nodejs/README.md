---
name: email-batch-send-nodejs
title: "Send Batch Emails with the Telnyx Email API"
description: "Send up to 1,000 emails in a single API call and track delivery events in a real-time dashboard"
language: nodejs
framework: express
telnyx_products: [Email]
---

# Send Batch Emails with the Telnyx Email API

Send up to 1,000 emails in a single API call with `POST /v2/email_messages/batch` and track delivery, open, click, bounce, and failure events in a real-time dashboard.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** behind this demo: one API key sends up to 1,000 emails in a single batch call, tracks per-message delivery lifecycle events via webhooks, and powers the real-time dashboard that visualizes performance. The Email API gives developers direct REST control over batch sends, open/click tracking, and event-driven workflows — the same pattern scales to newsletters, transactional receipts, onboarding sequences, and operational alerts.

## Telnyx API Endpoints Used

- **Batch Send**: `POST /v2/email_messages/batch` — [API reference](https://developers.telnyx.com/api/email/send-batch-emails)
- **Webhook Events**: Email delivery lifecycle events (`delivered`, `opened`, `clicked`, `bounced`, `failed`, `complained`)

## Architecture

```
  Dashboard (browser)
       │
       ▼
  ┌──────────────┐    POST /v2/email_messages/batch    ┌────────────────┐
  │  Express API  │ ─────────────────────────────────► │  Telnyx Email   │
  │  + SQLite     │ ◄───────────── webhooks ────────── │  API            │
  └──────┬───────┘                                     └────────────────┘
         │
         └──► SSE stream ──► browser updates KPIs in real time
```

1. User clicks **Send Batch** in the dashboard
2. Server builds a messages array and calls the Telnyx Batch Email API
3. The 207 Multi-Status response reports per-message success/failure
4. As emails deliver, Telnyx posts webhook events to `/webhooks/email`
5. Server stores events in SQLite and pushes them to the dashboard via SSE
6. Dashboard renders live KPI cards (delivery rate, open rate, click rate, bounce rate)

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `FROM_EMAIL` | `string` | `onboarding@msgtelnyx.com` | no | Sender address (defaults to shared domain) | Your verified sending domain or the shared `onboarding@msgtelnyx.com` |
| `TO_EMAIL` | `string` | `you@example.com` | no | Recipient address (defaults to `FROM_EMAIL`) | Your account's verified email |
| `PORT` | `number` | `3000` | no | Server port | — |

> **Account constraint:** The shared domain (`onboarding@msgtelnyx.com`) can only send to your account's verified email. Set `TO_EMAIL` to that address. If you have a verified custom domain, you can send to any recipient.

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx api-keys list
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/email-batch-send-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
npm start               # starts on http://localhost:3000
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Verify your API key works
telnyx api-keys list
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 3000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Email Settings** → Webhook URL → `https://<id>.ngrok.io/webhooks/email`

3. Open `http://localhost:3000`, set a batch count (10–1000), and click **Send Batch**.

## API Reference

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/email-batch-send-nodejs/API.md) for the full typed endpoint reference.

### Quick example — send a batch of 50

```bash
curl -X POST http://localhost:3000/api/send-batch \
  -H "Content-Type: application/json" \
  -d '{"count": 50, "subject": "Newsletter #42"}'
```

**Response:**

```json
{
  "batch_id": "a1b2c3d4-...",
  "count": 50,
  "succeeded": 50,
  "failed": 0,
  "errors": []
}
```

## Troubleshooting

- **Send fails with 401**: Your `TELNYX_API_KEY` is invalid or expired. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **Send fails with domain error**: Confirm `FROM_EMAIL` is a sender your Telnyx account can use. The shared domain `onboarding@msgtelnyx.com` works for any account.
- **All messages fail (207 with all errors)**: Check the `errors` array in the response. Common cause: recipient address not verified when using the shared domain.
- **No webhook events arriving**: Confirm your webhook URL is reachable from the internet (use ngrok) and configured in the Telnyx Portal under Email Settings.
- **Open/click rates stay at 0%**: Open the delivered email and click the link. `tracking_settings` is enabled per-send; events may take a few seconds to arrive.
- **Port 3000 in use**: Start with another port: `PORT=3001 npm start`.
- **SQLite error on startup**: Requires Node.js 22+ for the built-in `node:sqlite` module.

## Related Examples

- [`setup-email-api-nodejs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-email-api-nodejs/README.md) — single email send with delivery/engagement polling
- [`email-batch-retry-agent`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/email-batch-retry-agent/README.md) — durable batch sending with exponential backoff retries on Telnyx Edge
- [`ai-email-agent-python`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-email-agent-python/README.md) — autonomous inbound email reply bot

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

- [Email API Guide](https://developers.telnyx.com/docs/email)
- [Batch Email API Reference](https://developers.telnyx.com/api/email/send-batch-emails)
- [Email Webhook Events](https://developers.telnyx.com/api/email/email-webhook-events)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/nodejs)
- [Email API Product Page](https://telnyx.com/products/email-api)
- [Email Pricing](https://telnyx.com/pricing/email)
