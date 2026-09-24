---
name: setup-email-api-nodejs
title: "Set Up the Telnyx Email API"
description: "Send a Telnyx Email API message from a local Node.js dashboard, enable per-send open and click tracking, and poll delivery and engagement events."
language: nodejs
framework: node
telnyx_products: [Email]
---

# Set Up the Telnyx Email API

A tiny local Node.js sample that sends one email with the Telnyx Email API, polls the message event feed, and displays delivery, open, click, bounce, and unsubscribe rates.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure behind this sample: one API key can send transactional email, track delivery lifecycle events, and power event-driven product workflows. The Email API gives developers direct REST control over sends, tracking, and message history, so the same pattern can support onboarding emails, receipts, password resets, billing alerts, and operational notifications.

This sample has no npm dependencies. It uses Node 18+ built-in `fetch`.

## Setup

1. Copy the example env file:

```bash
cp .env.example .env
```

2. Fill in `.env`:

```bash
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
FROM_EMAIL=sender@example.com
TO_EMAIL=you@example.com
```

`FROM_EMAIL` must be a sender that your Telnyx account can use.

3. Start the dashboard:

```bash
npm start
```

4. Open:

```text
http://localhost:3000
```

Click **Send test email**, then open the email and click the link inside it. The dashboard polls every 10 seconds and updates as Telnyx returns events.

## Tracking note

Delivery lifecycle events come from the normal Email API event feed. Open and click events require tracking.

This sample enables open and click tracking per send:

```js
tracking_settings: {
  open_tracking: true,
  click_tracking: true,
}
```

If `tracking_settings` is omitted, the message inherits the sender domain's default tracking settings.

## What the sample demonstrates

- `POST /v2/email_messages` to send an email
- Per-send `tracking_settings` for open and click tracking
- `GET /v2/email_messages/{id}/events` to fetch message lifecycle events
- Fallback to `GET /v2/email_events` filtered by `email_id`
- Local masking of configured sender and recipient addresses
- A simple dashboard for delivery, open, click, bounce, and unsubscribe rates

## Safe output

The app does not return the API key to the browser. It also masks configured email addresses in the UI. Local message IDs are stored in `data/sent.json`, which is ignored by git.

## Troubleshooting

- **Send fails with a domain error:** confirm `FROM_EMAIL` is a sender that your Telnyx account can use.
- **Open or click rates stay at 0%:** confirm the email client loaded images and that you clicked the rewritten link. This sample enables per-send tracking with `tracking_settings`; if you remove that object, the message inherits the sender domain's default tracking settings.
- **Port 3000 is already in use:** start with another port, for example `PORT=3001 npm start`.
- **Events are delayed:** delivery and engagement events can take a few seconds to appear. The dashboard polls every 10 seconds.

## Related Examples

- [`ai-email-agent-python`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-email-agent-python/README.md) - inbound email reply automation with the Telnyx Email API.
- [`email-batch-retry-agent`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/email-batch-retry-agent/README.md) - durable batch email sending and retry logic.

## Agent Discovery

For broader API discovery, use the Telnyx developer docs and the repo-level [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt). This example is intentionally small so agents and developers can inspect the complete send and event-polling flow in one file.
