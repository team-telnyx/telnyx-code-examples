---
name: long-sms-chunking-and-tracking
title: "Long SMS Chunking & Tracking (Node.js)"
description: "Enable Telnyx long-message chunking, send a message over 1,530 characters, and correlate child delivery webhooks."
language: nodejs
framework: express
telnyx_products: [Messaging]
channel: [sms]
---

# Long SMS Chunking & Tracking (Node.js)

Enable server-side chunking for long SMS messages and track every child chunk back to its parent message using Telnyx webhooks.

## Why Telnyx

Telnyx is **AI Communications Infrastructure** that lets developers send a long logical message while retaining delivery visibility for the individual chunks.

## Telnyx API Endpoints Used

- `PATCH /v2/messaging_profiles/{id}` — enable `features.auto_chunk_long_messages`
- `POST /v2/messages` — send the long SMS
- Messaging webhooks — receive `message.sent` and `message.finalized`

## Architecture

The Express service enables the profile feature, sends a long message, verifies signed webhooks, and stores an in-memory map keyed by `parent_message_id`.

## Environment Variables

See `.env.example` for the complete list. The required values are `TELNYX_API_KEY`, `TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_PHONE_NUMBER`, and `TELNYX_PUBLIC_KEY`.

> **Agent / CLI access** — use `telnyx messaging-profiles list` to discover the profile ID and `telnyx available-phone-numbers list --country US --features sms` to find an SMS-capable number.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/long-sms-chunking-and-tracking-nodejs
cp .env.example .env
npm install
npm start
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
telnyx auth login
telnyx messaging-profiles list
telnyx available-phone-numbers list --country US --features sms
```

</details>

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/long-sms-chunking-and-tracking-nodejs/API.md) for request and response examples.

### Recording-friendly appointment demo

With `DEMO_TO` saved in `.env`, run the server in one terminal and send a realistic 1,600-character appointment update from another:

```bash
npm start
```

```bash
npm run demo
```

To show four intentionally separate appointment messages instead of one carrier-chunked long message, run:

```bash
npm run demo -- --sequence
```

Use `npm run demo -- --dry-run` first to verify the message length without sending an SMS.

## Troubleshooting

- Configure the messaging profile webhook URL as `https://YOUR_HOST/webhooks/messaging`.
- Use a message longer than 1,530 characters to exercise chunking.
- Keep the webhook route public and HTTPS so Telnyx can deliver events.

## Related Examples

- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md)
- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md)

## Agent Discovery

See the [Telnyx Code Examples catalog](https://github.com/team-telnyx/telnyx-code-examples), [agent CLI](https://github.com/team-telnyx/ai/tree/main/cli), [agent skills](https://github.com/team-telnyx/ai/tree/main/skills), [llms-full.txt](https://developers.telnyx.com/llms-full.txt), and [llms.txt](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt).

## Resources

- [SMS chunking docs](https://developers.telnyx.com/docs/messaging/messages/sms-chunking)
- [Messaging profile API](https://developers.telnyx.com/api-reference/messaging-profiles/update-a-messaging-profile)
- [Send message API](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [SMS API](https://telnyx.com/products/sms-api)
- [Messaging pricing](https://telnyx.com/pricing/messaging)
