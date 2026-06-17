# Receive SMS Webhook with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that receives inbound SMS messages via Telnyx webhooks. This tutorial demonstrates webhook validation, proper error handling for telecom APIs, and secure credential management via environment variables. You'll learn how to configure a Messaging Profile, expose your local server to the internet, and process incoming SMS events in real time.

## Who Is This For?

- **Node.js developers** building sms features with Express.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Node.js 14 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound SMS.
- npm (Node.js package manager).
- ngrok or similar tunneling tool to expose your local server publicly (for webhook testing).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define a helper function to handle inbound SMS events with proper validation:

```javascript
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");

const app = express();

// Middleware to parse JSON request bodies
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory storage for received messages (replace with database in production)
const receivedMessages = [];

/**
 * Process inbound SMS webhook event.
 * Validates webhook payload and extracts message details.
 * @param {Object} payload - Webhook event payload from Telnyx.
 * @returns {Object} Processed message data.
 */
function processInboundSMS(payload) {
  // Validate required fields in webhook payload
  if (!payload.data || !payload.data.payload) {
    throw new Error("Invalid webhook payload structure");
  }

  const messageData = payload.data.payload;

  // Extract message details — ensure fields exist before accessing
  const processedMessage = {
    message_id: messageData.id || null,
    from: messageData.from?.phone_number || null,
    to: messageData.to?.[0]?.phone_number || null,
    text: messageData.text || "",
    received_at: messageData.received_at || new Date().toISOString(),
    direction: messageData.direction || "inbound",
  };

  // Validate critical fields
  if (!processedMessage.from || !processedMessage.to) {
    throw new Error("Missing sender or recipient phone number in webhook");
  }

  return processedMessage;
}
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving messages | Your endpoint is configured in the Telnyx Portal, but no POST requests arrive when SMS is sent to your number. | Verify the webhook URL is publicly accessible (use ngrok if testing locally). Check that the URL in your Messaging Profile settings matches exactly (including protocol `https://`). Ensure your Express server is running and listening on the correct port. Check Telnyx Portal webhook logs for delivery attempts and error messages. |
| "Invalid webhook payload" error | The endpoint returns HTTP 400 with `{"error": "Invalid webhook payload structure"}`. | Verify the webhook payload structure matches Telnyx's format. Log `req.body` to inspect the incoming data. Ensure `body-parser` middleware is configured before the route handler. Check that your Messaging Profile is sending the `message.received` event type. |
| Webhook timeout (no response within 5 seconds) | Telnyx retries the webhook delivery because your endpoint doesn't respond in time. | Ensure your webhook handler responds immediately with HTTP 200 before performing long-running operations (e.g., database writes, external API calls). Move heavy processing to a background job queue. Verify your server has sufficient resources and network connectivity. Check for synchronous blocking operations in your handler. |
| "Missing sender or recipient phone number" error | The webhook processes but returns HTTP 400 with missing phone number error. | Inspect the webhook payload structure from Telnyx. The `from` field should be at `payload.data.payload.from.phone_number` and `to` at `payload.data.payload.to[0].phone_number`. Add logging to print the full payload and verify field paths match your Telnyx API version. Update field accessors if the structure differs. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send a Single SMS with Node.js](/tutorials/sms/nodejs/send-single-sms).
- [Send Bulk SMS Messages with Node.js](/tutorials/sms/nodejs/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/nodejs/otp-2fa).
