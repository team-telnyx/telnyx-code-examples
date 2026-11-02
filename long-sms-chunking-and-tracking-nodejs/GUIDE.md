# Long SMS Chunking and Tracking with Node.js

This example sends one logical SMS longer than the normal ten-segment limit, lets Telnyx split it into child messages, and correlates delivery webhooks back to the original parent message.

## Flow

```text
Enable messaging-profile chunking
              │
              ▼
Send 1,600-character message ──► Telnyx creates child chunks
                                      │
                                      ▼
message.sent / message.finalized webhooks
                                      │
                                      ▼
Map child_message_id → parent_message_id
```

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/long-sms-chunking-and-tracking-nodejs
cp .env.example .env
npm install
```

Set the API key, messaging profile ID, and sending number in `.env`. Configure the messaging profile webhook URL to point to `/webhooks/messaging`, then expose the local server with a tunnel such as `ngrok http 5000`.

<details>
<summary>Programmatic / CLI setup</summary>

```bash
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login
telnyx messaging-profiles list
telnyx available-phone-numbers list --country US --features sms
```

</details>

## Run the demo

```bash
npm start
curl -X POST http://localhost:5000/profile/enable-chunking
```

Create a message longer than 1,530 GSM-7 characters and send it:

```bash
node -e 'console.log(JSON.stringify({to: process.env.DEMO_TO, text: "A".repeat(1600)}))' > /tmp/long-sms.json
curl -X POST http://localhost:5000/sms/send-long \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/long-sms.json
```

The response gives you the parent message ID. After webhooks arrive, inspect the correlated chunks:

```bash
curl http://localhost:5000/deliveries/PARENT_MESSAGE_ID
```

## Why Telnyx

Telnyx is AI Communications Infrastructure with server-side chunking and webhook fields that preserve the relationship between the logical message and its individual chunks.

## Environment Variables

| Variable | Description |
|---|---|
| `TELNYX_API_KEY` | Telnyx API key |
| `TELNYX_MESSAGING_PROFILE_ID` | Messaging profile to update |
| `TELNYX_PHONE_NUMBER` | E.164 number used as the sender |
| `TELNYX_PUBLIC_KEY` | Base64 Ed25519 public key for webhook verification |
| `PORT` | Local server port, default `5000` |

> **Agent / CLI access** — use `telnyx messaging-profiles list` to find a profile and `telnyx available-phone-numbers list --country US --features sms` to find a messaging-capable number.

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/long-sms-chunking-and-tracking-nodejs/API.md).

## Troubleshooting

- A `400` for message length means the demo input is not longer than 1,530 characters.
- A `401` webhook response means the public key, timestamp, or signature headers are missing or invalid.
- If no webhook arrives, verify the messaging profile webhook URL and use a public HTTPS tunnel.
- If the profile update fails, verify that the profile ID belongs to the API key's account.

## Related Examples

- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md)
- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- [Agent signup](https://telnyx.com/agent-signup.md)
- [Agent CLI](https://github.com/team-telnyx/ai/tree/main/cli)
- [Agent skills](https://github.com/team-telnyx/ai/tree/main/skills)
- [LLM-optimized docs](https://developers.telnyx.com/llms-full.txt)
- [Example index](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- [Telnyx CLI](https://developers.telnyx.com/development/cli)

## Resources

- [SMS chunking documentation](https://developers.telnyx.com/docs/messaging/messages/sms-chunking)
- [Messaging profile API](https://developers.telnyx.com/api-reference/messaging-profiles/update-a-messaging-profile)
- [Send message API](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging pricing](https://telnyx.com/pricing/messaging)
